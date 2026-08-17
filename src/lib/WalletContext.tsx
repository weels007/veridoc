"use client";

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { getClient } from "./genlayer-client";
import { toast } from "sonner";

declare global {
  interface Window {
    ethereum?: any;
  }
}

type WalletState = {
  address: string | null;
  isConnecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  isAdmin: boolean;
};

const ADMIN = (process.env.NEXT_PUBLIC_ADMIN_ADDRESS || "0xc2d388EEBFc9CBEA6fE34A94505dEbE24daE9300").toLowerCase();

const WalletContext = createContext<WalletState>({
  address: null,
  isConnecting: false,
  connect: async () => {},
  disconnect: () => {},
  isAdmin: false,
});

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const checkConnection = useCallback(async () => {
    if (typeof window === "undefined" || !window.ethereum) return;
    try {
      const accounts = await window.ethereum.request({ method: "eth_accounts" });
      if (accounts.length > 0) setAddress(accounts[0]);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    checkConnection();
    if (window.ethereum) {
      window.ethereum.on?.("accountsChanged", (accs: string[]) => {
        setAddress(accs[0] ?? null);
      });
    }
  }, [checkConnection]);

  async function connect() {
    if (typeof window === "undefined") return;
    if (!window.ethereum) {
      toast.error("Install MetaMask / a web3 wallet to connect");
      return;
    }
    setIsConnecting(true);
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      setAddress(accounts[0]);
      // Switch to studionet (best-effort)
      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0xF22F" }],
        });
      } catch (switchError: any) {
        if (switchError.code === 4902) {
          try {
            await window.ethereum.request({
              method: "wallet_addEthereumChain",
              params: [
                {
                  chainId: "0xF22F",
                  chainName: "Studionet",
                  nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
                  rpcUrls: ["https://studio.genlayer.com/api"],
                  blockExplorerUrls: ["https://explorer-studio.genlayer.com"],
                },
              ],
            });
          } catch (addError: any) {
            console.log("Network may already exist:", addError);
          }
        }
      }
      toast.success("Wallet connected");
    } catch (e) {
      console.error(e);
      toast.error("Could not connect wallet");
    } finally {
      setIsConnecting(false);
    }
  }

  function disconnect() {
    setAddress(null);
  }

  const isAdmin = !!address && address.toLowerCase() === ADMIN;

  return (
    <WalletContext.Provider value={{ address, isConnecting, connect, disconnect, isAdmin }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  return useContext(WalletContext);
}

export function walletClient(address: string) {
  return getClient(address as `0x${string}`, window.ethereum);
}
