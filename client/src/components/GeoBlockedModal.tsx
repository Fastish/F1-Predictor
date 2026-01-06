import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Globe } from "lucide-react";

interface GeoBlockedModalProps {
  open: boolean;
  onClose: () => void;
  country?: string;
  region?: string;
}

export function GeoBlockedModal({ open, onClose, country, region }: GeoBlockedModalProps) {
  const locationText = country 
    ? `${country}${region ? ` (${region})` : ''}`
    : 'your region';

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader className="space-y-4">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <DialogTitle className="text-center text-xl">
            Trading Unavailable in Your Region
          </DialogTitle>
          <DialogDescription className="text-center space-y-3">
            <p>
              Due to regulatory requirements, trading on prediction markets is not available in <span className="font-medium">{locationText}</span>.
            </p>
            <p className="text-sm text-muted-foreground">
              You can still browse markets and view prices, but wallet connection and trading functionality are restricted in your jurisdiction.
            </p>
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 rounded-md bg-muted/50 p-4 text-sm">
          <div className="flex items-start gap-3">
            <Globe className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
            <div className="space-y-2">
              <p className="font-medium">Why am I seeing this?</p>
              <p className="text-muted-foreground">
                Polymarket and its integrated platforms must comply with local regulations. Some jurisdictions restrict access to prediction market trading.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-center">
          <Button 
            variant="outline" 
            onClick={onClose}
            data-testid="button-geo-blocked-close"
          >
            I Understand
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
