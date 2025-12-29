import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useWallet } from "@/context/WalletContext";
import { 
  checkDepositRequirements, 
  approveUSDCForExchange,
  approveUSDCForNegRiskExchange,
  approveUSDCForCTFContract,
  approveCTFForExchange,
  approveCTFForNegRiskExchange,
  transferUSDCToProxy,
  POLYMARKET_CONTRACTS,
} from "@/lib/polymarketDeposit";
import { 
  checkGaslessAvailable,
  approveUSDCGasless,
  approveCTFGasless,
  isExternalWalletAvailable,
} from "@/lib/polymarketGasless";
import { ethers } from "ethers";
import { Check, Loader2, AlertCircle, ExternalLink, ArrowRight, Wallet, Shield, ChevronRight, Zap, Copy, ArrowDown, DollarSign } from "lucide-react";

interface PolymarketDepositWizardProps {
  open: boolean;
  onClose: () => void;
}

type Step = "check" | "approve_usdc" | "approve_ctf" | "deposit" | "complete" | "error";

interface DepositStatus {
  usdcBalance: string;
  nativeUsdcBalance: string;
  ctfExchangeAllowance: string;
  negRiskExchangeAllowance: string;
  ctfContractAllowance: string;
  ctfApprovedForExchange: boolean;
  ctfApprovedForNegRisk: boolean;
  proxyAddress: string | null;
  proxyBalance: string | null;
  needsApproval: boolean;
  needsCTFApproval: boolean;
  needsDeposit: boolean;
  needsSwap: boolean;
}

