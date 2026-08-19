# veridoc

<!-- Office Classic theme (mirrors src/app/globals.css) -->

<div style="font-family:'Segoe UI',Tahoma,Verdana,sans-serif;background:#d4d0c8;color:#000;font-size:13px;line-height:1.45;border:1px solid #7f7b76;box-shadow:2px 2px 10px rgba(0,0,0,.28);max-width:920px;">

<!-- ============ Title bar ============ -->
<div style="background:linear-gradient(90deg,#0a246a,#2b5f9e,#0a246a);color:#fff;font-weight:bold;font-size:14px;padding:6px 10px;border-bottom:1px solid #000;letter-spacing:.3px;">📋 &nbsp;veridoc — On-chain Real-World KYC / Claim Verifier&nbsp;&nbsp;<span style="font-weight:normal;font-size:11px;opacity:.85;">GenLayer Intelligent Contract</span></div>

<!-- ============ Menu bar ============ -->
<div style="background:#ece9d8;border-bottom:1px solid #7f7b76;padding:2px 4px;font-size:12px;">
  <span style="padding:3px 10px;border:1px solid transparent;">File</span>
  <span style="padding:3px 10px;border:1px solid transparent;">Edit</span>
  <span style="padding:3px 10px;background:#24508a;color:#fff;border:1px solid #24508a;">View</span>
  <span style="padding:3px 10px;border:1px solid transparent;">Help</span>
</div>

<!-- ============ Toolbar ============ -->
<div style="background:linear-gradient(180deg,#f6f4ed,#e6e3d6);border-bottom:1px solid #7f7b76;padding:4px 8px;font-size:12px;">
  <span style="display:inline-block;padding:3px 12px;border:1px solid #fff;border-right:1px solid #7f7b76;border-bottom:1px solid #7f7b76;background:#ece9d8;">✔ Verified on Studionet</span>
  <span style="display:inline-block;padding:3px 12px;border:1px solid #fff;border-right:1px solid #7f7b76;border-bottom:1px solid #7f7b76;background:#ece9d8;margin-left:4px;">38 tests passing</span>
  <span style="display:inline-block;padding:3px 12px;border:1px solid #fff;border-right:1px solid #7f7b76;border-bottom:1px solid #7f7b76;background:#ece9d8;margin-left:4px;">Next.js frontend</span>
</div>

<!-- ============ Body ============ -->
<div style="padding:12px;">

### <span style="color:#1a3a66;">What is veridoc?</span>

veridoc is a reusable **GenLayer Intelligent Contract** that verifies natural-language claims about a real-world subject (person, organization, project) against **live web evidence** — using a hybrid of **deterministic programmatic checks** and **LLM judgment**, gated by the **Equivalence Principle** so the on-chain verdict only lands after validators independently agree.

Real-world use cases: KYC onboarding, verified professional profiles, org / grant claim verification, and trust scores that other contracts can rely on.

> One contract hosts many independent subjects, each with its own claims, evidence trail, and live trust score.

---

### <span style="color:#1a3a66;">How a verification is decided</span>

<ol>
<li><b>Fetch evidence</b> — the contract fetches each submitted evidence URL (real web data). Sources are labelled per party.</li>
<li><b>Programmatic checks (deterministic)</b> — objective claims become sandboxed Python expressions, evaluated with strict <b>AST allow-listing</b> (no imports, no escapes). A violated check is <b>GROUND TRUTH</b> the AI cannot override.</li>
<li><b>AI judgment</b> — an LLM judge weighs subjective claims, with the programmatic results injected as non-overridable ground truth.</li>
<li><b>Validator consensus (exact)</b> — independent validators re-run the whole pipeline (re-fetching the web) and accept the leader ONLY when the <b>exact</b> decision fields match: verdict <code>status</code> compared as strings (VERIFIED / UNVERIFIED / INCONCLUSIVE — two different statuses never agree) <b>and</b> <code>prog_violated</code> (pass/fail of the mandatory criteria). Reasoning, violation wording and check expressions are not compared.</li>
<li><b>On-chain record</b> — stored with an evidence hash and a full revision trail, so every revision's exact evidence is preserved.</li>
</ol>

---

### <span style="color:#1a3a66;">Production features</span>

