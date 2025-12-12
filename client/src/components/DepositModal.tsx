import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useMarket } from "@/context/MarketContext";
import { useWallet } from "@/context/WalletContext";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { Copy, ExternalLink, Wallet, AlertCircle, Link2, Loader2, LogOut } from "lucide-react";
import { SiStellar } from "react-icons/si";

interface DepositModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface DepositInfo {
  depositAddress: string | null;
  memo: string;
  network: string;
  usdcIssuer: string;
  instructions: string;
}

interface USDCBalanceResponse {
  address: string;
  balance: string;
  asset: string;
}

export function DepositModal({ open, onOpenChange }: DepositModalProps) {
  const { userId } = useMarket();
  const { walletAddress, isFreighterInstalled, isConnecting, connectWallet, disconnectWallet } = useWallet();
  const { toast } = useToast();
  
  const { data: depositInfo } = useQuery<DepositInfo>({
    queryKey: ["/api/users", userId, "deposit-info"],
    enabled: !!userId && open,
  });

  const { data: usdcBalance, isLoading: isLoadingBalance } = useQuery<USDCBalanceResponse>({
    queryKey: ["/api/stellar/balance", walletAddress],
    enabled: !!walletAddress && open,
  });

  const handleDisconnect = () => {
    disconnectWallet();
    toast({
      title: "Wallet Disconnected",
      description: "Your Freighter wallet has been disconnected.",
    });
  };

  const handleConnect = async () => {
    const success = await connectWallet();
    if (success) {
      // Link wallet to user on the backend
      if (userId) {
        try {
          const { getAddress } = await import("@stellar/freighter-api");
          const addressResult = await getAddress();
          if (addressResult.address) {
            const res = await fetch(`/api/users/${userId}/link-wallet`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ walletAddress: addressResult.address }),
            });
            if (!res.ok) {
              const error = await res.json();
              toast({
                title: "Wallet Link Failed",
                description: error.error || "Failed to verify wallet. Please try again.",
                variant: "destructive",
              });
              return;
            }
            toast({
              title: "Wallet Connected",
              description: "Your Freighter wallet has been verified and linked.",
            });
          }
        } catch (e) {
          console.error("Failed to link wallet:", e);
          toast({
            title: "Wallet Link Error",
            description: "Failed to verify wallet connection. Please try again.",
            variant: "destructive",
          });
          return;
        }
      } else {
        toast({
          title: "Wallet Connected",
          description: "Your Freighter wallet has been connected.",
        });
      }
    } else {
      toast({
        title: "Connection Failed",
        description: "Failed to connect to Freighter wallet",
        variant: "destructive",
      });
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied",
      description: `${label} copied to clipboard`,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            Add Funds
          </DialogTitle>
          <DialogDescription>
            Deposit USDC via Stellar network to fund your trading account.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="rounded-md bg-muted p-4">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <SiStellar className="h-5 w-5 text-foreground" />
                <span className="font-medium">Stellar USDC Deposit</span>
                <Badge variant="outline">
                  {depositInfo?.network || "testnet"}
                </Badge>
              </div>
              {walletAddress && (
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="font-mono text-xs">
                    {walletAddress.slice(0, 4)}...{walletAddress.slice(-4)}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={handleDisconnect}
                    data-testid="button-disconnect-wallet"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>

            {walletAddress && (
              <div className="mb-4 p-3 rounded-md bg-background border">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm">
                    <p className="text-muted-foreground">USDC Balance</p>
                    {isLoadingBalance ? (
                      <p className="font-bold text-lg">Loading...</p>
                    ) : (
                      <p className="font-bold text-lg tabular-nums" data-testid="text-usdc-balance">
                        {usdcBalance?.balance ? `$${parseFloat(usdcBalance.balance).toFixed(2)}` : "$0.00"}
                      </p>
                    )}
                  </div>
                  <SiStellar className="h-8 w-8 text-muted-foreground" />
                </div>
              </div>
            )}

            {isFreighterInstalled === false && (
              <div className="mb-4 p-3 rounded-md bg-background border">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                  <div className="text-sm">
                    <p className="font-medium">Freighter Wallet Not Detected</p>
                    <p className="text-muted-foreground mt-1">
                      Install the Freighter browser extension to connect your Stellar wallet.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2"
                      onClick={() => window.open("https://freighter.app", "_blank")}
                      data-testid="button-install-freighter"
                    >
                      <ExternalLink className="h-3.5 w-3.5 mr-2" />
                      Get Freighter
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {isFreighterInstalled && !walletAddress && (
              <div className="mb-4">
                <Button
                  onClick={handleConnect}
                  disabled={isConnecting}
                  className="w-full"
                  variant="outline"
                  data-testid="button-connect-wallet"
                >
                  {isConnecting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Connecting...
                    </>
                  ) : (
                    <>
                      <Link2 className="h-4 w-4 mr-2" />
                      Connect Freighter Wallet
                    </>
                  )}
                </Button>
              </div>
            )}
            
            {depositInfo?.depositAddress ? (
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-muted-foreground">Deposit Address</label>
                  <div className="flex items-center gap-2 mt-1">
                    <code className="flex-1 text-xs bg-background rounded px-2 py-1.5 truncate" data-testid="text-deposit-address">
                      {depositInfo.depositAddress}
                    </code>
                    <Button 
                      size="icon" 
                      variant="ghost"
                      onClick={() => copyToClipboard(depositInfo.depositAddress!, "Address")}
                      data-testid="button-copy-address"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div>
                  <label className="text-xs text-muted-foreground">Your Memo (Required)</label>
                  <div className="flex items-center gap-2 mt-1">
                    <code className="flex-1 text-xs bg-background rounded px-2 py-1.5 font-mono" data-testid="text-memo">
                      {depositInfo.memo}
                    </code>
                    <Button 
                      size="icon" 
                      variant="ghost"
                      onClick={() => copyToClipboard(depositInfo.memo, "Memo")}
                      data-testid="button-copy-memo"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="flex items-start gap-2 text-xs text-muted-foreground mt-2">
                  <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>Always include the memo when sending USDC. Deposits without the correct memo may be lost.</span>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-sm text-muted-foreground">
                  If you have XLM testnet tokens, you may add USDC as an asset in your wallet and perform a swap to get USDC tokens.
                </div>
                <a 
                  href="/#how-it-works" 
                  className="text-sm text-primary hover:underline inline-flex items-center gap-1"
                  onClick={(e) => {
                    e.preventDefault();
                    onOpenChange(false);
                    window.location.href = "/#how-it-works";
                    setTimeout(() => {
                      const element = document.getElementById("how-it-works");
                      if (element) {
                        element.scrollIntoView({ behavior: "smooth" });
                      }
                    }, 100);
                  }}
                  data-testid="link-how-it-works"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  How it works
                </a>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