export function PolymarketDepositWizard({ open, onClose }: PolymarketDepositWizardProps) {
  const { walletAddress, walletType, signer, provider } = useWallet();
  const [step, setStep] = useState<Step>("check");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [depositStatus, setDepositStatus] = useState<DepositStatus | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [relayerAvailable, setRelayerAvailable] = useState(false);
  const [usingRelayer, setUsingRelayer] = useState(false);
  const [depositAmount, setDepositAmount] = useState<string>("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open && walletAddress) {
      checkStatus();
      checkGaslessAvailable().then(setRelayerAvailable);
    }
  }, [open, walletAddress]);

  const checkStatus = async () => {
    if (!walletAddress || !provider) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const isMagic = walletType === "magic";
      
      const rawStatus = await checkDepositRequirements(provider, walletAddress, isMagic);
      
      // For Magic wallets, check if proxy has low balance and user has USDC to deposit
      const needsDeposit = isMagic && 
        rawStatus.proxyAddress !== null &&
        parseFloat(rawStatus.proxyBalance || "0") < 1 && 
        parseFloat(rawStatus.usdcBalance) >= 1;
      
      // Check if user needs to swap native USDC to USDC.e
      // Only show swap warning when USDC.e is effectively zero but user has native USDC
      const needsSwap = parseFloat(rawStatus.nativeUsdcBalance) >= 1 && 
        parseFloat(rawStatus.usdcBalance) < 0.01;
      
      const status: DepositStatus = {
        ...rawStatus,
        needsDeposit,
        needsSwap,
      };
      setDepositStatus(status);
      
      // Determine which step to show
      if (status.needsApproval) {
        setStep("approve_usdc");
      } else if (status.needsCTFApproval) {
        setStep("approve_ctf");
      } else if (status.needsDeposit) {
        setStep("deposit");
      } else {
        setStep("complete");
      }
    } catch (err) {
      console.error("Failed to check deposit status:", err);
      setError(err instanceof Error ? err.message : "Failed to check status");
      setStep("error");
    } finally {
      setLoading(false);
    }
  };

  const handleApproveUSDC = async (useRelayer: boolean = false) => {
    setLoading(true);
    setError(null);
    setTxHash(null);
    setUsingRelayer(useRelayer);
    
    try {
      if (useRelayer && relayerAvailable) {
        // Use gasless relayer for approvals (client-side signing with remote Builder auth)
        const result = await approveUSDCGasless();
        
        if (!result.success) {
          throw new Error(result.error || "Gasless approval failed");
        }
        
        setTxHash(result.transactionHash || null);
      } else {
        // Use direct wallet signing (user pays gas)
        if (!signer) {
          throw new Error("No signer available");
        }
        
        // Approve CTF Exchange
        const result1 = await approveUSDCForExchange(signer);
        if (!result1.success) {
          throw new Error(result1.error || "Failed to approve USDC for CTF Exchange");
        }
        
        // Approve NegRisk CTF Exchange
        const result2 = await approveUSDCForNegRiskExchange(signer);
        if (!result2.success) {
          throw new Error(result2.error || "Failed to approve USDC for NegRisk Exchange");
        }
        
        // Approve CTF Contract (required for splitting positions)
        const result3 = await approveUSDCForCTFContract(signer);
        if (!result3.success) {
          throw new Error(result3.error || "Failed to approve USDC for CTF Contract");
        }
        
        setTxHash(result3.txHash || result2.txHash || result1.txHash || null);
      }
      
      // Re-check status to determine next step
      if (!walletAddress || !provider) return;
      const isMagic = walletType === "magic";
      const updatedStatus = await checkDepositRequirements(provider, walletAddress, isMagic);
      const needsDeposit = isMagic && 
        updatedStatus.proxyAddress !== null &&
        parseFloat(updatedStatus.proxyBalance || "0") < 1 && 
        parseFloat(updatedStatus.usdcBalance) >= 1;
      const needsSwap = parseFloat(updatedStatus.nativeUsdcBalance) >= 1 && 
        parseFloat(updatedStatus.usdcBalance) < 0.01;
      
      setDepositStatus({
        ...updatedStatus,
        needsDeposit,
        needsSwap,
      });
      
      if (updatedStatus.needsCTFApproval) {
        setStep("approve_ctf");
      } else if (needsDeposit) {
        setStep("deposit");
      } else {
        setStep("complete");
      }
    } catch (err) {
      console.error("USDC approval failed:", err);
      setError(err instanceof Error ? err.message : "Approval failed");
    } finally {
      setLoading(false);
      setUsingRelayer(false);
    }
  };

  const handleApproveCTF = async (useRelayer: boolean = false) => {
    setLoading(true);
    setError(null);
    setTxHash(null);
    setUsingRelayer(useRelayer);
    
    try {
      if (useRelayer && relayerAvailable) {
        // Use gasless relayer for approvals (client-side signing with remote Builder auth)
        const result = await approveCTFGasless();
        
        if (!result.success) {
          throw new Error(result.error || "Gasless approval failed");
        }
        
        setTxHash(result.transactionHash || null);
      } else {
        // Use direct wallet signing (user pays gas)
        if (!signer) {
          throw new Error("No signer available");
        }
        
        // Approve CTF for CTF Exchange
        const result1 = await approveCTFForExchange(signer);
        if (!result1.success) {
          throw new Error(result1.error || "Failed to approve CTF for Exchange");
        }
        
        // Approve CTF for NegRisk Exchange
        const result2 = await approveCTFForNegRiskExchange(signer);
        if (!result2.success) {
          throw new Error(result2.error || "Failed to approve CTF for NegRisk Exchange");
        }
        
        setTxHash(result2.txHash || result1.txHash || null);
      }
      
      // Re-check status to determine next step
      if (!walletAddress || !provider) return;
      const isMagic = walletType === "magic";
      const updatedStatus = await checkDepositRequirements(provider, walletAddress, isMagic);
      const needsDeposit = isMagic && 
        updatedStatus.proxyAddress !== null &&
        parseFloat(updatedStatus.proxyBalance || "0") < 1 && 
        parseFloat(updatedStatus.usdcBalance) >= 1;
      const needsSwap = parseFloat(updatedStatus.nativeUsdcBalance) >= 1 && 
        parseFloat(updatedStatus.usdcBalance) < 0.01;
      
      setDepositStatus({
        ...updatedStatus,
        needsDeposit,
        needsSwap,
      });
      
      if (needsDeposit) {
        setStep("deposit");
      } else {
        setStep("complete");
      }
    } catch (err) {
      console.error("CTF approval failed:", err);
      setError(err instanceof Error ? err.message : "Approval failed");
    } finally {
      setLoading(false);
      setUsingRelayer(false);
    }
  };

  const handleDeposit = async () => {
    if (!depositStatus?.proxyAddress || !depositAmount) return;
    
    setLoading(true);
    setError(null);
    setTxHash(null);
    
    try {
      const amount = parseFloat(depositAmount);
      if (isNaN(amount) || amount <= 0) {
        throw new Error("Please enter a valid amount");
      }
      
      if (amount > parseFloat(depositStatus.usdcBalance)) {
        throw new Error("Insufficient balance");
      }
      
      // Use direct wallet signing for deposits
      if (!signer) {
        throw new Error("No signer available");
      }
      const result = await transferUSDCToProxy(signer, depositStatus.proxyAddress, depositAmount);
      
      if (!result.success) {
        throw new Error(result.error || "Transfer failed");
      }
      
      setTxHash(result.txHash || null);
      
      // Refresh status - let checkStatus determine the next step based on updated balances
      await checkStatus();
    } catch (err) {
      console.error("Deposit failed:", err);
      setError(err instanceof Error ? err.message : "Deposit failed");
    } finally {
      setLoading(false);
    }
  };

  const handleCopyAddress = () => {
    if (depositStatus?.proxyAddress) {
      navigator.clipboard.writeText(depositStatus.proxyAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleSetMaxAmount = () => {
    if (depositStatus?.usdcBalance) {
      setDepositAmount(depositStatus.usdcBalance);
    }
  };

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const renderStep = () => {
    if (loading && step === "check") {
      return (
        <div className="flex flex-col items-center justify-center py-8 gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Checking your wallet status...</p>
        </div>
      );
    }

    switch (step) {
      case "check":
        return (
          <div className="space-y-4">
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <Wallet className="h-5 w-5 text-muted-foreground" />
                <div className="flex-1">
                  <p className="text-sm font-medium">Wallet</p>
                  <p className="text-xs text-muted-foreground font-mono">
                    {walletAddress ? formatAddress(walletAddress) : "Not connected"}
                  </p>
                </div>
                {walletType && (
                  <Badge variant="secondary" className="capitalize">
                    {walletType}
                  </Badge>
                )}
              </div>
            </Card>

            {depositStatus && (
              <Card className="p-4 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm">USDC.e Balance (for trading)</span>
                  <span className="font-medium">${parseFloat(depositStatus.usdcBalance).toFixed(2)}</span>
                </div>
                {parseFloat(depositStatus.nativeUsdcBalance) > 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Native USDC Balance</span>
                    <span className="font-medium text-muted-foreground">${parseFloat(depositStatus.nativeUsdcBalance).toFixed(2)}</span>
                  </div>
                )}
                {depositStatus.needsSwap && (
                  <div className="p-3 bg-amber-500/10 rounded-lg space-y-2">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-medium">Swap Required</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Polymarket uses USDC.e (bridged USDC). You have ${parseFloat(depositStatus.nativeUsdcBalance).toFixed(2)} native USDC that needs to be swapped.
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => window.open(`https://app.uniswap.org/swap?chain=polygon&inputCurrency=0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359&outputCurrency=0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174`, '_blank')}
                      data-testid="button-swap-usdc"
                    >
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Swap on Uniswap
                    </Button>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-sm">USDC Approved</span>
                  {!depositStatus.needsApproval ? (
                    <Badge variant="default" className="bg-green-600">
                      <Check className="h-3 w-3 mr-1" /> Yes
                    </Badge>
                  ) : (
                    <Badge variant="destructive">No</Badge>
                  )}
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm">CTF Tokens Approved</span>
                  {!depositStatus.needsCTFApproval ? (
                    <Badge variant="default" className="bg-green-600">
                      <Check className="h-3 w-3 mr-1" /> Yes
                    </Badge>
                  ) : (
                    <Badge variant="destructive">No</Badge>
                  )}
                </div>
              </Card>
            )}

            <Button 
              onClick={checkStatus} 
              disabled={loading}
              className="w-full"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Checking...
                </>
              ) : (
                "Refresh Status"
              )}
            </Button>
          </div>
        );

      case "approve_usdc":
        return (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 bg-muted rounded-lg">
              <Shield className="h-5 w-5 text-primary mt-0.5" />
              <div>
                <p className="font-medium text-sm">Approve USDC Spending</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Allow Polymarket&apos;s exchange contracts to access your USDC for trading.
                  This is a one-time approval.
                </p>
              </div>
            </div>

            <Card className="p-4">
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">CTF Exchange</span>
                  <span className="font-mono">{formatAddress(POLYMARKET_CONTRACTS.CTF_EXCHANGE)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">NegRisk Exchange</span>
                  <span className="font-mono">{formatAddress(POLYMARKET_CONTRACTS.NEG_RISK_CTF_EXCHANGE)}</span>
                </div>
              </div>
            </Card>

            {error && (
              <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                <AlertCircle className="h-4 w-4 text-destructive" />
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            {relayerAvailable && (
              <div className="flex items-start gap-3 p-3 bg-primary/10 rounded-lg">
                <Zap className="h-4 w-4 text-primary mt-0.5" />
                <div className="text-xs">
                  <span className="font-medium">Gasless available!</span>
                  <span className="text-muted-foreground ml-1">Polymarket pays the gas fee.</span>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              {relayerAvailable && (
                <Button 
                  onClick={() => handleApproveUSDC(true)} 
                  disabled={loading}
                  className="flex-1"
                  data-testid="button-approve-usdc-gasless"
                >
                  {loading && usingRelayer ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Approving...
                    </>
                  ) : (
                    <>
                      <Zap className="h-4 w-4 mr-2" />
                      Gasless Approve
                    </>
                  )}
                </Button>
              )}
              <Button 
                onClick={() => handleApproveUSDC(false)} 
                disabled={loading}
                variant={relayerAvailable ? "outline" : "default"}
                className={relayerAvailable ? "" : "w-full"}
                data-testid="button-approve-usdc"
              >
                {loading && !usingRelayer ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Approving...
                  </>
                ) : (
                  <>
                    {relayerAvailable ? "Pay Gas" : "Approve USDC"}
                    <ChevronRight className="h-4 w-4 ml-2" />
                  </>
                )}
              </Button>
            </div>
          </div>
        );

      case "approve_ctf":
        return (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 bg-muted rounded-lg">
              <Shield className="h-5 w-5 text-primary mt-0.5" />
              <div>
                <p className="font-medium text-sm">Approve Conditional Tokens</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Allow Polymarket to transfer your prediction market tokens.
                  Required for selling positions.
                </p>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                <AlertCircle className="h-4 w-4 text-destructive" />
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            {relayerAvailable && (
              <div className="flex items-start gap-3 p-3 bg-primary/10 rounded-lg">
                <Zap className="h-4 w-4 text-primary mt-0.5" />
                <div className="text-xs">
                  <span className="font-medium">Gasless available!</span>
                  <span className="text-muted-foreground ml-1">Polymarket pays the gas fee.</span>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              {relayerAvailable && (
                <Button 
                  onClick={() => handleApproveCTF(true)} 
                  disabled={loading}
                  className="flex-1"
                  data-testid="button-approve-ctf-gasless"
                >
                  {loading && usingRelayer ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Approving...
                    </>
                  ) : (
                    <>
                      <Zap className="h-4 w-4 mr-2" />
                      Gasless Approve
                    </>
                  )}
                </Button>
              )}
              <Button 
                onClick={() => handleApproveCTF(false)} 
                disabled={loading}
                variant={relayerAvailable ? "outline" : "default"}
                className={relayerAvailable ? "" : "w-full"}
                data-testid="button-approve-ctf"
              >
                {loading && !usingRelayer ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Approving...
                  </>
                ) : (
                  <>
                    {relayerAvailable ? "Pay Gas" : "Approve CTF Tokens"}
                    <ChevronRight className="h-4 w-4 ml-2" />
                  </>
                )}
              </Button>
            </div>
          </div>
        );

      case "deposit":
        return (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 bg-muted rounded-lg">
              <DollarSign className="h-5 w-5 text-primary mt-0.5" />
              <div>
                <p className="font-medium text-sm">Fund Your Trading Wallet</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Transfer USDC from your wallet to your Polymarket trading address.
                  This is where your trading balance lives.
                </p>
              </div>
            </div>

            {depositStatus && depositStatus.proxyAddress && (
              <Card className="p-4 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Your Wallet USDC.e</span>
                  <span className="font-medium">${parseFloat(depositStatus.usdcBalance).toFixed(2)}</span>
                </div>
                {parseFloat(depositStatus.nativeUsdcBalance) > 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Your Wallet Native USDC</span>
                    <span className="font-medium text-muted-foreground">${parseFloat(depositStatus.nativeUsdcBalance).toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Trading Wallet Balance</span>
                  <span className="font-medium">${parseFloat(depositStatus.proxyBalance || "0").toFixed(2)}</span>
                </div>
                <div className="pt-2 border-t">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-muted-foreground">Trading Wallet Address</span>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-6 px-2 text-xs"
                      onClick={handleCopyAddress}
                      data-testid="button-copy-proxy-address"
                    >
                      <span className="font-mono">{formatAddress(depositStatus.proxyAddress)}</span>
                      <Copy className="h-3 w-3 ml-1" />
                      {copied && <span className="ml-1 text-green-500">Copied!</span>}
                    </Button>
                  </div>
                </div>
              </Card>
            )}

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max={depositStatus?.usdcBalance}
                    placeholder="0.00"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    className="pl-8"
                    data-testid="input-deposit-amount"
                  />
                </div>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={handleSetMaxAmount}
                  data-testid="button-max-amount"
                >
                  Max
                </Button>
              </div>
              {depositStatus && (
                <p className="text-xs text-muted-foreground">
                  Available: ${parseFloat(depositStatus.usdcBalance).toFixed(2)} USDC
                </p>
              )}
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                <AlertCircle className="h-4 w-4 text-destructive" />
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            <div className="flex gap-2">
              <Button 
                onClick={() => handleDeposit()} 
                disabled={loading || !depositAmount || parseFloat(depositAmount) <= 0}
                className="flex-1"
                data-testid="button-deposit-usdc"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Transferring...
                  </>
                ) : (
                  <>
                    <ArrowDown className="h-4 w-4 mr-2" />
                    Deposit
                  </>
                )}
              </Button>
              <Button 
                variant="ghost"
                onClick={() => setStep("complete")}
                data-testid="button-skip-deposit"
              >
                Skip
              </Button>
            </div>
          </div>
        );

      case "complete":
        return (
          <div className="space-y-4">
            <div className="flex flex-col items-center justify-center py-6 gap-4">
              <div className="h-12 w-12 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center">
                <Check className="h-6 w-6 text-green-600 dark:text-green-400" />
              </div>
              <div className="text-center">
                <p className="font-medium">Setup Complete!</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Your wallet is ready for Polymarket trading.
                </p>
              </div>
            </div>

            {depositStatus && (
              <Card className="p-4 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm">USDC.e in Wallet (for trading)</span>
                  <span className="font-medium">${parseFloat(depositStatus.usdcBalance).toFixed(2)}</span>
                </div>
                {parseFloat(depositStatus.nativeUsdcBalance) > 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Native USDC in Wallet</span>
                    <span className="font-medium text-muted-foreground">${parseFloat(depositStatus.nativeUsdcBalance).toFixed(2)}</span>
                  </div>
                )}
                {walletType === "magic" && depositStatus.proxyAddress && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm">USDC.e in Trading Wallet</span>
                    <span className="font-medium text-green-600 dark:text-green-400">
                      ${parseFloat(depositStatus.proxyBalance || "0").toFixed(2)}
                    </span>
                  </div>
                )}
              </Card>
            )}

            {depositStatus && depositStatus.needsSwap && (
              <div className="flex items-start gap-3 p-4 bg-amber-500/10 rounded-lg">
                <AlertCircle className="h-5 w-5 text-amber-500 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <p className="font-medium text-sm">Swap Required</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Polymarket uses USDC.e (bridged USDC). You have ${parseFloat(depositStatus.nativeUsdcBalance).toFixed(2)} native USDC that needs to be swapped before trading.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={() => window.open(`https://app.uniswap.org/swap?chain=polygon&inputCurrency=0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359&outputCurrency=0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174`, '_blank')}
                    data-testid="button-swap-usdc-complete"
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Swap on Uniswap
                  </Button>
                </div>
              </div>
            )}

            {depositStatus && walletType === "magic" && parseFloat(depositStatus.proxyBalance || "0") < 1 && parseFloat(depositStatus.usdcBalance) >= 1 && (
              <div className="flex items-start gap-3 p-4 bg-amber-500/10 rounded-lg">
                <AlertCircle className="h-5 w-5 text-amber-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium text-sm">Your trading wallet needs funds</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    You have ${parseFloat(depositStatus.usdcBalance).toFixed(2)} USDC.e available. 
                    Consider depositing to start trading.
                  </p>
                  <button
                    className="text-xs text-primary hover:underline mt-2"
                    onClick={() => setStep("deposit")}
                    data-testid="button-go-to-deposit"
                  >
                    Deposit now
                  </button>
                </div>
              </div>
            )}

            {depositStatus && parseFloat(depositStatus.usdcBalance) < 1 && parseFloat(depositStatus.proxyBalance || "0") < 1 && !depositStatus.needsSwap && (
              <div className="flex items-start gap-3 p-4 bg-amber-500/10 rounded-lg">
                <AlertCircle className="h-5 w-5 text-amber-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium text-sm">Add USDC.e to Trade</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    You need USDC.e (bridged USDC) on Polygon to place orders. Visit Polymarket to deposit funds, 
                    or transfer USDC.e directly to your Polygon wallet.
                  </p>
                  <a
                    href="https://polymarket.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-2"
                    data-testid="link-polymarket-deposit"
                  >
                    Deposit on Polymarket
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
            )}

            {txHash && (
              <a
                href={`https://polygonscan.com/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 text-sm text-primary hover:underline"
                data-testid="link-view-transaction"
              >
                View transaction
                <ExternalLink className="h-3 w-3" />
              </a>
            )}

            <Button onClick={onClose} className="w-full" data-testid="button-done-deposit">
              Done
            </Button>
          </div>
        );

      case "error":
        return (
          <div className="space-y-4">
            <div className="flex flex-col items-center justify-center py-6 gap-4">
              <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
                <AlertCircle className="h-6 w-6 text-destructive" />
              </div>
              <div className="text-center">
                <p className="font-medium">Something went wrong</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {error || "An unexpected error occurred"}
                </p>
              </div>
            </div>

            <Button onClick={checkStatus} variant="outline" className="w-full">
              Try Again
            </Button>
          </div>
        );
    }
  };

  const getStepNumber = () => {
    switch (step) {
      case "check": return 1;
      case "approve_usdc": return 2;
      case "approve_ctf": return 3;
      case "deposit": return 4;
      case "complete": return 5;
      default: return 1;
    }
  };

  // Determine which steps are visible based on wallet type
  const isMagicWallet = walletType === "magic";
  const totalSteps = isMagicWallet ? 5 : 4; // External wallets don't need deposit step

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Setup Polymarket Trading</DialogTitle>
          <DialogDescription>
            {isMagicWallet 
              ? "Approve and fund your wallet to trade on Polymarket."
              : "Approve your wallet to trade on Polymarket prediction markets."
            }
          </DialogDescription>
        </DialogHeader>

        {/* Progress indicator */}
        {step !== "error" && (
          <div className="flex items-center justify-center gap-2 py-2">
            {Array.from({ length: totalSteps }, (_, i) => i + 1).map((num) => (
              <div
                key={num}
                className={`h-2 w-8 rounded-full transition-colors ${
                  num <= getStepNumber() 
                    ? "bg-primary" 
                    : "bg-muted"
                }`}
              />
            ))}
          </div>
        )}

        {renderStep()}
      </DialogContent>
    </Dialog>
  );
}
