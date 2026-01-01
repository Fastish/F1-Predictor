import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { Magic } from "magic-sdk";
import { ethers } from "ethers";
import { queryClient } from "@/lib/queryClient";
import { useConnect, useDisconnect, useAccount, useWalletClient, Connector } from "wagmi";
import { walletConnect, injected } from "@wagmi/connectors";

type WalletType = "magic" | "external" | "walletconnect" | "phantom" | null;

export interface PolymarketCredentials {
  apiKey: string;
  secret: string;
  passphrase: string;
  derivedAt: number;
}

interface WalletContextType {
  walletAddress: string | null;
  walletType: WalletType;
  isConnecting: boolean;
  isLoading: boolean;
  userEmail: string | null;
  provider: ethers.BrowserProvider | null;
  signer: ethers.Signer | null;
  polymarketCredentials: PolymarketCredentials | null;
  setPolymarketCredentials: (creds: PolymarketCredentials | null) => void;
  connectWallet: () => Promise<boolean>;
  connectWithMagic: (email: string) => Promise<boolean>;
  connectExternalWallet: () => Promise<boolean>;
  connectWalletConnect: () => Promise<boolean>;
  connectPhantomWallet: () => Promise<boolean>;
  isPhantomInstalled: () => boolean;
  disconnectWallet: () => Promise<void>;
  signMessage: (message: string) => Promise<string>;
  getUsdcBalance: () => Promise<string>;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

let MAGIC_API_KEY = import.meta.env.VITE_MAGIC_API_KEY || "";
const WALLETCONNECT_PROJECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "";

let runtimeConfigLoaded = false;
async function ensureMagicApiKey(): Promise<string> {
  if (MAGIC_API_KEY) {
    console.log("[Magic Debug] Using build-time Magic API key");
    return MAGIC_API_KEY;
  }
  
  if (runtimeConfigLoaded) {
    if (!MAGIC_API_KEY) {
      console.error("[Magic Debug] No Magic API key available after runtime config fetch. Email login will not work.");
    }
    return MAGIC_API_KEY;
  }
  
  console.log("[Magic Debug] Build-time Magic API key not found, fetching from /api/config...");
  
  try {
    const response = await fetch('/api/config');
    if (response.ok) {
      const config = await response.json();
      if (config.magicApiKey) {
        MAGIC_API_KEY = config.magicApiKey;
        console.log("[Magic Debug] Magic API key loaded from runtime config successfully");
      } else {
        console.error("[Magic Debug] /api/config returned empty magicApiKey.");
      }
    } else {
      console.error("[Magic Debug] Failed to fetch /api/config:", response.status, response.statusText);
    }
  } catch (err) {
    console.error("[Magic Debug] Failed to fetch runtime config:", err);
  }
  
  runtimeConfigLoaded = true;
  
  if (!MAGIC_API_KEY) {
    console.error("[Magic Debug] CRITICAL: No Magic API key available. Email wallet login will not work.");
  }
  
  return MAGIC_API_KEY;
}

const POLYGON_RPC = "https://polygon-rpc.com";
const POLYGON_CHAIN_ID = 137;
const USDC_CONTRACT_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";

const USDC_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<any>;
  on: (event: string, callback: (...args: any[]) => void) => void;
  removeListener?: (event: string, callback: (...args: any[]) => void) => void;
  isPhantom?: boolean;
  isMetaMask?: boolean;
}

declare global {
  interface Window {
    phantom?: {
      ethereum?: EthereumProvider;
    };
  }
}

function getEthereumProvider(): EthereumProvider | null {
  if (window.phantom?.ethereum) {
    console.log("Found provider at window.phantom.ethereum");
    return window.phantom.ethereum;
  }
  const ethereum = (window as any).ethereum;
  if (ethereum?.isPhantom) {
    console.log("Found Phantom provider at window.ethereum");
    return ethereum as EthereumProvider;
  }
  if (ethereum) {
    console.log("Found provider at window.ethereum");
    return ethereum as EthereumProvider;
  }
  return null;
}

