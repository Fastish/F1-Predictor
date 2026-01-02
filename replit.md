# F1 Predict - Predictive Market Platform

## Overview

F1 Predict is a prediction market platform for the 2026 Formula 1 season. Users can buy shares in F1 teams, with prices adjusting based on market demand. When the season ends, shareholders of the winning team split the prize pool. The platform combines trading platform aesthetics (inspired by Robinhood/Coinbase) with Formula 1 racing energy. It utilizes LMSR (Logarithmic Market Scoring Rule) pools for automated market making, providing better liquidity and a simpler user experience compared to traditional order books.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: React with TypeScript, bundled with Vite
- **Routing**: Wouter
- **State Management**: React Context, TanStack React Query
- **UI Components**: shadcn/ui (built on Radix UI)
- **Styling**: Tailwind CSS with custom design tokens for theming
- **Design System**: DM Sans font, custom color palette supporting light/dark modes

### Backend
- **Runtime**: Node.js with Express
- **Language**: TypeScript (ESM modules)
- **API Style**: RESTful JSON API
- **Build Tool**: esbuild

### Data Storage
- **Database**: PostgreSQL via Drizzle ORM
- **Key Data Models**: Users, Teams, Drivers, ChampionshipPools (LMSR-based), PoolPositions, PoolTrades, PoolPayouts, Seasons.

### Trading System (LMSR Pools)
- **Mechanism**: Logarithmic Market Scoring Rule (LMSR) for automated market making.
- **Pool Types**: Team Championship, Driver Championship.
- **Pricing**: Automatically adjusted based on shares sold per outcome, with a liquidity parameter controlling sensitivity.
- **Admin Flow**: Admins can create seasons, conclude them, declare winning teams, calculate, and distribute payouts.

### Wallet and Trading Integration
- **Dual-wallet System**: Magic Labs for email-based authentication (creating Polygon wallet) and external wallets (MetaMask, Rainbow).
- **Trading Wallets**:
  - **Magic Users**: Trades execute from a Proxy wallet derived from their EOA address
  - **External Wallet Users**: Trades execute from a Gnosis Safe wallet derived from their EOA address. **Important**: Users must deposit USDC.e to their Safe wallet before trading - the EOA wallet balance is not used for trades.
- **Polymarket Integration**: Utilizes Polymarket's Gamma API for market data and CLOB client for order execution, supporting gasless transactions via Polymarket Relayer and Gnosis Safe proxy for external wallets.
- **Order Types**: GTC (Good Til Cancelled), FOK (Fill Or Kill), GTD (Good Til Date) with user-adjustable limit prices.

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
- 0x Protocol's Swap API for USDC ↔ USDC.e conversion.

### Polymarket Integration
- Polymarket Gamma API
- @polymarket/clob-client library
- Polymarket Relayer (`https://relayer-v2.polymarket.com/`)
- Polymarket Builder Signing SDK
- Specific contract addresses for USDC, CTF, CTF Exchange, NegRisk CTF Exchange on Polygon.
- **API Key Binding (Critical)**: For signatureType=2 (Safe wallets), API keys are bound to the **EOA** (signer), NOT the Safe address. The `owner` and `POLY_ADDRESS` fields in order submission must use the EOA to match the API key binding. The order `maker` field uses the Safe address (where funds are held).

### Development Tools
- Replit-specific Vite plugins (runtime-error-modal, cartographer, dev-banner)
- connect-pg-simple (for session storage, not currently implemented)

### User Comments and Display Names
- **Comments System**: Users can post comments on market pages (constructor championship, driver championship, individual races)
- **Display Names**: Users can set vanity usernames (1-30 alphanumeric characters + underscores) that appear on their comments instead of wallet addresses
- **Username Availability**: Real-time availability checking with debounced validation (500ms delay) and Polymarket profile integration
- **Data Model**: Comments stored in `marketComments` table with denormalized displayName for history preservation
- **API Routes**: 
  - GET /api/comments?marketType=X&marketId=Y - Fetch comments for a market
  - POST /api/comments - Create a comment (validates wallet format, market type, content length)
  - GET /api/user/profile/:walletAddress - Get user profile with displayName
  - GET /api/user/check-username/:username - Check username availability
  - GET /api/polymarket/profile/:walletAddress - Fetch Polymarket public profile
  - PATCH /api/user/display-name - Update user's display name (validates availability on server)
- **Security Note**: Comments and profile updates rely on client-provided wallet addresses without server-side cryptographic verification, consistent with the app's client-side wallet architecture where cryptographic verification occurs on the blockchain/Polymarket side

### SEO and Open Graph
- **OG Image**: Default F1 racing image at `/og-image.jpg` for social sharing
- **Meta Tags**: Open Graph and Twitter Card meta tags in index.html
- **Page SEO**: Each page uses `useSEO` hook for dynamic title and description updates
- **Pages with SEO**:
  - Home: "F1 Prediction Market 2026"
  - Constructors Championship: "2026 Constructors Championship"
  - Drivers Championship: "2026 Drivers Championship"
  - Markets: "All F1 Markets"
  - Races: "2026 F1 Race Calendar"
  - Race Detail: Dynamic based on race name
  - Positions: "My Positions - F1 Trading Portfolio"
  - How to Use: "How to Trade F1 Predictions"
  - Admin: "Admin Panel"

### Arbitrage Detection System
- **Purpose**: Compare Polymarket prices against traditional sportsbook betting lines to identify value opportunities
- **Data Source**: TheOddsAPI for live odds (requires THEODDSAPI_KEY env var) with mock bet365 estimates as fallback
- **Threshold**: Flags opportunities when delta exceeds 5 percentage points between sources
- **Recommendations**:
  - **BUY_YES**: Sportsbook values outcome higher than Polymarket (underpriced on Polymarket)
  - **BUY_NO**: Sportsbook values outcome lower than Polymarket (overpriced on Polymarket)
  - **NEUTRAL**: Prices are closely aligned (within 5% threshold)
- **Key Files**:
  - `server/oddsSync.ts`: Odds sync service with conversion utilities and comparison engine
  - `client/src/components/ArbitrageValueBadge.tsx`: Frontend badge and summary components
- **API Routes**:
  - GET /api/arbitrage/opportunities - Returns value opportunities for constructors and drivers
  - GET /api/arbitrage/odds - Returns cached sportsbook odds for debugging
- **Cache**: 5-minute TTL on sportsbook odds
- **UX**: ArbitrageValueBadge with tooltip explains delta and recommends action; ArbitrageSummary shows count of opportunities