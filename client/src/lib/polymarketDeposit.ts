import { ethers } from "ethers";

// Polygon network chain ID
export const POLYGON_CHAIN_ID = 137;

// Multiple Polygon RPC endpoints with fallback support
// Using more reliable endpoints first
const POLYGON_RPC_ENDPOINTS = [
  "https://polygon-mainnet.public.blastapi.io",
  "https://1rpc.io/matic",
  "https://polygon.drpc.org",
  "https://polygon.llamarpc.com",
  "https://rpc.ankr.com/polygon",
];

// Track current RPC index for rotation on failures
let currentRpcIndex = 0;
let readOnlyProvider: ethers.JsonRpcProvider | null = null;
let providerCreatedAt: number = 0;
const PROVIDER_REFRESH_INTERVAL = 60000; // Refresh provider every 60 seconds to avoid stale connections

export function getReadOnlyPolygonProvider(): ethers.JsonRpcProvider {
  const now = Date.now();
  
  // Recreate provider if it's stale or doesn't exist
  if (!readOnlyProvider || (now - providerCreatedAt) > PROVIDER_REFRESH_INTERVAL) {
    const rpcUrl = POLYGON_RPC_ENDPOINTS[currentRpcIndex];
    console.log(`[Polygon RPC] Creating provider with endpoint: ${rpcUrl}`);
    readOnlyProvider = new ethers.JsonRpcProvider(rpcUrl, POLYGON_CHAIN_ID);
    providerCreatedAt = now;
  }
  return readOnlyProvider;
}

// Rotate to next RPC endpoint on failure
export function rotateRpcEndpoint(): void {
  currentRpcIndex = (currentRpcIndex + 1) % POLYGON_RPC_ENDPOINTS.length;
  readOnlyProvider = null; // Force recreation on next call
  console.log(`[Polygon RPC] Rotated to endpoint index ${currentRpcIndex}: ${POLYGON_RPC_ENDPOINTS[currentRpcIndex]}`);
}

// Helper to check if an error is a rate limit error
function isRateLimitError(error: any): boolean {
  const errorMessage = error?.message || error?.toString() || "";
  return (
    errorMessage.includes("Too many requests") ||
    errorMessage.includes("rate limit") ||
    errorMessage.includes("-32090") ||
    errorMessage.includes("missing response")
  );
}

// Retry wrapper with RPC rotation for rate limit errors
async function withRpcRetry<T>(operation: () => Promise<T>, maxRetries = 3): Promise<T> {
  let lastError: any;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      
      if (isRateLimitError(error) && attempt < maxRetries - 1) {
        console.log(`[Polygon RPC] Rate limit hit, rotating endpoint (attempt ${attempt + 1}/${maxRetries})`);
        rotateRpcEndpoint();
        // Small delay before retry
        await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
      } else if (!isRateLimitError(error)) {
        // Non-rate-limit error, throw immediately
        throw error;
      }
    }
  }
  
  throw lastError;
}

// Check if wallet is on Polygon network - throws error if not
// Does NOT attempt to switch networks (which would invalidate the signer)
// Returns the current chain ID for diagnostics
export async function verifyPolygonNetwork(signer: ethers.Signer): Promise<number> {
  const provider = signer.provider;
  if (!provider) {
    throw new Error("No provider available");
  }
  
  try {
    // Get current network from the signer's provider
    const network = await provider.getNetwork();
    const currentChainId = Number(network.chainId);
    
    console.log(`[verifyPolygonNetwork] Current chain ID: ${currentChainId}, required: ${POLYGON_CHAIN_ID}`);
    
    if (currentChainId !== POLYGON_CHAIN_ID) {
      throw new Error(`WRONG_NETWORK:${currentChainId}`);
    }
    
    return currentChainId;
  } catch (error: any) {
    // Handle ethers.js "network changed" error - this means wallet switched networks
    // and we need to recreate the signer
    if (error.code === "NETWORK_ERROR" || error.message?.includes("network changed")) {
      console.log("[verifyPolygonNetwork] Network changed, signer needs to be recreated");
      throw new Error("NETWORK_CHANGED");
    }
    throw error;
  }
}

