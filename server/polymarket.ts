import { createHmac } from "crypto";
import { ClobClient, Side, OrderType } from "@polymarket/clob-client";
import { Wallet } from "@ethersproject/wallet";
import { buildHmacSignature, BuilderApiKeyCreds } from "@polymarket/builder-signing-sdk";

const GAMMA_API_URL = "https://gamma-api.polymarket.com";
const CLOB_API_URL = "https://clob.polymarket.com";
const POLYGON_CHAIN_ID = 137;

// Signature types for Polymarket
// 0: EOA (Externally Owned Account) - direct wallet
// 1: Email/Magic Login wallet (PolyProxy)
// 2: Browser wallet with Polymarket Proxy (PolyGnosisSafe)
const SIGNATURE_TYPE = 0; // EOA since we're using a direct private key

// Cached CLOB client instance
let clobClientInstance: ClobClient | null = null;
let clobClientInitPromise: Promise<ClobClient> | null = null;

// Initialize or get the CLOB client with API credentials
async function getClobClient(): Promise<ClobClient | null> {
  // Private key is securely stored in Replit Secrets, accessed via environment variable
  const privateKey = process.env.POLY_BUILDER_PRIVATE_KEY;
  
  if (!privateKey) {
    console.warn("POLY_BUILDER_PRIVATE_KEY not configured in environment secrets");
    return null;
  }

  // Return cached instance if available
  if (clobClientInstance) {
    return clobClientInstance;
  }

  // Avoid multiple concurrent initializations
  if (clobClientInitPromise) {
    return clobClientInitPromise;
  }

  clobClientInitPromise = (async () => {
    try {
      // Ensure private key has 0x prefix
      const formattedKey = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
      
      // Use ethers v5 Wallet from @ethersproject/wallet (bundled with clob-client)
      const wallet = new Wallet(formattedKey);
      const walletAddress = await wallet.getAddress();
      
      // First create a temporary client to derive API credentials
      const tempClient = new ClobClient(
        CLOB_API_URL,
        POLYGON_CHAIN_ID,
        wallet
      );

      // Derive or create API credentials
      const creds = await tempClient.createOrDeriveApiKey();
      
      // Create the full client with credentials, signature type, and funder
      // For EOA (signatureType 0), the funder is the wallet address itself
      const client = new ClobClient(
        CLOB_API_URL,
        POLYGON_CHAIN_ID,
        wallet,
        creds,
        SIGNATURE_TYPE,
        walletAddress // funder - the address that funds the trades
      );
      
      console.log("CLOB client initialized successfully for address:", walletAddress);
      clobClientInstance = client;
      return client;
    } catch (error) {
      console.error("Failed to initialize CLOB client:", error);
      clobClientInitPromise = null;
      throw error;
    }
  })();

  return clobClientInitPromise;
}

// Check if order execution is available
export function hasOrderExecutionCredentials(): boolean {
  return !!process.env.POLY_BUILDER_PRIVATE_KEY;
}

// Order execution result
export interface OrderExecutionResult {
  success: boolean;
  orderId?: string;
  status?: string;
  filledSize?: number;
  message?: string;
  error?: string;
}

// Execute a limit order on Polymarket CLOB
export async function executePolymarketOrder(
  tokenId: string,
  side: "BUY" | "SELL",
  price: number,
  size: number,
  negRisk: boolean = true // F1 championship markets use negative risk
): Promise<OrderExecutionResult> {
  try {
    const client = await getClobClient();
    if (!client) {
      return {
        success: false,
        error: "CLOB client not available - check environment secrets"
      };
    }

    console.log("Creating order:", { tokenId, side, price, size, negRisk });

    // Convert string side to Side enum
    const orderSide = side === "BUY" ? Side.BUY : Side.SELL;

    // Create and sign a limit order with required options
    const order = await client.createOrder(
      {
        tokenID: tokenId,
        side: orderSide,
        price: price,
        size: size,
      },
      {
        tickSize: "0.01", // Standard tick size for most markets
        negRisk: negRisk, // F1 markets typically use negative risk
      }
    );

    console.log("Order created, submitting to CLOB...");

    // Submit the order to the CLOB as GTC (Good-Till-Cancelled)
    const response = await client.postOrder(order, OrderType.GTC);

    console.log("Order response:", response);

    if (response && response.orderID) {
      return {
        success: true,
        orderId: response.orderID,
        status: normalizeOrderStatus(response.status),
        message: "Order placed successfully on Polymarket"
      };
    } else {
      return {
        success: false,
        error: response?.errorMsg || "Failed to place order - no order ID returned"
      };
    }
  } catch (error) {
    console.error("Failed to execute Polymarket order:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: errorMessage
    };
  }
}

