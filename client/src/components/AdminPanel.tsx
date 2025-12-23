import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { useMarket } from "@/context/MarketContext";
import { useWallet } from "@/context/WalletContext";
import { Trophy, Play, CheckCircle, AlertCircle, DollarSign, Lock, RefreshCw, Link2, Plus, Flag, Trash2, Eye, EyeOff, MapPin, Calendar, Users, Settings, Save } from "lucide-react";
import type { Payout, RaceMarket, RaceMarketOutcome, Driver } from "@shared/schema";

interface EnrichedOutcome extends RaceMarketOutcome {
  driver: Driver | null;
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
  const [showAddRaceDialog, setShowAddRaceDialog] = useState(false);
  const [showOutcomesDialog, setShowOutcomesDialog] = useState(false);
  const [selectedRaceForOutcomes, setSelectedRaceForOutcomes] = useState<RaceMarket | null>(null);
  const [outcomeEdits, setOutcomeEdits] = useState<Record<string, { tokenId: string; price: string }>>({});
  const [newRace, setNewRace] = useState({
    name: "",
    shortName: "",
    location: "",
    raceDate: "",
    polymarketConditionId: "",
    polymarketSlug: "",
  });

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

  const payoutsQueryKey = season?.id ? `/api/admin/season/${season.id}/payouts` : null;
  
  const { data: payouts = [] } = useQuery<Payout[]>({
    queryKey: [payoutsQueryKey],
    queryFn: async () => {
      if (!payoutsQueryKey) return [];
      return adminApiRequest(payoutsQueryKey, "GET");
    },
    enabled: !!payoutsQueryKey && season?.status === "concluded",
  });

