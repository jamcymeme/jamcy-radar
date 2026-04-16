/* ============================================
   JAMCY Radar — app.js
   Copyright (C) 2026 JAMCY (jamcymeme)
   Licensed under AGPL-3.0 — see LICENSE
   ============================================ */

'use strict';

const AI_PROXY = '/api/ai';

// ---- Constants ----
const FOURMEME_CONTRACTS = new Set([
  '0x5c952063c7fc8610ffdb798152d69f0b9550762b',
  '0x9a26f5433671751c3276a065f57e5a02d2817973',
  '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24',
]);
// pump.fun bonding curve contract — holds majority of supply pre-graduation
const PUMPFUN_CONTRACTS = new Set([
  '6ef8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'.toLowerCase(),
  'ce6tfhcq6ynzucbge1wbcgfivtb9rp9wgp7e9fggxpj'.toLowerCase(), // pump.fun migration program
]);

const STORAGE_KEY    = 'jamcy_radar_prefs';
const HISTORY_MAX    = 5;
const RADAR_POLL_MS  = 20_000;
const RADAR_PAGE_SIZE = 10; // 10 tokens × 1.5s queue = ~15s scan, fits in 20s poll interval
const FOURMEME_API   = 'https://four.meme/meme-api/v1';
const GOPLUS_API     = 'https://api.gopluslabs.io/api/v1';
const AI_CACHE_TTL   = 5 * 60 * 1000; // 5 min

const REGEXES = {
  evm:    /^0x[0-9a-fA-F]{40}$/,
  solana: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
};

// ---- State ----
let radarOpen       = false;
let radarTimer      = null;
let seenTokens      = new Set();
let radarTokenCache = new Map(); // addr → Four.meme token object
let radarFilter     = 'all';    // 'all' | 'safe' | 'warn' | 'danger'
let prefs           = loadPrefs();

// ---- Watch list + share card state ----
const WATCH_KEY    = 'jamcy_watch_list';
let watchList      = loadWatchList();
let currentInspect = null; // { addr, tokenName, tokenSymbol, score } — for share card
let lastAIResult   = null; // { verdict, summary, reasoning, watch } — set after AI call
let gradWatchTimer = null;

// ---- Page state ----
let currentPage = 'inspector';

// ---- Graveyard data (session-only) ----
const graveyardEntries = []; // { addr, name, symbol, logo, detectedAt, raised, deployerAddr }
let totalRaised = 0; // sum of all rugged tokens' raised amounts

// ---- Stats counters (session) ----
const statsScores    = [];   // all numeric scores from autoScanRadarToken
const statsVerdicts  = { safe: 0, warn: 0, degen: 0, danger: 0, unverified: 0 };
const statsDeployers = {};   // userAddress -> { name, launches: [] }

// ---- Narrative trends state ----
let trendsRunning    = false;
let trendsLastRun    = 0;
let trendsData       = null; // last AI result
const TRENDS_MIN_TOKENS   = 10;  // min tokens before first run
const TRENDS_INTERVAL_MS  = 5 * 60 * 1000; // re-run every 5 min

// GoPlus scan queue — throttle radar auto-scans to 1 per 1.2s
const gpQueue = [];
let gpRunning = false;
async function gpEnqueue(fn) {
  gpQueue.push(fn);
  if (gpRunning) return;
  gpRunning = true;
  while (gpQueue.length) {
    const task = gpQueue.shift();
    try { await task(); } catch { /* silent */ }
    if (gpQueue.length) await new Promise(r => setTimeout(r, 1500));
  }
  gpRunning = false;
}

// ---- DOM refs ----
const addrInput     = document.getElementById('addr-input');
const inspectBtn    = document.getElementById('inspect-btn');
const inspectBtnTxt = document.getElementById('inspect-btn-text');
const chainHint     = document.getElementById('chain-hint');
const historyBar    = document.getElementById('history-bar');
const resultArea    = document.getElementById('result');
const radarToggle   = document.getElementById('radar-toggle');
const radarOverlay  = document.getElementById('radar-overlay');
const radarPanel    = document.getElementById('radar-panel');
const radarClose    = document.getElementById('radar-close');
const radarFeed     = document.getElementById('radar-feed');
const radarEmpty    = document.getElementById('radar-empty');
const radarCountTxt = document.getElementById('radar-count-text');
const radarLastUpd  = document.getElementById('radar-last-update');

// ============================================
// INIT
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  renderHistory();

  const urlParams = new URLSearchParams(window.location.search);
  const urlAddr = urlParams.get('addr');
  const urlPage = urlParams.get('page');
  const urlName = urlParams.get('name');

  if (urlAddr) {
    addrInput.value = urlAddr;
    updateChainHint(urlAddr);
  } else if (prefs.lastAddr) {
    addrInput.value = prefs.lastAddr;
    updateChainHint(prefs.lastAddr);
  }

  if (prefs.radarOpen) openRadar();

  // Restart graduation watcher if there are watched tokens
  if (watchList.length > 0) restartGradWatcher();

  // Page navigation
  document.getElementById('site-nav').addEventListener('click', e => {
    const btn = e.target.closest('[data-page]');
    if (!btn) return;
    showPage(btn.dataset.page);
  });

  inspectBtn.addEventListener('click', handleInspect);
  addrInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleInspect(); });
  addrInput.addEventListener('input',   () => updateChainHint(addrInput.value.trim()));
  radarToggle.addEventListener('click', toggleRadar);
  radarClose.addEventListener('click',  closeRadar);
  radarOverlay.addEventListener('click', closeRadar);

  // Radar filter buttons
  document.getElementById('radar-filters').addEventListener('click', e => {
    const btn = e.target.closest('[data-filter]');
    if (!btn) return;
    radarFilter = btn.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('active', b === btn));
    applyRadarFilter();
  });

  if (urlAddr) {
    const chain = detectChain(urlAddr);
    if (chain) runInspect(urlAddr, chain);
  }

  // Hide header on scroll down, show on scroll up (mobile)
  {
    const header = document.querySelector('.site-header');
    let lastY = 0;
    let ticking = false;
    window.addEventListener('scroll', () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          const y = window.scrollY;
          if (y > lastY && y > 80) {
            header.classList.add('header-hidden');
          } else {
            header.classList.remove('header-hidden');
          }
          lastY = y;
          ticking = false;
        });
        ticking = true;
      }
    }, { passive: true });
  }

  // Handle ?page= and ?name= deep links (e.g. certificate share links)
  if (urlPage) {
    showPage(urlPage);
    if (urlPage === 'certify' && urlName) {
      showCertDirect(decodeURIComponent(urlName));
    }
  }
});

// ============================================
// PREFS / STORAGE
// ============================================
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
  catch { return {}; }
}
function savePrefs() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch {}
}
function addToHistory(addr, chain) {
  if (!prefs.history) prefs.history = [];
  prefs.history = prefs.history.filter(h => h.addr !== addr);
  prefs.history.unshift({ addr, chain, ts: Date.now() });
  if (prefs.history.length > HISTORY_MAX) prefs.history.length = HISTORY_MAX;
  prefs.lastAddr = addr;
  window.history.replaceState(null, '', `?addr=${encodeURIComponent(addr)}`);
  savePrefs();
  renderHistory();
}
function renderHistory() {
  if (!prefs.history || prefs.history.length === 0) { historyBar.innerHTML = ''; return; }
  historyBar.innerHTML = prefs.history.map(h => {
    const short = `${h.addr.slice(0, 6)}…${h.addr.slice(-4)}`;
    const icon  = h.chain === 'solana' ? '🟣' : '🟡';
    return `<button class="history-chip" title="${h.addr}" data-addr="${h.addr}">${icon} ${short}</button>`;
  }).join('');
  historyBar.querySelectorAll('.history-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      addrInput.value = btn.dataset.addr;
      updateChainHint(btn.dataset.addr);
      handleInspect();
    });
  });
}

// ============================================
// AI RESULT CACHE (sessionStorage, 5 min TTL)
// ============================================
function aiCacheKey(addr) { return `jamcy_ai_${addr.toLowerCase()}`; }
function aiCacheGet(addr) {
  try {
    const raw = sessionStorage.getItem(aiCacheKey(addr));
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > AI_CACHE_TTL) { sessionStorage.removeItem(aiCacheKey(addr)); return null; }
    return data;
  } catch { return null; }
}
function aiCacheSet(addr, data) {
  try { sessionStorage.setItem(aiCacheKey(addr), JSON.stringify({ ts: Date.now(), data })); } catch {}
}

// ============================================
// CHAIN DETECTION
// ============================================
function detectChain(addr) {
  if (REGEXES.evm.test(addr))    return 'bnb';
  if (REGEXES.solana.test(addr)) return 'solana';
  return null;
}
function updateChainHint(addr) {
  if (!addr) { chainHint.innerHTML = ''; return; }
  const chain = detectChain(addr);
  if (chain === 'bnb')    chainHint.innerHTML = '<span class="chain-tag bnb">🟡 BNB Chain detected</span>';
  else if (chain === 'solana') chainHint.innerHTML = '<span class="chain-tag sol">🟣 Solana detected</span>';
  else chainHint.innerHTML = '<span style="color:var(--text-muted)">Paste a BNB (0x…) or Solana address</span>';
}

// ============================================
// INSPECTOR
// ============================================
async function handleInspect() {
  const addr  = addrInput.value.trim();
  if (!addr) return;
  const chain = detectChain(addr);
  if (!chain) { showError('Unrecognised address format. Paste a BNB Chain (0x…) or Solana address.'); return; }
  addToHistory(addr, chain);
  await runInspect(addr, chain);
}

async function runInspect(addr, chain) {
  inspectBtn.disabled       = true;
  inspectBtnTxt.textContent = 'Scanning…';
  showLoading();

  try {
    // For BNB addresses not in radar cache, fetch Four.meme data first
    // so cap/progress/image are available for risk scoring and rendering
    if (chain === 'bnb' && !radarTokenCache.has(addr.toLowerCase())) {
      await fetchFourMemeByAddr(addr); // await so cap is ready for calcRisk
    }

    const [gpRes, dexRes] = await Promise.allSettled([
      fetchGoPlus(addr, chain),
      fetchDex(addr),
    ]);
    const gp  = gpRes.status  === 'fulfilled' ? gpRes.value  : null;
    const dex = dexRes.status === 'fulfilled' ? dexRes.value : null;

    if (!gp && !dex) {
      showError('Could not retrieve data. The contract may not exist or APIs are temporarily unavailable.');
      return;
    }

    const { score, flags } = calcRisk(gp, chain, addr, dex);

    // Invalidate stale AI cache when:
    // - any danger flag present
    // - bonding curve token (data changes each scan)
    // - dex-confirmed but GoPlus incomplete (different prompt path)
    const isBondingCurveToken  = flags.some(f => f.label.includes('bonding curve'));
    const isDexConfirmedNoGoPlus = flags.some(f => f.label.includes('GoPlus data incomplete'));
    if (flags.some(f => f.cls === 'danger') || isBondingCurveToken || isDexConfirmedNoGoPlus) {
      sessionStorage.removeItem(aiCacheKey(addr));
    }

    // Feed manually-inspected dead tokens into graveyard too
    if (chain === 'bnb' && isDeadToken(flags)) {
      const cachedToken = radarTokenCache.get(addr.toLowerCase()) || { name: gp?.token_name, symbol: gp?.token_symbol };
      const raised = cachedToken?.cap != null ? parseFloat(cachedToken.cap) : 0;
      addToGraveyard(addr, cachedToken, raised);
    }

    renderResult(addr, chain, gp, dex, score, flags, null); // deployer fills in async
    updateWatchTokenBtn(addr);
    requestAISummary(addr, chain, gp, dex, score, flags);
    if (chain === 'bnb') fetchDeployerSection(addr);

  } catch (err) {
    showError('Something went wrong. Please try again.');
    console.error(err);
  } finally {
    inspectBtn.disabled       = false;
    inspectBtnTxt.textContent = 'Inspect';
  }
}

