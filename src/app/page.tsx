"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@/lib/WalletContext";
import { useLive } from "@/lib/useLive";
import { VerifierCard } from "@/components/VerifierCard";
import { readContract, shortAddr, tsToDate } from "@/lib/contract";

export default function DashboardPage() {
  const { address } = useWallet();
  const { data: stats } = useLive<any>("get_contract_stats", [], [], 20000);
  const { data: verified } = useLive<any>("get_verified_subjects", [], [], 25000);
  const { data: subjects } = useLive<any>("get_all_subjects", [], [], 20000);
  const { data: fee } = useLive<any>("get_fee_balance", [], [], 20000);

  const [verifications, setVerifications] = useState<Record<string, any> | null>(null);

  // Load global verification history (single view; falls back to per-subject).
  useEffect(() => {
    let alive = true;
    (async () => {
      const all = await readContract("get_all_verifications");
      if (!alive) return;
      if (all && typeof all === "object" && Object.keys(all).length > 0) {
        setVerifications(all);
        return;
      }
      // Fallback for older deployments without get_all_verifications.
      const subs = await readContract("get_all_subjects");
      if (!alive) return;
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
      if (alive) setVerifications(out);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const addrLower = (address || "").toLowerCase();
  const verifiedList = verified && typeof verified === "object" ? Object.entries(verified) : [];
  const subjectList = subjects && typeof subjects === "object" ? Object.entries(subjects) : [];

  // My subjects = subjects whose owner is the connected wallet.
  const mySubjects = subjectList.filter(([, s]: any) => String(s.owner).toLowerCase() === addrLower);
  // My verifications = verifications whose verifier is the connected wallet.
  const myVerifications = verifications
    ? Object.entries(verifications).filter(
        ([, v]: any) => String(v.verifier).toLowerCase() === addrLower
      )
    : [];

  const cards = [
    { label: "Subjects", value: stats?.subjects ?? "…", cls: "stat-card" },
    { label: "Verifications", value: stats?.verifications ?? "…", cls: "stat-card green" },
    { label: "Verifiers", value: stats?.verifiers ?? "…", cls: "stat-card yellow" },
    { label: "Freshly verified", value: verifiedList.length, cls: "stat-card green" },
    { label: "Fee balance (GEN)", value: fee ?? "…", cls: "stat-card red" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Header strip */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 20, color: "#1a3a66" }}>Dashboard</h1>
        <span style={{ flex: 1 }} />
        <Link className="tool-btn primary" href="/verify">+ Verify Claims</Link>
        <Link className="tool-btn" href="/subjects">Manage Subjects</Link>
      </div>

      {/* Stat cards */}
      <div className="grid-3">
        {cards.map((c) => (
          <div key={c.label} className={c.cls}>
            <div className="stat-label">{c.label}</div>
            <div className="stat-value">{c.value}</div>
          </div>
        ))}
        {/* 6th card: my verifier snapshot */}
        <div className="stat-card">
          <div className="stat-label">Registry coverage</div>
          <div className="stat-value" style={{ fontSize: 16, paddingTop: 8 }}>
            {subjectList.length > 0
              ? `${verifiedList.length}/${subjectList.length} subjects verified`
              : "No subjects yet"}
          </div>
        </div>
      </div>

      <div className="grid-2">
        {/* My verifier profile (real on-chain data of connected wallet) */}
        <fieldset className="office-fieldset">
          <legend>My Verifier Profile</legend>
          <div className="section-title">
            🧑‍💼 On-chain record for your wallet
          </div>
          <VerifierCard />
        </fieldset>

        {/* Attestation registry */}
        <fieldset className="office-fieldset">
          <legend>Attestation Registry</legend>
          <div className="section-title">Verified Subjects (fresh, within TTL)</div>
          {verifiedList.length > 0 ? (
            <div className="table-wrap" style={{ maxHeight: 300 }}>
              <table className="office-table">
                <thead>
                  <tr>
                    <th>Subject</th>
                    <th>Name</th>
                    <th>Trust</th>
                    <th>Expires</th>
                  </tr>
                </thead>
                <tbody>
                  {verifiedList.map(([id, v]: any) => (
                    <tr key={id}>
                      <td>
                        <Link href={`/subjects/${id}`} className="mono">{id}</Link>
                      </td>
                      <td>{v.name}</td>
                      <td>{v.trust_score}</td>
                      <td>{new Date(Number(v.expires_ts) * 1000).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">
              No freshly verified subjects. Run a verification to register one.
            </div>
          )}
        </fieldset>
      </div>

      {/* My activity (visible even when wallet is not connected) */}
      <div className="grid-2">
        <fieldset className="office-fieldset">
          <legend>My Subjects</legend>
          <div className="section-title">
            Subjects you own ({mySubjects.length})
            {address && <span className="badge badge-blue mono" style={{ marginLeft: "auto" }}>{shortAddr(address)}</span>}
          </div>
          {!address ? (
            <div className="alert">Connect your wallet to see the subjects you own.</div>
          ) : mySubjects.length > 0 ? (
            <div className="table-wrap" style={{ maxHeight: 300 }}>
              <table className="office-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Name</th>
                    <th>Category</th>
                    <th>Verified</th>
                    <th>Trust</th>
                  </tr>
                </thead>
                <tbody>
                  {mySubjects.map(([sid, s]: any) => (
                    <tr key={sid}>
                      <td><Link href={`/subjects/${sid}`} className="mono">{sid}</Link></td>
                      <td>{s.name}</td>
                      <td>{s.category}</td>
                      <td>{s.verified_count}</td>
                      <td>
                        <span className={s.trust_score > 0 ? "badge badge-green" : "badge badge-gray"}>
                          {s.trust_score}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">
              You don't own any subjects with this wallet yet.{" "}
              <Link href="/subjects">Register one</Link> to see it here.
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            <Link className="tool-btn" href="/subjects">+ Register a subject</Link>
          </div>
        </fieldset>

        <fieldset className="office-fieldset">
          <legend>My Verifications</legend>
          <div className="section-title">
            Verifications you submitted ({myVerifications.length})
            {address && <span className="badge badge-blue mono" style={{ marginLeft: "auto" }}>{shortAddr(address)}</span>}
          </div>
          {!address ? (
            <div className="alert">Connect your wallet to see the verifications you submitted.</div>
          ) : myVerifications.length > 0 ? (
            <div className="table-wrap" style={{ maxHeight: 300 }}>
              <table className="office-table">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Subject</th>
                    <th>Level</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {myVerifications.map(([vid, v]: any) => (
                    <tr key={vid}>
                      <td>
                        {v.status === "VERIFIED" ? <span className="badge badge-green">VERIFIED</span>
                          : v.status === "UNVERIFIED" ? <span className="badge badge-red">UNVERIFIED</span>
                          : <span className="badge badge-yellow">INCONCLUSIVE</span>}
                      </td>
                      <td>
                        <Link href={`/subjects/${v.subject_id}`}>{v.subject_id}</Link>
                      </td>
                      <td>{v.evidence_level}</td>
                      <td>{tsToDate(v.verified_ts)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">
              You haven't submitted any verifications with this wallet yet.{" "}
              <Link href="/verify">Submit one</Link> to see it here.
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            <Link className="tool-btn" href="/verify">+ Submit a verification</Link>
          </div>
        </fieldset>
      </div>

      {/* All subjects table */}
      <fieldset className="office-fieldset">
        <legend>All Subjects</legend>
        <div className="section-title">Registered subjects on-chain ({subjectList.length})</div>
        {subjectList.length > 0 ? (
          <div className="table-wrap">
            <table className="office-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Category</th>
                  <th>Required</th>
                  <th>Owner</th>
                  <th>Verified</th>
                  <th>Trust</th>
                </tr>
              </thead>
              <tbody>
                {subjectList.map(([sid, s]: any) => (
                  <tr key={sid}>
                    <td>
                      <Link href={`/subjects/${sid}`} className="mono">{sid}</Link>
                    </td>
                    <td>{s.name}</td>
                    <td>{s.category}</td>
                    <td>{s.required_level ?? "-"}</td>
                    <td className="mono">{shortAddr(s.owner)}</td>
                    <td>
                      <span className="badge badge-blue">{s.verified_count}</span>
                    </td>
                    <td>
                      <span className={s.trust_score > 0 ? "badge badge-green" : "badge badge-gray"}>
                        {s.trust_score}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">No subjects registered yet.</div>
        )}
        <div style={{ marginTop: 10, fontSize: 12, color: "#555" }}>
          Live on-chain data · auto-refresh every ~20s
        </div>
      </fieldset>
    </div>
  );
}
