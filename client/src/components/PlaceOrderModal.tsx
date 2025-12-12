import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, TrendingUp, TrendingDown } from "lucide-react";

interface Market {
  id: string;
  teamId: string;
  lastPrice: number | null;
  outstandingPairs: number;
  lockedCollateral: number;
}

interface PlaceOrderModalProps {
  open: boolean;
  onClose: () => void;
  market: Market | null;
  teamName: string;
  teamColor: string;
  userId: string;
  userBalance: number;
}

export function PlaceOrderModal({
  open,
  onClose,
  market,
  teamName,
  teamColor,
  userId,
  userBalance,
}: PlaceOrderModalProps) {
  const { toast } = useToast();
  
  const [outcome, setOutcome] = useState<"yes" | "no">("yes");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [price, setPrice] = useState("0.50");
  const [quantity, setQuantity] = useState("10");

  const { data: position } = useQuery({
    queryKey: ["/api/clob/users", userId, "positions"],
    queryFn: async () => {
      const res = await fetch(`/api/clob/users/${userId}/positions`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!userId && !!market,
  });

  const userPosition = position?.find((p: any) => p.marketId === market?.id);
  const yesShares = userPosition?.yesShares || 0;
  const noShares = userPosition?.noShares || 0;

  const placeOrderMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("/api/clob/orders", "POST", {
        marketId: market?.id,
        userId,
        outcome,
        side,
        price: parseFloat(price),
        quantity: parseInt(quantity),
      });
    },
    onSuccess: (data: any) => {
      const fillCount = data.fills?.length || 0;
      toast({
        title: "Order Placed",
        description: fillCount > 0 
          ? `Order placed with ${fillCount} fill(s)`
          : "Order added to order book",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/clob/markets", market?.id, "orderbook"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clob/users", userId, "orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clob/users", userId, "positions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users", userId] });
      onClose();
    },
    onError: (error: any) => {
      toast({
        title: "Order Failed",
        description: error.message || "Failed to place order",
        variant: "destructive",
      });
    },
  });

  const priceNum = parseFloat(price) || 0;
  const quantityNum = parseInt(quantity) || 0;
  const totalCost = side === "buy" ? priceNum * quantityNum : 0;
  const potentialPayout = side === "buy" ? quantityNum * 1 : priceNum * quantityNum;

  const canSubmit = 
    priceNum >= 0.01 && 
    priceNum <= 0.99 && 
    quantityNum > 0 &&
    (side === "sell" 
      ? (outcome === "yes" ? yesShares >= quantityNum : noShares >= quantityNum)
      : userBalance >= totalCost);

  if (!market) return null;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div
              className="w-4 h-4 rounded-full"
              style={{ backgroundColor: teamColor }}
            />
            Trade: {teamName} Wins?
          </DialogTitle>
          <DialogDescription>
            Place a limit order on the order book
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Tabs value={outcome} onValueChange={(v) => setOutcome(v as "yes" | "no")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="yes" className="data-[state=active]:bg-green-500/20 data-[state=active]:text-green-600" data-testid="tab-yes">
                <TrendingUp className="w-4 h-4 mr-1" />
                YES
              </TabsTrigger>
              <TabsTrigger value="no" className="data-[state=active]:bg-red-500/20 data-[state=active]:text-red-600" data-testid="tab-no">
                <TrendingDown className="w-4 h-4 mr-1" />
                NO
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="grid grid-cols-2 gap-2">
            <Button
              variant={side === "buy" ? "default" : "outline"}
              onClick={() => setSide("buy")}
              className={side === "buy" ? "bg-green-600 hover:bg-green-700" : ""}
              data-testid="button-buy"
            >
              Buy
            </Button>
            <Button
              variant={side === "sell" ? "default" : "outline"}
              onClick={() => setSide("sell")}
              className={side === "sell" ? "bg-red-600 hover:bg-red-700" : ""}
              data-testid="button-sell"
            >
              Sell
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="price">Price ($)</Label>
              <Input
                id="price"
                type="number"
                step="0.01"
                min="0.01"
                max="0.99"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                data-testid="input-price"
              />
              <p className="text-xs text-muted-foreground">
                0.01 - 0.99
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="quantity">Quantity</Label>
              <Input
                id="quantity"
                type="number"
                step="1"
                min="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                data-testid="input-quantity"
              />
              <p className="text-xs text-muted-foreground">
                Shares
              </p>
            </div>
          </div>

          <div className="bg-muted/50 rounded-lg p-3 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Your Balance:</span>
              <span>${userBalance.toFixed(2)} USDC</span>
            </div>
            {side === "buy" && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Cost:</span>
                <span>${totalCost.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">
                {side === "buy" ? "Max Payout (if win):" : "Proceeds:"}
              </span>
              <span className="text-green-600">${potentialPayout.toFixed(2)}</span>
            </div>
            {userPosition && (
              <div className="flex justify-between text-sm pt-2 border-t border-border">
                <span className="text-muted-foreground">Your Position:</span>
                <div className="flex gap-2">
                  <Badge variant="outline" className="text-green-600">
                    {yesShares} YES
                  </Badge>
                  <Badge variant="outline" className="text-red-600">
                    {noShares} NO
                  </Badge>
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} className="flex-1" data-testid="button-cancel-order">
              Cancel
            </Button>
            <Button
              onClick={() => placeOrderMutation.mutate()}
              disabled={!canSubmit || placeOrderMutation.isPending}
              className="flex-1"
              data-testid="button-submit-order"
            >
              {placeOrderMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                `${side === "buy" ? "Buy" : "Sell"} ${outcome.toUpperCase()}`
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
