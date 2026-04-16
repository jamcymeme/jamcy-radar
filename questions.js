/* ============================================
   JAMCY Radar — questions.js
   Copyright (C) 2026 JAMCY (jamcymeme)
   Licensed under AGPL-3.0 — see LICENSE
   ============================================ */

'use strict';

const CERT_QUESTIONS = [
  {
    q: "What does 'rug pull' mean in crypto?",
    options: [
      "A token that increases quickly in price",
      "Developers abandon the project and drain liquidity",
      "A type of smart contract audit",
      "When a whale buys a large amount of tokens"
    ],
    answer: 1,
    category: "rug-detection"
  },
  {
    q: "What is a 'honeypot' token?",
    options: [
      "A token with very sweet tokenomics",
      "A token that offers staking rewards",
      "A token you can buy but not sell due to malicious contract code",
      "A multi-sig wallet requiring multiple signatures"
    ],
    answer: 2,
    category: "rug-detection"
  },
  {
    q: "What does 'liquidity locked' mean?",
    options: [
      "The token's trading is paused",
      "Liquidity pool tokens are locked in a contract so developers can't drain them",
      "Only whitelisted wallets can trade the token",
      "The token has a transaction tax on sells"
    ],
    answer: 1,
    category: "defi"
  },
  {
    q: "What is a 'bonding curve' in token launches?",
    options: [
      "A curve showing historical price action",
      "A chart of holder distribution",
      "A mechanism where token price increases as more tokens are purchased from a smart contract",
      "A DEX liquidity depth chart"
    ],
    answer: 2,
    category: "defi"
  },
  {
    q: "What does 'DYOR' stand for?",
    options: [
      "Do Your Own Research",
      "Don't Yield on Returns",
      "Deploy Your Own Router",
      "Divide Your Overall Risk"
    ],
    answer: 0,
    category: "basics"
  },
  {
    q: "What is a 'mint function' risk in a token contract?",
    options: [
      "The contract can generate unlimited new tokens, diluting holders",
      "The contract mints NFTs automatically",
      "It allows staking rewards to be generated",
      "The function that creates the initial liquidity pool"
    ],
    answer: 0,
    category: "rug-detection"
  },
  {
    q: "High holder concentration (e.g. one wallet holds 60%+) is a red flag because:",
    options: [
      "It means the token passed a security audit",
      "One entity can dump tokens and crash the price",
      "It indicates strong community support",
      "It is required for bonding curve tokens"
    ],
    answer: 1,
    category: "rug-detection"
  },
  {
    q: "What does 'contract renounced' mean?",
    options: [
      "The contract has been audited by a third party",
      "The developer still controls all admin functions",
      "Ownership of the contract has been given up — no one can change it anymore",
      "The token is listed on a major exchange"
    ],
    answer: 2,
    category: "defi"
  },
  {
    q: "What is the main purpose of GoPlus Security API?",
    options: [
      "To track token prices in real time",
      "To audit smart contracts for security risks like honeypots and rug flags",
      "To provide leverage trading on DEXes",
      "To generate AI-powered trading signals"
    ],
    answer: 1,
    category: "tools"
  },
  {
    q: "What is a 'pump and dump' scheme?",
    options: [
      "Using a pump to move liquidity between pools",
      "A DeFi strategy for arbitrage",
      "Artificially inflating a token's price then selling all holdings to unsuspecting buyers",
      "A method of staking tokens for fixed yield"
    ],
    answer: 2,
    category: "rug-detection"
  },
  {
    q: "A token with 'buy tax 0% / sell tax 99%' is most likely:",
    options: [
      "A high-yield staking token",
      "A honeypot — buyers can't profitably sell",
      "A deflationary burn mechanism",
      "A standard yield farming token"
    ],
    answer: 1,
    category: "rug-detection"
  },
  {
    q: "What does DEX stand for?",
    options: [
      "Digital Exchange Protocol",
      "Decentralized Exchange",
      "Distributed Execution Contract",
      "Direct Entry Exchange"
    ],
    answer: 1,
    category: "basics"
  },
  {
    q: "Market cap in crypto is calculated as:",
    options: [
      "Total tokens × all-time high price",
      "Circulating supply × current price",
      "Trading volume × 24h",
      "Locked liquidity × token holders"
    ],
    answer: 1,
    category: "basics"
  },
  {
    q: "What does 'slippage' mean when trading on a DEX?",
    options: [
      "The fee paid to validators",
      "A coding error in the smart contract",
      "The difference between expected price and actual executed price due to low liquidity",
      "The time it takes a transaction to confirm"
    ],
    answer: 2,
    category: "defi"
  },
  {
    q: "What is a 'whale' in crypto?",
    options: [
      "A token with very high market cap",
      "An entity holding a very large amount of a token, capable of moving prices",
      "A type of liquidity pool",
      "A developer who launches multiple tokens"
    ],
    answer: 1,
    category: "basics"
  },
  {
    q: "What is a 'serial rugger' in the context of token deployers?",
    options: [
      "A deployer who consistently creates successful tokens",
      "A wallet that has deployed multiple tokens that were later rugged or abandoned",
      "A whale that buys every new launch",
      "An auditor who reviews contracts repeatedly"
    ],
    answer: 1,
    category: "rug-detection"
  },
  {
    q: "What does 'WAGMI' stand for in crypto culture?",
    options: [
      "We Are Gonna Make It",
      "Wait And Get More Income",
      "Wallets Are Getting More Interesting",
      "We're All Going Maximum In"
    ],
    answer: 0,
    category: "basics"
  },
  {
    q: "What does 'NGMI' mean in crypto slang?",
    options: [
      "New Governance Model Initiative",
      "Not Gonna Make It",
      "Next Generation Market Index",
      "Node Gateway Mining Interface"
    ],
    answer: 1,
    category: "basics"
  },
  {
    q: "Why is a token with 0% liquidity on a DEX suspicious before official launch?",
    options: [
      "It means the token has too many holders",
      "It indicates the project is still in development — normal for bonding curve tokens",
      "No liquidity means you cannot sell the token after buying on secondary markets",
      "It means the smart contract has been fully audited"
    ],
    answer: 2,
    category: "defi"
  },
  {
    q: "What is a 'smart contract audit'?",
    options: [
      "A government review of cryptocurrency regulations",
      "An automated price monitoring service",
      "A formal security review of contract code to find vulnerabilities",
      "A community vote on project governance"
    ],
    answer: 2,
    category: "defi"
  },
  {
    q: "What does 'FUD' stand for?",
    options: [
      "Fully Utilized Deployment",
      "Fear, Uncertainty, and Doubt",
      "Fixed Utility Denomination",
      "Fast Update Directive"
    ],
    answer: 1,
    category: "basics"
  },
  {
    q: "A token's contract having a hidden 'blacklist' function means:",
    options: [
      "The token passed an anti-spam filter",
      "The developer can prevent specific wallets from selling",
      "The token is listed on a blacklisted exchange",
      "The contract automatically burns blacklisted tokens"
    ],
    answer: 1,
    category: "rug-detection"
  },
  {
    q: "What is the primary risk of buying a token before its liquidity is locked?",
    options: [
      "The token may appreciate too quickly",
      "You'll pay higher gas fees",
      "Developers can withdraw all liquidity at any time, crashing the price to zero",
      "The DEX listing may be delayed"
    ],
    answer: 2,
    category: "rug-detection"
  },
  {
    q: "What is 'Four.meme' in the BNB Chain ecosystem?",
    options: [
      "A decentralized stablecoin protocol",
      "A BNB Chain token launchpad using a bonding curve mechanism",
      "A yield farming aggregator",
      "A cross-chain bridge for meme tokens"
    ],
    answer: 1,
    category: "tools"
  },
  {
    q: "When a token's bonding curve reaches ~100%, what typically happens?",
    options: [
      "The token is burned and liquidity returned to holders",
      "The token relaunches with a new contract",
      "Liquidity graduates to a DEX like PancakeSwap for open trading",
      "The bonding curve resets and starts over"
    ],
    answer: 2,
    category: "defi"
  },

  // ---- Questions 26–50 ----
  {
    q: "What does 'DEGEN' mean in crypto culture?",
    options: [
      "A diversified portfolio holder",
      "Someone who takes high-risk bets on speculative/unverified assets",
      "A developer who passed a security audit",
      "A token with deflationary mechanics"
    ],
    answer: 1,
    category: "basics"
  },
  {
    q: "What is a 'multi-sig wallet' and why does it matter for token projects?",
    options: [
      "A wallet that holds multiple token types",
      "A wallet requiring multiple private key signatures to authorise transactions — reduces single-point-of-failure rug risk",
      "A wallet with multiple trading bots attached",
      "A wallet that automatically diversifies funds"
    ],
    answer: 1,
    category: "defi"
  },
  {
    q: "If a token's sell tax suddenly changes from 5% to 99% after you buy, what happened?",
    options: [
      "Normal fee adjustment for tokenomics rebalancing",
      "The contract has a hidden owner function — classic rug setup",
      "The DEX raised its fee tier",
      "A governance vote changed the tax rate"
    ],
    answer: 1,
    category: "rug-detection"
  },
  {
    q: "What does it mean when a token contract is 'not open source'?",
    options: [
      "The code is hidden — you can't verify it doesn't have backdoors or honeypot traps",
      "The contract was deployed on a private blockchain",
      "The token has not been audited yet but is safe",
      "Open source is optional and has no security implications"
    ],
    answer: 0,
    category: "rug-detection"
  },
  {
    q: "What is 'wash trading' in the context of token volume?",
    options: [
      "Legitimate high-frequency trading by market makers",
      "Buying and selling between wallets you control to create fake volume",
      "A DeFi strategy that earns yield from liquidity pools",
      "Washing private keys through a mixer before trading"
    ],
    answer: 1,
    category: "rug-detection"
  },
  {
    q: "What is a 'liquidity pool' on a DEX?",
    options: [
      "A fund managed by a centralised exchange",
      "A smart contract holding two token reserves that enable trustless trading via an AMM formula",
      "A pool of validators securing the blockchain",
      "A savings account earning fixed APY on stablecoins"
    ],
    answer: 1,
    category: "defi"
  },
  {
    q: "Which of these is the strongest signal that a token is safe to trade?",
    options: [
      "100k Twitter followers on launch day",
      "Locked liquidity + renounced contract + audit from a reputable firm",
      "A Telegram group with 50k members",
      "Price up 500% in the first hour"
    ],
    answer: 1,
    category: "rug-detection"
  },
  {
    q: "What does 'AMM' stand for in DeFi?",
    options: [
      "Automated Market Maker",
      "Asset Management Module",
      "Algorithmic Mint Mechanism",
      "Audited Multi-sig Module"
    ],
    answer: 0,
    category: "defi"
  },
  {
    q: "A token with 'buy tax 0% / sell tax 0%' but 99% supply held by one wallet is:",
    options: [
      "Perfectly safe — no taxes means no rug",
      "Still extremely risky — the whale can dump and crash the price to near zero",
      "A sign of a well-managed treasury",
      "Normal for newly launched bonding curve tokens"
    ],
    answer: 1,
    category: "rug-detection"
  },
  {
    q: "What is a 'flash loan attack'?",
    options: [
      "A DDoS attack on a blockchain node",
      "Borrowing large amounts with no collateral within one transaction to exploit protocol vulnerabilities",
      "A method of stealing private keys via phishing",
      "Frontrunning a transaction in the mempool"
    ],
    answer: 1,
    category: "defi"
  },
  {
    q: "What is 'frontrunning' in crypto transactions?",
    options: [
      "Being first to buy a newly listed token",
      "A validator/bot detecting a pending transaction and submitting their own with higher gas to execute first for profit",
      "Launching a token before competitors",
      "Buying before a confirmed price increase announcement"
    ],
    answer: 1,
    category: "defi"
  },
  {
    q: "Why are newly created deployer wallets a red flag?",
    options: [
      "They indicate the project has no funding",
      "A fresh wallet with no history suggests the developer is deliberately hiding a rug track record",
      "New wallets cannot interact with smart contracts",
      "They indicate the token is on a testnet"
    ],
    answer: 1,
    category: "rug-detection"
  },
  {
    q: "What does 'TVL' stand for in DeFi?",
    options: [
      "Total Volume Locked",
      "Token Value Limit",
      "Total Value Locked",
      "Trade Velocity Level"
    ],
    answer: 2,
    category: "defi"
  },
  {
    q: "What is a 'soft rug' vs a 'hard rug'?",
    options: [
      "Soft rug = small loss; hard rug = large loss",
      "Soft rug = devs quietly stop development and abandon the project; hard rug = instant liquidity drain or exploit",
      "These terms have no standard meaning in crypto",
      "Soft rug = smart contract bug; hard rug = intentional exit scam"
    ],
    answer: 1,
    category: "rug-detection"
  },
  {
    q: "What does 'gas fee' refer to on EVM chains like BNB Chain?",
    options: [
      "The fee paid to the token developer on each trade",
      "The fee paid to network validators/miners to process and confirm a transaction",
      "The DEX swap fee added to each trade",
      "A tax collected by the protocol treasury"
    ],
    answer: 1,
    category: "basics"
  },
  {
    q: "What is 'token vesting' and why is it a positive signal?",
    options: [
      "Burning tokens to reduce supply",
      "Team/investor tokens locked and released gradually over time — reduces risk of an immediate dump after launch",
      "A staking mechanism that pays yield monthly",
      "Locking user funds to earn governance rights"
    ],
    answer: 1,
    category: "defi"
  },
  {
    q: "Pump.fun tokens on Solana are 'closed source' by default. This means:",
    options: [
      "They are always scams and should be avoided",
      "The contract code is not publicly visible — normal for pump.fun but increases due-diligence burden on buyers",
      "The tokens cannot be traded on DEXes",
      "Only verified wallets can buy them"
    ],
    answer: 1,
    category: "tools"
  },
  {
    q: "What is 'price impact' when swapping on a DEX?",
    options: [
      "The fee percentage charged by the DEX",
      "How much your trade moves the token price due to pool size — larger trades in smaller pools = higher impact",
      "The difference between buy and sell price on a CEX",
      "The gas cost multiplied by block congestion"
    ],
    answer: 1,
    category: "defi"
  },
  {
    q: "What warning sign does 'only 1 holder on bonding curve' indicate?",
    options: [
      "The token is extremely new and may gain traction",
      "There is effectively zero organic demand — the only 'buyer' is the launch mechanism itself",
      "The developer holds the full supply as treasury",
      "The token has not been listed on a DEX yet"
    ],
    answer: 1,
    category: "rug-detection"
  },
  {
    q: "A token raises $5 of BNB on its bonding curve, then goes silent. This is called:",
    options: [
      "A stealth launch strategy",
      "A ghost launch — negligible real demand, very likely abandoned",
      "A seed round funding mechanism",
      "Normal behaviour for new tokens in the first 24h"
    ],
    answer: 1,
    category: "rug-detection"
  },
  {
    q: "What is a CEX vs a DEX?",
    options: [
      "CEX = Centralized Exchange (Binance, Coinbase); DEX = Decentralized Exchange (PancakeSwap, Uniswap)",
      "CEX = Crypto Exchange; DEX = Digital Exchange",
      "CEX = Community Exchange; DEX = Developer Exchange",
      "They are the same thing with different names"
    ],
    answer: 0,
    category: "basics"
  },
  {
    q: "What does 'holder count' tell you about a token's risk?",
    options: [
      "Nothing — holder count is irrelevant",
      "A very low holder count (e.g. 1–3) suggests zero organic interest or a coordinated scheme",
      "Higher is always better regardless of distribution",
      "Holder count only matters for governance tokens"
    ],
    answer: 1,
    category: "rug-detection"
  },
  {
    q: "What is 'LP burning' and why is it significant?",
    options: [
      "Burning the token to reduce supply and increase price",
      "Sending LP (liquidity provider) tokens to a dead address permanently — makes liquidity unremovable and is a strong safety signal",
      "A penalty mechanism for early sellers",
      "Automatically reinvesting trading fees back into the pool"
    ],
    answer: 1,
    category: "defi"
  },
  {
    q: "You see a token with $500k market cap, $0 liquidity, and GoPlus shows 'not in DEX'. What's most likely?",
    options: [
      "The project has no funding and is a guaranteed rug",
      "It's still on a bonding curve — market cap is virtual until graduation; $0 DEX liquidity is expected at this stage",
      "The DEX API is down and liquidity will appear shortly",
      "The token has graduated but liquidity was stolen"
    ],
    answer: 1,
    category: "defi"
  },
  {
    q: "What is the safest approach before buying any new token?",
    options: [
      "Buy quickly before others — early entry maximises gains",
      "Check contract security, liquidity lock, holder distribution, deployer history, and DYOR before committing any funds",
      "Only buy tokens that have a verified Twitter account",
      "Trust community recommendations in Telegram groups"
    ],
    answer: 1,
    category: "basics"
  },
];

// Pick N unique random questions from the bank
function pickRandomQuestions(n) {
  const shuffled = [...CERT_QUESTIONS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(n, shuffled.length));
}
