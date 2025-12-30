import { useState, useMemo, useEffect, useRef } from "react";
import { TrendingUp, TrendingDown, Wallet, PiggyBank, BarChart3, Loader2, Car, User, ExternalLink, Clock, CheckCircle, XCircle, RefreshCw, ShoppingCart, Trash2, Globe, DollarSign, LogOut } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWallet } from "@/context/WalletContext";
import { useMarket } from "@/context/MarketContext";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { usePolymarketPositions, type PolymarketPosition } from "@/hooks/usePolymarketPositions";
import { useTradingSession } from "@/hooks/useTradingSession";
import { usePlaceOrder } from "@/hooks/usePlaceOrder";
import { PolymarketBetModal } from "@/components/PolymarketBetModal";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

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

type TimePeriod = "1D" | "1W" | "1M" | "ALL";

interface PortfolioHistoryPoint {
  id: string;
  walletAddress: string;
  positionsValue: number;
  cashBalance: number;
  totalValue: number;
  totalPnl: number;
  recordedAt: string;
}

function PortfolioChart({ 
  portfolioValue, 
  totalPnl, 
  cashBalance, 
  safeAddress 
}: { 
  portfolioValue: number; 
  totalPnl: number; 
  cashBalance: number; 
  safeAddress: string | undefined;
}) {
  const [period, setPeriod] = useState<TimePeriod>("1W");
  
  const isPositive = totalPnl >= 0;
  const costBasis = portfolioValue - totalPnl;
  const pnlPercent = costBasis > 0 ? (totalPnl / costBasis) * 100 : 0;
  const totalValue = portfolioValue + cashBalance;

  const normalizedAddress = safeAddress?.toLowerCase() ?? "";
  
  const { data: historyData = [] } = useQuery<PortfolioHistoryPoint[]>({
    queryKey: ["/api/portfolio/history", normalizedAddress, period],
    enabled: !!safeAddress && normalizedAddress.length > 0,
    refetchInterval: 60000,
  });

  const chartData = useMemo(() => {
    if (historyData.length === 0) return [];
    return historyData.map((point) => ({
      time: format(new Date(point.recordedAt), period === "1D" ? "h:mm a" : "MMM d"),
      value: point.totalValue,
    }));
  }, [historyData, period]);

  const hasHistory = chartData.length >= 2;
  
  const periodChange = useMemo(() => {
    if (!hasHistory) return { change: 0, percent: 0 };
    const first = chartData[0].value;
    const last = chartData[chartData.length - 1].value;
    const change = last - first;
    const percent = first > 0 ? (change / first) * 100 : 0;
    return { change, percent };
  }, [chartData, hasHistory]);

  const minValue = hasHistory ? Math.min(...chartData.map(d => d.value)) : 0;
  const maxValue = hasHistory ? Math.max(...chartData.map(d => d.value)) : 100;
  const periodIsPositive = periodChange.change >= 0;

  return (
    <Card className="mb-6">
      <CardContent className="pt-6">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-4">
          <div>
            <div className="text-sm font-medium text-muted-foreground mb-1">
              Total Value
            </div>
            <div className="text-4xl font-bold tabular-nums" data-testid="text-total-value">
              ${totalValue.toFixed(2)}
            </div>
            {hasHistory ? (
              <div className={`flex items-center gap-1 text-sm mt-1 ${periodIsPositive ? "text-green-600" : "text-red-600"}`}>
                {periodIsPositive ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                <span>
                  {periodIsPositive ? "+" : ""}${periodChange.change.toFixed(2)} ({periodIsPositive ? "+" : ""}{periodChange.percent.toFixed(1)}%)
                </span>
              </div>
            ) : totalPnl !== 0 && (
              <div className={`flex items-center gap-1 text-sm mt-1 ${isPositive ? "text-green-600" : "text-red-600"}`}>
                {isPositive ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                <span>
                  {isPositive ? "+" : ""}${totalPnl.toFixed(2)} all time
                </span>
              </div>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex gap-1">
              {(["1D", "1W", "1M", "ALL"] as TimePeriod[]).map((p) => (
                <Button
                  key={p}
                  size="sm"
                  variant={period === p ? "default" : "ghost"}
                  onClick={() => setPeriod(p)}
                  data-testid={`button-period-${p.toLowerCase()}`}
                >
                  {p}
                </Button>
              ))}
            </div>
            <div className="flex gap-6 text-sm">
              <div className="text-right">
                <div className="text-muted-foreground">Positions</div>
                <div className="font-semibold tabular-nums">${portfolioValue.toFixed(2)}</div>
              </div>
              <div className="text-right">
                <div className="text-muted-foreground">Cash</div>
                <div className="font-semibold tabular-nums">${cashBalance.toFixed(2)}</div>
              </div>
            </div>
          </div>
        </div>
        
        {hasHistory ? (
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={periodIsPositive ? "#22c55e" : "#ef4444"} stopOpacity={0.3}/>
                    <stop offset="95%" stopColor={periodIsPositive ? "#22c55e" : "#ef4444"} stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis 
                  dataKey="time" 
                  axisLine={false} 
                  tickLine={false}
                  tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                  interval="preserveStartEnd"
                />
                <YAxis 
                  domain={[minValue * 0.95, maxValue * 1.05]}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                  tickFormatter={(v) => `$${v.toFixed(0)}`}
                  width={50}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: "hsl(var(--card))", 
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "6px",
                  }}
                  formatter={(value: number) => [`$${value.toFixed(2)}`, "Value"]}
                />
                <Area 
                  type="monotone" 
                  dataKey="value" 
                  stroke={periodIsPositive ? "#22c55e" : "#ef4444"} 
                  strokeWidth={2}
                  fill="url(#colorValue)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-32 flex items-center justify-center bg-muted/30 rounded-md">
            <p className="text-sm text-muted-foreground">
              Portfolio history will appear here as you use the app
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function PortfolioSection() {
  const { walletAddress, connectWallet, isConnecting } = useWallet();
  const { userId } = useMarket();
  const { toast } = useToast();
  const [selectedPosition, setSelectedPosition] = useState<PolymarketPosition | null>(null);
  const [sellModalOpen, setSellModalOpen] = useState(false);
  
  const { tradingSession, isTradingSessionComplete, clobClient } = useTradingSession();
  const { cancelOrder } = usePlaceOrder(clobClient, undefined);
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null);
  const { data: positionsData, isLoading: isLoadingPositions, refetch: refetchPositions, error: positionsError, isError: isPositionsError } = usePolymarketPositions();

  const safeAddress = tradingSession?.safeAddress;
  
  // Query the EOA wallet balance (user's connected wallet) for display
  const { data: cashBalance, isLoading: isLoadingBalance } = useQuery<number>({
    queryKey: ["polygon-usdc-balance", walletAddress],
    queryFn: async () => {
      if (!walletAddress) return 0;
      const { ethers } = await import("ethers");
      const provider = new ethers.JsonRpcProvider("https://polygon-rpc.com");
      const USDC_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
      const contract = new ethers.Contract(USDC_ADDRESS, ["function balanceOf(address) view returns (uint256)"], provider);
      const balance = await contract.balanceOf(walletAddress);
      return parseFloat(ethers.formatUnits(balance, 6));
    },
    enabled: !!walletAddress,
    refetchInterval: 30000,
  });

  const portfolioValue = positionsData?.totalValue || 0;
  const totalPnl = positionsData?.totalPnl || 0;

  const lastSnapshotRef = useRef<string>("");
  
  useEffect(() => {
    if (!safeAddress || isLoadingPositions || isLoadingBalance) return;
    if (cashBalance === undefined) return;
    
    const totalValue = portfolioValue + (cashBalance || 0);
    const snapshotKey = `${safeAddress}-${totalValue.toFixed(2)}`;
    
    if (snapshotKey === lastSnapshotRef.current) return;
    
    const now = Date.now();
    const lastSaveTime = parseInt(localStorage.getItem(`portfolio-snapshot-time-${safeAddress}`) || "0");
    if (now - lastSaveTime < 5 * 60 * 1000) return;
    
    lastSnapshotRef.current = snapshotKey;
    localStorage.setItem(`portfolio-snapshot-time-${safeAddress}`, now.toString());
    
    const normalizedAddress = safeAddress.toLowerCase();
    apiRequest("POST", "/api/portfolio/snapshot", {
      walletAddress: safeAddress,
      positionsValue: portfolioValue,
      cashBalance: cashBalance || 0,
      totalValue,
      totalPnl,
    }).then(() => {
      queryClient.invalidateQueries({ 
        predicate: (query) => {
          const key = query.queryKey;
          return Array.isArray(key) && key[0] === "/api/portfolio/history" && key[1] === normalizedAddress;
        }
      });
    }).catch(console.error);
  }, [safeAddress, portfolioValue, cashBalance, totalPnl, isLoadingPositions, isLoadingBalance]);

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

  const handleCancelOrder = async (order: PolymarketOrder) => {
    if (!order.polymarketOrderId) {
      toast({
        title: "Cannot cancel",
        description: "This order is not on Polymarket",
        variant: "destructive",
      });
      return;
    }

    if (!clobClient) {
      toast({
        title: "Trading session required",
        description: "Please initialize your trading session to cancel orders",
        variant: "destructive",
      });
      return;
    }

    setCancellingOrderId(order.id);
    try {
      const result = await cancelOrder(order.polymarketOrderId);
      if (result.success) {
        // Update local order status
        await apiRequest("PATCH", `/api/polymarket/orders/${order.id}/status`, { 
          status: "cancelled" 
        });
        queryClient.invalidateQueries({ queryKey: ["/api/polymarket/orders", userId] });
        toast({
          title: "Order cancelled",
          description: `Your ${order.marketName} order has been cancelled`,
        });
      } else {
        toast({
          title: "Failed to cancel order",
          description: result.error || "Could not cancel the order on Polymarket",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({
        title: "Failed to cancel order",
        description: error.message || "An error occurred while cancelling",
        variant: "destructive",
      });
    } finally {
      setCancellingOrderId(null);
    }
  };

  const hasWallet = !!walletAddress;
  
  const openOrders = orders.filter(o => ["pending", "open", "partial"].includes(o.status));
  const filledOrders = orders.filter(o => o.status === "filled");
  const cancelledOrders = orders.filter(o => ["cancelled", "expired"].includes(o.status));

  return (
    <section className="py-12">
      <div className="mx-auto max-w-7xl px-4">
        <h2 className="text-2xl font-bold mb-6" data-testid="text-portfolio-title">Portfolio</h2>

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
            <PortfolioChart 
              portfolioValue={portfolioValue} 
              totalPnl={totalPnl} 
              cashBalance={cashBalance || 0} 
              safeAddress={safeAddress}
            />

            <Tabs defaultValue="positions" className="w-full">
              <TabsList className="mb-4">
                <TabsTrigger value="positions" data-testid="tab-positions">
                  Positions
                  {positionsData?.positions && positionsData.positions.length > 0 && (
                    <Badge variant="secondary" className="ml-2">
                      {positionsData.positions.length}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="orders" data-testid="tab-orders">
                  Orders
                  {openOrders.length > 0 && (
                    <Badge variant="secondary" className="ml-2">
                      {openOrders.length}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="history" data-testid="tab-history">
                  History
                </TabsTrigger>
              </TabsList>

              <TabsContent value="positions">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between gap-4">
                    <CardTitle className="flex items-center gap-2">
                      <BarChart3 className="h-5 w-5" />
                      Your Positions
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      {positionsData?.totalValue !== undefined && positionsData.totalValue > 0 && (
                        <div className="text-right">
                          <div className="text-sm text-muted-foreground">Total Value</div>
                          <div className="text-lg font-bold">${positionsData.totalValue.toFixed(2)}</div>
                        </div>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => refetchPositions()}
                        disabled={isLoadingPositions}
                        data-testid="button-refresh-positions"
                      >
                        <RefreshCw className={`h-4 w-4 ${isLoadingPositions ? "animate-spin" : ""}`} />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {isLoadingPositions ? (
                      <div className="flex justify-center py-8">
                        <Loader2 className="h-8 w-8 animate-spin" />
                      </div>
                    ) : isPositionsError ? (
                      <div className="rounded-md bg-red-500/10 p-6 text-center">
                        <p className="text-red-600 dark:text-red-400 mb-2">Failed to load positions</p>
                        <p className="text-muted-foreground text-sm mb-4">
                          {positionsError instanceof Error ? positionsError.message : "Unknown error"}
                        </p>
                        <Button size="sm" variant="outline" onClick={() => refetchPositions()}>
                          <RefreshCw className="h-4 w-4 mr-1" />
                          Retry
                        </Button>
                      </div>
                    ) : !isTradingSessionComplete ? (
                      <div className="rounded-md bg-muted/50 p-6 text-center">
                        <p className="text-muted-foreground mb-4">
                          Initialize your trading session to view positions.
                        </p>
                      </div>
                    ) : positionsData?.positions && positionsData.positions.length > 0 ? (
                      <div className="space-y-3">
                        {positionsData.positions.map((position, index) => (
                          <div
                            key={`${position.tokenId}-${index}`}
                            className="flex items-center gap-4 p-4 rounded-md bg-muted/30 hover-elevate"
                            data-testid={`position-row-${position.tokenId}`}
                          >
                            {position.icon && (
                              <img
                                src={position.icon}
                                alt=""
                                className="w-12 h-12 rounded-md object-cover flex-shrink-0"
                              />
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-sm line-clamp-2">
                                {position.title || "Unknown Market"}
                              </div>
                              <div className="flex items-center gap-2 mt-1">
                                <Badge variant={position.outcome === "Yes" ? "default" : "secondary"}>
                                  {position.outcome}
                                </Badge>
                                <span className="text-sm text-muted-foreground">
                                  {position.size.toFixed(2)} shares
                                </span>
                              </div>
                              <div className="text-xs text-muted-foreground mt-1">
                                Avg: {(position.averagePrice * 100).toFixed(1)}c | Current: {(position.currentPrice * 100).toFixed(1)}c
                              </div>
                            </div>
                            <div className="flex items-center gap-4">
                              <div className="text-right">
                                <div className="font-medium">${position.value.toFixed(2)}</div>
                                <div className={`text-sm flex items-center gap-1 ${position.pnl >= 0 ? "text-green-600" : "text-red-600"}`}>
                                  {position.pnl >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                                  ${Math.abs(position.pnl).toFixed(2)} ({position.pnlPercent >= 0 ? "+" : ""}{position.pnlPercent.toFixed(1)}%)
                                </div>
                              </div>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setSelectedPosition(position);
                                  setSellModalOpen(true);
                                }}
                                data-testid={`button-sell-position-${position.tokenId}`}
                              >
                                <LogOut className="h-4 w-4 mr-1" />
                                Sell
                              </Button>
                            </div>
                          </div>
                        ))}
                        {positionsData.totalPnl !== undefined && (
                          <div className="flex justify-between items-center pt-3 border-t mt-4">
                            <span className="text-sm text-muted-foreground">Total P&L</span>
                            <span className={`font-bold ${positionsData.totalPnl >= 0 ? "text-green-600" : "text-red-600"}`}>
                              {positionsData.totalPnl >= 0 ? "+" : ""}${positionsData.totalPnl.toFixed(2)}
                            </span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="rounded-md bg-muted/50 p-6 text-center">
                        <p className="text-muted-foreground mb-4">
                          No positions found. Place bets in the Markets page to see them here.
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
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="orders">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between gap-4">
                    <CardTitle className="flex items-center gap-2">
                      <ShoppingCart className="h-5 w-5" />
                      Open Orders
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
                    ) : openOrders.length === 0 ? (
                      <div className="rounded-md bg-muted/50 p-6 text-center">
                        <p className="text-muted-foreground">
                          No open orders. Your pending and active orders will appear here.
                        </p>
                      </div>
                    ) : (
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
                              {order.polymarketOrderId ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleCancelOrder(order)}
                                  disabled={cancellingOrderId === order.id || !clobClient}
                                  data-testid={`button-cancel-order-${order.id}`}
                                  className="text-destructive border-destructive/50"
                                >
                                  {cancellingOrderId === order.id ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <>
                                      <XCircle className="h-4 w-4 mr-1" />
                                      Cancel
                                    </>
                                  )}
                                </Button>
                              ) : (
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
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="history">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between gap-4">
                    <CardTitle className="flex items-center gap-2">
                      <Clock className="h-5 w-5" />
                      Order History
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {isLoadingOrders ? (
                      <div className="flex justify-center py-8">
                        <Loader2 className="h-8 w-8 animate-spin" />
                      </div>
                    ) : (filledOrders.length === 0 && cancelledOrders.length === 0) ? (
                      <div className="rounded-md bg-muted/50 p-6 text-center">
                        <p className="text-muted-foreground">
                          No order history yet. Completed and cancelled orders will appear here.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {filledOrders.length > 0 && (
                          <div>
                            <h4 className="font-medium text-sm text-muted-foreground mb-2">Filled Orders ({filledOrders.length})</h4>
                            <div className="space-y-2">
                              {filledOrders.map((order) => (
                                <div key={order.id} className="flex items-center justify-between p-3 rounded-md bg-muted/30" data-testid={`order-row-${order.id}`}>
                                  <div className="flex-1">
                                    <div className="font-medium">{order.marketName || "Unknown Market"}</div>
                                    <div className="text-sm text-muted-foreground">
                                      {order.side} {order.outcome} @ {(order.price * 100).toFixed(1)}c | {order.size.toFixed(2)} shares
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      {format(new Date(order.createdAt), "MMM d, yyyy h:mm a")}
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
                              {cancelledOrders.map((order) => (
                                <div key={order.id} className="flex items-center justify-between p-3 rounded-md bg-muted/30 opacity-60" data-testid={`order-row-${order.id}`}>
                                  <div className="flex-1">
                                    <div className="font-medium">{order.marketName || "Unknown Market"}</div>
                                    <div className="text-sm text-muted-foreground">
                                      {order.side} {order.outcome} @ {(order.price * 100).toFixed(1)}c
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      {format(new Date(order.createdAt), "MMM d, yyyy h:mm a")}
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
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>

      {selectedPosition && (
        <PolymarketBetModal
          open={sellModalOpen}
          onClose={() => {
            setSellModalOpen(false);
            setSelectedPosition(null);
          }}
          outcome={{
            id: selectedPosition.tokenId,
            name: selectedPosition.outcome,
            tokenId: selectedPosition.tokenId,
            price: selectedPosition.currentPrice,
            volume: "0",
            conditionId: selectedPosition.conditionId || "",
            questionId: "",
          }}
          userBalance={cashBalance ?? 0}
          mode="sell"
          position={selectedPosition}
        />
      )}
    </section>
  );
}
