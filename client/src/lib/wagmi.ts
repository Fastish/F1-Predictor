import { createConfig, http, type Config } from "wagmi";
import { polygon } from "wagmi/chains";
import { walletConnect, injected } from "@wagmi/connectors";
import { reconnect } from "@wagmi/core";

let WALLETCONNECT_PROJECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "";

let runtimeConfigFetched = false;
let wagmiConfigInstance: Config | null = null;
let configPromise: Promise<Config> | null = null;

async function fetchRuntimeConfig(): Promise<void> {
  if (runtimeConfigFetched) return;
  runtimeConfigFetched = true;
  
  if (WALLETCONNECT_PROJECT_ID) {
    console.log("[Wagmi Config] Using build-time WalletConnect project ID");
    return;
  }
  
  console.log("[Wagmi Config] Build-time project ID not found, fetching from runtime config...");
  
  try {
    const response = await fetch('/api/config');
    if (response.ok) {
      const config = await response.json();
      if (config.walletConnectProjectId) {
        WALLETCONNECT_PROJECT_ID = config.walletConnectProjectId;
        console.log("[Wagmi Config] WalletConnect project ID loaded from runtime config");
      } else {
        console.warn("[Wagmi Config] Runtime config returned empty walletConnectProjectId");
      }
    } else {
      console.error("[Wagmi Config] Failed to fetch runtime config:", response.status);
    }
  } catch (err) {
    console.error("[Wagmi Config] Failed to fetch runtime config:", err);
  }
}

function createWagmiConfig(): Config {
  console.log("[Wagmi Config] Creating wagmi config with project ID:", WALLETCONNECT_PROJECT_ID ? WALLETCONNECT_PROJECT_ID.slice(0, 8) + "..." : "(empty)");
  
  const connectors = [
    injected({
      shimDisconnect: true,
    }),
  ];
  
  if (WALLETCONNECT_PROJECT_ID) {
    connectors.push(
      walletConnect({
        projectId: WALLETCONNECT_PROJECT_ID,
        showQrModal: true,
        metadata: {
          name: "F1 Predict",
          description: "F1 Prediction Market - Trade on F1 Championship outcomes",
          url: typeof window !== "undefined" ? window.location.origin : "https://f1predict.com",
          icons: [typeof window !== "undefined" ? `${window.location.origin}/favicon.ico` : ""],
        },
        qrModalOptions: {
          themeMode: "dark",
        },
      })
    );
  } else {
    console.warn("[Wagmi Config] WalletConnect connector NOT added - no project ID available");
  }
  
  return createConfig({
    chains: [polygon],
    connectors,
    transports: {
      [polygon.id]: http("https://polygon-rpc.com"),
    },
  });
}

export async function getWagmiConfig(): Promise<Config> {
  if (wagmiConfigInstance) {
    return wagmiConfigInstance;
  }
  
  if (configPromise) {
    return configPromise;
  }
  
  configPromise = (async () => {
    await fetchRuntimeConfig();
    wagmiConfigInstance = createWagmiConfig();
    
    const savedWalletType = localStorage.getItem("polygon_wallet_type");
    if (savedWalletType === "walletconnect") {
      const wcConnector = wagmiConfigInstance.connectors.find(c => c.id === 'walletConnect');
      if (wcConnector) {
        console.log("[Wagmi Config] Reconnecting WalletConnect session...");
        reconnect(wagmiConfigInstance, { connectors: [wcConnector] });
      }
    }
    
    return wagmiConfigInstance;
  })();
  
  return configPromise;
}

export function getWalletConnectProjectId(): string {
  return WALLETCONNECT_PROJECT_ID;
}

export function isWalletConnectAvailable(): boolean {
  return !!WALLETCONNECT_PROJECT_ID;
}

export { polygon };
