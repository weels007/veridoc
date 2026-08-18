"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useWallet } from "@/lib/WalletContext";
import { readContract, writeContract, isTxSuccess, tsToDate, shortAddr, STAKE_REQUIRED } from "@/lib/contract";
import { useLive } from "@/lib/useLive";
import { toast } from "sonner";

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    VERIFIED: "badge badge-green",
    UNVERIFIED: "badge badge-red",
    INCONCLUSIVE: "badge badge-yellow",
    EXPIRED: "badge badge-gray",
  };
  return <span className={map[status] || "badge badge-gray"}>{status}</span>;
}

export default function SubjectDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { address } = useWallet();

  const { data: subject, loading } = useLive<any>("get_subject", [id], [id], 20000);
  const { data: verifications, reload: reloadVerifs } = useLive<any>("get_subject_verifications", [id], [id], 20000);
  const { data: verdict, reload: reloadVerdict } = useLive<any>("get_subject_verdict", [id], [id], 20000);
  const { data: verifiedFlag, reload: reloadFlag } = useLive<any>("is_verified", [id], [id], 20000);
  const { data: verifier } = useLive<any>(
    "get_verifier",
    address ? [address] : ["0x0000000000000000000000000000000000000000"],
    [address],
    8000
  );

  const [busy, setBusy] = useState(false);
  const [claims, setClaims] = useState("");
  const [urls, setUrls] = useState("");
  const [level, setLevel] = useState("low");

  const reloadAll = useCallback(() => {
    reloadVerifs();
    reloadVerdict();
    reloadFlag();
  }, [reloadVerifs, reloadVerdict, reloadFlag]);

  async function run(fn: string, args: any[], value: bigint, successMsg: string) {
    if (!window.ethereum || !address) return toast.error("Connect your wallet first");
    setBusy(true);
    try {
      const receipt = await writeContract(window.ethereum, fn, args, value, address ?? undefined);
      const r = isTxSuccess(receipt);
      if (!r.ok) {
        toast.error(`Rejected: ${r.reason}`);
      } else {
        toast.success(successMsg);
        reloadAll();
      }
    } catch (e: any) {
      toast.error(e?.shortMessage || e?.message || `${fn} failed`);
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    const urlList = urls.split("\n").map((u) => u.trim()).filter(Boolean);
    if (!claims) return toast.error("Enter the claims to verify");
    if (urlList.length === 0) return toast.error("Enter at least one evidence URL");
    await run("verify_claims", [id, claims, urlList, level], 100n, "Verification submitted");
  }

  async function reverify(vid: string) {
    await run("reverify", [vid], 0n, "Reverify done");
  }

  async function challenge(vid: string) {
    const urlList = urls.split("\n").map((u) => u.trim()).filter(Boolean);
    if (urlList.length === 0) return toast.error("Enter counter-evidence URLs first");
    await run("challenge_verification", [vid, urlList], 100n, "Challenge submitted");
  }

  if (!loading && (!subject || Object.keys(subject).length === 0)) {
    return (
      <div className="window" style={{ padding: 12 }}>
        Subject <span className="mono">{id}</span> not found. <Link href="/subjects">Back to subjects</Link>
      </div>
    );
  }

  const vList = Object.entries(verifications || {});
  const myStake = verifier && Object.keys(verifier).length ? Number(verifier.stake) : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Link className="tool-btn" href="/subjects">← Subjects</Link>
        <h1 style={{ margin: 0, fontSize: 20, color: "#1a3a66" }}>{subject?.name ?? "Loading subject…"}</h1>
        {verifiedFlag !== null && verifiedFlag !== undefined && (
          <span className={verifiedFlag ? "badge badge-green" : "badge badge-red"}>
            {verifiedFlag ? "● VERIFIED" : "○ Not verified"}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {loading && <span className="badge badge-gray">syncing…</span>}
        <button className="tool-btn" onClick={reloadAll}>↻ Refresh</button>
      </div>

      <div className="grid-3">
        {/* Info */}
        <fieldset className="office-fieldset">
          <legend>Subject Details</legend>
          <div className="section-title">On-chain record</div>
          <table className="office-table">
            <tbody>
              <tr><td style={{ width: 130 }}><b>ID</b></td><td className="mono">{subject?.id ?? "…"}</td></tr>
              <tr><td><b>Owner</b></td><td className="mono">{subject?.owner ?? "…"}</td></tr>
              <tr><td><b>Category</b></td><td>{subject?.category ?? "…"}</td></tr>
              <tr><td><b>Required level</b></td><td>{subject?.required_level ?? "…"}</td></tr>
              <tr><td><b>Allowed domains</b></td><td className="mono">{subject?.allowed_domains || "(any)"}</td></tr>
              <tr><td><b>Trust score</b></td><td>{subject?.trust_score ?? "…"}</td></tr>
              <tr><td><b>Verified count</b></td><td>{subject?.verified_count ?? "…"}</td></tr>
            </tbody>
          </table>
          <div style={{ marginTop: 8, padding: 8, background: "#fff", border: "1px solid #a09b91" }}>
            {subject?.description ?? "…"}
          </div>

          <div style={{ marginTop: 10 }}>
            <div className="section-title">Verdict</div>
            {verdict && Object.keys(verdict).length > 0 ? (
              <table className="office-table">
                <tbody>
                  <tr><td style={{ width: 130 }}><b>Status</b></td><td><StatusBadge status={verdict.status} /></td></tr>
                  <tr><td><b>Trust</b></td><td>{verdict.trust_score}</td></tr>
                  <tr><td><b>Last verified</b></td><td>{tsToDate(verdict.last_verified_ts)}</td></tr>
                  <tr><td><b>Expires</b></td><td>{tsToDate(verdict.expires_ts)}</td></tr>
                </tbody>
              </table>
            ) : (
              <div className="empty">No verdict yet.</div>
            )}
          </div>
        </fieldset>

        {/* Verify form */}
        <fieldset className="office-fieldset">
          <legend>New Verification</legend>
          <div className="section-title">Submit claims + evidence</div>
          <div className="field-group">
            <label className="office-label">Claims (natural language)</label>
            <textarea className="office-textarea" rows={4} value={claims} onChange={(e) => setClaims(e.target.value)} placeholder="ACME Corp is headquartered in Berlin" />
          </div>
          <div className="field-group">
            <label className="office-label">Evidence URLs (one per line)</label>
            <textarea className="office-textarea" rows={4} value={urls} onChange={(e) => setUrls(e.target.value)} placeholder={"https://acme.com/about\nhttps://registry.example.com/acme"} />
          </div>
          <div className="field-group">
            <label className="office-label">Evidence level</label>
            <select className="office-select" value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
          </div>
          <button className="tool-btn primary" onClick={verify} disabled={busy}>
            {busy ? "Submitting… (AI consensus)" : "Verify Claims (100 GEN)"}
          </button>
          <div style={{ marginTop: 8, fontSize: 12, color: "#555" }}>
            {address ? (
              myStake >= STAKE_REQUIRED ? (
                <span className="badge badge-green">Stake OK ({myStake} GEN)</span>
              ) : (
                <span className="badge badge-yellow">Stake {myStake} GEN — need ≥ {STAKE_REQUIRED}</span>
              )
            ) : (
              <span>Connect wallet to verify.</span>
            )}
          </div>
        </fieldset>

        {/* Verifications history */}
        <fieldset className="office-fieldset">
          <legend>Verifications</legend>
          <div className="section-title">History ({vList.length})</div>
          {vList.length === 0 ? (
            <div className="empty">No verifications yet.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 560, overflowY: "auto", paddingRight: 4 }}>
              {vList.map(([vid, v]: any) => (
                <VerificationCard
                  key={vid}
                  vid={vid}
                  v={v}
                  busy={busy}
                  onReverify={() => reverify(vid)}
                  onChallenge={() => challenge(vid)}
                />
              ))}
            </div>
          )}
          <div style={{ marginTop: 10, fontSize: 11, color: "#777" }}>
            Two-party challenge: the judge re-fetches the original verifier evidence AND your counter-evidence.
            To challenge, enter counter-evidence URLs above, then click Challenge.
          </div>
        </fieldset>
      </div>
    </div>
  );
}

