"use client";

import { useWallet } from "@/lib/WalletContext";
import { getContractAddress } from "@/lib/genlayer-client";

export function StatusBar() {
  const { address, isAdmin } = useWallet();
  return (
    <div className="statusbar">
      <span className="sb-item" style={{ background: "#ddebf7", color: "#1a3a66" }}>
        ● Connected to Studionet
      </span>
      <span className="sb-item mono" title="Contract address">
        {getContractAddress()}
      </span>
      <span style={{ flex: 1 }} />
      {isAdmin && <span className="sb-item" style={{ background: "#c6efce" }}>👑 Admin</span>}
      <span className="sb-item mono">{address ? address : "not connected"}</span>
    </div>
  );
}
