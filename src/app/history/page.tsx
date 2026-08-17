"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useLive } from "@/lib/useLive";
import { readContract, tsToDate, shortAddr } from "@/lib/contract";

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    VERIFIED: "badge badge-green",
    UNVERIFIED: "badge badge-red",
    INCONCLUSIVE: "badge badge-yellow",
  };
  return <span className={map[status] || "badge badge-gray"}>{status}</span>;
}

function RevisionTrail({ vid }: { vid: string }) {
  const [revs, setRevs] = useState<Record<string, any> | null>(null);
  const [open, setOpen] = useState(false);

  async function toggle() {
    if (open) return setOpen(false);
    const r = await readContract("get_verification_revisions", [vid]);
    if (r !== null) setRevs(r);
    setOpen(true);
  }

  return (
    <div>
      <button className="tool-btn" onClick={toggle}>Revisions</button>
      {open && (
        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
          {revs && Object.keys(revs).length > 0 ? (
            Object.entries(revs).map(([rev, r]: any) => (
              <div key={rev} style={{ padding: 6, background: "#fff", border: "1px solid #a8a39a", fontSize: 11 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <b>rev {rev}</b>
                  <StatusBadge status={r.status} />
                  <span className="mono">{shortAddr(r.actor)}</span>
                  <span>{tsToDate(r.ts)}</span>
                </div>
                <div className="mono" style={{ marginTop: 4 }}>{r.evidence_urls}</div>
                <div style={{ color: "#555", marginTop: 2 }}>{r.reasoning}</div>
              </div>
            ))
          ) : (
            <div style={{ color: "#777" }}>No revision trail found.</div>
          )}
        </div>
      )}
    </div>
  );
}

export default function HistoryPage() {
  const { data: all, loading, reload } = useLive<any>("get_all_verifications", [], [], 20000);
  const [fallback, setFallback] = useState<Record<string, any> | null>(null);
  const [fallbackLoading, setFallbackLoading] = useState(false);
  const [filter, setFilter] = useState("");

  // If the deployed contract predates get_all_verifications, fall back to
  // enumerating subjects and their per-subject verification lists.
  async function loadFallback() {
    setFallbackLoading(true);
    const subs = await readContract("get_all_subjects");
    const out: Record<string, any> = {};
    if (subs && typeof subs === "object") {
      for (const sid of Object.keys(subs)) {
        const vs = await readContract("get_subject_verifications", [sid]);
        if (vs && typeof vs === "object") {
          for (const [vid, v] of Object.entries(vs)) {
            out[vid] = { ...(v as any), subject_id: sid };
          }
        }
      }
    }
    setFallback(out);
    setFallbackLoading(false);
  }

  const used = all && typeof all === "object" && Object.keys(all).length > 0 ? all : fallback;
  const isFallback = !(all && typeof all === "object" && Object.keys(all).length > 0);

  // Trigger the per-subject fallback when the deployed contract predates
  // get_all_verifications (the call returns null / empty).
  useEffect(() => {
    if (all !== null && (typeof all !== "object" || Object.keys(all).length === 0)) {
      loadFallback();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all]);

  const entries = used && typeof used === "object" ? Object.entries(used) : [];
  const filtered = entries
    .filter(([vid, v]: any) =>
      (vid + " " + (v.subject_id || "")).toLowerCase().includes(filter.toLowerCase())
    )
    .sort((a: any, b: any) => Number(b[1].verified_ts) - Number(a[1].verified_ts));

  const countVerified = entries.filter(([, v]: any) => v.status === "VERIFIED").length;
  const countUnverified = entries.filter(([, v]: any) => v.status === "UNVERIFIED").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 20, color: "#1a3a66" }}>Verification History</h1>
        <span style={{ flex: 1 }} />
        <span className="badge badge-green">{countVerified} verified</span>
        <span className="badge badge-red">{countUnverified} unverified</span>
        <div className="field-group" style={{ margin: 0 }}>
          <input
            className="office-input"
            style={{ width: 240 }}
            placeholder="🔍 Search by id / subject…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      </div>

      <fieldset className="office-fieldset">
        <legend>All verifications (global on-chain feed)</legend>
        <div className="section-title">History ({entries.length})</div>
        {loading || (isFallback && fallbackLoading) ? (
          <div className="empty">Loading history…</div>
        ) : filtered.length === 0 ? (
          <div className="empty">No verifications on-chain yet. Submit one from the Verify page.</div>
        ) : (
          <div className="table-wrap" style={{ maxHeight: 600 }}>
            <table className="office-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Verification ID</th>
                  <th>Subject</th>
                  <th>Level</th>
                  <th>Verifier</th>
                  <th>When</th>
                  <th>Revisions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(([vid, v]: any) => (
                  <tr key={vid}>
                    <td><StatusBadge status={v.status} /></td>
                    <td>
                      <Link href={`/subjects/${v.subject_id}`} className="mono" style={{ fontSize: 11 }}>
                        {vid}
                      </Link>
                    </td>
                    <td>
                      <Link href={`/subjects/${v.subject_id}`}>{v.subject_id}</Link>
                    </td>
                    <td>{v.evidence_level}</td>
                    <td className="mono">{shortAddr(v.verifier)}</td>
                    <td>{tsToDate(v.verified_ts)}</td>
                    <td><RevisionTrail vid={vid} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10, fontSize: 11, color: "#777" }}>
          <button className="tool-btn" onClick={() => { reload(); loadFallback(); }}>↻ Refresh</button>
          <span>
            {isFallback
              ? "Fallback mode: kontrak deployed belum punya get_all_verifications, history digabung dari per-subject."
              : "Data diambil langsung dari kontrak via get_all_verifications — auto-refresh ~20s."}
          </span>
        </div>
      </fieldset>
    </div>
  );
}
