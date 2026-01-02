import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Loader2, TrendingUp, TrendingDown, AlertCircle, ExternalLink, Wallet, HelpCircle, Calendar, Smartphone } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useMarket } from "@/context/MarketContext";
import { useWallet } from "@/context/WalletContext";
import { useTradingSession } from "@/hooks/useTradingSession";
import { usePlaceOrder, type PolymarketOrderType } from "@/hooks/usePlaceOrder";
import { PolymarketDepositWizard } from "./PolymarketDepositWizard";
import { checkDepositRequirements } from "@/lib/polymarketDeposit";
import { getSafeAddress, deriveSafeAddressFromEoa, deploySafeIfNeeded } from "@/lib/polymarketGasless";
import { ethers } from "ethers";

const USDC_CONTRACT = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const USDC_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
];

// Detect if running in Phantom's in-app browser on mobile (EVM chains have signature popup issues)
function isPhantomInAppBrowser(): boolean {
  const userAgent = navigator.userAgent.toLowerCase();
  const isPhantomUA = userAgent.includes("phantom");
  const hasPhantomEthereum = !!(window as any).phantom?.ethereum;
  const isMobile = /iphone|ipad|ipod|android/i.test(userAgent);
  return isMobile && (isPhantomUA || hasPhantomEthereum);
}

interface PolymarketOutcome {
  id: string;
  name: string;
  tokenId: string;
  yesTokenId?: string;
  noTokenId?: string;
  price: number;
  noPrice?: number;
  volume: string;
  conditionId: string;
  questionId: string;
  image?: string;
}

interface OrderBook {
  bids: Array<{ price: string; size: string }>;
  asks: Array<{ price: string; size: string }>;
  market: string;
  asset_id: string;
  hash: string;
  timestamp: string;
}

interface PositionData {
  tokenId: string;
  outcome: string;
  size: number;
  averagePrice: number;
  currentPrice: number;
  conditionId?: string;
}

interface PolymarketBetModalProps {
  open: boolean;
  onClose: () => void;
  outcome: PolymarketOutcome;
  userBalance: number;
  mode?: "buy" | "sell";
  position?: PositionData;
}

