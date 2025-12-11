import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useMarket } from "@/context/MarketContext";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Copy, ExternalLink, Wallet, DollarSign, AlertCircle, Link2, Loader2, LogOut } from "lucide-react";
import { SiStellar } from "react-icons/si";
import { isConnected, requestAccess, getAddress } from "@stellar/freighter-api";

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
  const { userId, refetch } = useMarket();
  const { toast } = useToast();
  const [demoAmount, setDemoAmount] = useState("50");
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [isFreighterInstalled, setIsFreighterInstalled] = useState<boolean | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  
  const { data: depositInfo } = useQuery<DepositInfo>({
    queryKey: ["/api/users", userId, "deposit-info"],
    enabled: !!userId && open,
  });

  const { data: usdcBalance, isLoading: isLoadingBalance } = useQuery<USDCBalanceResponse>({
    queryKey: [`/api/stellar/balance/${walletAddress}`],
    enabled: !!walletAddress && open,
  });

  const disconnectWallet = () => {
    setWalletAddress(null);
    toast({
      title: "Wallet Disconnected",
      description: "Your Freighter wallet has been disconnected.",
    });
  };

  useEffect(() => {
    const checkFreighter = async () => {
      try {
        const result = await isConnected();
        setIsFreighterInstalled(result.isConnected);
        if (result.isConnected) {
          const addressResult = await getAddress();
          if (addressResult.address) {
            setWalletAddress(addressResult.address);
          }
        }
      } catch (e) {
        setIsFreighterInstalled(false);
      }
    };
    if (open) {
      checkFreighter();
    }
  }, [open]);

  const connectFreighter = async () => {
    setIsConnecting(true);
    try {
      const accessResult = await requestAccess();
      if (accessResult.error) {
        toast({
          title: "Connection Failed",
          description: accessResult.error,
          variant: "destructive",
        });
      } else if (accessResult.address) {
        setWalletAddress(accessResult.address);
        toast({
          title: "Wallet Connected",
          description: `Connected to ${accessResult.address.slice(0, 8)}...${accessResult.address.slice(-4)}`,
        });
      }
    } catch (e) {
      toast({
        title: "Error",
        description: "Failed to connect to Freighter wallet",
        variant: "destructive",
      });
    } finally {
      setIsConnecting(false);
    }
  };

  const addDemoCredits = useMutation({
    mutationFn: async (amount: number) => {
      const res = await fetch("/api/demo/add-credits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, amount }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to add credits");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/users", userId] });
      toast({
        title: "Credits Added",
        description: `$${demoAmount} demo credits have been added to your account.`,
      });
      refetch();
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied",
      description: `${label} copied to clipboard`,
    });
  };

  const handleAddCredits = () => {
    const amount = parseFloat(demoAmount);
    if (isNaN(amount) || amount <= 0 || amount > 1000) {
      toast({
        title: "Invalid Amount",
        description: "Please enter an amount between 1 and 1000",
        variant: "destructive",
      });
      return;
    }
    addDemoCredits.mutate(amount);
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
            Deposit USDC via Stellar network or add demo credits to test trading.
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
                    onClick={disconnectWallet}
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
                  onClick={connectFreighter}
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
              <div className="text-sm text-muted-foreground">
                <AlertCircle className="h-4 w-4 inline mr-2" />
                Stellar deposit address not configured. Use demo credits below.
              </div>
            )}
          </div>

          <Separator />

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-foreground" />
              <span className="font-medium">Demo Credits</span>
              <Badge variant="secondary">Testing</Badge>
            </div>
            
            <p className="text-sm text-muted-foreground">
              Add demo credits to test the trading features. These are not real funds.
            </p>

            <div className="flex gap-2">
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                <Input
                  type="number"
                  value={demoAmount}
                  onChange={(e) => setDemoAmount(e.target.value)}
                  className="pl-7"
                  min="1"
                  max="1000"
                  step="10"
                  data-testid="input-demo-amount"
                />
              </div>
              <Button 
                onClick={handleAddCredits}
                disabled={addDemoCredits.isPending}
                data-testid="button-add-credits"
              >
                {addDemoCredits.isPending ? "Adding..." : "Add Credits"}
              </Button>
            </div>

            <div className="flex gap-2 flex-wrap">
              {[25, 50, 100, 250].map((amount) => (
                <Button
                  key={amount}
                  variant="outline"
                  size="sm"
                  onClick={() => setDemoAmount(amount.toString())}
                  data-testid={`button-preset-${amount}`}
                >
                  ${amount}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