// ============================================
// FOUR.MEME — fetch token detail by address
// ============================================
async function fetchFourMemeByAddr(addr) {
  // Single attempt — GoPlus handles rug detection even without this data
  try {
    const res = await fetch(`${FOURMEME_API}/public/token/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ tokenAddress: addr, pageIndex: 1, pageSize: 1 }),
    });
    if (!res.ok) return; // 404 = not listed, 429 = rate limited — both fine, GoPlus covers us
    const json = await res.json();
    const list  = json.data?.list || json.data || [];
    const token = Array.isArray(list) ? list[0] : null;
    if (token) radarTokenCache.set(addr.toLowerCase(), token);
  } catch { /* silent */ }
}

// (old fetchDeployerAndHistory replaced by fetchDeployerSection above)

// ============================================
// GOPLUS
// ============================================
async function fetchGoPlus(addr, chain, retries = 2) {
  const url = chain === 'solana'
    ? `${GOPLUS_API}/solana/token_security?contract_addresses=${addr}`
    : `${GOPLUS_API}/token_security/56?contract_addresses=${addr}`;
  const res  = await fetch(url);
  if (!res.ok) return null;
  const json = await res.json();
  if (json.code === 4029) {
    if (retries > 0) {
      await new Promise(r => setTimeout(r, 2000));
      return fetchGoPlus(addr, chain, retries - 1);
    }
    throw new Error('rate_limited');
  }
  if (json.code !== 1) return null;
  const key  = chain === 'solana' ? addr : addr.toLowerCase();
  return json.result?.[key] || null;
}

// ============================================
// DEXSCREENER
// ============================================
async function fetchDex(addr) {
  const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${addr}`);
  if (!res.ok) return null;
  const json = await res.json();
  const pairs = json.pairs;
  if (!pairs || pairs.length === 0) return null;
  return pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
}

// ============================================
// RISK SCORING
// ============================================
function calcRisk(gp, chain, addr = '', dex = null) {
  let score = 100;
  const flags = [];

  if (!gp) return { score: null, flags: [{ label: '⏳ Not yet indexed — too new to verify', cls: 'warn' }] };

  const hasGoPlusData  = gp.is_honeypot !== undefined || gp.is_open_source !== undefined || parseInt(gp.holder_count || 0) > 0;
  // DexScreener liquidity/volume proves the token is real even if GoPlus hasn't fully indexed it
  const hasDexData     = dex && ((dex.liquidity?.usd || 0) > 0 || (dex.volume?.h24 || 0) > 1000);
  const hasAnyData     = hasGoPlusData || hasDexData;
  if (!hasAnyData) return { score: null, flags: [{ label: '⏳ Not yet indexed — too new to verify', cls: 'warn' }] };

  // If GoPlus data is sparse but DexScreener confirms the token is live and trading
  if (!hasGoPlusData && hasDexData) {
    const liq = dex.liquidity?.usd || 0;
    const vol = dex.volume?.h24 || 0;
    flags.push({ label: `⚠️ GoPlus data incomplete — token is live (${formatUsdShort(liq)} liq, ${formatUsdShort(vol)} 24h vol)`, cls: 'warn' });
    score -= 10; // small penalty for unverified contract
    return { score, flags };
  }

  // Detect Four.meme bonding curve tokens (ends or starts with 4444, in radar cache, or not yet on DEX)
  const addrLow2        = addr.toLowerCase();
  const isPumpFunToken  = chain === 'solana' && addrLow2.endsWith('pump');
  const isFourMemeToken = addrLow2.endsWith('4444') || addrLow2.startsWith('0x4444') || radarTokenCache.has(addrLow2) || (gp.is_in_dex === '0' && chain === 'bnb') || isPumpFunToken;
  if (isFourMemeToken) {
    // Only check curve health if token is still pre-graduation
    // BNB: use is_in_dex field. Solana pump.fun: always pre-graduation if addr ends in 'pump'
    const isPreGrad = gp.is_in_dex === '0' || isPumpFunToken;
    if (isPreGrad) {
      const fmData   = radarTokenCache.get(addr.toLowerCase());
      const hasFmData = !!fmData;
      // FIX: != null check so numeric 0 is not treated as falsy
      const cap      = fmData?.cap != null ? parseFloat(fmData.cap) : null;
      const hold     = parseInt(fmData?.hold || fmData?.holders || 0);
      const progress = fmData?.progress != null ? Math.round(parseFloat(fmData.progress) * 100) : null;

      // GoPlus-only heuristics — work even if Four.meme data is unavailable
      const gpHolderCount  = parseInt(gp.holder_count || 0);
      const gpSingleHolder = gpHolderCount <= 1;
      const gpFewHolders   = gpHolderCount <= 3;

      if (hasFmData && cap === 0) {
        // Zero USD raised — rugged or abandoned
        score -= 65;
        flags.push({ label: '🚨 Empty bonding curve — 0 USD raised, likely rugged or abandoned', cls: 'danger' });
      } else if (!hasFmData && gpSingleHolder) {
        // No Four.meme data, GoPlus shows ≤1 holder — strong rug signal
        score -= 55;
        flags.push({ label: '🚨 Only 1 holder on bonding curve — likely rugged or abandoned', cls: 'danger' });
      } else if (!hasFmData && gpFewHolders) {
        // No Four.meme data but ≤3 holders on a pre-graduation curve — ghost/stalled launch
        score -= 35;
        const progressStr = progress !== null ? ` · ${progress}%` : '';
        flags.push({ label: `📈 Four.meme bonding curve (pre-graduation${progressStr})`, cls: 'info' });
        flags.push({ label: `👻 Stalled launch — only ${gpHolderCount} holder${gpHolderCount !== 1 ? 's' : ''}, no momentum`, cls: 'danger' });
      } else {
        // Has some liquidity — tier by amount
        const progressStr  = progress !== null ? ` · ${progress}%` : '';
        const curveplatform = isPumpFunToken ? 'pump.fun' : 'Four.meme';
        flags.push({ label: `📈 ${curveplatform} bonding curve (pre-graduation${progressStr})`, cls: 'info' });

        if (cap !== null && cap < 1) {
          // Ghost launch — sub $1 raised, basically nobody bought
          score -= 50;
          flags.push({ label: `👻 Ghost launch — only $${cap.toFixed(2)} raised, no real buyers`, cls: 'danger' });
        } else if (cap !== null && cap < 20) {
          score -= 25;
          flags.push({ label: `⚠️ Micro liquidity — only $${cap.toFixed(2)} raised`, cls: 'warn' });
        } else if (cap !== null && cap < 100) {
          score -= 10;
          flags.push({ label: `⚠️ Low curve value — $${cap.toFixed(0)} raised so far`, cls: 'warn' });
        }

        // Stalled: 0% progress + tiny raise + ≤3 holders
        const isStalled = progress === 0 && cap !== null && cap < 50 && gpHolderCount <= 3;
        if (isStalled) {
          score -= 15;
          flags.push({ label: '🛑 Stalled launch — 0% curve progress, almost no community', cls: 'warn' });
        }
      }
    } else {
      // Graduated token — just show the info flag
      flags.push({ label: '📈 Four.meme bonding curve (graduated)', cls: 'info' });
    }
  }

  const add = (cond, pts, label, cls) => {
    if (cond) { score -= pts; flags.push({ label, cls }); }
  };

  add(gp.is_honeypot === '1',             50, '🍯 Honeypot detected',         'danger');
  add(gp.is_blacklisted === '1',          20, '🚫 Blacklisted',               'danger');
  add(gp.owner_change_balance === '1',    20, '⚠️ Owner can change balances', 'danger');
  add(gp.is_mintable === '1',             15, '🖨️ Mintable supply',           'warn');
  add(gp.hidden_owner === '1',            15, '👻 Hidden owner',              'warn');
  add(gp.can_take_back_ownership === '1', 10, '↩️ Ownership reclaimable',     'warn');
  add(gp.is_proxy === '1',               10, '🔄 Proxy contract',            'warn');
  add(gp.is_anti_whale === '1',           0,  '🐋 Anti-whale mechanism',      'info');

  if (gp.is_open_source === '1') flags.push({ label: '✅ Open source', cls: 'good' });
  else                            flags.push({ label: '🔒 Closed source', cls: 'warn' });

  const buyTax  = parseFloat(gp.buy_tax  || 0);
  const sellTax = parseFloat(gp.sell_tax || 0);
  if (buyTax > 10)   { score -= 10; flags.push({ label: `💸 High buy tax: ${buyTax}%`,   cls: 'danger' }); }
  else if (buyTax > 0) flags.push({ label: `ℹ️ Buy tax: ${buyTax}%`, cls: 'info' });
  if (sellTax > 10)  { score -= 10; flags.push({ label: `💸 High sell tax: ${sellTax}%`, cls: 'danger' }); }
  else if (sellTax > 0) flags.push({ label: `ℹ️ Sell tax: ${sellTax}%`, cls: 'info' });

  // For pump.fun pre-graduation: bonding curve holds majority of supply — don't penalise holder count or concentration
  const isPreGradPumpFun = isPumpFunToken; // always pre-grad if addr ends in 'pump'

  const holderCount = parseInt(gp.holder_count || 0);
  if (!isPreGradPumpFun) {
    if (holderCount > 0 && holderCount < 10) {
      score -= 10;
      flags.push({ label: `👥 Very few holders: ${holderCount}`, cls: 'warn' });
    } else if (holderCount >= 10 && holderCount < 50) {
      flags.push({ label: `👥 Low holder count: ${holderCount}`, cls: 'info' });
    }
  } else {
    // pump.fun: show holder count as neutral info, no penalty
    flags.push({ label: `👥 Holders: ${holderCount} (pre-graduation)`, cls: 'info' });
  }

  const topHolder      = gp.holders?.[0];
  const topHolderAddr  = (topHolder?.address || '').toLowerCase();
  const topHolderPct   = parseFloat(topHolder?.percent || 0) * 100;
  const isBondingCurve = FOURMEME_CONTRACTS.has(topHolderAddr) || PUMPFUN_CONTRACTS.has(topHolderAddr);
  const curveLabel     = PUMPFUN_CONTRACTS.has(topHolderAddr) ? 'pump.fun bonding curve' : 'Four.meme bonding curve';
  if (isBondingCurve) {
    flags.push({ label: `📈 Top holder is ${curveLabel} (${topHolderPct.toFixed(1)}%) — normal pre-graduation`, cls: 'info' });
  } else if (isPreGradPumpFun) {
    // On pump.fun the per-token bonding curve account isn't in our set, but it IS the curve
    // Only warn if there are 2+ non-curve large holders suggesting real whale concentration
    flags.push({ label: `📈 Top holder ${topHolderPct.toFixed(1)}% — likely pump.fun bonding curve account`, cls: 'info' });
  } else if (topHolderPct > 50) {
    score -= 15;
    flags.push({ label: `👤 Top holder: ${topHolderPct.toFixed(1)}%`, cls: 'danger' });
  } else if (topHolderPct > 20) {
    flags.push({ label: `👤 Top holder: ${topHolderPct.toFixed(1)}%`, cls: 'warn' });
  }

  if (flags.filter(f => ['danger','warn'].includes(f.cls)).length === 0) {
    flags.unshift({ label: '✅ No major risks detected', cls: 'good' });
  }

  return { score: Math.max(0, score), flags };
}

function riskLevel(score) {
  if (score === null) return 'warn';
  if (score >= 80)   return 'safe';
  if (score >= 40)   return 'warn';
  return 'danger';
}
function riskLabel(score) {
  if (score === null) return '⏳ Unverified';
  if (score >= 80)   return '✅ WAGMI';
  if (score >= 60)   return '🤔 DYOR';
  if (score >= 40)   return '⚠️ DEGEN PLAY';
  return '🚨 NGMI';
}

// ============================================
// RENDER RESULT
// ============================================
function renderResult(addr, chain, gp, dex, score, flags, creatorAddr) {
  const level  = riskLevel(score);
  const label  = riskLabel(score);
  const short  = `${addr.slice(0, 8)}…${addr.slice(-6)}`;

  const tokenName   = gp?.token_name   || gp?.metadata?.name   || dex?.baseToken?.name   || 'Unknown';
  const tokenSymbol = gp?.token_symbol || gp?.metadata?.symbol || dex?.baseToken?.symbol || '—';
  const chainLabel  = chain === 'solana' ? '🟣 Solana' : '🟡 BNB Chain';
  const chainCls    = chain === 'solana' ? 'sol' : 'bnb';

  const fmData     = radarTokenCache.get(addr.toLowerCase()) || null;
  // Expose fmData for share card
  if (fmData && currentInspect) currentInspect.fmData = fmData;
  const tokenImage = normImg(
    fmData?.img || fmData?.imageUrl || fmData?.logo || fmData?.image
    || dex?.info?.imageUrl
    || gp?.logo_url || gp?.token_logo
    || gp?.metadata?.image || gp?.metadata?.logoURI
    || null
  );
  const imgFallback = escHtml(tokenSymbol.charAt(0).toUpperCase());
  const imageHtml   = tokenImage
    ? `<img class="token-img" src="${escHtml(tokenImage)}" alt="${escHtml(tokenSymbol)}" onerror="imgErr(this,'${imgFallback}')" />`
    : `<div class="token-img-placeholder">${imgFallback}</div>`;

  // State for this inspection
  currentInspect = { addr, tokenName, tokenSymbol, score, label, chain, tokenImage, level };
  lastAIResult   = null; // reset until AI responds

  // Share text
  const shareUrl  = `${location.origin}${location.pathname}?addr=${encodeURIComponent(addr)}`;
  const shareText = `${tokenName} (${tokenSymbol}) — ${label.replace(/^[^ ]+ /, '')} ${score !== null ? score + '/100' : ''} · JAMCY Radar`;

  // Data items
  const items = [];
  if (gp) {
    items.push(dataItem('Honeypot',    gp.is_honeypot === '1'    ? 'Yes' : 'No', gp.is_honeypot === '1'    ? 'danger' : 'ok'));
    items.push(dataItem('Open Source', gp.is_open_source === '1' ? 'Yes' : 'No', gp.is_open_source === '1' ? 'ok' : 'warn'));
    items.push(dataItem('Mintable',    gp.is_mintable === '1'    ? 'Yes' : 'No', gp.is_mintable === '1'    ? 'warn' : 'ok'));
    items.push(dataItem('Proxy',       gp.is_proxy === '1'       ? 'Yes' : 'No', gp.is_proxy === '1'       ? 'warn' : 'ok'));
    items.push(dataItem('Buy Tax',     `${parseFloat(gp.buy_tax  || 0)}%`, parseFloat(gp.buy_tax  || 0) > 10 ? 'danger' : parseFloat(gp.buy_tax  || 0) > 0 ? 'warn' : 'ok'));
    items.push(dataItem('Sell Tax',    `${parseFloat(gp.sell_tax || 0)}%`, parseFloat(gp.sell_tax || 0) > 10 ? 'danger' : parseFloat(gp.sell_tax || 0) > 0 ? 'warn' : 'ok'));
    items.push(dataItem('Holders',     parseInt(gp.holder_count || 0).toLocaleString(), 'neutral'));
    items.push(dataItem('Creator %',   `${(parseFloat(gp.creator_percent || 0) * 100).toFixed(1)}%`, parseFloat(gp.creator_percent || 0) > 0.2 ? 'warn' : 'ok'));
  }
  if (dex) {
    items.push(dataItem('Liquidity',  formatUsd(dex.liquidity?.usd || 0), (dex.liquidity?.usd || 0) > 1000 ? 'ok' : 'warn'));
    items.push(dataItem('24h Volume', formatUsd(dex.volume?.h24 || 0), 'neutral'));
    if (dex.priceUsd) items.push(dataItem('Price', `$${parseFloat(dex.priceUsd).toFixed(8)}`, 'neutral'));
    if (dex.fdv)      items.push(dataItem('FDV',   formatUsd(dex.fdv), 'neutral'));
  }

  const dexLink      = chain === 'solana' ? `https://dexscreener.com/solana/${addr}` : `https://dexscreener.com/bsc/${addr}`;
  const explorerLink = chain === 'solana' ? `https://solscan.io/token/${addr}`       : `https://bscscan.com/token/${addr}`;
  const addrLow      = addr.toLowerCase();
  const isFourMeme   = chain === 'bnb' && (addrLow.endsWith('4444') || addrLow.startsWith('0x4444') || radarTokenCache.has(addrLow));
  const fourMemeLink = isFourMeme ? `https://four.meme/token/${addr}` : null;
  const isPumpFun    = chain === 'solana' && addr.toLowerCase().endsWith('pump');
  const pumpLink     = isPumpFun ? `https://pump.fun/coin/${addr}` : null;

  resultArea.innerHTML = `
    <div class="result-card">

      <div class="risk-header ${level}">
        <div class="risk-badge">
          <span class="risk-badge-label">${label}</span>
          <span class="risk-badge-sub">Contract safety · AI market analysis</span>
        </div>
        <div style="display:flex;align-items:center;gap:12px">
          <span class="risk-score">${score !== null ? score : '?'}<small style="font-size:0.6em;opacity:0.6">/100</small></span>
          <button class="share-btn" onclick="shareResult('${escHtml(shareText)}','${escHtml(shareUrl)}')" title="Copy share link">🔗 Link</button>
        </div>
      </div>

      <div class="token-info-bar">
        ${imageHtml}
        <span class="token-name">${escHtml(tokenName)}</span>
        <span class="token-symbol">${escHtml(tokenSymbol)}</span>
        <span class="token-chain-tag ${chainCls}">${chainLabel}</span>
        <span class="token-addr">${short}</span>
        <button class="copy-btn" title="Copy address"
          onclick="navigator.clipboard.writeText('${addr}').then(()=>{this.textContent='✅';setTimeout(()=>this.textContent='📋',1200)})">📋</button>
      </div>

      <div class="ai-summary-section">
        <div class="ai-summary-label">🤖 AI Analysis</div>
        <div class="ai-verdict-row" id="ai-verdict-row">
          <span class="ai-summary-text loading" id="ai-summary-text">Generating analysis…</span>
        </div>
        <div class="ai-reasoning-text" id="ai-reasoning-text" style="display:none"></div>
        <div class="ai-watch-row" id="ai-watch-row" style="display:none">
          <span class="ai-watch-icon">⚠️</span>
          <span class="ai-watch-text" id="ai-watch-text"></span>
        </div>
        <div class="ai-actions-row" id="ai-actions-row">
          <button class="share-card-btn" id="share-card-btn" onclick="openShareCard()" style="display:none" title="Generate shareable verdict card">
            📊 Share Card
          </button>
          <button class="watch-token-btn" id="watch-token-btn" onclick="toggleWatchToken()" title="Get alerted when this token graduates">
            🔔 Watch for Graduation
          </button>
        </div>
      </div>

      ${flags.length ? `
      <div class="flags-section">
        ${flags.map(f => `<span class="flag ${f.cls}">${escHtml(f.label)}</span>`).join('')}
      </div>` : ''}

      ${items.length ? `
      <div class="data-grid">
        ${items.join('')}
      </div>` : ''}

      ${chain === 'bnb' ? `
      <div class="creator-row" id="deployer-row">
        <span class="creator-label">Deployer</span>
        <span class="deployer-hint" id="deployer-addr-wrap">
          <a class="creator-addr" id="deployer-addr" href="#" target="_blank" rel="noopener" style="display:none">
            …<span class="creator-link-hint">↗ BscScan</span>
          </a>
          <span class="deployer-hint" id="deployer-loading">Looking up…</span>
        </span>
        <div class="deployer-history" id="deployer-history"></div>
      </div>` : ''}

      <div class="result-card-footer">
        <div style="display:flex;gap:12px;flex-wrap:wrap">
          ${fourMemeLink ? `<a href="${fourMemeLink}" target="_blank" rel="noopener">Four.meme ↗</a>` : ''}
          ${pumpLink     ? `<a href="${pumpLink}" target="_blank" rel="noopener">pump.fun ↗</a>`     : ''}
          <a href="${dexLink}" target="_blank" rel="noopener">DexScreener ↗</a>
          <a href="${explorerLink}" target="_blank" rel="noopener">${chain === 'solana' ? 'Solscan' : 'BscScan'} ↗</a>
        </div>
        <span>Informational only. Always DYOR.</span>
      </div>

    </div>
  `;
}

// ============================================
// SHARE
// ============================================
function shareResult(text, url) {
  const full = `${text}\n${url}`;
  if (navigator.share) {
    navigator.share({ title: 'JAMCY Radar', text, url }).catch(() => {});
  } else {
    navigator.clipboard.writeText(full).then(() => {
      const btn = document.querySelector('.share-btn');
      if (btn) { btn.textContent = '✅ Copied!'; setTimeout(() => btn.textContent = '↗ Share', 1500); }
    });
  }
}

function dataItem(label, value, status) {
  const cls = { ok: 'ok', warn: 'warn', danger: 'danger' }[status] || 'neutral';
  return `<div class="data-item">
    <span class="data-label">${label}</span>
    <span class="data-value ${cls}">${value}</span>
  </div>`;
}

// ============================================
// AI SUMMARY
// ============================================
async function requestAISummary(addr, chain, gp, dex, score, flags) {
  const summaryEl = document.getElementById('ai-summary-text');
  const watchRow  = document.getElementById('ai-watch-row');
  const watchEl   = document.getElementById('ai-watch-text');
  if (!summaryEl) return;

  // Cache hit — no API call
  const cached = aiCacheGet(addr);
  if (cached) {
    applyAIResult(summaryEl, watchRow, watchEl, cached);
    return;
  }

  const tokenName      = gp?.token_name || gp?.metadata?.name || dex?.baseToken?.name || 'this token';
  const tokenSymbol    = gp?.token_symbol || gp?.metadata?.symbol || dex?.baseToken?.symbol || '';
  // Keep danger flags always; filter out info-only bonding curve labels (but keep rug danger flags)
  const flagSummary    = flags.filter(f => f.cls === 'danger' || (f.cls !== 'info' && !f.label.includes('bonding curve'))).map(f => f.label).join(', ') || 'No major flags';
  const chainName      = chain === 'solana' ? 'Solana' : 'BNB Chain';
  // Bonding curve: flagged via holder check OR token is in Four.meme radar cache OR not yet on DEX
  const fmDataAI       = radarTokenCache.get(addr.toLowerCase());
  const curveCapAI     = fmDataAI?.cap != null ? parseFloat(fmDataAI.cap) : -1;
  const curveProgressAI = fmDataAI?.progress != null ? Math.round(parseFloat(fmDataAI.progress) * 100) : -1;
  const isPumpFunAI    = chain === 'solana' && addr.toLowerCase().endsWith('pump');
  const onBondingCurve = flags.some(f => f.label.includes('bonding curve'))
    || radarTokenCache.has(addr.toLowerCase())
    || (gp?.is_in_dex === '0' && chain === 'bnb')
    || isPumpFunAI;
  const isUnverified   = score === null;
  const liquidityUsd   = dex?.liquidity?.usd || 0;
  const volume24h      = dex?.volume?.h24 || 0;
  const isDexConfirmed = liquidityUsd > 0 || volume24h > 1000;

  const jsonInstruction = `Return ONLY valid JSON — no other text, no markdown:
{"verdict":"WAGMI","reason":"One sentence summary, max 25 words.","reasoning":"2-3 sentences explaining the key signals that drove this verdict. Mention specific data points like holder count, taxes, contract flags, or liquidity.","watch":"One specific concern to monitor, or Nothing major."}
verdict must be exactly one of: WAGMI, DYOR, DEGEN PLAY, NGMI
Score ≥ 80 → WAGMI. Score 60–79 → DYOR. Score 40–59 → DEGEN PLAY. Score < 40 → NGMI. Follow the score — do NOT override it with contract quality alone.`;

  let prompt;
  if (isUnverified && !isDexConfirmed) {
    prompt = `You are a crypto security analyst. ${jsonInstruction}

Token: ${tokenName} (${tokenSymbol}) on ${chainName}
Status: TOO NEW — GoPlus has not indexed this token yet.
Use verdict "DYOR". reason: explain it's too new to verify security data. watch: suggest rechecking in a few minutes.`;
  } else if (isUnverified && isDexConfirmed) {
    prompt = `You are a crypto security analyst. ${jsonInstruction}

Token: ${tokenName} (${tokenSymbol}) on ${chainName}
Status: TRADING LIVE — GoPlus security data is incomplete but DexScreener confirms real activity.
Liquidity: ${formatUsdShort(liquidityUsd)} | 24h Volume: ${formatUsdShort(volume24h)}
Price: $${dex?.priceUsd || '?'} | FDV: ${formatUsdShort(dex?.fdv || 0)}
Flags: ${flagSummary}

Contract safety data is unavailable/partial. Judge mainly on market metrics. Use DYOR unless volume/liquidity signals clear danger.`;
  } else if (onBondingCurve) {
    const isEmptyCurve   = curveCapAI === 0;
    const gpHolderCountAI = parseInt(gp?.holder_count || 0);
    const isSingleHolder  = gpHolderCountAI <= 1;
    const isFewHolders    = gpHolderCountAI <= 3;
    const isGhostLaunch   = curveCapAI >= 0 && curveCapAI < 1;
    const isMicroLiq      = curveCapAI >= 1 && curveCapAI < 20;
    const isStalled       = curveProgressAI === 0 && curveCapAI >= 0 && curveCapAI < 50 && gpHolderCountAI <= 3;
    const noFmData        = curveCapAI === -1;
    const rugSignal       = isEmptyCurve || (isSingleHolder && noFmData && !isPumpFunAI);
    const stalledNoData   = noFmData && isFewHolders && !isSingleHolder && !isPumpFunAI;

    let curveContext;
    if (rugSignal) {
      curveContext = 'CRITICAL: ' + (isEmptyCurve ? '$0.00 raised' : 'only 1 holder') + ' on bonding curve. Clean contract metrics are irrelevant — rugs can have clean code. Verdict MUST be NGMI.';
    } else if (stalledNoData) {
      curveContext = `WARNING: Only ${gpHolderCountAI} holders on bonding curve with no Four.meme data available. Likely stalled or ghost launch. Verdict should be DEGEN PLAY at best. Do NOT let clean contract metrics override this.`;
    } else if (isGhostLaunch) {
      curveContext = `CRITICAL: Only $${curveCapAI.toFixed(2)} raised — sub-$1 ghost launch with virtually no buyers. Score reflects this. Verdict should be NGMI or DEGEN PLAY.`;
    } else if (isStalled) {
      curveContext = `WARNING: Stalled launch — 0% curve progress, only $${curveCapAI.toFixed(2)} raised, ${gp?.holder_count||0} holders. No momentum. Verdict should be DEGEN PLAY at best.`;
    } else if (isMicroLiq) {
      curveContext = `NOTE: Micro liquidity — only $${curveCapAI.toFixed(2)} raised so far. Very early stage, high risk. $0 DEX liquidity is normal on bonding curve.`;
    } else if (isPumpFunAI) {
      const topHolderLine = gp?.holders?.[0]
        ? (() => {
            const a = (gp.holders[0].address || '').toLowerCase();
            const p = (parseFloat(gp.holders[0].percent || 0) * 100).toFixed(1);
            const isCurve = PUMPFUN_CONTRACTS.has(a);
            return isCurve
              ? `Top holder (${p}%) is the pump.fun bonding curve contract — NOT a whale, this is normal.`
              : `Top holder owns ${p}% — evaluate if this is a real whale risk.`;
          })()
        : '';
      curveContext = `NOTE: This is a pump.fun bonding curve token on Solana. $0 DEX/Raydium liquidity is COMPLETELY NORMAL — liquidity only appears after graduation. Closed source is normal for pump.fun tokens. ${topHolderLine} Judge on real holder distribution (excluding curve contract) and community momentum.`;
    } else {
      curveContext = 'NOTE: $0 DEX liquidity is NORMAL on bonding curve — do NOT flag it as a risk.';
    }

    const platform = isPumpFunAI ? 'pump.fun (Solana launchpad)' : 'Four.meme (BNB Chain launchpad)';
    prompt = `You are a crypto security analyst. ${jsonInstruction}

Token: ${tokenName} (${tokenSymbol}) on ${chainName}
Status: BONDING CURVE — pre-graduation on ${platform}
Score: ${score}/100 | Flags: ${flagSummary}
Holders: ${gp?.holder_count || 'unknown'} | Buy Tax: ${gp?.buy_tax || 0}% | Sell Tax: ${gp?.sell_tax || 0}%
Honeypot: ${gp?.is_honeypot === '1' ? 'YES' : 'No'} | Open Source: ${gp?.is_open_source === '1' ? 'Yes' : 'No'}
Bonding curve progress: ${curveProgressAI >= 0 ? curveProgressAI + '%' : 'unavailable'}
Bonding curve USD raised: ${curveCapAI >= 0 ? '$' + curveCapAI.toFixed(2) : 'unavailable'}

${curveContext}`;
  } else {
    prompt = `You are a crypto security analyst. ${jsonInstruction}

Token: ${tokenName} (${tokenSymbol}) on ${chainName}
Score: ${score}/100 | Flags: ${flagSummary}
Holders: ${gp?.holder_count || 'unknown'} | Buy Tax: ${gp?.buy_tax || 0}% | Sell Tax: ${gp?.sell_tax || 0}%
Honeypot: ${gp?.is_honeypot === '1' ? 'YES' : 'No'} | Open Source: ${gp?.is_open_source === '1' ? 'Yes' : 'No'}
Liquidity: ${formatUsd(liquidityUsd)}`;
  }

  try {
    const res = await fetch(AI_PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], max_tokens: 300, temperature: 0.2 }),
    });
    if (!res.ok) throw new Error(`AI proxy ${res.status}`);
    const json = await res.json();
    const raw  = (json.choices?.[0]?.message?.content || '').trim();

    let parsed;
    try {
      parsed = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/```$/, '').trim());
    } catch {
      summaryEl.classList.remove('loading');
      summaryEl.textContent = raw || 'AI analysis unavailable.';
      return;
    }

    aiCacheSet(addr, parsed);
    applyAIResult(summaryEl, watchRow, watchEl, parsed);

  } catch (err) {
    summaryEl.classList.remove('loading');
    summaryEl.textContent = 'AI analysis unavailable at this time.';
    console.warn('AI summary failed:', err.message || err);
  }
}

function applyAIResult(summaryEl, watchRow, watchEl, parsed) {
  const verdict    = (parsed.verdict   || 'DYOR').trim().toUpperCase();
  const reason     = (parsed.reason    || '').trim();
  const reasoning  = (parsed.reasoning || '').trim();
  const watch      = (parsed.watch     || '').trim();
  const verdictCls = verdict === 'WAGMI' ? 'safe' : verdict === 'NGMI' ? 'danger' : 'warn';

  summaryEl.classList.remove('loading');
  summaryEl.innerHTML = `<span class="ai-verdict-badge ${verdictCls}">${escHtml(verdict)}</span> ${escHtml(reason)}`;

  // Show extended reasoning if present
  const reasoningEl = document.getElementById('ai-reasoning-text');
  if (reasoningEl && reasoning) {
    reasoningEl.textContent  = reasoning;
    reasoningEl.style.display = 'block';
  }

  if (watch && watch.toLowerCase() !== 'nothing major' && watchRow && watchEl) {
    watchEl.textContent    = watch;
    watchRow.style.display = 'flex';
  }

  // Store for share card
  lastAIResult = { verdict, reason, reasoning, watch };
  updateShareCardBtn();
}

// ============================================
// LOADING / ERROR STATES
// ============================================
function showLoading() {
  resultArea.innerHTML = `
    <div class="result-loading">
      <div class="spinner"></div>
      <span>Scanning contract…</span>
    </div>`;
}
function showError(msg) {
  resultArea.innerHTML = `<div class="result-error">⚠️ ${escHtml(msg)}</div>`;
}

// ============================================
// LIVE RADAR
// ============================================
function toggleRadar() { radarOpen ? closeRadar() : openRadar(); }
function openRadar() {
  radarOpen = true;
  radarPanel.classList.add('open');
  radarPanel.setAttribute('aria-hidden', 'false');
  radarOverlay.classList.add('visible');
  radarToggle.classList.add('active');
  radarToggle.setAttribute('aria-expanded', 'true');
  prefs.radarOpen = true;
  savePrefs();
  startRadarPolling();
}
function closeRadar() {
  radarOpen = false;
  radarPanel.classList.remove('open');
  radarPanel.setAttribute('aria-hidden', 'true');
  radarOverlay.classList.remove('visible');
  radarToggle.classList.remove('active');
  radarToggle.setAttribute('aria-expanded', 'false');
  prefs.radarOpen = false;
  savePrefs();
  stopRadarPolling();
}
function startRadarPolling() { pollRadar(); radarTimer = setInterval(pollRadar, RADAR_POLL_MS); }
function stopRadarPolling()  { if (radarTimer) { clearInterval(radarTimer); radarTimer = null; } }

async function pollRadar() {
  try {
    const res = await fetch(`${FOURMEME_API}/public/token/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ type: 'NEW', listType: 'NOR', status: 'PUBLISH', sort: 'DESC', pageIndex: 1, pageSize: RADAR_PAGE_SIZE }),
    });
    if (!res.ok) throw new Error(`Four.meme API ${res.status}`);
    const json   = await res.json();
    const tokens = json.data?.list || json.data || [];

    radarLastUpd.textContent = `Updated ${formatLocalTime()}`;

    let newCount = 0;
    for (const token of tokens) {
      const addr = token.address || token.tokenAddress;
      if (!addr || seenTokens.has(addr)) continue;
      seenTokens.add(addr);
      newCount++;
      radarTokenCache.set(addr.toLowerCase(), token);
      prependRadarCard(token);
      autoScanRadarToken(addr, token);
    }

    const total = seenTokens.size;
    radarCountTxt.textContent = `${total} token${total !== 1 ? 's' : ''} tracked`;
    if (total > 0) radarEmpty.style.display = 'none';
    if (currentPage === 'race') renderRaceBoard();

  } catch (err) {
    console.warn('Radar poll failed:', err);
    radarCountTxt.textContent = 'Connection issue — retrying…';
  }
}

