import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { isConnected, getAddress, requestAccess } from "@stellar/freighter-api";

interface WalletContextType {
  walletAddress: string | null;
  isFreighterInstalled: boolean | null;
  isConnecting: boolean;
  connectWallet: () => Promise<boolean>;
  disconnectWallet: () => void;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [isFreighterInstalled, setIsFreighterInstalled] = useState<boolean | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  useEffect(() => {
    const checkFreighter = async () => {
      try {
        const result = await isConnected();
        setIsFreighterInstalled(result.isConnected);
        if (result.isConnected) {
          const addressResult = await getAddress();
          if (addressResult.address) {
            setWalletAddress(addressResult.address);
          }
        }
      } catch (e) {
        setIsFreighterInstalled(false);
      }
    };
    checkFreighter();
  }, []);

  const connectWallet = async (): Promise<boolean> => {
    if (!isFreighterInstalled) return false;
    setIsConnecting(true);
    try {
      const accessResult = await requestAccess();
      if (accessResult.error) {
        return false;
      } else if (accessResult.address) {
        setWalletAddress(accessResult.address);
        return true;
      }
      return false;
    } catch (e) {
      return false;
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnectWallet = () => {
    setWalletAddress(null);
  };

  return (
    <WalletContext.Provider
      value={{
        walletAddress,
        isFreighterInstalled,
        isConnecting,
        connectWallet,
        disconnectWallet,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return context;
}
