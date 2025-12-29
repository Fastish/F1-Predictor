import { ethers } from "ethers";

// Polymarket Contract Addresses on Polygon
export const POLYMARKET_CONTRACTS = {
  CTF_EXCHANGE: "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E",
  NEG_RISK_CTF_EXCHANGE: "0xC5d563A36AE78145C45a50134d48A1215220f80a",
  USDC: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", // USDC.e on Polygon (bridged - used by Polymarket)
  USDC_NATIVE: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", // Native USDC on Polygon
  CTF: "0x4d97dcd97ec945f40cf65f87097ace5ea0476045", // Conditional Tokens
  PROXY_FACTORY: "0xaB45c5A4B0c941a2F231C04C3f49182e1A254052", // Magic proxy factory
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
  provider: ethers.Provider,
  walletAddress: string,
  isMagicWallet: boolean
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
  needsApproval: boolean;
  needsCTFApproval: boolean;
}> {
  const usdcBalance = await getUSDCBalance(provider, walletAddress);
  const nativeUsdcBalance = await getNativeUSDCBalance(provider, walletAddress);
  const ctfExchangeAllowance = await getUSDCAllowance(
    provider, 
    walletAddress, 
    POLYMARKET_CONTRACTS.CTF_EXCHANGE
  );
  const negRiskExchangeAllowance = await getUSDCAllowance(
    provider, 
    walletAddress, 
    POLYMARKET_CONTRACTS.NEG_RISK_CTF_EXCHANGE
  );
  // CTF Contract also needs USDC approval for splitting positions
  const ctfContractAllowance = await getUSDCAllowance(
    provider,
    walletAddress,
    POLYMARKET_CONTRACTS.CTF
  );
  
  const ctfApprovedForExchange = await getCTFApproval(
    provider,
    walletAddress,
    POLYMARKET_CONTRACTS.CTF_EXCHANGE
  );
  const ctfApprovedForNegRisk = await getCTFApproval(
    provider,
    walletAddress,
    POLYMARKET_CONTRACTS.NEG_RISK_CTF_EXCHANGE
  );
  
  let proxyAddress: string | null = null;
  let proxyBalance: string | null = null;
  
  if (isMagicWallet) {
    proxyAddress = await getMagicProxyAddress(provider, walletAddress);
    if (proxyAddress) {
      proxyBalance = await getUSDCBalance(provider, proxyAddress);
    }
  }
  
  // Check if allowance is effectively zero (needs approval)
  // Include CTF contract allowance as it's required for splitting positions
  const needsApproval = parseFloat(ctfExchangeAllowance) < 1 || 
                        parseFloat(negRiskExchangeAllowance) < 1 ||
                        parseFloat(ctfContractAllowance) < 1;
  const needsCTFApproval = !ctfApprovedForExchange || !ctfApprovedForNegRisk;
  
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