// Normalize CLOB order status to our schema vocabulary
function normalizeOrderStatus(clobStatus: string | undefined): string {
  if (!clobStatus) return "pending";
  
  const statusUpper = clobStatus.toUpperCase();
  switch (statusUpper) {
    case "OPEN":
    case "LIVE":
      return "open";
    case "MATCHED":
    case "FILLED":
      return "filled";
    case "CANCELED":
    case "CANCELLED":
      return "cancelled";
    case "EXPIRED":
      return "expired";
    case "PARTIAL":
    case "PARTIALLY_FILLED":
      return "partial";
    default:
      return "pending";
  }
}

// Get order status from CLOB
export async function getOrderStatus(orderId: string): Promise<any> {
  try {
    const client = await getClobClient();
    if (!client) {
      return null;
    }

    const order = await client.getOrder(orderId);
    if (order) {
      // Normalize status before returning
      return {
        ...order,
        normalizedStatus: normalizeOrderStatus(order.status)
      };
    }
    return order;
  } catch (error) {
    console.error("Failed to get order status:", error);
    return null;
  }
}

// Get all open orders for the builder account
export async function getOpenOrders(): Promise<any[]> {
  try {
    const client = await getClobClient();
    if (!client) {
      return [];
    }

    const orders = await client.getOpenOrders();
    return orders || [];
  } catch (error) {
    console.error("Failed to get open orders:", error);
    return [];
  }
}

// Cache for 24h price changes - per-token timestamps for proper expiration
interface TokenPriceChange {
  change: number;
  timestamp: number;
}
const priceChangeCache = new Map<string, TokenPriceChange>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Fetch 24h price change for a single token
async function fetch24hPriceChange(tokenId: string): Promise<number> {
  try {
    const response = await fetch(
      `${CLOB_API_URL}/prices-history?market=${tokenId}&interval=1d&fidelity=60`,
      {
        headers: {
          "Accept": "application/json",
          "User-Agent": "Mozilla/5.0",
        },
      }
    );
    
    if (!response.ok) return 0;
    
    const data = await response.json();
    if (!data?.history || data.history.length < 2) return 0;
    
    // Get the first (oldest) and last (newest) prices from 24h history
    const history = data.history;
    const oldestPrice = parseFloat(history[0]?.p || "0");
    const newestPrice = parseFloat(history[history.length - 1]?.p || "0");
    
    if (oldestPrice === 0) return 0;
    
    return ((newestPrice - oldestPrice) / oldestPrice) * 100;
  } catch (error) {
    return 0;
  }
}

// Batch fetch price changes for multiple tokens with per-token caching
export async function getPriceChanges(tokenIds: string[]): Promise<Map<string, number>> {
  const now = Date.now();
  const result = new Map<string, number>();
  const tokensToFetch: string[] = [];
  
  // Check cache for each token, collect those that need fetching
  for (const tokenId of tokenIds) {
    const cached = priceChangeCache.get(tokenId);
    if (cached && now - cached.timestamp < CACHE_DURATION) {
      result.set(tokenId, cached.change);
    } else {
      tokensToFetch.push(tokenId);
    }
  }
  
  // If all tokens are cached, return immediately
  if (tokensToFetch.length === 0) {
    return result;
  }
  
  // Fetch price changes for missing tokens in parallel (with rate limiting)
  const batchSize = 5;
  for (let i = 0; i < tokensToFetch.length; i += batchSize) {
    const batch = tokensToFetch.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (tokenId) => {
        const change = await fetch24hPriceChange(tokenId);
        return { tokenId, change };
      })
    );
    
    for (const { tokenId, change } of results) {
      // Update cache with per-token timestamp
      priceChangeCache.set(tokenId, { change, timestamp: now });
      result.set(tokenId, change);
    }
    
    // Small delay between batches to respect rate limits
    if (i + batchSize < tokensToFetch.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  return result;
}

export interface BuilderSignatureHeaders {
  POLY_BUILDER_API_KEY: string;
  POLY_BUILDER_PASSPHRASE: string;
  POLY_BUILDER_SIGNATURE: string;
  POLY_BUILDER_TIMESTAMP: string;
}

