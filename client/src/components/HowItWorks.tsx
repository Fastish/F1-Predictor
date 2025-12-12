import { DollarSign, TrendingUp, Trophy } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const steps = [
  {
    icon: DollarSign,
    title: "Place Your Bet",
    description:
      "Bet on any F1 team you believe will win the 2026 championship. Prices reflect market sentiment.",
  },
  {
    icon: TrendingUp,
    title: "Prices Adjust",
    description:
      "As more people buy shares in a team, its price increases. Sell high or hold until the end of the season.",
  },
  {
    icon: Trophy,
    title: "Winner Takes Pool",
    description:
      "When the season ends, shares of the winning team are worth $1. Shareholders split the entire prize pool.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="border-t bg-card/50 py-12">
      <div className="mx-auto max-w-7xl px-4">
        <div className="mb-8 text-center">
          <h2 className="text-2xl font-bold" data-testid="text-how-it-works-title">How It Works</h2>
          <p className="mt-2 text-muted-foreground">
            Simple prediction market mechanics for the 2026 F1 season
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {steps.map((step, index) => (
            <Card key={step.title} className="relative">
              <div className="absolute -top-3 left-4">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                  {index + 1}
                </span>
              </div>
              <CardContent className="pt-6">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                  <step.icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="mb-2 text-lg font-bold" data-testid={`text-step-title-${index}`}>{step.title}</h3>
                <p className="text-sm text-muted-foreground">{step.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
