import { TrendingUp, TrendingDown, Wallet, PiggyBank, BarChart3, Loader2, Car, User, ExternalLink, Clock, CheckCircle, XCircle, RefreshCw, ShoppingCart, Trash2, Globe } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/context/WalletContext";
import { useMarket } from "@/context/MarketContext";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

interface PolymarketOrder {
  id: string;
  polymarketOrderId: string | null;
  userId: string;
  tokenId: string;
  marketName: string | null;
  outcome: string;
  side: string;
  price: number;
  size: number;
  filledSize: number;
  status: string;
  totalCost: number;
  createdAt: string;
  updatedAt: string;
  lastSyncedAt: string | null;
}

interface PolymarketOutcome {
  id: string;
  name: string;
  tokenId: string;
  price: number;
  volume: string;
  conditionId: string;
  questionId: string;
}

// Team colors for F1 constructors
const teamColors: Record<string, string> = {
  "Mercedes": "#00D2BE",
  "McLaren": "#FF8700",
  "Red Bull Racing": "#1E41FF",
  "Ferrari": "#DC0000",
  "Aston Martin": "#006F62",
  "Williams": "#005AFF",
  "Audi": "#FF0000",
  "Alpine": "#0090FF",
  "Cadillac": "#C4A747",
  "Haas": "#B6BABD",
  "Racing Bulls": "#2B4562",
};

// Driver team associations
const driverInfo: Record<string, { team: string; color: string }> = {
  "Max Verstappen": { team: "Red Bull", color: "#1E41FF" },
  "Lando Norris": { team: "McLaren", color: "#FF8700" },
  "Lewis Hamilton": { team: "Ferrari", color: "#DC0000" },
  "George Russell": { team: "Mercedes", color: "#00D2BE" },
  "Charles Leclerc": { team: "Ferrari", color: "#DC0000" },
  "Oscar Piastri": { team: "McLaren", color: "#FF8700" },
  "Kimi Antonelli": { team: "Mercedes", color: "#00D2BE" },
  "Fernando Alonso": { team: "Aston Martin", color: "#006F62" },
  "Carlos Sainz": { team: "Williams", color: "#005AFF" },
  "Liam Lawson": { team: "Red Bull", color: "#1E41FF" },
};

function getColor(name: string, type: "team" | "driver"): string {
  if (type === "team") {
    return teamColors[name] || "#888888";
  }
  return driverInfo[name]?.color || "#888888";
}

