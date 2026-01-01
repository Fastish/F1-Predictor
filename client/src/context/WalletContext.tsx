import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { Magic } from "magic-sdk";
import { ethers } from "ethers";
import { queryClient } from "@/lib/queryClient";
import WCEthereumProvider from "@walletconnect/ethereum-provider";

type WalletType = "magic" | "external" | "walletconnect" | "phantom" | null;

const WALLETCONNECT_PROJECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "";

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

// Magic API key - prefer build-time env var, fallback to runtime config
let MAGIC_API_KEY = import.meta.env.VITE_MAGIC_API_KEY || "";

// Runtime config fetch for production resilience
// In production, VITE_* vars may not be injected at build time if secrets weren't available
// The /api/config endpoint provides a runtime fallback
let runtimeConfigLoaded = false;
async function ensureMagicApiKey(): Promise<string> {
  // If we already have the key from build-time env or previous fetch, return it
  if (MAGIC_API_KEY) {
    console.log("[Magic Debug] Using build-time Magic API key");
    return MAGIC_API_KEY;
  }
  
  // Only try runtime fetch once
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
        console.error("[Magic Debug] /api/config returned empty magicApiKey. Ensure MAGIC_PUBLISHABLE_KEY or VITE_MAGIC_API_KEY is set in production secrets.");
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
const USDC_CONTRACT_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"; // USDC.e on Polygon (used by Polymarket)

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
    ethereum?: EthereumProvider;
    phantom?: {
      ethereum?: EthereumProvider;
    };
  }
}

function getEthereumProvider(): EthereumProvider | null {
  // First check window.phantom.ethereum (Phantom's preferred injection point)
  if (window.phantom?.ethereum) {
    console.log("Found provider at window.phantom.ethereum");
    return window.phantom.ethereum;
  }
  // Check window.ethereum with isPhantom flag (Phantom can also inject here)
  if (window.ethereum?.isPhantom) {
    console.log("Found Phantom provider at window.ethereum");
    return window.ethereum;
  }
  // Fallback to standard window.ethereum (MetaMask, Rainbow, etc.)
  if (window.ethereum) {
    console.log("Found provider at window.ethereum");
    return window.ethereum;
  }
  console.log("No Ethereum provider found");
  return null;
}

// Wait for provider to be injected using multiple strategies
async function waitForProvider(): Promise<EthereumProvider | null> {
  console.log("Starting provider detection...");
  console.log("Document readyState:", document.readyState);
  
  // Strategy 1: Check immediately
  let provider = getEthereumProvider();
  if (provider) {
    console.log("Provider found immediately");
    return provider;
  }
  
  // Strategy 2: Wait for DOMContentLoaded if not ready
  if (document.readyState !== 'complete') {
    console.log("Waiting for document to be ready...");
    await new Promise<void>(resolve => {
      if (document.readyState === 'complete') {
        resolve();
      } else {
        window.addEventListener('load', () => resolve(), { once: true });
      }
    });
    provider = getEthereumProvider();
    if (provider) {
      console.log("Provider found after document ready");
      return provider;
    }
  }
  
  // Strategy 3: Listen for eip6963:announceProvider event (modern standard)
  // This runs in the background while we also poll
  let eip6963Provider: EthereumProvider | null = null;
  const eip6963Handler = (event: any) => {
    console.log("EIP-6963 provider announced:", event.detail);
    if (event.detail?.provider) {
      eip6963Provider = event.detail.provider;
    }
  };
  window.addEventListener('eip6963:announceProvider', eip6963Handler);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  
  // Strategy 4: Poll with increasing delays (total ~5.5 seconds)
  const delays = [100, 200, 300, 500, 500, 500, 500, 500, 500, 500, 500, 500, 500];
  for (const delay of delays) {
    await new Promise(r => setTimeout(r, delay));
    
    // Check if EIP-6963 found a provider
    if (eip6963Provider) {
      console.log("Provider found via EIP-6963");
      window.removeEventListener('eip6963:announceProvider', eip6963Handler);
      return eip6963Provider;
    }
    
    // Check standard provider locations
    const p = getEthereumProvider();
    if (p) {
      console.log(`Provider found after ${delay}ms poll`);
      window.removeEventListener('eip6963:announceProvider', eip6963Handler);
      return p;
    }
  }
  
  // Cleanup EIP-6963 listener
  window.removeEventListener('eip6963:announceProvider', eip6963Handler);
  
  // Final checks
  if (eip6963Provider) {
    console.log("Provider found via EIP-6963 (final check)");
    return eip6963Provider;
  }
  
  provider = getEthereumProvider();
  if (provider) {
    console.log("Provider found on final check");
    return provider;
  }
  
  console.log("No provider detected after all strategies (~5.5s wait)");
  return null;
}

