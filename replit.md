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
- USDC.e (bridged) contract: 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174
- Chain ID: 137 (Polygon mainnet)
- VITE_MAGIC_API_KEY environment variable for Magic Labs integration

### 0x Swap API Integration (USDC ↔ USDC.e)
**Status: IMPLEMENTED** - In-app token swapping for trading convenience.

The platform uses 0x Protocol's Swap API to enable direct USDC ↔ USDC.e conversion:
- **Deposit (USDC → USDC.e)**: Convert native USDC to bridged USDC.e for Polymarket trading
- **Withdraw (USDC.e → USDC)**: Convert USDC.e back to native USDC for exchange withdrawals

**API Endpoints** (`server/routes.ts`):
- `GET /api/swap/status`: Check if 0x API is configured and get token addresses
- `GET /api/swap/price`: Get indicative price without transaction data (for display)
- `GET /api/swap/quote`: Get executable quote with transaction data for wallet signing

**Client Components**:
- `SwapModal.tsx`: Modal with Deposit/Withdraw tabs, amount input, price preview
- Integrated into `DepositModal.tsx` via "Swap USDC / USDC.e" button

**Configuration**:
- ZEROX_API_KEY environment variable (100k free requests/month)
- Uses 0x API v2 with allowance-holder pattern
- Default 0.5% slippage (50 bps), configurable up to 100%

**Flow**:
1. User enters amount to swap
2. Client fetches price from `/api/swap/price`
3. On confirm, client fetches quote from `/api/swap/quote`
4. If token approval needed, user approves the 0x AllowanceHolder contract
5. User signs and broadcasts the swap transaction
6. Balances refresh after confirmation

### Wallet Integration (Magic Labs + External Wallets)
The app uses a dual-wallet system:
- **WalletContext**: Manages wallet state, connection, disconnection, and transaction signing
- **Magic Labs**: Passwordless email login for non-crypto users (creates Polygon wallet)
- **External Wallets**: MetaMask, Rainbow, and other browser extension wallets
- **State Persistence**: Wallet type and address saved to localStorage
- **Balance Queries**: Client-side USDC balance fetching via ethers.js

### Polymarket Integration
- **Gamma API**: Fetches F1 prediction markets with outcomes and prices
- **CLOB Client**: @polymarket/clob-client library for order execution
- **Order Execution**: Uses ethers v5 wallet (from @ethersproject/wallet) for EIP-712 signing
- **API Configuration**:
  - POLY_BUILDER_PRIVATE_KEY: Private key for order signing (stored in Replit Secrets)
  - signatureType=2 (browser wallet proxy) for external wallets with Safe proxy as funder
  - API credentials derived via createOrDeriveApiKey()
- **Order Parameters**:
  - tickSize: "0.01" (standard tick size)
  - negRisk: true (F1 championship markets use negative risk)
  - orderType: FOK (default), GTC, or GTD - user selectable in bet modal with tooltip linking to Polymarket docs
- **Order Types** (user-selectable):
  - FOK (Fill Or Kill): Executes immediately in full or cancels entirely (default)
  - GTC (Good Til Cancelled): Stays open until filled or cancelled
  - GTD (Good Til Day): Expires at end of day if not filled
- **Status Normalization**: CLOB statuses (OPEN/LIVE/MATCHED/CANCELED/EXPIRED) mapped to schema vocabulary (open/filled/partial/cancelled/expired/pending)
- Admin panel section for viewing/syncing Polymarket F1 markets

### Polymarket Safe Proxy System (signatureType=2)
**Status: IMPLEMENTED** - External wallets use Gnosis Safe proxy for trading.

Polymarket requires external wallets (MetaMask, Rainbow) to trade through Safe proxy wallets:
- **signatureType=0 (EOA)**: Rejected by Polymarket servers - no longer supported
- **signatureType=2 (Browser Wallet)**: Required for external wallets; uses Safe proxy as funder

**Trading Session Flow** (`client/src/hooks/useTradingSession.ts`):
1. User connects external wallet (MetaMask, Rainbow, etc.)
2. DepositModal auto-initializes trading session when external wallet connects
3. Session initialization derives user API credentials (deriveApiKey/createApiKey)
4. System derives Safe proxy address directly from EOA address (deterministic)
5. ClobClient created with signatureType=2, funder=safeAddress
6. If no Safe address or session fails: Toast notification shown, manual retry button available

