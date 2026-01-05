import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useWallet } from "@/context/WalletContext";
import { useTradingSession } from "@/hooks/useTradingSession";
import { useToast } from "@/hooks/use-toast";
import { Copy, Check, Send, QrCode, Wallet, AlertCircle, Loader2, ExternalLink, Shield, CheckCircle2, ArrowDownLeft, ArrowUpRight, CreditCard, DollarSign } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { ethers } from "ethers";
import { getReadOnlyPolygonProvider } from "@/lib/polymarketDeposit";
import { SwapModal } from "./SwapModal";
import { MeldFundingModal } from "./MeldFundingModal";

interface WalletManagementModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: "receive" | "send";
  prefilledAddress?: string;
  title?: string;
  sendLabel?: string;
}

const USDC_CONTRACT_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const USDC_BRIDGED_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const USDC_DECIMALS = 6;

const USDC_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
];

async function fetchUsdcBalanceReadOnly(address: string): Promise<string> {
  try {
    const readOnlyProvider = getReadOnlyPolygonProvider();
    const usdcContract = new ethers.Contract(USDC_CONTRACT_ADDRESS, USDC_ABI, readOnlyProvider);
    const balance = await usdcContract.balanceOf(address);
    return ethers.formatUnits(balance, USDC_DECIMALS);
  } catch (error) {
    console.error("Error fetching USDC balance:", error);
    return "0";
  }
}

