import { TrendingUp, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface HeroSectionProps {
  onStartTrading?: () => void;
}

export function HeroSection({ onStartTrading }: HeroSectionProps) {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-background via-background to-accent/20 py-12 md:py-16">
      <div className="absolute inset-0 bg-[linear-gradient(to_right,hsl(var(--border))_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--border))_1px,transparent_1px)] bg-[size:4rem_4rem] opacity-20" />
      
      <div className="relative mx-auto max-w-7xl px-4">
        <div className="flex flex-col items-start gap-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1.5">
              <TrendingUp className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">2026 Season Markets Now Open</span>
            </div>
            
            <h1 className="mb-4 text-4xl font-bold tracking-tight md:text-5xl lg:text-6xl" data-testid="text-hero-title">
              Trade the 2026 F1{" "}
              <span className="text-primary">Championship</span>
            </h1>
            
            <p className="mb-6 text-lg text-muted-foreground md:text-xl">
              Bet on your favorite teams. Prices rise with demand. 
              Winning team shares convert to $1 at season end.
            </p>

            <div className="flex flex-wrap items-center gap-4">
              <Button size="lg" onClick={onStartTrading} data-testid="button-start-trading">
                Start Trading
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <Button size="lg" variant="outline" data-testid="button-learn-more">
                How It Works
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
