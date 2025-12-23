import { createHmac } from "crypto";

const GAMMA_API_URL = "https://gamma-api.polymarket.com";
const CLOB_API_URL = "https://clob.polymarket.com";

export interface BuilderSignatureHeaders {
  POLY_BUILDER_API_KEY: string;
  POLY_BUILDER_PASSPHRASE: string;
  POLY_BUILDER_SIGNATURE: string;
  POLY_BUILDER_TIMESTAMP: string;
}

export function generateBuilderSignature(
  method: string,
  path: string,
  body: string = ""
): BuilderSignatureHeaders | null {
  const apiKey = process.env.POLY_BUILDER_API_KEY;
  const secret = process.env.POLY_BUILDER_SECRET;
  const passphrase = process.env.POLY_BUILDER_PASSPHRASE;

  if (!apiKey || !secret || !passphrase) {
    console.warn("Builder credentials not configured");
    return null;
  }

  const timestamp = String(Date.now());
  const message = timestamp + method.toUpperCase() + path + body;
  
  const secretBuffer = Buffer.from(secret, "base64");
  const signature = createHmac("sha256", secretBuffer)
    .update(message)
    .digest("hex");

  return {
    POLY_BUILDER_API_KEY: apiKey,
    POLY_BUILDER_PASSPHRASE: passphrase,
    POLY_BUILDER_SIGNATURE: signature,
    POLY_BUILDER_TIMESTAMP: timestamp,
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