// Get diagnostic info about what providers are available
function getProviderDiagnostics(): string {
  const diagnostics: string[] = [];
  if (window.phantom) {
    diagnostics.push("Phantom extension detected");
    if (window.phantom.ethereum) {
      diagnostics.push("Phantom Ethereum provider available");
    }
  }
  if (window.ethereum) {
    diagnostics.push("window.ethereum available");
    if (window.ethereum.isPhantom) diagnostics.push("(isPhantom)");
    if (window.ethereum.isMetaMask) diagnostics.push("(isMetaMask)");
  }
  return diagnostics.length > 0 ? diagnostics.join(", ") : "No providers detected";
}

let magicInstance: Magic | null = null;

async function getMagic(): Promise<Magic | null> {
  console.log("[Magic Debug] getMagic() called");
  
  // Ensure API key is available (fallback to runtime config if not baked into build)
  const apiKey = await ensureMagicApiKey();
  
  console.log("[Magic Debug] MAGIC_API_KEY exists:", !!apiKey);
  console.log("[Magic Debug] MAGIC_API_KEY length:", apiKey?.length || 0);
  if (apiKey) {
    console.log("[Magic Debug] MAGIC_API_KEY prefix:", apiKey.substring(0, 10) + "...");
  }
  
  if (!apiKey) {
    console.warn("[Magic Debug] Magic API key not configured - returning null");
    return null;
  }
  if (!magicInstance) {
    console.log("[Magic Debug] Creating new Magic instance with config:", {
      rpcUrl: POLYGON_RPC,
      chainId: POLYGON_CHAIN_ID,
    });
    try {
      magicInstance = new Magic(apiKey, {
        network: {
          rpcUrl: POLYGON_RPC,
          chainId: POLYGON_CHAIN_ID,
        },
      });
      console.log("[Magic Debug] Magic instance created successfully");
    } catch (error) {
      console.error("[Magic Debug] Failed to create Magic instance:", error);
      return null;
    }
  } else {
    console.log("[Magic Debug] Returning existing Magic instance");
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
  const wcProviderRef = useRef<Awaited<ReturnType<typeof WCEthereumProvider.init>> | null>(null);

  useEffect(() => {
    const checkExistingSession = async () => {
      try {
        const savedType = localStorage.getItem("polygon_wallet_type") as WalletType;
        const savedAddress = localStorage.getItem("polygon_wallet_address");

        if (savedType === "magic" && savedAddress) {
          const magic = await getMagic();
          if (magic) {
            const isLoggedIn = await magic.user.isLoggedIn();
            if (isLoggedIn) {
              const metadata = await magic.user.getInfo();
              const publicAddress = (metadata as any).wallets?.ethereum?.publicAddress || metadata.publicAddress;
              setWalletAddress(publicAddress || null);
              setUserEmail(metadata.email || null);
              setWalletType("magic");
              
              const magicProvider = new ethers.BrowserProvider(magic.rpcProvider as any);
              setProvider(magicProvider);
              const magicSigner = await magicProvider.getSigner();
              setSigner(magicSigner);
            } else {
              localStorage.removeItem("polygon_wallet_type");
              localStorage.removeItem("polygon_wallet_address");
            }
          }
        } else if (savedType === "external" && savedAddress) {
          const ethProvider = getEthereumProvider();
          if (ethProvider) {
            try {
              const accounts = await ethProvider.request({ method: "eth_accounts" });
              if (accounts && accounts.length > 0 && accounts[0].toLowerCase() === savedAddress.toLowerCase()) {
                setWalletAddress(accounts[0]);
                setWalletType("external");
                
                const externalProvider = new ethers.BrowserProvider(ethProvider);
                setProvider(externalProvider);
                try {
                  const externalSigner = await externalProvider.getSigner();
                  setSigner(externalSigner);
                } catch (signerError) {
                  // Signer may fail if wallet requires re-authorization
                  // User will need to connect again to get signing capability
                  console.log("Could not get signer, user may need to re-connect:", signerError);
                }
              } else {
                localStorage.removeItem("polygon_wallet_type");
                localStorage.removeItem("polygon_wallet_address");
              }
            } catch (error) {
              console.log("Could not restore external wallet session:", error);
              localStorage.removeItem("polygon_wallet_type");
              localStorage.removeItem("polygon_wallet_address");
            }
          }
        } else if (savedType === "phantom" && savedAddress) {
          // Try to restore Phantom wallet session
          const phantomProvider = window.phantom?.ethereum || (window.ethereum?.isPhantom ? window.ethereum : null);
          if (phantomProvider) {
            try {
              const accounts = await phantomProvider.request({ method: "eth_accounts" });
              if (accounts && accounts.length > 0 && accounts[0].toLowerCase() === savedAddress.toLowerCase()) {
                setWalletAddress(accounts[0]);
                setWalletType("phantom");
                
                const phantomBrowserProvider = new ethers.BrowserProvider(phantomProvider);
                setProvider(phantomBrowserProvider);
                try {
                  const phantomSigner = await phantomBrowserProvider.getSigner();
                  setSigner(phantomSigner);
                } catch (signerError) {
                  console.log("Could not get signer, user may need to re-connect:", signerError);
                }
              } else {
                localStorage.removeItem("polygon_wallet_type");
                localStorage.removeItem("polygon_wallet_address");
              }
            } catch (error) {
              console.log("Could not restore Phantom wallet session:", error);
              localStorage.removeItem("polygon_wallet_type");
              localStorage.removeItem("polygon_wallet_address");
            }
          }
        } else if (!savedType || !savedAddress) {
          // No saved session - check if we're inside Phantom's browser and it has authorized accounts
          // This handles the case where user arrives via deep link from mobile browser
          const phantomProvider = window.phantom?.ethereum || (window.ethereum?.isPhantom ? window.ethereum : null);
          if (phantomProvider) {
            console.log("[Phantom Auto-Connect] Phantom detected, checking for authorized accounts...");
            try {
              // eth_accounts returns already-authorized accounts without prompting
              const accounts = await phantomProvider.request({ method: "eth_accounts" });
              if (accounts && accounts.length > 0) {
                console.log("[Phantom Auto-Connect] Found authorized account:", accounts[0]);
                const address = accounts[0];
                
                // Auto-connect since Phantom already authorized this account
                setWalletAddress(address);
                setWalletType("phantom");
                setUserEmail(null);
                localStorage.setItem("polygon_wallet_type", "phantom");
                localStorage.setItem("polygon_wallet_address", address);
                
                const phantomBrowserProvider = new ethers.BrowserProvider(phantomProvider);
                setProvider(phantomBrowserProvider);
                try {
                  const phantomSigner = await phantomBrowserProvider.getSigner();
                  setSigner(phantomSigner);
                  console.log("[Phantom Auto-Connect] Auto-connected successfully!");
                } catch (signerError) {
                  console.log("[Phantom Auto-Connect] Connected but signer failed:", signerError);
                }
              } else {
                console.log("[Phantom Auto-Connect] No authorized accounts found");
              }
            } catch (error) {
              console.log("[Phantom Auto-Connect] Could not check for accounts:", error);
            }
          }
        }
        
        if (savedType === "walletconnect" && savedAddress && WALLETCONNECT_PROJECT_ID) {
          // Try to restore WalletConnect session
          try {
            const wcProvider = await WCEthereumProvider.init({
              projectId: WALLETCONNECT_PROJECT_ID,
              chains: [POLYGON_CHAIN_ID],
              showQrModal: false,
              metadata: {
                name: "F1 Predict",
                description: "F1 Prediction Market",
                url: window.location.origin,
                icons: [`${window.location.origin}/favicon.ico`],
              },
            });
            
            if (wcProvider.session) {
              const accounts = wcProvider.accounts;
              if (accounts && accounts.length > 0 && accounts[0].toLowerCase() === savedAddress.toLowerCase()) {
                wcProviderRef.current = wcProvider;
                setWalletAddress(accounts[0]);
                setWalletType("walletconnect");
                
                const wcBrowserProvider = new ethers.BrowserProvider(wcProvider);
                setProvider(wcBrowserProvider);
                const wcSigner = await wcBrowserProvider.getSigner();
                setSigner(wcSigner);
                
                // Set up event listeners
                wcProvider.on("accountsChanged", (accts: string[]) => {
                  if (accts.length === 0) {
                    disconnectWallet();
                  } else {
                    setWalletAddress(accts[0]);
                    localStorage.setItem("polygon_wallet_address", accts[0]);
                  }
                });
                wcProvider.on("disconnect", () => {
                  disconnectWallet();
                });
              } else {
                localStorage.removeItem("polygon_wallet_type");
                localStorage.removeItem("polygon_wallet_address");
              }
            } else {
              localStorage.removeItem("polygon_wallet_type");
              localStorage.removeItem("polygon_wallet_address");
            }
          } catch (error) {
            console.log("Could not restore WalletConnect session:", error);
            localStorage.removeItem("polygon_wallet_type");
            localStorage.removeItem("polygon_wallet_address");
          }
        }
      } catch (error) {
        console.error("Error checking existing session:", error);
      } finally {
        setIsLoading(false);
      }
    };

    checkExistingSession();
  }, []);

  useEffect(() => {
    // Only set up listeners when wallet is actually connected (external or phantom)
    if ((walletType !== "external" && walletType !== "phantom") || !walletAddress) {
      return;
    }
    
    // Get the appropriate provider based on wallet type
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

      // Note: We intentionally don't auto-reload on chainChanged to prevent
      // reload loops. Users should manually refresh if they switch networks.

      ethProvider.on("accountsChanged", handleAccountsChanged);

      return () => {
        ethProvider.removeListener?.("accountsChanged", handleAccountsChanged);
      };
    }
  }, [walletType, walletAddress]);

  // Check for WalletConnect session when page becomes visible (critical for mobile)
  // When user navigates away to MetaMask and returns, we need to check if session was established
  // This also runs when isConnecting is true because on mobile, the session may have been
  // established while the user was in MetaMask and the enable() promise is still pending
  const wcSessionCheckInProgress = useRef(false);
  
  useEffect(() => {
    if (!WALLETCONNECT_PROJECT_ID) return;
    
    const checkWalletConnectSession = async (reason: string) => {
      // Prevent concurrent session checks
      if (wcSessionCheckInProgress.current) {
        console.log("[WC Visibility] Session check already in progress, skipping");
        return;
      }
      
      // Skip if we already have a connected wallet (not just connecting)
      if (walletAddress && walletType) {
        console.log("[WC Visibility] Already connected, skipping session check");
        return;
      }
      
      // Check if there's a pending connection or saved WC session data
      const connectionPending = localStorage.getItem("wc_connection_pending");
      const savedWcType = localStorage.getItem("polygon_wallet_type");
      const hasWcKeys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
        .some(key => key?.startsWith("wc@2:"));
      
      console.log("[WC Visibility] Check reason:", reason, "- pending:", connectionPending, "- savedType:", savedWcType, "- hasWcKeys:", hasWcKeys);
      
      wcSessionCheckInProgress.current = true;
      console.log("[WC Visibility] Checking for WalletConnect session...");
      
      try {
        const wcProvider = await WCEthereumProvider.init({
          projectId: WALLETCONNECT_PROJECT_ID,
          chains: [POLYGON_CHAIN_ID],
          showQrModal: false,
          metadata: {
            name: "F1 Predict",
            description: "F1 Prediction Market",
            url: window.location.origin,
            icons: [`${window.location.origin}/favicon.ico`],
          },
        });
        
        console.log("[WC Visibility] Provider initialized, session exists:", !!wcProvider.session);
        console.log("[WC Visibility] Session details:", wcProvider.session ? JSON.stringify({
          topic: wcProvider.session.topic,
          accounts: wcProvider.accounts,
        }) : "null");
        
        if (wcProvider.session) {
          const accounts = wcProvider.accounts;
          console.log("[WC Visibility] Session accounts:", accounts);
          if (accounts && accounts.length > 0) {
            console.log("[WC Visibility] Found active session, restoring:", accounts[0]);
            
            // Stop the connecting state if it was still active
            setIsConnecting(false);
            
            wcProviderRef.current = wcProvider;
            setWalletAddress(accounts[0]);
            setWalletType("walletconnect");
            setUserEmail(null);
            localStorage.setItem("polygon_wallet_type", "walletconnect");
            localStorage.setItem("polygon_wallet_address", accounts[0]);
            localStorage.removeItem("wc_connection_pending");
            
            const wcBrowserProvider = new ethers.BrowserProvider(wcProvider);
            setProvider(wcBrowserProvider);
            const wcSigner = await wcBrowserProvider.getSigner();
            setSigner(wcSigner);
            
            // Set up event listeners
            wcProvider.on("accountsChanged", (accts: string[]) => {
              if (accts.length === 0) {
                disconnectWallet();
              } else {
                setWalletAddress(accts[0]);
                localStorage.setItem("polygon_wallet_address", accts[0]);
              }
            });
            wcProvider.on("disconnect", () => {
              disconnectWallet();
            });
            
            console.log("[WC Visibility] Session restored successfully!");
          }
        } else {
          console.log("[WC Visibility] No active session found");
          // If connection was pending but no session found, clear the pending flag
          if (connectionPending) {
            console.log("[WC Visibility] Connection was pending but no session - clearing pending flag");
            localStorage.removeItem("wc_connection_pending");
          }
        }
      } catch (error: any) {
        console.log("[WC Visibility] Error checking session:", error?.message || error);
        // If we get a stale session error, clear the storage
        if (error.message?.includes("session topic doesn't exist") || 
            error.message?.includes("No matching key") ||
            error.message?.includes("Missing or invalid")) {
          console.log("[WC Visibility] Clearing stale session data...");
          const keysToRemove: string[] = [];
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && (key.startsWith("wc@2:") || key.startsWith("walletconnect"))) {
              keysToRemove.push(key);
            }
          }
          keysToRemove.forEach(key => localStorage.removeItem(key));
          localStorage.removeItem("wc_connection_pending");
          console.log("[WC Visibility] Cleared", keysToRemove.length, "stale entries");
        }
      } finally {
        wcSessionCheckInProgress.current = false;
      }
    };
    
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        // Check for pending WC connection when returning from another app
        const connectionPending = localStorage.getItem("wc_connection_pending");
        if (connectionPending) {
          console.log("[WC Visibility] Visibility changed, connection was pending - checking immediately");
          // Multiple checks with increasing delays to handle mobile timing
          setTimeout(() => checkWalletConnectSession("visibility-immediate"), 100);
          setTimeout(() => checkWalletConnectSession("visibility-delayed"), 500);
          setTimeout(() => checkWalletConnectSession("visibility-extra-delayed"), 1500);
        } else {
          // Standard visibility check
          setTimeout(() => checkWalletConnectSession("visibility-standard"), 300);
        }
      }
    };
    
    // Also check immediately on mount in case user is returning to a suspended tab
    // that was restored with session data in localStorage
    const connectionPendingOnMount = localStorage.getItem("wc_connection_pending");
    if (connectionPendingOnMount) {
      console.log("[WC Visibility] Mount detected pending WC connection");
      setTimeout(() => checkWalletConnectSession("mount-pending"), 100);
      setTimeout(() => checkWalletConnectSession("mount-pending-delayed"), 800);
    } else {
      setTimeout(() => checkWalletConnectSession("mount"), 100);
    }
    
    document.addEventListener("visibilitychange", handleVisibilityChange);
    
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [walletAddress, walletType]);

  const connectWithMagic = useCallback(async (email: string): Promise<boolean> => {
    console.log("[Magic Debug] connectWithMagic called with email:", email);
    setIsConnecting(true);
    try {
      console.log("[Magic Debug] Getting Magic instance...");
      const magic = await getMagic();
      if (!magic) {
        console.error("[Magic Debug] Magic instance is null - API key missing or creation failed");
        throw new Error("Magic not initialized - API key missing");
      }
      console.log("[Magic Debug] Magic instance obtained successfully");

      console.log("[Magic Debug] Calling magic.auth.loginWithMagicLink...");
      console.log("[Magic Debug] This should open a modal and send an email to:", email);
      
      try {
        await magic.auth.loginWithMagicLink({ email });
        console.log("[Magic Debug] loginWithMagicLink completed successfully");
      } catch (loginError: any) {
        console.error("[Magic Debug] loginWithMagicLink failed:", loginError);
        console.error("[Magic Debug] Error name:", loginError?.name);
        console.error("[Magic Debug] Error message:", loginError?.message);
        console.error("[Magic Debug] Error code:", loginError?.code);
        console.error("[Magic Debug] Full error object:", JSON.stringify(loginError, null, 2));
        throw loginError;
      }
      
      console.log("[Magic Debug] Getting user info...");
      const metadata = await magic.user.getInfo();
      console.log("[Magic Debug] User metadata:", JSON.stringify(metadata, null, 2));
      
      const publicAddress = (metadata as any).wallets?.ethereum?.publicAddress || metadata.publicAddress;
      console.log("[Magic Debug] Extracted public address:", publicAddress);
      
      if (publicAddress) {
        console.log("[Magic Debug] User authenticated successfully with address:", publicAddress);
        setWalletAddress(publicAddress);
        setUserEmail(metadata.email || null);
        setWalletType("magic");
        localStorage.setItem("polygon_wallet_type", "magic");
        localStorage.setItem("polygon_wallet_address", publicAddress);
        
        console.log("[Magic Debug] Creating ethers provider from Magic rpcProvider...");
        const magicProvider = new ethers.BrowserProvider(magic.rpcProvider as any);
        setProvider(magicProvider);
        const magicSigner = await magicProvider.getSigner();
        setSigner(magicSigner);
        console.log("[Magic Debug] Provider and signer set up successfully");
        
        return true;
      }
      console.log("[Magic Debug] No public address in metadata");
      return false;
    } catch (error: any) {
      console.error("[Magic Debug] connectWithMagic error:", error);
      console.error("[Magic Debug] Error type:", typeof error);
      console.error("[Magic Debug] Error name:", error?.name);
      console.error("[Magic Debug] Error message:", error?.message);
      console.error("[Magic Debug] Error stack:", error?.stack);
      return false;
    } finally {
      console.log("[Magic Debug] connectWithMagic completed, setting isConnecting to false");
      setIsConnecting(false);
    }
  }, []);

  const connectExternalWallet = useCallback(async (): Promise<boolean> => {
    setIsConnecting(true);
    try {
      console.log("Attempting to connect external wallet...");
      console.log("Initial diagnostics:", getProviderDiagnostics());
      
      // Wait for provider with retry logic (handles late injection)
      const ethProvider = await waitForProvider();
      
      if (!ethProvider) {
        const diagnostics = getProviderDiagnostics();
        console.error("No Ethereum provider detected after waiting. Diagnostics:", diagnostics);
        throw new Error(`No wallet detected. ${diagnostics}. Please make sure your wallet extension is installed, unlocked, and refresh the page.`);
      }
      
      console.log("Provider connected successfully");
      console.log("Provider isPhantom:", ethProvider.isPhantom);
      console.log("Provider isMetaMask:", ethProvider.isMetaMask);

      // IMPORTANT: Request accounts FIRST to get user authorization
      // Some wallets (like Phantom) require authorization before any other RPC calls
      console.log("Requesting account authorization...");
      const accounts = await ethProvider.request({ method: "eth_requestAccounts" });
      
      if (!accounts || accounts.length === 0) {
        throw new Error("No accounts returned. User may have rejected the connection request.");
      }
      
      const address = accounts[0];
      console.log("Account authorized:", address);

      // Now check and switch chain AFTER getting authorization
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

      // Set up wallet state
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
      // Re-throw so caller can display specific error message
      throw error;
    } finally {
      setIsConnecting(false);
    }
  }, []);

  // Check if Phantom is installed
  const isPhantomInstalled = useCallback((): boolean => {
    return !!(window.phantom?.ethereum || window.ethereum?.isPhantom);
  }, []);

  // Get Phantom's Ethereum provider specifically
  const getPhantomProvider = useCallback((): EthereumProvider | null => {
    // Phantom's preferred injection point
    if (window.phantom?.ethereum) {
      return window.phantom.ethereum;
    }
    // Phantom can also inject at window.ethereum with isPhantom flag
    if (window.ethereum?.isPhantom) {
      return window.ethereum;
    }
    return null;
  }, []);

  const connectPhantomWallet = useCallback(async (): Promise<boolean> => {
    setIsConnecting(true);
    try {
      console.log("[Phantom] Attempting to connect Phantom wallet...");
      console.log("[Phantom] window.phantom:", !!window.phantom);
      console.log("[Phantom] window.phantom.ethereum:", !!window.phantom?.ethereum);
      console.log("[Phantom] window.ethereum:", !!window.ethereum);
      console.log("[Phantom] window.ethereum.isPhantom:", !!window.ethereum?.isPhantom);
      
      const phantomProvider = getPhantomProvider();
      
      if (!phantomProvider) {
        throw new Error("Phantom wallet not detected. Please install the Phantom extension and refresh the page.");
      }
      
      console.log("[Phantom] Provider found, requesting accounts...");

      // Request accounts - this triggers Face ID/biometrics
      let accounts;
      try {
        accounts = await phantomProvider.request({ method: "eth_requestAccounts" });
        console.log("[Phantom] Accounts received:", accounts);
      } catch (accountError: any) {
        console.error("[Phantom] Error requesting accounts:", accountError);
        throw new Error(`Failed to get accounts: ${accountError.message || 'Unknown error'}`);
      }
      
      if (!accounts || accounts.length === 0) {
        throw new Error("No accounts returned. User may have rejected the connection request.");
      }
      
      const address = accounts[0];
      console.log("[Phantom] Account authorized:", address);

      // Check current network
      let chainIdHex;
      try {
        chainIdHex = await phantomProvider.request({ method: "eth_chainId" });
        console.log("[Phantom] Current chain ID hex:", chainIdHex);
      } catch (chainError: any) {
        console.error("[Phantom] Error getting chain ID:", chainError);
        // Continue anyway - some wallets don't support this
        chainIdHex = "0x89"; // Assume Polygon
      }
      
      const currentChainId = parseInt(chainIdHex, 16);
      console.log("[Phantom] Current chain ID:", currentChainId, "Target:", POLYGON_CHAIN_ID);

      if (currentChainId !== POLYGON_CHAIN_ID) {
        console.log("[Phantom] Switching to Polygon network...");
        try {
          await phantomProvider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: `0x${POLYGON_CHAIN_ID.toString(16)}` }],
          });
          console.log("[Phantom] Network switched successfully");
        } catch (switchError: any) {
          console.error("[Phantom] Network switch error:", switchError);
          if (switchError.code === 4902) {
            console.log("[Phantom] Adding Polygon network...");
            try {
              await phantomProvider.request({
                method: "wallet_addEthereumChain",
                params: [{
                  chainId: `0x${POLYGON_CHAIN_ID.toString(16)}`,
                  chainName: "Polygon Mainnet",
                  nativeCurrency: { name: "MATIC", symbol: "MATIC", decimals: 18 },
                  rpcUrls: [POLYGON_RPC],
                  blockExplorerUrls: ["https://polygonscan.com/"],
                }],
              });
              console.log("[Phantom] Polygon network added");
            } catch (addError: any) {
              console.error("[Phantom] Error adding network:", addError);
              // Continue anyway - wallet might already have Polygon
            }
          } else {
            // Don't throw - just log and continue, some mobile wallets handle this differently
            console.warn("[Phantom] Network switch failed but continuing:", switchError.message);
          }
        }
      }

      // Set up wallet state
      console.log("[Phantom] Setting wallet state...");
      setWalletAddress(address);
      setWalletType("phantom");
      setUserEmail(null);
      localStorage.setItem("polygon_wallet_type", "phantom");
      localStorage.setItem("polygon_wallet_address", address);
      
      console.log("[Phantom] Creating ethers provider...");
      const phantomBrowserProvider = new ethers.BrowserProvider(phantomProvider);
      setProvider(phantomBrowserProvider);
      
      console.log("[Phantom] Getting signer...");
      const phantomSigner = await phantomBrowserProvider.getSigner();
      setSigner(phantomSigner);
      
      console.log("[Phantom] Wallet connected successfully!");
      return true;
    } catch (error: any) {
      console.error("[Phantom] Connection error:", error);
      console.error("[Phantom] Error stack:", error.stack);
      throw error;
    } finally {
      setIsConnecting(false);
    }
  }, [getPhantomProvider]);

  const clearWalletConnectStorage = useCallback(() => {
    console.log("[WC] Clearing stale WalletConnect storage...");
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith("wc@2:") || key.startsWith("walletconnect"))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => {
      console.log("[WC] Removing:", key);
      localStorage.removeItem(key);
    });
    console.log("[WC] Cleared", keysToRemove.length, "WalletConnect storage items");
  }, []);

  const connectWalletConnect = useCallback(async (): Promise<boolean> => {
    if (!WALLETCONNECT_PROJECT_ID) {
      throw new Error("WalletConnect is not configured. Missing project ID.");
    }
    
    setIsConnecting(true);
    
    // Set a flag to indicate WalletConnect connection is in progress
    // This helps the visibility handler know to check for sessions
    localStorage.setItem("wc_connection_pending", "true");
    
    try {
      console.log("[WC] Initializing WalletConnect...");
      
      // NOTE: Do NOT clear storage here - on mobile, the session gets established
      // while user is in MetaMask. Clearing storage would erase that session.
      // Only clear storage when we detect a stale/invalid session error.
      
      // WalletConnect modal handles both desktop (shows QR) and mobile (shows wallet selection)
      const wcProvider = await WCEthereumProvider.init({
        projectId: WALLETCONNECT_PROJECT_ID,
        chains: [POLYGON_CHAIN_ID],
        showQrModal: true, // Modal handles mobile detection internally
        optionalChains: [],
        metadata: {
          name: "F1 Predict",
          description: "F1 Prediction Market - Trade on F1 Championship outcomes",
          url: window.location.origin,
          icons: [`${window.location.origin}/favicon.ico`],
        },
      });
      
      console.log("[WC] Provider initialized, enabling...");
      console.log("[WC] Existing session before enable:", !!wcProvider.session);
      
      // Check if there's already a valid session (mobile return case)
      if (wcProvider.session && wcProvider.accounts && wcProvider.accounts.length > 0) {
        console.log("[WC] Found existing session, using it directly");
        const address = wcProvider.accounts[0];
        
        // Store provider reference
        wcProviderRef.current = wcProvider;
        
        // Set up wallet state
        setWalletAddress(address);
        setWalletType("walletconnect");
        setUserEmail(null);
        localStorage.setItem("polygon_wallet_type", "walletconnect");
        localStorage.setItem("polygon_wallet_address", address);
        localStorage.removeItem("wc_connection_pending");
        
        const wcBrowserProvider = new ethers.BrowserProvider(wcProvider);
        setProvider(wcBrowserProvider);
        const wcSigner = await wcBrowserProvider.getSigner();
        setSigner(wcSigner);
        
        // Set up event listeners
        wcProvider.on("accountsChanged", (accts: string[]) => {
          if (accts.length === 0) {
            disconnectWallet();
          } else {
            setWalletAddress(accts[0]);
            localStorage.setItem("polygon_wallet_address", accts[0]);
          }
        });
        
        wcProvider.on("disconnect", () => {
          disconnectWallet();
        });
        
        console.log("[WC] Restored from existing session!");
        return true;
      }
      
      // WalletConnect modal handles both desktop (QR) and mobile (wallet selection) automatically
      await wcProvider.enable();
      
      const accounts = wcProvider.accounts;
      if (!accounts || accounts.length === 0) {
        throw new Error("No accounts returned from WalletConnect.");
      }
      
      const address = accounts[0];
      console.log("[WC] Connected:", address);
      
      // Store provider reference
      wcProviderRef.current = wcProvider;
      
      // Set up wallet state
      setWalletAddress(address);
      setWalletType("walletconnect");
      setUserEmail(null);
      localStorage.setItem("polygon_wallet_type", "walletconnect");
      localStorage.setItem("polygon_wallet_address", address);
      localStorage.removeItem("wc_connection_pending");
      
      const wcBrowserProvider = new ethers.BrowserProvider(wcProvider);
      setProvider(wcBrowserProvider);
      const wcSigner = await wcBrowserProvider.getSigner();
      setSigner(wcSigner);
      
      // Set up event listeners
      wcProvider.on("accountsChanged", (accts: string[]) => {
        if (accts.length === 0) {
          disconnectWallet();
        } else {
          setWalletAddress(accts[0]);
          localStorage.setItem("polygon_wallet_address", accts[0]);
        }
      });
      
      wcProvider.on("disconnect", () => {
        disconnectWallet();
      });
      
      console.log("[WC] Setup complete!");
      return true;
    } catch (error: any) {
      console.error("[WC] Connection error:", error);
      localStorage.removeItem("wc_connection_pending");
      // If session topic error, clear storage so next attempt starts fresh
      if (error.message?.includes("session topic doesn't exist")) {
        console.log("[WC] Detected stale session, clearing storage for retry...");
        clearWalletConnectStorage();
      }
      throw error;
    } finally {
      setIsConnecting(false);
    }
  }, [clearWalletConnectStorage]);

  const disconnectWallet = useCallback(async () => {
    try {
      if (walletType === "magic") {
        const magic = await getMagic();
        if (magic) {
          await magic.user.logout();
        }
      } else if (walletType === "walletconnect" && wcProviderRef.current) {
        try {
          await wcProviderRef.current.disconnect();
        } catch (e) {
          console.log("WalletConnect disconnect error:", e);
        }
        wcProviderRef.current = null;
      }
    } catch (error) {
      console.error("Logout error:", error);
    }
    
    // Invalidate all wallet-related caches
    queryClient.removeQueries({ queryKey: ["polymarket-cash-balance"] });
    queryClient.removeQueries({ queryKey: ["polygon-usdc-balance"] });
    queryClient.removeQueries({ queryKey: ["polymarket-positions"] });
    
    setWalletAddress(null);
    setWalletType(null);
    setUserEmail(null);
    setProvider(null);
    setSigner(null);
    localStorage.removeItem("polygon_wallet_type");
    localStorage.removeItem("polygon_wallet_address");
  }, [walletType]);

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
        isConnecting,
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
