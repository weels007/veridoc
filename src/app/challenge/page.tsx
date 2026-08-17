"use client";

import { useEffect, useState, useCallback } from "react";
import { useWallet } from "@/lib/WalletContext";
import { readContract, writeContract, isTxSuccess, shortAddr, tsToDate, CHALLENGE_FEE, STAKE_REQUIRED } from "@/lib/contract";
import { useLive } from "@/lib/useLive";
import { toast } from "sonner";

export default function ChallengePage() {
  const { address } = useWallet();
  const { data: subjects } = useLive<any>("get_all_subjects", [], [], 20000);
  const { data: verifier } = useLive<any>(
    "get_verifier",
    address ? [address] : ["0x0000000000000000000000000000000000000000"],
    [address],
    20000
  );

  const [subjectId, setSubjectId] = useState("");
  const [verifications, setVerifications] = useState<Record<string, any> | null>(null);
  const [vid, setVid] = useState("");
  const [urls, setUrls] = useState("");
  const [busy, setBusy] = useState(false);

  const myStake = verifier && Object.keys(verifier).length ? Number(verifier.stake) : 0;
  const subjectList = subjects && typeof subjects === "object" ? Object.entries(subjects) : [];

  async function selectSubject(sid: string) {
    setSubjectId(sid);
    setVid("");
    if (!sid) {
      setVerifications(null);
      return;
    }
    const v = await readContract("get_subject_verifications", [sid]);
    // Keep the previous list on a transient read failure instead of clearing it.
    if (v !== null) setVerifications(v);
  }

  async function challenge() {
    if (!window.ethereum || !address) return toast.error("Connect your wallet first");
    const urlList = urls.split("\n").map((u) => u.trim()).filter(Boolean);
    if (!vid) return toast.error("Select a VERIFIED verification");
    if (urlList.length === 0) return toast.error("Enter counter-evidence URLs");
    setBusy(true);
    try {
      const receipt = await writeContract(window.ethereum, "challenge_verification", [vid, urlList], CHALLENGE_FEE, address ?? undefined);
      const r = isTxSuccess(receipt);
      if (!r.ok) {
        toast.error(`Rejected: ${r.reason}`);
      } else {
        toast.success("Challenge submitted");
      }
    } catch (e: any) {
      toast.error(e?.shortMessage || e?.message || "Challenge failed");
    } finally {
      setBusy(false);
    }
  }

  const vList = Object.entries(verifications || {}).filter(([, v]: any) => v.status === "VERIFIED");
  const allList = Object.entries(verifications || {});

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 820 }}>
      <h1 style={{ margin: 0, fontSize: 20, color: "#1a3a66" }}>Challenge a Verification</h1>

      <fieldset className="office-fieldset">
        <legend>Challenge</legend>
        <div className="section-title">Contradict a VERIFIED claim</div>
        <div className="alert" style={{ marginBottom: 12 }}>
          ⚖ If the claim flips to UNVERIFIED, the original verifier is slashed 500 GEN and you are rewarded half.
        </div>

        <div className="grid-2" style={{ gap: 12 }}>
          <div>
            <div className="field-group">
              <label className="office-label">Subject</label>
              <select className="office-select" value={subjectId} onChange={(e) => selectSubject(e.target.value)}>
                <option value="">— select subject —</option>
                {subjectList.map(([sid, s]: any) => (
                  <option key={sid} value={sid}>{sid} — {s.name}</option>
                ))}
              </select>
            </div>

            <div className="field-group">
              <label className="office-label">VERIFIED verification to challenge</label>
              <select className="office-select" value={vid} onChange={(e) => setVid(e.target.value)} disabled={!subjectId}>
                <option value="">— select verification —</option>
                {vList.map(([idv, v]: any) => (
                  <option key={idv} value={idv}>{idv} · verifier {shortAddr(v.verifier)}</option>
                ))}
              </select>
              {subjectId && vList.length === 0 && (
                <div style={{ marginTop: 4, fontSize: 11, color: "#9c6500" }}>
                  No VERIFIED verifications for this subject (only VERIFIED can be challenged). {allList.length} total.
                </div>
              )}
            </div>

            <div className="field-group">
              <label className="office-label">Your stake</label>
              <div>
                {address ? (
                  myStake >= STAKE_REQUIRED ? (
                    <span className="badge badge-green">Eligible · {myStake} GEN staked</span>
                  ) : (
                    <span className="badge badge-yellow">Stake {myStake} GEN — need ≥ {STAKE_REQUIRED}</span>
                  )
                ) : (
                  <span className="badge badge-gray">Connect wallet</span>
                )}
              </div>
            </div>
          </div>

          <div>
            <div className="field-group">
              <label className="office-label">Counter-evidence URLs (one per line)</label>
              <textarea className="office-textarea" rows={6} value={urls} onChange={(e) => setUrls(e.target.value)} placeholder={"https://registry.example.com/acme/revoked"} />
            </div>
            <button className="tool-btn danger" onClick={challenge} disabled={busy}>
              {busy ? "Submitting…" : `Challenge (${CHALLENGE_FEE.toString()} GEN)`}
            </button>
          </div>
        </div>
      </fieldset>

      {subjectId && allList.length > 0 && (
        <fieldset className="office-fieldset">
          <legend>All verifications for subject</legend>
          <div className="section-title">Live on-chain history</div>
          <div className="table-wrap">
            <table className="office-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Level</th>
                  <th>Verifier</th>
                  <th>When</th>
                  <th>ID</th>
                </tr>
              </thead>
              <tbody>
                {allList.map(([idv, v]: any) => (
                  <tr key={idv}>
                    <td>
                      {v.status === "VERIFIED" ? <span className="badge badge-green">VERIFIED</span>
                        : v.status === "UNVERIFIED" ? <span className="badge badge-red">UNVERIFIED</span>
                        : <span className="badge badge-yellow">INCONCLUSIVE</span>}
                    </td>
                    <td>{v.evidence_level}</td>
                    <td className="mono">{shortAddr(v.verifier)}</td>
                    <td>{tsToDate(v.verified_ts)}</td>
                    <td className="mono" style={{ fontSize: 10 }}>{idv}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </fieldset>
      )}
    </div>
  );
}