export function WalletManagementModal({ open, onOpenChange, initialTab = "receive", prefilledAddress = "", title, sendLabel = "Send" }: WalletManagementModalProps) {
  const { walletAddress, walletType, signer, provider } = useWallet();
  const { safeAddress, feeAuthorizationComplete, isTradingSessionComplete } = useTradingSession();
  const { toast } = useToast();
  const [safeCopied, setSafeCopied] = useState(false);
  
  const [copied, setCopied] = useState(false);
  const [recipientAddress, setRecipientAddress] = useState(prefilledAddress);
  const [sendAmount, setSendAmount] = useState("");
  const [activeTab, setActiveTab] = useState<string>(initialTab);

  const [swapOpen, setSwapOpen] = useState(false);
  const [swapDirection, setSwapDirection] = useState<"deposit" | "withdraw">("deposit");
  const [meldOpen, setMeldOpen] = useState(false);

  const isExternalWallet = walletType === "external" || walletType === "walletconnect" || walletType === "phantom";
  const hasSafeWallet = isExternalWallet && safeAddress && isTradingSessionComplete;

  useEffect(() => {
    if (open) {
      setActiveTab(initialTab);
      setRecipientAddress(prefilledAddress);
    }
  }, [open, initialTab, prefilledAddress]);
  const [isSending, setIsSending] = useState(false);
  const [balance, setBalance] = useState<string>("0.00");
  const [safeBalance, setSafeBalance] = useState<string>("0.00");
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);
  const [maticBalance, setMaticBalance] = useState<string>("0");

  useEffect(() => {
    const fetchBalances = async () => {
      if (open && walletAddress) {
        setIsLoadingBalance(true);
        try {
          const readOnlyProvider = getReadOnlyPolygonProvider();
          const usdcContract = new ethers.Contract(USDC_CONTRACT_ADDRESS, USDC_ABI, readOnlyProvider);
          
          const [usdcBal, maticBal] = await Promise.all([
            usdcContract.balanceOf(walletAddress),
            readOnlyProvider.getBalance(walletAddress),
          ]);
          setBalance(ethers.formatUnits(usdcBal, USDC_DECIMALS));
          setMaticBalance(ethers.formatEther(maticBal));

          if (safeAddress) {
            const safeBal = await usdcContract.balanceOf(safeAddress);
            setSafeBalance(ethers.formatUnits(safeBal, USDC_DECIMALS));
          }
        } catch (error) {
          console.error("Failed to fetch balances:", error);
        } finally {
          setIsLoadingBalance(false);
        }
      }
    };
    fetchBalances();
  }, [open, walletAddress, safeAddress, swapOpen]);

  const handleCopyAddress = async () => {
    if (!walletAddress) return;
    
    try {
      await navigator.clipboard.writeText(walletAddress);
      setCopied(true);
      toast({
        title: "Address Copied",
        description: "Wallet address copied to clipboard",
      });
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast({
        title: "Copy Failed",
        description: "Failed to copy address to clipboard",
        variant: "destructive",
      });
    }
  };

  const handleCopySafeAddress = async () => {
    if (!safeAddress) return;
    
    try {
      await navigator.clipboard.writeText(safeAddress);
      setSafeCopied(true);
      toast({
        title: "Address Copied",
        description: "Safe Trading Wallet address copied to clipboard",
      });
      setTimeout(() => setSafeCopied(false), 2000);
    } catch (error) {
      toast({
        title: "Copy Failed",
        description: "Failed to copy address to clipboard",
        variant: "destructive",
      });
    }
  };

  const validateAddress = (address: string): boolean => {
    try {
      ethers.getAddress(address);
      return true;
    } catch {
      return false;
    }
  };

  const handleSend = async () => {
    if (!signer || !walletAddress || !provider) {
      toast({
        title: "Wallet Not Ready",
        description: "Please ensure your wallet is connected",
        variant: "destructive",
      });
      return;
    }

    if (walletType !== "walletconnect") {
      try {
        const network = await provider.getNetwork();
        if (network.chainId !== BigInt(137)) {
          toast({
            title: "Wrong Network",
            description: "Please switch to Polygon network to send USDC",
            variant: "destructive",
          });
          return;
        }
      } catch (error: any) {
        console.error("Failed to check network:", error);
        toast({
          title: "Network Check Failed",
          description: "Could not verify network. Ensure you're on Polygon.",
          variant: "destructive",
        });
        return;
      }
    }

    const currentMaticBalance = parseFloat(maticBalance);
    if (currentMaticBalance < 0.001) {
      toast({
        title: "Insufficient Gas",
        description: "You need MATIC in your wallet to pay for transaction fees",
        variant: "destructive",
      });
      return;
    }

    if (!recipientAddress || !validateAddress(recipientAddress)) {
      toast({
        title: "Invalid Address",
        description: "Please enter a valid Polygon wallet address",
        variant: "destructive",
      });
      return;
    }

    if (recipientAddress.toLowerCase() === walletAddress.toLowerCase()) {
      toast({
        title: "Invalid Recipient",
        description: "Cannot send to your own address",
        variant: "destructive",
      });
      return;
    }

    const amount = parseFloat(sendAmount);
    if (isNaN(amount) || amount <= 0) {
      toast({
        title: "Invalid Amount",
        description: "Please enter a valid amount to send",
        variant: "destructive",
      });
      return;
    }

    const cachedBalance = parseFloat(balance);
    if (amount > cachedBalance) {
      toast({
        title: "Insufficient Balance",
        description: `You only have ${cachedBalance.toFixed(2)} USDC available`,
        variant: "destructive",
      });
      return;
    }

    setIsSending(true);

    try {
      const freshBalance = await fetchUsdcBalanceReadOnly(walletAddress);
      setBalance(freshBalance);
      if (amount > parseFloat(freshBalance)) {
        toast({
          title: "Insufficient Balance",
          description: `Current balance is ${parseFloat(freshBalance).toFixed(2)} USDC`,
          variant: "destructive",
        });
        setIsSending(false);
        return;
      }

      toast({
        title: "Sending USDC",
        description: "Please confirm the transaction in your wallet...",
      });

      const usdcContract = new ethers.Contract(USDC_CONTRACT_ADDRESS, USDC_ABI, signer);
      const amountInWei = ethers.parseUnits(sendAmount, USDC_DECIMALS);
      
      const tx = await usdcContract.transfer(recipientAddress, amountInWei);
      
      toast({
        title: "Transaction Submitted",
        description: "Waiting for confirmation...",
      });

      const receipt = await tx.wait();

      if (receipt.status === 1) {
        toast({
          title: "Transfer Complete",
          description: `Successfully sent ${amount.toFixed(2)} USDC`,
        });
        
        setRecipientAddress("");
        setSendAmount("");
        
        const newBalance = await fetchUsdcBalanceReadOnly(walletAddress);
        setBalance(newBalance);
      } else {
        throw new Error("Transaction failed");
      }
    } catch (error: any) {
      console.error("Transfer failed:", error);
      
      let errorMessage = "Failed to send USDC";
      if (error.code === "ACTION_REJECTED" || error.message?.includes("rejected")) {
        errorMessage = "Transaction was rejected";
      } else if (error.message?.includes("insufficient funds")) {
        errorMessage = "Insufficient MATIC for gas fees";
      }
      
      toast({
        title: "Transfer Failed",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsSending(false);
    }
  };

  const shortenAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const polygonscanUrl = walletAddress 
    ? `https://polygonscan.com/address/${walletAddress}` 
    : "";

  const handleDeposit = () => {
    setSwapDirection("deposit");
    setSwapOpen(true);
  };

  const handleWithdraw = () => {
    setSwapDirection("withdraw");
    setSwapOpen(true);
  };

  const handleAddFunds = () => {
    setMeldOpen(true);
  };

  if (!walletAddress) return null;

  const renderEOAWalletContent = () => (
    <div className="space-y-4 mt-4">
      <div className="grid grid-cols-1 gap-3">
        <Card className="p-4">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="font-medium text-sm">Safe Trading Wallet</p>
                <p className="text-xs text-muted-foreground">Your trading balance on Polymarket</p>
              </div>
            </div>
            <Badge variant="outline" className="font-mono">
              {isLoadingBalance ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                `$${parseFloat(safeBalance).toFixed(2)}`
              )}
            </Badge>
          </div>
          
          <div className="flex items-center gap-2 mb-4">
            <code className="flex-1 text-xs bg-muted px-2 py-1.5 rounded-md font-mono truncate">
              {safeAddress || "Not initialized"}
            </code>
            {safeAddress && (
              <Button
                size="icon"
                variant="outline"
                onClick={handleCopySafeAddress}
                data-testid="button-copy-safe-address"
              >
                {safeCopied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
              </Button>
            )}
          </div>

          {hasSafeWallet ? (
            <div className="grid grid-cols-2 gap-2">
              <Button
                onClick={handleDeposit}
                className="w-full"
                data-testid="button-deposit"
              >
                <ArrowDownLeft className="h-4 w-4 mr-2" />
                Deposit
              </Button>
              <Button
                variant="outline"
                onClick={handleWithdraw}
                className="w-full"
                data-testid="button-withdraw"
              >
                <ArrowUpRight className="h-4 w-4 mr-2" />
                Withdraw
              </Button>
            </div>
          ) : (
            <div className="rounded-md bg-amber-500/10 p-3 text-sm">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
                <p className="text-muted-foreground">
                  Initialize your trading session to enable deposits and withdrawals. 
                  Use the Wallet Settings to complete setup.
                </p>
              </div>
            </div>
          )}
        </Card>

        <Button
          variant="outline"
          onClick={handleAddFunds}
          className="w-full h-12"
          data-testid="button-add-external-funds"
        >
          <CreditCard className="h-4 w-4 mr-2" />
          Add External Funds (Card/Bank)
        </Button>
      </div>

      <div className="rounded-md border p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Connected Wallet</span>
          </div>
          <Badge variant="secondary" className="text-xs">
            {walletType === "walletconnect" ? "WalletConnect" : walletType === "phantom" ? "Phantom" : "External"}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-xs bg-muted px-2 py-1.5 rounded-md font-mono truncate">
            {walletAddress}
          </code>
          <Button
            size="icon"
            variant="outline"
            onClick={handleCopyAddress}
            data-testid="button-copy-address"
          >
            {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>
        <a 
          href={polygonscanUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          View on PolygonScan
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      <div className="rounded-md bg-blue-500/10 p-3 text-sm">
        <div className="flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
          <p className="text-muted-foreground">
            Deposit converts USDC from your wallet to USDC.e in your Safe. 
            Withdraw converts Safe USDC.e back to USDC in your wallet.
          </p>
        </div>
      </div>
    </div>
  );

  const renderMagicWalletContent = () => (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="receive" className="gap-1" data-testid="tab-receive">
          <QrCode className="h-4 w-4" />
          Receive
        </TabsTrigger>
        <TabsTrigger value="send" className="gap-1" data-testid="tab-send">
          <Send className="h-4 w-4" />
          {sendLabel}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="receive" className="space-y-4 mt-4">
        <div className="flex flex-col items-center space-y-4">
          <div className="p-4 bg-white rounded-lg">
            <QRCodeSVG 
              value={walletAddress} 
              size={180}
              level="H"
              includeMargin={true}
            />
          </div>

          <div className="w-full space-y-2">
            <Label className="text-muted-foreground text-sm">Your Polygon Address</Label>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-muted px-3 py-2 rounded-md font-mono break-all">
                {walletAddress}
              </code>
              <Button
                size="icon"
                variant="outline"
                onClick={handleCopyAddress}
                data-testid="button-copy-address"
              >
                {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          <a 
            href={polygonscanUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            View on PolygonScan
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>

        <div className="rounded-md bg-blue-500/10 p-3 text-sm">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
            <p className="text-muted-foreground">
              Send <strong>USDC.e (Polygon)</strong> to this address to fund your account. 
              Other tokens or networks will not work.
            </p>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="send" className="space-y-4 mt-4">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-4">
              <CardTitle className="text-base">USDC Available</CardTitle>
              <Badge variant="outline" className="font-mono">
                {isLoadingBalance ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  `${parseFloat(balance).toFixed(2)} USDC`
                )}
              </Badge>
            </div>
            <CardDescription>
              Transfer USDC.e to another Polygon wallet
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="recipient">Recipient Address</Label>
              <Input
                id="recipient"
                placeholder="0x..."
                value={recipientAddress}
                onChange={(e) => setRecipientAddress(e.target.value)}
                className="font-mono text-sm"
                data-testid="input-recipient-address"
              />
              {recipientAddress && !validateAddress(recipientAddress) && (
                <p className="text-xs text-destructive">Invalid address format</p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="amount">Amount (USDC)</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto p-0 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setSendAmount(balance)}
                  data-testid="button-max-amount"
                >
                  Max
                </Button>
              </div>
              <Input
                id="amount"
                type="number"
                placeholder="0.00"
                value={sendAmount}
                onChange={(e) => setSendAmount(e.target.value)}
                min="0"
                step="0.01"
                data-testid="input-send-amount"
              />
            </div>

            {parseFloat(sendAmount) > 0 && (
              <div className="rounded-md bg-muted/50 p-3 space-y-1 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Sending:</span>
                  <span className="font-medium">{parseFloat(sendAmount).toFixed(2)} USDC</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">To:</span>
                  <span className="font-mono text-xs">{recipientAddress ? shortenAddress(recipientAddress) : "-"}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground border-t border-border pt-1 mt-1">
                  <span>Network:</span>
                  <span>Polygon (MATIC gas fees apply)</span>
                </div>
              </div>
            )}

            <Button
              onClick={handleSend}
              disabled={
                isSending || 
                !recipientAddress || 
                !validateAddress(recipientAddress) ||
                !sendAmount ||
                parseFloat(sendAmount) <= 0 ||
                parseFloat(sendAmount) > parseFloat(balance) ||
                parseFloat(maticBalance) < 0.001
              }
              className="w-full"
              data-testid="button-send-usdc"
            >
              {isSending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {sendLabel === "Deposit" ? "Depositing..." : "Sending..."}
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  {sendLabel} USDC
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {parseFloat(maticBalance) < 0.001 ? (
          <div className="rounded-md bg-destructive/10 p-3 text-sm">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
              <div className="text-muted-foreground">
                <p className="font-medium text-destructive">No MATIC for gas fees</p>
                <p className="mt-1">You need MATIC in your wallet to pay for transaction fees. Send MATIC to your wallet address first.</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-md bg-muted/50 p-3 text-sm">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
              <p className="text-muted-foreground">
                Gas balance: {parseFloat(maticBalance).toFixed(4)} MATIC. 
                Transactions are on the Polygon network.
              </p>
            </div>
          </div>
        )}
      </TabsContent>
    </Tabs>
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5" />
              {title || "Wallet Management"}
            </DialogTitle>
            <DialogDescription>
              {walletType === "magic" ? "Magic Email Wallet" : "External Wallet"} on Polygon
            </DialogDescription>
          </DialogHeader>

          {isExternalWallet ? renderEOAWalletContent() : renderMagicWalletContent()}
        </DialogContent>
      </Dialog>

      <SwapModal 
        open={swapOpen} 
        onOpenChange={setSwapOpen} 
        initialDirection={swapDirection} 
      />
      <MeldFundingModal 
        open={meldOpen} 
        onOpenChange={setMeldOpen} 
      />
    </>
  );
}
