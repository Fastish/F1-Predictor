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
- **Users**: Account with balance (deprecated - using wallet USDC), optional walletAddress for Polygon wallet linking
- **Teams**: 11 F1 teams for 2026 season (Red Bull, Ferrari, Mercedes, McLaren, Aston Martin, Alpine, Williams, RB, Audi, Haas, Cadillac)
- **Drivers**: 22 F1 drivers for 2026 season with team associations
- **ChampionshipPools**: LMSR-based prediction pools (team championship, driver championship)
  - Uses Logarithmic Market Scoring Rule (LMSR) for automated market making
  - Prices automatically adjust based on shares sold per outcome
  - Liquidity parameter controls price sensitivity
- **PoolPositions**: User holdings within championship pools (shares per outcome)
- **PoolTrades**: Ledger of all pool buy/sell transactions with LMSR pricing
- **PoolPayouts**: Prize distributions when pools are resolved
- **Seasons**: Tracks season state (active/concluded), winning team, prize pool

### Trading System (LMSR Pools)
The platform uses LMSR (Logarithmic Market Scoring Rule) pools for prediction markets:
- **Pool Types**: Team Championship, Driver Championship
- **Pricing**: Automated via LMSR formula - prices sum to ~$1 across all outcomes
- **API**: `/api/pools/*` endpoints in `pool-routes.ts`
- **Price Calculation**: `price = exp(shares_i/b) / sum(exp(shares_j/b))` where b=liquidity parameter

Legacy CLOB (Central Limit Order Book) system exists in `server/routes.ts` at `/api/clob/*` but is deprecated. The LMSR pool system provides better liquidity and simpler UX.

### Application Flow
1. Guest users are auto-created on first visit (stored in localStorage)
2. Users browse team market with real-time prices
3. Users connect wallet via Magic Labs (email) or external wallet (MetaMask, Rainbow)
4. Wallet linking creates/connects to Polygon address with USDC balance
5. Purchase shares through modal interface (wallet required)
6. Portfolio tracks holdings, P&L, and total value
7. Prize pool accumulates from all share purchases
8. TeamValueChart displays price history over time

### Season Conclusion Flow (Admin)
1. Create season via Admin Panel (2026 season)
2. Users trade during active season
3. Admin concludes season and declares winning team
4. Trading is locked when season concludes
5. Admin calculates payouts (distributes prize pool by share percentage)
6. Admin distributes payouts - USDC sent to winners' Polygon wallets
7. Winners receive USDC proportional to their shareholding in the winning team

## External Dependencies

### Database
- PostgreSQL (connection via `DATABASE_URL` environment variable)
- Drizzle ORM for type-safe database operations

### UI Libraries
- Radix UI (full primitive suite for accessible components)
- Recharts (for market statistics visualization)
- Embla Carousel, react-day-picker, input-otp, vaul (drawer), react-resizable-panels

### Polygon/USDC Integration
- ethers.js for Polygon network operations
- Magic Labs SDK for email-based wallet authentication
- External wallet support (MetaMask, Rainbow, etc.) via window.ethereum
- USDC contract on Polygon: 0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359
- Chain ID: 137 (Polygon mainnet)
- VITE_MAGIC_API_KEY environment variable for Magic Labs integration

### Wallet Integration (Magic Labs + External Wallets)
The app uses a dual-wallet system:
- **WalletContext**: Manages wallet state, connection, disconnection, and transaction signing
- **Magic Labs**: Passwordless email login for non-crypto users (creates Polygon wallet)
- **External Wallets**: MetaMask, Rainbow, and other browser extension wallets
- **State Persistence**: Wallet type and address saved to localStorage
- **Balance Queries**: Client-side USDC balance fetching via ethers.js

### Polymarket Integration
- Gamma API for fetching F1 prediction markets
- CLOB API for order placement with HMAC-SHA256 signing
- EIP-712 signatures for credential derivation
- API credentials cached in-memory (not localStorage) for security
- Admin panel section for viewing/syncing Polymarket F1 markets

### Secure Buy Order Flow (Nonce-Based Verification)
@deprecated - This flow is for the legacy CLOB system. The active pool system uses demo credits for trading.

Buy orders require USDC payment via signed Stellar transactions with server-side verification:

1. **Build Transaction** (`POST /api/clob/orders/build-transaction`)
   - Client sends order parameters (marketId, price, quantity, etc.)
   - Server calculates required collateral = price × quantity
   - Server generates secure 16-byte nonce and stores {userId, walletAddress, collateralAmount, orderDetails}
   - Server builds unsigned USDC payment transaction and returns with nonce

2. **Sign Transaction** (Client-side with Freighter)
   - User signs the unsigned transaction in Freighter wallet
   - Returns signed XDR

3. **Submit Signed Transaction** (`POST /api/clob/orders/submit-signed`)
   - Client sends {signedXdr, nonce} - NO orderDetails accepted
   - Server looks up stored expectation by nonce, deletes immediately (single-use)
   - Server verifies: source=stored wallet, destination=platform, asset=USDC, amount=stored collateral
   - If verification passes, submits to Stellar network
   - Credits user internal balance with stored collateralAmount
   - Places order using stored orderDetails (not client-supplied)

**Security Properties:**
- Nonces are cryptographically random, single-use, and expire after 5 minutes
- Order details come from server storage, not client request at submission
- Transaction amount verified against server-stored expectation, not client-claimed values
- Buy orders on legacy endpoint rejected - must use signed transaction flow

### Development Tools
- Replit-specific plugins: vite-plugin-runtime-error-modal, vite-plugin-cartographer, vite-plugin-dev-banner
- connect-pg-simple for PostgreSQL session storage (available but sessions not currently implemented)