export async function generateBuilderSignature(
  method: string,
  path: string,
  body: string = ""
): Promise<BuilderSignatureHeaders | null> {
  const apiKey = process.env.POLY_BUILDER_API_KEY;
  const secret = process.env.POLY_BUILDER_SECRET;
  const passphrase = process.env.POLY_BUILDER_PASSPHRASE;

  if (!apiKey || !secret || !passphrase) {
    console.warn("Builder credentials not configured");
    return null;
  }

  // Use the official Polymarket SDK for signature generation
  const { buildHmacSignature } = await import("@polymarket/builder-signing-sdk");
  
  const timestamp = Date.now();
  const signature = buildHmacSignature(
    secret,
    timestamp,
    method.toUpperCase(),
    path,
    body
  );

  return {
    POLY_BUILDER_API_KEY: apiKey,
    POLY_BUILDER_PASSPHRASE: passphrase,
    POLY_BUILDER_SIGNATURE: signature,
    POLY_BUILDER_TIMESTAMP: String(timestamp),
  };
}

export function hasBuilderCredentials(): boolean {
  return !!(
    process.env.POLY_BUILDER_API_KEY &&
    process.env.POLY_BUILDER_SECRET &&
    process.env.POLY_BUILDER_PASSPHRASE
  );
}

export interface PolymarketMarket {
  id: string;
  conditionId: string;
  questionId: string;
  question: string;
  slug: string;
  description: string;
  outcomes: string[];
  outcomePrices: string[];
  volume: string;
  liquidity: string;
  endDate: string;
  closed: boolean;
  active: boolean;
  tokens: Array<{
    token_id: string;
    outcome: string;
    price: number;
  }>;
  tags: string[];
  image?: string;
}

export interface PolymarketEvent {
  id: string;
  slug: string;
  title: string;
  description: string;
  markets: PolymarketMarket[];
  startDate: string;
  endDate: string;
  image?: string;
  tags: string[];
}

function parseMarket(market: any): PolymarketMarket {
  return {
    id: market.id || market.condition_id,
    conditionId: market.condition_id,
    questionId: market.question_id,
    question: market.question,
    slug: market.slug,
    description: market.description || "",
    outcomes: market.outcomes ? (typeof market.outcomes === "string" ? JSON.parse(market.outcomes) : market.outcomes) : ["Yes", "No"],
    outcomePrices: market.outcomePrices ? (typeof market.outcomePrices === "string" ? JSON.parse(market.outcomePrices) : market.outcomePrices) : ["0.5", "0.5"],
    volume: market.volume || "0",
    liquidity: market.liquidity || "0",
    endDate: market.end_date_iso || market.end_date,
    closed: market.closed === true || market.closed === "true",
    active: market.active === true || market.active === "true",
    tokens: market.tokens || [],
    tags: market.tags ? (typeof market.tags === "string" ? JSON.parse(market.tags) : market.tags) : [],
    image: market.image,
  };
}

export async function fetchF1Markets(): Promise<PolymarketMarket[]> {
  try {
    const params = new URLSearchParams({
      tag: "Formula 1",
      active: "true",
      limit: "100",
    });

    const response = await fetch(`${GAMMA_API_URL}/markets?${params}`);
    if (!response.ok) {
      throw new Error(`Gamma API error: ${response.status}`);
    }

    const data = await response.json();
    return data.map(parseMarket);
  } catch (error) {
    console.error("Failed to fetch F1 markets from Polymarket:", error);
    return [];
  }
}

export async function fetchAllF1Markets(): Promise<PolymarketMarket[]> {
  try {
    const params = new URLSearchParams({
      tag: "Formula 1",
      limit: "100",
    });

    const response = await fetch(`${GAMMA_API_URL}/markets?${params}`);
    if (!response.ok) {
      throw new Error(`Gamma API error: ${response.status}`);
    }

    const data = await response.json();
    return data.map(parseMarket);
  } catch (error) {
    console.error("Failed to fetch all F1 markets from Polymarket:", error);
    return [];
  }
}

export async function fetchF1Events(): Promise<PolymarketEvent[]> {
  try {
    const params = new URLSearchParams({
      tag: "Formula 1",
      active: "true",
      limit: "50",
    });

    const response = await fetch(`${GAMMA_API_URL}/events?${params}`);
    if (!response.ok) {
      throw new Error(`Gamma API error: ${response.status}`);
    }

    const data = await response.json();
    
    return data.map((event: any) => ({
      id: event.id,
      slug: event.slug,
      title: event.title,
      description: event.description || "",
      markets: (event.markets || []).map(parseMarket),
      startDate: event.start_date,
      endDate: event.end_date,
      image: event.image,
      tags: event.tags || [],
    }));
  } catch (error) {
    console.error("Failed to fetch F1 events from Polymarket:", error);
    return [];
  }
}