<table style="border-collapse:collapse;width:100%;background:#fff;font-size:12px;">
<thead><tr style="background:#d4d0c8;">
<th style="border:1px solid #7f7b76;padding:4px 8px;text-align:left;">Feature</th>
<th style="border:1px solid #7f7b76;padding:4px 8px;text-align:left;">What it does</th>
</tr></thead>
<tbody>
<tr><td style="border:1px solid #a09b91;padding:4px 8px;"><b>Trusted-domain whitelist</b></td><td style="border:1px solid #a09b91;padding:4px 8px;">Subjects pin allowed evidence domains; URLs outside are rejected before any fetch.</td></tr>
<tr><td style="border:1px solid #a09b91;padding:4px 8px;"><b>Verification levels</b></td><td style="border:1px solid #a09b91;padding:4px 8px;">low / medium / high with min URL count; a subject declares a required level.</td></tr>
<tr><td style="border:1px solid #a09b91;padding:4px 8px;"><b>Stakes &amp; slashing</b></td><td style="border:1px solid #a09b91;padding:4px 8px;">Verifiers stake; a claim proven false slashes stake + reputation.</td></tr>
<tr><td style="border:1px solid #a09b91;padding:4px 8px;"><b>Two-party challenge</b></td><td style="border:1px solid #a09b91;padding:4px 8px;">Anyone challenges a VERIFIED claim with counter-evidence; the judge sees both sides. Falsified → slash + half-reward to challenger.</td></tr>
<tr><td style="border:1px solid #a09b91;padding:4px 8px;"><b>Exact fees</b></td><td style="border:1px solid #a09b91;padding:4px 8px;">Verify 100 GEN, challenge 100 GEN; overpayment is rejected.</td></tr>
<tr><td style="border:1px solid #a09b91;padding:4px 8px;"><b>Reputation-weighted trust</b></td><td style="border:1px solid #a09b91;padding:4px 8px;">VERIFIED adds <code>1 + min(reputation, 5)</code>; reverify exactly reverses it.</td></tr>
<tr><td style="border:1px solid #a09b91;padding:4px 8px;"><b>Expiry &amp; refresh</b></td><td style="border:1px solid #a09b91;padding:4px 8px;">Verdicts fresh for 180 days, then EXPIRED.</td></tr>
<tr><td style="border:1px solid #a09b91;padding:4px 8px;"><b>Revision trail</b></td><td style="border:1px solid #a09b91;padding:4px 8px;">Every verdict change archives the previous evidence — nothing is silently replaced.</td></tr>
<tr><td style="border:1px solid #a09b91;padding:4px 8px;"><b>Independent evidence</b></td><td style="border:1px solid #a09b91;padding:4px 8px;">medium/high need ≥2 distinct evidence hosts.</td></tr>
<tr><td style="border:1px solid #a09b91;padding:4px 8px;"><b>Rate limits</b></td><td style="border:1px solid #a09b91;padding:4px 8px;">Per-(subject, verifier) cooldown + cap; reverify owner-only, limited.</td></tr>
</tbody>
</table>

---

### <span style="color:#1a3a66;">Security &amp; fairness</span>

- <b>Prompt injection</b> — evidence is marked untrusted; programmatic ground truth cannot be overridden by the LLM.
- <b>Unsafe generated code</b> — AST allow-list only (`text`/`len`, whitelisted string methods, comparison/boolean/numeric ops); no imports, no `__dunder__`, no filesystem/network.
- <b>No griefing</b> — INCONCLUSIVE never slashes; only a proven-false (UNVERIFIED) claim does.
- <b>Domain gate</b> — evidence hosts validated against the whitelist before fetching.
- <b>Key hygiene</b> — subject ids cannot contain `:`, preventing cross-subject contamination.
- <b>Exact verdict consensus</b> — validators compare the leader's `status` as an exact string (VERIFIED vs UNVERIFIED vs INCONCLUSIVE is a hard disagreement), not a truthiness check; covered by dedicated tests where the leader and validator <b>disagree</b> (`test_consensus_rejects_exact_status_disagreement`, `test_consensus_rejects_verified_vs_inconclusive_mismatch`).

---

### <span style="color:#1a3a66;">Public API</span>

<table style="border-collapse:collapse;width:100%;background:#fff;font-size:12px;">
<thead><tr style="background:#d4d0c8;">
<th style="border:1px solid #7f7b76;padding:4px 8px;text-align:left;">Group</th>
<th style="border:1px solid #7f7b76;padding:4px 8px;text-align:left;">Methods</th>
</tr></thead>
<tbody>
<tr><td style="border:1px solid #a09b91;padding:4px 8px;">Subject</td><td style="border:1px solid #a09b91;padding:4px 8px;"><code>create_subject</code>, <code>update_subject</code>, <code>set_allowed_domains</code></td></tr>
<tr><td style="border:1px solid #a09b91;padding:4px 8px;">Staking</td><td style="border:1px solid #a09b91;padding:4px 8px;"><code>deposit_stake</code>, <code>withdraw_stake</code>, <code>withdraw_fee</code> (admin)</td></tr>
<tr><td style="border:1px solid #a09b91;padding:4px 8px;">Verification</td><td style="border:1px solid #a09b91;padding:4px 8px;"><code>verify_claims</code> (returns ver id), <code>reverify</code>, <code>challenge_verification</code></td></tr>
<tr><td style="border:1px solid #a09b91;padding:4px 8px;">Views</td><td style="border:1px solid #a09b91;padding:4px 8px;"><code>is_verified</code>, <code>get_subject_verdict</code>, <code>get_verified_subjects</code>, <code>get_subject</code>, <code>get_all_subjects(owner?)</code> (optional owner filter for the Verify page), <code>get_verification</code>, <code>get_all_verifications</code>, <code>get_verification_revisions</code>, <code>get_subject_verifications</code>, <code>get_verifier</code>, <code>get_fee_balance</code>, <code>get_contract_stats</code></td></tr>
</tbody>
</table>

