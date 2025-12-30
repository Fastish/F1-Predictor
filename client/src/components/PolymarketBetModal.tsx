import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Loader2, TrendingUp, TrendingDown, AlertCircle, ExternalLink, Wallet, HelpCircle, Calendar } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useMarket } from "@/context/MarketContext";
import { useWallet } from "@/context/WalletContext";
import { useTradingSession } from "@/hooks/useTradingSession";
import { usePlaceOrder, type PolymarketOrderType } from "@/hooks/usePlaceOrder";
import { PolymarketDepositWizard } from "./PolymarketDepositWizard";
import { checkDepositRequirements } from "@/lib/polymarketDeposit";

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
  const [orderType, setOrderType] = useState<PolymarketOrderType>("FOK");
  const [gtdExpiration, setGtdExpiration] = useState<string>("");
  const [isPlacingOrderLocal, setIsPlacingOrderLocal] = useState(false);
  const [showDepositWizard, setShowDepositWizard] = useState(false);
  const [pendingRetry, setPendingRetry] = useState(false);
  const [approvalStatus, setApprovalStatus] = useState<{ needsApproval: boolean; checked: boolean }>({ needsApproval: false, checked: false });
  const { toast } = useToast();
  const { userId } = useMarket();
  const { signer, walletAddress, walletType, provider } = useWallet();
  
  // Reset GTD expiration when modal closes or order type changes
  useEffect(() => {
    if (!open) {
      setGtdExpiration("");
      setOrderType("FOK");
    }
  }, [open]);
  
  // Check approval status when modal opens
  useEffect(() => {
    const checkApproval = async () => {
      if (!open || !walletAddress || !provider) {
        setApprovalStatus({ needsApproval: false, checked: false });
        return;
      }
      try {
        const isMagic = walletType === "magic";
        const status = await checkDepositRequirements(provider, walletAddress, isMagic);
        setApprovalStatus({ needsApproval: status.needsApproval, checked: true });
      } catch (error) {
        console.error("Failed to check approval status:", error);
        setApprovalStatus({ needsApproval: false, checked: true });
      }
    };
    checkApproval();
  }, [open, walletAddress, provider, walletType]);
  
  // Trading session with ClobClient for order placement
  const { 
    isTradingSessionComplete, 
    invalidateSession,
    clobClient,
    initializeTradingSession,
    isInitializing
  } = useTradingSession();
  
  const { placeOrder, isPlacing } = usePlaceOrder(clobClient, invalidateSession);

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

  const selectedPrice = side === "YES" ? yesPrice : noPrice;
  const selectedTokenId = side === "YES" 
    ? (outcome.yesTokenId || outcome.tokenId) 
    : (outcome.noTokenId || outcome.tokenId);
  const parsedAmount = parseFloat(amount) || 0;
  
  // Fee calculations
  const feePercentage = feeConfig?.feePercentage ?? 0;
  const feeAmount = parsedAmount * (feePercentage / 100);
  const totalCost = parsedAmount + feeAmount;
  
  const shares = parsedAmount > 0 && selectedPrice > 0 ? parsedAmount / selectedPrice : 0;
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

    if (totalCost > userBalance) {
      toast({
        title: "Insufficient Balance",
        description: `You need $${totalCost.toFixed(2)} USDC (including ${feePercentage}% fee) but only have $${userBalance.toFixed(2)}`,
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

    try {
      toast({
        title: "Signing Order",
        description: "Please sign the order in your wallet...",
      });

      // Convert GTD expiration to Unix timestamp (seconds) if provided
      const expirationTimestamp = orderType === "GTD" && gtdExpiration 
        ? Math.floor(new Date(gtdExpiration).getTime() / 1000)
        : undefined;
      
      const result = await placeOrder({
        tokenId: selectedTokenId,
        price: selectedPrice,
        size: shares,
        side: "BUY",
        negRisk: true, // F1 markets are negative risk
        orderType,
        expiration: expirationTimestamp,
      });

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
          price: selectedPrice,
          size: shares,
          totalCost: parsedAmount,
          polymarketOrderId: result.orderId,
          status: result.orderId ? "open" : "pending",
          postOrderResponse: result.rawResponse,
        });

        // Record platform fee if enabled
        if (feePercentage > 0 && feeAmount > 0 && walletAddress) {
          try {
            await apiRequest("POST", "/api/fees/record", {
              walletAddress,
              orderType: "buy",
              marketName: outcome.name,
              tokenId: selectedTokenId,
              orderAmount: parsedAmount,
              feePercentage,
              feeAmount,
              status: "confirmed", // Fee is collected with the order
            });
          } catch (feeError) {
            console.error("Failed to record fee:", feeError);
            // Don't fail the order just because fee recording failed
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
            toast({
              title: "Order Rejected",
              description: "Polymarket rejected the order. This may be due to insufficient balance, invalid credentials, or a temporary issue. Try resetting your trading session.",
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
          toast({
            title: "Insufficient Balance",
            description: "You don't have enough USDC.e in your wallet for this trade.",
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
      console.error("Error placing bet:", error);
      toast({
        title: "Order Failed",
        description: error instanceof Error ? error.message : "Failed to place order",
        variant: "destructive",
      });
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

    try {
      toast({
        title: "Fetching Best Price",
        description: "Getting current market price...",
      });

      const orderbookResponse = await fetch(`/api/polymarket/orderbook/${position.tokenId}`);
      let sellPrice = position.currentPrice;
      
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

      toast({
        title: "Signing Sell Order",
        description: `Selling at ${(sellPrice * 100).toFixed(1)}c per share...`,
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

      if (result.success) {
        await apiRequest("POST", "/api/polymarket/record-order", {
          userId,
          tokenId: position.tokenId,
          marketName: outcome.name,
          outcome: position.outcome,
          side: "SELL",
          price: sellPrice,
          size: sharesToSell,
          totalCost: sharesToSell * sellPrice,
          polymarketOrderId: result.orderId,
          status: result.orderId ? "open" : "pending",
          conditionId: position.conditionId,
        });

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
      console.error("Error selling position:", error);
      toast({
        title: "Sell Failed",
        description: error instanceof Error ? error.message : "Failed to sell position",
        variant: "destructive",
      });
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
  const sellProceeds = parsedSellShares * (position?.currentPrice || 0);
  const sellPnl = position ? (sellProceeds - (parsedSellShares * position.averagePrice)) : 0;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>{isSellMode ? `Sell ${position?.outcome || outcome.name}` : `Bet on ${outcome.name}`}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
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

              {parsedSellShares > 0 && (
                <div className="rounded-md bg-muted/50 p-3 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Proceeds:</span>
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

              {parsedAmount > 0 && (
                <div className="rounded-md bg-muted/50 p-3 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Bet Amount:</span>
                    <span>${parsedAmount.toFixed(2)}</span>
                  </div>
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
                    <span className="text-muted-foreground">Shares:</span>
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
                <p className="text-orange-600 dark:text-orange-400 font-medium">Trading Setup Required</p>
                <p className="text-muted-foreground text-xs mt-0.5">
                  Initialize your Polymarket trading session to place bets.
                </p>
              </div>
              <Button 
                size="sm" 
                variant="outline"
                onClick={() => initializeTradingSession()}
                disabled={isInitializing}
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
                disabled={parsedAmount <= 0 || totalCost > userBalance || isPlacing || isPlacingOrderLocal || !walletAddress || !isTradingSessionComplete || (approvalStatus.checked && approvalStatus.needsApproval)}
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
