"use client";

import { useWallet } from "@/lib/WalletContext";
import { useLive } from "@/lib/useLive";
import { shortAddr } from "@/lib/contract";
import { STAKE_REQUIRED } from "@/lib/contract";

export function VerifierCard() {
  const { address } = useWallet();
  const { data: verifier, loading } = useLive<any>(
    "get_verifier",
    address ? [address] : ["0x0000000000000000000000000000000000000000"],
    [address],
    20000
  );

  if (!address) {
    return (
      <div className="alert">Connect your wallet to view your on-chain verifier profile.</div>
    );
  }

  const has = verifier && Object.keys(verifier).length > 0;
  const stake = has ? Number(verifier.stake) : 0;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span className="badge badge-blue mono">{shortAddr(address)}</span>
        <span className={stake >= STAKE_REQUIRED ? "badge badge-green" : "badge badge-yellow"}>
          {stake >= STAKE_REQUIRED ? "Eligible to verify" : "Insufficient stake"}
        </span>
      </div>

      {loading ? (
        <div style={{ padding: 8 }}>Loading on-chain profile…</div>
      ) : has ? (
        <table className="office-table">
          <tbody>
            <tr>
              <td style={{ width: 180 }}><b>Stake</b></td>
              <td>{verifier.stake} GEN</td>
            </tr>
            <tr>
              <td><b>Total verifications</b></td>
              <td>{verifier.total_verifications}</td>
            </tr>
            <tr>
              <td><b>Verified count</b></td>
              <td>{verifier.verified_count}</td>
            </tr>
            <tr>
              <td><b>Reputation score</b></td>
              <td>{verifier.reputation_score}</td>
            </tr>
          </tbody>
        </table>
      ) : (
        <div className="empty">No verifier record on-chain yet. Deposit stake to begin.</div>
      )}
    </div>
  );
}
