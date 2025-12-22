import { useState, useCallback, useRef } from "react";
import { ethers } from "ethers";
import { useWallet } from "@/context/WalletContext";

const CLOB_API_URL = "https://clob.polymarket.com";
const POLYGON_CHAIN_ID = 137;

interface ApiCredentials {
  apiKey: string;
  secret: string;
  passphrase: string;
}

interface BuilderHeaders {
  POLY_BUILDER_API_KEY: string;
  POLY_BUILDER_PASSPHRASE: string;
  POLY_BUILDER_SIGNATURE: string;
  POLY_BUILDER_TIMESTAMP: string;
}

async function fetchBuilderHeaders(
  method: string,
  path: string,
  body: string = ""
): Promise<BuilderHeaders | null> {
  try {
    const response = await fetch("/api/polymarket/builder-sign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, path, body }),
    });
    
    if (!response.ok) {
      console.warn("Builder signing not available");
      return null;
    }
    
    const data = await response.json();
    if (!data.available || !data.headers) {
      return null;
    }
    
    return data.headers;
  } catch (error) {
    console.warn("Failed to fetch builder headers:", error);
    return null;
  }
}

interface OrderParams {
  tokenId: string;
  price: number;
  size: number;
  side: "BUY" | "SELL";
}

interface OrderResult {
  success: boolean;
  orderId?: string;
  error?: string;
}

async function generateHmacSignature(
  secret: string,
  timestamp: string,
  method: string,
  path: string,
  body: string = ""
): Promise<string> {
  const message = timestamp + method.toUpperCase() + path + body;
  const encoder = new TextEncoder();
  const secretBytes = Uint8Array.from(atob(secret), c => c.charCodeAt(0));
  
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(message)
  );
  
  const signatureArray = new Uint8Array(signature);
  let hexString = "";
  for (let i = 0; i < signatureArray.length; i++) {
    hexString += signatureArray[i].toString(16).padStart(2, "0");
  }
  return hexString;
}

