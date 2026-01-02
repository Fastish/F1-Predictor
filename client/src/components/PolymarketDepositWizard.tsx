import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useWallet } from "@/context/WalletContext";
import { useWalletClient } from "wagmi";
import { 
  checkDepositRequirements, 
  approveUSDCForExchange,
  approveUSDCForNegRiskExchange,
  approveUSDCForCTFContract,
  approveCTFForExchange,
  approveCTFForNegRiskExchange,
  transferUSDCToProxy,
  revokeAllUSDCApprovals,
  revokeAllCTFApprovals,
  POLYMARKET_CONTRACTS,
} from "@/lib/polymarketDeposit";
import { 
  checkGaslessAvailable,
  approveUSDCGasless,
  approveCTFGasless,
  isExternalWalletAvailable,
  setExternalProviderForGasless,
} from "@/lib/polymarketGasless";
import { deriveSafe } from "@polymarket/builder-relayer-client/dist/builder/derive";
import { getContractConfig } from "@polymarket/builder-relayer-client/dist/config";
import { ethers } from "ethers";

import { Check, Loader2, AlertCircle, ExternalLink, ArrowRight, Wallet, Shield, ChevronRight, Zap, Copy, ArrowDown, DollarSign, RotateCcw } from "lucide-react";

const POLYGON_CHAIN_ID = 137;

interface PolymarketDepositWizardProps {
  open: boolean;
  onClose: () => void;
}

type Step = "check" | "approve_usdc" | "approve_ctf" | "deposit" | "complete" | "revoke" | "error";

interface DepositStatus {
  usdcBalance: string;
  nativeUsdcBalance: string;
  ctfExchangeAllowance: string;
  negRiskExchangeAllowance: string;
  ctfContractAllowance: string;
  negRiskAdapterAllowance?: string;
  ctfApprovedForExchange: boolean;
  ctfApprovedForNegRisk: boolean;
  proxyAddress: string | null;
  proxyBalance: string | null;
  safeAddress: string | null;
  safeBalance: string | null;
  needsApproval: boolean;
  needsCTFApproval: boolean;
  needsDeposit: boolean;
  needsSwap: boolean;
}

