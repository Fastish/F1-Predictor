import { ethers } from "ethers";

// Read-only Polygon RPC provider for balance checks (avoids triggering WalletConnect)
const POLYGON_RPC = "https://polygon-rpc.com";
let readOnlyProvider: ethers.JsonRpcProvider | null = null;

export function getReadOnlyPolygonProvider(): ethers.JsonRpcProvider {
  if (!readOnlyProvider) {
    readOnlyProvider = new ethers.JsonRpcProvider(POLYGON_RPC, 137);
  }
  return readOnlyProvider;
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
