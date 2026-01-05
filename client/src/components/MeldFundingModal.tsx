import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useTradingSession } from "@/hooks/useTradingSession";
import { Loader2, ExternalLink } from "lucide-react";
import { useState, useEffect } from "react";

interface MeldFundingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const MELD_PUBLIC_KEY = "WePNa5T53tvjrDoDJmjw9q:8NSQa6kumCFrGM1tmGLWvnXDVfWNE1cWbf6fyUGv";
const DEFAULT_AMOUNT = 100;

export function MeldFundingModal({ open, onOpenChange }: MeldFundingModalProps) {
  const { safeAddress } = useTradingSession();
  const [isLoading, setIsLoading] = useState(true);
  const [countryCode, setCountryCode] = useState<string>("US");

  useEffect(() => {
    const detectCountry = async () => {
      try {
        const response = await fetch("https://ipapi.co/json/");
        const data = await response.json();
        if (data.country_code) {
          setCountryCode(data.country_code);
        }
      } catch (error) {
        console.error("Failed to detect country:", error);
      }
    };

    if (open) {
      detectCountry();
      setIsLoading(true);
    }
  }, [open]);

  const buildMeldUrl = () => {
    const params = new URLSearchParams({
      publicKey: MELD_PUBLIC_KEY,
      sourceAmount: DEFAULT_AMOUNT.toString(),
      destinationCurrencyCode: "USDC_POLYGON",
      countryCode: countryCode,
      theme: "darkMode",
    });

    if (safeAddress) {
      params.set("walletAddress", safeAddress);
      params.set("walletAddressLocked", safeAddress);
    }

    return `https://meldcrypto.com/?${params.toString()}`;
  };

  const handleIframeLoad = () => {
    setIsLoading(false);
  };

  const meldUrl = buildMeldUrl();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl h-[80vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            Add External Funds
          </DialogTitle>
          <DialogDescription>
            Buy USDC with card or bank transfer via Meld
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 relative overflow-hidden">
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-background z-10">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Loading Meld checkout...</p>
              </div>
            </div>
          )}
          <iframe
            src={meldUrl}
            className="w-full h-full border-0"
            allow="payment; accelerometer; gyroscope; camera"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
            onLoad={handleIframeLoad}
            title="Meld Crypto Checkout"
            data-testid="iframe-meld"
          />
        </div>

        <div className="px-6 py-4 border-t flex items-center justify-between gap-4 flex-shrink-0">
          <p className="text-xs text-muted-foreground">
            Funds will be deposited directly to your Safe Trading Wallet
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open(meldUrl, "_blank")}
            data-testid="button-open-meld-external"
          >
            <ExternalLink className="h-3.5 w-3.5 mr-1" />
            Open in New Tab
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
