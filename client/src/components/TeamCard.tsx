import { TrendingUp, TrendingDown, DollarSign, Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArbitrageValueBadge, type ArbitrageOpportunity } from "./ArbitrageValueBadge";
import type { F1Team } from "@/context/MarketContext";

interface TeamCardProps {
  team: F1Team;
  onBuy?: (team: F1Team) => void;
  owned?: number;
  tradingLocked?: boolean;
  arbitrageOpportunity?: ArbitrageOpportunity;
}

export function TeamCard({ team, onBuy, owned, tradingLocked, arbitrageOpportunity }: TeamCardProps) {
  const isPositive = team.priceChange >= 0;

  return (
    <Card className="group relative overflow-visible transition-all">
      <div
        className="absolute left-0 top-0 h-1 w-full rounded-t-lg"
        style={{ backgroundColor: team.color }}
      />
      <CardContent className="flex flex-col gap-4 p-4 pt-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <div
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: team.color }}
              />
              <span className="truncate text-sm font-medium text-muted-foreground">
                {team.shortName}
              </span>
              <ArbitrageValueBadge opportunity={arbitrageOpportunity} compact />
            </div>
            <h3 className="mt-1 truncate text-base font-bold" data-testid={`text-team-name-${team.id}`}>
              {team.name}
            </h3>
          </div>
          {owned && owned > 0 && (
            <Badge variant="secondary" className="shrink-0 text-xs">
              {owned} owned
            </Badge>
          )}
        </div>

        <div className="flex items-end justify-between gap-2">
          <div>
            <span className="text-2xl font-bold tabular-nums" data-testid={`text-price-${team.id}`}>
              ${team.price.toFixed(2)}
            </span>
            <div className="mt-1 flex items-center gap-1">
              {isPositive ? (
                <TrendingUp className="h-3.5 w-3.5 text-green-500 dark:text-green-400" />
              ) : (
                <TrendingDown className="h-3.5 w-3.5 text-red-500 dark:text-red-400" />
              )}
              <span
                className={`text-sm font-medium tabular-nums ${
                  isPositive ? "text-green-500 dark:text-green-400" : "text-red-500 dark:text-red-400"
                }`}
                data-testid={`text-change-${team.id}`}
              >
                {isPositive ? "+" : ""}
                {team.priceChange.toFixed(1)}%
              </span>
            </div>
          </div>
          <Button 
            size="sm" 
            onClick={() => onBuy?.(team)} 
            disabled={tradingLocked}
            data-testid={`button-buy-${team.id}`}
          >
            {tradingLocked ? (
              <>
                <Lock className="mr-1 h-3.5 w-3.5" />
                Locked
              </>
            ) : (
              <>
                <DollarSign className="mr-1 h-3.5 w-3.5" />
                Bet
              </>
            )}
          </Button>
        </div>

      </CardContent>
    </Card>
  );
}
