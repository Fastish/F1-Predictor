## Overview

F1 Predict is a prediction market platform for the 2026 Formula 1 season. It allows users to trade shares in F1 teams, with prices dynamically adjusting based on market demand. The platform features a user-friendly trading interface inspired by popular financial apps and leverages Logarithmic Market Scoring Rule (LMSR) pools for enhanced liquidity and automated market making. Upon season conclusion, shareholders of the winning team share the prize pool. The project aims to combine the excitement of Formula 1 with innovative market mechanics.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: React with TypeScript, Vite
- **Routing**: Wouter
- **State Management**: React Context, TanStack React Query
- **UI Components**: shadcn/ui (Radix UI)
- **Styling**: Tailwind CSS with custom design tokens

### Backend
- **Runtime**: Node.js with Express
- **Language**: TypeScript (ESM)
- **API Style**: RESTful JSON
- **Build Tool**: esbuild

### Data Storage
- **Database**: PostgreSQL via Drizzle ORM
- **Key Models**: Users, Teams, Drivers, ChampionshipPools (LMSR), PoolPositions, PoolTrades, PoolPayouts, Seasons.

### Trading System (LMSR Pools)
- **Mechanism**: LMSR for automated market making, supporting Team and Driver Championships.
- **Pricing**: Automatically adjusts based on shares sold, controlled by a liquidity parameter.
- **Admin Features**: Season creation, conclusion, winner declaration, payout calculation and distribution.

### Wallet and Trading Integration
- **Dual-wallet System**: Magic Labs for email-based authentication (Polygon wallet) and external wallets (MetaMask, Rainbow).
- **Trading Wallets**: Proxy wallet for Magic users; Gnosis Safe for external wallet users (requires USDC.e deposit to Safe).
- **Polymarket Integration**: Utilizes Polymarket's Gamma API for market data and CLOB client for gasless order execution via Polymarket Relayer and Gnosis Safe proxy.
- **Order Types**: GTC, FOK, GTD with user-adjustable limit prices.
- **Phantom Auto-Connect Prevention**: Logic to prevent unwanted auto-connections from injected connectors while allowing user-initiated connections.
- **WalletConnect**: Lazy-loaded with runtime config fallback for `VITE_WALLETCONNECT_PROJECT_ID`.

### Comments and Display Names
- **Comments System**: Users can post comments on market pages.
- **Display Names**: Vanity usernames (1-30 alphanumeric + underscores) displayed instead of wallet addresses, with real-time availability checking and Polymarket profile integration.

### SEO and Open Graph
- **Meta Tags**: Open Graph and Twitter Card support, with dynamic titles and descriptions using `useSEO` hook.
- **OG Image**: Default F1 racing image.

### AI Article Generation System
- **Purpose**: Generate F1-related news articles using OpenAI for SEO and content.
- **Integration**: Replit AI Integrations (OpenAI API).
- **Workflow**: Generate draft articles via admin UI, review, then publish to a `/news` page.
- **Image Generation**: Articles automatically get AI-generated 1024x1024 images used for both thumbnail and hero/OG.
- **Manual Image Upload**: Admin can upload custom images to Object Storage for articles when AI generation fails or for custom images.
- **X.com Publishing**: Admin can post published articles to X.com with auto-generated teaser tweets. Requires `TWITTER_API_KEY`, `TWITTER_API_SECRET`, `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_TOKEN_SECRET`.

### Object Storage
- **Provider**: Replit Object Storage (Google Cloud Storage backend)
- **Purpose**: Host article images and other uploaded assets
- **Upload Flow**: Presigned URL flow - get upload URL from server, upload directly to GCS
- **Serving**: Files served via `/objects/:path` endpoint
- **ACL**: Public visibility for article images

### Navigation Structure
- **Predictive Markets** (dropdown): Constructors, Drivers, Races, Guide
- **F1 Schedule**: 2026 race calendar with all 24 races
- **F1 Standings**: 2025 constructor/driver standings with 2026 season countdown
- **News**: AI-generated F1 articles
- **Portfolio**: User positions and balances

### Fee Tracking System (Deferred Collection Model)
- **Purpose**: Track and collect platform fees (2%) on all Polymarket trades.
- **Mechanism**: Fees are recorded as `pending_collection` upon order placement, requiring only one user signature.
- **Fee Authorization**: Explicit user authorization step during trading session initialization for fee collection.
- **Collection**: Fees are collected via Polymarket relayer (USDC.e transfer from Safe to treasury) and automatically triggered after each successful order.
- **Reconciliation**: System compares expected fees against actual collected fees.

### Arbitrage Detection System
- **Purpose**: Identify value opportunities by comparing Polymarket prices against traditional sportsbook betting lines.
- **Data Source**: TheOddsAPI for live odds.
- **Recommendation**: Flags opportunities (BUY_YES, BUY_NO) when price deltas exceed 5 percentage points, suggesting underpriced or overpriced outcomes on Polymarket.

## External Dependencies

### Database
- PostgreSQL
- Drizzle ORM

### UI Libraries
- Radix UI
- Recharts
- Embla Carousel, react-day-picker, input-otp, vaul (drawer), react-resizable-panels

### Polygon/USDC Integration
- ethers.js
- Magic Labs SDK
- USDC contract on Polygon (0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359)
- USDC.e (bridged) contract (0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174)
- Polygon mainnet (Chain ID: 137)

### 0x Swap API Integration
- 0x Protocol's Swap API (for USDC ↔ USDC.e conversion).

### Polymarket Integration
- Polymarket Gamma API
- @polymarket/clob-client library
- Polymarket Relayer (`https://relayer-v2.polymarket.com/`)
- Polymarket Builder Signing SDK
- Specific contract addresses for USDC, CTF, CTF Exchange, NegRisk CTF Exchange on Polygon.
- Treasury Address: 0xb600979a5EF3ebA5302DE667d47c9F9A73a983b8
- TheOddsAPI (for arbitrage detection)

### Development Tools (Replit-specific)
- Vite plugins (runtime-error-modal, cartographer, dev-banner)