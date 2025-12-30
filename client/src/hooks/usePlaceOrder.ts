import { useState, useCallback } from "react";
import { ClobClient, Side, OrderType } from "@polymarket/clob-client";

// Helper to log debug info to server for visibility
async function logToServer(event: string, data?: any, error?: any, walletAddress?: string) {
  try {
    await fetch("/api/polymarket/debug-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, data, error, walletAddress, timestamp: new Date().toISOString() }),
    });
  } catch (e) {
    // Ignore logging errors
  }
}

export type PolymarketOrderType = "FOK" | "GTC" | "GTD";

export interface OrderParams {
  tokenId: string;
  price: number;
  size: number;
  side: "BUY" | "SELL";
  negRisk?: boolean;
  orderType?: PolymarketOrderType;
  expiration?: number; // Unix timestamp in seconds for GTD orders
}

export interface OrderResult {
  success: boolean;
  orderId?: string;
  error?: string;
  rawResponse?: any;
}

export function usePlaceOrder(
  clobClient: ClobClient | null,
  onCredentialError?: () => void
) {
  const [isPlacing, setIsPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const placeOrder = useCallback(
    async (params: OrderParams): Promise<OrderResult> => {
      if (!clobClient) {
        return { success: false, error: "Trading session not initialized" };
      }

      setIsPlacing(true);
      setError(null);

      try {
        console.log("Creating order with ClobClient:", params);
        await logToServer("ORDER_START", { params });

        const isFOK = !params.orderType || params.orderType === "FOK";
        let signedOrder;
        let sdkOrderType: OrderType;
        
        if (isFOK) {
          // FOK orders use createMarketOrder which handles precision requirements internally
          // For BUY: amount = USDC to spend, SDK calculates correct share size
          // For SELL: amount = shares to sell
          const roundedPrice = Math.floor(params.price * 100) / 100;
          
          // For BUY orders, calculate the USDC amount (cost) and round to 2 decimals
          // For SELL orders, use the share size rounded to 2 decimals
          let amount: number;
          if (params.side === "BUY") {
            // cost = size × price, rounded to 2 decimals
            const rawCost = params.size * roundedPrice;
            amount = Math.floor(rawCost * 100) / 100;
          } else {
            // For sells, amount = shares to sell
            amount = Math.floor(params.size * 100) / 100;
          }
          
          console.log(`FOK order: Price: ${roundedPrice}, Amount: ${amount} (${params.side === "BUY" ? "USDC" : "shares"})`);
          
          const marketOrderArgs = {
            tokenID: params.tokenId,
            price: roundedPrice,
            side: params.side === "BUY" ? Side.BUY : Side.SELL,
            amount: amount,
          };
          
          // Use createMarketOrder for FOK orders - it handles precision correctly
          signedOrder = await clobClient.createMarketOrder(marketOrderArgs);
          sdkOrderType = OrderType.FOK;
        } else {
          // GTC/GTD use standard createOrder with flexible precision
          const roundedPrice = Math.floor(params.price * 10000) / 10000;
          const roundedSize = Math.floor(params.size * 10000) / 10000;
          
          // For GTD orders, include expiration timestamp
          // Must add 60 second buffer per Polymarket security threshold
          let expiration: number | undefined;
          if (params.orderType === "GTD" && params.expiration) {
            // Ensure at least 60 seconds from now (Polymarket security threshold)
            const minExpiration = Math.floor(Date.now() / 1000) + 60;
            expiration = Math.max(params.expiration, minExpiration);
            console.log(`GTD order expiration: ${new Date(expiration * 1000).toISOString()}`);
          }
          
          console.log(`${params.orderType} order: Price: ${roundedPrice}, Size: ${roundedSize}${expiration ? `, Expires: ${expiration}` : ''}`);
          
          const orderArgs: any = {
            tokenID: params.tokenId,
            price: roundedPrice,
            side: params.side === "BUY" ? Side.BUY : Side.SELL,
            size: roundedSize,
          };
          
          // Add expiration for GTD orders
          if (expiration) {
            orderArgs.expiration = expiration;
          }
          
          signedOrder = await clobClient.createOrder(orderArgs);
          sdkOrderType = params.orderType === "GTC" ? OrderType.GTC : OrderType.GTD;
        }
        
        console.log("Signed order created:", signedOrder);
        await logToServer("ORDER_SIGNED", { signedOrder: { ...signedOrder, signature: signedOrder.signature?.substring(0, 20) + "..." } });

        // Post the order to Polymarket
        const result = await clobClient.postOrder(signedOrder, sdkOrderType);
        console.log("postOrder response:", JSON.stringify(result, null, 2));
        await logToServer("ORDER_RESPONSE", { result });

        // Check if the response contains an error (Polymarket returns errors in response body)
        const resultAny = result as any;
        if (resultAny.error || resultAny.status >= 400) {
          const errorMessage = resultAny.error || `Request failed with status ${resultAny.status}`;
          console.error("Polymarket order rejected:", errorMessage);
          setIsPlacing(false);
          return {
            success: false,
            error: errorMessage,
            rawResponse: result,
          };
        }

        // Extract order ID from response - Polymarket uses different field names
        const orderId = resultAny.orderID || resultAny.orderId || resultAny.id || resultAny.order_id;
        
        if (!orderId) {
          console.warn("Order posted but no order ID returned. Full response:", result);
        } else {
          console.log("Extracted Polymarket order ID:", orderId);
        }

        setIsPlacing(false);
        return {
          success: true,
          orderId,
          rawResponse: result,
        };
      } catch (err: any) {
        console.error("Failed to place order:", err);
        const errorMessage = err.message || "Failed to place order";
        
        // Log full error details to server for debugging
        await logToServer("ORDER_ERROR", undefined, {
          message: errorMessage,
          name: err.name,
          stack: err.stack?.substring(0, 500),
          response: err.response,
          data: err.data,
          status: err.status,
          code: err.code,
        });
        
        setError(errorMessage);
        setIsPlacing(false);

        // Check if this is a credential error (401 Unauthorized)
        if (err.message?.includes("401") || err.message?.includes("Unauthorized") || 
            err.message?.includes("Invalid API") || err.message?.includes("expired")) {
          onCredentialError?.();
        }

        return { success: false, error: errorMessage };
      }
    },
    [clobClient, onCredentialError]
  );

  const cancelOrder = useCallback(
    async (orderId: string): Promise<{ success: boolean; error?: string }> => {
      if (!clobClient) {
        return { success: false, error: "Trading session not initialized" };
      }

      try {
        await clobClient.cancelOrder({ orderID: orderId });
        return { success: true };
      } catch (err: any) {
        console.error("Failed to cancel order:", err);
        return { success: false, error: err.message };
      }
    },
    [clobClient]
  );

  const getOpenOrders = useCallback(async () => {
    if (!clobClient) return [];

    try {
      const orders = await clobClient.getOpenOrders();
      return orders;
    } catch (err) {
      console.error("Failed to get open orders:", err);
      return [];
    }
  }, [clobClient]);

  return {
    placeOrder,
    cancelOrder,
    getOpenOrders,
    isPlacing,
    error,
  };
}
