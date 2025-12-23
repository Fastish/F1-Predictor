import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, integer, real, timestamp, boolean, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Users table - tracks user accounts and wallet balance
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  balance: real("balance").notNull().default(100),
  walletAddress: text("wallet_address"),
});

export const usersRelations = relations(users, ({ many }) => ({
  holdings: many(holdings),
  transactions: many(transactions),
  deposits: many(deposits),
}));

// F1 Teams table - the 10 teams users can bet on
export const teams = pgTable("teams", {
  id: varchar("id").primaryKey(),
  name: text("name").notNull(),
  shortName: text("short_name").notNull(),
  color: text("color").notNull(),
  price: real("price").notNull().default(0.1),
  priceChange: real("price_change").notNull().default(0),
  totalShares: integer("total_shares").notNull().default(10000),
  availableShares: integer("available_shares").notNull().default(10000),
});

export const teamsRelations = relations(teams, ({ many }) => ({
  holdings: many(holdings),
  transactions: many(transactions),
  drivers: many(drivers),
}));

// F1 Drivers table - the 20+ drivers users can bet on in Driver Championship
export const drivers = pgTable("drivers", {
  id: varchar("id").primaryKey(),
  name: text("name").notNull(),
  shortName: text("short_name").notNull(),
  teamId: varchar("team_id").notNull().references(() => teams.id),
  number: integer("number").notNull(),
  color: text("color").notNull(),
});

export const driversRelations = relations(drivers, ({ one }) => ({
  team: one(teams, {
    fields: [drivers.teamId],
    references: [teams.id],
  }),
}));

// Holdings - tracks which users own shares in which teams
export const holdings = pgTable("holdings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  teamId: varchar("team_id").notNull().references(() => teams.id),
  shares: integer("shares").notNull().default(0),
  avgPrice: real("avg_price").notNull().default(0),
});

export const holdingsRelations = relations(holdings, ({ one }) => ({
  user: one(users, {
    fields: [holdings.userId],
    references: [users.id],
  }),
  team: one(teams, {
    fields: [holdings.teamId],
    references: [teams.id],
  }),
}));

// Transactions - history of all share purchases
export const transactions = pgTable("transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  teamId: varchar("team_id").notNull().references(() => teams.id),
  type: text("type").notNull(), // 'buy' or 'sell'
  shares: integer("shares").notNull(),
  pricePerShare: real("price_per_share").notNull(),
  totalAmount: real("total_amount").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Deposits - tracks USDC deposits from Polygon network
export const deposits = pgTable("deposits", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  polygonTxHash: text("polygon_tx_hash").unique(),
  amount: real("amount").notNull(),
  status: text("status").notNull().default("pending"), // 'pending', 'confirmed', 'failed'
  fromAddress: text("from_address"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  confirmedAt: timestamp("confirmed_at"),
});

// Price History - tracks team price changes over time for charts
export const priceHistory = pgTable("price_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  teamId: varchar("team_id").notNull().references(() => teams.id),
  price: real("price").notNull(),
  recordedAt: timestamp("recorded_at").notNull().defaultNow(),
});

// Season - tracks the current season state
export const seasons = pgTable("seasons", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  year: integer("year").notNull().unique(),
  status: text("status").notNull().default("active"), // 'active', 'concluded'
  winningTeamId: varchar("winning_team_id").references(() => teams.id),
  prizePool: real("prize_pool").notNull().default(0),
  concludedAt: timestamp("concluded_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const seasonsRelations = relations(seasons, ({ one }) => ({
  winningTeam: one(teams, {
    fields: [seasons.winningTeamId],
    references: [teams.id],
  }),
}));

// Payouts - records prize distributions to winners
export const payouts = pgTable("payouts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  seasonId: varchar("season_id").notNull().references(() => seasons.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  teamId: varchar("team_id").notNull().references(() => teams.id),
  sharesHeld: integer("shares_held").notNull(),
  sharePercentage: real("share_percentage").notNull(),
  payoutAmount: real("payout_amount").notNull(),
  polygonTxHash: text("polygon_tx_hash"),
  status: text("status").notNull().default("pending"), // 'pending', 'sent', 'failed'
  createdAt: timestamp("created_at").notNull().defaultNow(),
  paidAt: timestamp("paid_at"),
});