// ---- Radar filter ----
function applyRadarFilter() {
  document.querySelectorAll('.radar-card').forEach(card => {
    const tier = card.dataset.tier || 'pending';
    card.style.display = (radarFilter === 'all' || radarFilter === tier) ? '' : 'none';
  });
}

function prependRadarCard(token) {
  const addr     = token.address || token.tokenAddress || '';
  const name     = token.name    || 'Unknown';
  const symbol   = token.symbol  || '?';
  const progress = token.progress != null ? Math.min(100, Math.round(parseFloat(token.progress) * 100)) : null;
  // FIX: cap != null check so numeric 0 is not treated as falsy
  const cap      = token.cap != null ? parseFloat(token.cap) : null;
  const hold     = parseInt(token.hold || token.holders || 0);
  const age      = token.createTime ? timeAgo(token.createTime) : '';
  const short    = addr ? `${addr.slice(0,6)}…${addr.slice(-4)}` : '';
  const logo     = normImg(token.img || token.logo || token.image || token.imageUrl || token.iconUrl || null);
  const logoFb   = escHtml(symbol.charAt(0).toUpperCase());
  const isGrad   = progress !== null && progress >= 80;
  const isRug    = cap === 0 && hold <= 1;

  const card = document.createElement('div');
  card.className    = 'radar-card';
  card.dataset.addr = addr;
  card.dataset.tier = 'pending';

  card.innerHTML = `
    <div class="radar-card-top">
      <div class="radar-card-left">
        ${logo
          ? `<img class="radar-token-img" src="${escHtml(logo)}" alt="${escHtml(symbol)}" onerror="imgErr(this,'${logoFb}')" />`
          : `<div class="radar-token-img-placeholder">${logoFb}</div>`
        }
        <div>
          <div class="radar-card-name">${escHtml(name)} ${isGrad ? '<span class="grad-badge">🎓</span>' : ''} ${isRug ? '<span class="rug-badge">🚨 RUG</span>' : ''}</div>
          <div class="radar-card-symbol">${escHtml(symbol)} · ${short}</div>
        </div>
      </div>
      <span class="radar-card-badge pending" id="badge-${escId(addr)}">Scanning…</span>
    </div>
    <div class="radar-card-bottom">
      <span class="radar-card-meta">🕐 ${age}</span>
      ${cap != null ? `<span class="radar-card-meta">💰 ${formatUsd(cap)}</span>` : ''}
      ${progress != null ? `
        <div class="bonding-bar ${isGrad ? 'near-grad' : ''}" title="Bonding curve: ${progress}%">
          <div class="bonding-bar-fill" style="width:${progress}%"></div>
        </div>
        <span class="radar-card-meta">${progress}%</span>
      ` : ''}
    </div>
  `;

  card.addEventListener('click', () => {
    addrInput.value = addr;
    updateChainHint(addr);
    addToHistory(addr, 'bnb');
    showPage('inspector');
    runInspect(addr, 'bnb');
    closeRadar();
  });

  radarFeed.insertBefore(card, radarFeed.firstChild);
  while (radarFeed.children.length > 51) radarFeed.removeChild(radarFeed.lastChild);
}

