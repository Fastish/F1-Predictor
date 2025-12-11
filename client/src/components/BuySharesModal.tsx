import { useState } from "react";
import { Minus, Plus, AlertCircle, Wallet } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useMarket, type F1Team } from "@/context/MarketContext";
import { useWallet } from "@/context/WalletContext";
import { useToast } from "@/hooks/use-toast";

interface BuySharesModalProps {
  team: F1Team | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BuySharesModal({ team, open, onOpenChange }: BuySharesModalProps) {
  const [quantity, setQuantity] = useState(1);
  const { balance, buyShares } = useMarket();
  const { walletAddress } = useWallet();
  const { toast } = useToast();

  if (!team) return null;

  const totalCost = team.price * quantity;
  const canAfford = totalCost <= balance;
  const walletConnected = !!walletAddress;
  const canBuy = canAfford && quantity > 0 && walletConnected;

  const handleBuy = async () => {
    if (!canBuy) return;
    
    const success = await buyShares(team.id, quantity);
    if (success) {
      toast({
        title: "Purchase successful!",
        description: `You bought ${quantity} shares of ${team.name} for $${totalCost.toFixed(2)}`,
      });
      onOpenChange(false);
      setQuantity(1);
    } else {
      toast({
        title: "Purchase failed",
        description: "Unable to complete the transaction. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleClose = () => {
    onOpenChange(false);
    setQuantity(1);
  };

  const maxQuantity = Math.floor(balance / team.price);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div
              className="h-4 w-4 rounded-full"
              style={{ backgroundColor: team.color }}
            />
            <DialogTitle data-testid="text-modal-team-name">{team.name}</DialogTitle>
          </div>
          <DialogDescription>
            Purchase shares at the current market price
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Current Price</span>
            <span className="text-xl font-bold tabular-nums" data-testid="text-modal-price">
              ${team.price.toFixed(2)}
            </span>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Quantity</label>
            <div className="flex items-center justify-center gap-4">
              <Button
                size="icon"
                variant="outline"
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                disabled={quantity <= 1}
                data-testid="button-decrease-quantity"
              >
                <Minus className="h-4 w-4" />
              </Button>
              <span className="w-16 text-center text-2xl font-bold tabular-nums" data-testid="text-quantity">
                {quantity}
              </span>
              <Button
                size="icon"
                variant="outline"
                onClick={() => setQuantity(Math.min(maxQuantity, quantity + 1))}
                disabled={quantity >= maxQuantity}
                data-testid="button-increase-quantity"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex justify-center gap-2">
              {[10, 25, 50, 100].map((preset) => (
                <Button
                  key={preset}
                  size="sm"
                  variant="secondary"
                  onClick={() => setQuantity(Math.min(preset, maxQuantity))}
                  disabled={preset > maxQuantity}
                  data-testid={`button-preset-${preset}`}
                >
                  {preset}
                </Button>
              ))}
            </div>
          </div>

          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between">
              <span className="font-medium">Total Cost</span>
              <span className="text-2xl font-bold tabular-nums" data-testid="text-total-cost">
                ${totalCost.toFixed(2)}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between text-sm text-muted-foreground">
              <span>Your Balance</span>
              <span className="tabular-nums" data-testid="text-modal-balance">${balance.toFixed(2)}</span>
            </div>
          </div>

          {!canAfford && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>Insufficient balance. You need ${(totalCost - balance).toFixed(2)} more.</span>
            </div>
          )}

          {!walletConnected && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-600 dark:text-amber-400">
              <Wallet className="h-4 w-4 shrink-0" />
              <span>Please connect your Freighter wallet to purchase shares.</span>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleClose} data-testid="button-cancel-purchase">
            Cancel
          </Button>
          <Button onClick={handleBuy} disabled={!canBuy} data-testid="button-confirm-purchase">
            Buy {quantity} Share{quantity > 1 ? "s" : ""}
          </Button>
        </DialogFooter>

        <p className="text-center text-xs text-muted-foreground">
          Shares will be worth $1 each if this team wins the championship.
        </p>
      </DialogContent>
    </Dialog>
  );
}
