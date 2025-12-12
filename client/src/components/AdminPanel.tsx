import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { useMarket } from "@/context/MarketContext";
import { useWallet } from "@/context/WalletContext";
import { Trophy, Play, CheckCircle, AlertCircle, DollarSign, Lock, Bot, Power, PowerOff } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import type { Payout } from "@shared/schema";

interface SeasonResponse {
  exists: boolean;
  status?: string;
  id?: string;
  year?: number;
  winningTeamId?: string | null;
  prizePool?: number;
  concludedAt?: string | null;
}

interface MarketMakerStatus {
  running: boolean;
  botUserId: string | null;
  intervalMs: number;
  lastRunAt: string | null;
}

export function AdminPanel() {
  const { teams } = useMarket();
  const { walletAddress } = useWallet();
  const { toast } = useToast();
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");

  const adminApiRequest = async (url: string, method: string, data?: unknown) => {
    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-wallet-address": walletAddress || "",
      },
      body: data ? JSON.stringify(data) : undefined,
      credentials: "include",
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || res.statusText);
    }
    return res.json();
  };

  const { data: season, isLoading: seasonLoading } = useQuery<SeasonResponse>({
    queryKey: ["/api/season"],
  });

  const { data: marketMakerStatus, refetch: refetchMarketMakerStatus } = useQuery<MarketMakerStatus>({
    queryKey: ["/api/admin/market-maker/status"],
    queryFn: async () => adminApiRequest("/api/admin/market-maker/status", "GET"),
    refetchInterval: 5000,
  });

  const startMarketMakerMutation = useMutation({
    mutationFn: async () => {
      return adminApiRequest("/api/admin/market-maker/start", "POST", { intervalMs: 30000 });
    },
    onSuccess: () => {
      toast({ title: "Market Maker Started", description: "Bot is now providing liquidity." });
      refetchMarketMakerStatus();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to start market maker", variant: "destructive" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/market-maker/status"] });
    },
  });

  const stopMarketMakerMutation = useMutation({
    mutationFn: async () => {
      return adminApiRequest("/api/admin/market-maker/stop", "POST", {});
    },
    onSuccess: () => {
      toast({ title: "Market Maker Stopped", description: "Bot has stopped providing liquidity." });
      refetchMarketMakerStatus();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to stop market maker", variant: "destructive" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/market-maker/status"] });
    },
  });

  const payoutsQueryKey = season?.id ? `/api/admin/season/${season.id}/payouts` : null;
  
  const { data: payouts = [] } = useQuery<Payout[]>({
    queryKey: [payoutsQueryKey],
    queryFn: async () => {
      if (!payoutsQueryKey) return [];
      return adminApiRequest(payoutsQueryKey, "GET");
    },
    enabled: !!payoutsQueryKey && season?.status === "concluded",
  });

  const createSeasonMutation = useMutation({
    mutationFn: async () => {
      return adminApiRequest("/api/admin/season/create", "POST", { year: 2026 });
    },
    onSuccess: () => {
      toast({ title: "Season Created", description: "2026 season has been created and is now active." });
      queryClient.invalidateQueries({ queryKey: ["/api/season"] });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to create season", variant: "destructive" });
    },
  });

  const concludeSeasonMutation = useMutation({
    mutationFn: async (winningTeamId: string) => {
      return adminApiRequest("/api/admin/season/conclude", "POST", { winningTeamId });
    },
    onSuccess: (data: any) => {
      toast({ 
        title: "Season Concluded", 
        description: `${data.winningTeam.name} wins! Prize pool: $${data.prizePool.toFixed(2)}` 
      });
      queryClient.invalidateQueries({ queryKey: ["/api/season"] });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to conclude season", variant: "destructive" });
    },
  });

  const calculatePayoutsMutation = useMutation({
    mutationFn: async () => {
      return adminApiRequest("/api/admin/season/calculate-payouts", "POST", {});
    },
    onSuccess: (data: any) => {
      toast({ 
        title: "Payouts Calculated", 
        description: `${data.payouts.length} payouts created. Total: $${data.prizePool.toFixed(2)}` 
      });
      if (payoutsQueryKey) {
        queryClient.invalidateQueries({ queryKey: [payoutsQueryKey] });
      }
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to calculate payouts", variant: "destructive" });
    },
  });

  const distributePayoutsMutation = useMutation({
    mutationFn: async () => {
      return adminApiRequest("/api/admin/season/distribute-payouts", "POST", {});
    },
    onSuccess: (data: any) => {
      toast({ title: "Payouts Distributed", description: data.message });
      if (payoutsQueryKey) {
        queryClient.invalidateQueries({ queryKey: [payoutsQueryKey] });
      }
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to distribute payouts", variant: "destructive" });
    },
  });

  const winningTeam = season?.winningTeamId ? teams.find((t) => t.id === season.winningTeamId) : null;
  const pendingPayouts = payouts.filter((p) => p.status === "pending");
  const completedPayouts = payouts.filter((p) => p.status === "sent");

  if (seasonLoading) {
    return (
      <Card className="mt-6">
        <CardContent className="p-6">
          <div className="animate-pulse text-muted-foreground">Loading season data...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mt-6">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <Trophy className="h-5 w-5" />
          Season Admin Panel
        </CardTitle>
        {season?.exists && (
          <Badge variant={season.status === "active" ? "default" : "secondary"}>
            {season.status === "active" ? "Active" : "Concluded"}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="border rounded-md p-4 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="font-medium">Market Maker Bot</p>
                <p className="text-sm text-muted-foreground">
                  Provides liquidity for trading
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant={marketMakerStatus?.running ? "default" : "secondary"}>
                {marketMakerStatus?.running ? (
                  <><Power className="h-3 w-3 mr-1" /> Running</>
                ) : (
                  <><PowerOff className="h-3 w-3 mr-1" /> Stopped</>
                )}
              </Badge>
              <Switch
                id="market-maker-toggle"
                checked={marketMakerStatus?.running ?? false}
                disabled={startMarketMakerMutation.isPending || stopMarketMakerMutation.isPending}
                onCheckedChange={(checked) => {
                  if (checked) {
                    startMarketMakerMutation.mutate();
                  } else {
                    stopMarketMakerMutation.mutate();
                  }
                }}
                data-testid="switch-market-maker"
              />
            </div>
          </div>
          {marketMakerStatus?.lastRunAt && (
            <p className="text-xs text-muted-foreground">
              Last run: {new Date(marketMakerStatus.lastRunAt).toLocaleString()}
            </p>
          )}
        </div>

        {!season?.exists && (
          <div className="space-y-4">
            <p className="text-muted-foreground">No active season. Create one to start trading.</p>
            <Button
              onClick={() => createSeasonMutation.mutate()}
              disabled={createSeasonMutation.isPending}
              data-testid="button-create-season"
            >
              <Play className="h-4 w-4 mr-2" />
              {createSeasonMutation.isPending ? "Creating..." : "Create 2026 Season"}
            </Button>
          </div>
        )}

        {season?.exists && season.status === "active" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span>Season {season.year} is active. Trading is open.</span>
            </div>
            
            <div className="border rounded-md p-4 space-y-3">
              <p className="font-medium">End Season & Declare Winner</p>
              <p className="text-sm text-muted-foreground">
                Select the championship-winning team to conclude the season and distribute winnings.
              </p>
              
              <div className="flex gap-2 flex-wrap">
                <Select value={selectedTeamId} onValueChange={setSelectedTeamId}>
                  <SelectTrigger className="w-[200px]" data-testid="select-winning-team">
                    <SelectValue placeholder="Select winning team" />
                  </SelectTrigger>
                  <SelectContent>
                    {teams.map((team) => (
                      <SelectItem key={team.id} value={team.id}>
                        {team.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                
                <Button
                  variant="destructive"
                  onClick={() => {
                    if (selectedTeamId) {
                      concludeSeasonMutation.mutate(selectedTeamId);
                    }
                  }}
                  disabled={!selectedTeamId || concludeSeasonMutation.isPending}
                  data-testid="button-conclude-season"
                >
                  <Lock className="h-4 w-4 mr-2" />
                  {concludeSeasonMutation.isPending ? "Concluding..." : "End Season"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {season?.exists && season.status === "concluded" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-amber-500" />
              <span className="text-muted-foreground">
                Season {season.year} concluded. Trading is locked.
              </span>
            </div>

            {winningTeam && (
              <div className="border rounded-md p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <Trophy className="h-5 w-5 text-yellow-500" />
                  <span className="font-medium">Champion: {winningTeam.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5 text-green-500" />
                  <span>Prize Pool: ${season.prizePool?.toFixed(2) || "0.00"}</span>
                </div>
              </div>
            )}

            <div className="border rounded-md p-4 space-y-3">
              <p className="font-medium">Payout Management</p>
              
              {payouts.length === 0 ? (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Calculate payouts to determine how much each winner receives.
                  </p>
                  <Button
                    onClick={() => calculatePayoutsMutation.mutate()}
                    disabled={calculatePayoutsMutation.isPending}
                    data-testid="button-calculate-payouts"
                  >
                    {calculatePayoutsMutation.isPending ? "Calculating..." : "Calculate Payouts"}
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex gap-4 text-sm">
                    <span>Total: {payouts.length}</span>
                    <span className="text-amber-600">Pending: {pendingPayouts.length}</span>
                    <span className="text-green-600">Sent: {completedPayouts.length}</span>
                  </div>
                  
                  {pendingPayouts.length > 0 && (
                    <Button
                      onClick={() => distributePayoutsMutation.mutate()}
                      disabled={distributePayoutsMutation.isPending}
                      data-testid="button-distribute-payouts"
                    >
                      <DollarSign className="h-4 w-4 mr-2" />
                      {distributePayoutsMutation.isPending ? "Sending..." : `Send ${pendingPayouts.length} Payouts`}
                    </Button>
                  )}

                  <div className="max-h-48 overflow-y-auto space-y-2">
                    {payouts.map((payout) => (
                      <div
                        key={payout.id}
                        className="flex items-center justify-between text-sm p-2 rounded bg-muted/50"
                        data-testid={`payout-row-${payout.id}`}
                      >
                        <span className="truncate max-w-[150px]">{payout.userId.slice(0, 8)}...</span>
                        <span>{payout.sharesHeld} shares ({(payout.sharePercentage * 100).toFixed(1)}%)</span>
                        <span className="font-medium">${payout.payoutAmount.toFixed(2)}</span>
                        <Badge variant={payout.status === "sent" ? "default" : payout.status === "failed" ? "destructive" : "secondary"}>
                          {payout.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