export async function getMarketBySlug(slug: string): Promise<PolymarketMarket | null> {
  try {
    const params = new URLSearchParams({ slug });

    const response = await fetch(`${GAMMA_API_URL}/markets?${params}`);
    if (!response.ok) {
      throw new Error(`Gamma API error: ${response.status}`);
    }

    const data = await response.json();
    if (!data || data.length === 0) {
      return null;
    }

    return parseMarket(data[0]);
  } catch (error) {
    console.error(`Failed to fetch market by slug ${slug}:`, error);
    return null;
  }
}

export async function getMarketById(conditionId: string): Promise<PolymarketMarket | null> {
  try {
    const params = new URLSearchParams({ condition_id: conditionId });

    const response = await fetch(`${GAMMA_API_URL}/markets?${params}`);
    if (!response.ok) {
      throw new Error(`Gamma API error: ${response.status}`);
    }

    const data = await response.json();
    if (!data || data.length === 0) {
      return null;
    }

    return parseMarket(data[0]);
  } catch (error) {
    console.error(`Failed to fetch market by id ${conditionId}:`, error);
    return null;
  }
}

export async function getOrderBook(tokenId: string) {
  try {
    const response = await fetch(`${CLOB_API_URL}/book?token_id=${tokenId}`);
    if (!response.ok) {
      throw new Error(`CLOB API error: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error(`Failed to fetch order book for token ${tokenId}:`, error);
    return null;
  }
}

export async function getMidpoint(tokenId: string): Promise<number | null> {
  try {
    const response = await fetch(`${CLOB_API_URL}/midpoint?token_id=${tokenId}`);
    if (!response.ok) {
      throw new Error(`CLOB API error: ${response.status}`);
    }
    const data = await response.json();
    return parseFloat(data.mid);
  } catch (error) {
    console.error(`Failed to fetch midpoint for token ${tokenId}:`, error);
    return null;
  }
}

export async function getPrice(tokenId: string, side: "BUY" | "SELL"): Promise<number | null> {
  try {
    const response = await fetch(`${CLOB_API_URL}/price?token_id=${tokenId}&side=${side}`);
    if (!response.ok) {
      throw new Error(`CLOB API error: ${response.status}`);
    }
    const data = await response.json();
    return parseFloat(data.price);
  } catch (error) {
    console.error(`Failed to fetch price for token ${tokenId}:`, error);
    return null;
  }
}

export async function searchMarkets(query: string): Promise<PolymarketMarket[]> {
  try {
    const params = new URLSearchParams({
      search: query,
      active: "true",
      limit: "50",
    });

    const response = await fetch(`${GAMMA_API_URL}/markets?${params}`);
    if (!response.ok) {
      throw new Error(`Gamma API error: ${response.status}`);
    }

    const data = await response.json();
    return data.map(parseMarket);
  } catch (error) {
    console.error(`Failed to search markets for "${query}":`, error);
    return [];
  }
}

// Cache for event data
const eventCache = new Map<string, { data: PolymarketEvent; timestamp: number }>();
const CACHE_TTL = 60000; // 1 minute cache

export async function getEventBySlug(slug: string): Promise<PolymarketEvent | null> {
  // Check cache first
  const cached = eventCache.get(slug);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const response = await fetch(`${GAMMA_API_URL}/events?slug=${encodeURIComponent(slug)}`);
    if (!response.ok) {
      throw new Error(`Gamma API error: ${response.status}`);
    }

    const data = await response.json();
    if (!data || data.length === 0) {
      return null;
    }

    const event = data[0];
    const parsed: PolymarketEvent = {
      id: event.id,
      slug: event.slug,
      title: event.title,
      description: event.description || "",
      markets: (event.markets || []).map(parseMarket),
      startDate: event.start_date,
      endDate: event.end_date,
      image: event.image,
      tags: event.tags || [],
    };

    // Cache the result
    eventCache.set(slug, { data: parsed, timestamp: Date.now() });
    return parsed;
  } catch (error) {
    console.error(`Failed to fetch event by slug ${slug}:`, error);
    return null;
  }
}

export interface NormalizedOutcome {
  id: string;
  name: string;
  tokenId: string;
  yesTokenId: string;
  noTokenId: string;
  price: number;
  noPrice: number;
  volume: string;
  liquidity: string;
  conditionId: string;
  questionId: string;
  image?: string;
  priceChange?: number;
}

// Fallback F1 Constructors data based on current Polymarket markets
const fallbackConstructors: NormalizedOutcome[] = [
  { id: "mercedes", name: "Mercedes", tokenId: "mercedes-yes", yesTokenId: "mercedes-yes", noTokenId: "mercedes-no", price: 0.33, noPrice: 0.67, volume: "116671", liquidity: "50000", conditionId: "mercedes", questionId: "mercedes" },
  { id: "mclaren", name: "McLaren", tokenId: "mclaren-yes", yesTokenId: "mclaren-yes", noTokenId: "mclaren-no", price: 0.29, noPrice: 0.71, volume: "570288", liquidity: "120000", conditionId: "mclaren", questionId: "mclaren" },
  { id: "redbull", name: "Red Bull Racing", tokenId: "redbull-yes", yesTokenId: "redbull-yes", noTokenId: "redbull-no", price: 0.15, noPrice: 0.85, volume: "5256", liquidity: "15000", conditionId: "redbull", questionId: "redbull" },
  { id: "ferrari", name: "Ferrari", tokenId: "ferrari-yes", yesTokenId: "ferrari-yes", noTokenId: "ferrari-no", price: 0.12, noPrice: 0.88, volume: "6709", liquidity: "18000", conditionId: "ferrari", questionId: "ferrari" },
  { id: "astonmartin", name: "Aston Martin", tokenId: "astonmartin-yes", yesTokenId: "astonmartin-yes", noTokenId: "astonmartin-no", price: 0.08, noPrice: 0.92, volume: "3159", liquidity: "8000", conditionId: "astonmartin", questionId: "astonmartin" },
  { id: "williams", name: "Williams", tokenId: "williams-yes", yesTokenId: "williams-yes", noTokenId: "williams-no", price: 0.03, noPrice: 0.97, volume: "1995", liquidity: "5000", conditionId: "williams", questionId: "williams" },
  { id: "audi", name: "Audi", tokenId: "audi-yes", yesTokenId: "audi-yes", noTokenId: "audi-no", price: 0.036, noPrice: 0.964, volume: "1564", liquidity: "4000", conditionId: "audi", questionId: "audi" },
  { id: "alpine", name: "Alpine", tokenId: "alpine-yes", yesTokenId: "alpine-yes", noTokenId: "alpine-no", price: 0.025, noPrice: 0.975, volume: "2101", liquidity: "5500", conditionId: "alpine", questionId: "alpine" },
  { id: "cadillac", name: "Cadillac", tokenId: "cadillac-yes", yesTokenId: "cadillac-yes", noTokenId: "cadillac-no", price: 0.024, noPrice: 0.976, volume: "2784", liquidity: "7000", conditionId: "cadillac", questionId: "cadillac" },
  { id: "haas", name: "Haas", tokenId: "haas-yes", yesTokenId: "haas-yes", noTokenId: "haas-no", price: 0.004, noPrice: 0.996, volume: "1552", liquidity: "4000", conditionId: "haas", questionId: "haas" },
  { id: "rb", name: "Racing Bulls", tokenId: "rb-yes", yesTokenId: "rb-yes", noTokenId: "rb-no", price: 0.003, noPrice: 0.997, volume: "1700", liquidity: "4500", conditionId: "rb", questionId: "rb" },
];

export async function getConstructorsMarket(): Promise<NormalizedOutcome[]> {
  try {
    // Fetch directly from Gamma API with proper format
    const response = await fetch(`${GAMMA_API_URL}/events?slug=f1-constructors-champion`, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0",
      },
    });
    
    if (!response.ok) {
      console.log("Polymarket API error, using fallback data");
      return fallbackConstructors;
    }
    
    const data = await response.json();
    if (!data || data.length === 0 || !data[0]?.markets) {
      console.log("No data from Polymarket API, using fallback");
      return fallbackConstructors;
    }
    
    const event = data[0];
    const outcomes: NormalizedOutcome[] = [];
    
    for (const market of event.markets) {
      // Parse the JSON strings from the API
      const outcomePrices = typeof market.outcomePrices === "string" 
        ? JSON.parse(market.outcomePrices) 
        : market.outcomePrices || [];
      const clobTokenIds = typeof market.clobTokenIds === "string"
        ? JSON.parse(market.clobTokenIds)
        : market.clobTokenIds || [];
      
      // Get the YES/NO prices and token IDs
      const yesPrice = parseFloat(outcomePrices[0] || "0");
      const noPrice = parseFloat(outcomePrices[1] || "0");
      const yesTokenId = clobTokenIds[0] || "";
      const noTokenId = clobTokenIds[1] || "";
      
      // Extract team name from groupItemTitle or question
      const teamName = market.groupItemTitle || 
        market.question?.replace("Will ", "").replace(" be the 2026 F1 Constructors' Champion?", "").trim() || 
        "Unknown";
      
      outcomes.push({
        id: market.id,
        name: teamName,
        tokenId: yesTokenId,
        yesTokenId: yesTokenId,
        noTokenId: noTokenId,
        price: yesPrice,
        noPrice: noPrice,
        volume: market.volume || "0",
        liquidity: market.liquidity || "0",
        conditionId: market.conditionId,
        questionId: market.questionID || market.questionId,
        image: market.image,
      });
    }
    
    console.log(`Fetched ${outcomes.length} constructor markets from Polymarket`);
    return outcomes.length > 0 ? outcomes : fallbackConstructors;
  } catch (error) {
    console.error("Error fetching constructors from Polymarket:", error);
    return fallbackConstructors;
  }
}

// Fallback F1 Drivers data based on current Polymarket markets
const fallbackDrivers: NormalizedOutcome[] = [
  { id: "verstappen", name: "Max Verstappen", tokenId: "verstappen-yes", yesTokenId: "verstappen-yes", noTokenId: "verstappen-no", price: 0.24, noPrice: 0.76, volume: "50000", liquidity: "25000", conditionId: "verstappen", questionId: "verstappen" },
  { id: "norris", name: "Lando Norris", tokenId: "norris-yes", yesTokenId: "norris-yes", noTokenId: "norris-no", price: 0.22, noPrice: 0.78, volume: "45000", liquidity: "22000", conditionId: "norris", questionId: "norris" },
  { id: "hamilton", name: "Lewis Hamilton", tokenId: "hamilton-yes", yesTokenId: "hamilton-yes", noTokenId: "hamilton-no", price: 0.18, noPrice: 0.82, volume: "40000", liquidity: "20000", conditionId: "hamilton", questionId: "hamilton" },
  { id: "russell", name: "George Russell", tokenId: "russell-yes", yesTokenId: "russell-yes", noTokenId: "russell-no", price: 0.12, noPrice: 0.88, volume: "25000", liquidity: "12000", conditionId: "russell", questionId: "russell" },
  { id: "leclerc", name: "Charles Leclerc", tokenId: "leclerc-yes", yesTokenId: "leclerc-yes", noTokenId: "leclerc-no", price: 0.08, noPrice: 0.92, volume: "20000", liquidity: "10000", conditionId: "leclerc", questionId: "leclerc" },
  { id: "piastri", name: "Oscar Piastri", tokenId: "piastri-yes", yesTokenId: "piastri-yes", noTokenId: "piastri-no", price: 0.06, noPrice: 0.94, volume: "15000", liquidity: "7500", conditionId: "piastri", questionId: "piastri" },
  { id: "antonelli", name: "Kimi Antonelli", tokenId: "antonelli-yes", yesTokenId: "antonelli-yes", noTokenId: "antonelli-no", price: 0.04, noPrice: 0.96, volume: "10000", liquidity: "5000", conditionId: "antonelli", questionId: "antonelli" },
  { id: "alonso", name: "Fernando Alonso", tokenId: "alonso-yes", yesTokenId: "alonso-yes", noTokenId: "alonso-no", price: 0.02, noPrice: 0.98, volume: "8000", liquidity: "4000", conditionId: "alonso", questionId: "alonso" },
  { id: "sainz", name: "Carlos Sainz", tokenId: "sainz-yes", yesTokenId: "sainz-yes", noTokenId: "sainz-no", price: 0.015, noPrice: 0.985, volume: "5000", liquidity: "2500", conditionId: "sainz", questionId: "sainz" },
  { id: "lawson", name: "Liam Lawson", tokenId: "lawson-yes", yesTokenId: "lawson-yes", noTokenId: "lawson-no", price: 0.01, noPrice: 0.99, volume: "3000", liquidity: "1500", conditionId: "lawson", questionId: "lawson" },
];

export async function getDriversMarket(): Promise<NormalizedOutcome[]> {
  try {
    // Fetch directly from Gamma API with proper format
    const response = await fetch(`${GAMMA_API_URL}/events?slug=2026-f1-drivers-champion`, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0",
      },
    });
    
    if (!response.ok) {
      console.log("Polymarket API error for drivers, using fallback data");
      return fallbackDrivers;
    }
    
    const data = await response.json();
    if (!data || data.length === 0 || !data[0]?.markets) {
      console.log("No driver data from Polymarket API, using fallback");
      return fallbackDrivers;
    }
    
    const event = data[0];
    const outcomes: NormalizedOutcome[] = [];
    
    for (const market of event.markets) {
      // Parse the JSON strings from the API
      const outcomePrices = typeof market.outcomePrices === "string" 
        ? JSON.parse(market.outcomePrices) 
        : market.outcomePrices || [];
      const clobTokenIds = typeof market.clobTokenIds === "string"
        ? JSON.parse(market.clobTokenIds)
        : market.clobTokenIds || [];
      
      // Get the YES/NO prices and token IDs
      const yesPrice = parseFloat(outcomePrices[0] || "0");
      const noPrice = parseFloat(outcomePrices[1] || "0");
      const yesTokenId = clobTokenIds[0] || "";
      const noTokenId = clobTokenIds[1] || "";
      
      // Extract driver name from groupItemTitle or question
      const driverName = market.groupItemTitle || 
        market.question?.replace("Will ", "").replace(" be the 2026 F1 Drivers' Champion?", "").trim() || 
        "Unknown";
      
      outcomes.push({
        id: market.id,
        name: driverName,
        tokenId: yesTokenId,
        yesTokenId: yesTokenId,
        noTokenId: noTokenId,
        price: yesPrice,
        noPrice: noPrice,
        volume: market.volume || "0",
        liquidity: market.liquidity || "0",
        conditionId: market.conditionId,
        questionId: market.questionID || market.questionId,
        image: market.image,
      });
    }
    
    console.log(`Fetched ${outcomes.length} driver markets from Polymarket`);
    return outcomes.length > 0 ? outcomes : fallbackDrivers;
  } catch (error) {
    console.error("Error fetching drivers from Polymarket:", error);
    return fallbackDrivers;
  }
}

// ============ Polymarket Relayer Client Functions ============

// Get builder credentials from environment
function getBuilderCredentials(): BuilderApiKeyCreds | null {
  const key = process.env.POLY_BUILDER_API_KEY;
  const secret = process.env.POLY_BUILDER_SECRET;
  const passphrase = process.env.POLY_BUILDER_PASSPHRASE;
  
  if (!key || !secret || !passphrase) {
    console.warn("Builder API credentials not configured");
    return null;
  }
  
  return { key, secret, passphrase };
}

// Check if relayer credentials are available
export function hasRelayerCredentials(): boolean {
  return !!(
    process.env.POLY_BUILDER_API_KEY &&
    process.env.POLY_BUILDER_SECRET &&
    process.env.POLY_BUILDER_PASSPHRASE
  );
}

// Generate HMAC signature for relayer requests
// This is called by the client SDK via the /api/polymarket/relayer-sign endpoint
export interface RelayerSignRequest {
  method: string;
  path: string;
  body: string;
}

export interface RelayerSignResponse {
  POLY_BUILDER_SIGNATURE: string;
  POLY_BUILDER_TIMESTAMP: string;
  POLY_BUILDER_API_KEY: string;
  POLY_BUILDER_PASSPHRASE: string;
}

export function signRelayerRequest(request: RelayerSignRequest & { timestamp?: number }): RelayerSignResponse | null {
  const creds = getBuilderCredentials();
  if (!creds) {
    return null;
  }

  // Use provided timestamp or generate new one
  const timestamp = request.timestamp || Date.now();
  
  // Ensure body is a string (SDK may pass object or string)
  const bodyStr = typeof request.body === 'object' 
    ? JSON.stringify(request.body) 
    : (request.body || "");
  
  const signature = buildHmacSignature(
    creds.secret,
    timestamp,
    request.method,
    request.path,
    bodyStr
  );

  return {
    POLY_BUILDER_SIGNATURE: signature,
    POLY_BUILDER_TIMESTAMP: timestamp.toString(),
    POLY_BUILDER_API_KEY: creds.key,
    POLY_BUILDER_PASSPHRASE: creds.passphrase,
  };
}

// Polymarket Builder Relayer API base URL
// Note: The correct URL is relayer-v2.polymarket.com (not relayer.polymarket.com)
const RELAYER_URL = "https://relayer-v2.polymarket.com";

interface Transaction {
  to: string;
  data: string;
  value: string; // Hex format: "0x0"
}

// Normalize transaction value to hex format
function normalizeTransactionValue(value: string): string {
  if (value.startsWith("0x")) return value;
  const numValue = parseInt(value, 10) || 0;
  return `0x${numValue.toString(16)}`;
}

interface RelayerExecutionResult {
  success: boolean;
  transactionHash?: string;
  proxyAddress?: string;
  error?: string;
}

// Execute a relayer request server-side (credentials never leave the server)
async function executeRelayerHttpRequest(
  method: string,
  path: string,
  body: object | null
): Promise<{ id?: string; state?: string; transactionHash?: string; proxyAddress?: string; error?: string }> {
  const bodyStr = body ? JSON.stringify(body) : "";
  const signature = signRelayerRequest({ method, path, body: bodyStr });
  
  if (!signature) {
    throw new Error("Failed to generate relayer signature");
  }
  
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "POLY_BUILDER_SIGNATURE": signature.POLY_BUILDER_SIGNATURE,
    "POLY_BUILDER_TIMESTAMP": signature.POLY_BUILDER_TIMESTAMP,
    "POLY_BUILDER_API_KEY": signature.POLY_BUILDER_API_KEY,
    "POLY_BUILDER_PASSPHRASE": signature.POLY_BUILDER_PASSPHRASE,
  };
  
  const response = await fetch(`${RELAYER_URL}${path}`, {
    method,
    headers,
    body: bodyStr || undefined,
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Relayer request failed: ${errorText}`);
  }
  
  return response.json();
}

// Wait for a relayer transaction to complete
async function waitForRelayerTransaction(
  id: string,
  walletType: "safe" | "proxy" = "proxy"
): Promise<{ transactionHash: string; proxyAddress?: string } | null> {
  const maxAttempts = 60;
  const delayMs = 2000;
  const statusPath = `/v2/${walletType}/status/${id}`;
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise(resolve => setTimeout(resolve, delayMs));
    
    try {
      const signature = signRelayerRequest({ method: "GET", path: statusPath, body: "" });
      if (!signature) continue;
      
      const response = await fetch(`${RELAYER_URL}${statusPath}`, {
        headers: {
          "POLY_BUILDER_SIGNATURE": signature.POLY_BUILDER_SIGNATURE,
          "POLY_BUILDER_TIMESTAMP": signature.POLY_BUILDER_TIMESTAMP,
          "POLY_BUILDER_API_KEY": signature.POLY_BUILDER_API_KEY,
          "POLY_BUILDER_PASSPHRASE": signature.POLY_BUILDER_PASSPHRASE,
        },
      });
      
      if (!response.ok) continue;
      
      const status = await response.json();
      
      if (status.state === "CONFIRMED" || status.state === "SUCCESS") {
        return {
          transactionHash: status.transactionHash,
          proxyAddress: status.proxyAddress,
        };
      }
      
      if (status.state === "FAILED" || status.state === "REVERTED") {
        throw new Error(`Transaction failed: ${status.error || status.state}`);
      }
    } catch (error) {
      if (attempt === maxAttempts - 1) throw error;
    }
  }
  
  throw new Error("Transaction timed out");
}