  const { data: polymarketF1Markets = [], refetch: refetchPolymarketMarkets, isLoading: polymarketLoading } = useQuery<PolymarketF1Market[]>({
    queryKey: ["/api/polymarket/f1-markets"],
    queryFn: async () => {
      const res = await fetch("/api/polymarket/f1-markets");
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: raceMarkets = [], refetch: refetchRaceMarkets, isLoading: raceMarketsLoading } = useQuery<RaceMarket[]>({
    queryKey: ["/api/admin/race-markets"],
    queryFn: async () => adminApiRequest("/api/admin/race-markets", "GET"),
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

  const createRaceMarketMutation = useMutation({
    mutationFn: async (raceData: typeof newRace) => {
      return adminApiRequest("/api/admin/race-markets", "POST", raceData);
    },
    onSuccess: () => {
      toast({ title: "Race Market Created", description: "New race market has been added." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/race-markets"] });
      setShowAddRaceDialog(false);
      setNewRace({ name: "", shortName: "", location: "", raceDate: "", polymarketConditionId: "", polymarketSlug: "" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to create race market", variant: "destructive" });
    },
  });

  const toggleRaceVisibilityMutation = useMutation({
    mutationFn: async ({ id, isVisible }: { id: string; isVisible: boolean }) => {
      return adminApiRequest(`/api/admin/race-markets/${id}`, "PATCH", { isVisible });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/race-markets"] });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update visibility", variant: "destructive" });
    },
  });

  const deleteRaceMarketMutation = useMutation({
    mutationFn: async (id: string) => {
      return adminApiRequest(`/api/admin/race-markets/${id}`, "DELETE");
    },
    onSuccess: () => {
      toast({ title: "Race Market Deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/race-markets"] });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to delete race market", variant: "destructive" });
    },
  });

  const populateDriversMutation = useMutation({
    mutationFn: async (raceId: string) => {
      return adminApiRequest(`/api/admin/race-markets/${raceId}/populate-drivers`, "POST");
    },
    onSuccess: (data: { addedCount: number; totalOutcomes: number }) => {
      toast({ 
        title: "Drivers Added", 
        description: `Added ${data.addedCount} drivers. Total: ${data.totalOutcomes} outcomes.` 
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/race-markets"] });
      if (selectedRaceForOutcomes) {
        queryClient.invalidateQueries({ queryKey: ["/api/admin/race-markets", selectedRaceForOutcomes.id, "outcomes"] });
      }
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to populate drivers", variant: "destructive" });
    },
  });

  const { data: raceOutcomes = [], isLoading: outcomesLoading, refetch: refetchOutcomes } = useQuery<EnrichedOutcome[]>({
    queryKey: ["/api/admin/race-markets", selectedRaceForOutcomes?.id, "outcomes"],
    queryFn: async () => {
      if (!selectedRaceForOutcomes) return [];
      return adminApiRequest(`/api/admin/race-markets/${selectedRaceForOutcomes.id}/outcomes`, "GET");
    },
    enabled: !!selectedRaceForOutcomes && showOutcomesDialog,
  });

  const updateOutcomeMutation = useMutation({
    mutationFn: async ({ outcomeId, polymarketTokenId, currentPrice }: { outcomeId: string; polymarketTokenId: string; currentPrice: number }) => {
      return adminApiRequest(`/api/admin/race-market-outcomes/${outcomeId}`, "PATCH", { polymarketTokenId, currentPrice });
    },
    onSuccess: () => {
      toast({ title: "Outcome Updated" });
      if (selectedRaceForOutcomes) {
        queryClient.invalidateQueries({ queryKey: ["/api/admin/race-markets", selectedRaceForOutcomes.id, "outcomes"] });
      }
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update outcome", variant: "destructive" });
    },
  });

  const handleOpenOutcomesDialog = (race: RaceMarket) => {
    setSelectedRaceForOutcomes(race);
    setOutcomeEdits({});
    setShowOutcomesDialog(true);
  };

  const handleSaveOutcome = (outcome: EnrichedOutcome) => {
    const edits = outcomeEdits[outcome.id];
    if (!edits) return;
    
    const parsedPrice = parseFloat(edits.price);
    const currentPrice = Number.isFinite(parsedPrice) && parsedPrice >= 0 && parsedPrice <= 1 
      ? parsedPrice 
      : 0.05;
    
    updateOutcomeMutation.mutate({
      outcomeId: outcome.id,
      polymarketTokenId: edits.tokenId,
      currentPrice,
    });
  };

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
                  <Flag className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Race Markets</p>
                    <p className="text-sm text-muted-foreground">
                      {raceMarketsLoading ? "Loading..." : 
                        raceMarkets.length > 0 
                          ? `${raceMarkets.length} race markets configured`
                          : "No race markets. Add races to enable individual race betting."}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Dialog open={showAddRaceDialog} onOpenChange={setShowAddRaceDialog}>
                    <DialogTrigger asChild>
                      <Button size="sm" data-testid="button-add-race">
                        <Plus className="h-4 w-4 mr-1" />
                        Add Race
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Add Race Market</DialogTitle>
                        <DialogDescription>
                          Create a new race market for individual race betting.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <Label htmlFor="raceName">Race Name</Label>
                          <Input
                            id="raceName"
                            placeholder="e.g., Australian Grand Prix 2026"
                            value={newRace.name}
                            onChange={(e) => setNewRace({ ...newRace, name: e.target.value })}
                            data-testid="input-race-name"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="shortName">Short Name</Label>
                            <Input
                              id="shortName"
                              placeholder="e.g., AUS"
                              value={newRace.shortName}
                              onChange={(e) => setNewRace({ ...newRace, shortName: e.target.value })}
                              data-testid="input-short-name"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="raceDate">Race Date</Label>
                            <Input
                              id="raceDate"
                              type="date"
                              value={newRace.raceDate}
                              onChange={(e) => setNewRace({ ...newRace, raceDate: e.target.value })}
                              data-testid="input-race-date"
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="location">Location</Label>
                          <Input
                            id="location"
                            placeholder="e.g., Melbourne, Australia"
                            value={newRace.location}
                            onChange={(e) => setNewRace({ ...newRace, location: e.target.value })}
                            data-testid="input-location"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="polymarketConditionId">Polymarket Condition ID (optional)</Label>
                          <Input
                            id="polymarketConditionId"
                            placeholder="Polymarket market condition ID"
                            value={newRace.polymarketConditionId}
                            onChange={(e) => setNewRace({ ...newRace, polymarketConditionId: e.target.value })}
                            data-testid="input-condition-id"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="polymarketSlug">Polymarket Slug (optional)</Label>
                          <Input
                            id="polymarketSlug"
                            placeholder="e.g., australian-gp-2026-winner"
                            value={newRace.polymarketSlug}
                            onChange={(e) => setNewRace({ ...newRace, polymarketSlug: e.target.value })}
                            data-testid="input-slug"
                          />
                        </div>
                        <Button
                          className="w-full"
                          onClick={() => createRaceMarketMutation.mutate(newRace)}
                          disabled={!newRace.name || !newRace.shortName || !newRace.location || !newRace.raceDate || createRaceMarketMutation.isPending}
                          data-testid="button-create-race"
                        >
                          {createRaceMarketMutation.isPending ? "Creating..." : "Create Race Market"}
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => refetchRaceMarkets()}
                    disabled={raceMarketsLoading}
                    data-testid="button-refresh-races"
                  >
                    <RefreshCw className={`h-4 w-4 ${raceMarketsLoading ? 'animate-spin' : ''}`} />
                  </Button>
                </div>
              </div>
              
              {raceMarkets.length > 0 && (
                <div className="mt-3 space-y-2 max-h-64 overflow-y-auto">
                  {raceMarkets.map((race) => (
                    <div
                      key={race.id}
                      className="flex items-center justify-between gap-2 text-sm p-3 rounded bg-muted/50"
                      data-testid={`race-row-${race.id}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium">{race.name}</p>
                          <Badge variant="outline" className="text-xs">{race.shortName}</Badge>
                          <Badge variant={race.status === "active" ? "default" : race.status === "completed" ? "secondary" : "outline"}>
                            {race.status}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1 flex-wrap">
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {race.location}
                          </span>
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {new Date(race.raceDate).toLocaleDateString()}
                          </span>
                          {race.polymarketConditionId && (
                            <span className="flex items-center gap-1">
                              <Link2 className="h-3 w-3" />
                              Polymarket linked
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleOpenOutcomesDialog(race)}
                          title="Manage driver outcomes"
                          data-testid={`button-manage-outcomes-${race.id}`}
                        >
                          <Settings className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => populateDriversMutation.mutate(race.id)}
                          disabled={populateDriversMutation.isPending}
                          title="Add all drivers as betting outcomes"
                          data-testid={`button-populate-drivers-${race.id}`}
                        >
                          <Users className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => toggleRaceVisibilityMutation.mutate({ id: race.id, isVisible: !race.isVisible })}
                          data-testid={`button-toggle-visibility-${race.id}`}
                        >
                          {race.isVisible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => deleteRaceMarketMutation.mutate(race.id)}
                          data-testid={`button-delete-race-${race.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
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
                          ? `${polymarketF1Markets.length} F1 markets available`
                          : "No F1 markets found"}
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
      </CardContent>

      <Dialog open={showOutcomesDialog} onOpenChange={setShowOutcomesDialog}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Manage Race Outcomes - {selectedRaceForOutcomes?.name}</DialogTitle>
            <DialogDescription>
              Configure Polymarket token IDs and prices for each driver outcome.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">
                {outcomesLoading ? "Loading outcomes..." : `${raceOutcomes.length} driver outcomes`}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => selectedRaceForOutcomes && populateDriversMutation.mutate(selectedRaceForOutcomes.id)}
                  disabled={populateDriversMutation.isPending}
                  data-testid="button-dialog-populate-drivers"
                >
                  <Users className="h-4 w-4 mr-1" />
                  Add All Drivers
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => refetchOutcomes()}
                  data-testid="button-refresh-outcomes"
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </div>
            
            {raceOutcomes.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Users className="h-12 w-12 mx-auto mb-4" />
                <p>No driver outcomes configured.</p>
                <p className="text-sm">Click "Add All Drivers" to add all drivers as betting outcomes.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {raceOutcomes.map((outcome) => {
                  const edits = outcomeEdits[outcome.id] || { 
                    tokenId: outcome.polymarketTokenId, 
                    price: outcome.currentPrice.toString() 
                  };
                  const hasEdits = edits.tokenId !== outcome.polymarketTokenId || 
                    parseFloat(edits.price) !== outcome.currentPrice;
                  
                  return (
                    <div 
                      key={outcome.id} 
                      className="flex items-center gap-3 p-3 rounded bg-muted/50"
                      data-testid={`outcome-row-${outcome.id}`}
                    >
                      <div 
                        className="w-2 h-8 rounded shrink-0"
                        style={{ backgroundColor: outcome.driver?.color || "#888" }}
                      />
                      <div className="w-32 shrink-0">
                        <p className="font-medium text-sm">{outcome.driver?.name || outcome.driverId}</p>
                        <p className="text-xs text-muted-foreground">{outcome.driver?.shortName || ""}</p>
                      </div>
                      <div className="flex-1 grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-xs">Token ID</Label>
                          <Input
                            placeholder="Polymarket token ID"
                            value={edits.tokenId}
                            onChange={(e) => setOutcomeEdits(prev => ({
                              ...prev,
                              [outcome.id]: { ...edits, tokenId: e.target.value }
                            }))}
                            className="h-8 text-xs"
                            data-testid={`input-token-id-${outcome.id}`}
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Price (0-1)</Label>
                          <Input
                            placeholder="0.05"
                            type="number"
                            step="0.01"
                            min="0"
                            max="1"
                            value={edits.price}
                            onChange={(e) => setOutcomeEdits(prev => ({
                              ...prev,
                              [outcome.id]: { ...edits, price: e.target.value }
                            }))}
                            className="h-8 text-xs"
                            data-testid={`input-price-${outcome.id}`}
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Badge variant={outcome.polymarketTokenId ? "default" : "secondary"} className="text-xs">
                          {outcome.polymarketTokenId ? "Configured" : "Pending"}
                        </Badge>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleSaveOutcome(outcome)}
                          disabled={!hasEdits || updateOutcomeMutation.isPending}
                          data-testid={`button-save-outcome-${outcome.id}`}
                        >
                          <Save className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