export const payoutsRelations = relations(payouts, ({ one }) => ({
  season: one(seasons, {
    fields: [payouts.seasonId],
    references: [seasons.id],
  }),
  user: one(users, {
    fields: [payouts.userId],
    references: [users.id],
  }),
  team: one(teams, {
    fields: [payouts.teamId],
    references: [teams.id],
  }),
}));

export const depositsRelations = relations(deposits, ({ one }) => ({
  user: one(users, {
    fields: [deposits.userId],
    references: [users.id],
  }),
}));

export const priceHistoryRelations = relations(priceHistory, ({ one }) => ({
  team: one(teams, {
    fields: [priceHistory.teamId],
    references: [teams.id],
  }),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  user: one(users, {
    fields: [transactions.userId],
    references: [users.id],
  }),
  team: one(teams, {
    fields: [transactions.teamId],
    references: [teams.id],
  }),
}));

// Insert schemas
export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertTeamSchema = createInsertSchema(teams);

export const insertDriverSchema = createInsertSchema(drivers);

export const insertHoldingSchema = createInsertSchema(holdings).omit({
  id: true,
});

export const insertTransactionSchema = createInsertSchema(transactions).omit({
  id: true,
  createdAt: true,
});

export const insertDepositSchema = createInsertSchema(deposits).omit({
  id: true,
  createdAt: true,
  confirmedAt: true,
});

export const insertPriceHistorySchema = createInsertSchema(priceHistory).omit({
  id: true,
  recordedAt: true,
});

export const insertSeasonSchema = createInsertSchema(seasons).omit({
  id: true,
  createdAt: true,
  concludedAt: true,
});

export const insertPayoutSchema = createInsertSchema(payouts).omit({
  id: true,
  createdAt: true,
  paidAt: true,
});

// =====================================================
// CLOB (Central Limit Order Book) Tables
// =====================================================

