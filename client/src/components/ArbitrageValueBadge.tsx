import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Info } from "lucide-react";

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
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={`cursor-help gap-1 text-xs ${
            isBuyYes
              ? "border-green-500/50 bg-green-500/10 text-green-600 dark:border-green-400/50 dark:bg-green-400/10 dark:text-green-400"
              : "border-amber-500/50 bg-amber-500/10 text-amber-600 dark:border-amber-400/50 dark:bg-amber-400/10 dark:text-amber-400"
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
        </Badge>
      </TooltipTrigger>
      <TooltipContent 
        side="top" 
        className="max-w-xs text-sm"
        data-testid={`tooltip-arb-${opportunity.id}`}
      >
        <div className="space-y-2">
          <p>{opportunity.tooltipMessage}</p>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Info className="h-3 w-3" />
            <span>Based on {opportunity.sportsbookName} odds</span>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

interface ArbitrageSummaryProps {
  opportunities: ArbitrageOpportunity[];
  dataSource: string;
  hasLiveOdds: boolean;
}

export function ArbitrageSummary({ opportunities, dataSource, hasLiveOdds }: ArbitrageSummaryProps) {
  const buyYesCount = opportunities.filter(o => o.recommendation === "BUY_YES").length;
  const buyNoCount = opportunities.filter(o => o.recommendation === "BUY_NO").length;
  const totalOpportunities = buyYesCount + buyNoCount;

  if (totalOpportunities === 0) {
    return null;
  }

  return (
    <div className="mb-4 rounded-lg border border-accent/50 bg-accent/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1 border-primary/50 bg-primary/10 text-primary">
            <TrendingUp className="h-3 w-3" />
            {totalOpportunities} Value Opportunity{totalOpportunities > 1 ? "ies" : ""}
          </Badge>
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
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex cursor-help items-center gap-1 text-xs text-muted-foreground">
              <Info className="h-3 w-3" />
              {hasLiveOdds ? "Live odds" : "Estimated odds"}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            <p className="text-sm">
              Comparing Polymarket prices against {dataSource}. Opportunities are flagged when the 
              price difference exceeds 5 percentage points.
            </p>
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
