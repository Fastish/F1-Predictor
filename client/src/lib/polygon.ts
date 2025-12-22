import { ethers } from "ethers";

const POLYGON_RPC = "https://polygon-rpc.com";
const USDC_CONTRACT_ADDRESS = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";

const USDC_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

// Standalone function that can be imported and used outside of React context
export async function getUsdcBalance(walletAddress: string): Promise<string> {
  if (!walletAddress) {
    return "0";
  }
  try {
    const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
    const contract = new ethers.Contract(USDC_CONTRACT_ADDRESS, USDC_ABI, provider);
    const balance = await contract.balanceOf(walletAddress);
    const decimals = await contract.decimals();
    return ethers.formatUnits(balance, decimals);
  } catch (error) {
    console.error("Error fetching USDC balance:", error);
    return "0";
  }
}
