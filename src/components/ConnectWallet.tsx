"use client";

import { useWallet } from "@/lib/WalletContext";
import { shortAddr } from "@/lib/contract";

export function ConnectWallet() {
  const { address, isConnecting, connect, disconnect } = useWallet();

  if (address) {
    return (
      <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span className="tool-btn" title={address} style={{ cursor: "default", background: "#ddebf7" }}>
          <span className="mono">● {shortAddr(address)}</span>
        </span>
        <button className="tool-btn" onClick={disconnect} title="Disconnect">
          ✕
        </button>
      </span>
    );
  }

  return (
    <button className="tool-btn primary" onClick={connect} disabled={isConnecting}>
      {isConnecting ? "Connecting…" : "🔌 Connect Wallet"}
    </button>
  );
}