async function autoScanRadarToken(addr, token) {
  gpEnqueue(async () => {
    try {
      const gp = await fetchGoPlus(addr, 'bnb');
      if (!gp) return;
      const { score, flags } = calcRisk(gp, 'bnb', addr, null);
      const level      = riskLevel(score);
      const label      = riskLabel(score).replace(/^\S+ /, '');
      const badgeEl    = document.getElementById(`badge-${escId(addr)}`);
      const card       = badgeEl?.closest('.radar-card');
      if (badgeEl) {
        badgeEl.className   = `radar-card-badge ${level}`;
        badgeEl.textContent = score !== null ? `${score}/100 · ${label}` : '⏳ Unverified';
      }
      if (card) {
        card.dataset.tier = level;
        if (radarFilter !== 'all' && radarFilter !== level) card.style.display = 'none';
      }
      // Feed confirmed rugs into Graveyard
      if (isDeadToken(flags)) {
        const cachedToken = radarTokenCache.get(addr.toLowerCase()) || token;
        const raised = cachedToken?.cap != null ? parseFloat(cachedToken.cap) : 0;
        addToGraveyard(addr, cachedToken, raised);
        if (currentPage === 'race') renderRaceBoard();
      }

      // Feed into stats — thresholds must match riskLabel()
      if (score !== null) statsScores.push(score);
      if (score === null)   statsVerdicts.unverified++;
      else if (score >= 80) statsVerdicts.safe++;   // WAGMI
      else if (score >= 60) statsVerdicts.warn++;   // DYOR
      else if (score >= 40) statsVerdicts.degen++;  // DEGEN PLAY
      else                  statsVerdicts.danger++;  // NGMI

      // Track deployer for stats — use GoPlus creator_address as fallback
      const cachedTk  = radarTokenCache.get(addr.toLowerCase()) || token;
      const dep = cachedTk?.userAddress || gp?.creator_address || null;
      if (dep) {
        if (!statsDeployers[dep]) statsDeployers[dep] = { launches: 0, rugs: 0, grads: 0 };
        statsDeployers[dep].launches++;
        if (isDeadToken(flags)) statsDeployers[dep].rugs++;
        const prog = cachedTk?.progress != null ? parseFloat(cachedTk.progress) : 0;
        if (prog >= 1 || gp?.is_in_dex === '1') statsDeployers[dep].grads++;
      }

      if (currentPage === 'stats') renderStats();

      // Trigger narrative trends after enough data
      maybeRunNarrativeTrends();
    } catch (e) {
      if (e.message === 'rate_limited') {
        // Re-queue after a longer backoff
        await new Promise(r => setTimeout(r, 3000));
        gpEnqueue(async () => { await autoScanRadarToken(addr, token); });
      }
    }
  });
}

// ============================================
// PAGE NAVIGATION
// ============================================
function showPage(page) {
  currentPage = page;
  ['inspector','race','graveyard','stats','trends','certify','game','runner'].forEach(p => {
    const el = document.getElementById(`page-${p}`);
    if (el) el.style.display = p === page ? '' : 'none';
  });
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  if (page === 'race')      renderRaceBoard();
  if (page === 'graveyard') renderGraveyard();
  if (page === 'stats')     renderStats();
  if (page === 'trends')    renderTrendsPage();
  if (page === 'certify')   resetCertPage();
  if (page === 'game')      resetGamePage();
  if (page === 'runner')    runnerOnShow();
}

// ============================================
// DEPLOYER SECTION — UPGRADED
// ============================================
async function fetchDeployerSection(tokenAddr) {
  const wrapEl    = document.getElementById('deployer-addr-wrap');
  const deployerEl = document.getElementById('deployer-addr');
  const loadingEl  = document.getElementById('deployer-loading');
  const historyEl  = document.getElementById('deployer-history');

  try {
    // Resolve deployer wallet
    let cached = radarTokenCache.get(tokenAddr.toLowerCase());
    if (!cached) {
      await fetchFourMemeByAddr(tokenAddr);
      cached = radarTokenCache.get(tokenAddr.toLowerCase());
    }
    let userAddress = cached?.userAddress || null;
    if (!userAddress) {
      try {
        const gp = await fetchGoPlus(tokenAddr, 'bnb');
        userAddress = gp?.creator_address || null;
      } catch { /* silent */ }
    }

    if (!userAddress) {
      if (loadingEl) loadingEl.textContent = 'Deployer unknown.';
      return;
    }

    if (loadingEl) loadingEl.style.display = 'none';
    if (deployerEl) {
      deployerEl.href        = `https://bscscan.com/address/${userAddress}#tokentxns`;
      deployerEl.textContent = `${userAddress.slice(0,10)}…${userAddress.slice(-8)}`;
      deployerEl.style.display = 'flex';
    }

    // Fetch all launches from this deployer
    if (historyEl) historyEl.innerHTML = '<span class="deployer-hint">Loading launch history…</span>';

    const res = await fetch(`${FOURMEME_API}/public/token/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ userAddress, pageIndex: 1, pageSize: 20, sort: 'DESC' }),
    });
    if (!res.ok) throw new Error('search failed');
    const json   = await res.json();
    const allTokens = json.data?.list || json.data || [];
    const otherTokens = allTokens.filter(
      t => (t.address || t.tokenAddress || '').toLowerCase() !== tokenAddr.toLowerCase()
    );

    // Cache them
    allTokens.forEach(t => {
      const a = (t.address || t.tokenAddress || '').toLowerCase();
      if (a && !radarTokenCache.has(a)) radarTokenCache.set(a, t);
    });

    if (!historyEl) return;

    if (total === 0) {
      historyEl.innerHTML = '<span class="deployer-hint">First launch from this deployer.</span>';
      return;
    }

    // Render immediately with Four.meme data, then upgrade async with GoPlus
    renderDeployerStats(historyEl, tokenAddr, otherTokens);

    // Queue GoPlus scans for tokens we haven't scanned yet (max 6 to avoid rate limits)
    const unscanned = otherTokens
      .filter(t => {
        const ca = (t.address || t.tokenAddress || '').toLowerCase();
        return ca && !sessionStorage.getItem(`jamcy_gp_dep_${ca}`);
      })
      .slice(0, 6);

    if (unscanned.length > 0) {
      scanDeployerTokens(historyEl, tokenAddr, otherTokens, unscanned);
    }
  } catch {
    if (historyEl) historyEl.innerHTML = '<span class="deployer-hint">Could not load launch history.</span>';
  }
}

// ---- Deployer stats renderer (called immediately + after GoPlus upgrade) ----
function renderDeployerStats(historyEl, currentTokenAddr, tokens) {
  const total     = tokens.length;
  const graduated = tokens.filter(t => parseFloat(t.progress || 0) >= 1 || t.is_in_dex === '1').length;

  // Rug detection: Four.meme fields + graveyard cross-ref + GoPlus cached results
  const rugged = tokens.filter(t => {
    const ca  = (t.address || t.tokenAddress || '').toLowerCase();
    // Already confirmed in graveyard?
    if (graveyardEntries.some(g => g.addr.toLowerCase() === ca)) return true;
    // Four.meme signals
    const cap  = t.cap  != null ? parseFloat(t.cap)  : -1;
    const hold = t.hold != null ? parseInt(t.hold)   :
                 t.holders != null ? parseInt(t.holders) : -1;
    if (cap  === 0)  return true;
    if (hold === 1)  return true;
    // GoPlus cached scan result
    const gpResult = sessionStorage.getItem(`jamcy_gp_dep_${ca}`);
    if (gpResult === 'rug') return true;
    return false;
  }).length;

  const rugRate  = total > 0 ? Math.round((rugged / total) * 100) : 0;
  const rugCls   = rugRate >= 50 ? 'danger' : rugRate >= 20 ? 'warn' : 'ok';
  const rugLabel = rugRate >= 50 ? '🚨 Serial rugger' : rugRate >= 20 ? '⚠️ Risky deployer' : '✅ Clean history';

  historyEl.innerHTML = `
    <div class="deployer-stats">
      <span class="dep-stat">🚀 <strong>${total}</strong> launch${total !== 1 ? 'es' : ''}</span>
      <span class="dep-stat grad">🎓 <strong>${graduated}</strong> grad</span>
      <span class="dep-stat rug">💥 <strong>${rugged}</strong> rug${rugged !== 1 ? 's' : ''}</span>
      <span class="dep-stat ${rugCls}">${rugLabel} (${rugRate}%)</span>
    </div>
    <div class="deployer-chips">
      <span class="deployer-hint">Other launches:</span>
      ${tokens.slice(0, 8).map(t => {
        const ca   = t.address || t.tokenAddress || '';
        const caL  = ca.toLowerCase();
        const sym  = escHtml(t.symbol || '?');
        const cap  = t.cap  != null ? parseFloat(t.cap)  : -1;
        const hold = t.hold != null ? parseInt(t.hold)   :
                     t.holders != null ? parseInt(t.holders) : -1;
        const prog = parseFloat(t.progress || 0);
        const inGrave  = graveyardEntries.some(g => g.addr.toLowerCase() === caL);
        const gpResult = sessionStorage.getItem(`jamcy_gp_dep_${caL}`);
        const isRugged = inGrave || cap === 0 || hold === 1 || gpResult === 'rug';
        const isGrad   = prog >= 1;
        const chipCls  = isRugged ? 'rug' : isGrad ? 'grad' : '';
        const chipIcon = isRugged ? '💥' : isGrad ? '🎓' : '';
        return `<button class="deployer-chip ${chipCls}"
          onclick="addrInput.value='${ca}';updateChainHint('${ca}');addToHistory('${ca}','bnb');runInspect('${ca}','bnb');showPage('inspector')">${chipIcon}${sym}</button>`;
      }).join('')}
    </div>
  `;
}

// ---- Async GoPlus scan for deployer's other tokens (upgrades the display) ----
async function scanDeployerTokens(historyEl, currentTokenAddr, allTokens, toScan) {
  for (const t of toScan) {
    const ca = (t.address || t.tokenAddress || '').toLowerCase();
    if (!ca) continue;
    await new Promise(r => setTimeout(r, 1500)); // respect GoPlus rate limit
    try {
      const gp = await fetchGoPlus(ca, 'bnb');
      if (!gp) continue;
      const holderCount = parseInt(gp.holder_count || 0);
      const isHoneypot  = gp.is_honeypot === '1';
      const isRug = holderCount <= 1 || isHoneypot;
      // Cache result in sessionStorage (per-session, no expiry needed)
      sessionStorage.setItem(`jamcy_gp_dep_${ca}`, isRug ? 'rug' : 'ok');
      // If confirmed rug, add to graveyard
      if (isRug) addToGraveyard(ca, t, t.cap != null ? parseFloat(t.cap) : 0);
    } catch { /* silent */ }
    // Re-render with updated data
    if (document.getElementById('deployer-history') === historyEl) {
      renderDeployerStats(historyEl, currentTokenAddr, allTokens);
    }
  }
}

// ============================================
// GRADUATION RACE
// ============================================
function renderRaceBoard() {
  const board = document.getElementById('race-board');
  if (!board) return;

  // Pull all tokens from radar cache that have progress data
  const tokens = [];
  for (const [addr, token] of radarTokenCache.entries()) {
    const progress = token.progress != null ? Math.round(parseFloat(token.progress) * 100) : null;
    if (progress === null) continue;
    const cap    = token.cap != null ? parseFloat(token.cap) : null;
    const hold   = parseInt(token.hold || token.holders || 0);
    const isRug  = cap === 0 && hold <= 1;
    tokens.push({ addr, token, progress, cap, hold, isRug });
  }

  // Update stats bar
  const totalCount = radarTokenCache.size;
  const gradCount  = tokens.filter(t => t.progress >= 100).length;
  const rugCount   = tokens.filter(t => t.isRug).length;
  document.getElementById('race-total').textContent     = `${totalCount} token${totalCount !== 1 ? 's' : ''} tracked`;
  document.getElementById('race-grad-count').textContent = `🎓 ${gradCount} graduated`;
  document.getElementById('race-rug-count').textContent  = `💥 ${rugCount} rugged`;

  if (tokens.length === 0) {
    board.innerHTML = `<div class="page-empty">
      <div class="page-empty-icon">📡</div>
      <p>Open Live Radar to start tracking tokens.</p>
      <button class="open-radar-btn" onclick="openRadar()">Open Live Radar</button>
    </div>`;
    return;
  }

  // Sort: graduated first (by cap desc), then by progress desc
  tokens.sort((a, b) => {
    if (a.progress >= 100 && b.progress < 100) return -1;
    if (b.progress >= 100 && a.progress < 100) return 1;
    return b.progress - a.progress;
  });

  board.innerHTML = tokens.slice(0, 50).map((item, i) => {
    const { addr, token, progress, cap, isRug } = item;
    const name   = token.name   || 'Unknown';
    const symbol = token.symbol || '?';
    const age    = token.createTime ? timeAgo(token.createTime) : '';
    const logo   = normImg(token.img || token.logo || token.imageUrl || null);
    const logoFb = escHtml(symbol.charAt(0).toUpperCase());
    const isGrad = progress >= 100;
    const short  = `${addr.slice(0,6)}…${addr.slice(-4)}`;
    const rankCls = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
    const rankEmoji = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`;
    const barCls = isGrad ? 'graduated' : progress >= 80 ? 'near-grad' : progress >= 50 ? 'mid' : '';

    return `
      <div class="race-row ${rankCls} ${isRug ? 'rugged' : ''} ${isGrad ? 'is-grad' : ''}" onclick="addrInput.value='${addr}';updateChainHint('${addr}');addToHistory('${addr}','bnb');runInspect('${addr}','bnb');showPage('inspector')">
        <span class="race-rank">${rankEmoji}</span>
        <div class="race-token-img-wrap">
          ${logo
            ? `<img class="race-token-img" src="${escHtml(logo)}" alt="${escHtml(symbol)}" onerror="imgErr(this,'${logoFb}')" />`
            : `<div class="race-token-img-placeholder">${logoFb}</div>`
          }
        </div>
        <div class="race-token-info">
          <div class="race-token-name">
            ${escHtml(name)}
            ${isGrad ? '<span class="grad-badge">🎓 Graduated</span>' : ''}
            ${isRug  ? '<span class="rug-badge">🚨 RUG</span>' : ''}
          </div>
          <div class="race-token-meta">${escHtml(symbol)} · ${short} · ${age}</div>
        </div>
        <div class="race-bar-col">
          <div class="race-bar-wrap">
            <div class="race-bar ${barCls}" style="width:${Math.min(100,progress)}%"></div>
          </div>
          <span class="race-bar-pct">${isGrad ? '✅ 100%' : progress + '%'}</span>
        </div>
        <div class="race-cap">${cap != null ? formatUsd(cap) : '—'}</div>
      </div>
    `;
  }).join('');
}

