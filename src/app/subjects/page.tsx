"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useWallet } from "@/lib/WalletContext";
import { readContract, writeContract, isTxSuccess, shortAddr } from "@/lib/contract";
import { useLive } from "@/lib/useLive";
import { toast } from "sonner";

const CATEGORIES = ["identity", "employment", "education", "organization", "credential", "other"];

export default function SubjectsPage() {
  const { address } = useWallet();
  const { data: subjects, reload } = useLive<any>("get_all_subjects", [], [], 20000);

  const [busy, setBusy] = useState(false);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [category, setCategory] = useState("organization");
  const [level, setLevel] = useState("low");
  const [domains, setDomains] = useState("");

  const [verdicts, setVerdicts] = useState<Record<string, any>>({});
  const [search, setSearch] = useState("");

  // Load live verdicts for each subject (real on-chain data).
  const loadVerdicts = useCallback(async () => {
    const s = await readContract("get_all_subjects");
    if (!s || typeof s !== "object") return;
    const ids = Object.keys(s);
    const out: Record<string, any> = {};
    await Promise.all(
      ids.map(async (sid) => {
        const v = await readContract("get_subject_verdict", [sid]);
        if (v && typeof v === "object") out[sid] = v;
      })
    );
    // Merge so a failed per-subject read (rate limit) never drops previously
    // loaded verdicts / statuses from the table.
    setVerdicts((prev) => ({ ...prev, ...out }));
  }, []);

  useEffect(() => {
    loadVerdicts();
  }, [loadVerdicts]);

  async function create() {
    if (!window.ethereum || !address) return toast.error("Connect your wallet first");
    if (!id || !name || !desc) return toast.error("Fill subject id, name and description");
    setBusy(true);
    try {
      const receipt = await writeContract(window.ethereum, "create_subject", [
        id, name, desc, category, level, domains,
      ], 0n, address ?? undefined);
      const r = isTxSuccess(receipt);
      if (!r.ok) {
        toast.error(`Rejected: ${r.reason}`);
      } else {
        toast.success("Subject created");
        setId(""); setName(""); setDesc(""); setDomains("");
        reload();
        loadVerdicts();
      }
    } catch (e: any) {
      toast.error(e?.shortMessage || e?.message || "Create failed");
    } finally {
      setBusy(false);
    }
  }

  const subjectList =
    subjects && typeof subjects === "object"
      ? Object.entries(subjects).filter(([sid, s]: any) =>
          (sid + " " + s.name).toLowerCase().includes(search.toLowerCase())
        )
      : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 20, color: "#1a3a66" }}>Subjects</h1>
        <span style={{ flex: 1 }} />
        <div className="field-group" style={{ margin: 0 }}>
          <input
            className="office-input"
            style={{ width: 260 }}
            placeholder="🔍 Search subjects…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="grid-2">
        {/* Create form */}
        <fieldset className="office-fieldset">
          <legend>Register Subject</legend>
          <div className="section-title">Create a new on-chain subject</div>
          <div className="field-group">
            <label className="office-label">Subject ID (unique, lowercase, no spaces)</label>
            <input className="office-input" value={id} onChange={(e) => setId(e.target.value.toLowerCase().replace(/\s/g, "-"))} placeholder="acme-corp" />
          </div>
          <div className="field-group">
            <label className="office-label">Name</label>
            <input className="office-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="ACME Corp" />
          </div>
          <div className="field-group">
            <label className="office-label">Description</label>
            <textarea className="office-textarea" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Software company headquartered in Berlin" />
          </div>
          <div className="grid-2" style={{ gap: 10 }}>
            <div className="field-group">
              <label className="office-label">Category</label>
              <select className="office-select" value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="field-group">
              <label className="office-label">Required level</label>
              <select className="office-select" value={level} onChange={(e) => setLevel(e.target.value)}>
                <option value="low">low (1 url)</option>
                <option value="medium">medium (2 urls)</option>
                <option value="high">high (3 urls)</option>
              </select>
            </div>
          </div>
          <div className="field-group">
            <label className="office-label">Allowed evidence domains <span style={{ fontWeight: "normal" }}>(pipe-separated, empty = any)</span></label>
            <input className="office-input" value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="acme.com|registry.example.com" />
          </div>
          <button className="tool-btn primary" onClick={create} disabled={busy}>
            {busy ? "Submitting…" : "Create Subject"}
          </button>
        </fieldset>

        {/* List with live verdicts */}
        <fieldset className="office-fieldset">
          <legend>Subject List</legend>
          <div className="section-title">All subjects · live verdict ({subjectList.length})</div>
          {subjectList.length > 0 ? (
            <div className="table-wrap" style={{ maxHeight: 560 }}>
              <table className="office-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Name</th>
                    <th>Category</th>
                    <th>Status</th>
                    <th>Trust</th>
                    <th>Verified</th>
                  </tr>
                </thead>
                <tbody>
                  {subjectList.map(([sid, s]: any) => {
                    const v = verdicts[sid];
                    const status = v?.status ?? "…";
                    return (
                      <tr key={sid}>
                        <td>
                          <Link href={`/subjects/${sid}`} className="mono">{sid}</Link>
                        </td>
                        <td>{s.name}</td>
                        <td>{s.category}</td>
                        <td>
                          {status === "VERIFIED" ? <span className="badge badge-green">VERIFIED</span>
                            : status === "UNVERIFIED" ? <span className="badge badge-red">UNVERIFIED</span>
                            : status === "EXPIRED" ? <span className="badge badge-gray">EXPIRED</span>
                            : <span className="badge badge-gray">{status}</span>}
                        </td>
                        <td>
                          <span className={Number(s.trust_score) > 0 ? "badge badge-green" : "badge badge-gray"}>
                            {s.trust_score}
                          </span>
                        </td>
                        <td>{s.verified_count}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">No subjects yet.</div>
          )}
          <div style={{ marginTop: 10 }}>
            <button className="tool-btn" onClick={() => { reload(); loadVerdicts(); }}>↻ Refresh</button>
          </div>
        </fieldset>
      </div>
    </div>
  );
}
