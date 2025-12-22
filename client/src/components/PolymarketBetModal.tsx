import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
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
import { Loader2, TrendingUp, TrendingDown, AlertCircle, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface PolymarketOutcome {
  id: string;
  name: string;
  tokenId: string;
  price: number;
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
  const { toast } = useToast();

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

  const currentPrice = midpoint?.mid ?? outcome.price;
  const yesPrice = currentPrice;
  const noPrice = 1 - currentPrice;

  const selectedPrice = side === "YES" ? yesPrice : noPrice;
  const parsedAmount = parseFloat(amount) || 0;
  const shares = parsedAmount > 0 && selectedPrice > 0 ? parsedAmount / selectedPrice : 0;
  const potentialPayout = shares * 1; // Each share pays $1 if wins
  const potentialProfit = potentialPayout - parsedAmount;

  const placeBetMutation = useMutation({
    mutationFn: async (orderData: {
      tokenId: string;
      side: "BUY";
      outcome: "YES" | "NO";
      price: number;
      size: number;
    }) => {
      const response = await apiRequest("POST", "/api/polymarket/place-order", orderData);
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Order Submitted",
        description: "Your bet has been submitted to Polymarket",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/polymarket"] });
      onClose();
    },
    onError: (error: Error) => {
      toast({
        title: "Order Failed",
        description: error.message || "Failed to place order",
        variant: "destructive",
      });
    },
  });

  const handlePlaceBet = () => {
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

    placeBetMutation.mutate({
      tokenId: outcome.tokenId,
      side: "BUY",
      outcome: side,
      price: selectedPrice,
      size: shares,
    });
  };

  const bestBid = orderBook?.bids?.[0];
  const bestAsk = orderBook?.asks?.[0];

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
              <Badge variant="outline">{(currentPrice * 100).toFixed(1)}c</Badge>
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

          <div className="flex items-start gap-2 rounded-md bg-amber-500/10 p-3 text-sm">
            <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
            <p className="text-muted-foreground">
              Orders are placed on Polymarket via the builder API. Trading involves risk.
            </p>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} className="flex-1" data-testid="button-cancel-bet">
              Cancel
            </Button>
            <Button
              onClick={handlePlaceBet}
              disabled={parsedAmount <= 0 || parsedAmount > userBalance || placeBetMutation.isPending}
              className="flex-1"
              data-testid="button-confirm-bet"
            >
              {placeBetMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Placing...
                </>
              ) : (
                `Bet $${parsedAmount.toFixed(2)} on ${side}`
              )}
            </Button>
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
    </Dialog>
  );
}
