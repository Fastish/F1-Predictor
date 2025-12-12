import { TrendingUp, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import heroVideo from "@assets/hero-video.webm";

interface HeroSectionProps {
  onStartTrading?: () => void;
}

export function HeroSection({ onStartTrading }: HeroSectionProps) {
  return (
    <section className="relative overflow-hidden py-16 md:py-24">
      {/* Video Background */}
      <video
        autoPlay
        loop
        muted
        playsInline
        className="absolute inset-0 h-full w-full object-cover"
      >
        <source src={heroVideo} type="video/webm" />
      </video>
      
      {/* Dark Overlay for text readability */}
      <div className="absolute inset-0 bg-black/60" />
      
      <div className="relative z-10 mx-auto max-w-7xl px-4">
        <div className="flex flex-col items-start gap-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 backdrop-blur-sm">
              <TrendingUp className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-white">2026 Season Markets Now Open</span>
            </div>
            
            <h1 className="mb-4 text-4xl font-bold tracking-tight text-white md:text-5xl lg:text-6xl" data-testid="text-hero-title">
              Trade the 2026 F1{" "}
              <span className="text-primary">Championship</span>
            </h1>
            
            <p className="mb-6 text-lg text-white/80 md:text-xl">
              Bet on your favorite teams. Prices rise with demand. 
              Winning team shares convert to $1 at season end.
            </p>

            <div className="flex flex-wrap items-center gap-4">
              <Button size="lg" onClick={onStartTrading} data-testid="button-start-trading">
                Start Trading
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <Button size="lg" variant="outline" className="border-white/30 bg-white/10 text-white backdrop-blur-sm" data-testid="button-learn-more">
                How It Works
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
