"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@/lib/WalletContext";
import { readContract, writeContract, isTxSuccess, extractVerificationId, tsToDate, shortAddr, STAKE_REQUIRED, VERIFY_FEE } from "@/lib/contract";
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
  const [result, setResult] = useState<any>(null); // get_verification result
  const [subjectInfo, setSubjectInfo] = useState<any>(null);

  useEffect(() => {
    if (!subjectId) return setSubjectInfo(null);
    readContract("get_subject", [subjectId]).then((info) => {
      if (info && typeof info === "object" && Object.keys(info).length) {
        setSubjectInfo(info);
      }
    });
  }, [subjectId]);

  const myStake = verifier && Object.keys(verifier).length ? Number(verifier.stake) : 0;
  const subjectList = subjects && typeof subjects === "object" ? Object.entries(subjects) : [];
  // Only subjects the connected wallet OWNS can be verified from this page.
  const addrLower = (address || "").toLowerCase();
  const mySubjects = subjectList.filter(([, s]: any) => String(s.owner).toLowerCase() === addrLower);

  async function verify() {
    if (!window.ethereum || !address) return toast.error("Connect your wallet first");
    const urlList = urls.split("\n").map((u) => u.trim()).filter(Boolean);
    if (!subjectId) return toast.error("Select a subject");
    if (!claims) return toast.error("Enter claims");
    if (urlList.length === 0) return toast.error("Enter at least one evidence URL");
    setBusy(true);
    setResult(null);
    try {
      const receipt = await writeContract(window.ethereum, "verify_claims", [subjectId, claims, urlList, level], VERIFY_FEE, address ?? undefined);
      const r = isTxSuccess(receipt);
      if (!r.ok) {
        toast.error(`Rejected: ${r.reason}`);
      } else {
        const vid = extractVerificationId(receipt);
        setLastVid(vid);
        toast.success(vid ? `Verification created: ${vid}` : "Verification submitted");
        setClaims(""); setUrls("");
        // Immediately show the recorded result in the side panel.
        if (vid) {
          readContract("get_verification", [vid]).then((rec) => {
            if (rec && typeof rec === "object" && Object.keys(rec).length) setResult(rec);
          });
        } else {
          setResult({ id: subjectId + ":pending" });
        }
      }
    } catch (e: any) {
      toast.error(e?.shortMessage || e?.message || "Verify failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <h1 style={{ margin: 0, fontSize: 20, color: "#1a3a66" }}>Verify Claims</h1>

      <div className="grid-2">
        {/* Form */}
        <fieldset className="office-fieldset">
          <legend>Verification Pipeline</legend>
          <div className="section-title">Submit claims + evidence URLs</div>

          <div className="field-group">
            <label className="office-label">Subject (only yours)</label>
            <select
              className="office-select"
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
              disabled={!address || mySubjects.length === 0}
            >
              <option value="">— select your subject —</option>
              {mySubjects.map(([sid, s]: any) => (
                <option key={sid} value={sid}>{sid} — {s.name}</option>
              ))}
            </select>
            {!address ? (
              <div style={{ marginTop: 4, fontSize: 11, color: "#9c6500" }}>
                Connect your wallet to verify your own subjects.
              </div>
            ) : mySubjects.length === 0 ? (
              <div style={{ marginTop: 4, fontSize: 11, color: "#9c6500" }}>
                You don't own any subjects yet. <Link href="/subjects">Create one</Link> first.
              </div>
            ) : null}
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

          <div className="field-group">
            <label className="office-label">Claims (natural language)</label>
            <textarea className="office-textarea" rows={4} value={claims} onChange={(e) => setClaims(e.target.value)} placeholder="ACME Corp is headquartered in Berlin&#10;Founder is J. Doe" />
          </div>
          <div className="field-group">
            <label className="office-label">Evidence URLs (one per line)</label>
            <textarea className="office-textarea" rows={4} value={urls} onChange={(e) => setUrls(e.target.value)} placeholder={"https://acme.com/about\nhttps://registry.example.com/acme"} />
          </div>
          <button className="tool-btn primary" onClick={verify} disabled={busy}>
            {busy ? "Submitting… (AI consensus may take a minute)" : `Verify Claims (${VERIFY_FEE.toString()} GEN)`}
          </button>
        </fieldset>

        {/* Result panel (fills the empty space next to the form) */}
        <fieldset className="office-fieldset">
          <legend>Result</legend>
          <div className="section-title">
            {result ? "Latest verification" : "Verification result"}
          </div>

          {busy ? (
            <div className="empty">Submitting… AI consensus in progress.</div>
          ) : result ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {result.status && (
                <div>
                  <span className={result.status === "VERIFIED" ? "badge badge-green" : result.status === "UNVERIFIED" ? "badge badge-red" : "badge badge-yellow"}>
                    {result.status}
                  </span>
                </div>
              )}
              {result.id && (
                <div className="field-group" style={{ margin: 0 }}>
                  <label className="office-label">Verification ID</label>
                  <div className="mono" style={{ fontSize: 11 }}>{result.id}</div>
                </div>
              )}
              {result.evidence_level && (
                <div>
                  <label className="office-label">Evidence level</label>
                  <div>{result.evidence_level}</div>
                </div>
              )}
              {result.verifier && (
                <div>
                  <label className="office-label">Verifier</label>
                  <div className="mono">{shortAddr(result.verifier)}</div>
                </div>
              )}
              {result.verified_ts ? (
                <div>
                  <label className="office-label">When</label>
                  <div>{tsToDate(result.verified_ts)}</div>
                </div>
              ) : (
                <div className="alert" style={{ marginTop: 6 }}>
                  Verification submitted. Refresh a moment and it will appear in subject history.
                </div>
              )}
              {result.reasoning && (
                <div>
                  <label className="office-label">Reasoning</label>
                  <div style={{ fontSize: 12, color: "#333" }}>{result.reasoning}</div>
                </div>
              )}
              {lastVid && (
                <div style={{ marginTop: 6 }}>
                  <Link className="tool-btn" href={`/subjects/${subjectId}`}>Open subject →</Link>
                </div>
              )}
            </div>
          ) : (
            <div className="empty">
              Submit a verification to see the result here — status, level, verifier and reasoning will appear in this panel.
            </div>
          )}
        </fieldset>
      </div>
    </div>
  );
}