// Request wallet to switch to Polygon network
// Works with browser extensions AND WalletConnect wallets
// Returns true if switch was requested (user will need to reconnect wallet after)
export async function requestPolygonSwitch(provider?: ethers.BrowserProvider | null): Promise<void> {
  // For WalletConnect and other EIP-1193 providers, use the provider directly
  // For browser extensions, fall back to window.ethereum
  let ethereum: any = null;
  
  if (provider) {
    // Try to get underlying provider from ethers BrowserProvider
    try {
      // Access the underlying EIP-1193 provider
      ethereum = (provider as any).provider || provider;
      console.log("[requestPolygonSwitch] Using passed provider");
    } catch (e) {
      console.log("[requestPolygonSwitch] Could not extract underlying provider");
    }
  }
  
  // Fallback to window.ethereum for browser extensions
  if (!ethereum || typeof ethereum.request !== 'function') {
    ethereum = (window as any).ethereum || 
               (window as any).phantom?.ethereum;
    console.log("[requestPolygonSwitch] Using window.ethereum fallback");
  }
  
  if (!ethereum || typeof ethereum.request !== 'function') {
    // For WalletConnect, tell user to switch in their wallet app
    throw new Error("SWITCH_IN_WALLET");
  }
  
  console.log("[requestPolygonSwitch] Requesting switch to Polygon...");
  
  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x89" }] // 137 in hex
    });
    console.log("[requestPolygonSwitch] Switch request sent");
  } catch (switchError: any) {
    if (switchError.code === 4902) {
      console.log("[requestPolygonSwitch] Polygon not found, adding network...");
      await ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: "0x89",
          chainName: "Polygon Mainnet",
          nativeCurrency: {
            name: "MATIC",
            symbol: "MATIC",
            decimals: 18
          },
          rpcUrls: ["https://polygon-rpc.com"],
          blockExplorerUrls: ["https://polygonscan.com"]
        }]
      });
    } else {
      throw switchError;
    }
  }
}

// Legacy function for backwards compatibility
export async function ensurePolygonNetwork(signer: ethers.Signer): Promise<void> {
  try {
    await verifyPolygonNetwork(signer);
  } catch (error: any) {
    if (error.message?.startsWith("WRONG_NETWORK:") || error.message === "NETWORK_CHANGED") {
      throw new Error("Please switch your wallet to Polygon network and try again");
    }
    throw error;
  }
}

// Polymarket Contract Addresses on Polygon
export const POLYMARKET_CONTRACTS = {
  CTF_EXCHANGE: "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E",
  NEG_RISK_CTF_EXCHANGE: "0xC5d563A36AE78145C45a50134d48A1215220f80a",
  NEG_RISK_ADAPTER: "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296", // NegRisk Adapter for split/merge
  USDC: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", // USDC.e on Polygon (bridged - used by Polymarket)
  USDC_NATIVE: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", // Native USDC on Polygon
  CTF: "0x4d97dcd97ec945f40cf65f87097ace5ea0476045", // Conditional Tokens
  PROXY_FACTORY: "0xaB45c5A4B0c941a2F231C04C3f49182e1A254052", // Magic/email proxy factory
  SAFE_FACTORY: "0xaacFeEa03eb1561C4e67d661e40682Bd20E3541b", // Gnosis Safe factory for external wallets
};

// ERC20 ABI for USDC interactions
const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
];

// ERC1155 ABI for CTF token interactions
const ERC1155_ABI = [
  "function isApprovedForAll(address account, address operator) view returns (bool)",
  "function setApprovalForAll(address operator, bool approved)",
];

// Proxy Factory ABI for deriving Magic user proxy addresses
const PROXY_FACTORY_ABI = [
  "function getAddress(address _user) view returns (address)",
];

export interface DepositState {
  step: "check_balance" | "approve_usdc" | "approve_ctf" | "deposit" | "complete" | "error";
  usdcBalance: string;
  usdcAllowance: string;
  ctfApproved: boolean;
  proxyAddress: string | null;
  error: string | null;
  txHash: string | null;
}

export async function getUSDCBalance(
  provider: ethers.Provider,
  address: string
): Promise<string> {
  const usdc = new ethers.Contract(POLYMARKET_CONTRACTS.USDC, ERC20_ABI, provider);
  const balance = await usdc.balanceOf(address);
  return ethers.formatUnits(balance, 6); // USDC has 6 decimals
}

export async function getNativeUSDCBalance(
  provider: ethers.Provider,
  address: string
): Promise<string> {
  const usdc = new ethers.Contract(POLYMARKET_CONTRACTS.USDC_NATIVE, ERC20_ABI, provider);
  const balance = await usdc.balanceOf(address);
  return ethers.formatUnits(balance, 6); // USDC has 6 decimals
}

