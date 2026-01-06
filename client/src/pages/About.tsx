import { useSEO } from "@/hooks/useSEO";
import { Footer } from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Mail, HelpCircle, Handshake, AlertTriangle } from "lucide-react";

export default function About() {
  useSEO({
    title: "About F1 Predict",
    description: "Learn about F1 Predict - the prediction market platform for Formula 1 racing enthusiasts.",
  });

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex-1">
        <div className="mx-auto max-w-4xl px-4 py-8">
          <h1 className="text-3xl font-bold mb-8" data-testid="text-about-title">About F1 Predict</h1>
          
          <div className="space-y-6">
            <Card>
              <CardContent className="pt-6">
                <p className="text-muted-foreground leading-relaxed">
                  F1Predict is an independent site built by racing enthusiasts. The vision was to incorporate news, 
                  live race data, community insights, and predictive markets to create a platform where fans can 
                  soak up everything that's happening in real time. Whether you're looking to set the perfect 
                  fantasy lineup, place a bet on the race, or just have your finger on the pulse of what's happening 
                  in Formula 1, we hope this site is a helpful resource.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Handshake className="h-5 w-5" />
                  Partnerships / Advertising
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  If you are interested in brand partnerships or advertising, please contact{" "}
                  <a href="mailto:f1predictpro@gmail.com" className="underline text-foreground" data-testid="link-partnership-email">
                    f1predictpro@gmail.com
                  </a>
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <HelpCircle className="h-5 w-5" />
                  Support
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-muted-foreground">
                  If you are using the betting platform and having any technical issues, please see the{" "}
                  <a href="/how-it-works" className="underline text-foreground" data-testid="link-how-it-works">
                    How it Works
                  </a>{" "}
                  guide. If you continue to have issues with the betting platform, send us a note:{" "}
                  <a href="mailto:f1predictpro@gmail.com" className="underline text-foreground" data-testid="link-support-email">
                    f1predictpro@gmail.com
                  </a>
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5" />
                  Regional Restrictions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  Please note that the betting and predictive markets are restricted for use in some regions.{" "}
                  <a 
                    href="https://help.polymarket.com/en/articles/10066393-restricted-regions" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="underline text-foreground"
                    data-testid="link-polymarket-regions"
                  >
                    View Polymarket documentation
                  </a>{" "}
                  to see restricted regions. These regions are determined based on your IP address.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}
