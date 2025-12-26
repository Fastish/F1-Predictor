import { useState } from "react";
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
import { Loader2, TrendingUp, TrendingDown, Wallet, Settings } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useMarket } from "@/context/MarketContext";
import { useWallet } from "@/context/WalletContext";
import { usePolymarketTrading } from "@/hooks/usePolymarketTrading";
import { PolymarketDepositWizard } from "./PolymarketDepositWizard";

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

interface PolymarketBetModalProps {
  open: boolean;
  onClose: () => void;
  outcome: PolymarketOutcome;
  userBalance: number;
}

export function PolymarketBetModal({ open, onClose, outcome, userBalance }: PolymarketBetModalProps) {
  const [side, setSide] = useState<"YES" | "NO">("YES");
  const [amount, setAmount] = useState("");
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [showDepositWizard, setShowDepositWizard] = useState(false);
  const { toast } = useToast();
  const { userId } = useMarket();
  const { signer, walletAddress, walletType } = useWallet();
  const { placeBuilderOrder, isPlacingOrder: hookIsPlacing } = usePolymarketTrading();

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

  const yesPrice = midpoint?.mid ?? outcome.price;
  const noPrice = outcome.noPrice ?? (1 - yesPrice);

  const selectedPrice = side === "YES" ? yesPrice : noPrice;
  const selectedTokenId = side === "YES" 
    ? (outcome.yesTokenId || outcome.tokenId) 
    : (outcome.noTokenId || outcome.tokenId);
  const parsedAmount = parseFloat(amount) || 0;
  const shares = parsedAmount > 0 && selectedPrice > 0 ? parsedAmount / selectedPrice : 0;
  const potentialPayout = shares * 1; // Each share pays $1 if wins
  const potentialProfit = potentialPayout - parsedAmount;

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

    if (parsedAmount <= 0) {
      toast({
        title: "Invalid Amount",
        description: "Please enter a valid bet amount",
        variant: "destructive",
      });
      return;
    }

    if (parsedAmount > userBalance) {
      toast({
        title: "Insufficient Balance",
        description: "You don't have enough USDC for this bet",
        variant: "destructive",
      });
      return;
    }

    setIsPlacingOrder(true);

    try {
      toast({
        title: "Signing Order",
        description: "Please sign the order in your wallet...",
      });

      const result = await placeBuilderOrder({
        tokenId: selectedTokenId,
        price: selectedPrice,
        size: shares,
        side: "BUY",
      });

      if (result.success) {
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
          status: "open",
        });

        toast({
          title: "Order Placed",
          description: "Your bet has been submitted to Polymarket",
        });

        queryClient.invalidateQueries({ queryKey: ["/api/polymarket"] });
        if (userId) {
          queryClient.invalidateQueries({ queryKey: ["/api/polymarket/orders", userId] });
        }
        onClose();
      } else {
        toast({
          title: "Order Failed",
          description: result.error || "Failed to place order on Polymarket",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error placing bet:", error);
      toast({
        title: "Order Failed",
        description: error instanceof Error ? error.message : "Failed to place order",
        variant: "destructive",
      });
    } finally {
      setIsPlacingOrder(false);
    }
  };

  // Polymarket API returns bids ascending (lowest first) and asks descending (highest first)
  // Best bid = highest bid (last in array), Best ask = lowest ask (last in array)
  const sortedBids = orderBook?.bids ? [...orderBook.bids].sort((a, b) => parseFloat(b.price) - parseFloat(a.price)) : [];
  const sortedAsks = orderBook?.asks ? [...orderBook.asks].sort((a, b) => parseFloat(a.price) - parseFloat(b.price)) : [];
  const bestBid = sortedBids[0];
  const bestAsk = sortedAsks[0];

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>Bet on {outcome.name}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
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

          {parsedAmount > 0 && (
            <div className="rounded-md bg-muted/50 p-3 space-y-2">
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
                <span className="text-green-600 dark:text-green-400">
                  +${potentialProfit.toFixed(2)} ({((potentialProfit / parsedAmount) * 100).toFixed(0)}%)
                </span>
              </div>
            </div>
          )}

          {!walletAddress && (
            <div className="flex items-center gap-2 rounded-md bg-blue-500/10 p-3 text-sm">
              <Wallet className="h-4 w-4 text-blue-500 flex-shrink-0" />
              <p className="text-muted-foreground">
                Connect your wallet to place bets on Polymarket
              </p>
            </div>
          )}

          {walletAddress && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowDepositWizard(true)}
              className="w-full"
              data-testid="button-setup-trading"
            >
              <Settings className="h-4 w-4 mr-2" />
              Setup Polymarket Trading Approvals
            </Button>
          )}

          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} className="flex-1" data-testid="button-cancel-bet">
              Close
            </Button>
            <Button
              className="flex-1"
              onClick={handlePlaceBet}
              disabled={isPlacingOrder || hookIsPlacing}
              data-testid="button-trade"
            >
              {isPlacingOrder || hookIsPlacing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Trading...
                </>
              ) : (
                "Trade"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>

      <PolymarketDepositWizard
        open={showDepositWizard}
        onClose={() => setShowDepositWizard(false)}
      />
    </Dialog>
  );
}
