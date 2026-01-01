import { ethers } from "ethers";
import { getReadOnlyPolygonProvider, rotateRpcEndpoint } from "./polymarketDeposit";

const USDC_CONTRACT_ADDRESS = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";

const USDC_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

// Standalone function that can be imported and used outside of React context
// Uses shared RPC provider with automatic rotation on rate limit errors
export async function getUsdcBalance(walletAddress: string): Promise<string> {
  if (!walletAddress) {
    return "0";
  }
  
  const maxRetries = 3;
  let lastError: any;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const provider = getReadOnlyPolygonProvider();
      const contract = new ethers.Contract(USDC_CONTRACT_ADDRESS, USDC_ABI, provider);
      const balance = await contract.balanceOf(walletAddress);
      const decimals = await contract.decimals();
      return ethers.formatUnits(balance, decimals);
    } catch (error: any) {
      lastError = error;
      const errorMessage = error?.message || error?.toString() || "";
      
      // Check if it's a rate limit error
      if (errorMessage.includes("Too many requests") || 
          errorMessage.includes("rate limit") || 
          errorMessage.includes("-32090") ||
          errorMessage.includes("missing response")) {
        console.log(`[getUsdcBalance] Rate limit hit, rotating RPC (attempt ${attempt + 1}/${maxRetries})`);
        rotateRpcEndpoint();
        await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
      } else {
        // Non-rate-limit error, fail immediately
        console.error("Error fetching USDC balance:", error);
        return "0";
      }
    }
  }
  
  console.error("Error fetching USDC balance after retries:", lastError);
  return "0";
}