export function PolymarketDepositWizard({ open, onClose }: PolymarketDepositWizardProps) {
  const { walletAddress, walletType, signer, provider } = useWallet();
  const { data: walletClient } = useWalletClient();
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
      
      // For WalletConnect users, set the external provider so gasless can use it
      // Note: WalletContext also sets this, but we reinforce it here for reliability
      const isWalletConnect = walletType === "walletconnect";
      if (isWalletConnect && walletClient?.transport) {
        console.log("[DepositWizard] Reinforcing external provider for gasless (WalletConnect)");
        setExternalProviderForGasless(walletClient.transport);
      }
      
      // Check if gasless is available (pass true for WalletConnect since we have a provider)
      checkGaslessAvailable(isWalletConnect && !!walletClient?.transport).then(setRelayerAvailable);
    }
    
    // NOTE: We intentionally do NOT clear the external provider on unmount!
    // The provider lifecycle is managed by WalletContext (set on connect, cleared on disconnect).
    // Clearing it here would break order placement after the wizard closes.
  }, [open, walletAddress, walletType, walletClient]);

  // Helper to derive Safe address deterministically (no signer needed)
  const deriveSafeAddressFromEOA = (eoaAddress: string): string | null => {
    try {
      const config = getContractConfig(POLYGON_CHAIN_ID);
      return deriveSafe(eoaAddress, config.SafeContracts.SafeFactory);
    } catch (e) {
      console.warn("Failed to derive Safe address:", e);
      return null;
    }
  };

  const checkStatus = async () => {
    if (!walletAddress || !provider) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const isMagic = walletType === "magic";
      
      // For external wallets, check BOTH EOA and Safe addresses
      // User might have approved via direct EOA tx or via gasless (Safe)
      // Consider approved if EITHER address has the approvals
      let rawStatus = await checkDepositRequirements(provider, walletAddress, isMagic);
      console.log(`[DepositWizard] EOA (${walletAddress}) status:`, JSON.stringify({
        needsApproval: rawStatus.needsApproval,
        needsCTFApproval: rawStatus.needsCTFApproval,
        ctfExchangeAllowance: rawStatus.ctfExchangeAllowance,
        negRiskExchangeAllowance: rawStatus.negRiskExchangeAllowance,
        ctfContractAllowance: rawStatus.ctfContractAllowance,
      }, null, 2));
      
      let safeAddr: string | null = null;
      let safeBalance: string | null = null;
      
      if (walletType === "external" || walletType === "walletconnect" || walletType === "phantom") {
        // Derive Safe address deterministically from EOA (no signer needed)
        safeAddr = deriveSafeAddressFromEOA(walletAddress);
        if (safeAddr) {
          console.log(`[DepositWizard] Checking Safe address: ${safeAddr}`);
          try {
            // Fetch Safe status including balance and approvals
            const safeStatus = await checkDepositRequirements(provider, safeAddr, false);
            console.log(`[DepositWizard] Safe status:`, JSON.stringify({
              usdcBalance: safeStatus.usdcBalance,
              needsApproval: safeStatus.needsApproval,
              needsCTFApproval: safeStatus.needsCTFApproval,
              ctfExchangeAllowance: safeStatus.ctfExchangeAllowance,
              negRiskExchangeAllowance: safeStatus.negRiskExchangeAllowance,
              ctfContractAllowance: safeStatus.ctfContractAllowance,
              ctfApprovedForExchange: safeStatus.ctfApprovedForExchange,
              ctfApprovedForNegRisk: safeStatus.ctfApprovedForNegRisk,
            }, null, 2));
            
            // Use the Safe's balance from checkDepositRequirements
            // This is the Trading Balance - the balance in the Safe wallet
            safeBalance = safeStatus.usdcBalance;
            console.log(`[DepositWizard] Safe balance (Trading Balance): ${safeBalance} USDC.e`);
            console.log(`[DepositWizard] EOA balance (In Wallet): ${rawStatus.usdcBalance} USDC.e`);
            
            // If Safe has approvals but EOA doesn't, use Safe's approval status
            // This handles the case where user previously did gasless approvals
            if (!safeStatus.needsApproval && rawStatus.needsApproval) {
              console.log("[DepositWizard] Using Safe USDC approval status (gasless approvals detected)");
              rawStatus = {
                ...rawStatus,
                needsApproval: false,
                ctfExchangeAllowance: safeStatus.ctfExchangeAllowance,
                negRiskExchangeAllowance: safeStatus.negRiskExchangeAllowance,
                ctfContractAllowance: safeStatus.ctfContractAllowance,
              };
            }
            if (!safeStatus.needsCTFApproval && rawStatus.needsCTFApproval) {
              console.log("[DepositWizard] Using Safe CTF approval status (gasless approvals detected)");
              rawStatus = {
                ...rawStatus,
                needsCTFApproval: false,
                ctfApprovedForExchange: safeStatus.ctfApprovedForExchange,
                ctfApprovedForNegRisk: safeStatus.ctfApprovedForNegRisk,
              };
            }
            
            console.log(`[DepositWizard] Final merged status:`, {
              needsApproval: rawStatus.needsApproval,
              needsCTFApproval: rawStatus.needsCTFApproval,
            });
          } catch (e) {
            console.warn("[DepositWizard] Failed to check Safe address:", e);
          }
        } else {
          console.warn("[DepositWizard] Could not derive Safe address from EOA");
        }
      }
      
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
        safeAddress: safeAddr,
        safeBalance,
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
    console.log("[DepositWizard] ========== handleApproveUSDC START ==========");
    console.log("[DepositWizard] useRelayer:", useRelayer, "relayerAvailable:", relayerAvailable);
    console.log("[DepositWizard] signer:", signer ? "available" : "NOT AVAILABLE", "walletType:", walletType);
    
    setLoading(true);
    setError(null);
    setTxHash(null);
    setUsingRelayer(useRelayer);
    
    try {
      if (useRelayer && relayerAvailable) {
        // Use gasless relayer for approvals (client-side signing with remote Builder auth)
        console.log("[DepositWizard] Using gasless relayer for USDC approval");
        const result = await approveUSDCGasless();
        console.log("[DepositWizard] Gasless USDC approval result:", result);
        
        if (!result.success) {
          throw new Error(result.error || "Gasless approval failed");
        }
        
        setTxHash(result.transactionHash || null);
      } else {
        // Use direct wallet signing (user pays gas)
        if (!signer) {
          console.error("[DepositWizard] No signer available for USDC approval!");
          setError("No signer available. Please reconnect your wallet and try again.");
          setLoading(false);
          return;
        }
        
        try {
          const signerAddr = await signer.getAddress();
          console.log("[DepositWizard] Signer address resolved:", signerAddr);
        } catch (e) {
          console.error("[DepositWizard] Failed to get signer address:", e);
          setError("Failed to access wallet. Please reconnect and try again.");
          setLoading(false);
          return;
        }
        
        // Check which approvals are already done to skip them
        const ctfDone = depositStatus && parseFloat(depositStatus.ctfExchangeAllowance) >= 1;
        const negRiskDone = depositStatus && parseFloat(depositStatus.negRiskExchangeAllowance) >= 1;
        const ctfContractDone = depositStatus && parseFloat(depositStatus.ctfContractAllowance) >= 1;
        
        let lastTxHash: string | null = null;
        
        // Approve CTF Exchange (if not already done)
        if (!ctfDone) {
          console.log("[DepositWizard] Calling approveUSDCForExchange...");
          const result1 = await approveUSDCForExchange(signer);
          console.log("[DepositWizard] CTF Exchange approval result:", result1);
          if (!result1.success) {
            throw new Error(result1.error || "Failed to approve USDC for CTF Exchange");
          }
          lastTxHash = result1.txHash || null;
        } else {
          console.log("[DepositWizard] CTF Exchange already approved, skipping");
        }
        
        // Approve NegRisk CTF Exchange (if not already done)
        if (!negRiskDone) {
          console.log("[DepositWizard] Calling approveUSDCForNegRiskExchange...");
          const result2 = await approveUSDCForNegRiskExchange(signer);
          console.log("[DepositWizard] NegRisk Exchange approval result:", result2);
          if (!result2.success) {
            throw new Error(result2.error || "Failed to approve USDC for NegRisk Exchange");
          }
          lastTxHash = result2.txHash || lastTxHash;
        } else {
          console.log("[DepositWizard] NegRisk Exchange already approved, skipping");
        }
        
        // Approve CTF Contract (if not already done)
        if (!ctfContractDone) {
          console.log("[DepositWizard] Calling approveUSDCForCTFContract...");
          const result3 = await approveUSDCForCTFContract(signer);
          console.log("[DepositWizard] CTF Contract approval result:", result3);
          if (!result3.success) {
            throw new Error(result3.error || "Failed to approve USDC for CTF Contract");
          }
          lastTxHash = result3.txHash || lastTxHash;
        } else {
          console.log("[DepositWizard] CTF Contract already approved, skipping");
        }
        
        setTxHash(lastTxHash);
      }
      
      // Re-check status to determine next step
      if (!walletAddress || !provider) return;
      const isMagic = walletType === "magic";
      
      // For external wallets using gasless, check the Safe address (where approvals are done)
      // For Magic wallets or non-gasless, check the EOA address
      // Use deterministic derivation (no signer needed) for reliable Safe address lookup
      let addressToCheck = walletAddress;
      if (useRelayer && (walletType === "external" || walletType === "walletconnect" || walletType === "phantom")) {
        const derivedSafe = deriveSafeAddressFromEOA(walletAddress);
        if (derivedSafe) {
          addressToCheck = derivedSafe;
          console.log(`Checking approvals on derived Safe address: ${addressToCheck}`);
        }
      }
      
      const updatedStatus = await checkDepositRequirements(provider, addressToCheck, isMagic);
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
      
      // For external wallets using gasless, check the Safe address (where approvals are done)
      // For Magic wallets or non-gasless, check the EOA address
      // Use deterministic derivation (no signer needed) for reliable Safe address lookup
      let addressToCheck = walletAddress;
      if (useRelayer && (walletType === "external" || walletType === "walletconnect" || walletType === "phantom")) {
        const derivedSafe = deriveSafeAddressFromEOA(walletAddress);
        if (derivedSafe) {
          addressToCheck = derivedSafe;
          console.log(`Checking CTF approvals on derived Safe address: ${addressToCheck}`);
        }
      }
      
      const updatedStatus = await checkDepositRequirements(provider, addressToCheck, isMagic);
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

  const handleRevoke = async () => {
    setLoading(true);
    setError(null);
    setTxHash(null);
    
    try {
      if (!signer) {
        throw new Error("No signer available");
      }
      
      const result1 = await revokeAllUSDCApprovals(signer);
      if (!result1.success) {
        throw new Error(result1.error || "Failed to revoke USDC approvals");
      }
      
      const result2 = await revokeAllCTFApprovals(signer);
      if (!result2.success) {
        throw new Error(result2.error || "Failed to revoke CTF approvals");
      }
      
      setTxHash(result2.txHash || result1.txHash || null);
      
      await checkStatus();
    } catch (err) {
      console.error("Revoke failed:", err);
      setError(err instanceof Error ? err.message : "Revoke failed");
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
        // Calculate which specific approvals are still needed
        const ctfExchangeApproved = depositStatus && parseFloat(depositStatus.ctfExchangeAllowance) >= 1;
        const negRiskApproved = depositStatus && parseFloat(depositStatus.negRiskExchangeAllowance) >= 1;
        const ctfContractApproved = depositStatus && parseFloat(depositStatus.ctfContractAllowance) >= 1;
        const negRiskAdapterApproved = depositStatus && depositStatus.negRiskAdapterAllowance && parseFloat(depositStatus.negRiskAdapterAllowance) >= 1;
        const approvalsRemaining = [
          !ctfExchangeApproved && "CTF Exchange",
          !negRiskApproved && "NegRisk Exchange", 
          !ctfContractApproved && "CTF Contract",
          !negRiskAdapterApproved && "NegRisk Adapter"
        ].filter(Boolean);
        
        return (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 bg-muted rounded-lg">
              <Shield className="h-5 w-5 text-primary mt-0.5" />
              <div>
                <p className="font-medium text-sm">Approve USDC Spending</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Allow Polymarket&apos;s exchange contracts to access your USDC for trading.
                  This is a one-time approval per contract.
                </p>
              </div>
            </div>

            <Card className="p-4">
              <div className="space-y-2 text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">CTF Exchange</span>
                  {ctfExchangeApproved ? (
                    <Badge variant="default" className="bg-green-600 text-xs"><Check className="h-3 w-3 mr-1" />Done</Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs">Pending</Badge>
                  )}
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">NegRisk Exchange</span>
                  {negRiskApproved ? (
                    <Badge variant="default" className="bg-green-600 text-xs"><Check className="h-3 w-3 mr-1" />Done</Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs">Pending</Badge>
                  )}
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">CTF Contract</span>
                  {ctfContractApproved ? (
                    <Badge variant="default" className="bg-green-600 text-xs"><Check className="h-3 w-3 mr-1" />Done</Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs">Pending</Badge>
                  )}
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">NegRisk Adapter</span>
                  {negRiskAdapterApproved ? (
                    <Badge variant="default" className="bg-green-600 text-xs"><Check className="h-3 w-3 mr-1" />Done</Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs">Pending</Badge>
                  )}
                </div>
              </div>
            </Card>
            
            {approvalsRemaining.length > 0 && approvalsRemaining.length < 4 && (
              <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5" />
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  {approvalsRemaining.length} approval(s) remaining: {approvalsRemaining.join(", ")}
                </p>
              </div>
            )}

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
            
            <div className="flex gap-2 pt-2 border-t">
              <Button 
                onClick={checkStatus} 
                disabled={loading}
                variant="ghost"
                size="sm"
                className="flex-1"
                data-testid="button-recheck-approvals"
              >
                <RotateCcw className="h-3 w-3 mr-2" />
                Re-check Status
              </Button>
              <Button 
                onClick={() => {
                  console.log("[DepositWizard] User skipping USDC approval step");
                  if (depositStatus?.needsCTFApproval) {
                    setStep("approve_ctf");
                  } else {
                    setStep("complete");
                  }
                }} 
                disabled={loading}
                variant="ghost"
                size="sm"
                className="flex-1"
                data-testid="button-skip-usdc-approval"
              >
                Skip (Already Approved)
                <ChevronRight className="h-3 w-3 ml-1" />
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
            
            <div className="flex gap-2 pt-2 border-t">
              <Button 
                onClick={checkStatus} 
                disabled={loading}
                variant="ghost"
                size="sm"
                className="flex-1"
                data-testid="button-recheck-ctf-approvals"
              >
                <RotateCcw className="h-3 w-3 mr-2" />
                Re-check Status
              </Button>
              <Button 
                onClick={() => {
                  console.log("[DepositWizard] User skipping CTF approval step");
                  setStep("complete");
                }} 
                disabled={loading}
                variant="ghost"
                size="sm"
                className="flex-1"
                data-testid="button-skip-ctf-approval"
              >
                Skip (Already Approved)
                <ChevronRight className="h-3 w-3 ml-1" />
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

            {depositStatus && (walletType === "external" || walletType === "walletconnect" || walletType === "phantom") && (
              <Card className="p-4 space-y-3">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Your Safe Trading Wallet</div>
                {(() => {
                  const safeAddr = deriveSafeAddressFromEOA(walletAddress || "");
                  return safeAddr ? (
                    <>
                      <div className="flex items-center gap-2 bg-muted/50 p-2 rounded-md">
                        <code className="flex-1 text-xs font-mono truncate">{safeAddr}</code>
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="h-7 w-7"
                          onClick={() => {
                            navigator.clipboard.writeText(safeAddr);
                            setCopied(true);
                            setTimeout(() => setCopied(false), 2000);
                          }}
                        >
                          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                      <div className="flex justify-between items-center pt-2 border-t">
                        <span className="text-sm font-medium">Trading Balance</span>
                        <span className="font-bold text-lg tabular-nums">
                          ${parseFloat(depositStatus.safeBalance || "0").toFixed(2)} <span className="text-xs font-normal text-muted-foreground">USDC.e</span>
                        </span>
                      </div>
                    </>
                  ) : null;
                })()}
                <div className="flex justify-between items-center text-muted-foreground">
                  <span className="text-sm">In Your Wallet (EOA)</span>
                  <span className="tabular-nums">${parseFloat(depositStatus.usdcBalance).toFixed(2)}</span>
                </div>
              </Card>
            )}
            {depositStatus && walletType !== "external" && walletType !== "walletconnect" && walletType !== "phantom" && (
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

            {depositStatus && (walletType === "external" || walletType === "walletconnect" || walletType === "phantom") && parseFloat(depositStatus.safeBalance || "0") < 1 && parseFloat(depositStatus.usdcBalance) >= 1 && (
              <div className="flex items-start gap-3 p-4 bg-blue-500/10 rounded-lg">
                <DollarSign className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium text-sm">Fund Your Safe Trading Wallet</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    You have ${parseFloat(depositStatus.usdcBalance).toFixed(2)} USDC.e in your wallet. 
                    To trade, send USDC.e to your Safe address shown above.
                  </p>
                </div>
              </div>
            )}

            {depositStatus && parseFloat(depositStatus.usdcBalance) < 1 && parseFloat(depositStatus.proxyBalance || "0") < 1 && !depositStatus.needsSwap && (
              <div className="flex items-start gap-3 p-4 bg-amber-500/10 rounded-lg">
                <AlertCircle className="h-5 w-5 text-amber-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium text-sm">Add USDC.e to Trade</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {(walletType === "external" || walletType === "walletconnect" || walletType === "phantom")
                      ? "Send USDC.e to your Safe wallet address (shown above) to start trading."
                      : "You need USDC.e (bridged USDC) on Polygon to place orders. Visit Polymarket to deposit funds, or transfer USDC.e directly to your Polygon wallet."
                    }
                  </p>
                  {walletType !== "external" && walletType !== "walletconnect" && walletType !== "phantom" && (
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
                  )}
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

            <div className="flex gap-2">
              <Button onClick={onClose} className="flex-1" data-testid="button-done-deposit">
                Done
              </Button>
              <Button 
                variant="outline" 
                onClick={() => setStep("revoke")}
                data-testid="button-revoke-approvals"
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                Reset
              </Button>
            </div>
          </div>
        );

      case "revoke":
        return (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 bg-amber-500/10 rounded-lg">
              <RotateCcw className="h-5 w-5 text-amber-500 mt-0.5" />
              <div>
                <p className="font-medium text-sm">Revoke All Approvals</p>
                <p className="text-xs text-muted-foreground mt-1">
                  This will revoke all USDC and CTF approvals, allowing you to test the gasless approval flow again.
                  You&apos;ll need to pay gas for 5 transactions.
                </p>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                <AlertCircle className="h-4 w-4 text-destructive" />
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            {txHash && (
              <a
                href={`https://polygonscan.com/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 text-sm text-primary hover:underline"
              >
                View transaction
                <ExternalLink className="h-3 w-3" />
              </a>
            )}

            <div className="flex gap-2">
              <Button 
                variant="outline" 
                onClick={() => setStep("complete")} 
                className="flex-1"
                disabled={loading}
              >
                Cancel
              </Button>
              <Button 
                onClick={handleRevoke} 
                disabled={loading}
                className="flex-1"
                variant="destructive"
                data-testid="button-confirm-revoke"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Revoking...
                  </>
                ) : (
                  "Revoke Approvals"
                )}
              </Button>
            </div>
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
      case "revoke": return 5;
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
