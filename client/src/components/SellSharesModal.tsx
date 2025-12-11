import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMarket } from "@/context/MarketContext";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { TrendingDown, DollarSign, Loader2 } from "lucide-react";
import type { Team, Holding } from "@shared/schema";

interface SellSharesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  team: Team;
  holding: Holding;
}

export function SellSharesModal({ open, onOpenChange, team, holding }: SellSharesModalProps) {
  const { userId, refetch } = useMarket();
  const { toast } = useToast();
  const [quantity, setQuantity] = useState("1");

  const sellMutation = useMutation({
    mutationFn: async (qty: number) => {
      const res = await fetch("/api/trade/sell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: team.id, quantity: qty, userId }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to sell shares");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users", userId, "holdings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users", userId] });
      queryClient.invalidateQueries({ queryKey: ["/api/teams"] });
      toast({
        title: "Shares Sold",
        description: `Successfully sold ${quantity} shares of ${team.name}`,
      });
      refetch();
      onOpenChange(false);
      setQuantity("1");
    },
    onError: (error: Error) => {
      toast({
        title: "Sale Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSell = () => {
    const qty = parseInt(quantity);
    if (isNaN(qty) || qty <= 0 || qty > holding.shares) {
      toast({
        title: "Invalid Quantity",
        description: `Please enter a quantity between 1 and ${holding.shares}`,
        variant: "destructive",
      });
      return;
    }
    sellMutation.mutate(qty);
  };

  const parsedQty = parseInt(quantity) || 0;
  const totalProceeds = parsedQty * team.price;
  const costBasis = parsedQty * holding.avgPrice;
  const realizedPL = totalProceeds - costBasis;
  const isProfit = realizedPL >= 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div
              className="h-4 w-4 rounded-full"
              style={{ backgroundColor: team.color }}
            />
            Sell {team.name}
          </DialogTitle>
          <DialogDescription>
            Close your position or sell some shares
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="rounded-md bg-muted p-4 space-y-3">
            <div className="flex justify-between items-center gap-4">
              <span className="text-muted-foreground">Your Shares</span>
              <span className="font-bold tabular-nums">{holding.shares}</span>
            </div>
            <div className="flex justify-between items-center gap-4">
              <span className="text-muted-foreground">Entry Price</span>
              <span className="font-medium tabular-nums">${holding.avgPrice.toFixed(4)}</span>
            </div>
            <div className="flex justify-between items-center gap-4">
              <span className="text-muted-foreground">Current Price</span>
              <span className="font-medium tabular-nums">${team.price.toFixed(4)}</span>
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-sm font-medium">Shares to Sell</label>
            <div className="flex gap-2">
              <Input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                min="1"
                max={holding.shares}
                className="flex-1"
                data-testid="input-sell-quantity"
              />
              <Button
                variant="outline"
                onClick={() => setQuantity(holding.shares.toString())}
                data-testid="button-sell-all"
              >
                Sell All
              </Button>
            </div>
            <div className="flex gap-2 flex-wrap">
              {[10, 25, 50, 100].map((pct) => {
                const shares = Math.max(1, Math.floor(holding.shares * (pct / 100)));
                return (
                  <Button
                    key={pct}
                    variant="outline"
                    size="sm"
                    onClick={() => setQuantity(shares.toString())}
                    data-testid={`button-sell-preset-${pct}`}
                  >
                    {pct}%
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="rounded-md bg-muted p-4 space-y-2">
            <div className="flex justify-between items-center gap-4">
              <span className="text-muted-foreground">Cost Basis</span>
              <span className="tabular-nums">${costBasis.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center gap-4">
              <span className="text-muted-foreground">Sale Proceeds</span>
              <span className="font-bold tabular-nums">${totalProceeds.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center gap-4 pt-2 border-t">
              <span className="text-muted-foreground">Realized P&L</span>
              <span
                className={`font-bold tabular-nums ${
                  isProfit ? "text-green-500 dark:text-green-400" : "text-red-500 dark:text-red-400"
                }`}
              >
                {isProfit ? "+" : ""}${realizedPL.toFixed(2)}
              </span>
            </div>
          </div>

          <Button
            onClick={handleSell}
            disabled={sellMutation.isPending || parsedQty <= 0 || parsedQty > holding.shares || !userId}
            className="w-full"
            variant="destructive"
            data-testid="button-confirm-sell"
          >
            {sellMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Selling...
              </>
            ) : (
              <>
                <TrendingDown className="h-4 w-4 mr-2" />
                Sell {parsedQty} Shares for ${totalProceeds.toFixed(2)}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