export async function getUSDCAllowance(
  provider: ethers.Provider,
  owner: string,
  spender: string
): Promise<string> {
  const usdc = new ethers.Contract(POLYMARKET_CONTRACTS.USDC, ERC20_ABI, provider);
  const allowance = await usdc.allowance(owner, spender);
  return ethers.formatUnits(allowance, 6);
}

export async function getCTFApproval(
  provider: ethers.Provider,
  owner: string,
  operator: string
): Promise<boolean> {
  const ctf = new ethers.Contract(POLYMARKET_CONTRACTS.CTF, ERC1155_ABI, provider);
  return await ctf.isApprovedForAll(owner, operator);
}

export async function getMagicProxyAddress(
  provider: ethers.Provider,
  eoaAddress: string
): Promise<string | null> {
  try {
    const factory = new ethers.Contract(
      POLYMARKET_CONTRACTS.PROXY_FACTORY,
      PROXY_FACTORY_ABI,
      provider
    );
    // Call the contract's getAddress function
    const proxyAddress = await factory.getFunction("getAddress")(eoaAddress);
    return proxyAddress;
  } catch (error) {
    console.error("Failed to get proxy address:", error);
    return null;
  }
}

export async function approveUSDCForExchange(
  signer: ethers.Signer,
  amount?: string
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    // Ensure we're on Polygon network before approval (shows MATIC for gas, not ETH)
    await ensurePolygonNetwork(signer);
    
    const usdc = new ethers.Contract(POLYMARKET_CONTRACTS.USDC, ERC20_ABI, signer);
    
    // Approve max amount or specific amount
    const approveAmount = amount 
      ? ethers.parseUnits(amount, 6)
      : ethers.MaxUint256;
    
    // Approve both CTF Exchange and NegRisk CTF Exchange
    const tx = await usdc.approve(POLYMARKET_CONTRACTS.CTF_EXCHANGE, approveAmount);
    const receipt = await tx.wait();
    
    return { success: true, txHash: receipt.hash };
  } catch (error) {
    console.error("USDC approval failed:", error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : "Approval failed" 
    };
  }
}

export async function approveUSDCForNegRiskExchange(
  signer: ethers.Signer,
  amount?: string
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    // Ensure we're on Polygon network before approval
    await ensurePolygonNetwork(signer);
    
    const usdc = new ethers.Contract(POLYMARKET_CONTRACTS.USDC, ERC20_ABI, signer);
    
    const approveAmount = amount 
      ? ethers.parseUnits(amount, 6)
      : ethers.MaxUint256;
    
    const tx = await usdc.approve(POLYMARKET_CONTRACTS.NEG_RISK_CTF_EXCHANGE, approveAmount);
    const receipt = await tx.wait();
    
    return { success: true, txHash: receipt.hash };
  } catch (error) {
    console.error("USDC approval for NegRisk failed:", error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : "Approval failed" 
    };
  }
}

// Approve USDC for CTF Contract (required for splitting positions)
export async function approveUSDCForCTFContract(
  signer: ethers.Signer,
  amount?: string
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    // Ensure we're on Polygon network before approval
    await ensurePolygonNetwork(signer);
    
    const usdc = new ethers.Contract(POLYMARKET_CONTRACTS.USDC, ERC20_ABI, signer);
    
    const approveAmount = amount 
      ? ethers.parseUnits(amount, 6)
      : ethers.MaxUint256;
    
    const tx = await usdc.approve(POLYMARKET_CONTRACTS.CTF, approveAmount);
    const receipt = await tx.wait();
    
    return { success: true, txHash: receipt.hash };
  } catch (error) {
    console.error("USDC approval for CTF contract failed:", error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : "Approval failed" 
    };
  }
}

export async function approveCTFForExchange(
  signer: ethers.Signer
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    // Ensure we're on Polygon network before approval
    await ensurePolygonNetwork(signer);
    
    const ctf = new ethers.Contract(POLYMARKET_CONTRACTS.CTF, ERC1155_ABI, signer);
    
    // Approve CTF Exchange to transfer conditional tokens
    const tx = await ctf.setApprovalForAll(POLYMARKET_CONTRACTS.CTF_EXCHANGE, true);
    const receipt = await tx.wait();
    
    return { success: true, txHash: receipt.hash };
  } catch (error) {
    console.error("CTF approval failed:", error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : "Approval failed" 
    };
  }
}

