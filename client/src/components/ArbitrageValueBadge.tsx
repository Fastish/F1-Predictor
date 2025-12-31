import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, Info, Filter, X } from "lucide-react";

export interface ArbitrageOpportunity {
  id: string;
  outcomeName: string;
  marketType: "constructor" | "driver";
  polymarketPrice: number;
  sportsbookProbability: number;
  sportsbookName: string;
  sportsbookOdds: string;
  delta: number;
  edgePercent: number;
  recommendation: "BUY_YES" | "BUY_NO" | "NEUTRAL";
  tooltipMessage: string;
  lastUpdated: string;
}

interface ArbitrageValueBadgeProps {
  opportunity: ArbitrageOpportunity | undefined;
  compact?: boolean;
}

export function ArbitrageValueBadge({ opportunity, compact = false }: ArbitrageValueBadgeProps) {
  if (!opportunity || opportunity.recommendation === "NEUTRAL") {
    return null;
  }

  const isBuyYes = opportunity.recommendation === "BUY_YES";
  const edgeDisplay = (opportunity.edgePercent * 100).toFixed(1);
  
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`inline-flex items-center cursor-pointer gap-1 text-xs font-medium rounded-md border px-2.5 py-0.5 transition-colors ${
            isBuyYes
              ? "border-green-500/50 bg-green-500/10 text-green-600 hover:bg-green-500/20 dark:border-green-400/50 dark:bg-green-400/10 dark:text-green-400 dark:hover:bg-green-400/20"
              : "border-amber-500/50 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 dark:border-amber-400/50 dark:bg-amber-400/10 dark:text-amber-400 dark:hover:bg-amber-400/20"
          }`}
          data-testid={`badge-arb-${opportunity.id}`}
        >
          {isBuyYes ? (
            <TrendingUp className="h-3 w-3" />
          ) : (
            <TrendingDown className="h-3 w-3" />
          )}
          {compact ? (
            <span>{isBuyYes ? "+" : "-"}{edgeDisplay}%</span>
          ) : (
            <span>
              {isBuyYes ? "Buy Yes" : "Buy No"} +{edgeDisplay}%
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent 
        side="top" 
        className="max-w-xs text-sm"
        data-testid={`popover-arb-${opportunity.id}`}
      >
        <div className="space-y-2">
          <p className="font-medium">
            {isBuyYes ? "Potential Underpriced" : "Potential Overpriced"}
          </p>
          <p className="text-muted-foreground">{opportunity.tooltipMessage}</p>
          <div className="flex items-center gap-1 text-xs text-muted-foreground border-t pt-2">
            <Info className="h-3 w-3" />
            <span>Based on {opportunity.sportsbookName} odds</span>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface ArbitrageSummaryProps {
  opportunities: ArbitrageOpportunity[];
  dataSource: string;
  hasLiveOdds: boolean;
  onFilterChange?: (filter: "all" | "buy_yes" | "buy_no") => void;
  activeFilter?: "all" | "buy_yes" | "buy_no";
}

export function ArbitrageSummary({ 
  opportunities, 
  dataSource, 
  hasLiveOdds,
  onFilterChange,
  activeFilter = "all"
}: ArbitrageSummaryProps) {
  const buyYesOpps = opportunities.filter(o => o.recommendation === "BUY_YES");
  const buyNoOpps = opportunities.filter(o => o.recommendation === "BUY_NO");
  const buyYesCount = buyYesOpps.length;
  const buyNoCount = buyNoOpps.length;
  const totalOpportunities = buyYesCount + buyNoCount;

  if (totalOpportunities === 0) {
    return null;
  }

  const handleFilterClick = (filter: "all" | "buy_yes" | "buy_no") => {
    if (onFilterChange) {
      onFilterChange(activeFilter === filter ? "all" : filter);
    }
  };

  return (
    <div className="mb-4 rounded-lg border border-accent/50 bg-accent/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="gap-1 border-primary/50 bg-primary/10 text-primary no-default-hover-elevate no-default-active-elevate">
            <TrendingUp className="h-3 w-3" />
            {totalOpportunities} Value Opportunity{totalOpportunities > 1 ? "ies" : ""}
          </Badge>
          
          {onFilterChange && (
            <>
              <span className="text-xs text-muted-foreground">
                <Filter className="h-3 w-3 inline mr-1" />
                Filter:
              </span>
              {buyYesCount > 0 && (
                <Button
                  variant={activeFilter === "buy_yes" ? "default" : "outline"}
                  size="sm"
                  onClick={() => handleFilterClick("buy_yes")}
                  className={`h-6 text-xs gap-1 ${
                    activeFilter !== "buy_yes" 
                      ? "border-green-500/50 text-green-600 hover:bg-green-500/20 dark:border-green-400/50 dark:text-green-400"
                      : "bg-green-600 hover:bg-green-700 dark:bg-green-500 dark:hover:bg-green-600"
                  }`}
                  data-testid="filter-buy-yes"
                >
                  <TrendingUp className="h-3 w-3" />
                  {buyYesCount} Buy Yes
                  {activeFilter === "buy_yes" && <X className="h-3 w-3 ml-0.5" />}
                </Button>
              )}
              {buyNoCount > 0 && (
                <Button
                  variant={activeFilter === "buy_no" ? "default" : "outline"}
                  size="sm"
                  onClick={() => handleFilterClick("buy_no")}
                  className={`h-6 text-xs gap-1 ${
                    activeFilter !== "buy_no"
                      ? "border-amber-500/50 text-amber-600 hover:bg-amber-500/20 dark:border-amber-400/50 dark:text-amber-400"
                      : "bg-amber-600 hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-600"
                  }`}
                  data-testid="filter-buy-no"
                >
                  <TrendingDown className="h-3 w-3" />
                  {buyNoCount} Buy No
                  {activeFilter === "buy_no" && <X className="h-3 w-3 ml-0.5" />}
                </Button>
              )}
            </>
          )}
          
          {!onFilterChange && (
            <>
              {buyYesCount > 0 && (
                <span className="text-sm text-green-600 dark:text-green-400">
                  {buyYesCount} Buy Yes
                </span>
              )}
              {buyNoCount > 0 && (
                <span className="text-sm text-amber-600 dark:text-amber-400">
                  {buyNoCount} Buy No
                </span>
              )}
            </>
          )}
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Info className="h-3 w-3" />
              {hasLiveOdds ? "Live odds" : "Estimated odds"}
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" className="max-w-xs">
            <p className="text-sm">
              Comparing Polymarket prices against {dataSource}. Opportunities are flagged when the 
              price difference exceeds 5 percentage points.
            </p>
          </PopoverContent>
        </Popover>
      </div>
      
      {activeFilter !== "all" && (
        <div className="mt-3 pt-3 border-t border-accent/30">
          <p className="text-xs text-muted-foreground mb-2">
            Showing {activeFilter === "buy_yes" ? "underpriced" : "overpriced"} opportunities:
          </p>
          <div className="flex flex-wrap gap-2">
            {(activeFilter === "buy_yes" ? buyYesOpps : buyNoOpps).map((opp) => (
              <Badge 
                key={opp.id}
                variant="secondary"
                className="text-xs"
              >
                {opp.outcomeName} (+{(opp.edgePercent * 100).toFixed(1)}%)
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
