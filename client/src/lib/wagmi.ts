import { createConfig, http } from "wagmi";
import { polygon } from "wagmi/chains";
import { walletConnect, injected } from "@wagmi/connectors";

const WALLETCONNECT_PROJECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "";

export const wagmiConfig = createConfig({
  chains: [polygon],
  connectors: [
    injected({
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

export { polygon };