export async function approveCTFForNegRiskExchange(
  signer: ethers.Signer
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    // Ensure we're on Polygon network before approval
    await ensurePolygonNetwork(signer);
    
    const ctf = new ethers.Contract(POLYMARKET_CONTRACTS.CTF, ERC1155_ABI, signer);
    
    const tx = await ctf.setApprovalForAll(POLYMARKET_CONTRACTS.NEG_RISK_CTF_EXCHANGE, true);
    const receipt = await tx.wait();
    
    return { success: true, txHash: receipt.hash };
  } catch (error) {
    console.error("CTF approval for NegRisk failed:", error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : "Approval failed" 
    };
  }
}

export async function transferUSDCToProxy(
  signer: ethers.Signer,
  proxyAddress: string,
  amount: string
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    // Ensure we're on Polygon network before transfer
    await ensurePolygonNetwork(signer);
    
    const usdc = new ethers.Contract(POLYMARKET_CONTRACTS.USDC, ERC20_ABI, signer);
    
    const transferAmount = ethers.parseUnits(amount, 6);
    const tx = await usdc.transfer(proxyAddress, transferAmount);
    const receipt = await tx.wait();
    
    return { success: true, txHash: receipt.hash };
  } catch (error) {
    console.error("USDC transfer failed:", error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : "Transfer failed" 
    };
  }
}

export async function revokeAllUSDCApprovals(
  signer: ethers.Signer
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    // Ensure we're on Polygon network before revoke
    await ensurePolygonNetwork(signer);
    
    const usdc = new ethers.Contract(POLYMARKET_CONTRACTS.USDC, ERC20_ABI, signer);
    
    const tx1 = await usdc.approve(POLYMARKET_CONTRACTS.CTF_EXCHANGE, 0);
    await tx1.wait();
    
    const tx2 = await usdc.approve(POLYMARKET_CONTRACTS.NEG_RISK_CTF_EXCHANGE, 0);
    await tx2.wait();
    
    const tx3 = await usdc.approve(POLYMARKET_CONTRACTS.CTF, 0);
    const receipt = await tx3.wait();
    
    return { success: true, txHash: receipt.hash };
  } catch (error) {
    console.error("USDC revoke failed:", error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : "Revoke failed" 
    };
  }
}

export async function revokeAllCTFApprovals(
  signer: ethers.Signer
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    // Ensure we're on Polygon network before revoke
    await ensurePolygonNetwork(signer);
    
    const ctf = new ethers.Contract(POLYMARKET_CONTRACTS.CTF, ERC1155_ABI, signer);
    
    const tx1 = await ctf.setApprovalForAll(POLYMARKET_CONTRACTS.CTF_EXCHANGE, false);
    await tx1.wait();
    
    const tx2 = await ctf.setApprovalForAll(POLYMARKET_CONTRACTS.NEG_RISK_CTF_EXCHANGE, false);
    const receipt = await tx2.wait();
    
    return { success: true, txHash: receipt.hash };
  } catch (error) {
    console.error("CTF revoke failed:", error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : "Revoke failed" 
    };
  }
}