// ============================================
// RUG GRAVEYARD
// ============================================
function addToGraveyard(addr, token, raised) {
  // Avoid duplicates
  if (graveyardEntries.some(e => e.addr.toLowerCase() === addr.toLowerCase())) return;
  const entry = {
    addr,
    name:        token.name   || 'Unknown',
    symbol:      token.symbol || '?',
    logo:        normImg(token.img || token.logo || token.imageUrl || null),
    detectedAt:  Date.now(),
    raised:      raised || 0,
    cap:         token.cap != null ? parseFloat(token.cap) : 0,
  };
  graveyardEntries.unshift(entry);
  totalRaised += entry.raised;

  // Update graveyard stats if page is visible
  if (currentPage === 'graveyard') renderGraveyard();

  // Update count badge on nav btn
  const navBtn = document.querySelector('.nav-btn[data-page="graveyard"]');
  if (navBtn) navBtn.dataset.count = graveyardEntries.length;
  updateGraveyardBadge();
}

function updateGraveyardBadge() {
  const btn = document.querySelector('.nav-btn[data-page="graveyard"]');
  if (!btn) return;
  const count = graveyardEntries.length;
  let badge = btn.querySelector('.nav-badge');
  if (count === 0) { badge?.remove(); return; }
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'nav-badge';
    btn.appendChild(badge);
  }
  badge.textContent = count;
}

function renderGraveyard() {
  const board     = document.getElementById('graveyard-board');
  const emptyEl   = document.getElementById('graveyard-empty');
  const countEl   = document.getElementById('graveyard-count');
  const lostEl    = document.getElementById('graveyard-lost');
  if (!board) return;

  countEl.textContent = `💀 ${graveyardEntries.length} confirmed rug${graveyardEntries.length !== 1 ? 's' : ''}`;
  lostEl.textContent  = `💸 ~${formatUsd(totalRaised)} raised before death`;

  if (graveyardEntries.length === 0) {
    board.innerHTML = `<div class="page-empty" id="graveyard-empty">
      <div class="page-empty-icon">🍿</div>
      <p>No rugs detected yet this session.</p>
      <p style="font-size:0.8rem;color:var(--text-dim);margin-top:4px">Open Live Radar to start scanning.</p>
      <button class="open-radar-btn" onclick="openRadar()">Open Live Radar</button>
    </div>`;
    return;
  }

  board.innerHTML = graveyardEntries.map(entry => {
    const logoFb = escHtml(entry.symbol.charAt(0).toUpperCase());
    const age    = timeAgo(entry.detectedAt);
    const dexUrl = `https://dexscreener.com/bsc/${entry.addr}`;
    const bscUrl = `https://bscscan.com/token/${entry.addr}`;

    return `
      <div class="grave-row">
        <div class="grave-left">
          ${entry.logo
            ? `<img class="grave-token-img" src="${escHtml(entry.logo)}" alt="${escHtml(entry.symbol)}" onerror="imgErr(this,'${logoFb}')" />`
            : `<div class="grave-token-img-placeholder">${logoFb}</div>`
          }
          <div class="grave-token-info">
            <div class="grave-token-name">💀 ${escHtml(entry.name)} <span class="grave-symbol">(${escHtml(entry.symbol)})</span></div>
            <div class="grave-token-meta">
              Detected ${age} ·
              ${entry.cap > 0 ? `Raised ${formatUsd(entry.cap)} before death` : 'Raised $0 — never had buyers'}
            </div>
          </div>
        </div>
        <div class="grave-right">
          <button class="grave-inspect-btn" onclick="addrInput.value='${entry.addr}';updateChainHint('${entry.addr}');addToHistory('${entry.addr}','bnb');runInspect('${entry.addr}','bnb');showPage('inspector')">
            Inspect
          </button>
          <a class="grave-link" href="${bscUrl}" target="_blank" rel="noopener">BscScan ↗</a>
        </div>
      </div>
    `;
  }).join('');
}

// ============================================
// LIVE STATS
// ============================================
function renderStats() {
  const total = seenTokens.size;
  const scored = statsScores.length;
  const avg = scored > 0 ? Math.round(statsScores.reduce((a,b) => a+b, 0) / scored) : null;
  const gradCount = Array.from(radarTokenCache.values()).filter(t => parseFloat(t.progress||0) >= 1).length;
  const rugCount  = graveyardEntries.length;
  const gradRate  = total > 0 ? Math.round((gradCount / total) * 100) : null;
  const rugRate   = total > 0 ? Math.round((rugCount  / total) * 100) : null;

  // Stat cards
  el('stat-total').textContent   = total;
  el('stat-rate').textContent    = total > 0 ? `${total} tokens tracked this session` : 'Open Live Radar to start';
  el('stat-grad-rate').textContent = gradRate !== null ? gradRate + '%' : '—';
  el('stat-grad-sub').textContent  = `${gradCount} of ${total} tokens`;
  el('stat-rug-rate').textContent  = rugRate !== null ? rugRate + '%' : '—';
  el('stat-rug-sub').textContent   = `${rugCount} confirmed rug${rugCount !== 1 ? 's' : ''}`;
  el('stat-avg-score').textContent = avg !== null ? avg + '/100' : '—';

  // Avg score colour
  const avgEl = el('stat-avg-score');
  avgEl.className = 'stat-card-value ' + (avg === null ? '' : avg >= 80 ? 'safe' : avg >= 60 ? 'warn' : 'danger');

  // Verdict bars
  const vTotal = Object.values(statsVerdicts).reduce((a,b)=>a+b,0) || 1;
  const setBar = (id, countId, count) => {
    el(id).style.width    = Math.round((count/vTotal)*100) + '%';
    el(countId).textContent = count;
  };
  setBar('vb-wagmi',      'vc-wagmi',      statsVerdicts.safe);
  setBar('vb-dyor',       'vc-dyor',       statsVerdicts.warn);
  setBar('vb-degen',      'vc-degen',      statsVerdicts.degen);
  setBar('vb-ngmi',       'vc-ngmi',       statsVerdicts.danger);
  setBar('vb-unverified', 'vc-unverified', statsVerdicts.unverified);

  // Score distribution
  const s80 = statsScores.filter(s=>s>=80).length;
  const s60 = statsScores.filter(s=>s>=60&&s<80).length;
  const s40 = statsScores.filter(s=>s>=40&&s<60).length;
  const s0  = statsScores.filter(s=>s<40).length;
  const sMax = Math.max(s80,s60,s40,s0,1);
  const setSD = (barId, countId, count) => {
    el(barId).style.width = Math.round((count/sMax)*100) + '%';
    el(countId).textContent = count;
  };
  setSD('sd-80','sc-80',s80);
  setSD('sd-60','sc-60',s60);
  setSD('sd-40','sc-40',s40);
  setSD('sd-0', 'sc-0', s0);

  // Top deployers
  const depEl = el('top-deployers');
  const deps = Object.entries(statsDeployers)
    .map(([addr, d]) => ({ addr, ...d }))
    .sort((a,b) => b.launches - a.launches)
    .slice(0, 8);
  if (deps.length === 0) {
    depEl.innerHTML = '<p class="stats-empty-hint">Scan tokens to populate.</p>';
  } else {
    depEl.innerHTML = deps.map(d => {
      const rugRate = d.launches > 0 ? Math.round((d.rugs/d.launches)*100) : 0;
      const cls = rugRate >= 50 ? 'danger' : rugRate >= 20 ? 'warn' : 'ok';
      return `<div class="dep-row">
        <a class="dep-addr" href="https://bscscan.com/address/${d.addr}" target="_blank" rel="noopener">${d.addr.slice(0,8)}…${d.addr.slice(-6)}</a>
        <span class="dep-badges">
          <span class="dep-badge">🚀 ${d.launches}</span>
          <span class="dep-badge grad">🎓 ${d.grads}</span>
          <span class="dep-badge rug">💥 ${d.rugs}</span>
          <span class="dep-badge ${cls}">${rugRate}% rug</span>
        </span>
      </div>`;
    }).join('');
  }
}
function el(id) { return document.getElementById(id); }

// ============================================
// NARRATIVE TRENDS
// ============================================
function maybeRunNarrativeTrends() {
  if (trendsRunning) return;
  if (seenTokens.size < TRENDS_MIN_TOKENS) return;
  if (Date.now() - trendsLastRun < TRENDS_INTERVAL_MS) return;
  runNarrativeTrends();
}