function getProviderDiagnostics(): string {
  const diagnostics = [];
  const ethereum = (window as any).ethereum;
  if (ethereum) diagnostics.push(`window.ethereum exists (isMetaMask: ${ethereum.isMetaMask}, isPhantom: ${ethereum.isPhantom})`);
  if (window.phantom?.ethereum) diagnostics.push("window.phantom.ethereum exists");
  if (diagnostics.length === 0) diagnostics.push("No Ethereum providers detected");
  return diagnostics.join("; ");
}

async function waitForProvider(maxAttempts = 10, intervalMs = 200): Promise<EthereumProvider | null> {
  for (let i = 0; i < maxAttempts; i++) {
    const provider = getEthereumProvider();
    if (provider) {
      return provider;
    }
    if (i < maxAttempts - 1) {
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }
  return null;
}

let magicInstance: Magic | null = null;

async function getMagic(): Promise<Magic | null> {
  const apiKey = await ensureMagicApiKey();
  
  if (!apiKey) {
    console.error("[Magic Debug] Cannot create Magic instance: no API key");
    return null;
  }
  
  if (!magicInstance) {
    console.log("[Magic Debug] Creating new Magic instance with API key");
    magicInstance = new Magic(apiKey, {
      network: {
        rpcUrl: POLYGON_RPC,
        chainId: POLYGON_CHAIN_ID,
      },
    });
  }
  return magicInstance;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletType, setWalletType] = useState<WalletType>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [signer, setSigner] = useState<ethers.Signer | null>(null);
  const [polymarketCredentials, setPolymarketCredentials] = useState<PolymarketCredentials | null>(null);
  
  const { connect, connectors, isPending: wagmiConnecting, error: wagmiError } = useConnect();
  const { disconnect: wagmiDisconnect } = useDisconnect();
  const { address: wagmiAddress, isConnected: wagmiIsConnected, connector: activeConnector } = useAccount();
  const { data: walletClient } = useWalletClient();

  const wcConnectorRef = useRef<Connector | null>(null);

  useEffect(() => {
    const wcConnector = connectors.find(c => c.id === 'walletConnect');
    if (wcConnector) {
      wcConnectorRef.current = wcConnector;
    }
  }, [connectors]);

  useEffect(() => {
    if (wagmiError) {
      console.error("[Wagmi] Connection error from wagmi state:", wagmiError);
      console.error("[Wagmi] Error details:", {
        message: wagmiError.message,
        name: wagmiError.name,
        cause: (wagmiError as any)?.cause
      });
    }
  }, [wagmiError]);

  useEffect(() => {
    if (wagmiIsConnected && wagmiAddress && activeConnector?.id === 'walletConnect' && walletType !== 'walletconnect') {
      console.log("[Wagmi] WalletConnect connected via wagmi:", wagmiAddress);
      setWalletAddress(wagmiAddress);
      setWalletType("walletconnect");
      setUserEmail(null);
      localStorage.setItem("polygon_wallet_type", "walletconnect");
      localStorage.setItem("polygon_wallet_address", wagmiAddress);
      setIsConnecting(false);
    }
  }, [wagmiIsConnected, wagmiAddress, activeConnector, walletType]);

  useEffect(() => {
    if (walletClient && wagmiIsConnected && wagmiAddress && walletType === 'walletconnect') {
      console.log("[Wagmi] Setting up provider from walletClient");
      const transport = walletClient.transport;
      if (transport) {
        const ethersProvider = new ethers.BrowserProvider(transport);
        setProvider(ethersProvider);
        ethersProvider.getSigner().then(s => {
          setSigner(s);
          console.log("[Wagmi] Signer ready");
        }).catch(err => {
          console.error("[Wagmi] Error getting signer:", err);
        });
      }
    }
  }, [walletClient, wagmiIsConnected, wagmiAddress, walletType]);

  useEffect(() => {
    const initWallet = async () => {
      try {
        const savedType = localStorage.getItem("polygon_wallet_type") as WalletType;
        const savedAddress = localStorage.getItem("polygon_wallet_address");
        
        console.log("[Init] Saved wallet type:", savedType, "address:", savedAddress);
        
        if (savedType === "magic" && savedAddress) {
          try {
            const magic = await getMagic();
            if (magic) {
              const isLoggedIn = await magic.user.isLoggedIn();
              console.log("[Init] Magic user logged in:", isLoggedIn);
              if (isLoggedIn) {
                const metadata = await magic.user.getInfo();
                const publicAddress = (metadata as any).wallets?.ethereum?.publicAddress || metadata.publicAddress;
                if (publicAddress) {
                  setWalletAddress(publicAddress);
                  setUserEmail(metadata.email || null);
                  setWalletType("magic");
                  const magicProvider = new ethers.BrowserProvider(magic.rpcProvider as any);
                  setProvider(magicProvider);
                  const magicSigner = await magicProvider.getSigner();
                  setSigner(magicSigner);
                }
              }
            }
          } catch (error) {
            console.error("[Init] Magic init error:", error);
            localStorage.removeItem("polygon_wallet_type");
            localStorage.removeItem("polygon_wallet_address");
          }
        } else if ((savedType === "external" || savedType === "phantom") && savedAddress) {
          try {
            const ethProvider = savedType === "phantom" 
              ? (window.phantom?.ethereum || (window.ethereum?.isPhantom ? window.ethereum : null))
              : getEthereumProvider();
              
            if (ethProvider) {
              const accounts = await ethProvider.request({ method: "eth_accounts" });
              if (accounts && accounts.length > 0) {
                setWalletAddress(accounts[0]);
                setWalletType(savedType);
                const externalProvider = new ethers.BrowserProvider(ethProvider);
                setProvider(externalProvider);
                const externalSigner = await externalProvider.getSigner();
                setSigner(externalSigner);
              } else {
                localStorage.removeItem("polygon_wallet_type");
                localStorage.removeItem("polygon_wallet_address");
              }
            }
          } catch (error) {
            console.error("[Init] External wallet init error:", error);
            localStorage.removeItem("polygon_wallet_type");
            localStorage.removeItem("polygon_wallet_address");
          }
        } else if (savedType === "walletconnect" && savedAddress) {
          console.log("[Init] Checking wagmi for WalletConnect session");
          if (wagmiIsConnected && wagmiAddress) {
            console.log("[Init] Wagmi already connected:", wagmiAddress);
            setWalletAddress(wagmiAddress);
            setWalletType("walletconnect");
          }
        }
      } catch (error) {
        console.error("[Init] Wallet initialization error:", error);
      } finally {
        setIsLoading(false);
      }
    };

    initWallet();
  }, [wagmiIsConnected, wagmiAddress]);

  useEffect(() => {
    if ((walletType !== "external" && walletType !== "phantom") || !walletAddress) {
      return;
    }
    
    const ethProvider = walletType === "phantom" 
      ? (window.phantom?.ethereum || (window.ethereum?.isPhantom ? window.ethereum : null))
      : getEthereumProvider();
      
    if (ethProvider) {
      const handleAccountsChanged = (accounts: string[]) => {
        if (accounts.length === 0) {
          disconnectWallet();
        } else {
          setWalletAddress(accounts[0]);
          localStorage.setItem("polygon_wallet_address", accounts[0]);
        }
      };

      ethProvider.on("accountsChanged", handleAccountsChanged);

      return () => {
        ethProvider.removeListener?.("accountsChanged", handleAccountsChanged);
      };
    }
  }, [walletType, walletAddress]);

  const connectWithMagic = useCallback(async (email: string): Promise<boolean> => {
    setIsConnecting(true);
    try {
      console.log("[Magic Debug] Starting connection for email:", email);
      
      const magic = await getMagic();
      if (!magic) {
        throw new Error("Magic SDK not available. Please check your configuration.");
      }
      
      await magic.auth.loginWithMagicLink({ email });
      console.log("[Magic Debug] loginWithMagicLink completed");
      
      const metadata = await magic.user.getInfo();
      const publicAddress = (metadata as any).wallets?.ethereum?.publicAddress || metadata.publicAddress;
      
      if (publicAddress) {
        console.log("[Magic Debug] User authenticated:", publicAddress);
        setWalletAddress(publicAddress);
        setUserEmail(metadata.email || null);
        setWalletType("magic");
        localStorage.setItem("polygon_wallet_type", "magic");
        localStorage.setItem("polygon_wallet_address", publicAddress);
        
        const magicProvider = new ethers.BrowserProvider(magic.rpcProvider as any);
        setProvider(magicProvider);
        const magicSigner = await magicProvider.getSigner();
        setSigner(magicSigner);
        
        return true;
      }
      return false;
    } catch (error: any) {
      console.error("[Magic Debug] connectWithMagic error:", error);
      return false;
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const connectExternalWallet = useCallback(async (): Promise<boolean> => {
    setIsConnecting(true);
    try {
      console.log("Attempting to connect external wallet...");
      
      const ethProvider = await waitForProvider();
      
      if (!ethProvider) {
        throw new Error(`No wallet detected. ${getProviderDiagnostics()}. Please make sure your wallet extension is installed and refresh the page.`);
      }
      
      console.log("Requesting account authorization...");
      const accounts = await ethProvider.request({ method: "eth_requestAccounts" });
      
      if (!accounts || accounts.length === 0) {
        throw new Error("No accounts returned. User may have rejected the connection request.");
      }
      
      const address = accounts[0];
      console.log("Account authorized:", address);

      const chainIdHex = await ethProvider.request({ method: "eth_chainId" });
      const currentChainId = parseInt(chainIdHex, 16);
      console.log("Current chain ID:", currentChainId, "Target:", POLYGON_CHAIN_ID);

      if (currentChainId !== POLYGON_CHAIN_ID) {
        console.log("Switching to Polygon network...");
        try {
          await ethProvider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: `0x${POLYGON_CHAIN_ID.toString(16)}` }],
          });
        } catch (switchError: any) {
          if (switchError.code === 4902) {
            console.log("Adding Polygon network...");
            await ethProvider.request({
              method: "wallet_addEthereumChain",
              params: [{
                chainId: `0x${POLYGON_CHAIN_ID.toString(16)}`,
                chainName: "Polygon Mainnet",
                nativeCurrency: { name: "MATIC", symbol: "MATIC", decimals: 18 },
                rpcUrls: [POLYGON_RPC],
                blockExplorerUrls: ["https://polygonscan.com/"],
              }],
            });
          } else {
            throw switchError;
          }
        }
      }

      setWalletAddress(address);
      setWalletType("external");
      setUserEmail(null);
      localStorage.setItem("polygon_wallet_type", "external");
      localStorage.setItem("polygon_wallet_address", address);
      
      const externalProvider = new ethers.BrowserProvider(ethProvider);
      setProvider(externalProvider);
      const externalSigner = await externalProvider.getSigner();
      setSigner(externalSigner);
      
      console.log("Wallet connected successfully!");
      return true;
    } catch (error: any) {
      console.error("External wallet connection error:", error);
      throw error;
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const isPhantomInstalled = useCallback((): boolean => {
    return !!(window.phantom?.ethereum || window.ethereum?.isPhantom);
  }, []);

  const getPhantomProvider = useCallback((): EthereumProvider | null => {
    if (window.phantom?.ethereum) {
      return window.phantom.ethereum;
    }
    if (window.ethereum?.isPhantom) {
      return window.ethereum;
    }
    return null;
  }, []);

  const connectPhantomWallet = useCallback(async (): Promise<boolean> => {
    setIsConnecting(true);
    try {
      console.log("[Phantom] Attempting to connect Phantom wallet...");
      
      const phantomProvider = getPhantomProvider();
      
      if (!phantomProvider) {
        throw new Error("Phantom wallet not detected. Please install the Phantom extension and refresh the page.");
      }
      
      const accounts = await phantomProvider.request({ method: "eth_requestAccounts" });
      
      if (!accounts || accounts.length === 0) {
        throw new Error("No accounts returned. User may have rejected the connection request.");
      }
      
      const address = accounts[0];
      console.log("[Phantom] Account authorized:", address);

      const chainIdHex = await phantomProvider.request({ method: "eth_chainId" });
      const currentChainId = parseInt(chainIdHex, 16);

      if (currentChainId !== POLYGON_CHAIN_ID) {
        console.log("[Phantom] Switching to Polygon network...");
        try {
          await phantomProvider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: `0x${POLYGON_CHAIN_ID.toString(16)}` }],
          });
        } catch (switchError: any) {
          if (switchError.code === 4902) {
            await phantomProvider.request({
              method: "wallet_addEthereumChain",
              params: [{
                chainId: `0x${POLYGON_CHAIN_ID.toString(16)}`,
                chainName: "Polygon Mainnet",
                nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
                rpcUrls: [POLYGON_RPC],
                blockExplorerUrls: ["https://polygonscan.com/"],
              }],
            });
          } else {
            throw switchError;
          }
        }
      }

      setWalletAddress(address);
      setWalletType("phantom");
      setUserEmail(null);
      localStorage.setItem("polygon_wallet_type", "phantom");
      localStorage.setItem("polygon_wallet_address", address);
      
      const phantomEthersProvider = new ethers.BrowserProvider(phantomProvider);
      setProvider(phantomEthersProvider);
      const phantomSigner = await phantomEthersProvider.getSigner();
      setSigner(phantomSigner);
      
      console.log("[Phantom] Wallet connected successfully!");
      return true;
    } catch (error: any) {
      console.error("[Phantom] Connection error:", error);
      throw error;
    } finally {
      setIsConnecting(false);
    }
  }, [getPhantomProvider]);

  const connectWalletConnect = useCallback(async (): Promise<boolean> => {
    if (!WALLETCONNECT_PROJECT_ID) {
      throw new Error("WalletConnect is not configured. Missing project ID.");
    }
    
    setIsConnecting(true);
    
    try {
      console.log("[Wagmi WC] Starting WalletConnect connection...");
      console.log("[Wagmi WC] Project ID:", WALLETCONNECT_PROJECT_ID.slice(0, 8) + "...");
      console.log("[Wagmi WC] Available connectors:", connectors.map(c => ({ id: c.id, name: c.name, ready: c.ready })));
      
      const wcConnector = connectors.find(c => c.id === 'walletConnect');
      
      if (!wcConnector) {
        console.error("[Wagmi WC] WalletConnect connector not found in connectors list");
        throw new Error("WalletConnect connector not found. Please refresh the page.");
      }
      
      console.log("[Wagmi WC] Found WalletConnect connector:", { 
        id: wcConnector.id, 
        name: wcConnector.name,
        ready: wcConnector.ready
      });
      console.log("[Wagmi WC] Calling connect() with chain:", POLYGON_CHAIN_ID);
      
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          console.error("[Wagmi WC] Connection timed out after 60 seconds");
          setIsConnecting(false);
          reject(new Error("WalletConnect connection timed out. Please try again."));
        }, 60000);
        
        try {
          connect(
            { connector: wcConnector, chainId: POLYGON_CHAIN_ID },
            {
              onSuccess: (data) => {
                clearTimeout(timeout);
                console.log("[Wagmi WC] Connection successful:", data);
                if (data.accounts && data.accounts.length > 0) {
                  const address = data.accounts[0];
                  setWalletAddress(address);
                  setWalletType("walletconnect");
                  setUserEmail(null);
                  localStorage.setItem("polygon_wallet_type", "walletconnect");
                  localStorage.setItem("polygon_wallet_address", address);
                  setIsConnecting(false);
                  resolve(true);
                } else {
                  setIsConnecting(false);
                  reject(new Error("No accounts returned from WalletConnect"));
                }
              },
              onError: (error) => {
                clearTimeout(timeout);
                console.error("[Wagmi WC] Connection onError callback:", error);
                console.error("[Wagmi WC] Error details:", {
                  message: error?.message,
                  name: error?.name,
                  code: (error as any)?.code,
                  cause: (error as any)?.cause
                });
                setIsConnecting(false);
                reject(error);
              },
              onSettled: (data, error) => {
                console.log("[Wagmi WC] Connection settled:", { data, error });
              }
            }
          );
          console.log("[Wagmi WC] connect() called, waiting for modal...");
        } catch (connectError: any) {
          clearTimeout(timeout);
          console.error("[Wagmi WC] Synchronous error calling connect():", connectError);
          setIsConnecting(false);
          reject(connectError);
        }
      });
    } catch (error: any) {
      console.error("[Wagmi WC] Connection setup error:", error);
      setIsConnecting(false);
      throw error;
    }
  }, [connect, connectors]);

  const disconnectWallet = useCallback(async () => {
    try {
      if (walletType === "magic") {
        const magic = await getMagic();
        if (magic) {
          await magic.user.logout();
        }
      } else if (walletType === "walletconnect") {
        console.log("[Wagmi] Disconnecting WalletConnect...");
        wagmiDisconnect();
      }
    } catch (error) {
      console.error("Logout error:", error);
    }
    
    queryClient.removeQueries({ queryKey: ["polymarket-cash-balance"] });
    queryClient.removeQueries({ queryKey: ["polygon-usdc-balance"] });
    queryClient.removeQueries({ queryKey: ["polymarket-positions"] });
    
    setWalletAddress(null);
    setWalletType(null);
    setUserEmail(null);
    setProvider(null);
    setSigner(null);
    setPolymarketCredentials(null);
    localStorage.removeItem("polygon_wallet_type");
    localStorage.removeItem("polygon_wallet_address");
  }, [walletType, wagmiDisconnect]);

  const signMessage = useCallback(async (message: string): Promise<string> => {
    if (!signer) {
      throw new Error("No signer available. Please connect your wallet.");
    }
    return await signer.signMessage(message);
  }, [signer]);

  const getUsdcBalance = useCallback(async (): Promise<string> => {
    if (!provider || !walletAddress) {
      return "0";
    }
    try {
      const contract = new ethers.Contract(USDC_CONTRACT_ADDRESS, USDC_ABI, provider);
      const balance = await contract.balanceOf(walletAddress);
      const decimals = await contract.decimals();
      return ethers.formatUnits(balance, decimals);
    } catch (error) {
      console.error("Error fetching USDC balance:", error);
      return "0";
    }
  }, [provider, walletAddress]);

  const connectWallet = useCallback(async (): Promise<boolean> => {
    return await connectExternalWallet();
  }, [connectExternalWallet]);

  return (
    <WalletContext.Provider
      value={{
        walletAddress,
        walletType,
        isConnecting: isConnecting || wagmiConnecting,
        isLoading,
        userEmail,
        provider,
        signer,
        polymarketCredentials,
        setPolymarketCredentials,
        connectWallet,
        connectWithMagic,
        connectExternalWallet,
        connectWalletConnect,
        connectPhantomWallet,
        isPhantomInstalled,
        disconnectWallet,
        signMessage,
        getUsdcBalance,
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