**UX Flow** (as of Dec 2024):
- Trading session initialization moved from PolymarketBetModal to DepositModal
- External wallets auto-trigger session init when DepositModal opens
- autoInitAttempted flag resets on modal close, allowing retry on reopen
- USDC approval status checked and displayed in DepositModal
- PolymarketDepositWizard accessible from DepositModal for managing approvals
- Bet modal simplified: shows warning if session incomplete, no setup UI

**TradingSession Schema**:
- `eoaAddress`: User's wallet address (EOA)
- `safeAddress`: Gnosis Safe proxy address (from Polymarket)
- `signatureType`: 2 for browser wallet proxy
- `proxyDeployed`: Whether Safe proxy is deployed on Polymarket
- `apiCredentials`: User's derived CLOB API key/secret/passphrase

**Contract Addresses**:
- Safe Factory: 0xaacFeEa03eb1561C4e67d661e40682Bd20E3541b (external wallets)
- Magic Proxy Factory: 0xaB45c5A4B0c941a2F231C04C3f49182e1A254052 (email wallets)
- NegRisk Adapter: 0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296

### Polymarket Relayer Client (Gasless Transactions)
**Status: IMPLEMENTED** - Uses client-side signing with remote Builder authentication.
**Wallet Support**: External wallets only (MetaMask, Rainbow, etc.) - Magic wallets require separate flow.

The Polymarket relayer (`https://relayer-v2.polymarket.com/`) requires:
1. **User wallet signature** on each transaction payload (client-side via ethers v5)
2. **Builder HMAC authentication** on HTTP requests (server-side)

**Architecture:**
- **Client-side** (`client/src/lib/polymarketGasless.ts`):
  - Uses `@polymarket/builder-relayer-client` SDK with `RelayClient`
  - Uses `@ethersproject/providers` Web3Provider for ethers v5 compatible signer
  - Creates `BuilderConfig` with `remoteBuilderConfig` pointing to `/api/polymarket/builder-sign`
  - Verifies Polygon network (chainId 137) before proceeding
  - SDK automatically handles proxy wallet deployment if needed
  - Exports: `checkGaslessAvailable()`, `approveUSDCGasless()`, `approveCTFGasless()`, `approveAllGasless()`, `isExternalWalletAvailable()`

- **Server-side** (`server/routes.ts`):
  - `POST /api/polymarket/builder-sign`: Returns HMAC signature headers for the SDK
    - Passes through SDK-provided timestamp for signature matching
    - Handles body serialization (object/string) correctly
  - `GET /api/polymarket/relayer-status`: Checks if Builder credentials are configured
  - Uses `@polymarket/builder-signing-sdk` for HMAC signature generation

- **Environment Variables** (Replit Secrets):
  - POLY_BUILDER_API_KEY: Builder program API key
  - POLY_BUILDER_SECRET: HMAC signing secret  
  - POLY_BUILDER_PASSPHRASE: Authentication passphrase

- **Deposit Wizard** (`client/src/components/PolymarketDepositWizard.tsx`):
  - Shows "Gasless available!" only when: Builder credentials configured AND external wallet connected
  - "Gasless Approve" button uses the RelayClient for zero-gas approvals
  - Falls back to user-paid gas for Magic wallets or if gasless is unavailable

- **Contract Addresses** (Polygon):
  - USDC: 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174
  - CTF: 0x4d97dcd97ec945f40cf65f87097ace5ea0476045
  - CTF Exchange: 0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E
  - NegRisk CTF Exchange: 0xC5d563A36AE78145C45a50134d48A1215220f80a

### Secure Buy Order Flow (Nonce-Based Verification)
@deprecated - This flow is for the legacy CLOB system. The active pool system uses demo credits for trading.

Buy orders require USDC payment via signed Polygon transactions with server-side verification:

1. **Build Transaction** (`POST /api/clob/orders/build-transaction`)
   - Client sends order parameters (marketId, price, quantity, etc.)
   - Server calculates required collateral = price × quantity
   - Server generates secure 16-byte nonce and stores {userId, walletAddress, collateralAmount, orderDetails}
   - Server builds unsigned USDC payment transaction and returns with nonce

2. **Sign Transaction** (Client-side with Magic Labs or external wallet)
   - User signs the unsigned transaction in their connected wallet
   - Returns signed transaction

3. **Submit Signed Transaction** (`POST /api/clob/orders/submit-signed`)
   - Client sends {signedXdr, nonce} - NO orderDetails accepted
   - Server looks up stored expectation by nonce, deletes immediately (single-use)
   - Server verifies: source=stored wallet, destination=platform, asset=USDC, amount=stored collateral
   - If verification passes, submits to Polygon network
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