async function runNarrativeTrends() {
  trendsRunning = true;
  trendsLastRun = Date.now();

  // Update status bar
  const statusEl = el('trends-status-text');
  const lastEl   = el('trends-last-run');
  if (statusEl) statusEl.textContent = '🧠 AI analysing current narratives…';

  // Build token list for AI: name, symbol, progress, score
  const tokens = [];
  for (const [addr, token] of radarTokenCache.entries()) {
    const name    = token.name   || token.symbol || addr.slice(0,8);
    const symbol  = token.symbol || '?';
    const progress = token.progress != null ? Math.round(parseFloat(token.progress)*100) : 0;
    const cap     = token.cap != null ? parseFloat(token.cap) : 0;
    tokens.push({ name, symbol, progress, cap });
  }

  // Sample up to 60 tokens for the prompt (keep token usage reasonable)
  const sample = tokens
    .sort((a,b) => b.cap - a.cap) // most-funded first = most real signal
    .slice(0, 60);

  const tokenList = sample.map(t =>
    `${t.name} (${t.symbol}) — curve: ${t.progress}%, raised: $${t.cap.toFixed(0)}`
  ).join('\n');

  const prompt = `You are a crypto market analyst for BNB Chain meme tokens.

Tokens launched on Four.meme right now:
${tokenList}

Group into 4-6 narrative clusters (e.g. "AI", "Dogs", "Political", "Anime", "Food", "China", "Celebrity").

Return ONLY this JSON, no markdown:
{"summary":"Max 15 words on dominant narrative.","clusters":[{"theme":"2-3 words","emoji":"1 emoji","count":5,"examples":["SYM1","SYM2"],"avgProgress":34,"insight":"Max 12 words on momentum."}]}

Rules: 4-6 clusters only. examples: max 3 symbols. insight: max 12 words. Keep all strings SHORT.`;

  try {
    const res = await fetch(AI_PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], max_tokens: 1000, temperature: 0.3 }),
    });
    if (!res.ok) throw new Error(`AI proxy ${res.status}`);
    const json = await res.json();
    const raw  = (json.choices?.[0]?.message?.content || '').trim();
    // Extract JSON robustly — handle truncated responses by finding the outermost { }
    const jsonStr = extractJson(raw);
    trendsData = JSON.parse(jsonStr);
    if (lastEl) lastEl.textContent = `Last updated ${formatLocalTime()}`;
    if (statusEl) statusEl.textContent = `🧠 AI analysis complete · ${sample.length} tokens clustered`;
    if (currentPage === 'trends') renderTrendsPage();
  } catch (err) {
    console.warn('Narrative trends failed:', err);
    if (statusEl) statusEl.textContent = 'AI analysis unavailable — will retry on next poll.';
  } finally {
    trendsRunning = false;
  }
}

function renderTrendsPage() {
  const board = el('trends-board');
  if (!board) return;

  const total = seenTokens.size;
  const statusEl = el('trends-status-text');

  if (total < TRENDS_MIN_TOKENS) {
    board.innerHTML = `<div class="page-empty">
      <div class="page-empty-icon">🧠</div>
      <p>Need ${TRENDS_MIN_TOKENS} tokens to analyse — ${total} tracked so far.</p>
      <p style="font-size:0.8rem;color:var(--text-dim);margin-top:4px">AI runs automatically once enough tokens are scanned.</p>
      <button class="open-radar-btn" onclick="openRadar()">Open Live Radar</button>
    </div>`;
    return;
  }

  if (!trendsData) {
    board.innerHTML = `<div class="page-empty">
      <div class="page-empty-icon">⌛</div>
      <p>AI analysis running…</p>
    </div>`;
    if (!trendsRunning) runNarrativeTrends();
    return;
  }

  const { summary, clusters } = trendsData;
  const maxCount = Math.max(...clusters.map(c=>c.count), 1);

  board.innerHTML = `
    <div class="trends-summary">${escHtml(summary)}</div>
    <div class="trends-clusters">
      ${clusters.map(c => {
        const barW    = Math.round((c.count / maxCount) * 100);
        const prog    = c.avgProgress || 0;
        const progCls = prog >= 80 ? 'near-grad' : prog >= 50 ? 'mid' : '';
        const examples = (c.examples || []).slice(0,4).map(e => `<span class="trend-example">${escHtml(e)}</span>`).join('');
        return `
          <div class="trend-cluster-card">
            <div class="tc-header">
              <span class="tc-emoji">${escHtml(c.emoji || '📊')}</span>
              <span class="tc-theme">${escHtml(c.theme)}</span>
              <span class="tc-count">${c.count} token${c.count!==1?'s':''}</span>
            </div>
            <div class="tc-bar-row">
              <div class="tc-bar-track">
                <div class="tc-bar-fill" style="width:${barW}%"></div>
              </div>
            </div>
            <div class="tc-meta">
              <span class="tc-progress ${progCls}">Avg curve: ${prog}%</span>
              <div class="tc-examples">${examples}</div>
            </div>
            <div class="tc-insight">${escHtml(c.insight)}</div>
          </div>
        `;
      }).join('')}
    </div>
    <div class="trends-refresh-row">
      <button class="trends-refresh-btn" onclick="runNarrativeTrends()" ${trendsRunning ? 'disabled' : ''}>
        ${trendsRunning ? '⏳ Analysing…' : '🔄 Re-run Analysis'}
      </button>
      <span style="font-size:0.72rem;color:var(--text-dim)">Auto-refreshes every 5 min while radar is open</span>
    </div>
  `;
}

// ============================================
// WATCH LIST — Graduation Alerts
// ============================================
function loadWatchList() {
  try { return JSON.parse(localStorage.getItem(WATCH_KEY)) || []; }
  catch { return []; }
}
function saveWatchList() {
  try { localStorage.setItem(WATCH_KEY, JSON.stringify(watchList)); } catch {}
}
function isWatched(addr) {
  return watchList.some(w => w.addr.toLowerCase() === addr.toLowerCase());
}
function toggleWatchToken() {
  if (!currentInspect) return;
  const { addr, tokenName, tokenSymbol } = currentInspect;
  if (isWatched(addr)) {
    watchList = watchList.filter(w => w.addr.toLowerCase() !== addr.toLowerCase());
    showToast(`Removed ${tokenSymbol} from watch list`);
  } else {
    watchList.unshift({ addr, tokenName, tokenSymbol, addedAt: Date.now() });
    if (watchList.length > 20) watchList.length = 20;
    showToast(`🔔 Watching ${tokenSymbol} for graduation`);
    requestBrowserNotificationPermission();
  }
  saveWatchList();
  updateWatchTokenBtn(addr);
  restartGradWatcher();
}
function updateWatchTokenBtn(addr) {
  const btn = document.getElementById('watch-token-btn');
  if (!btn || !addr) return;
  const watching = isWatched(addr);
  btn.textContent = watching ? '✅ Watching Graduation' : '🔔 Watch for Graduation';
  btn.classList.toggle('watching', watching);
}
function restartGradWatcher() {
  if (gradWatchTimer) clearInterval(gradWatchTimer);
  if (watchList.length === 0) return;
  // Poll every 45s — check bonding curves for graduation (progress ≥ 100% or is_in_dex === '1')
  gradWatchTimer = setInterval(checkGradAlerts, 45_000);
}
async function checkGradAlerts() {
  if (watchList.length === 0) return;
  const toCheck = [...watchList];
  for (const item of toCheck) {
    try {
      const gp = await fetchGoPlus(item.addr, 'bnb');
      const graduated = gp?.is_in_dex === '1';

      // Also check Four.meme API for progress
      let progress = null;
      if (!graduated) {
        await fetchFourMemeByAddr(item.addr);
        const fmData = radarTokenCache.get(item.addr.toLowerCase());
      if (fmData?.progress != null) {
          progress = Math.round(parseFloat(fmData.progress) * 100);
        }
      }

      if (graduated || (progress !== null && progress >= 100)) {
        // Graduated! Notify and remove from watch list
        notifyGraduation(item);
        watchList = watchList.filter(w => w.addr.toLowerCase() !== item.addr.toLowerCase());
        saveWatchList();
        if (currentInspect?.addr?.toLowerCase() === item.addr.toLowerCase()) {
          updateWatchTokenBtn(item.addr);
        }
      } else if (progress !== null && progress >= 80) {
        // Near graduation — soft alert
        notifyNearGraduation(item, progress);
      }
    } catch { /* silent */ }
    // Small pause between checks
    await new Promise(r => setTimeout(r, 2000));
  }
}
function notifyGraduation(item) {
  const msg = `🎓 ${item.tokenSymbol || item.tokenName} has graduated to PancakeSwap!`;
  showToast(msg, 6000, true);
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('🎓 Token Graduated!', {
      body: `${item.tokenName} (${item.tokenSymbol}) is now on PancakeSwap`,
      icon: '/favicon.ico',
    });
  }
}
function notifyNearGraduation(item, progress) {
  // Only show once per token per session
  const seenKey = `jamcy_neargrad_${item.addr.toLowerCase()}`;
  if (sessionStorage.getItem(seenKey)) return;
  sessionStorage.setItem(seenKey, '1');
  showToast(`⚡ ${item.tokenSymbol} is ${progress}% to graduation!`, 4000);
}
function requestBrowserNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

// ============================================
// SHARE CARD
// ============================================
function updateShareCardBtn() {
  const btn = document.getElementById('share-card-btn');
  if (btn) btn.style.display = 'inline-flex';
}
function openShareCard() {
  if (!currentInspect || !lastAIResult) return;
  const { addr, tokenName, tokenSymbol, score, label, level, tokenImage } = currentInspect;
  const { verdict, reason, reasoning, watch } = lastAIResult;
  const shareUrl = `${location.origin}${location.pathname}?addr=${encodeURIComponent(addr)}`;

  // Remove existing modal if any
  document.getElementById('share-card-modal')?.remove();

  const verdictCls = verdict === 'WAGMI' ? 'safe' : verdict === 'NGMI' ? 'danger' : 'warn';
  const verdictColor = verdict === 'WAGMI' ? '#22c55e' : verdict === 'NGMI' ? '#ef4444' : '#f59e0b';
  const logoHtml = tokenImage
    ? `<img class="sc-token-img" src="${escHtml(tokenImage)}" alt="${escHtml(tokenSymbol)}" onerror="this.style.display='none'" />`
    : `<div class="sc-token-img-placeholder">${escHtml(tokenSymbol.charAt(0).toUpperCase())}</div>`;

  const modal = document.createElement('div');
  modal.id = 'share-card-modal';
  modal.className = 'share-card-modal-overlay';
  modal.innerHTML = `
    <div class="share-card-modal">
      <div class="share-card-modal-header">
        <span>Share Verdict Card</span>
        <button class="sc-close-btn" onclick="document.getElementById('share-card-modal').remove()">✕</button>
      </div>

      <div class="share-card" id="share-card-preview">
        <div class="sc-top-bar">
          <span class="sc-logo">⚡ JAMCY Radar</span>
          <span class="sc-powered">Powered by GoPlus + Claude AI</span>
        </div>
        <div class="sc-verdict-strip ${verdictCls}">
          <span class="sc-verdict-label">${escHtml(verdict)}</span>
          <span class="sc-score">${score !== null ? score + '/100' : '?/100'}</span>
        </div>
        <div class="sc-body">
          <div class="sc-token-row">
            ${logoHtml}
            <div class="sc-token-info">
              <span class="sc-token-name">${escHtml(tokenName)}</span>
              <span class="sc-token-symbol">${escHtml(tokenSymbol)}</span>
            </div>
          </div>
          <p class="sc-reason">&ldquo;${escHtml(reason)}&rdquo;</p>
          ${reasoning ? `<p class="sc-reasoning">${escHtml(reasoning)}</p>` : ''}
          ${watch && watch.toLowerCase() !== 'nothing major' ? `
          <div class="sc-watch-row">
            <span class="sc-watch-icon">⚠️</span>
            <span class="sc-watch-text">${escHtml(watch)}</span>
          </div>` : ''}
        </div>
        <div class="sc-footer">
          <span class="sc-addr">${addr.slice(0,10)}…${addr.slice(-8)}</span>
          <span class="sc-url">jamcy-radar.vercel.app</span>
        </div>
      </div>

      <div class="sc-actions">
        <button class="sc-action-btn primary" onclick="shareCardToX('${escHtml(verdict)}','${escHtml(tokenName)}','${escHtml(tokenSymbol)}','${score}','${escHtml(shareUrl)}')">
          📤 Share to X / Twitter
        </button>
        <button class="sc-action-btn" onclick="copyShareLink('${escHtml(shareUrl)}', this)">
          🔗 Copy Link
        </button>
      </div>
    </div>
  `;

  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
}
function shareCardToX(verdict, name, symbol, score, shareUrl) {
  const verdictEmoji = verdict === 'WAGMI' ? '✅' : verdict === 'NGMI' ? '🚨' : '🤔';
  const text = `${verdictEmoji} ${name} ($${symbol}) — ${verdict} ${score !== null && score !== 'null' ? score + '/100' : ''}

AI security verdict by JAMCY Radar
${shareUrl}`;
  const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
  window.open(twitterUrl, '_blank', 'noopener');
}
function copyShareLink(url, btn) {
  navigator.clipboard.writeText(url).then(() => {
    const orig = btn.textContent;
    btn.textContent = '✅ Copied!';
    setTimeout(() => btn.textContent = orig, 1500);
  });
}