---

### <span style="color:#1a3a66;">Project structure</span>

<pre style="background:#fff;border:1px solid #a09b91;padding:8px;">
contracts/veridoc.py        # the contract (single file)
tests/test_veridoc.py       # pytest suite (38 tests, incl. adversarial + consensus-disagreement paths)
scripts/                    # deploy + e2e on studionet (node)
src/ + public/              # Next.js frontend (Office Classic UI)
package.json / vercel.json  # frontend deps + Vercel config
gltest.config.yaml          # localnet/studionet config
</pre>

### <span style="color:#1a3a66;">Frontend</span>

A Next.js UI in the **Office Classic** style (Office 2003 Silver/Classic) talks to the deployed contract via `genlayer-js` + MetaMask. Pages: Dashboard (stats, attestation registry, my subjects/verifications), Subjects, Verify, Challenge, Stake, History, How-it-works.

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # production build
```

---

### <span style="color:#1a3a66;">Deploy &amp; test</span>

The contract is self-contained (only the `# { "Depends": ... }` header). Paste `contracts/veridoc.py` into [GenLayer Studio](https://studio.genlayer.ai).

Local testing (no network):

```bash
python -m pytest tests/ -q
```

**Steward review coverage** (38 tests, all green):

- `test_consensus_rejects_exact_status_disagreement` — leader returns VERIFIED, validator re-runs and gets UNVERIFIED → validator **disagrees**.
- `test_consensus_rejects_verified_vs_inconclusive_mismatch` — VERIFIED vs INCONCLUSIVE → **disagrees**.
- `test_consensus_accepts_exact_status_match` — same exact status → agrees.
- `test_get_all_subjects_filters_by_owner` — `get_all_subjects(owner)` returns only the wallet's subjects (the Verify page's filter), verified live on Studionet.

The consensus tests drive the captured validator directly (`vm.run_validator()`), so they fail on the old truthiness comparison (`bool("VERIFIED") == bool("UNVERIFIED")`) and pass once verdicts are compared exactly.

---

### <span style="color:#1a3a66;">Example flow</span>

```bash
# Owner registers a subject
create_subject("acme", "ACME Corp", "Software company headquartered in Berlin",
               category="organization", required_level="medium",
               allowed_domains="acme.example.com|registry.example.com")

# Verifier stakes once
deposit_stake(value=5000)

# Verify claims (medium needs >= 2 URLs from >= 2 distinct hosts)
ver_id = verify_claims("acme",
              "ACME Corp has an office in Berlin\nFounder is J. Doe",
              ["https://acme.example.com/about", "https://registry.example.com/acme"],
              evidence_level="medium", value=VERIFY_FEE)
# ver_id -> e.g. "acme:0xAB..:1"

# Read results
is_verified("acme")                # -> bool (fresh within TTL)
get_subject_verdict("acme")        # -> verified, status, expires_ts, score
get_verification(ver_id)           # -> status, evidence_hash, revision_count
get_verification_revisions(ver_id) # -> full audit trail

# Re-run with current evidence (owner only, rate-limited)
reverify(ver_id)

# Anyone with stake can challenge a VERIFIED claim (two-party)
challenge_verification(ver_id, ["https://registry.example.com/acme/revoked"],
                       value=CHALLENGE_FEE)

# Attestation registry (callable by other contracts)
get_verified_subjects()
```

</div>

<!-- ============ Status bar ============ -->
<div style="background:#ece9d8;border-top:1px solid #7f7b76;border-bottom:1px solid #fff;padding:3px 8px;font-size:11px;color:#333;display:flex;gap:8px;">
  <span style="border:1px solid #7f7b76;border-right:1px solid #fff;border-bottom:1px solid #fff;padding:2px 10px;background:#ddebf7;color:#1a3a66;">● Studionet</span>
  <span style="border:1px solid #7f7b76;border-right:1px solid #fff;border-bottom:1px solid #fff;padding:2px 10px;background:#f1efe9;">Contract: 0x6C09…5F25e</span>
  <span style="border:1px solid #7f7b76;border-right:1px solid #fff;border-bottom:1px solid #fff;padding:2px 10px;background:#c6efce;color:#006100;">✔ 38 tests passing</span>
  <span style="margin-left:auto;border:1px solid #7f7b76;border-right:1px solid #fff;border-bottom:1px solid #fff;padding:2px 10px;background:#f1efe9;">Ready</span>
</div>

</div>
