# ⚡ JAMCY Radar

> AI-powered token security inspector for BNB Chain and Solana, with live Four.meme launch radar.

Built for the [Four.meme AI Sprint Hackathon](https://dorahacks.io/hackathon/fourmemeaisprint/detail).

## Features

- 🔍 **Inspector** — paste any BNB Chain (0x…) or Solana address for instant security analysis
- 🤖 **AI Risk Summary** — plain English verdict powered by [DGrid AI Gateway](https://dgrid.ai)
- 📡 **Live Radar** — real-time feed of new Four.meme token launches with auto security scanning
- 🛡️ **GoPlus Security** — honeypot detection, tax analysis, holder distribution, and more
- 💾 **Persistent preferences** — history and state saved in localStorage

## Stack

- Pure HTML + CSS + Vanilla JS — no build step, no dependencies
- [GoPlus Security API](https://gopluslabs.io) — free, no key needed
- [DGrid AI Gateway](https://dgrid.ai) — OpenAI-compatible, routes to best available model
- [Four.meme API](https://four.meme) — unofficial public endpoint for live token data
- [DexScreener API](https://dexscreener.com) — liquidity and price data

## Setup

1. Clone the repo
2. Copy `.env.example` to `.secrets` and add your DGrid API key
3. Open `index.html` in a browser — no server needed

## License

MIT
