import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Loader2, Wallet, Minus, Plus, AlertCircle, TrendingUp } from "lucide-react";
import { useWallet } from "@/context/WalletContext";

interface PoolOutcome {
  id: string;
  poolId: string;
  participantId: string;
  participantName: string;
  sharesOutstanding: number;
  price: number;
  probability: number;
}

interface ChampionshipPool {
  id: string;
  seasonId: string;
  type: "team" | "driver";
  status: string;
  bParameter: number;
  totalCollateral: number;
  outcomes: PoolOutcome[];
}

interface PoolBuyModalProps {
  open: boolean;
  onClose: () => void;
  pool: ChampionshipPool | null;
  participantId: string;
  participantName: string;
  participantColor: string;
  userId: string;
}

interface QuoteResponse {
  outcomeId: string;
  shares: number;
  cost: number;
  averagePrice: number;
  currentPrice: number;
  newPrice: number;
  priceImpact: number;
}

export function PoolBuyModal({
  open,
  onClose,
  pool,
  participantId,
  participantName,
  participantColor,
  userId,
}: PoolBuyModalProps) {
  const { toast } = useToast();
  const { walletAddress, getUsdcBalance } = useWallet();
  
  const [shares, setShares] = useState(10);
  const [sharesInput, setSharesInput] = useState("10");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const outcome = pool?.outcomes?.find(o => o.participantId === participantId);
  
  const handleSharesInputChange = (value: string) => {
    setSharesInput(value);
    const numValue = parseInt(value, 10);
    if (!isNaN(numValue) && numValue > 0) {
      setShares(numValue);
    }
  };

  const handleSharesInputBlur = () => {
    const numValue = parseInt(sharesInput, 10);
    if (isNaN(numValue) || numValue <= 0) {
      setShares(1);
      setSharesInput("1");
    } else {
      setSharesInput(numValue.toString());
    }
  };

  const handleSharesButtonChange = (newValue: number) => {
    const validValue = Math.max(1, newValue);
    setShares(validValue);
    setSharesInput(validValue.toString());
  };

  const { data: usdcBalance } = useQuery({
    queryKey: ["polygon-usdc-balance", walletAddress],
    queryFn: async () => {
      if (!walletAddress) return "0";
      return await getUsdcBalance();
    },
    enabled: !!walletAddress && open,
  });

  const { data: quote, isLoading: quoteLoading } = useQuery<QuoteResponse>({
    queryKey: ["/api/pools", pool?.id, "quote", outcome?.id, shares],
    queryFn: async () => {
      if (!pool || !outcome) return null;
      const res = await fetch(`/api/pools/${pool.id}/quote?outcomeId=${outcome.id}&shares=${shares}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!pool && !!outcome && shares > 0 && open,
    refetchInterval: 10000,
  });

  const walletUsdcBalance = usdcBalance ? parseFloat(usdcBalance) : 0;
  const currentPrice = outcome?.price || 0;
  const totalCost = quote?.cost || (currentPrice * shares);
  const canAfford = totalCost <= walletUsdcBalance;
  const canBuy = canAfford && shares > 0 && !!walletAddress && !!pool && !!outcome;

  const invalidateQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/pools/type/team"] });
    queryClient.invalidateQueries({ queryKey: ["/api/pools/type/driver"] });
    queryClient.invalidateQueries({ queryKey: ["/api/pools/positions", userId] });
    queryClient.invalidateQueries({ queryKey: ["/api/pools/trades", userId] });
    queryClient.invalidateQueries({ queryKey: ["/api/users", userId] });
    queryClient.invalidateQueries({ queryKey: ["polygon-usdc-balance", walletAddress] });
    queryClient.invalidateQueries({ queryKey: ["/api/pools", pool?.id] });
  };

  const handleBuy = async () => {
    if (!pool || !outcome || !walletAddress) return;
    
    setIsSubmitting(true);
    
    try {
      const response = await fetch(`/api/pools/${pool.id}/buy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outcomeId: outcome.id,
          userId,
          shares,
        }),
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || "Failed to complete purchase");
      }
      
      toast({
        title: "Purchase Successful",
        description: `Bought ${shares} shares of ${participantName} for $${result.cost.toFixed(2)}`,
      });
      
      invalidateQueries();
      onClose();
      setShares(10);
      setSharesInput("10");
      
    } catch (error: any) {
      console.error("Pool buy error:", error);
      toast({
        title: "Purchase Failed",
        description: error.message || "Failed to complete purchase",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    onClose();
    setShares(10);
    setSharesInput("10");
  };

  if (!pool || !outcome) return null;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div
              className="h-4 w-4 rounded-full"
              style={{ backgroundColor: participantColor }}
            />
            <DialogTitle data-testid="text-modal-participant-name">
              Buy {participantName}
            </DialogTitle>
          </div>
          <DialogDescription>
            Purchase shares to bet on the championship win
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <span className="text-muted-foreground text-sm">Current Odds</span>
              <div className="flex items-center gap-2">
                <span className="text-xl font-bold tabular-nums" data-testid="text-modal-price">
                  {(currentPrice * 100).toFixed(1)}%
                </span>
                <Badge variant="secondary" className="text-xs">
                  ${currentPrice.toFixed(2)}/share
                </Badge>
              </div>
            </div>
            <div className="text-right">
              <span className="text-muted-foreground text-sm">Potential Profit</span>
              <div className="flex items-center gap-1 text-green-600">
                <TrendingUp className="h-4 w-4" />
                <span className="text-xl font-bold tabular-nums">
                  ${(shares - totalCost).toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Shares to Buy</label>
            <div className="flex items-center justify-center gap-4">
              <Button
                size="icon"
                variant="outline"
                onClick={() => handleSharesButtonChange(shares - 10)}
                disabled={shares <= 1}
                data-testid="button-decrease-shares"
              >
                <Minus className="h-4 w-4" />
              </Button>
              <Input
                type="number"
                min="1"
                value={sharesInput}
                onChange={(e) => handleSharesInputChange(e.target.value)}
                onBlur={handleSharesInputBlur}
                className="w-24 text-center text-2xl font-bold tabular-nums"
                data-testid="input-shares"
              />
              <Button
                size="icon"
                variant="outline"
                onClick={() => handleSharesButtonChange(shares + 10)}
                data-testid="button-increase-shares"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex justify-center gap-2 flex-wrap">
              {[10, 50, 100, 500].map((preset) => (
                <Button
                  key={preset}
                  size="sm"
                  variant="secondary"
                  onClick={() => handleSharesButtonChange(preset)}
                  data-testid={`button-preset-${preset}`}
                >
                  {preset}
                </Button>
              ))}
            </div>
          </div>

          <div className="rounded-lg border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-medium">Estimated Cost</span>
              <span className="text-2xl font-bold tabular-nums" data-testid="text-total-cost">
                {quoteLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  `$${totalCost.toFixed(2)}`
                )}
              </span>
            </div>
            {quote && (
              <div className="text-sm text-muted-foreground space-y-1">
                <div className="flex justify-between">
                  <span>Avg. Price per Share</span>
                  <span>${quote.averagePrice.toFixed(4)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Price After Trade</span>
                  <span>${quote.newPrice.toFixed(4)}</span>
                </div>
                {quote.priceImpact > 1 && (
                  <div className="flex justify-between text-amber-600">
                    <span>Price Impact</span>
                    <span>{quote.priceImpact.toFixed(1)}%</span>
                  </div>
                )}
              </div>
            )}
            <div className="flex items-center justify-between text-sm text-muted-foreground pt-2 border-t">
              <span className="flex items-center gap-1">
                <Wallet className="h-3.5 w-3.5" />
                USDC Balance
              </span>
              <span className="tabular-nums" data-testid="text-modal-balance">
                ${walletUsdcBalance.toFixed(2)}
              </span>
            </div>
          </div>

          {!canAfford && walletAddress && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>Insufficient USDC balance. You need ${(totalCost - walletUsdcBalance).toFixed(2)} more.</span>
            </div>
          )}

          {!walletAddress && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-600 dark:text-amber-400">
              <Wallet className="h-4 w-4 shrink-0" />
              <span>Please connect your wallet to purchase shares.</span>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleClose} data-testid="button-cancel-purchase">
            Cancel
          </Button>
          <Button 
            onClick={handleBuy} 
            disabled={!canBuy || isSubmitting} 
            data-testid="button-confirm-purchase"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Processing...
              </>
            ) : (
              `Buy ${shares} Share${shares > 1 ? "s" : ""}`
            )}
          </Button>
        </DialogFooter>

        <p className="text-center text-xs text-muted-foreground">
          Shares will be worth $1 each if this {pool.type} wins the championship.
        </p>
      </DialogContent>
    </Dialog>
  );
}