function getStatusBadge(status: string) {
  switch (status) {
    case "pending":
      return (
        <Badge variant="secondary" className="gap-1">
          <Clock className="h-3 w-3" />
          Pending
        </Badge>
      );
    case "open":
      return (
        <Badge variant="outline" className="gap-1 text-blue-600 border-blue-300">
          <RefreshCw className="h-3 w-3" />
          Open
        </Badge>
      );
    case "filled":
      return (
        <Badge className="gap-1 bg-green-600 text-white">
          <CheckCircle className="h-3 w-3" />
          Filled
        </Badge>
      );
    case "partial":
      return (
        <Badge variant="outline" className="gap-1 text-yellow-600 border-yellow-300">
          <RefreshCw className="h-3 w-3" />
          Partial
        </Badge>
      );
    case "cancelled":
    case "expired":
      return (
        <Badge variant="destructive" className="gap-1">
          <XCircle className="h-3 w-3" />
          {status.charAt(0).toUpperCase() + status.slice(1)}
        </Badge>
      );
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

export function PortfolioSection() {
  const { walletAddress, connectWallet, isConnecting } = useWallet();
  const { userId } = useMarket();
  const { toast } = useToast();

  const { data: usdcBalance, isLoading: isLoadingBalance } = useQuery<string>({
    queryKey: ["polygon-usdc-balance", walletAddress],
    queryFn: async () => {
      if (!walletAddress) return "0";
      const { getUsdcBalance } = await import("@/lib/polygon");
      return getUsdcBalance(walletAddress);
    },
    enabled: !!walletAddress,
  });

  const { data: constructors = [] } = useQuery<PolymarketOutcome[]>({
    queryKey: ["/api/polymarket/constructors"],
  });

  const { data: drivers = [] } = useQuery<PolymarketOutcome[]>({
    queryKey: ["/api/polymarket/drivers"],
  });

  const { data: orders = [], isLoading: isLoadingOrders } = useQuery<PolymarketOrder[]>({
    queryKey: ["/api/polymarket/orders", userId],
    enabled: !!userId,
  });

  const syncOrdersMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/polymarket/orders/sync", { userId });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/polymarket/orders", userId] });
    },
  });

  const deleteOrderMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const response = await apiRequest("DELETE", `/api/polymarket/orders/${orderId}`, { userId });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/polymarket/orders", userId] });
      toast({
        title: "Order deleted",
        description: "The order has been removed from your history.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to delete order",
        description: error.message || "Could not delete the order. Please try again.",
        variant: "destructive",
      });
    },
  });

  const cashBalance = parseFloat(usdcBalance || "0");

  // For now, show available markets instead of positions
  // Real positions would require querying Polymarket CLOB API with wallet address
  const hasWallet = !!walletAddress;
  
  const openOrders = orders.filter(o => ["pending", "open", "partial"].includes(o.status));
  const filledOrders = orders.filter(o => o.status === "filled");
  const cancelledOrders = orders.filter(o => ["cancelled", "expired"].includes(o.status));

  return (
    <section className="py-12">
      <div className="mx-auto max-w-7xl px-4">
        <h2 className="mb-6 text-2xl font-bold" data-testid="text-portfolio-title">Your Portfolio</h2>

        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                USDC Balance
              </CardTitle>
              <Wallet className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {isLoadingBalance ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : walletAddress ? (
                <div className="text-2xl font-bold tabular-nums" data-testid="text-cash-balance">
                  ${cashBalance.toFixed(2)}
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Connect wallet to view balance</p>
                  <Button size="sm" onClick={() => connectWallet()} disabled={isConnecting}>
                    Connect Wallet
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Constructor Markets
              </CardTitle>
              <Car className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tabular-nums">
                {constructors.length}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Teams available to trade
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Driver Markets
              </CardTitle>
              <User className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tabular-nums">
                {drivers.length}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Drivers available to trade
              </p>
            </CardContent>
          </Card>
        </div>

        {!hasWallet ? (
          <Card>
            <CardContent className="py-12 text-center">
              <PiggyBank className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">Connect Your Wallet</h3>
              <p className="text-muted-foreground mb-4">
                Connect your wallet to view your Polymarket positions and start trading
              </p>
              <Button onClick={() => connectWallet()} disabled={isConnecting}>
                <Wallet className="mr-2 h-4 w-4" />
                Connect Wallet
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card className="mb-6">
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <CardTitle className="flex items-center gap-2">
                  <ShoppingCart className="h-5 w-5" />
                  Your Orders
                </CardTitle>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => syncOrdersMutation.mutate()}
                  disabled={syncOrdersMutation.isPending}
                  data-testid="button-sync-orders"
                >
                  <RefreshCw className={`h-4 w-4 mr-1 ${syncOrdersMutation.isPending ? "animate-spin" : ""}`} />
                  Sync
                </Button>
              </CardHeader>
              <CardContent>
                {isLoadingOrders ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin" />
                  </div>
                ) : orders.length === 0 ? (
                  <div className="rounded-md bg-muted/50 p-6 text-center">
                    <p className="text-muted-foreground">
                      No orders yet. Place bets in the Markets page to see them here.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {openOrders.length > 0 && (
                      <div>
                        <h4 className="font-medium text-sm text-muted-foreground mb-2">Open Orders ({openOrders.length})</h4>
                        <div className="space-y-2">
                          {openOrders.map((order) => (
                            <div key={order.id} className="flex items-center justify-between p-3 rounded-md bg-muted/30" data-testid={`order-row-${order.id}`}>
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">{order.marketName || "Unknown Market"}</span>
                                  {order.polymarketOrderId ? (
                                    <Badge variant="outline" className="gap-1 text-green-600 border-green-300 text-xs">
                                      <Globe className="h-3 w-3" />
                                      Live
                                    </Badge>
                                  ) : (
                                    <Badge variant="outline" className="gap-1 text-orange-600 border-orange-300 text-xs">
                                      Local Only
                                    </Badge>
                                  )}
                                </div>
                                <div className="text-sm text-muted-foreground">
                                  {order.side} {order.outcome} @ {(order.price * 100).toFixed(1)}c | {order.size.toFixed(2)} shares
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {format(new Date(order.createdAt), "MMM d, yyyy h:mm a")}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="flex flex-col items-end gap-1">
                                  {getStatusBadge(order.status)}
                                  <span className="text-sm font-medium">${order.totalCost.toFixed(2)}</span>
                                </div>
                                {!order.polymarketOrderId && (
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => deleteOrderMutation.mutate(order.id)}
                                    disabled={deleteOrderMutation.isPending}
                                    data-testid={`button-delete-order-${order.id}`}
                                  >
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                  </Button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {filledOrders.length > 0 && (
                      <div>
                        <h4 className="font-medium text-sm text-muted-foreground mb-2">Filled Orders ({filledOrders.length})</h4>
                        <div className="space-y-2">
                          {filledOrders.slice(0, 5).map((order) => (
                            <div key={order.id} className="flex items-center justify-between p-3 rounded-md bg-muted/30" data-testid={`order-row-${order.id}`}>
                              <div className="flex-1">
                                <div className="font-medium">{order.marketName || "Unknown Market"}</div>
                                <div className="text-sm text-muted-foreground">
                                  {order.side} {order.outcome} @ {(order.price * 100).toFixed(1)}c | {order.size.toFixed(2)} shares
                                </div>
                              </div>
                              <div className="flex flex-col items-end gap-1">
                                {getStatusBadge(order.status)}
                                <span className="text-sm font-medium">${order.totalCost.toFixed(2)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {cancelledOrders.length > 0 && (
                      <div>
                        <h4 className="font-medium text-sm text-muted-foreground mb-2">Cancelled/Expired ({cancelledOrders.length})</h4>
                        <div className="space-y-2">
                          {cancelledOrders.slice(0, 3).map((order) => (
                            <div key={order.id} className="flex items-center justify-between p-3 rounded-md bg-muted/30 opacity-60" data-testid={`order-row-${order.id}`}>
                              <div className="flex-1">
                                <div className="font-medium">{order.marketName || "Unknown Market"}</div>
                                <div className="text-sm text-muted-foreground">
                                  {order.side} {order.outcome} @ {(order.price * 100).toFixed(1)}c
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="flex flex-col items-end gap-1">
                                  {getStatusBadge(order.status)}
                                </div>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => deleteOrderMutation.mutate(order.id)}
                                  disabled={deleteOrderMutation.isPending}
                                  data-testid={`button-delete-order-${order.id}`}
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Your Positions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="rounded-md bg-muted/50 p-6 text-center">
                  <p className="text-muted-foreground mb-4">
                    Your Polymarket positions will appear here after placing bets.
                    Positions are tracked on the Polygon blockchain.
                  </p>
                  <a
                    href="https://polymarket.com/portfolio"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    <ExternalLink className="h-4 w-4" />
                    View on Polymarket
                  </a>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-6 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Car className="h-5 w-5" />
                    Top Constructor Odds
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {constructors.slice(0, 5).map((team) => (
                      <div key={team.id} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div
                            className="h-3 w-3 rounded-full"
                            style={{ backgroundColor: getColor(team.name, "team") }}
                          />
                          <span className="font-medium">{team.name}</span>
                        </div>
                        <Badge variant="outline">
                          {(team.price * 100).toFixed(0)}%
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <User className="h-5 w-5" />
                    Top Driver Odds
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {drivers.slice(0, 5).map((driver) => (
                      <div key={driver.id} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div
                            className="h-3 w-3 rounded-full"
                            style={{ backgroundColor: getColor(driver.name, "driver") }}
                          />
                          <span className="font-medium">{driver.name}</span>
                        </div>
                        <Badge variant="outline">
                          {(driver.price * 100).toFixed(0)}%
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