// Execute transactions via the Polymarket relayer (gasless)
export async function executeRelayerTransaction(
  walletAddress: string,
  walletType: "safe" | "proxy",
  transactions: Transaction[],
  description: string
): Promise<RelayerExecutionResult> {
  try {
    const path = walletType === "safe" ? "/v2/safe/execute" : "/v2/proxy/execute";
    
    // Normalize all transaction values to hex format
    const normalizedTransactions = transactions.map(tx => ({
      ...tx,
      value: normalizeTransactionValue(tx.value),
    }));
    
    const body = {
      owner: walletAddress,
      transactions: normalizedTransactions,
      description,
    };
    
    const response = await executeRelayerHttpRequest("POST", path, body);
    
    if (response.error) {
      return { success: false, error: response.error };
    }
    
    if (!response.id) {
      return { success: false, error: "No transaction ID returned from relayer" };
    }
    
    const result = await waitForRelayerTransaction(response.id, walletType);
    if (!result) {
      return { success: false, error: "Transaction failed" };
    }
    
    return { 
      success: true, 
      transactionHash: result.transactionHash,
      proxyAddress: result.proxyAddress
    };
  } catch (error) {
    console.error("Relayer transaction failed:", error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : "Unknown error" 
    };
  }
}

// Deploy a Safe/Proxy wallet via the relayer
export async function deployRelayerWallet(
  walletAddress: string,
  walletType: "safe" | "proxy"
): Promise<RelayerExecutionResult> {
  try {
    const path = walletType === "safe" ? "/v2/safe/deploy" : "/v2/proxy/deploy";
    
    const body = {
      owner: walletAddress,
    };
    
    const response = await executeRelayerHttpRequest("POST", path, body);
    
    if (response.error) {
      return { success: false, error: response.error };
    }
    
    if (!response.id) {
      return { success: false, error: "No deployment ID returned from relayer" };
    }
    
    const result = await waitForRelayerTransaction(response.id, walletType);
    if (!result) {
      return { success: false, error: "Deployment failed" };
    }
    
    return { 
      success: true, 
      transactionHash: result.transactionHash,
      proxyAddress: result.proxyAddress
    };
  } catch (error) {
    console.error("Wallet deployment failed:", error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : "Unknown error" 
    };
  }
}
