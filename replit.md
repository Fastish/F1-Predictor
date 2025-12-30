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

### Development Tools
- Replit-specific Vite plugins (runtime-error-modal, cartographer, dev-banner)
- connect-pg-simple (for session storage, not currently implemented)