import { createConfig, http } from "wagmi";
import { polygon } from "wagmi/chains";
import { walletConnect, injected } from "@wagmi/connectors";
import { reconnect } from "@wagmi/core";

let WALLETCONNECT_PROJECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "";

let runtimeConfigFetched = false;

// Fetch runtime config from server (for production where VITE_* vars may not be baked in)
async function fetchRuntimeConfig(): Promise<void> {
  if (runtimeConfigFetched) return;
  runtimeConfigFetched = true;
  
  try {
    const response = await fetch('/api/config');
    if (response.ok) {
      const config = await response.json();
      if (config.walletConnectProjectId && !WALLETCONNECT_PROJECT_ID) {
        WALLETCONNECT_PROJECT_ID = config.walletConnectProjectId;
        console.log("[Wagmi Config] WalletConnect project ID loaded from runtime config");
      }
    }
  } catch (err) {
    console.error("[Wagmi Config] Failed to fetch runtime config:", err);
  }
}

// Pre-fetch config on module load (non-blocking)
if (typeof window !== "undefined" && !WALLETCONNECT_PROJECT_ID) {
  fetchRuntimeConfig();
}

// Determine if we should allow injected connector auto-reconnect
// Only allow if user was previously using external/phantom wallet type
const savedWalletType = typeof window !== "undefined" 
  ? localStorage.getItem("polygon_wallet_type") 
  : null;

// Create a function that returns the WalletConnect connector with current project ID
function createWalletConnectConnector() {
  return walletConnect({
    projectId: WALLETCONNECT_PROJECT_ID,
    showQrModal: true,
    metadata: {
      name: "F1 Predict",
      description: "F1 Prediction Market - Trade on F1 Championship outcomes",
      url: typeof window !== "undefined" ? window.location.origin : "https://f1predict.com",
      icons: [typeof window !== "undefined" ? `${window.location.origin}/favicon.ico` : ""],
    },
  });
}

// Create wagmi config 
// We control reconnect behavior manually to prevent Phantom from hijacking wallet selection
export const wagmiConfig = createConfig({
  chains: [polygon],
  connectors: [
    injected({
      shimDisconnect: true,
    }),
    createWalletConnectConnector(),
  ],
  transports: {
    [polygon.id]: http("https://polygon-rpc.com"),
  },
});

// Export a function to get current WalletConnect project ID status
export function getWalletConnectProjectId(): string {
  return WALLETCONNECT_PROJECT_ID;
}

// Export a function to ensure config is ready (waits for runtime config fetch)
export async function ensureWagmiConfigReady(): Promise<void> {
  if (WALLETCONNECT_PROJECT_ID) return;
  await fetchRuntimeConfig();
}

// Only auto-reconnect specific wallet types on page load
// This prevents Phantom from hijacking when user wants WalletConnect
if (typeof window !== "undefined" && savedWalletType) {
  if (savedWalletType === "walletconnect") {
    // Reconnect WalletConnect sessions
    const wcConnector = wagmiConfig.connectors.find(c => c.id === 'walletConnect');
    if (wcConnector) {
      reconnect(wagmiConfig, { connectors: [wcConnector] });
    }
  }
  // For external/phantom, we let the WalletContext handle reconnection via eth_accounts
  // This prevents wagmi's injected connector from auto-connecting to Phantom
}

export { polygon };
