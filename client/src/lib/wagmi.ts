import { createConfig, http } from "wagmi";
import { polygon } from "wagmi/chains";
import { walletConnect, injected } from "@wagmi/connectors";
import { reconnect } from "@wagmi/core";

const WALLETCONNECT_PROJECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "";

// Determine if we should allow injected connector auto-reconnect
// Only allow if user was previously using external/phantom wallet type
const savedWalletType = typeof window !== "undefined" 
  ? localStorage.getItem("polygon_wallet_type") 
  : null;

// Create wagmi config 
// We control reconnect behavior manually to prevent Phantom from hijacking wallet selection
export const wagmiConfig = createConfig({
  chains: [polygon],
  connectors: [
    injected({
      // shimDisconnect prevents auto-reconnect when true, but only if wagmi's storage is used
      shimDisconnect: true,
    }),
    walletConnect({
      projectId: WALLETCONNECT_PROJECT_ID,
      showQrModal: true,
      metadata: {
        name: "F1 Predict",
        description: "F1 Prediction Market - Trade on F1 Championship outcomes",
        url: typeof window !== "undefined" ? window.location.origin : "https://f1predict.com",
        icons: [typeof window !== "undefined" ? `${window.location.origin}/favicon.ico` : ""],
      },
    }),
  ],
  transports: {
    [polygon.id]: http("https://polygon-rpc.com"),
  },
});

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