// Markets - One per team or driver per season, tracks collateral and outstanding pairs
export const markets = pgTable("markets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  seasonId: varchar("season_id").notNull().references(() => seasons.id),
  teamId: varchar("team_id").references(() => teams.id),
  driverId: varchar("driver_id").references(() => drivers.id),
  marketType: text("market_type").notNull().default("team"), // 'team' or 'driver'
  polymarketConditionId: text("polymarket_condition_id"), // Polymarket market condition ID for integration
  polymarketTokenId: text("polymarket_token_id"), // Polymarket token ID for trading
  outstandingPairs: integer("outstanding_pairs").notNull().default(0),
  lockedCollateral: real("locked_collateral").notNull().default(0),
  lastPrice: real("last_price").default(0.5),
  status: text("status").notNull().default("active"), // 'active', 'halted', 'settled'
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const marketsRelations = relations(markets, ({ one, many }) => ({
  season: one(seasons, { fields: [markets.seasonId], references: [seasons.id] }),
  team: one(teams, { fields: [markets.teamId], references: [teams.id] }),
  driver: one(drivers, { fields: [markets.driverId], references: [drivers.id] }),
  orders: many(orders),
  positions: many(marketPositions),
}));

// Orders - Limit orders in the order book
export const orders = pgTable("orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  marketId: varchar("market_id").notNull().references(() => markets.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  outcome: text("outcome").notNull(), // 'yes' or 'no'
  side: text("side").notNull(), // 'buy' or 'sell'
  price: real("price").notNull(), // 0.01 to 0.99
  quantity: integer("quantity").notNull(),
  filledQuantity: integer("filled_quantity").notNull().default(0),
  status: text("status").notNull().default("open"), // 'open', 'filled', 'partial', 'cancelled'
  collateralLocked: real("collateral_locked").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const ordersRelations = relations(orders, ({ one, many }) => ({
  market: one(markets, { fields: [orders.marketId], references: [markets.id] }),
  user: one(users, { fields: [orders.userId], references: [users.id] }),
  takerFills: many(orderFills, { relationName: "takerOrder" }),
  makerFills: many(orderFills, { relationName: "makerOrder" }),
}));

// Order Fills - Records of matched orders
export const orderFills = pgTable("order_fills", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  marketId: varchar("market_id").notNull().references(() => markets.id),
  takerOrderId: varchar("taker_order_id").notNull().references(() => orders.id),
  makerOrderId: varchar("maker_order_id").notNull().references(() => orders.id),
  takerUserId: varchar("taker_user_id").notNull().references(() => users.id),
  makerUserId: varchar("maker_user_id").notNull().references(() => users.id),
  fillType: text("fill_type").notNull(), // 'mint' or 'burn'
  quantity: integer("quantity").notNull(),
  yesPrice: real("yes_price").notNull(),
  noPrice: real("no_price").notNull(),
  collateralMoved: real("collateral_moved").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const orderFillsRelations = relations(orderFills, ({ one }) => ({
  market: one(markets, { fields: [orderFills.marketId], references: [markets.id] }),
  takerOrder: one(orders, { fields: [orderFills.takerOrderId], references: [orders.id], relationName: "takerOrder" }),
  makerOrder: one(orders, { fields: [orderFills.makerOrderId], references: [orders.id], relationName: "makerOrder" }),
  takerUser: one(users, { fields: [orderFills.takerUserId], references: [users.id] }),
  makerUser: one(users, { fields: [orderFills.makerUserId], references: [users.id] }),
}));

// Market Positions - User's holdings in each market
export const marketPositions = pgTable("market_positions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  marketId: varchar("market_id").notNull().references(() => markets.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  yesShares: integer("yes_shares").notNull().default(0),
  noShares: integer("no_shares").notNull().default(0),
  avgYesPrice: real("avg_yes_price").notNull().default(0),
  avgNoPrice: real("avg_no_price").notNull().default(0),
  realizedPnl: real("realized_pnl").notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const marketPositionsRelations = relations(marketPositions, ({ one }) => ({
  market: one(markets, { fields: [marketPositions.marketId], references: [markets.id] }),
  user: one(users, { fields: [marketPositions.userId], references: [users.id] }),
}));

// Collateral Ledger - Tracks all collateral movements for audit
export const collateralLedger = pgTable("collateral_ledger", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  marketId: varchar("market_id").references(() => markets.id),
  orderId: varchar("order_id").references(() => orders.id),
  fillId: varchar("fill_id").references(() => orderFills.id),
  amount: real("amount").notNull(),
  reason: text("reason").notNull(), // 'order_lock', 'order_release', 'mint_lock', 'burn_release', 'settlement_payout'
  balanceBefore: real("balance_before").notNull(),
  balanceAfter: real("balance_after").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const collateralLedgerRelations = relations(collateralLedger, ({ one }) => ({
  user: one(users, { fields: [collateralLedger.userId], references: [users.id] }),
  market: one(markets, { fields: [collateralLedger.marketId], references: [markets.id] }),
  order: one(orders, { fields: [collateralLedger.orderId], references: [orders.id] }),
  fill: one(orderFills, { fields: [collateralLedger.fillId], references: [orderFills.id] }),
}));

// =====================================================
// Request Schemas
// =====================================================

// Buy shares request schema (legacy - for backwards compatibility)
export const buySharesSchema = z.object({
  teamId: z.string(),
  quantity: z.number().int().positive(),
  userId: z.string(),
});

// Sell shares request schema (legacy - for backwards compatibility)
export const sellSharesSchema = z.object({
  teamId: z.string(),
  quantity: z.number().int().positive(),
  userId: z.string(),
});

// Deposit request schema
export const depositRequestSchema = z.object({
  userId: z.string(),
  polygonTxHash: z.string(),
  amount: z.number().positive(),
  fromAddress: z.string(),
});

// Place Order request schema
export const placeOrderSchema = z.object({
  marketId: z.string(),
  userId: z.string(),
  outcome: z.enum(["yes", "no"]),
  side: z.enum(["buy", "sell"]),
  price: z.number().min(0.01).max(0.99),
  quantity: z.number().int().positive(),
});

// Cancel Order request schema
export const cancelOrderSchema = z.object({
  orderId: z.string(),
  userId: z.string(),
});

// CLOB Insert Schemas
export const insertMarketSchema = createInsertSchema(markets).omit({
  id: true,
  createdAt: true,
});

export const insertOrderSchema = createInsertSchema(orders).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertOrderFillSchema = createInsertSchema(orderFills).omit({
  id: true,
  createdAt: true,
});

export const insertMarketPositionSchema = createInsertSchema(marketPositions).omit({
  id: true,
  updatedAt: true,
});

export const insertCollateralLedgerSchema = createInsertSchema(collateralLedger).omit({
  id: true,
  createdAt: true,
});

// Types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertTeam = z.infer<typeof insertTeamSchema>;
export type Team = typeof teams.$inferSelect;
export type InsertDriver = z.infer<typeof insertDriverSchema>;
export type Driver = typeof drivers.$inferSelect;
export type InsertHolding = z.infer<typeof insertHoldingSchema>;
export type Holding = typeof holdings.$inferSelect;
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactions.$inferSelect;
export type BuySharesRequest = z.infer<typeof buySharesSchema>;
export type SellSharesRequest = z.infer<typeof sellSharesSchema>;
export type InsertDeposit = z.infer<typeof insertDepositSchema>;
export type Deposit = typeof deposits.$inferSelect;
export type DepositRequest = z.infer<typeof depositRequestSchema>;
export type InsertPriceHistory = z.infer<typeof insertPriceHistorySchema>;
export type PriceHistory = typeof priceHistory.$inferSelect;
export type InsertSeason = z.infer<typeof insertSeasonSchema>;
export type Season = typeof seasons.$inferSelect;
export type InsertPayout = z.infer<typeof insertPayoutSchema>;
export type Payout = typeof payouts.$inferSelect;

// CLOB Types
export type InsertMarket = z.infer<typeof insertMarketSchema>;
export type Market = typeof markets.$inferSelect;
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof orders.$inferSelect;
export type InsertOrderFill = z.infer<typeof insertOrderFillSchema>;
export type OrderFill = typeof orderFills.$inferSelect;
export type InsertMarketPosition = z.infer<typeof insertMarketPositionSchema>;
export type MarketPosition = typeof marketPositions.$inferSelect;
export type InsertCollateralLedger = z.infer<typeof insertCollateralLedgerSchema>;
export type CollateralLedger = typeof collateralLedger.$inferSelect;
export type PlaceOrderRequest = z.infer<typeof placeOrderSchema>;
export type CancelOrderRequest = z.infer<typeof cancelOrderSchema>;

// =====================================================
// Championship Pool Tables (LMSR-based unified pools)
// =====================================================

// Championship Pools - One pool per type (team/driver) per season
export const championshipPools = pgTable("championship_pools", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  seasonId: varchar("season_id").notNull().references(() => seasons.id),
  type: text("type").notNull(), // "team" | "driver"
  bParameter: real("b_parameter").notNull().default(100), // LMSR liquidity parameter
  totalCollateral: real("total_collateral").notNull().default(0),
  status: text("status").notNull().default("active"), // "active" | "concluded"
  winningOutcomeId: varchar("winning_outcome_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const championshipPoolsRelations = relations(championshipPools, ({ one, many }) => ({
  season: one(seasons, { fields: [championshipPools.seasonId], references: [seasons.id] }),
  outcomes: many(championshipOutcomes),
  trades: many(poolTrades),
}));

// Championship Outcomes - One per team/driver in each pool
export const championshipOutcomes = pgTable("championship_outcomes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  poolId: varchar("pool_id").notNull().references(() => championshipPools.id),
  participantId: varchar("participant_id").notNull(), // teamId or driverId
  sharesOutstanding: real("shares_outstanding").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const championshipOutcomesRelations = relations(championshipOutcomes, ({ one, many }) => ({
  pool: one(championshipPools, { fields: [championshipOutcomes.poolId], references: [championshipPools.id] }),
  trades: many(poolTrades),
  positions: many(poolPositions),
}));

// Pool Trades - Ledger of all trades against the pool
export const poolTrades = pgTable("pool_trades", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  poolId: varchar("pool_id").notNull().references(() => championshipPools.id),
  outcomeId: varchar("outcome_id").notNull().references(() => championshipOutcomes.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  sharesAmount: real("shares_amount").notNull(), // positive=buy, negative=sell
  collateralCost: real("collateral_cost").notNull(),
  priceAtTrade: real("price_at_trade").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const poolTradesRelations = relations(poolTrades, ({ one }) => ({
  pool: one(championshipPools, { fields: [poolTrades.poolId], references: [championshipPools.id] }),
  outcome: one(championshipOutcomes, { fields: [poolTrades.outcomeId], references: [championshipOutcomes.id] }),
  user: one(users, { fields: [poolTrades.userId], references: [users.id] }),
}));

// Pool Positions - User holdings in pool outcomes
export const poolPositions = pgTable("pool_positions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  poolId: varchar("pool_id").notNull().references(() => championshipPools.id),
  outcomeId: varchar("outcome_id").notNull().references(() => championshipOutcomes.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  sharesOwned: real("shares_owned").notNull().default(0),
  totalCost: real("total_cost").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const poolPositionsRelations = relations(poolPositions, ({ one }) => ({
  pool: one(championshipPools, { fields: [poolPositions.poolId], references: [championshipPools.id] }),
  outcome: one(championshipOutcomes, { fields: [poolPositions.outcomeId], references: [championshipOutcomes.id] }),
  user: one(users, { fields: [poolPositions.userId], references: [users.id] }),
}));

// Pool Price History - tracks LMSR outcome prices over time for charts
export const poolPriceHistory = pgTable("pool_price_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  poolId: varchar("pool_id").notNull().references(() => championshipPools.id),
  outcomeId: varchar("outcome_id").notNull().references(() => championshipOutcomes.id),
  participantId: varchar("participant_id").notNull(),
  price: real("price").notNull(),
  recordedAt: timestamp("recorded_at").notNull().defaultNow(),
});

export const poolPriceHistoryRelations = relations(poolPriceHistory, ({ one }) => ({
  pool: one(championshipPools, { fields: [poolPriceHistory.poolId], references: [championshipPools.id] }),
  outcome: one(championshipOutcomes, { fields: [poolPriceHistory.outcomeId], references: [championshipOutcomes.id] }),
}));

// Insert schemas for pool tables
export const insertChampionshipPoolSchema = createInsertSchema(championshipPools).omit({
  id: true,
  createdAt: true,
});

export const insertChampionshipOutcomeSchema = createInsertSchema(championshipOutcomes).omit({
  id: true,
  createdAt: true,
});

export const insertPoolTradeSchema = createInsertSchema(poolTrades).omit({
  id: true,
  createdAt: true,
});

export const insertPoolPositionSchema = createInsertSchema(poolPositions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPoolPriceHistorySchema = createInsertSchema(poolPriceHistory).omit({
  id: true,
  recordedAt: true,
});

// Pool buy request schema
export const poolBuySchema = z.object({
  poolId: z.string(),
  outcomeId: z.string(),
  userId: z.string(),
  shares: z.number().positive(),
});

// Pool Payouts - Records prize distributions for pool winners
export const poolPayouts = pgTable("pool_payouts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  poolId: varchar("pool_id").notNull().references(() => championshipPools.id),
  outcomeId: varchar("outcome_id").notNull().references(() => championshipOutcomes.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  sharesHeld: real("shares_held").notNull(),
  sharePercentage: real("share_percentage").notNull(),
  payoutAmount: real("payout_amount").notNull(),
  polygonTxHash: text("polygon_tx_hash"),
  status: text("status").notNull().default("pending"), // 'pending', 'sent', 'failed'
  createdAt: timestamp("created_at").notNull().defaultNow(),
  paidAt: timestamp("paid_at"),
}, (table) => ({
  poolUserUnique: unique().on(table.poolId, table.userId),
}));

export const poolPayoutsRelations = relations(poolPayouts, ({ one }) => ({
  pool: one(championshipPools, { fields: [poolPayouts.poolId], references: [championshipPools.id] }),
  outcome: one(championshipOutcomes, { fields: [poolPayouts.outcomeId], references: [championshipOutcomes.id] }),
  user: one(users, { fields: [poolPayouts.userId], references: [users.id] }),
}));

export const insertPoolPayoutSchema = createInsertSchema(poolPayouts).omit({
  id: true,
  createdAt: true,
  paidAt: true,
});

// Pool Types
export type InsertChampionshipPool = z.infer<typeof insertChampionshipPoolSchema>;
export type ChampionshipPool = typeof championshipPools.$inferSelect;
export type InsertChampionshipOutcome = z.infer<typeof insertChampionshipOutcomeSchema>;
export type ChampionshipOutcome = typeof championshipOutcomes.$inferSelect;
export type InsertPoolTrade = z.infer<typeof insertPoolTradeSchema>;
export type PoolTrade = typeof poolTrades.$inferSelect;
export type InsertPoolPosition = z.infer<typeof insertPoolPositionSchema>;
export type PoolPosition = typeof poolPositions.$inferSelect;
export type PoolBuyRequest = z.infer<typeof poolBuySchema>;
export type InsertPoolPayout = z.infer<typeof insertPoolPayoutSchema>;
export type PoolPayout = typeof poolPayouts.$inferSelect;
export type InsertPoolPriceHistory = z.infer<typeof insertPoolPriceHistorySchema>;
export type PoolPriceHistory = typeof poolPriceHistory.$inferSelect;

// =====================================================
// Race Markets - Individual F1 race betting markets
// =====================================================

// Race Markets - Tracks individual races enabled for betting
export const raceMarkets = pgTable("race_markets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(), // e.g., "Australian Grand Prix 2026"
  shortName: text("short_name").notNull(), // e.g., "AUS"
  location: text("location").notNull(), // e.g., "Melbourne, Australia"
  raceDate: timestamp("race_date").notNull(),
  polymarketConditionId: text("polymarket_condition_id"), // Polymarket condition ID if linked
  polymarketSlug: text("polymarket_slug"), // Polymarket market slug
  status: text("status").notNull().default("upcoming"), // 'upcoming', 'active', 'completed'
  winnerDriverId: varchar("winner_driver_id").references(() => drivers.id),
  isVisible: boolean("is_visible").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const raceMarketsRelations = relations(raceMarkets, ({ one, many }) => ({
  winner: one(drivers, { fields: [raceMarkets.winnerDriverId], references: [drivers.id] }),
  outcomes: many(raceMarketOutcomes),
}));

// Race Market Outcomes - Polymarket token IDs for each driver in a race
export const raceMarketOutcomes = pgTable("race_market_outcomes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  raceMarketId: varchar("race_market_id").notNull().references(() => raceMarkets.id),
  driverId: varchar("driver_id").notNull().references(() => drivers.id),
  polymarketTokenId: text("polymarket_token_id").notNull(), // Token ID for this outcome
  currentPrice: real("current_price").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  raceDriverUnique: unique().on(table.raceMarketId, table.driverId),
}));

export const raceMarketOutcomesRelations = relations(raceMarketOutcomes, ({ one }) => ({
  raceMarket: one(raceMarkets, { fields: [raceMarketOutcomes.raceMarketId], references: [raceMarkets.id] }),
  driver: one(drivers, { fields: [raceMarketOutcomes.driverId], references: [drivers.id] }),
}));

// Insert schemas for race markets
export const insertRaceMarketSchema = createInsertSchema(raceMarkets).omit({
  id: true,
  createdAt: true,
});

export const insertRaceMarketOutcomeSchema = createInsertSchema(raceMarketOutcomes).omit({
  id: true,
  createdAt: true,
});

// Race Market Types
export type InsertRaceMarket = z.infer<typeof insertRaceMarketSchema>;
export type RaceMarket = typeof raceMarkets.$inferSelect;
export type InsertRaceMarketOutcome = z.infer<typeof insertRaceMarketOutcomeSchema>;
export type RaceMarketOutcome = typeof raceMarketOutcomes.$inferSelect;

// =====================================================
// zkTLS / TLSNotary Proof Tables (DEPRECATED - resolution handled by Polymarket)
// =====================================================

// ZK Proofs - Stores TLSNotary proofs for trustless result verification
export const zkProofs = pgTable("zk_proofs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  poolId: varchar("pool_id").notNull().references(() => championshipPools.id),
  submittedBy: varchar("submitted_by").notNull().references(() => users.id),
  serverDomain: text("server_domain").notNull(), // e.g., "formula1.com"
  attestationData: text("attestation_data").notNull(), // JSON blob from TLSNotary
  notaryPublicKey: text("notary_public_key").notNull(), // Public key of the Notary that signed
  extractedWinnerId: varchar("extracted_winner_id"), // Parsed winner (team or driver ID)
  extractedWinnerName: text("extracted_winner_name"), // Human-readable winner name
  disclosedTranscript: text("disclosed_transcript"), // The revealed portion of the TLS transcript
  verificationStatus: text("verification_status").notNull().default("pending"), // 'pending', 'verified', 'rejected'
  rejectionReason: text("rejection_reason"), // Reason if verification failed
  verifiedAt: timestamp("verified_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const zkProofsRelations = relations(zkProofs, ({ one }) => ({
  pool: one(championshipPools, { fields: [zkProofs.poolId], references: [championshipPools.id] }),
  submitter: one(users, { fields: [zkProofs.submittedBy], references: [users.id] }),
}));

// Insert schema for zk proofs
export const insertZkProofSchema = createInsertSchema(zkProofs).omit({
  id: true,
  createdAt: true,
  verifiedAt: true,
});

// Proof submission request schema
export const submitProofSchema = z.object({
  poolId: z.string(),
  userId: z.string(),
  proofJson: z.string(), // The full TLSNotary proof JSON
});

// ZK Proof Types
export type InsertZkProof = z.infer<typeof insertZkProofSchema>;
export type ZkProof = typeof zkProofs.$inferSelect;
export type SubmitProofRequest = z.infer<typeof submitProofSchema>;

// =====================================================
// Polymarket Orders Table - Tracks orders placed on Polymarket
// =====================================================

export const polymarketOrders = pgTable("polymarket_orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  polymarketOrderId: text("polymarket_order_id"), // Order ID from Polymarket API (if available)
  userId: varchar("user_id").notNull().references(() => users.id),
  tokenId: text("token_id").notNull(), // Polymarket token ID
  marketName: text("market_name"), // Human-readable market name (e.g., "Max Verstappen")
  outcome: text("outcome").notNull(), // "YES" or "NO"
  side: text("side").notNull(), // "BUY" or "SELL"
  price: real("price").notNull(), // Price per share (0-1)
  size: real("size").notNull(), // Number of shares
  filledSize: real("filled_size").notNull().default(0), // How many shares have been filled
  status: text("status").notNull().default("pending"), // 'pending', 'open', 'filled', 'partial', 'cancelled', 'expired'
  totalCost: real("total_cost").notNull(), // Total USDC spent
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  lastSyncedAt: timestamp("last_synced_at"),
});

export const polymarketOrdersRelations = relations(polymarketOrders, ({ one }) => ({
  user: one(users, { fields: [polymarketOrders.userId], references: [users.id] }),
}));

export const insertPolymarketOrderSchema = createInsertSchema(polymarketOrders).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastSyncedAt: true,
});

// Polymarket Order Types
export type InsertPolymarketOrder = z.infer<typeof insertPolymarketOrderSchema>;
export type PolymarketOrder = typeof polymarketOrders.$inferSelect;