export function PolymarketBetModal({ open, onClose, outcome, userBalance, mode = "buy", position }: PolymarketBetModalProps) {
  const isSellMode = mode === "sell" && position;
  const [side, setSide] = useState<"YES" | "NO">("YES");
  const [amount, setAmount] = useState("");
  const [sellShares, setSellShares] = useState("");
  const [orderType, setOrderType] = useState<PolymarketOrderType>("GTC"); // Default to GTC like Polymarket
  const [gtdExpiration, setGtdExpiration] = useState<string>("");
  const [limitPrice, setLimitPrice] = useState<string>(""); // Manual limit price input
  const [sellLimitPrice, setSellLimitPrice] = useState<string>(""); // Limit price for sell orders
  const [isPlacingOrderLocal, setIsPlacingOrderLocal] = useState(false);
  const [showDepositWizard, setShowDepositWizard] = useState(false);
  const [pendingRetry, setPendingRetry] = useState(false);
  const [approvalStatus, setApprovalStatus] = useState<{ needsApproval: boolean; checked: boolean }>({ needsApproval: false, checked: false });
  const [tradingWallet, setTradingWallet] = useState<{ address: string | null; balance: number; type: "safe" | "proxy" | "eoa" }>({ address: null, balance: 0, type: "eoa" });
  const [showSignatureWarning, setShowSignatureWarning] = useState(false);
  const isPhantomMobile = isPhantomInAppBrowser();
  const { toast } = useToast();
  const { userId } = useMarket();
  const { signer, walletAddress, walletType, provider } = useWallet();
  
  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setGtdExpiration("");
      setOrderType("GTC"); // Default to GTC like Polymarket
      setLimitPrice("");
      setSellLimitPrice("");
    }
  }, [open]);
  
  // Check approval status and trading wallet balance when modal opens
  useEffect(() => {
    const checkApprovalAndBalance = async () => {
      if (!open || !walletAddress || !provider) {
        setApprovalStatus({ needsApproval: false, checked: false });
        setTradingWallet({ address: null, balance: 0, type: "eoa" });
        return;
      }
      try {
        const isMagic = walletType === "magic";
        let safeAddr: string | null = null;
        
        // For external/WalletConnect/phantom wallets, get Safe address
        if (!isMagic && (walletType === "external" || walletType === "walletconnect" || walletType === "phantom")) {
          // For WalletConnect, use local derivation to avoid triggering MetaMask deep links
          // For external/phantom wallets with window.ethereum, try getSafeAddress() first for deployment detection
          if (walletType === "walletconnect") {
            console.log("[BetModal] Deriving Safe from EOA:", walletAddress);
            safeAddr = deriveSafeAddressFromEoa(walletAddress);
            console.log("[BetModal] Trading via Safe wallet (derived for WalletConnect):", safeAddr);
          } else {
            try {
              const safeInfo = await getSafeAddress();
              safeAddr = safeInfo.safeAddress;
              console.log("Trading via Safe wallet:", safeAddr);
            } catch (e) {
              // Fallback to local derivation if getSafeAddress fails
              console.warn("Could not get Safe address, using derived:", e);
              safeAddr = deriveSafeAddressFromEoa(walletAddress);
            }
          }
        }
        
        const status = await checkDepositRequirements(provider, walletAddress, isMagic, safeAddr);
        setApprovalStatus({ needsApproval: status.needsApproval, checked: true });
        
        // Set trading wallet info
        const tradingBalance = parseFloat(status.tradingBalance) || 0;
        if (isMagic && status.proxyAddress) {
          setTradingWallet({ 
            address: status.proxyAddress, 
            balance: tradingBalance, 
            type: "proxy" 
          });
        } else if (!isMagic && safeAddr) {
          setTradingWallet({ 
            address: safeAddr, 
            balance: parseFloat(status.safeBalance || "0"), 
            type: "safe" 
          });
        } else {
          setTradingWallet({ 
            address: walletAddress, 
            balance: tradingBalance, 
            type: "eoa" 
          });
        }
      } catch (error) {
        console.error("Failed to check approval/balance status:", error);
        setApprovalStatus({ needsApproval: false, checked: true });
        setTradingWallet({ address: null, balance: 0, type: "eoa" });
      }
    };
    checkApprovalAndBalance();
  }, [open, walletAddress, provider, walletType]);
  
  // Trading session with ClobClient for order placement
  const { 
    isTradingSessionComplete, 
    invalidateSession,
    forceReinitialize,
    clobClient,
    initializeTradingSession,
    isInitializing,
    signerAvailable,
    tradingSession
  } = useTradingSession();
  
  // Pass API credentials and signer to usePlaceOrder for server-side proxy submission (avoids CORS)
  // For Safe wallets (external, walletconnect, phantom), skip network verification since Safe is always on Polygon
  // Use forceReinitialize to automatically re-derive credentials when they expire
  const isSafeWallet = walletType === "external" || walletType === "walletconnect" || walletType === "phantom";
  const { placeOrder, isPlacing } = usePlaceOrder(clobClient, forceReinitialize, tradingSession?.apiCredentials, signer, isSafeWallet);

  const { data: orderBook, isLoading: orderBookLoading } = useQuery<OrderBook>({
    queryKey: ["/api/polymarket/orderbook", outcome.tokenId],
    enabled: open && !!outcome.tokenId,
    refetchInterval: 5000,
  });

  const { data: midpoint } = useQuery<{ mid: number }>({
    queryKey: ["/api/polymarket/midpoint", outcome.tokenId],
    enabled: open && !!outcome.tokenId,
    refetchInterval: 5000,
  });

  // Fetch fee configuration
  const { data: feeConfig } = useQuery<{ feePercentage: number; treasuryAddress: string | null; enabled: boolean }>({
    queryKey: ["/api/fees/current"],
    enabled: open,
  });

  const yesPrice = midpoint?.mid ?? outcome.price;
  const noPrice = outcome.noPrice ?? (1 - yesPrice);

  // Get best bid from orderbook for limit price initialization
  const sortedBidsForPrice = orderBook?.bids ? [...orderBook.bids].sort((a, b) => parseFloat(b.price) - parseFloat(a.price)) : [];
  const bestBidPrice = sortedBidsForPrice[0] ? parseFloat(sortedBidsForPrice[0].price) : null;
  const sortedAsksForPrice = orderBook?.asks ? [...orderBook.asks].sort((a, b) => parseFloat(a.price) - parseFloat(b.price)) : [];
  const bestAskPrice = sortedAsksForPrice[0] ? parseFloat(sortedAsksForPrice[0].price) : null;

  // Initialize limit price when orderbook loads or side changes (for buy orders)
  // Default to best bid + 1 cent to increase fill probability
  useEffect(() => {
    if (open && !isSellMode && orderBook && !limitPrice) {
      const midPrice = midpoint?.mid ?? outcome.price;
      // For buying: set limit slightly above best bid (or use mid price + 1 cent)
      const suggestedPrice = bestBidPrice 
        ? Math.min(bestBidPrice + 0.01, 0.99) // Don't exceed 99 cents
        : Math.min(midPrice + 0.01, 0.99);
      setLimitPrice(suggestedPrice.toFixed(2));
    }
  }, [open, orderBook, isSellMode, side]);

  // Initialize sell limit price when position loads
  useEffect(() => {
    if (open && isSellMode && position && !sellLimitPrice) {
      // For selling: set limit slightly below best ask (or use current price - 1 cent)
      const suggestedPrice = bestAskPrice 
        ? Math.max(bestAskPrice - 0.01, 0.01) // Don't go below 1 cent
        : Math.max(position.currentPrice - 0.01, 0.01);
      setSellLimitPrice(suggestedPrice.toFixed(2));
    }
  }, [open, isSellMode, position, bestAskPrice]);

  const selectedPrice = side === "YES" ? yesPrice : noPrice;
  const selectedTokenId = side === "YES" 
    ? (outcome.yesTokenId || outcome.tokenId) 
    : (outcome.noTokenId || outcome.tokenId);
  const parsedAmount = parseFloat(amount) || 0;
  
  // Parse limit prices
  const parsedLimitPrice = parseFloat(limitPrice) || 0;
  const parsedSellLimitPrice = parseFloat(sellLimitPrice) || 0;
  
  // Use limit price for calculations when order type is GTC or GTD
  const effectivePrice = orderType === "FOK" ? selectedPrice : (parsedLimitPrice > 0 ? parsedLimitPrice : selectedPrice);
  
  // Fee calculations
  const feePercentage = feeConfig?.feePercentage ?? 0;
  const feeAmount = parsedAmount * (feePercentage / 100);
  const totalCost = parsedAmount + feeAmount;
  
  const shares = parsedAmount > 0 && effectivePrice > 0 ? parsedAmount / effectivePrice : 0;
  const potentialPayout = shares * 1; // Each share pays $1 if wins
  const potentialProfit = potentialPayout - totalCost;

  const handlePlaceBet = async () => {
    if (!userId) {
      toast({
        title: "Not Logged In",
        description: "Please connect your account to place bets",
        variant: "destructive",
      });
      return;
    }

    if (!signer || !walletAddress) {
      toast({
        title: "Wallet Not Connected",
        description: "Please connect your wallet to place bets on Polymarket",
        variant: "destructive",
      });
      return;
    }

    if (!isTradingSessionComplete || !clobClient) {
      toast({
        title: "Trading Session Required",
        description: "Please initialize your trading session first",
        variant: "destructive",
      });
      return;
    }

    if (parsedAmount <= 0) {
      toast({
        title: "Invalid Amount",
        description: "Please enter a valid bet amount",
        variant: "destructive",
      });
      return;
    }

    // Check trading wallet balance (Safe for external wallets, Proxy for Magic)
    const effectiveTradingBalance = tradingWallet.balance > 0 ? tradingWallet.balance : userBalance;
    if (totalCost > effectiveTradingBalance) {
      const walletTypeLabel = tradingWallet.type === "safe" ? "Safe trading wallet" : 
                              tradingWallet.type === "proxy" ? "trading proxy" : "wallet";
      toast({
        title: "Insufficient Trading Balance",
        description: tradingWallet.type === "safe" 
          ? `Your Safe trading wallet has $${tradingWallet.balance.toFixed(2)} USDC.e but you need $${totalCost.toFixed(2)}. Use the Deposit Wizard to fund your Safe.`
          : `You need $${totalCost.toFixed(2)} USDC.e (including ${feePercentage}% fee) but your ${walletTypeLabel} only has $${effectiveTradingBalance.toFixed(2)}`,
        variant: "destructive",
      });
      return;
    }

    // Validate GTD expiration
    if (orderType === "GTD" && !gtdExpiration) {
      toast({
        title: "Expiration Required",
        description: "Please select an expiration date and time for GTD orders",
        variant: "destructive",
      });
      return;
    }

    setIsPlacingOrderLocal(true);
    setShowSignatureWarning(false);

    // Set up timeout to show warning for Phantom mobile users
    let signatureTimeout: ReturnType<typeof setTimeout> | null = null;
    if (isPhantomMobile) {
      signatureTimeout = setTimeout(() => {
        setShowSignatureWarning(true);
        toast({
          title: "Signature Request Pending",
          description: "If you don't see a signature popup, try scrolling down in Phantom or tap the notification area.",
          variant: "default",
          duration: 10000,
        });
      }, 5000);
    }

    try {
      // Step 0: Deploy Safe if needed for external/WalletConnect wallets
      if (isSafeWallet && tradingSession && !tradingSession.proxyDeployed) {
        console.log("[BetModal] Safe proxy not yet deployed, deploying now...");
        toast({
          title: "Setting Up Trading Wallet",
          description: "Deploying your trading wallet on Polymarket (one-time setup)...",
        });
        
        try {
          const deployResult = await deploySafeIfNeeded();
          console.log("[BetModal] Safe deployment result:", deployResult);
          
          if (!deployResult.proxyDeployed) {
            toast({
              title: "Wallet Setup Required",
              description: "Please try placing your bet again in a few seconds while the wallet deploys.",
              variant: "default",
            });
            setIsPlacingOrderLocal(false);
            return;
          }
          
          // Safe was just deployed - need to reinitialize credentials with the now-deployed Safe
          // Polymarket may reject credentials derived for an undeployed Safe
          console.log("[BetModal] Safe deployed successfully, reinitializing credentials...");
          toast({
            title: "Activating Trading Session",
            description: "Refreshing credentials for your new trading wallet...",
          });
          
          await forceReinitialize();
          
          // After reinitializing, we need to wait for the new clobClient
          // Since state updates are async, ask user to retry
          toast({
            title: "Trading Wallet Ready",
            description: "Your wallet is set up! Please click Place Bet again to complete your order.",
            variant: "default",
          });
          setIsPlacingOrderLocal(false);
          return;
        } catch (deployError: any) {
          console.error("[BetModal] Safe deployment failed:", deployError);
          toast({
            title: "Wallet Setup Failed",
            description: deployError.message || "Failed to set up trading wallet. Please try again.",
            variant: "destructive",
          });
          setIsPlacingOrderLocal(false);
          return;
        }
      }

      // Step 1: Place the order on Polymarket
      toast({
        title: "Signing Order",
        description: isPhantomMobile 
          ? "Check Phantom for signature request..."
          : "Please sign the order in your wallet...",
      });

      // Convert GTD expiration to Unix timestamp (seconds) if provided
      const expirationTimestamp = orderType === "GTD" && gtdExpiration 
        ? Math.floor(new Date(gtdExpiration).getTime() / 1000)
        : undefined;
      
      const result = await placeOrder({
        tokenId: selectedTokenId,
        price: effectivePrice,
        size: shares,
        side: "BUY",
        negRisk: true, // F1 markets are negative risk
        orderType,
        expiration: expirationTimestamp,
      });

      // Clear the timeout since signature was received
      if (signatureTimeout) clearTimeout(signatureTimeout);
      setShowSignatureWarning(false);

      if (result.success) {
        console.log("Order successful, recording with orderId:", result.orderId);
        
        if (!result.orderId) {
          console.warn("WARNING: Order succeeded but no orderId returned from Polymarket");
        }
        
        await apiRequest("POST", "/api/polymarket/record-order", {
          userId,
          tokenId: selectedTokenId,
          marketName: outcome.name,
          outcome: side,
          side: "BUY",
          price: effectivePrice,
          size: shares,
          totalCost: parsedAmount,
          polymarketOrderId: result.orderId,
          status: result.orderId ? "open" : "pending",
          postOrderResponse: result.rawResponse,
        });

        // Step 2: Handle platform fee based on order type
        if (feePercentage > 0 && feeAmount > 0 && walletAddress) {
          // For FOK orders, collect fee immediately (they execute instantly)
          // For GTC/GTD orders, record as pending and collect when filled
          if (orderType === "FOK" && feeConfig?.treasuryAddress && signer) {
            toast({
              title: "Collecting Platform Fee",
              description: `Transferring $${feeAmount.toFixed(2)} fee to platform...`,
            });

            try {
              const usdcContract = new ethers.Contract(USDC_CONTRACT, USDC_ABI, signer);
              const feeAmountWei = ethers.parseUnits(feeAmount.toFixed(6), 6);
              
              const feeTx = await usdcContract.transfer(feeConfig.treasuryAddress, feeAmountWei);
              const feeReceipt = await feeTx.wait();
              
              if (feeReceipt.status === 1) {
                console.log("Fee transferred successfully:", feeReceipt.hash);
                
                await apiRequest("POST", "/api/fees/record", {
                  walletAddress,
                  orderType: "buy",
                  marketName: outcome.name,
                  tokenId: selectedTokenId,
                  orderAmount: parsedAmount,
                  feePercentage,
                  feeAmount,
                  txHash: feeReceipt.hash,
                  status: "confirmed",
                  polymarketOrderId: result.orderId,
                });
              } else {
                console.error("Fee transfer transaction failed");
                await apiRequest("POST", "/api/fees/record", {
                  walletAddress,
                  orderType: "buy",
                  marketName: outcome.name,
                  tokenId: selectedTokenId,
                  orderAmount: parsedAmount,
                  feePercentage,
                  feeAmount,
                  status: "failed",
                  polymarketOrderId: result.orderId,
                });
              }
            } catch (feeError: any) {
              console.error("Fee transfer failed:", feeError);
              await apiRequest("POST", "/api/fees/record", {
                walletAddress,
                orderType: "buy",
                marketName: outcome.name,
                tokenId: selectedTokenId,
                orderAmount: parsedAmount,
                feePercentage,
                feeAmount,
                status: "pending",
                polymarketOrderId: result.orderId,
              }).catch(() => {});
            }
          } else {
            // GTC/GTD orders: record fee as pending_fill, collect when order is filled
            console.log("Recording pending fee for limit order, will collect on fill");
            await apiRequest("POST", "/api/fees/record", {
              walletAddress,
              orderType: "buy",
              marketName: outcome.name,
              tokenId: selectedTokenId,
              orderAmount: parsedAmount,
              feePercentage,
              feeAmount,
              status: "pending_fill",
              polymarketOrderId: result.orderId,
            }).catch((err) => console.error("Failed to record pending fee:", err));
          }
        }

        toast({
          title: result.orderId ? "Order Placed" : "Order Submitted",
          description: result.orderId 
            ? "Your bet has been submitted to Polymarket" 
            : "Order submitted - check your orders for confirmation",
        });

        queryClient.invalidateQueries({ queryKey: ["/api/polymarket"] });
        if (userId) {
          queryClient.invalidateQueries({ queryKey: ["/api/polymarket/orders", userId] });
        }
        onClose();
      } else {
        console.error("Order failed with result:", JSON.stringify(result, null, 2));
        
        // Check if the failure was due to allowance/approval/balance issues
        const errorMsg = result.error || "";
        const rawError = typeof result.rawResponse?.error === "string" ? result.rawResponse.error : "";
        const fullError = (errorMsg + " " + rawError).toLowerCase();
        const isAllowanceError = 
          fullError.includes("allowance") || 
          fullError.includes("insufficient") ||
          fullError.includes("not approved") ||
          fullError.includes("not enough balance");
        
        const isBalanceError = fullError.includes("balance") && !fullError.includes("allowance");
        
        console.log("Error analysis:", { errorMsg, rawError, isAllowanceError, isBalanceError, fullError });
        
        if (isAllowanceError) {
          // Before showing wizard, verify approvals are actually missing
          // Check on-chain status first
          if (approvalStatus.checked && !approvalStatus.needsApproval) {
            // Approvals are already done - this is likely a different issue
            // Show more specific error if available
            const specificError = result.error || result.rawResponse?.error || result.rawResponse?.message;
            toast({
              title: "Order Rejected",
              description: specificError 
                ? `Polymarket rejected: ${specificError}. Try resetting your trading session.`
                : "Polymarket rejected the order. This may be due to insufficient balance, invalid credentials, or a temporary issue. Try resetting your trading session.",
              variant: "destructive",
            });
          } else {
            toast({
              title: "Setup Required",
              description: "Your wallet needs USDC approvals. Opening setup wizard - your order will retry when you're done.",
            });
            setPendingRetry(true);
            setShowDepositWizard(true);
          }
        } else if (isBalanceError) {
          const balanceMsg = tradingWallet.type === "safe" 
            ? `Your Safe trading wallet (${tradingWallet.address?.slice(0,6)}...${tradingWallet.address?.slice(-4)}) has insufficient USDC.e. Current balance: $${tradingWallet.balance.toFixed(2)}. Deposit more funds to your Safe wallet to trade.`
            : tradingWallet.type === "proxy"
            ? `Your trading proxy has insufficient USDC.e. Balance: $${tradingWallet.balance.toFixed(2)}. Use the Deposit Wizard to add funds.`
            : "You don't have enough USDC.e in your wallet for this trade.";
          toast({
            title: "Insufficient Trading Balance",
            description: balanceMsg,
            variant: "destructive",
          });
        } else {
          toast({
            title: "Order Failed",
            description: result.error || "Failed to place order on Polymarket",
            variant: "destructive",
          });
        }
      }
    } catch (error) {
      // Clear the timeout on error
      if (signatureTimeout) clearTimeout(signatureTimeout);
      setShowSignatureWarning(false);
      
      console.error("Error placing bet:", error);
      const errorMsg = error instanceof Error ? error.message : "Failed to place order";
      
      // Provide specific guidance for Phantom mobile signature issues
      if (isPhantomMobile && (errorMsg.includes("timeout") || errorMsg.includes("rejected") || errorMsg.includes("cancelled"))) {
        toast({
          title: "Signature Issue",
          description: "Phantom may not show signature popups in its in-app browser. Try using WalletConnect with MetaMask mobile for better reliability.",
          variant: "destructive",
          duration: 8000,
        });
      } else {
        toast({
          title: "Order Failed",
          description: errorMsg,
          variant: "destructive",
        });
      }
    } finally {
      setIsPlacingOrderLocal(false);
    }
  };

  // Handle selling a position
  const handleSellPosition = async () => {
    if (!position || !clobClient || !isTradingSessionComplete) {
      toast({
        title: "Cannot Sell",
        description: "Trading session not ready or no position data",
        variant: "destructive",
      });
      return;
    }

    const sharesToSell = parseFloat(sellShares) || 0;
    if (sharesToSell <= 0 || sharesToSell > position.size) {
      toast({
        title: "Invalid Amount",
        description: `Enter between 0 and ${position.size.toFixed(2)} shares`,
        variant: "destructive",
      });
      return;
    }

    // Validate GTD expiration
    if (orderType === "GTD" && !gtdExpiration) {
      toast({
        title: "Expiration Required",
        description: "Please select an expiration date and time for GTD orders",
        variant: "destructive",
      });
      return;
    }

    setIsPlacingOrderLocal(true);
    setShowSignatureWarning(false);

    // Set up timeout to show warning for Phantom mobile users
    let sellSignatureTimeout: ReturnType<typeof setTimeout> | null = null;
    if (isPhantomMobile) {
      sellSignatureTimeout = setTimeout(() => {
        setShowSignatureWarning(true);
        toast({
          title: "Signature Request Pending",
          description: "If you don't see a signature popup, try scrolling down in Phantom or tap the notification area.",
          variant: "default",
          duration: 10000,
        });
      }, 5000);
    }

    try {
      // For GTC/GTD orders with manual limit price, use that; otherwise get best bid
      let sellPrice: number;
      
      if (orderType !== "FOK" && parsedSellLimitPrice > 0) {
        // Use user-specified limit price for GTC/GTD orders
        sellPrice = parsedSellLimitPrice;
        console.log("Using user-specified sell limit price:", sellPrice);
      } else {
        // For FOK orders or when no limit price set, fetch best bid
        toast({
          title: "Fetching Best Price",
          description: "Getting current market price...",
        });

        const orderbookResponse = await fetch(`/api/polymarket/orderbook/${position.tokenId}`);
        sellPrice = position.currentPrice;
        
        if (orderbookResponse.ok) {
          const liveOrderbook = await orderbookResponse.json();
          const liveBids = liveOrderbook?.bids || [];
          const sortedLiveBids = [...liveBids].sort((a: any, b: any) => parseFloat(b.price) - parseFloat(a.price));
          if (sortedLiveBids.length > 0) {
            sellPrice = parseFloat(sortedLiveBids[0].price);
            console.log("Using live best bid price:", sellPrice);
          } else {
            console.log("No bids in orderbook, using cached price:", sellPrice);
          }
        }
      }

      // Calculate sell proceeds and fee
      const sellProceeds = sharesToSell * sellPrice;
      const sellFeeAmount = feePercentage > 0 ? sellProceeds * (feePercentage / 100) : 0;

      // Step 1: Place the sell order
      toast({
        title: "Signing Sell Order",
        description: isPhantomMobile 
          ? `Check Phantom for signature - Selling at ${(sellPrice * 100).toFixed(1)}c...`
          : `Selling at ${(sellPrice * 100).toFixed(1)}c per share...`,
      });

      // Convert GTD expiration to Unix timestamp (seconds) if provided
      const expirationTimestamp = orderType === "GTD" && gtdExpiration 
        ? Math.floor(new Date(gtdExpiration).getTime() / 1000)
        : undefined;
      
      const result = await placeOrder({
        tokenId: position.tokenId,
        price: sellPrice,
        size: sharesToSell,
        side: "SELL",
        negRisk: true,
        orderType,
        expiration: expirationTimestamp,
      });

      // Clear the timeout since signature was received
      if (sellSignatureTimeout) clearTimeout(sellSignatureTimeout);
      setShowSignatureWarning(false);

      if (result.success) {
        await apiRequest("POST", "/api/polymarket/record-order", {
          userId,
          tokenId: position.tokenId,
          marketName: outcome.name,
          outcome: position.outcome,
          side: "SELL",
          price: sellPrice,
          size: sharesToSell,
          totalCost: sellProceeds,
          polymarketOrderId: result.orderId,
          status: result.orderId ? "open" : "pending",
          conditionId: position.conditionId,
        });

        // Step 2: Handle platform fee based on order type
        if (sellFeeAmount > 0 && walletAddress) {
          // For FOK orders, collect fee immediately (they execute instantly)
          // For GTC/GTD orders, record as pending and collect when filled
          if (orderType === "FOK" && feeConfig?.treasuryAddress && signer) {
            toast({
              title: "Collecting Platform Fee",
              description: `Transferring $${sellFeeAmount.toFixed(2)} fee to platform...`,
            });

            try {
              const usdcContract = new ethers.Contract(USDC_CONTRACT, USDC_ABI, signer);
              const feeAmountWei = ethers.parseUnits(sellFeeAmount.toFixed(6), 6);
              
              const feeTx = await usdcContract.transfer(feeConfig.treasuryAddress, feeAmountWei);
              const feeReceipt = await feeTx.wait();
              
              if (feeReceipt.status === 1) {
                console.log("Sell fee transferred successfully:", feeReceipt.hash);
                
                await apiRequest("POST", "/api/fees/record", {
                  walletAddress,
                  orderType: "sell",
                  marketName: outcome.name,
                  tokenId: position.tokenId,
                  orderAmount: sellProceeds,
                  feePercentage,
                  feeAmount: sellFeeAmount,
                  txHash: feeReceipt.hash,
                  status: "confirmed",
                  polymarketOrderId: result.orderId,
                });
              } else {
                console.error("Sell fee transfer transaction failed");
                await apiRequest("POST", "/api/fees/record", {
                  walletAddress,
                  orderType: "sell",
                  marketName: outcome.name,
                  tokenId: position.tokenId,
                  orderAmount: sellProceeds,
                  feePercentage,
                  feeAmount: sellFeeAmount,
                  status: "failed",
                  polymarketOrderId: result.orderId,
                });
              }
            } catch (feeError: any) {
              console.error("Sell fee transfer failed:", feeError);
              await apiRequest("POST", "/api/fees/record", {
                walletAddress,
                orderType: "sell",
                marketName: outcome.name,
                tokenId: position.tokenId,
                orderAmount: sellProceeds,
                feePercentage,
                feeAmount: sellFeeAmount,
                status: "pending",
                polymarketOrderId: result.orderId,
              }).catch(() => {});
            }
          } else {
            // GTC/GTD orders: record fee as pending_fill, collect when order is filled
            console.log("Recording pending sell fee for limit order, will collect on fill");
            await apiRequest("POST", "/api/fees/record", {
              walletAddress,
              orderType: "sell",
              marketName: outcome.name,
              tokenId: position.tokenId,
              orderAmount: sellProceeds,
              feePercentage,
              feeAmount: sellFeeAmount,
              status: "pending_fill",
              polymarketOrderId: result.orderId,
            }).catch((err) => console.error("Failed to record pending sell fee:", err));
          }
        }

        toast({
          title: "Sell Order Placed",
          description: `Selling ${sharesToSell.toFixed(2)} shares at ${(sellPrice * 100).toFixed(1)}c`,
        });

        queryClient.invalidateQueries({ queryKey: ["/api/polymarket"] });
        queryClient.invalidateQueries({ queryKey: ["polymarket-positions"] });
        if (userId) {
          queryClient.invalidateQueries({ queryKey: ["/api/polymarket/orders", userId] });
        }
        onClose();
      } else {
        toast({
          title: "Sell Failed",
          description: result.error || "Failed to sell position",
          variant: "destructive",
        });
      }
    } catch (error) {
      // Clear the timeout on error
      if (sellSignatureTimeout) clearTimeout(sellSignatureTimeout);
      setShowSignatureWarning(false);
      
      console.error("Error selling position:", error);
      const errorMsg = error instanceof Error ? error.message : "Failed to sell position";
      
      // Provide specific guidance for Phantom mobile signature issues
      if (isPhantomMobile && (errorMsg.includes("timeout") || errorMsg.includes("rejected") || errorMsg.includes("cancelled"))) {
        toast({
          title: "Signature Issue",
          description: "Phantom may not show signature popups in its in-app browser. Try using WalletConnect with MetaMask mobile for better reliability.",
          variant: "destructive",
          duration: 8000,
        });
      } else {
        toast({
          title: "Sell Failed",
          description: errorMsg,
          variant: "destructive",
        });
      }
    } finally {
      setIsPlacingOrderLocal(false);
    }
  };

  // Polymarket API returns bids ascending (lowest first) and asks descending (highest first)
  // Best bid = highest bid (last in array), Best ask = lowest ask (last in array)
  const sortedBids = orderBook?.bids ? [...orderBook.bids].sort((a, b) => parseFloat(b.price) - parseFloat(a.price)) : [];
  const sortedAsks = orderBook?.asks ? [...orderBook.asks].sort((a, b) => parseFloat(a.price) - parseFloat(b.price)) : [];
  const bestBid = sortedBids[0];
  const bestAsk = sortedAsks[0];

  // Calculate sell proceeds
  const parsedSellShares = parseFloat(sellShares) || 0;
  // For sell proceeds, use limit price when GTC/GTD is set, otherwise use current price
  const effectiveSellPrice = orderType !== "FOK" && parsedSellLimitPrice > 0 
    ? parsedSellLimitPrice 
    : (position?.currentPrice || 0);
  const sellProceeds = parsedSellShares * effectiveSellPrice;
  const sellPnl = position ? (sellProceeds - (parsedSellShares * position.averagePrice)) : 0;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-md flex flex-col max-h-[85vh] md:max-h-[90vh] overflow-hidden">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <span>{isSellMode ? `Sell ${position?.outcome || outcome.name}` : `Bet on ${outcome.name}`}</span>
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 overflow-y-auto pr-4 -mr-4">
          <div className="space-y-4 pb-4">
          
          {isPhantomMobile && (
            <div className="rounded-md bg-amber-500/10 dark:bg-amber-500/20 border border-amber-500/30 p-3 flex items-start gap-2">
              <Smartphone className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-amber-700 dark:text-amber-300">
                <span className="font-medium">Phantom Mobile Note:</span> Signature popups may not appear. If the order hangs, try scrolling within Phantom or use WalletConnect with MetaMask mobile for better reliability.
              </div>
            </div>
          )}
          
          {showSignatureWarning && (
            <div className="rounded-md bg-blue-500/10 dark:bg-blue-500/20 border border-blue-500/30 p-3 flex items-start gap-2 animate-pulse">
              <AlertCircle className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-blue-700 dark:text-blue-300">
                <span className="font-medium">Waiting for signature...</span> Check Phantom's notification area or try scrolling down in the app.
              </div>
            </div>
          )}
          
          {isSellMode && position ? (
            <>
              <div className="rounded-md bg-muted/50 p-3 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Your Position</span>
                  <span className="font-medium">{position.size.toFixed(2)} shares</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Avg Entry Price</span>
                  <span>{(position.averagePrice * 100).toFixed(1)}c</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Current Price</span>
                  <Badge variant="outline">{(position.currentPrice * 100).toFixed(1)}c</Badge>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="sellShares">Shares to Sell</Label>
                <Input
                  id="sellShares"
                  type="number"
                  placeholder="0.00"
                  value={sellShares}
                  onChange={(e) => setSellShares(e.target.value)}
                  min="0"
                  max={position.size}
                  step="0.01"
                  data-testid="input-sell-shares"
                />
                <div className="flex items-center justify-between gap-2">
                  <Button size="sm" variant="outline" onClick={() => setSellShares((position.size * 0.25).toFixed(2))}>25%</Button>
                  <Button size="sm" variant="outline" onClick={() => setSellShares((position.size * 0.5).toFixed(2))}>50%</Button>
                  <Button size="sm" variant="outline" onClick={() => setSellShares((position.size * 0.75).toFixed(2))}>75%</Button>
                  <Button size="sm" variant="outline" onClick={() => setSellShares(position.size.toFixed(2))}>Max</Button>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-1">
                  <Label htmlFor="sell-order-type">Order Type</Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <a 
                        href="https://docs.polymarket.com/developers/CLOB/orders/create-order#order-types"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <HelpCircle className="h-4 w-4" />
                      </a>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs">
                      <p className="text-sm">
                        <strong>FOK</strong> - Fill Or Kill: Executes immediately in full or cancels entirely.<br />
                        <strong>GTC</strong> - Good Til Cancelled: Stays open until filled or cancelled.<br />
                        <strong>GTD</strong> - Good Til Date: Expires at your specified date/time if not filled.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Select value={orderType} onValueChange={(v) => setOrderType(v as PolymarketOrderType)}>
                  <SelectTrigger id="sell-order-type" data-testid="select-sell-order-type">
                    <SelectValue placeholder="Select order type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FOK" data-testid="option-sell-order-fok">FOK (Fill Or Kill)</SelectItem>
                    <SelectItem value="GTC" data-testid="option-sell-order-gtc">GTC (Good Til Cancelled)</SelectItem>
                    <SelectItem value="GTD" data-testid="option-sell-order-gtd">GTD (Good Til Date)</SelectItem>
                  </SelectContent>
                </Select>
                
                {orderType === "GTD" && (
                  <div className="mt-2 space-y-1">
                    <div className="flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                      <Label htmlFor="sell-gtd-expiration" className="text-sm">Expiration Date & Time</Label>
                    </div>
                    <Input
                      id="sell-gtd-expiration"
                      type="datetime-local"
                      value={gtdExpiration}
                      onChange={(e) => setGtdExpiration(e.target.value)}
                      min={new Date(Date.now() + 120000).toISOString().slice(0, 16)}
                      data-testid="input-sell-gtd-expiration"
                    />
                    <p className="text-xs text-muted-foreground">
                      Order will automatically cancel at this time if not filled
                    </p>
                  </div>
                )}
              </div>

              {/* Limit Price for GTC/GTD sell orders */}
              {orderType !== "FOK" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="sell-limit-price">Limit Price</Label>
                    <span className="text-xs text-muted-foreground">
                      Best Ask: {bestAskPrice ? `${(bestAskPrice * 100).toFixed(1)}c` : "N/A"}
                    </span>
                  </div>
                  <div className="relative">
                    <Input
                      id="sell-limit-price"
                      type="number"
                      placeholder="0.00"
                      value={sellLimitPrice}
                      onChange={(e) => setSellLimitPrice(e.target.value)}
                      min="0.01"
                      max="0.99"
                      step="0.01"
                      data-testid="input-sell-limit-price"
                      className="pr-8"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Lower limit price = more likely to fill. Order stays open until filled at this price or better.
                  </p>
                </div>
              )}

              {parsedSellShares > 0 && (
                <div className="rounded-md bg-muted/50 p-3 space-y-2">
                  {orderType !== "FOK" && parsedSellLimitPrice > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Limit Price:</span>
                      <span>{(parsedSellLimitPrice * 100).toFixed(1)}c</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      Est. Proceeds @ {orderType === "FOK" ? "market" : `${(effectiveSellPrice * 100).toFixed(1)}c`}:
                    </span>
                    <span className="font-medium">${sellProceeds.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">P&L:</span>
                    <span className={sellPnl >= 0 ? "text-green-600" : "text-red-600"}>
                      {sellPnl >= 0 ? "+" : ""}${sellPnl.toFixed(2)}
                    </span>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="rounded-md bg-muted/50 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted-foreground">Current Price</span>
                  <Badge variant="outline">{(yesPrice * 100).toFixed(1)}c</Badge>
                </div>
                {orderBookLoading ? (
                  <div className="flex items-center justify-center py-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Best Bid: </span>
                      <span className="text-green-600 dark:text-green-400">
                        {bestBid ? `${(parseFloat(bestBid.price) * 100).toFixed(1)}c` : "--"}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Best Ask: </span>
                      <span className="text-red-600 dark:text-red-400">
                        {bestAsk ? `${(parseFloat(bestAsk.price) * 100).toFixed(1)}c` : "--"}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <Tabs value={side} onValueChange={(v) => setSide(v as "YES" | "NO")} className="w-full">
                <TabsList className="w-full grid grid-cols-2">
                  <TabsTrigger value="YES" className="gap-1" data-testid="tab-yes">
                    <TrendingUp className="h-4 w-4" />
                    YES ({(yesPrice * 100).toFixed(1)}c)
                  </TabsTrigger>
                  <TabsTrigger value="NO" className="gap-1" data-testid="tab-no">
                    <TrendingDown className="h-4 w-4" />
                    NO ({(noPrice * 100).toFixed(1)}c)
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              <div className="space-y-2">
                <Label htmlFor="amount">Amount (USDC)</Label>
                <Input
                  id="amount"
                  type="number"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  min="0"
                  step="0.01"
                  data-testid="input-bet-amount"
                />
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Available:</span>
                  <span>${userBalance.toFixed(2)} USDC</span>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-1">
                  <Label htmlFor="order-type">Order Type</Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <a 
                        href="https://docs.polymarket.com/developers/CLOB/orders/create-order#order-types"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <HelpCircle className="h-4 w-4" />
                      </a>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs">
                      <p className="text-sm">
                        <strong>FOK</strong> - Fill Or Kill: Executes immediately in full or cancels entirely.<br />
                        <strong>GTC</strong> - Good Til Cancelled: Stays open until filled or cancelled.<br />
                        <strong>GTD</strong> - Good Til Date: Expires at your specified date/time if not filled.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Select value={orderType} onValueChange={(v) => setOrderType(v as PolymarketOrderType)}>
                  <SelectTrigger id="order-type" data-testid="select-order-type">
                    <SelectValue placeholder="Select order type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FOK" data-testid="option-order-fok">FOK (Fill Or Kill)</SelectItem>
                    <SelectItem value="GTC" data-testid="option-order-gtc">GTC (Good Til Cancelled)</SelectItem>
                    <SelectItem value="GTD" data-testid="option-order-gtd">GTD (Good Til Date)</SelectItem>
                  </SelectContent>
                </Select>
                
                {orderType === "GTD" && (
                  <div className="mt-2 space-y-1">
                    <div className="flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                      <Label htmlFor="gtd-expiration" className="text-sm">Expiration Date & Time</Label>
                    </div>
                    <Input
                      id="gtd-expiration"
                      type="datetime-local"
                      value={gtdExpiration}
                      onChange={(e) => setGtdExpiration(e.target.value)}
                      min={new Date(Date.now() + 120000).toISOString().slice(0, 16)}
                      data-testid="input-gtd-expiration"
                    />
                    <p className="text-xs text-muted-foreground">
                      Order will automatically cancel at this time if not filled
                    </p>
                  </div>
                )}
              </div>

              {/* Limit Price for GTC/GTD orders */}
              {orderType !== "FOK" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="limit-price">Limit Price</Label>
                    <span className="text-xs text-muted-foreground">
                      Best Bid: {bestBidPrice ? `${(bestBidPrice * 100).toFixed(1)}c` : "N/A"}
                    </span>
                  </div>
                  <div className="relative">
                    <Input
                      id="limit-price"
                      type="number"
                      placeholder="0.00"
                      value={limitPrice}
                      onChange={(e) => setLimitPrice(e.target.value)}
                      min="0.01"
                      max="0.99"
                      step="0.01"
                      data-testid="input-limit-price"
                      className="pr-8"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Higher limit price = more likely to fill. Order stays open until filled at this price or better.
                  </p>
                </div>
              )}

              {parsedAmount > 0 && (
                <div className="rounded-md bg-muted/50 p-3 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Bet Amount:</span>
                    <span>${parsedAmount.toFixed(2)}</span>
                  </div>
                  {orderType !== "FOK" && parsedLimitPrice > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Limit Price:</span>
                      <span>{(parsedLimitPrice * 100).toFixed(1)}c</span>
                    </div>
                  )}
                  {feePercentage > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Platform Fee ({feePercentage}%):</span>
                      <span className="text-amber-600 dark:text-amber-400">${feeAmount.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-sm font-medium border-t border-border pt-2">
                    <span>Total Cost:</span>
                    <span>${totalCost.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Shares @ {orderType === "FOK" ? "market" : `${(effectivePrice * 100).toFixed(1)}c`}:</span>
                    <span>{shares.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Potential Payout:</span>
                    <span className="text-green-600 dark:text-green-400">
                      ${potentialPayout.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Potential Profit:</span>
                    <span className={potentialProfit >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
                      {potentialProfit >= 0 ? "+" : ""}${potentialProfit.toFixed(2)} ({totalCost > 0 ? ((potentialProfit / totalCost) * 100).toFixed(0) : 0}%)
                    </span>
                  </div>
                </div>
              )}
            </>
          )}

          <div className="flex items-start gap-2 rounded-md bg-amber-500/10 p-3 text-sm">
            <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
            <p className="text-muted-foreground">
              Orders are signed with your wallet and placed directly on Polymarket. Trading involves risk.
            </p>
          </div>

          {!walletAddress && (
            <div className="flex items-center gap-2 rounded-md bg-blue-500/10 p-3 text-sm">
              <Wallet className="h-4 w-4 text-blue-500 flex-shrink-0" />
              <p className="text-muted-foreground">
                Connect your wallet to place bets on Polymarket
              </p>
            </div>
          )}

          {walletAddress && !isTradingSessionComplete && (
            <div className="flex items-center gap-2 rounded-md bg-orange-500/10 p-3 text-sm border border-orange-500/20">
              <AlertCircle className="h-4 w-4 text-orange-500 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-orange-600 dark:text-orange-400 font-medium">
                  {!signerAvailable ? "Waiting for wallet..." : "Trading Setup Required"}
                </p>
                <p className="text-muted-foreground text-xs mt-0.5">
                  {!signerAvailable 
                    ? "Approve connection in your wallet app" 
                    : "Initialize your Polymarket trading session to place bets."}
                </p>
              </div>
              {!signerAvailable ? (
                <Loader2 className="h-4 w-4 text-orange-500 animate-spin flex-shrink-0" />
              ) : (
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={() => initializeTradingSession()}
                  disabled={isInitializing || !signerAvailable}
                  className="border-orange-500/50 text-orange-600 dark:text-orange-400"
                  data-testid="button-init-session"
                >
                  {isInitializing ? (
                    <>
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      Initializing...
                    </>
                  ) : (
                    "Initialize"
                  )}
                </Button>
              )}
            </div>
          )}

          {approvalStatus.checked && approvalStatus.needsApproval && walletAddress && isTradingSessionComplete && (
            <div 
              className="flex items-center gap-2 rounded-md bg-yellow-500/10 p-3 text-sm border border-yellow-500/20"
              data-testid="banner-approval-needed"
            >
              <AlertCircle className="h-4 w-4 text-yellow-500 flex-shrink-0" />
              <div className="flex-1">
                <span className="text-yellow-600 dark:text-yellow-400 font-medium">USDC Approval Required</span>
                <p className="text-muted-foreground text-xs mt-0.5">Approve USDC spending before placing bets</p>
              </div>
              <Button 
                size="sm" 
                variant="outline"
                onClick={() => setShowDepositWizard(true)}
                className="border-yellow-500/50 text-yellow-600 dark:text-yellow-400"
                data-testid="button-approve-usdc"
              >
                Approve
              </Button>
            </div>
          )}
          </div>
        </ScrollArea>

        {/* Sticky footer with action buttons - always visible on mobile */}
        <div className="flex-shrink-0 border-t border-border bg-background pt-4 pb-[env(safe-area-inset-bottom,0)] space-y-3">
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} className="flex-1" data-testid="button-cancel-bet">
              Cancel
            </Button>
            {isSellMode ? (
              <Button
                onClick={handleSellPosition}
                disabled={parsedSellShares <= 0 || parsedSellShares > (position?.size || 0) || isPlacing || isPlacingOrderLocal || !walletAddress || !isTradingSessionComplete || (approvalStatus.checked && approvalStatus.needsApproval)}
                className="flex-1"
                data-testid="button-confirm-sell"
              >
                {isPlacing || isPlacingOrderLocal ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Signing...
                  </>
                ) : !walletAddress ? (
                  "Connect Wallet"
                ) : !isTradingSessionComplete ? (
                  "Initialize Session First"
                ) : approvalStatus.checked && approvalStatus.needsApproval ? (
                  "Approve USDC First"
                ) : (
                  `Sell ${parsedSellShares.toFixed(2)} shares`
                )}
              </Button>
            ) : (
              <Button
                onClick={handlePlaceBet}
                disabled={parsedAmount <= 0 || totalCost > (tradingWallet.balance > 0 ? tradingWallet.balance : userBalance) || isPlacing || isPlacingOrderLocal || !walletAddress || !isTradingSessionComplete || (approvalStatus.checked && approvalStatus.needsApproval)}
                className="flex-1"
                data-testid="button-confirm-bet"
              >
                {isPlacing || isPlacingOrderLocal ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Signing...
                  </>
                ) : !walletAddress ? (
                  "Connect Wallet"
                ) : !isTradingSessionComplete ? (
                  "Initialize Session First"
                ) : approvalStatus.checked && approvalStatus.needsApproval ? (
                  "Approve USDC First"
                ) : (
                  `Bet $${parsedAmount.toFixed(2)} on ${side}`
                )}
              </Button>
            )}
          </div>

          <a
            href="https://polymarket.com/event/f1-constructors-champion"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="h-3 w-3" />
            View market on Polymarket
          </a>
        </div>
      </DialogContent>

      <PolymarketDepositWizard
        open={showDepositWizard}
        onClose={async () => {
          setShowDepositWizard(false);
          // Recheck approval status after wizard closes
          if (walletAddress && provider) {
            try {
              const isMagic = walletType === "magic";
              const status = await checkDepositRequirements(provider, walletAddress, isMagic);
              setApprovalStatus({ needsApproval: status.needsApproval, checked: true });
            } catch (error) {
              console.error("Failed to recheck approval status:", error);
            }
          }
          // If there's a pending retry, prompt user to retry the order
          if (pendingRetry) {
            setPendingRetry(false);
            toast({
              title: "Ready to Trade",
              description: "Approvals complete. Click the bet button again to place your order.",
            });
          }
        }}
      />
    </Dialog>
  );
}
