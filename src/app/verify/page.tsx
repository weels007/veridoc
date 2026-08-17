"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@/lib/WalletContext";
import { readContract, writeContract, isTxSuccess, extractVerificationId, STAKE_REQUIRED, VERIFY_FEE } from "@/lib/contract";
import { useLive } from "@/lib/useLive";
import { toast } from "sonner";

export default function VerifyPage() {
  const { address } = useWallet();
  const { data: subjects } = useLive<any>("get_all_subjects", [], [], 20000);
  const { data: verifier } = useLive<any>(
    "get_verifier",
    address ? [address] : ["0x0000000000000000000000000000000000000000"],
    [address],
    20000
  );

  const [subjectId, setSubjectId] = useState("");
  const [claims, setClaims] = useState("");
  const [urls, setUrls] = useState("");
  const [level, setLevel] = useState("low");
  const [busy, setBusy] = useState(false);
  const [lastVid, setLastVid] = useState<string | null>(null);
  const [subjectInfo, setSubjectInfo] = useState<any>(null);

  useEffect(() => {
    if (!subjectId) return setSubjectInfo(null);
    readContract("get_subject", [subjectId]).then((info) => {
      // Only update when we got a real record (don't wipe on transient error).
      if (info && typeof info === "object" && Object.keys(info).length) {
        setSubjectInfo(info);
      }
    });
  }, [subjectId]);

  const myStake = verifier && Object.keys(verifier).length ? Number(verifier.stake) : 0;
  const subjectList = subjects && typeof subjects === "object" ? Object.entries(subjects) : [];

  async function verify() {
    if (!window.ethereum || !address) return toast.error("Connect your wallet first");
    const urlList = urls.split("\n").map((u) => u.trim()).filter(Boolean);
    if (!subjectId) return toast.error("Select a subject");
    if (!claims) return toast.error("Enter claims");
    if (urlList.length === 0) return toast.error("Enter at least one evidence URL");
    setBusy(true);
    try {
      const receipt = await writeContract(window.ethereum, "verify_claims", [subjectId, claims, urlList, level], VERIFY_FEE, address ?? undefined);
      const r = isTxSuccess(receipt);
      if (!r.ok) {
        toast.error(`Rejected: ${r.reason}`);
      } else {
        // Use the verification id returned by the transaction so reverify /
        // challenge can target this exact record (safe under concurrency).
        const vid = extractVerificationId(receipt);
        setLastVid(vid);
        toast.success(vid ? `Verification created: ${vid}` : "Verification submitted");
        setClaims(""); setUrls("");
      }
    } catch (e: any) {
      toast.error(e?.shortMessage || e?.message || "Verify failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 820 }}>
      <h1 style={{ margin: 0, fontSize: 20, color: "#1a3a66" }}>Verify Claims</h1>

      <fieldset className="office-fieldset">
        <legend>Verification Pipeline</legend>
        <div className="section-title">Submit claims + evidence URLs</div>

        <div className="grid-2" style={{ gap: 12 }}>
          <div>
            <div className="field-group">
              <label className="office-label">Subject</label>
              <select className="office-select" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
                <option value="">— select subject —</option>
                {subjectList.map(([sid, s]: any) => (
                  <option key={sid} value={sid}>{sid} — {s.name}</option>
                ))}
              </select>
            </div>

            {subjectInfo && (
              <div className="alert" style={{ marginBottom: 12 }}>
                <b>Required level:</b> {subjectInfo.required_level} · <b>Allowed domains:</b>{" "}
                <span className="mono">{subjectInfo.allowed_domains || "(any)"}</span>
              </div>
            )}

            <div className="field-group">
              <label className="office-label">Evidence level</label>
              <select className="office-select" value={level} onChange={(e) => setLevel(e.target.value)}>
                <option value="low">low (1 url)</option>
                <option value="medium">medium (2 urls)</option>
                <option value="high">high (3 urls)</option>
              </select>
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
              <label className="office-label">Claims (natural language)</label>
              <textarea className="office-textarea" rows={5} value={claims} onChange={(e) => setClaims(e.target.value)} placeholder="ACME Corp is headquartered in Berlin&#10;Founder is J. Doe" />
            </div>
            <div className="field-group">
              <label className="office-label">Evidence URLs (one per line)</label>
              <textarea className="office-textarea" rows={5} value={urls} onChange={(e) => setUrls(e.target.value)} placeholder={"https://acme.com/about\nhttps://registry.example.com/acme"} />
            </div>
            <button className="tool-btn primary" onClick={verify} disabled={busy}>
              {busy ? "Submitting… (AI consensus may take a minute)" : `Verify Claims (${VERIFY_FEE.toString()} GEN)`}
            </button>
            {lastVid && (
              <div style={{ marginTop: 10, padding: 8, background: "#e2efda", border: "1px solid #70ad47", fontSize: 12 }}>
                ✓ Created <span className="mono">{lastVid}</span> —{" "}
                <Link href={`/subjects/${subjectId}`}>open subject</Link> to reverify / challenge this exact record.
              </div>
            )}
          </div>
        </div>
      </fieldset>
    </div>
  );
}
