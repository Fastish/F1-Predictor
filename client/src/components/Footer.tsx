import { Link } from "wouter";
import { SiX } from "react-icons/si";

export function Footer() {
  return (
    <footer className="border-t py-8">
      <div className="mx-auto max-w-7xl px-4">
        <div className="flex flex-col items-center gap-4">
          <div className="flex items-center gap-6 flex-wrap justify-center">
            <Link href="/about" className="text-sm text-muted-foreground hover-elevate px-2 py-1 rounded-md" data-testid="link-about">
              About
            </Link>
            <a 
              href="https://x.com/F1PredictPro" 
              target="_blank" 
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover-elevate px-2 py-1 rounded-md"
              data-testid="link-twitter"
            >
              <SiX className="h-4 w-4" />
              <span>Follow us</span>
            </a>
          </div>
          <div className="text-center text-sm text-muted-foreground">
            <p>F1 Predict - Predictive Market Platform</p>
            <p className="mt-1">
              This site is powered by Polymarket.com
            </p>
            <p className="mt-1">
              All orders are subject to{" "}
              <a href="https://polymarket.com/tos" className="underline" target="_blank" rel="noopener noreferrer">
                Polymarket terms
              </a>
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