// Show toast notification
function showToast(msg, duration = 3500, important = false) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast ${important ? 'toast-important' : ''}`;
  toast.textContent = msg;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ============================================
// UTILS
// ============================================
function formatUsd(n) {
  if (!n) return '$0';
  if (n >= 1_000_000) return `$${(n/1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `$${(n/1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}
function formatUsdShort(n) {
  if (!n) return '$0';
  if (n >= 1_000_000) return `$${(n/1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${Math.round(n/1_000)}K`;
  return `$${Math.round(n)}`;
}
function timeAgo(ms) {
  const diff = Date.now() - ms;
  const m    = Math.floor(diff / 60_000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m/60)}h ago`;
}
function formatLocalTime() {
  return new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
// Returns true if flags indicate a dead/rugged/abandoned bonding curve token
function isDeadToken(flags) {
  const deadLabels = ['rugged or abandoned', 'Ghost launch', 'Stalled launch', 'Only 1 holder on bonding curve'];
  return flags.some(f => f.cls === 'danger' && deadLabels.some(l => f.label.includes(l)));
}

// Robustly extract the first complete JSON object from a string
// Handles markdown code fences and truncated trailing content
function extractJson(raw) {
  // Strip markdown fences
  let s = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/,'').trim();
  // Find opening brace
  const start = s.indexOf('{');
  if (start === -1) throw new Error('No JSON object found');
  s = s.slice(start);
  // Walk and find balanced closing brace
  let depth = 0, inStr = false, escape = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escape)          { escape = false; continue; }
    if (c === '\\' && inStr) { escape = true; continue; }
    if (c === '"')       { inStr = !inStr; continue; }
    if (inStr)           continue;
    if (c === '{')       depth++;
    else if (c === '}')  { depth--; if (depth === 0) return s.slice(0, i + 1); }
  }
  // If truncated, try to close it by trimming to last complete cluster
  // Just return what we have and let JSON.parse throw a useful error
  throw new Error('Truncated JSON — no closing brace found');
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escId(addr) { return addr.replace(/[^a-zA-Z0-9]/g, '_'); }
function normImg(url) {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  return `https://static.four.meme${url.startsWith('/') ? '' : '/'}${url}`;
}
function imgErr(el, letter) {
  const d = document.createElement('div');
  d.className  = el.className.replace('token-img', 'token-img-placeholder').replace('radar-token-img', 'radar-token-img-placeholder');
  d.textContent = (letter || '?').toUpperCase();
  el.replaceWith(d);
}

// ============================================
// CRYPTO KNOWLEDGE CERTIFICATION
// ============================================

const CERT_TOTAL_Q   = 10;
const CERT_PASS_SCORE = 7; // out of 10

let certQuestions   = [];
let certCurrent     = 0;
let certCorrect     = 0;
let certAnswered    = false; // whether current Q has been answered

function resetCertPage() {
  // Restore intro view; keep name if already entered
  el('cert-intro').style.display = '';
  el('cert-quiz').style.display  = 'none';
  el('cert-result').style.display = 'none';
}

function startCertQuiz() {
  const nameInput = document.getElementById('cert-name-input');
  const name = (nameInput?.value || '').trim();
  if (!name) {
    nameInput?.focus();
    nameInput?.classList.add('input-error');
    setTimeout(() => nameInput?.classList.remove('input-error'), 1000);
    return;
  }

  certQuestions = pickRandomQuestions(CERT_TOTAL_Q);
  certCurrent   = 0;
  certCorrect   = 0;
  certAnswered  = false;

  el('cert-intro').style.display  = 'none';
  el('cert-quiz').style.display   = '';
  el('cert-result').style.display = 'none';

  renderCertQuestion();
}

function renderCertQuestion() {
  const q   = certQuestions[certCurrent];
  const num = certCurrent + 1;
  const pct = Math.round((certCurrent / CERT_TOTAL_Q) * 100);

  el('cert-q-counter').textContent  = `Question ${num} of ${CERT_TOTAL_Q}`;
  el('cert-progress-fill').style.width = pct + '%';
  el('cert-score-live').textContent  = `${certCorrect} / ${certCurrent}`;

  const card = el('cert-question-card');
  card.innerHTML = `
    <div class="cert-q-text">${escHtml(q.q)}</div>
    <div class="cert-options" id="cert-options">
      ${q.options.map((opt, i) => `
        <button class="cert-option-btn" data-idx="${i}" onclick="answerCert(${i})">
          <span class="cert-option-letter">${String.fromCharCode(65 + i)}</span>
          <span class="cert-option-text">${escHtml(opt)}</span>
        </button>
      `).join('')}
    </div>
    <div class="cert-q-feedback" id="cert-q-feedback" style="display:none"></div>
    <div class="cert-next-row" id="cert-next-row" style="display:none">
      <button class="cert-next-btn" onclick="nextCertQuestion()">
        ${certCurrent + 1 < CERT_TOTAL_Q ? 'Next Question →' : 'See Results'}
      </button>
    </div>
  `;

  certAnswered = false;
}

function answerCert(selectedIdx) {
  if (certAnswered) return;
  certAnswered = true;

  const q        = certQuestions[certCurrent];
  const correct  = selectedIdx === q.answer;
  if (correct) certCorrect++;

  // Disable all buttons, highlight right/wrong
  document.querySelectorAll('.cert-option-btn').forEach((btn, i) => {
    btn.disabled = true;
    if (i === q.answer)   btn.classList.add('correct');
    if (i === selectedIdx && !correct) btn.classList.add('wrong');
  });

  // Show feedback
  const feedback = el('cert-q-feedback');
  feedback.style.display = '';
  feedback.className = `cert-q-feedback ${correct ? 'correct' : 'wrong'}`;
  feedback.textContent = correct ? '✅ Correct!' : `❌ Wrong — correct answer: ${q.options[q.answer]}`;

  // Show next button
  el('cert-next-row').style.display = '';

  // Update live score
  el('cert-score-live').textContent = `${certCorrect} / ${certCurrent + 1}`;
}

function nextCertQuestion() {
  certCurrent++;
  if (certCurrent >= CERT_TOTAL_Q) {
    showCertResult();
  } else {
    renderCertQuestion();
  }
}

function showCertResult() {
  el('cert-quiz').style.display   = 'none';
  el('cert-result').style.display = '';

  const nameInput = document.getElementById('cert-name-input');
  const name   = (nameInput?.value || 'Anon').trim();
  const passed = certCorrect >= CERT_PASS_SCORE;
  const pct    = Math.round((certCorrect / CERT_TOTAL_Q) * 100);
  const date   = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const resultEl = el('cert-result');
  resultEl.innerHTML = `
    <div class="cert-result-header ${passed ? 'pass' : 'fail'}">
      <div class="cert-result-icon">${passed ? '🏆' : '😢'}</div>
      <h2>${passed ? 'You passed!' : 'Not quite...'}</h2>
      <p>${passed
        ? `You scored <strong>${certCorrect}/${CERT_TOTAL_Q}</strong> — your certificate is ready.`
        : `You scored <strong>${certCorrect}/${CERT_TOTAL_Q}</strong>. You need ${CERT_PASS_SCORE}/10 to pass. Try again!`
      }</p>
    </div>

    <div class="cert-score-bar-row">
      <div class="cert-score-bar-track">
        <div class="cert-score-bar-fill ${passed ? 'pass' : 'fail'}" style="width:${pct}%"></div>
      </div>
      <span class="cert-score-pct">${certCorrect}/${CERT_TOTAL_Q} (${pct}%)</span>
    </div>

    ${passed ? `
    <div class="certificate" id="cert-card">
      <div class="cert-top-bar">
        <span class="cert-logo">⚡ JAMCY Radar</span>
        <span class="cert-tagline">Crypto Knowledge Certification</span>
      </div>
      <div class="cert-body">
        <div class="cert-badge-icon">🛡️</div>
        <div class="cert-title">Certificate of Achievement</div>
        <div class="cert-subtitle">This certifies that</div>
        <div class="cert-name">${escHtml(name)}</div>
        <div class="cert-desc">has demonstrated foundational knowledge in<br><strong>Crypto Security &amp; Rug Detection</strong></div>
        <div class="cert-score-badge">✓ Certified</div>
      </div>
      <div class="cert-footer">
        <span class="cert-date">${escHtml(date)}</span>
        <span class="cert-url">jamcy-radar.vercel.app</span>
      </div>
    </div>

    <div class="cert-share-row">
      <button class="cert-share-btn primary" onclick="shareCertToX('${escHtml(name)}')">📤 Share on X</button>
      <button class="cert-share-btn" onclick="copyCertLink(this)">🔗 Copy Link</button>
      <button class="cert-share-btn" onclick="retakeCert()">🔄 Retake</button>
    </div>
    ` : `
    <div class="cert-share-row">
      <button class="cert-share-btn primary" onclick="retakeCert()">🔄 Try Again</button>
    </div>
    `}
  `;
}

function retakeCert() {
  el('cert-result').style.display = 'none';
  el('cert-intro').style.display  = '';
  el('cert-quiz').style.display   = 'none';
  certQuestions = [];
  certCurrent   = 0;
  certCorrect   = 0;
  certAnswered  = false;
  // Clear name param from URL so a refresh doesn't re-show the cert view
  const url = new URL(window.location);
  url.searchParams.delete('name');
  window.history.replaceState(null, '', url);
}

// Show certificate directly (e.g. from a share link) — no score, just the cert
function showCertDirect(name) {
  el('cert-intro').style.display  = 'none';
  el('cert-quiz').style.display   = 'none';
  el('cert-result').style.display = '';

  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  el('cert-result').innerHTML = `
    <div class="cert-result-header pass">
      <div class="cert-result-icon">🏆</div>
      <h2>Certified!</h2>
      <p><strong>${escHtml(name)}</strong> has earned the Crypto Security &amp; Rug Detection certificate.</p>
    </div>

    <div class="certificate" id="cert-card">
      <div class="cert-top-bar">
        <span class="cert-logo">⚡ JAMCY Radar</span>
        <span class="cert-tagline">Crypto Knowledge Certification</span>
      </div>
      <div class="cert-body">
        <div class="cert-badge-icon">🛡️</div>
        <div class="cert-title">Certificate of Achievement</div>
        <div class="cert-subtitle">This certifies that</div>
        <div class="cert-name">${escHtml(name)}</div>
        <div class="cert-desc">has demonstrated foundational knowledge in<br><strong>Crypto Security &amp; Rug Detection</strong></div>
        <div class="cert-score-badge">✓ Certified</div>
      </div>
      <div class="cert-footer">
        <span class="cert-date">${escHtml(date)}</span>
        <span class="cert-url">jamcy-radar.vercel.app</span>
      </div>
    </div>

    <div class="cert-share-row">
      <button class="cert-share-btn primary" onclick="showPage('certify')">🎓 Take the Quiz</button>
    </div>
  `;
}

function shareCertToX(name) {
  const text = `🛡️ I'm officially certified in Crypto Security & Rug Detection!\n\nEarned my certificate on JAMCY Radar — the AI-powered token inspector.\n\nAre you rug-proof? 👇\nhttps://jamcy-radar.vercel.app`;
  window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
}

function copyCertLink(btn) {
  const nameInput = document.getElementById('cert-name-input');
  const name = (nameInput?.value || '').trim();
  const base = 'https://jamcy-radar.vercel.app';
  const url  = name ? `${base}?page=certify&name=${encodeURIComponent(name)}` : `${base}?page=certify`;
  navigator.clipboard.writeText(url).then(() => {
    const orig = btn.textContent;
    btn.textContent = '✅ Copied!';
    setTimeout(() => btn.textContent = orig, 1500);
  });
}

// ============================================
// RUG OR MOON — GAME
// ============================================

const GAME_TOTAL      = 10;
const GAME_TIMER_SECS = 10;
const GAME_PASS_SCORE = 8;

let gameTokens   = [];
let gameCurrent  = 0;
let gameScore    = 0;
let gameStreak   = 0;
let gameBestStreak = 0;
let gameTimer    = null;
let gameSecsLeft = GAME_TIMER_SECS;
let gameAnswered = false;

function resetGamePage() {
  clearGameTimer();
  el('game-intro').style.display  = '';
  el('game-active').style.display = 'none';
  el('game-result').style.display = 'none';
}

function startGame() {
  gameTokens     = pickGameTokens(GAME_TOTAL);
  gameCurrent    = 0;
  gameScore      = 0;
  gameStreak     = 0;
  gameBestStreak = 0;
  gameAnswered   = false;

  el('game-intro').style.display  = 'none';
  el('game-active').style.display = '';
  el('game-result').style.display = 'none';

  renderGameCard();
}

function renderGameCard() {
  const token = gameTokens[gameCurrent];
  gameAnswered = false;

  // HUD
  el('game-q-num').textContent      = `${gameCurrent + 1} / ${GAME_TOTAL}`;
  el('game-score-display').textContent = gameScore;

  // Streak bar
  const streakBar = el('game-streak-bar');
  if (gameStreak >= 2) {
    streakBar.style.display = '';
    el('game-streak-num').textContent = gameStreak;
  } else {
    streakBar.style.display = 'none';
  }

  // Feedback hidden
  el('game-feedback').style.display = 'none';

  // Buttons enabled
  el('game-btn-rug').disabled  = false;
  el('game-btn-moon').disabled = false;
  el('game-btn-rug').classList.remove('correct','wrong','dim');
  el('game-btn-moon').classList.remove('correct','wrong','dim');

  // Card
  const s = token.stats;
  const diffCls = token.difficulty === 'easy' ? 'easy' : token.difficulty === 'medium' ? 'medium' : 'hard';
  el('game-card').innerHTML = `
    <div class="game-card-header">
      <div class="game-token-emoji">${escHtml(token.emoji)}</div>
      <div class="game-token-info">
        <div class="game-token-name">${escHtml(token.name)}</div>
        <div class="game-token-symbol">$${escHtml(token.symbol)}</div>
      </div>
      ${token.real ? '<span class="game-real-badge">📜 Real</span>' : ''}
      <span class="game-diff-badge ${diffCls}">${token.difficulty}</span>
    </div>
    <div class="game-stats-grid">
      <div class="game-stat">
        <span class="game-stat-label">Holders</span>
        <span class="game-stat-value ${holderCls(s.holders)}">${s.holders.toLocaleString()}</span>
      </div>
      <div class="game-stat">
        <span class="game-stat-label">Buy Tax</span>
        <span class="game-stat-value ${taxCls(s.buyTax)}">${s.buyTax}</span>
      </div>
      <div class="game-stat">
        <span class="game-stat-label">Sell Tax</span>
        <span class="game-stat-value ${taxCls(s.sellTax)}">${s.sellTax}</span>
      </div>
      <div class="game-stat">
        <span class="game-stat-label">Liquidity</span>
        <span class="game-stat-value ${liqCls(s.liquidity)}">${escHtml(s.liquidity)}</span>
      </div>
      <div class="game-stat">
        <span class="game-stat-label">Top Holder</span>
        <span class="game-stat-value ${topHolderCls(s.topHolder)}">${s.topHolder}</span>
      </div>
      <div class="game-stat">
        <span class="game-stat-label">Open Source</span>
        <span class="game-stat-value ${s.openSource ? 'ok' : 'warn'}">${s.openSource ? 'Yes ✓' : 'No'}</span>
      </div>
      <div class="game-stat wide">
        <span class="game-stat-label">Deployer</span>
        <span class="game-stat-value ${deployerCls(s.deployer)}">${escHtml(s.deployer)}</span>
      </div>
      <div class="game-stat wide">
        <span class="game-stat-label">Raised</span>
        <span class="game-stat-value">${escHtml(s.raised)}</span>
      </div>
    </div>
  `;

  // Init timer circle dasharray
  const circleEl = el('game-timer-circle');
  if (circleEl) {
    const circ = 2 * Math.PI * 17;
    circleEl.style.strokeDasharray  = circ;
    circleEl.style.strokeDashoffset = 0;
  }

  // Timer
  startGameTimer();
}

// ---- Stat colouring helpers ----
function holderCls(n)   { return n <= 5 ? 'danger' : n <= 30 ? 'warn' : 'ok'; }
function taxCls(t)      { const v = parseInt(t); return v >= 50 ? 'danger' : v >= 10 ? 'warn' : 'ok'; }
function liqCls(l)      {
  if (l.includes('$0')) return 'danger';
  if (l.includes('unlocked')) return 'warn';
  return 'ok';
}
function topHolderCls(t) { const v = parseInt(t); return v >= 70 ? 'danger' : v >= 30 ? 'warn' : 'ok'; }
function deployerCls(d)  {
  if (d.includes('rug') || d.includes('Serial')) return 'danger';
  if (d.includes('Fresh') || d.includes('Risky')) return 'warn';
  return 'ok';
}

// ---- Timer ----
function startGameTimer() {
  clearGameTimer();
  gameSecsLeft = GAME_TIMER_SECS;
  updateTimerUI();
  gameTimer = setInterval(() => {
    gameSecsLeft--;
    updateTimerUI();
    if (gameSecsLeft <= 0) {
      clearGameTimer();
      if (!gameAnswered) submitAnswer(null); // timeout = wrong
    }
  }, 1000);
}
function clearGameTimer() {
  if (gameTimer) { clearInterval(gameTimer); gameTimer = null; }
}
function updateTimerUI() {
  const numEl    = el('game-timer-num');
  const circleEl = el('game-timer-circle');
  if (!numEl || !circleEl) return;

  numEl.textContent = gameSecsLeft;
  const urgent = gameSecsLeft <= 3;
  numEl.className   = 'game-timer-num' + (urgent ? ' urgent' : '');
  circleEl.style.stroke = urgent ? 'var(--red)' : 'var(--accent)';

  // SVG dashoffset: circumference = 2π×17 ≈ 106.8
  const pct  = gameSecsLeft / GAME_TIMER_SECS;
  const circ = 2 * Math.PI * 17;
  circleEl.style.strokeDashoffset = circ * (1 - pct);
}

// ---- Answer ----
function submitAnswer(choice) {
  if (gameAnswered) return;
  gameAnswered = true;
  clearGameTimer();

  const token   = gameTokens[gameCurrent];
  const correct = choice === token.outcome;

  if (correct) {
    gameScore++;
    gameStreak++;
    if (gameStreak > gameBestStreak) gameBestStreak = gameStreak;
  } else {
    gameStreak = 0;
  }

  // Button states
  const rugBtn  = el('game-btn-rug');
  const moonBtn = el('game-btn-moon');
  rugBtn.disabled  = true;
  moonBtn.disabled = true;

  if (token.outcome === 'rug') {
    rugBtn.classList.add('correct');
    if (choice === 'moon') moonBtn.classList.add('wrong');
  } else {
    moonBtn.classList.add('correct');
    if (choice === 'rug') rugBtn.classList.add('wrong');
  }
  if (choice === null) {
    // timed out — mark the correct one only
    (token.outcome === 'rug' ? rugBtn : moonBtn).classList.add('correct');
  }

  // Feedback
  const feedbackEl = el('game-feedback');
  feedbackEl.style.display = '';
  const timeoutMsg = choice === null ? '⏱️ Time\'s up! ' : '';
  feedbackEl.className = `game-feedback ${correct ? 'correct' : 'wrong'}`;
  feedbackEl.innerHTML = `
    <div class="gf-title">${timeoutMsg}${correct ? '✅ Correct!' : '❌ Wrong!'} It was a <strong>${token.outcome.toUpperCase()}</strong>${gameStreak >= 2 ? ` &nbsp;🔥 ${gameStreak} streak!` : ''}</div>
    <div class="gf-reason">${escHtml(token.reveal)}</div>
    <button class="gf-next-btn" onclick="nextGameToken()">${gameCurrent + 1 < GAME_TOTAL ? 'Next Token →' : 'See Results'}</button>
  `;

  el('game-score-display').textContent = gameScore;
}

function nextGameToken() {
  gameCurrent++;
  if (gameCurrent >= GAME_TOTAL) {
    showGameResult();
  } else {
    renderGameCard();
  }
}

function showGameResult() {
  el('game-active').style.display = 'none';
  el('game-result').style.display = '';

  const passed  = gameScore >= GAME_PASS_SCORE;
  const pct     = Math.round((gameScore / GAME_TOTAL) * 100);

  const rankEmoji  = gameScore === 10 ? '🏆' : gameScore >= 8 ? '🥇' : gameScore >= 6 ? '🥈' : gameScore >= 4 ? '🥉' : '💀';
  const rankLabel  = gameScore === 10 ? 'Perfect — Rug God!' : gameScore >= 8 ? 'Rug-Proof!' : gameScore >= 6 ? 'Decent Radar' : gameScore >= 4 ? 'Needs Work' : 'Rekt';

  el('game-result').innerHTML = `
    <div class="game-result-card ${passed ? 'pass' : 'fail'}">
      <div class="game-result-emoji">${rankEmoji}</div>
      <div class="game-result-rank">${rankLabel}</div>
      <div class="game-result-score">${gameScore} / ${GAME_TOTAL} correct</div>
      <div class="game-result-streak">Best streak: 🔥 ${gameBestStreak}</div>
    </div>

    <div class="game-result-bar-row">
      <div class="game-score-bar-track">
        <div class="game-score-bar-fill ${passed ? 'pass' : 'fail'}" style="width:${pct}%"></div>
      </div>
      <span class="game-score-pct">${pct}%</span>
    </div>

    <div class="game-result-actions">
      <button class="game-action-btn primary" onclick="shareGameToX(${gameScore},${GAME_TOTAL},'${rankLabel}')">📤 Brag on X</button>
      <button class="game-action-btn" onclick="startGame()">🔄 Play Again</button>
      <button class="game-action-btn" onclick="showPage('certify')">🎓 Take the Quiz</button>
    </div>
  `;
}

function shareGameToX(score, total, rank) {
  const rankEmoji = score === 10 ? '🏆' : score >= 8 ? '🛡️' : score >= 6 ? '🤔' : '💥';
  const text = `${rankEmoji} ${rank} — scored ${score}/${total} on the Rug or Moon? game!\n\nCan you spot a rug pull before getting wrecked?\n👇 JAMCY Radar\nhttps://jamcy-radar.vercel.app`;
  window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
}

// ============================================
// MOON RUNNER — CANVAS GAME
// ============================================
(function () {

  // ---- Config ----
  const W         = 480;   // logical canvas width
  const H         = 400;   // logical canvas height
  const LANE_COUNT = 5;
  const LANE_H    = H / LANE_COUNT;
  const ROCKET_X  = 72;
  const ROCKET_SIZE = 36;
  const OBJ_SIZE  = 32;
  const SPAWN_MARGIN = 60; // px from right edge before objects start

  const HEARTS    = ['❤️', '💰', '🪩'];   // collectibles
  const HAZARDS   = ['🐛', '🪨', '💥', '☠️']; // hazards
  const ROCKET_EMO = '🚀';
  const STAR_EMO   = '⭐';

  const BEST_KEY  = 'jamcy_runner_best';

  // ---- State ----
  let canvas, ctx;
  let raf           = null;
  let running       = false;
  let lastTime      = 0;

  let rocketLane   = 2;          // 0–4
  let rocketY      = 0;          // actual px, derived from lane
  let rocketYAnim  = 0;          // smooth y
  let score        = 0;
  let level        = 1;
  let speed        = 180;        // px/sec
  let spawnTimer   = 0;
  let spawnInterval = 1.4;       // seconds between spawns
  let objects      = [];         // { x, lane, emoji, type }
  let particles    = [];         // { x, y, emoji, life, vy }
  let stars        = [];         // background stars { x, y, size }
  let best         = parseInt(localStorage.getItem(BEST_KEY) || '0');
  let inputLocked  = false;

  // ---- Init ----
  function init() {
    canvas = document.getElementById('runner-canvas');
    if (!canvas) return;
    ctx    = canvas.getContext('2d');
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('keydown', onKey);
    generateStars();
    updateBestDisplay();
  }

  function resizeCanvas() {
    if (!canvas) return;
    const wrap  = canvas.parentElement;
    const maxW  = Math.min(wrap.clientWidth, 640);
    const scale = maxW / W;
    canvas.width  = W;
    canvas.height = H;
    canvas.style.width  = maxW + 'px';
    canvas.style.height = Math.round(H * scale) + 'px';
  }

  function generateStars() {
    stars = [];
    for (let i = 0; i < 40; i++) {
      stars.push({ x: Math.random() * W, y: Math.random() * H, size: Math.random() * 1.5 + 0.5 });
    }
  }

  // ---- Public hooks ----
  window.runnerOnShow = function () {
    init();
    if (!running) drawStatic();
  };

  window.runnerStart = function () {
    init();
    // Reset state
    rocketLane    = 2;
    rocketYAnim   = laneToY(2);
    score         = 0;
    level         = 1;
    speed         = 180;
    spawnTimer    = 0;
    spawnInterval = 1.4;
    objects       = [];
    particles     = [];
    inputLocked   = false;

    document.getElementById('runner-intro').style.display    = 'none';
    document.getElementById('runner-gameover').style.display = 'none';
    document.getElementById('runner-score').textContent = '0';
    document.getElementById('runner-level').textContent = '1';

    running  = true;
    lastTime = performance.now();
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
  };

  window.runnerDpad = function (dir) {
    if (!running) return;
    if (dir === 'up')   moveRocket(-1);
    if (dir === 'down') moveRocket(1);
  };

  window.runnerShareX = function () {
    const text = `🚀 I scored ${score} on Moon Runner!\n\nDodging rugs on the way to the moon 🌙\n👇 JAMCY Radar\nhttps://jamcy-radar.vercel.app`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  };

  // ---- Input ----
  function onKey(e) {
    if (!running) return;
    if (e.key === 'ArrowUp'   || e.key === 'w' || e.key === 'W') { e.preventDefault(); moveRocket(-1); }
    if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') { e.preventDefault(); moveRocket(1);  }
  }

  function moveRocket(dir) {
    const next = rocketLane + dir;
    if (next < 0 || next >= LANE_COUNT) return;
    rocketLane = next;
    rocketY    = laneToY(rocketLane);
  }

  function laneToY(lane) {
    return lane * LANE_H + LANE_H / 2 - ROCKET_SIZE / 2;
  }

  // ---- Spawn ----
  function spawnObject() {
    const lane  = Math.floor(Math.random() * LANE_COUNT);
    const isHazard = Math.random() < 0.52;  // slight majority hazards
    const emoji = isHazard
      ? HAZARDS[Math.floor(Math.random() * HAZARDS.length)]
      : HEARTS[Math.floor(Math.random() * HEARTS.length)];
    objects.push({ x: W + OBJ_SIZE, lane, emoji, type: isHazard ? 'hazard' : 'heart' });
  }

  // ---- Particles ----
  function spawnParticle(x, y, emoji) {
    particles.push({ x, y, emoji, life: 1.0, vy: -60 - Math.random() * 40 });
  }

  // ---- Game loop ----
  function loop(ts) {
    if (!running) return;
    const dt = Math.min((ts - lastTime) / 1000, 0.05); // cap at 50ms
    lastTime = ts;

    update(dt);
    draw();

    raf = requestAnimationFrame(loop);
  }

  function update(dt) {
    // Smooth rocket movement
    rocketY = laneToY(rocketLane);
    rocketYAnim += (rocketY - rocketYAnim) * Math.min(dt * 14, 1);

    // Spawn
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnObject();
      spawnTimer = spawnInterval * (0.8 + Math.random() * 0.4);
    }

    // Move objects
    for (const o of objects) o.x -= speed * dt;

    // Collision: rocket hitbox (slightly smaller than visual)
    const rx  = ROCKET_X + 6;
    const ry  = rocketYAnim + 6;
    const rsz = ROCKET_SIZE - 12;

    for (let i = objects.length - 1; i >= 0; i--) {
      const o  = objects[i];
      const oy = laneToY(o.lane) + 6;
      const ox = o.x + 4;
      const osz = OBJ_SIZE - 8;

      const hit = ox < rx + rsz && ox + osz > rx && oy < ry + rsz && oy + osz > ry;

      if (hit) {
        spawnParticle(o.x + OBJ_SIZE / 2, laneToY(o.lane) + OBJ_SIZE / 2, o.emoji);
        objects.splice(i, 1);
        if (o.type === 'heart') {
          score += 10 * level;
          document.getElementById('runner-score').textContent = score;
          // Level up every 100 pts
          const newLevel = Math.floor(score / 100) + 1;
          if (newLevel > level) {
            level = newLevel;
            speed = 180 + (level - 1) * 35;
            spawnInterval = Math.max(0.6, 1.4 - (level - 1) * 0.12);
            document.getElementById('runner-level').textContent = level;
          }
        } else {
          // Hazard — game over
          running = false;
          gameOver();
          return;
        }
      } else if (o.x < -OBJ_SIZE - 10) {
        objects.splice(i, 1);
      }
    }

    // Particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.y   += p.vy * dt;
      p.life -= dt * 1.8;
      if (p.life <= 0) particles.splice(i, 1);
    }

    // Scroll stars
    for (const s of stars) {
      s.x -= speed * 0.15 * dt;
      if (s.x < 0) s.x = W;
    }
  }

  // ---- Draw ----
  function draw() {
    ctx.clearRect(0, 0, W, H);

    // Background
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0,   '#090b10');
    grad.addColorStop(0.6, '#0d0f1a');
    grad.addColorStop(1,   '#0f1535');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Stars
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    for (const s of stars) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
    }

    // Lane dividers (subtle)
    ctx.strokeStyle = 'rgba(108,99,255,0.07)';
    ctx.lineWidth   = 1;
    for (let i = 1; i < LANE_COUNT; i++) {
      ctx.setLineDash([6, 10]);
      ctx.beginPath();
      ctx.moveTo(0, i * LANE_H);
      ctx.lineTo(W, i * LANE_H);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Objects
    ctx.font = `${OBJ_SIZE}px serif`;
    ctx.textBaseline = 'top';
    for (const o of objects) {
      ctx.globalAlpha = 1;
      ctx.fillText(o.emoji, o.x, laneToY(o.lane));
    }

    // Rocket
    ctx.font = `${ROCKET_SIZE}px serif`;
    ctx.globalAlpha = 1;
    ctx.fillText(ROCKET_EMO, ROCKET_X, rocketYAnim);

    // Particles
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.font = `${OBJ_SIZE * 0.9}px serif`;
      ctx.fillText(p.emoji, p.x, p.y);
    }

    ctx.globalAlpha = 1;
  }

  function drawStatic() {
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, W, H);
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, '#090b10');
    grad.addColorStop(1, '#0f1535');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    for (const s of stars) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.font = `${ROCKET_SIZE}px serif`;
    ctx.textBaseline = 'top';
    ctx.globalAlpha = 1;
    ctx.fillText(ROCKET_EMO, ROCKET_X, laneToY(2));
  }

  // ---- Game Over ----
  function gameOver() {
    if (raf) { cancelAnimationFrame(raf); raf = null; }

    if (score > best) {
      best = score;
      localStorage.setItem(BEST_KEY, best);
    }
    updateBestDisplay();

    const isNewBest = score >= best;
    const rank = score >= 500 ? 'Rug God 🏆' : score >= 250 ? 'Moon Bound 🌕' : score >= 100 ? 'WAGMI 🚀' : 'Rekt 💥';
    const overEmoji = score >= 250 ? '🌟' : score >= 100 ? '🚀' : '💥';

    document.getElementById('runner-over-emoji').textContent = overEmoji;
    document.getElementById('runner-over-title').textContent = rank;
    document.getElementById('runner-over-msg').textContent   = `Score: ${score} · Level ${level}`;
    document.getElementById('runner-over-best').textContent  = isNewBest && score > 0 ? '🎉 New best score!' : `Best: ${best}`;
    document.getElementById('runner-gameover').style.display = '';
    document.getElementById('runner-score').textContent = score;
  }

  function updateBestDisplay() {
    const el = document.getElementById('runner-best');
    if (el) el.textContent = best;
  }

})();
