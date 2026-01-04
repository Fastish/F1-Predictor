import { useState, useCallback } from "react";
import { ClobClient, Side, OrderType } from "@polymarket/clob-client";
import { verifyPolygonNetwork, requestPolygonSwitch } from "@/lib/polymarketDeposit";
import { ethers } from "ethers";

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

export interface ApiCredentials {
  key: string;
  secret: string;
  passphrase: string;
}

export function usePlaceOrder(
  clobClient: ClobClient | null,
  onCredentialError?: () => void,
  apiCredentials?: ApiCredentials | null,
  signer?: ethers.Signer | null,
  isSafeWallet?: boolean // Safe wallets trade on Polygon regardless of EOA network
) {
  const [isPlacing, setIsPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const placeOrder = useCallback(
    async (params: OrderParams): Promise<OrderResult> => {
      if (!clobClient) {
        return { success: false, error: "Trading session not initialized" };
      }

      // CRITICAL: Validate API credentials BEFORE signing the order
      // This prevents the confusing flow of: sign order → fail → request new credentials → fail
      if (!apiCredentials?.key || !apiCredentials?.secret || !apiCredentials?.passphrase) {
        console.error("[usePlaceOrder] Missing API credentials - session incomplete");
        // Trigger reinitialize but abort current order to avoid double signature
        onCredentialError?.();
        return { 
          success: false, 
          error: "Trading session expired. Please wait a moment and try again." 
        };
      }

      setIsPlacing(true);
      setError(null);

      try {
        console.log("Creating order with ClobClient:", params);
        console.log("[usePlaceOrder] Using API key:", apiCredentials.key.substring(0, 10) + "...");
        await logToServer("ORDER_START", { params, apiKeyPrefix: apiCredentials.key.substring(0, 10) });
        
        // For Safe-based wallets (external wallets, WalletConnect), skip network verification
        // The Gnosis Safe proxy is ALWAYS on Polygon - the EOA just signs locally
        // The EOA's active network is irrelevant since trades execute through the Safe
        if (isSafeWallet) {
          console.log("[usePlaceOrder] Safe wallet detected - skipping EOA network verification");
          console.log("[usePlaceOrder] Trading via Safe proxy on Polygon (EOA network is irrelevant)");
        } else if (signer) {
          // For direct wallets (Magic), verify Polygon network
          try {
            console.log("[usePlaceOrder] Direct wallet - verifying Polygon network before signing...");
            await verifyPolygonNetwork(signer);
            console.log("[usePlaceOrder] Network verification passed - on Polygon");
          } catch (networkError: any) {
            console.error("[usePlaceOrder] Network verification failed:", networkError);
            
            // Check if this is a "network changed" error (signer was created on wrong network)
            if (networkError.message === "NETWORK_CHANGED") {
              setIsPlacing(false);
              setError("Your wallet network changed. Please reconnect your wallet.");
              return { 
                success: false, 
                error: "Your wallet switched networks. Please disconnect and reconnect your wallet on Polygon to continue trading." 
              };
            }
            
            // Check if wallet is on wrong network - try to switch automatically
            if (networkError.message?.startsWith("WRONG_NETWORK:")) {
              const currentChain = networkError.message.split(":")[1];
              const chainName = currentChain === "1" ? "Ethereum" : `chain ${currentChain}`;
              
              console.log("[usePlaceOrder] Wallet on wrong network, attempting to switch...");
              try {
                // Pass the provider to requestPolygonSwitch for WalletConnect compatibility
                const browserProvider = signer.provider as any;
                await requestPolygonSwitch(browserProvider);
                console.log("[usePlaceOrder] Network switch requested - user needs to reconnect");
                setIsPlacing(false);
                setError("Network switched. Please reconnect to continue.");
                return { 
                  success: false, 
                  error: "Network switched to Polygon. Please disconnect and reconnect your wallet, then try again." 
                };
              } catch (switchErr: any) {
                console.error("[usePlaceOrder] Network switch failed:", switchErr);
                setIsPlacing(false);
                
                // Special handling for WalletConnect - user must switch in their mobile wallet app
                if (switchErr.message === "SWITCH_IN_WALLET") {
                  setError("Switch network in your wallet app");
                  return { 
                    success: false, 
                    error: `Your wallet is on ${chainName}. Please open your wallet app, switch to Polygon network, then disconnect and reconnect here.` 
                  };
                }
                
                setError(`Please switch to Polygon network`);
                return { 
                  success: false, 
                  error: `Your wallet is on ${chainName}. Please switch to Polygon network in your wallet, then disconnect and reconnect to refresh the trading session.` 
                };
              }
            }
            
            setIsPlacing(false);
            setError("Network error - please ensure you're on Polygon");
            return { success: false, error: "Please switch your wallet to Polygon network to sign this order" };
          }
        }

        const isFOK = !params.orderType || params.orderType === "FOK";
        let signedOrder;
        let sdkOrderType: OrderType;
        
        if (isFOK) {
          // FOK (market) orders have DIFFERENT precision requirements than limit orders:
          // - makerAmount (USDC cost) max 2 decimals
          // - takerAmount (token size) max 4 decimals
          // We must ensure: size × price has max 2 decimals for USDC cost
          
          const roundedPrice = Math.floor(params.price * 100) / 100;
          
          // Calculate intended USDC cost, round to 2 decimals, then derive size
          // This ensures makerAmount (cost) won't exceed 2 decimal precision
          const intendedCost = params.size * roundedPrice;
          const roundedCost = Math.floor(intendedCost * 100) / 100;
          
          // Derive size from rounded cost (size = cost / price)
          // Round DOWN to 4 decimals - this ensures size × price ≤ roundedCost
          const derivedSize = roundedCost / roundedPrice;
          const roundedSize = Math.floor(derivedSize * 10000) / 10000;
          
          // Verify the final cost stays at 2 decimals (defensive check against floating point)
          const verifiedCost = roundedSize * roundedPrice;
          const finalCost = Math.floor(verifiedCost * 100) / 100;
          
          console.log(`FOK order: Price: ${roundedPrice}, Target Cost: ${roundedCost}, Size: ${roundedSize}, Final Cost: ${finalCost} (side: ${params.side})`);
          
          const orderArgs = {
            tokenID: params.tokenId,
            price: roundedPrice,
            side: params.side === "BUY" ? Side.BUY : Side.SELL,
            size: roundedSize,
          };
          
          // Use createOrder for FOK orders with manually controlled precision
          signedOrder = await clobClient.createOrder(orderArgs);
          sdkOrderType = OrderType.FOK;
        } else {
          // GTC/GTD use standard createOrder
          // Polymarket requires: makerAmount (USDC) max 5 decimals, takerAmount (tokens) max 2 decimals
          const roundedPrice = Math.floor(params.price * 10000) / 10000;
          const roundedSize = Math.floor(params.size * 100) / 100; // Max 2 decimals for token size
          
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

        // Submit order through server-side proxy to avoid CORS issues
        // The signed order contains the EIP-712 signature, we send it to our server
        // which forwards it to Polymarket with proper HMAC authentication
        if (!apiCredentials) {
          throw new Error("API credentials required for order submission");
        }
        
        // Send credentials via headers (not body) for security
        // Send the full signedOrder unchanged - server will forward it to Polymarket
        // Include orderType so server knows whether to submit as FOK, GTC, or GTD
        const orderTypeString = isFOK ? "FOK" : (params.orderType || "GTC");
        console.log(`Submitting order with type: ${orderTypeString}`);
        
        const proxyResponse = await fetch("/api/polymarket/submit-order", {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
            "X-POLY-API-KEY": apiCredentials.key,
            "X-POLY-API-SECRET": apiCredentials.secret,
            "X-POLY-PASSPHRASE": apiCredentials.passphrase,
          },
          body: JSON.stringify({ signedOrder, orderType: orderTypeString }),
        });
        
        if (!proxyResponse.ok) {
          const errorData = await proxyResponse.json().catch(() => ({ error: "Unknown error" }));
          throw new Error(errorData.error || `Server error: ${proxyResponse.status}`);
        }
        
        const result = await proxyResponse.json();
        console.log("Server proxy order response:", JSON.stringify(result, null, 2));
        await logToServer("ORDER_RESPONSE", { result, proxyStatus: proxyResponse.status });

        // Check if the response contains an error (Polymarket returns errors in response body)
        const resultAny = result as any;
        
        // Polymarket can return errors in multiple formats
        const hasError = resultAny.error || 
          resultAny.message || 
          resultAny.status >= 400 ||
          resultAny.errorMsg ||
          (typeof resultAny === 'string' && resultAny.toLowerCase().includes('error'));
        
        if (hasError) {
          const errorMessage = resultAny.error || 
            resultAny.message || 
            resultAny.errorMsg ||
            (typeof resultAny === 'string' ? resultAny : null) ||
            `Request failed with status ${resultAny.status}`;
          console.error("Polymarket order rejected:", errorMessage, "Full response:", result);
          await logToServer("ORDER_REJECTED", { errorMessage, fullResponse: result });
          
          // Check if this is a credential error - trigger session reinit
          // Polymarket returns "Unauthorized/Invalid api key" for bad credentials
          const errorLower = (typeof errorMessage === 'string' ? errorMessage : '').toLowerCase();
          if (errorLower.includes("unauthorized") || 
              errorLower.includes("invalid api") ||
              errorLower.includes("api key") ||
              errorLower.includes("401") ||
              errorLower.includes("expired")) {
            console.log("[PlaceOrder] Credential error detected in response, triggering session reinit");
            onCredentialError?.();
          }
          
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
    [clobClient, onCredentialError, apiCredentials, signer, isSafeWallet]
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
