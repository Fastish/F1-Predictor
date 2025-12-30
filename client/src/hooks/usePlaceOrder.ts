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

        // FOK orders have stricter decimal precision requirements:
        // - Maker amount (size for buys): max 2 decimals
        // - Taker amount (size × price): max 4 decimals  
        // - Size × Price product: must not exceed 2 decimals
        // GTC/GTD orders are more flexible (up to 4-6 decimals depending on tick size)
        const isFOK = !params.orderType || params.orderType === "FOK";
        
        let roundedPrice: number;
        let roundedSize: number;
        
        if (isFOK) {
          // For FOK orders, round to ensure clean integer micro-amounts
          // Price to 2 decimals (tick size is 0.01)
          roundedPrice = Math.floor(params.price * 100) / 100;
          
          // Size needs to be rounded so that:
          // 1. Size itself has max 2 decimals
          // 2. Size × Price has max 2 decimals (for maker/taker amounts)
          // Round size down to 2 decimals first
          roundedSize = Math.floor(params.size * 100) / 100;
          
          // Ensure the product is also clean (max 2 decimals)
          // If price has 2 decimals and size has 2 decimals, product can have 4 decimals
          // We need product to have max 2 decimals, so adjust size
          const product = roundedSize * roundedPrice;
          const productRounded = Math.floor(product * 100) / 100;
          
          // If product was rounded, adjust size to match
          if (Math.abs(product - productRounded) > 0.0001 && roundedPrice > 0) {
            roundedSize = Math.floor((productRounded / roundedPrice) * 100) / 100;
          }
        } else {
          // GTC/GTD: more flexible precision
          roundedPrice = Math.floor(params.price * 10000) / 10000;
          roundedSize = Math.floor(params.size * 10000) / 10000;
        }

        console.log(`Order type: ${params.orderType || "FOK"}, Price: ${params.price} -> ${roundedPrice}, Size: ${params.size} -> ${roundedSize}, Product: ${roundedSize * roundedPrice}`);

        // Use ClobClient's createOrder method with proper types
        const orderArgs = {
          tokenID: params.tokenId,
          price: roundedPrice,
          side: params.side === "BUY" ? Side.BUY : Side.SELL,
          size: roundedSize,
        };

        // Create the signed order
        const signedOrder = await clobClient.createOrder(orderArgs);
        console.log("Signed order created:", signedOrder);
        await logToServer("ORDER_SIGNED", { signedOrder: { ...signedOrder, signature: signedOrder.signature?.substring(0, 20) + "..." } });

        // Map string order type to SDK enum (default to FOK)
        const orderTypeMap: Record<PolymarketOrderType, OrderType> = {
          FOK: OrderType.FOK,
          GTC: OrderType.GTC,
          GTD: OrderType.GTD,
        };
        const sdkOrderType = orderTypeMap[params.orderType || "FOK"];

        // Post the order to Polymarket with proper OrderType enum
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
