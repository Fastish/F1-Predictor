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
