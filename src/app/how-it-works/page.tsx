"use client";

import Link from "next/link";
import { useLive } from "@/lib/useLive";
import { VERIFY_FEE, CHALLENGE_FEE, STAKE_REQUIRED } from "@/lib/contract";

export default function HowItWorksPage() {
  const { data: stats } = useLive<any>("get_contract_stats", [], [], 25000);

  const steps = [
    {
      icon: "🔌",
      title: "1. Connect your wallet",
      desc: "Click Connect Wallet (top-right) and approve MetaMask on the Studionet network. Everything you do is signed by your wallet — no accounts or passwords.",
    },
    {
      icon: "💰",
      title: "2. Deposit stake",
      desc: "Go to the Stake page and deposit at least " + STAKE_REQUIRED.toString() + " GEN. Staking is what makes verifiers honest: bad verifications get slashed.",
    },
    {
      icon: "🗂",
      title: "3. Register a subject (or pick one)",
      desc: "A subject is a person, company, or project to be verified — e.g. 'ACME Corp'. Create one with its category, required evidence level, and allowed evidence domains.",
    },
    {
      icon: "✅",
      title: "4. Verify a claim",
      desc: "Submit natural-language claims (e.g. 'ACME Corp is headquartered in Berlin') plus evidence URLs. The contract fetches the pages, runs programmatic checks, and AI validators independently agree on a verdict.",
    },
    {
      icon: "🔍",
      title: "5. Read the verdict",
      desc: "is_verified shows whether the subject is currently VERIFIED (fresh within 180 days). The attestation registry lists all verified subjects on-chain for other contracts to trust.",
    },
    {
      icon: "⚖️",
      title: "6. Challenge (optional)",
      desc: "Any staked user can challenge a VERIFIED claim with counter-evidence. If the claim is proven false, the original verifier is slashed and the challenger is rewarded half.",
    },
  ];

  const howConsensus = [
    {
      title: "Fetch evidence",
      desc: "The contract fetches each submitted evidence URL (real web data, not stored strings). Sources are labelled per party.",
    },
    {
      title: "Programmatic checks (deterministic)",
      desc: "Objective claims become sandboxed Python expressions. They are evaluated with strict AST allow-listing — no imports, no escapes. A violated check is GROUND TRUTH that the AI cannot override.",
    },
    {
      title: "AI judgment",
      desc: "An LLM judge weighs subjective claims, with the programmatic results injected as non-overridable ground truth.",
    },
    {
      title: "Validator consensus",
      desc: "Independent validators re-run the whole pipeline (re-fetching the web) and only agree when both the verdict status AND the programmatic pass/fail match. This is the Equivalence Principle.",
    },
    {
      title: "On-chain record",
      desc: "After consensus, the result is stored with an evidence hash and a full revision trail, so every revision's exact evidence is preserved and auditable.",
    },
  ];

  const faq = [
    {
      q: "Why do I need to stake?",
      a: "Staking (minimum " + STAKE_REQUIRED.toString() + " GEN) aligns incentives. If a VERIFIED claim is later proven false (UNVERIFIED), the verifier is slashed and their reputation drops. Honest verifiers build reputation that increases their influence.",
    },
    {
      q: "What does the verify fee pay for?",
      a: "Each verification costs " + VERIFY_FEE.toString() + " GEN and each challenge costs " + CHALLENGE_FEE.toString() + " GEN. This prevents spam — every on-chain check uses real AI consensus and web fetches.",
    },
    {
      q: "What do VERIFIED / UNVERIFIED / INCONCLUSIVE mean?",
      a: "VERIFIED = evidence confirms the claim. UNVERIFIED = evidence contradicts it or a mandatory check failed. INCONCLUSIVE = evidence neither confirms nor contradicts — the claim is not considered verified, and no one is slashed for it.",
    },
    {
      q: "How long does a verdict last?",
      a: "A VERIFIED verdict is fresh for 180 days. After that it expires, and the subject needs a new verification to re-enter the attestation registry.",
    },
    {
      q: "Can anyone challenge?",
      a: "Any wallet with stake can challenge a VERIFIED claim by submitting counter-evidence. You cannot challenge your own verification. A challenge re-fetches BOTH the original evidence and your counter-evidence before the validators decide.",
    },
    {
      q: "Is my data really on-chain?",
      a: "Yes. All subjects, verifications, verdicts, staking, and the revision trail live on the GenLayer contract. The website only reads from the contract and lets your wallet sign transactions.",
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 20, color: "#1a3a66" }}>How veridoc works</h1>
        <span style={{ flex: 1 }} />
        <span className="badge badge-blue">Live on Studionet</span>
        <span className="badge badge-green">{stats?.subjects ?? "…"} subjects on-chain</span>
      </div>

      {/* Intro */}
      <fieldset className="office-fieldset">
        <legend>What is veridoc?</legend>
        <div className="section-title">On-chain real-world verification</div>
        <p style={{ margin: 0, fontSize: 13, maxWidth: 900 }}>
          veridoc verifies real-world claims (KYC-style) about a subject using{" "}
          <b>live web evidence + AI consensus</b>. It answers questions like{" "}
          <i>"is ACME Corp really headquartered in Berlin?"</i> by fetching the
          evidence URLs you provide, running deterministic checks, and letting
          independent AI validators agree before a verdict is recorded on-chain.
        </p>
      </fieldset>

      {/* Steps */}
      <fieldset className="office-fieldset">
        <legend>Getting started</legend>
        <div className="section-title">6 steps to your first verified subject</div>
        <div className="grid-2">
          {steps.map((s) => (
            <div key={s.title} className="window" style={{ padding: 12, boxShadow: "none", background: "#f8f7f3" }}>
              <div style={{ fontSize: 18, marginBottom: 4 }}>{s.icon}</div>
              <div style={{ fontWeight: "bold", color: "#1a3a66", marginBottom: 4 }}>{s.title}</div>
              <div style={{ fontSize: 12, color: "#333" }}>{s.desc}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link className="tool-btn primary" href="/stake">Stake now</Link>
          <Link className="tool-btn" href="/subjects">Browse subjects</Link>
          <Link className="tool-btn" href="/verify">Verify a claim</Link>
        </div>
      </fieldset>

      {/* How consensus works */}
      <fieldset className="office-fieldset">
        <legend>Under the hood</legend>
        <div className="section-title">How a verification is decided</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {howConsensus.map((h, i) => (
            <div key={h.title} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <div
                className="badge badge-blue"
                style={{ width: 26, height: 26, justifyContent: "center", flexShrink: 0 }}
              >
                {i + 1}
              </div>
              <div>
                <div style={{ fontWeight: "bold", color: "#1a3a66" }}>{h.title}</div>
                <div style={{ fontSize: 12, color: "#333" }}>{h.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </fieldset>

      {/* Security notes */}
      <fieldset className="office-fieldset">
        <legend>Security & fairness</legend>
        <div className="section-title">What keeps it trustworthy</div>
        <div className="grid-3">
          <div className="window" style={{ padding: 12, boxShadow: "none", background: "#e2efda" }}>
            <b style={{ color: "#006100" }}>Independent evidence</b>
            <div style={{ fontSize: 12, marginTop: 4 }}>
              Medium/high levels require at least 2 distinct evidence hosts, so a
              claim can't be proven from a single source you control.
            </div>
          </div>
          <div className="window" style={{ padding: 12, boxShadow: "none", background: "#ddebf7" }}>
            <b style={{ color: "#1a3a66" }}>Ground truth wins</b>
            <div style={{ fontSize: 12, marginTop: 4 }}>
              If a programmatic check is violated, the verdict is UNVERIFIED no
              matter what the AI says. LLMs can't override verifiable facts.
            </div>
          </div>
          <div className="window" style={{ padding: 12, boxShadow: "none", background: "#fff6cc" }}>
            <b style={{ color: "#9c6500" }}>No griefing</b>
            <div style={{ fontSize: 12, marginTop: 4 }}>
              An INCONCLUSIVE challenge never slashes the verifier — only a
              proven-false (UNVERIFIED) claim does.
            </div>
          </div>
          <div className="window" style={{ padding: 12, boxShadow: "none", background: "#e2efda" }}>
            <b style={{ color: "#006100" }}>Audit trail</b>
            <div style={{ fontSize: 12, marginTop: 4 }}>
              Every revision preserves the exact evidence (URLs, hash, snippet)
              it was based on — nothing is silently replaced.
            </div>
          </div>
          <div className="window" style={{ padding: 12, boxShadow: "none", background: "#fff2cc" }}>
            <b style={{ color: "#9c6500" }}>Rate limited</b>
            <div style={{ fontSize: 12, marginTop: 4 }}>
              Verifications are capped per subject-verifier and cooled down,
              preventing trust-score spam.
            </div>
          </div>
          <div className="window" style={{ padding: 12, boxShadow: "none", background: "#ffd9d9" }}>
            <b style={{ color: "#9c0006" }}>Slashing</b>
            <div style={{ fontSize: 12, marginTop: 4 }}>
              A verifier that certifies a claim later proven false loses stake
              and reputation.
            </div>
          </div>
        </div>
      </fieldset>

      {/* FAQ */}
      <fieldset className="office-fieldset">
        <legend>FAQ</legend>
        <div className="section-title">Common questions</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {faq.map((f) => (
            <div key={f.q} className="window" style={{ padding: 12, boxShadow: "none", background: "#f8f7f3" }}>
              <div style={{ fontWeight: "bold", color: "#1a3a66" }}>{f.q}</div>
              <div style={{ fontSize: 12, color: "#333", marginTop: 4 }}>{f.a}</div>
            </div>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
