import { ethers } from "ethers";

const CLOB_API_URL = "https://clob.polymarket.com";
const POLYGON_CHAIN_ID = 137;
const CTF_EXCHANGE_ADDRESS = "0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e";
const USDC_DECIMALS = 6;
const TOKEN_DECIMALS = 6;

const BROWSER_HEADERS = {
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Content-Type": "application/json",
  "Origin": "https://polymarket.com",
  "Referer": "https://polymarket.com/",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-site",
};

const EIP712_DOMAIN = {
  name: "Polymarket CTF Exchange",
  version: "1",
  chainId: POLYGON_CHAIN_ID,
  verifyingContract: CTF_EXCHANGE_ADDRESS,
};

const ORDER_TYPES = {
  Order: [
    { name: "salt", type: "uint256" },
    { name: "maker", type: "address" },
    { name: "signer", type: "address" },
    { name: "taker", type: "address" },
    { name: "tokenId", type: "uint256" },
    { name: "makerAmount", type: "uint256" },
    { name: "takerAmount", type: "uint256" },
    { name: "expiration", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "feeRateBps", type: "uint256" },
    { name: "side", type: "uint8" },
    { name: "signatureType", type: "uint8" },
  ],
};

export interface OrderParams {
  tokenId: string;
  price: number;
  size: number;
  side: "BUY" | "SELL";
}

export interface OrderResult {
  success: boolean;
  orderId?: string;
  status?: string;
  error?: string;
  transactionHash?: string;
}

export interface ApiCredentials {
  apiKey: string;
  secret: string;
  passphrase: string;
}

function generateSalt(): string {
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  return BigInt("0x" + Array.from(randomBytes).map(b => b.toString(16).padStart(2, "0")).join("")).toString();
}

function generateNonce(): string {
  return Math.floor(Math.random() * 1000000000).toString();
}

function base64UrlToBase64(base64url: string): string {
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return base64;
}

async function createHmacSignature(secret: string, timestamp: string, method: string, path: string, body: string = ""): Promise<string> {
  const message = timestamp + method + path + body;
  const encoder = new TextEncoder();
  
  let secretBytes: Uint8Array;
  
  if (/^[0-9a-fA-F]+$/.test(secret) && secret.length % 2 === 0) {
    const hexMatches = secret.match(/.{1,2}/g);
    if (!hexMatches) throw new Error("Invalid hex secret");
    secretBytes = new Uint8Array(hexMatches.map(byte => parseInt(byte, 16)));
  } else {
    try {
      const base64Standard = base64UrlToBase64(secret);
      const decoded = atob(base64Standard);
      secretBytes = Uint8Array.from(decoded, c => c.charCodeAt(0));
    } catch (e) {
      console.error("Failed to decode secret as base64, using raw bytes:", e);
      secretBytes = encoder.encode(secret);
    }
  }
  
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  
  const messageData = encoder.encode(message);
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, messageData);
  
  return btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(signature))));
}

const CLOB_AUTH_DOMAIN = {
  name: "ClobAuthDomain",
  version: "1",
  chainId: POLYGON_CHAIN_ID,
};

const CLOB_AUTH_TYPES = {
  ClobAuth: [
    { name: "address", type: "address" },
    { name: "timestamp", type: "string" },
    { name: "nonce", type: "uint256" },
    { name: "message", type: "string" },
  ],
};

export async function deriveApiCredentials(
  signer: ethers.Signer,
  walletAddress: string
): Promise<ApiCredentials | null> {
  try {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = 0;
    const message = "This message attests that I control the given wallet";
    
    const authValue = {
      address: walletAddress,
      timestamp: timestamp,
      nonce: nonce,
      message: message,
    };
    
    console.log("Signing ClobAuth EIP-712 message:", authValue);
    
    const signature = await signer.signTypedData(
      CLOB_AUTH_DOMAIN,
      CLOB_AUTH_TYPES,
      authValue
    );
    
    console.log("ClobAuth signature obtained, calling derive-api-key...");
    
    const response = await fetch(`${CLOB_API_URL}/auth/derive-api-key`, {
      method: "GET",
      headers: {
        ...BROWSER_HEADERS,
        "POLY_ADDRESS": walletAddress,
        "POLY_SIGNATURE": signature,
        "POLY_TIMESTAMP": timestamp,
        "POLY_NONCE": nonce.toString(),
      },
    });
    
    const responseText = await response.text();
    console.log("derive-api-key response:", response.status, responseText.substring(0, 500));
    
    if (responseText.includes("<!DOCTYPE html>") || responseText.includes("Cloudflare")) {
      console.error("Cloudflare blocked the credential derivation request");
      return null;
    }
    
    if (!response.ok) {
      console.error("Failed to derive API credentials:", responseText);
      return null;
    }
    
    const data = JSON.parse(responseText);
    return {
      apiKey: data.apiKey,
      secret: data.secret,
      passphrase: data.passphrase,
    };
  } catch (error) {
    console.error("Error deriving API credentials:", error);
    return null;
  }
}

