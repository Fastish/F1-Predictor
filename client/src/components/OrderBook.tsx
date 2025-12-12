import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface OrderBookLevel {
  price: number;
  quantity: number;
}

interface OrderBookData {
  yesBids: OrderBookLevel[];
  yesAsks: OrderBookLevel[];
  noBids: OrderBookLevel[];
  noAsks: OrderBookLevel[];
}

interface OrderBookProps {
  marketId: string;
  teamName: string;
  teamColor: string;
}

export function OrderBook({ marketId, teamName, teamColor }: OrderBookProps) {
  const { data: orderBook, isLoading } = useQuery<OrderBookData>({
    queryKey: ["/api/clob/markets", marketId, "orderbook"],
    queryFn: async () => {
      const res = await fetch(`/api/clob/markets/${marketId}/orderbook`);
      if (!res.ok) throw new Error("Failed to fetch order book");
      return res.json();
    },
    refetchInterval: 5000,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Order Book</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  const maxQty = Math.max(
    ...(orderBook?.yesBids || []).map((l) => l.quantity),
    ...(orderBook?.yesAsks || []).map((l) => l.quantity),
    1
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm">{teamName} Wins?</CardTitle>
          <div
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: teamColor }}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="outline" className="text-xs bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30">
                YES
              </Badge>
              <span className="text-xs text-muted-foreground">Team wins</span>
            </div>
            
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground flex justify-between px-1">
                <span>Price</span>
                <span>Qty</span>
              </div>
              
              {(orderBook?.yesAsks || []).slice(0, 5).reverse().map((level, i) => (
                <div
                  key={`ask-${i}`}
                  className="relative flex justify-between text-xs px-1 py-0.5 rounded"
                >
                  <div
                    className="absolute inset-0 bg-red-500/10 rounded"
                    style={{ width: `${(level.quantity / maxQty) * 100}%`, right: 0, left: 'auto' }}
                  />
                  <span className="relative text-red-600 dark:text-red-400">
                    ${level.price.toFixed(2)}
                  </span>
                  <span className="relative">{level.quantity}</span>
                </div>
              ))}
              
              <div className="h-px bg-border my-1" />
              
              {(orderBook?.yesBids || []).slice(0, 5).map((level, i) => (
                <div
                  key={`bid-${i}`}
                  className="relative flex justify-between text-xs px-1 py-0.5 rounded"
                >
                  <div
                    className="absolute inset-0 bg-green-500/10 rounded"
                    style={{ width: `${(level.quantity / maxQty) * 100}%` }}
                  />
                  <span className="relative text-green-600 dark:text-green-400">
                    ${level.price.toFixed(2)}
                  </span>
                  <span className="relative">{level.quantity}</span>
                </div>
              ))}
              
              {(!orderBook?.yesBids?.length && !orderBook?.yesAsks?.length) && (
                <div className="text-xs text-muted-foreground text-center py-2">
                  No orders
                </div>
              )}
            </div>
          </div>
          
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="outline" className="text-xs bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30">
                NO
              </Badge>
              <span className="text-xs text-muted-foreground">Team loses</span>
            </div>
            
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground flex justify-between px-1">
                <span>Price</span>
                <span>Qty</span>
              </div>
              
              {(orderBook?.noAsks || []).slice(0, 5).reverse().map((level, i) => (
                <div
                  key={`no-ask-${i}`}
                  className="relative flex justify-between text-xs px-1 py-0.5 rounded"
                >
                  <div
                    className="absolute inset-0 bg-red-500/10 rounded"
                    style={{ width: `${(level.quantity / maxQty) * 100}%`, right: 0, left: 'auto' }}
                  />
                  <span className="relative text-red-600 dark:text-red-400">
                    ${level.price.toFixed(2)}
                  </span>
                  <span className="relative">{level.quantity}</span>
                </div>
              ))}
              
              <div className="h-px bg-border my-1" />
              
              {(orderBook?.noBids || []).slice(0, 5).map((level, i) => (
                <div
                  key={`no-bid-${i}`}
                  className="relative flex justify-between text-xs px-1 py-0.5 rounded"
                >
                  <div
                    className="absolute inset-0 bg-green-500/10 rounded"
                    style={{ width: `${(level.quantity / maxQty) * 100}%` }}
                  />
                  <span className="relative text-green-600 dark:text-green-400">
                    ${level.price.toFixed(2)}
                  </span>
                  <span className="relative">{level.quantity}</span>
                </div>
              ))}
              
              {(!orderBook?.noBids?.length && !orderBook?.noAsks?.length) && (
                <div className="text-xs text-muted-foreground text-center py-2">
                  No orders
                </div>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