function VerificationCard({
  vid,
  v,
  busy,
  onReverify,
  onChallenge,
}: {
  vid: string;
  v: any;
  busy: boolean;
  onReverify: () => void;
  onChallenge: () => void;
}) {
  const [revs, setRevs] = useState<Record<string, any> | null>(null);
  const [showRevs, setShowRevs] = useState(false);

  async function toggleRevisions() {
    if (showRevs) return setShowRevs(false);
    const r = await readContract("get_verification_revisions", [vid]);
    // Keep existing trail on transient failure; only replace with a real result.
    if (r !== null) setRevs(r);
    setShowRevs(true);
  }

  return (
    <div className="window" style={{ padding: 10, boxShadow: "none", background: "#f1efe9" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <StatusBadge status={v.status} />
        <span className="badge badge-gray">{v.evidence_level}</span>
        <span style={{ flex: 1 }} />
        <button className="tool-btn" onClick={toggleRevisions}>Revisions</button>
        <button className="tool-btn" onClick={onReverify} disabled={busy}>Reverify</button>
        <button className="tool-btn" onClick={onChallenge} disabled={busy}>Challenge</button>
      </div>
      <div style={{ marginTop: 6, fontSize: 12 }}>
        <span className="mono">{shortAddr(v.verifier)}</span> · {tsToDate(v.verified_ts)} ·{" "}
        {v.revision_count ? `${v.revision_count} revision(s)` : ""}
      </div>
      <div style={{ marginTop: 6, fontSize: 11 }} className="mono">{vid}</div>
      {showRevs && (
        <div style={{ marginTop: 8, borderTop: "1px solid #a09b91", paddingTop: 8 }}>
          {revs && Object.keys(revs).length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {Object.entries(revs).map(([rev, r]: any) => (
                <div key={rev} style={{ padding: 6, background: "#fff", border: "1px solid #a8a39a", fontSize: 11 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <b>rev {rev}</b>
                    <StatusBadge status={r.status} />
                    <span className="mono">{shortAddr(r.actor)}</span>
                    <span>{tsToDate(r.ts)}</span>
                  </div>
                  <div className="mono" style={{ marginTop: 4 }}>{r.evidence_urls}</div>
                  <div style={{ color: "#555", marginTop: 2 }}>{r.reasoning}</div>
                  <div className="mono" style={{ color: "#777", marginTop: 2 }} title={r.evidence_hash}>
                    hash: {r.evidence_hash?.slice(0, 20)}…
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: "#777" }}>No revision trail found.</div>
          )}
        </div>
      )}
    </div>
  );
}
