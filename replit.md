# F1 Predict - Predictive Market Platform

## Overview

F1 Predict is a prediction market platform for the 2026 Formula 1 season. Users can buy shares in F1 teams, with prices adjusting based on market demand. When the season ends, shareholders of the winning team split the prize pool. The platform combines trading platform aesthetics (inspired by Robinhood/Coinbase) with Formula 1 racing energy.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript, bundled with Vite
- **Routing**: Wouter (lightweight React router)
- **State Management**: React Context (ThemeContext, MarketContext) combined with TanStack React Query for server state
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with custom design tokens (CSS variables for theming)
- **Design System**: DM Sans font, custom color palette supporting light/dark modes, spacing units of 2/4/6/12

### Backend Architecture
- **Runtime**: Node.js with Express
- **Language**: TypeScript (ESM modules)
- **API Style**: RESTful JSON API under `/api/*` routes
- **Build Tool**: esbuild for server bundling, Vite for client

### Data Storage
- **Database**: PostgreSQL via Drizzle ORM
- **Schema Location**: `shared/schema.ts` - defines users, teams, holdings, and transactions tables
- **Migrations**: Drizzle Kit with `db:push` command

### Key Data Models
- **Users**: Account with balance (starts at $100), optional walletAddress for Freighter wallet linking
- **Teams**: 11 F1 teams for 2026 season (Red Bull, Ferrari, Mercedes, McLaren, Aston Martin, Alpine, Williams, RB, Audi, Haas, Cadillac)
  - All teams start at equal $0.10 price - market demand drives pricing
  - Sauber removed (replaced by Audi), Cadillac added as new entry
  - No share limit - unlimited shares can be purchased
- **Holdings**: User ownership of team shares with average purchase price
- **Transactions**: Record of all buy/sell activity
- **PriceHistory**: Team price snapshots recorded on trades and seeded on startup for charts

### Application Flow
1. Guest users are auto-created on first visit (stored in localStorage)
2. Users browse team market with real-time prices
3. Users must connect Freighter wallet before purchasing shares
4. Wallet linking validates: address format, account existence on Stellar, USDC trustline
5. Purchase shares through modal interface (wallet required)
6. Portfolio tracks holdings, P&L, and total value
7. Prize pool accumulates from all share purchases
8. TeamValueChart displays price history over time

## External Dependencies

### Database
- PostgreSQL (connection via `DATABASE_URL` environment variable)
- Drizzle ORM for type-safe database operations

### UI Libraries
- Radix UI (full primitive suite for accessible components)
- Recharts (for market statistics visualization)
- Embla Carousel, react-day-picker, input-otp, vaul (drawer), react-resizable-panels

### Stellar/USDC Integration
- @stellar/stellar-sdk for Stellar network operations
- @stellar/freighter-api for web wallet integration
- STELLAR_SECRET_KEY environment variable for testnet master wallet
- Memo-based deposit tracking using user UUID (first 28 characters)
- Demo credits with $5000 lifetime limit per user for testing

### Development Tools
- Replit-specific plugins: vite-plugin-runtime-error-modal, vite-plugin-cartographer, vite-plugin-dev-banner
- connect-pg-simple for PostgreSQL session storage (available but sessions not currently implemented)