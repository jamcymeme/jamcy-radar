# ⚡ JAMCY Radar

> AI-powered token security inspector for BNB Chain & Solana — live radar, rug detection, games & crypto knowledge certification.

Built for the [Four.meme AI Sprint Hackathon](https://dorahacks.io/hackathon/fourmemeaisprint/detail).

🔗 **Live demo:** [jamcy-radar.vercel.app](https://jamcy-radar.vercel.app)

---

## Features

### 🔎 Inspector
Paste any BNB Chain (`0x…`) or Solana address for an instant AI-powered security analysis. Pulls data from GoPlus Security + DexScreener, calculates a 0–100 safety score, and delivers a plain-English AI verdict (WAGMI / DYOR / DEGEN PLAY / NGMI) with reasoning and red flags.

### 📡 Live Radar
Real-time feed of new Four.meme token launches, auto-scanned by GoPlus every 1.5s. Filter by verdict, track bonding curve progress, and spot rugs as they happen.

### 🏁 Graduation Race
Leaderboard of tokens closest to graduating from the Four.meme bonding curve to PancakeSwap. Auto-updates from Live Radar.

### 💀 Rug Graveyard
Auto-populated log of confirmed rugs and abandoned bonding curves detected this session. Tracks estimated funds raised before death.

### 📊 Live Stats
Session-wide analytics: verdict distribution, score buckets, top deployers by launch count with rug rate badges.

### 🧠 Narrative Trends
AI clusters live Four.meme launches by narrative theme every 5 minutes (AI, Dogs, Political, Anime, Food…). Identifies which narratives are graduating vs. rugging.

### 🎓 Crypto Knowledge Certificate
50-question bank on crypto basics, DeFi mechanics, and rug-pull detection. 10 random questions per attempt. Pass 7/10 to earn a shareable certificate.

### 🎯 Rug or Moon?
Flash-card game — read real token stats and decide: Rug 🚨 or Moon 🚀? 10-second timer per card. Includes real-world historical cases (SQUID, AnubisDAO, PEPE, dogwifhat and more).

### 🚀 Moon Runner
Endless runner — pilot your rocket 🚀 through 5 lanes, collect safe tokens ❤️ and dodge rug bugs 🐛 and crashes 🪨. Speed and spawn rate increase with level.

---

## Stack

- **Pure HTML + CSS + Vanilla JS** — zero build step, zero dependencies
- **[Anthropic Claude](https://anthropic.com)** (via Vercel serverless proxy) — AI verdicts, narrative trends
- **[GoPlus Security API](https://gopluslabs.io)** — honeypot detection, tax analysis, holder distribution
- **[Four.meme API](https://four.meme)** — live token launches and bonding curve data
- **[DexScreener API](https://dexscreener.com)** — liquidity and price data

---

## Setup

```bash
git clone https://github.com/jamcymeme/jamcy-radar.git
cd jamcy-radar
```

No build step needed. For the AI features you need an Anthropic API key:

**Local dev (e.g. `vercel dev`):**
1. Create a `.env` file:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```
2. Run `vercel dev` — this starts the local serverless functions

**Static only (no AI):**
Open `index.html` directly in a browser. Inspector, Radar, Race, Graveyard, Stats, Games and Certification all work without AI. Only the AI verdict and Narrative Trends features require the API key.

---

## Project Structure

```
jamcy-radar/
├── index.html       # Single-page app shell + all page HTML
├── app.js           # All application logic
├── style.css        # Dark theme stylesheet
├── questions.js     # 50-question certification bank
├── game-data.js     # Rug or Moon? token scenarios (incl. real-world cases)
├── api/
│   └── ai.js        # Vercel serverless proxy → Anthropic Claude
└── LICENSE          # AGPL-3.0
```

---

## License

Copyright (C) 2026 JAMCY (jamcymeme)

Licensed under the **GNU Affero General Public License v3.0** — see [LICENSE](./LICENSE).

Any modified version deployed as a public service must publish its full source code under the same license and credit JAMCY Radar.
