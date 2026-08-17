"use client";

import { useState } from "react";
import { useWallet } from "@/lib/WalletContext";
import { writeContract, isTxSuccess, STAKE_REQUIRED } from "@/lib/contract";
import { useLive } from "@/lib/useLive";
import { toast } from "sonner";

export default function StakePage() {
  const { address } = useWallet();
  const { data: verifier, loading, reload } = useLive<any>(
    "get_verifier",
    address ? [address] : ["0x0000000000000000000000000000000000000000"],
    [address],
    20000
  );

  const [amount, setAmount] = useState("1000");
  const [withdrawAmount, setWithdrawAmount] = useState("100");
  const [busy, setBusy] = useState(false);

  const has = verifier && Object.keys(verifier).length > 0;
  const stake = has ? Number(verifier.stake) : 0;

  async function deposit() {
    if (!window.ethereum || !address) return toast.error("Connect your wallet first");
    const amt = BigInt(amount || "0");
    if (amt <= 0n) return toast.error("Enter a positive amount");
    setBusy(true);
    try {
      const receipt = await writeContract(window.ethereum, "deposit_stake", [], amt, address ?? undefined);
      const r = isTxSuccess(receipt);
      if (!r.ok) {
        toast.error(`Rejected: ${r.reason}`);
      } else {
        toast.success(`Staked ${amount} GEN`);
        reload();
      }
    } catch (e: any) {
      toast.error(e?.shortMessage || e?.message || "Stake failed");
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    if (!window.ethereum || !address) return toast.error("Connect your wallet first");
    const amt = BigInt(withdrawAmount || "0");
    if (amt <= 0n) return toast.error("Enter a positive amount");
    setBusy(true);
    try {
      const receipt = await writeContract(window.ethereum, "withdraw_stake", [amt], 0n, address ?? undefined);
      const r = isTxSuccess(receipt);
      if (!r.ok) {
        toast.error(`Rejected: ${r.reason}`);
      } else {
        toast.success(`Withdrew ${withdrawAmount} GEN`);
        reload();
      }
    } catch (e: any) {
      toast.error(e?.shortMessage || e?.message || "Withdraw failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 820 }}>
      <h1 style={{ margin: 0, fontSize: 20, color: "#1a3a66" }}>Stake Management</h1>

      <fieldset className="office-fieldset">
        <legend>Your Verifier Record</legend>
        <div className="section-title">On-chain stake & reputation</div>
        {!address ? (
          <div className="alert">Connect your wallet to view your on-chain verifier record.</div>
        ) : loading ? (
          <div className="empty">Loading on-chain profile…</div>
        ) : !has ? (
          <div className="empty">No verifier record on-chain yet. Deposit stake to begin.</div>
        ) : (
          <div className="grid-3">
            <div className="stat-card green">
              <div className="stat-label">Stake</div>
              <div className="stat-value">{verifier.stake} <span style={{ fontSize: 14 }}>GEN</span></div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Verifications</div>
              <div className="stat-value">{verifier.total_verifications}</div>
            </div>
            <div className="stat-card yellow">
              <div className="stat-label">Reputation</div>
              <div className="stat-value">{verifier.reputation_score}</div>
            </div>
          </div>
        )}
      </fieldset>

      <div className="grid-2">
        <fieldset className="office-fieldset">
          <legend>Deposit</legend>
          <div className="section-title">Add stake (required: ≥ {STAKE_REQUIRED} GEN)</div>
          <div className="field-group">
            <label className="office-label">Amount (GEN)</label>
            <input className="office-input" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <button className="tool-btn primary" onClick={deposit} disabled={busy}>
            {busy ? "Submitting…" : "Deposit Stake"}
          </button>
        </fieldset>

        <fieldset className="office-fieldset">
          <legend>Withdraw</legend>
          <div className="section-title">Withdraw stake (current: {stake} GEN)</div>
          <div className="field-group">
            <label className="office-label">Amount (GEN)</label>
            <input className="office-input" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} />
          </div>
          <button className="tool-btn" onClick={withdraw} disabled={busy || !has}>
            {busy ? "Submitting…" : "Withdraw Stake"}
          </button>
        </fieldset>
      </div>
    </div>
  );
}