export function usePolymarketTrading() {
  const { walletAddress, signer, walletType } = useWallet();
  const isConnected = !!walletAddress;
  const [isDerivingCreds, setIsDerivingCreds] = useState(false);
  const apiCredsRef = useRef<ApiCredentials | null>(null);
  const [error, setError] = useState<string | null>(null);

  const deriveApiCredentials = useCallback(async (): Promise<ApiCredentials | null> => {
    if (!signer || !walletAddress) {
      setError("Wallet not connected");
      return null;
    }

    if (apiCredsRef.current) {
      return apiCredsRef.current;
    }

    setIsDerivingCreds(true);
    setError(null);

    try {
      const nonce = Date.now();
      const domain = {
        name: "ClobAuthDomain",
        version: "1",
        chainId: POLYGON_CHAIN_ID,
      };

      const types = {
        ClobAuth: [
          { name: "address", type: "address" },
          { name: "timestamp", type: "string" },
          { name: "nonce", type: "uint256" },
          { name: "message", type: "string" },
        ],
      };

      const value = {
        address: walletAddress,
        timestamp: String(nonce),
        nonce: nonce,
        message: "This message attests that I control the given wallet",
      };

      const typedDataPayload = JSON.stringify({
        types: {
          EIP712Domain: [
            { name: "name", type: "string" },
            { name: "version", type: "string" },
            { name: "chainId", type: "uint256" },
          ],
          ...types,
        },
        primaryType: "ClobAuth",
        domain,
        message: value,
      });

      let signature: string;
      
      if (walletType === "magic" && signer.provider) {
        const provider = signer.provider as ethers.BrowserProvider;
        signature = await provider.send("eth_signTypedData_v4", [
          walletAddress,
          typedDataPayload,
        ]);
      } else {
        signature = await (signer as any).signTypedData(domain, types, value);
      }

      const response = await fetch(`${CLOB_API_URL}/auth/derive-api-key`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          address: walletAddress,
          timestamp: String(nonce),
          nonce,
          signature,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `API error: ${response.status}`);
      }

      const creds = await response.json();
      const apiCredentials: ApiCredentials = {
        apiKey: creds.apiKey,
        secret: creds.secret,
        passphrase: creds.passphrase,
      };

      apiCredsRef.current = apiCredentials;
      return apiCredentials;
    } catch (err: any) {
      console.error("Failed to derive API credentials:", err);
      setError(err.message || "Failed to derive API credentials");
      return null;
    } finally {
      setIsDerivingCreds(false);
    }
  }, [signer, walletAddress, walletType]);

  const ensureApiCredentials = useCallback(async (): Promise<ApiCredentials | null> => {
    if (apiCredsRef.current) return apiCredsRef.current;
    return deriveApiCredentials();
  }, [deriveApiCredentials]);

  const placeOrder = useCallback(
    async (params: OrderParams): Promise<OrderResult> => {
      if (!signer || !walletAddress) {
        return { success: false, error: "Wallet not connected" };
      }

      const creds = await ensureApiCredentials();
      if (!creds) {
        return { success: false, error: "Failed to get API credentials" };
      }

      try {
        const orderData = {
          tokenID: params.tokenId,
          price: params.price,
          size: params.size,
          side: params.side,
          type: "GTC",
        };

        const timestamp = String(Date.now());
        const method = "POST";
        const path = "/order";
        const body = JSON.stringify(orderData);
        
        const hmacSignature = await generateHmacSignature(
          creds.secret,
          timestamp,
          method,
          path,
          body
        );

        const builderHeaders = await fetchBuilderHeaders(method, path, body);

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "POLY_ADDRESS": walletAddress,
          "POLY_SIGNATURE": hmacSignature,
          "POLY_TIMESTAMP": timestamp,
          "POLY_NONCE": timestamp,
          "POLY_API_KEY": creds.apiKey,
          "POLY_PASSPHRASE": creds.passphrase,
        };

        if (builderHeaders) {
          headers["POLY_BUILDER_API_KEY"] = builderHeaders.POLY_BUILDER_API_KEY;
          headers["POLY_BUILDER_PASSPHRASE"] = builderHeaders.POLY_BUILDER_PASSPHRASE;
          headers["POLY_BUILDER_SIGNATURE"] = builderHeaders.POLY_BUILDER_SIGNATURE;
          headers["POLY_BUILDER_TIMESTAMP"] = builderHeaders.POLY_BUILDER_TIMESTAMP;
        }

        const response = await fetch(`${CLOB_API_URL}${path}`, {
          method,
          headers,
          body,
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.message || `Order failed: ${response.status}`);
        }

        const result = await response.json();
        return {
          success: true,
          orderId: result.orderID || result.id,
        };
      } catch (err: any) {
        console.error("Failed to place order:", err);
        return {
          success: false,
          error: err.message || "Failed to place order",
        };
      }
    },
    [signer, walletAddress, ensureApiCredentials]
  );

  const cancelOrder = useCallback(
    async (orderId: string): Promise<{ success: boolean; error?: string }> => {
      if (!signer || !walletAddress) {
        return { success: false, error: "Wallet not connected" };
      }

      const creds = await ensureApiCredentials();
      if (!creds) {
        return { success: false, error: "Failed to get API credentials" };
      }

      try {
        const timestamp = String(Date.now());
        const method = "DELETE";
        const path = `/order/${orderId}`;
        
        const hmacSignature = await generateHmacSignature(
          creds.secret,
          timestamp,
          method,
          path
        );

        const builderHeaders = await fetchBuilderHeaders(method, path);

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "POLY_ADDRESS": walletAddress,
          "POLY_SIGNATURE": hmacSignature,
          "POLY_TIMESTAMP": timestamp,
          "POLY_NONCE": timestamp,
          "POLY_API_KEY": creds.apiKey,
          "POLY_PASSPHRASE": creds.passphrase,
        };

        if (builderHeaders) {
          headers["POLY_BUILDER_API_KEY"] = builderHeaders.POLY_BUILDER_API_KEY;
          headers["POLY_BUILDER_PASSPHRASE"] = builderHeaders.POLY_BUILDER_PASSPHRASE;
          headers["POLY_BUILDER_SIGNATURE"] = builderHeaders.POLY_BUILDER_SIGNATURE;
          headers["POLY_BUILDER_TIMESTAMP"] = builderHeaders.POLY_BUILDER_TIMESTAMP;
        }

        const response = await fetch(`${CLOB_API_URL}${path}`, {
          method,
          headers,
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.message || `Cancel failed: ${response.status}`);
        }

        return { success: true };
      } catch (err: any) {
        console.error("Failed to cancel order:", err);
        return {
          success: false,
          error: err.message || "Failed to cancel order",
        };
      }
    },
    [signer, walletAddress, ensureApiCredentials]
  );

  const getOpenOrders = useCallback(async () => {
    if (!walletAddress) {
      return [];
    }

    const creds = await ensureApiCredentials();
    if (!creds) {
      return [];
    }

    try {
      const timestamp = String(Date.now());
      const method = "GET";
      const path = `/orders?owner=${walletAddress}`;
      
      const hmacSignature = await generateHmacSignature(
        creds.secret,
        timestamp,
        method,
        path
      );

      const response = await fetch(`${CLOB_API_URL}${path}`, {
        method,
        headers: {
          "POLY_ADDRESS": walletAddress,
          "POLY_SIGNATURE": hmacSignature,
          "POLY_TIMESTAMP": timestamp,
          "POLY_NONCE": timestamp,
          "POLY_API_KEY": creds.apiKey,
          "POLY_PASSPHRASE": creds.passphrase,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch orders: ${response.status}`);
      }

      return await response.json();
    } catch (err) {
      console.error("Failed to fetch open orders:", err);
      return [];
    }
  }, [walletAddress, ensureApiCredentials]);

  const clearCredentials = useCallback(() => {
    apiCredsRef.current = null;
  }, []);

  return {
    isConnected,
    walletAddress,
    isDerivingCreds,
    hasApiCreds: !!apiCredsRef.current,
    error,
    deriveApiCredentials,
    placeOrder,
    cancelOrder,
    getOpenOrders,
    clearCredentials,
  };
}
