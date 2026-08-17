"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ConnectWallet } from "./ConnectWallet";
import { useLive } from "@/lib/useLive";
import { getContractAddress } from "@/lib/genlayer-client";

const MENU = [
  { href: "/", label: "Dashboard", icon: "🏠" },
  { href: "/how-it-works", label: "How it works", icon: "ℹ️" },
  { href: "/subjects", label: "Subjects", icon: "🗂" },
  { href: "/history", label: "History", icon: "📜" },
  { href: "/verify", label: "Verify", icon: "✅" },
  { href: "/challenge", label: "Challenge", icon: "⚖️" },
  { href: "/stake", label: "Stake", icon: "💰" },
];

export function Header() {
  const pathname = usePathname();
  const { data: stats } = useLive<any>("get_contract_stats", [], [], 20000);
  const { data: verified } = useLive<any>("get_verified_subjects", [], [], 25000);

  const verifiedCount = verified && typeof verified === "object" ? Object.keys(verified).length : 0;

  return (
    <div style={{ flexShrink: 0, boxShadow: "0 2px 8px rgba(0,0,0,0.35)", position: "relative", zIndex: 10 }}>
      {/* Title bar */}
      <div className="window-titlebar">
        <span style={{ fontSize: 14 }}>📋</span>
        <span>veridoc — Real-World KYC Verifier</span>
        <span style={{ fontSize: 11, fontWeight: "normal", opacity: 0.85 }}>
          GenLayer Intelligent Contract
        </span>
        <span className="win-buttons">
          <button className="win-btn" onClick={() => window.open("https://explorer-studio.genlayer.com", "_blank")} title="Explorer">?</button>
        </span>
      </div>

      {/* Menu bar */}
      <div className="menubar">
        {MENU.map((m) => (
          <Link
            key={m.href}
            href={m.href}
            className={`menubar-item ${pathname === m.href ? "active" : ""}`}
          >
            {m.icon} {m.label}
          </Link>
        ))}
        <span style={{ flex: 1 }} />
        <ConnectWallet />
      </div>

      {/* Toolbar with live on-chain data */}
      <div className="toolbar">
        <span className="tool-btn" style={{ cursor: "default" }}>
          <b>{stats?.subjects ?? "…"}</b>&nbsp;Subjects
        </span>
        <span className="tool-btn" style={{ cursor: "default" }}>
          <b>{stats?.verifications ?? "…"}</b>&nbsp;Verifications
        </span>
        <span className="tool-btn" style={{ cursor: "default" }}>
          <b>{stats?.verifiers ?? "…"}</b>&nbsp;Verifiers
        </span>
        <span className="tool-btn" style={{ cursor: "default" }}>
          <b>{verifiedCount}</b>&nbsp;Freshly verified
        </span>
        <span className="tool-btn" style={{ cursor: "default" }}>
          Fee balance: <b>{stats?.fee_balance ?? "…"}</b> GEN
        </span>
        <span className="toolbar-sep" />
        <span className="tool-btn mono" title="Contract address" style={{ cursor: "default", color: "#1a3a66" }}>
          {getContractAddress()}
        </span>
      </div>
    </div>
  );
}
