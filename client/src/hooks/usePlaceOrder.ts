import { useState, useCallback } from "react";
import { ClobClient, Side, OrderType } from "@polymarket/clob-client";

export interface OrderParams {
  tokenId: string;
  price: number;
  size: number;
  side: "BUY" | "SELL";
  negRisk?: boolean;
}

export interface OrderResult {
  success: boolean;
  orderId?: string;
  error?: string;
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

        // Use ClobClient's createOrder method with proper types
        const orderArgs = {
          tokenID: params.tokenId,
          price: params.price,
          side: params.side === "BUY" ? Side.BUY : Side.SELL,
          size: params.size,
        };

        // Create the signed order
        const signedOrder = await clobClient.createOrder(orderArgs);
        console.log("Signed order created:", signedOrder);

        // Post the order to Polymarket with proper OrderType enum
        const result = await clobClient.postOrder(signedOrder, OrderType.GTC);
        console.log("Order posted successfully:", result);

        setIsPlacing(false);
        return {
          success: true,
          orderId: (result as any).orderID || (result as any).id,
        };
      } catch (err: any) {
        console.error("Failed to place order:", err);
        const errorMessage = err.message || "Failed to place order";
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