export async function createSignedOrder(
  signer: ethers.Signer,
  walletAddress: string,
  params: OrderParams
): Promise<{
  order: any;
  signature: string;
} | null> {
  try {
    const { tokenId, price, size, side } = params;
    
    const sideEnum = side === "BUY" ? 0 : 1;
    
    let makerAmount: string;
    let takerAmount: string;
    
    if (side === "BUY") {
      const usdcAmount = price * size;
      makerAmount = Math.floor(usdcAmount * Math.pow(10, USDC_DECIMALS)).toString();
      takerAmount = Math.floor(size * Math.pow(10, TOKEN_DECIMALS)).toString();
    } else {
      makerAmount = Math.floor(size * Math.pow(10, TOKEN_DECIMALS)).toString();
      const usdcAmount = price * size;
      takerAmount = Math.floor(usdcAmount * Math.pow(10, USDC_DECIMALS)).toString();
    }
    
    const expiration = Math.floor(Date.now() / 1000) + 86400;
    
    const order = {
      salt: BigInt(generateSalt()),
      maker: walletAddress,
      signer: walletAddress,
      taker: "0x0000000000000000000000000000000000000000",
      tokenId: BigInt(tokenId),
      makerAmount: BigInt(makerAmount),
      takerAmount: BigInt(takerAmount),
      expiration: BigInt(expiration),
      nonce: BigInt(generateNonce()),
      feeRateBps: BigInt(0),
      side: sideEnum,
      signatureType: 0,
    };
    
    console.log("Creating signed order:", {
      tokenId,
      price,
      size,
      side,
      makerAmount,
      takerAmount,
    });
    
    const signature = await signer.signTypedData(
      EIP712_DOMAIN,
      ORDER_TYPES,
      order
    );
    
    const orderForSubmission = {
      salt: order.salt.toString(),
      maker: order.maker,
      signer: order.signer,
      taker: order.taker,
      tokenId: order.tokenId.toString(),
      makerAmount: order.makerAmount.toString(),
      takerAmount: order.takerAmount.toString(),
      expiration: order.expiration.toString(),
      nonce: order.nonce.toString(),
      feeRateBps: order.feeRateBps.toString(),
      side: order.side,
      signatureType: order.signatureType,
    };
    
    return { order: orderForSubmission, signature };
  } catch (error) {
    console.error("Error creating signed order:", error);
    return null;
  }
}

export async function submitOrder(
  order: any,
  signature: string,
  credentials: ApiCredentials,
  orderType: "GTC" | "GTD" | "FOK" = "GTC"
): Promise<OrderResult> {
  try {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const method = "POST";
    const path = "/order";
    
    const orderPayload = {
      order: {
        ...order,
        signature,
      },
      orderType,
      owner: order.maker,
    };
    
    const body = JSON.stringify(orderPayload);
    
    const hmacSignature = await createHmacSignature(
      credentials.secret,
      timestamp,
      method,
      path,
      body
    );
    
    console.log("Submitting order to CLOB API:", {
      path,
      method,
      orderType,
      maker: order.maker,
      tokenId: order.tokenId,
    });
    
    const response = await fetch(`${CLOB_API_URL}${path}`, {
      method,
      headers: {
        ...BROWSER_HEADERS,
        "POLY_ADDRESS": order.maker,
        "POLY_SIGNATURE": hmacSignature,
        "POLY_TIMESTAMP": timestamp,
        "POLY_API_KEY": credentials.apiKey,
        "POLY_PASSPHRASE": credentials.passphrase,
      },
      body,
    });
    
    const responseText = await response.text();
    
    console.log("CLOB API response:", {
      status: response.status,
      statusText: response.statusText,
      bodyPreview: responseText.substring(0, 500),
    });
    
    if (responseText.includes("<!DOCTYPE html>") || responseText.includes("Cloudflare")) {
      return {
        success: false,
        error: "Request blocked by Cloudflare. Please try again from a different network.",
      };
    }
    
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      return {
        success: false,
        error: `Invalid response: ${responseText.substring(0, 200)}`,
      };
    }
    
    if (!response.ok) {
      return {
        success: false,
        error: data.error || data.message || `HTTP ${response.status}`,
      };
    }
    
    if (data.orderID || data.orderId) {
      return {
        success: true,
        orderId: data.orderID || data.orderId,
        status: data.status || "open",
      };
    }
    
    return {
      success: false,
      error: data.error || "No order ID returned",
    };
  } catch (error) {
    console.error("Error submitting order:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to submit order",
    };
  }
}

export async function placePolymarketOrder(
  signer: ethers.Signer,
  walletAddress: string,
  params: OrderParams,
  credentials?: ApiCredentials | null
): Promise<OrderResult> {
  try {
    let creds: ApiCredentials | null | undefined = credentials;
    if (!creds) {
      creds = await deriveApiCredentials(signer, walletAddress);
      if (!creds) {
        return {
          success: false,
          error: "Failed to derive API credentials. Please try again.",
        };
      }
    }
    
    const signedOrder = await createSignedOrder(signer, walletAddress, params);
    if (!signedOrder) {
      return {
        success: false,
        error: "Failed to create signed order",
      };
    }
    
    const result = await submitOrder(signedOrder.order, signedOrder.signature, creds);
    return result;
  } catch (error) {
    console.error("Error placing Polymarket order:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to place order",
    };
  }
}

export async function getOrderBook(tokenId: string): Promise<any> {
  try {
    const response = await fetch(`${CLOB_API_URL}/book?token_id=${tokenId}`, {
      headers: BROWSER_HEADERS,
    });
    
    if (!response.ok) {
      return null;
    }
    
    return await response.json();
  } catch (error) {
    console.error("Error fetching order book:", error);
    return null;
  }
}

export async function getMidpoint(tokenId: string): Promise<number | null> {
  try {
    const response = await fetch(`${CLOB_API_URL}/midpoint?token_id=${tokenId}`, {
      headers: BROWSER_HEADERS,
    });
    
    if (!response.ok) {
      return null;
    }
    
    const data = await response.json();
    return data.mid || null;
  } catch (error) {
    console.error("Error fetching midpoint:", error);
    return null;
  }
}
