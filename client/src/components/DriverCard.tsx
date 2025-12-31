import { TrendingUp, TrendingDown, DollarSign, Lock, User } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArbitrageValueBadge, type ArbitrageOpportunity } from "./ArbitrageValueBadge";

export interface Driver {
  id: string;
  name: string;
  shortName: string;
  teamId: string;
  number: number;
  color: string;
  price: number;
  priceChange: number;
}

interface DriverCardProps {
  driver: Driver;
  onBuy?: (driver: Driver) => void;
  owned?: number;
  tradingLocked?: boolean;
  arbitrageOpportunity?: ArbitrageOpportunity;
}

export function DriverCard({ driver, onBuy, owned, tradingLocked, arbitrageOpportunity }: DriverCardProps) {
  const isPositive = driver.priceChange >= 0;

  return (
    <Card className="group relative overflow-visible transition-all">
      <div
        className="absolute left-0 top-0 h-1 w-full rounded-t-lg"
        style={{ backgroundColor: driver.color }}
      />
      <CardContent className="flex flex-col gap-4 p-4 pt-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <div
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                style={{ backgroundColor: driver.color }}
              >
                {driver.number}
              </div>
              <span className="truncate text-sm font-medium text-muted-foreground">
                {driver.shortName}
              </span>
              <ArbitrageValueBadge opportunity={arbitrageOpportunity} compact />
            </div>
            <h3 className="mt-1 truncate text-base font-bold" data-testid={`text-driver-name-${driver.id}`}>
              {driver.name}
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
            <span className="text-2xl font-bold tabular-nums" data-testid={`text-driver-price-${driver.id}`}>
              ${driver.price.toFixed(2)}
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
                data-testid={`text-driver-change-${driver.id}`}
              >
                {isPositive ? "+" : ""}
                {driver.priceChange.toFixed(1)}%
              </span>
            </div>
          </div>
          <Button 
            size="sm" 
            onClick={() => onBuy?.(driver)} 
            disabled={tradingLocked}
            data-testid={`button-buy-driver-${driver.id}`}
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
