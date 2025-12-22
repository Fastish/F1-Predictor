import { useState, useRef } from "react";
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
import { Trophy, Play, CheckCircle, AlertCircle, DollarSign, Lock, Bot, Power, PowerOff, Users, FileCode, Upload, Shield, XCircle, ArrowRight, RefreshCw, Link2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Payout, ZkProof, ChampionshipPool } from "@shared/schema";

interface DriverMarketsStatus {
  exists: boolean;
  count: number;
}

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

interface ProofPreview {
  valid: boolean;
  serverDomain: string;
  notaryPublicKey: string;
  extractedWinner: {
    id: string | null;
    name: string | null;
    isTeamResult: boolean;
  };
  transcriptPreview: string;
  cryptoVerification: string;
  error?: string;
}

interface PolymarketF1Market {
  id: string;
  question: string;
  conditionId: string;
  slug: string;
  endDate: string;
  outcomes: string[];
  outcomePrices: string[];
  volume: string;
  liquidity: string;
  active: boolean;
}

export function AdminPanel() {
  const { teams } = useMarket();
  const { walletAddress } = useWallet();
  const { toast } = useToast();
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");
  const [proofJson, setProofJson] = useState<string>("");
  const [proofPreview, setProofPreview] = useState<ProofPreview | null>(null);
  const [selectedPoolId, setSelectedPoolId] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const { data: driverMarketsStatus } = useQuery<DriverMarketsStatus>({
    queryKey: ["/api/clob/driver-markets"],
    queryFn: async () => {
      const res = await fetch("/api/clob/driver-markets");
      if (!res.ok) return { exists: false, count: 0 };
      const markets = await res.json();
      return { exists: markets.length > 0, count: markets.length };
    },
    enabled: !!season?.exists && season.status === "active",
  });

  const { data: pools = [] } = useQuery<ChampionshipPool[]>({
    queryKey: ["/api/pools"],
  });

  const { data: polymarketF1Markets = [], refetch: refetchPolymarketMarkets, isLoading: polymarketLoading } = useQuery<PolymarketF1Market[]>({
    queryKey: ["/api/polymarket/f1-markets"],
    queryFn: async () => {
      const res = await fetch("/api/polymarket/f1-markets");
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: zkProofs = [], refetch: refetchProofs } = useQuery<ZkProof[]>({
    queryKey: ["/api/proofs/pool", selectedPoolId],
    queryFn: async () => {
      if (!selectedPoolId) return [];
      return adminApiRequest(`/api/proofs/pool/${selectedPoolId}`, "GET");
    },
    enabled: !!selectedPoolId,
  });

  const previewProofMutation = useMutation({
    mutationFn: async (json: string) => {
      return adminApiRequest("/api/proofs/preview", "POST", { proofJson: json });
    },
    onSuccess: (data: ProofPreview) => {
      setProofPreview(data);
    },
    onError: (error: any) => {
      setProofPreview({ 
        valid: false, 
        serverDomain: "", 
        notaryPublicKey: "", 
        extractedWinner: { id: null, name: null, isTeamResult: false },
        transcriptPreview: "",
        cryptoVerification: "failed",
        error: error.message 
      });
    },
  });

  const submitProofMutation = useMutation({
    mutationFn: async ({ poolId, json }: { poolId: string; json: string }) => {
      return adminApiRequest("/api/proofs/submit", "POST", { 
        poolId, 
        userId: "admin", 
        proofJson: json 
      });
    },
    onSuccess: () => {
      toast({ title: "Proof Submitted", description: "zkTLS proof has been submitted for verification." });
      setProofJson("");
      setProofPreview(null);
      refetchProofs();
    },
    onError: (error: any) => {
      toast({ title: "Submission Failed", description: error.message, variant: "destructive" });
    },
  });

  const verifyProofMutation = useMutation({
    mutationFn: async (proofId: string) => {
      return adminApiRequest(`/api/proofs/${proofId}/verify`, "POST", {});
    },
    onSuccess: (data: any) => {
      if (data.success) {
        toast({ title: "Proof Verified", description: `Winner extracted: ${data.extractedWinner?.name || data.extractedWinner?.id}` });
      } else {
        toast({ title: "Verification Failed", description: data.reason, variant: "destructive" });
      }
      refetchProofs();
    },
    onError: (error: any) => {
      toast({ title: "Verification Error", description: error.message, variant: "destructive" });
    },
  });

  const resolvePoolMutation = useMutation({
    mutationFn: async (proofId: string) => {
      return adminApiRequest(`/api/proofs/${proofId}/resolve-pool`, "POST", {});
    },
    onSuccess: (data: any) => {
      toast({ title: "Pool Resolved", description: data.message });
      queryClient.invalidateQueries({ queryKey: ["/api/pools"] });
      refetchProofs();
    },
    onError: (error: any) => {
      toast({ title: "Resolution Failed", description: error.message, variant: "destructive" });
    },
  });

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        setProofJson(content);
        previewProofMutation.mutate(content);
      };
      reader.readAsText(file);
    }
  };

  const createDriverMarketsMutation = useMutation({
    mutationFn: async () => {
      return adminApiRequest("/api/admin/driver-markets/create", "POST", {});
    },
    onSuccess: (data: any) => {
      toast({ 
        title: "Driver Markets Created", 
        description: `Created ${data.markets?.length || 0} driver markets for ${data.season?.year || 2026} season.` 
      });
      queryClient.invalidateQueries({ queryKey: ["/api/clob/driver-markets"] });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to create driver markets", variant: "destructive" });
    },
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
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Driver Championship Markets</p>
                    <p className="text-sm text-muted-foreground">
                      {driverMarketsStatus?.exists 
                        ? `${driverMarketsStatus.count} driver markets active`
                        : "Create markets for driver championship predictions"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {driverMarketsStatus?.exists ? (
                    <Badge variant="default">
                      <CheckCircle className="h-3 w-3 mr-1" /> Active
                    </Badge>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => createDriverMarketsMutation.mutate()}
                      disabled={createDriverMarketsMutation.isPending}
                      data-testid="button-create-driver-markets"
                    >
                      <Play className="h-4 w-4 mr-2" />
                      {createDriverMarketsMutation.isPending ? "Creating..." : "Create Driver Markets"}
                    </Button>
                  )}
                </div>
              </div>
            </div>
            
            <div className="border rounded-md p-4 space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <Link2 className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Polymarket F1 Markets</p>
                    <p className="text-sm text-muted-foreground">
                      {polymarketLoading ? "Loading..." : 
                        polymarketF1Markets.length > 0 
                          ? `${polymarketF1Markets.length} F1 markets available on Polymarket`
                          : "No F1 markets found on Polymarket"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant={polymarketF1Markets.length > 0 ? "default" : "secondary"}>
                    {polymarketF1Markets.length > 0 ? (
                      <><CheckCircle className="h-3 w-3 mr-1" /> Connected</>
                    ) : (
                      "No Markets"
                    )}
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => refetchPolymarketMarkets()}
                    disabled={polymarketLoading}
                    data-testid="button-refresh-polymarket"
                  >
                    <RefreshCw className={`h-4 w-4 ${polymarketLoading ? 'animate-spin' : ''}`} />
                  </Button>
                </div>
              </div>
              {polymarketF1Markets.length > 0 && (
                <div className="mt-3 space-y-2 max-h-48 overflow-y-auto">
                  {polymarketF1Markets.slice(0, 5).map((market) => (
                    <div
                      key={market.id}
                      className="flex items-center justify-between gap-2 text-sm p-2 rounded bg-muted/50"
                      data-testid={`polymarket-row-${market.id}`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="truncate font-medium">{market.question}</p>
                        <p className="text-xs text-muted-foreground">
                          Volume: ${parseFloat(market.volume || "0").toLocaleString()}
                        </p>
                      </div>
                      <Badge variant={market.active ? "default" : "secondary"} className="shrink-0">
                        {market.active ? "Active" : "Closed"}
                      </Badge>
                    </div>
                  ))}
                  {polymarketF1Markets.length > 5 && (
                    <p className="text-xs text-muted-foreground text-center">
                      +{polymarketF1Markets.length - 5} more markets
                    </p>
                  )}
                </div>
              )}
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

        {/* zkTLS Proof Verification Section */}
        <div className="border rounded-md p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="font-medium">zkTLS Proof Verification</p>
              <p className="text-sm text-muted-foreground">
                Submit TLSNotary proofs from formula1.com to verify championship results
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex gap-2 flex-wrap">
              <Select value={selectedPoolId} onValueChange={setSelectedPoolId}>
                <SelectTrigger className="w-[250px]" data-testid="select-pool">
                  <SelectValue placeholder="Select prediction pool" />
                </SelectTrigger>
                <SelectContent>
                  {pools.map((pool) => (
                    <SelectItem key={pool.id} value={pool.id}>
                      {pool.type} Championship ({pool.status})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedPoolId && (
              <>
                <div className="space-y-2">
                  <Label>Upload TLSNotary Proof</Label>
                  <div className="flex gap-2 flex-wrap">
                    <input
                      type="file"
                      ref={fileInputRef}
                      accept=".json"
                      onChange={handleFileUpload}
                      className="hidden"
                      data-testid="input-proof-file"
                    />
                    <Button
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      data-testid="button-upload-proof"
                    >
                      <Upload className="h-4 w-4 mr-2" />
                      Choose File
                    </Button>
                    {proofJson && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setProofJson("");
                          setProofPreview(null);
                          if (fileInputRef.current) fileInputRef.current.value = "";
                        }}
                        data-testid="button-clear-proof"
                      >
                        <XCircle className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>

                {proofPreview && (
                  <div className={`border rounded-md p-3 space-y-2 ${proofPreview.valid ? "border-green-500/50 bg-green-500/5" : "border-red-500/50 bg-red-500/5"}`}>
                    <div className="flex items-center gap-2">
                      {proofPreview.valid ? (
                        <CheckCircle className="h-4 w-4 text-green-500" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-500" />
                      )}
                      <span className="font-medium">
                        {proofPreview.valid ? "Valid Proof Structure" : "Invalid Proof"}
                      </span>
                    </div>
                    {proofPreview.error ? (
                      <p className="text-sm text-red-600">{proofPreview.error}</p>
                    ) : (
                      <div className="text-sm space-y-1">
                        <p><span className="text-muted-foreground">Server:</span> {proofPreview.serverDomain}</p>
                        <p><span className="text-muted-foreground">Notary Key:</span> {proofPreview.notaryPublicKey}</p>
                        {proofPreview.extractedWinner.name && (
                          <p>
                            <span className="text-muted-foreground">Extracted Winner:</span>{" "}
                            <Badge variant="secondary" className="ml-1">
                              {proofPreview.extractedWinner.name} ({proofPreview.extractedWinner.isTeamResult ? "Team" : "Driver"})
                            </Badge>
                          </p>
                        )}
                        <p><span className="text-muted-foreground">Crypto Check:</span> {proofPreview.cryptoVerification}</p>
                      </div>
                    )}
                  </div>
                )}

                {proofJson && proofPreview?.valid && (
                  <Button
                    onClick={() => submitProofMutation.mutate({ poolId: selectedPoolId, json: proofJson })}
                    disabled={submitProofMutation.isPending}
                    data-testid="button-submit-proof"
                  >
                    <FileCode className="h-4 w-4 mr-2" />
                    {submitProofMutation.isPending ? "Submitting..." : "Submit Proof"}
                  </Button>
                )}

                {zkProofs.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Submitted Proofs</p>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {zkProofs.map((proof) => (
                        <div
                          key={proof.id}
                          className="flex items-center justify-between gap-2 text-sm p-2 rounded bg-muted/50"
                          data-testid={`proof-row-${proof.id}`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <Badge
                              variant={
                                proof.verificationStatus === "verified" ? "default" :
                                proof.verificationStatus === "rejected" ? "destructive" : "secondary"
                              }
                            >
                              {proof.verificationStatus}
                            </Badge>
                            <span className="truncate">{proof.extractedWinnerName || proof.extractedWinnerId || "Unknown"}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            {proof.verificationStatus === "pending" && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => verifyProofMutation.mutate(proof.id)}
                                disabled={verifyProofMutation.isPending}
                                data-testid={`button-verify-proof-${proof.id}`}
                              >
                                <Shield className="h-3 w-3 mr-1" />
                                Verify
                              </Button>
                            )}
                            {proof.verificationStatus === "verified" && (
                              <Button
                                size="sm"
                                onClick={() => resolvePoolMutation.mutate(proof.id)}
                                disabled={resolvePoolMutation.isPending}
                                data-testid={`button-resolve-pool-${proof.id}`}
                              >
                                <ArrowRight className="h-3 w-3 mr-1" />
                                Resolve Pool
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