export async function checkDepositRequirements(
  _provider: ethers.Provider, // Kept for backward compatibility but not used
  walletAddress: string,
  isMagicWallet: boolean,
  safeAddress?: string | null
): Promise<{
  usdcBalance: string;
  nativeUsdcBalance: string;
  ctfExchangeAllowance: string;
  negRiskExchangeAllowance: string;
  ctfContractAllowance: string;
  ctfApprovedForExchange: boolean;
  ctfApprovedForNegRisk: boolean;
  proxyAddress: string | null;
  proxyBalance: string | null;
  safeAddress: string | null;
  safeBalance: string | null;
  tradingBalance: string;
  needsApproval: boolean;
  needsCTFApproval: boolean;
}> {
  // Wrap the entire check in retry logic to handle RPC rate limits
  return withRpcRetry(async () => {
    // Use a dedicated read-only Polygon provider to avoid triggering WalletConnect/MetaMask
    const provider = getReadOnlyPolygonProvider();
    
    const usdcBalance = await getUSDCBalance(provider, walletAddress);
    const nativeUsdcBalance = await getNativeUSDCBalance(provider, walletAddress);
  
  let proxyAddress: string | null = null;
  let proxyBalance: string | null = null;
  let actualSafeAddress: string | null = safeAddress || null;
  let safeBalance: string | null = null;
  
  if (isMagicWallet) {
    // Magic wallets use a Proxy address
    proxyAddress = await getMagicProxyAddress(provider, walletAddress);
    if (proxyAddress) {
      proxyBalance = await getUSDCBalance(provider, proxyAddress);
    }
  } else if (actualSafeAddress) {
    // External wallets use a Safe address - fetch its balance
    try {
      safeBalance = await getUSDCBalance(provider, actualSafeAddress);
    } catch (error) {
      console.error("Failed to get Safe balance:", error);
      safeBalance = "0";
    }
  }
  
  // Determine which address to check approvals on
  // For Magic wallets: Check approvals on the PROXY address (where USDC lives and trades from)
  // For external wallets: Check approvals on the SAFE address (where USDC lives and trades from)
  // Fallback to EOA if no derived wallet is available
  let approvalCheckAddress = walletAddress;
  if (isMagicWallet && proxyAddress) {
    approvalCheckAddress = proxyAddress;
    console.log("[checkDepositRequirements] Checking approvals on Magic proxy:", proxyAddress);
  } else if (!isMagicWallet && actualSafeAddress) {
    approvalCheckAddress = actualSafeAddress;
    console.log("[checkDepositRequirements] Checking approvals on Safe:", actualSafeAddress);
  } else {
    console.log("[checkDepositRequirements] Checking approvals on EOA:", walletAddress);
  }
  
  const ctfExchangeAllowance = await getUSDCAllowance(
    provider, 
    approvalCheckAddress, 
    POLYMARKET_CONTRACTS.CTF_EXCHANGE
  );
  const negRiskExchangeAllowance = await getUSDCAllowance(
    provider, 
    approvalCheckAddress, 
    POLYMARKET_CONTRACTS.NEG_RISK_CTF_EXCHANGE
  );
  // CTF Contract also needs USDC approval for splitting positions
  const ctfContractAllowance = await getUSDCAllowance(
    provider,
    approvalCheckAddress,
    POLYMARKET_CONTRACTS.CTF
  );
  
  const ctfApprovedForExchange = await getCTFApproval(
    provider,
    approvalCheckAddress,
    POLYMARKET_CONTRACTS.CTF_EXCHANGE
  );
  const ctfApprovedForNegRisk = await getCTFApproval(
    provider,
    approvalCheckAddress,
    POLYMARKET_CONTRACTS.NEG_RISK_CTF_EXCHANGE
  );
  
  // Trading balance is the balance in the trading wallet (proxy for Magic, Safe for external)
  // For Magic wallets: proxyBalance
  // For external wallets: safeBalance
  // If neither is available, fall back to EOA balance (though trading will fail)
  const tradingBalance = isMagicWallet 
    ? (proxyBalance || usdcBalance) 
    : (safeBalance || usdcBalance);
  
  // Check if allowance is effectively zero (needs approval)
  // Include CTF contract allowance as it's required for splitting positions
  const needsApproval = parseFloat(ctfExchangeAllowance) < 1 || 
                        parseFloat(negRiskExchangeAllowance) < 1 ||
                        parseFloat(ctfContractAllowance) < 1;
  const needsCTFApproval = !ctfApprovedForExchange || !ctfApprovedForNegRisk;
  
  console.log("[checkDepositRequirements] Results:", {
    approvalCheckAddress,
    ctfExchangeAllowance,
    negRiskExchangeAllowance,
    ctfContractAllowance,
    ctfApprovedForExchange,
    ctfApprovedForNegRisk,
    needsApproval,
    needsCTFApproval,
  });
  
    return {
      usdcBalance,
      nativeUsdcBalance,
      ctfExchangeAllowance,
      negRiskExchangeAllowance,
      ctfContractAllowance,
      ctfApprovedForExchange,
      ctfApprovedForNegRisk,
      proxyAddress,
      proxyBalance,
      safeAddress: actualSafeAddress,
      safeBalance,
      tradingBalance,
      needsApproval,
      needsCTFApproval,
    };
  }); // Close withRpcRetry
}

// Get Polymarket balance via their API
export async function getPolymarketBalance(
  walletAddress: string
): Promise<{ usdc: string; error?: string }> {
  try {
    const response = await fetch(`/api/polymarket/balance/${walletAddress}`);
    if (!response.ok) {
      return { usdc: "0", error: "Failed to fetch Polymarket balance" };
    }
    const data = await response.json();
    return { usdc: data.usdc || "0" };
  } catch (error) {
    return { usdc: "0", error: "Failed to fetch balance" };
  }
}
