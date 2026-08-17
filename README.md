# veridoc — On-chain Real-World KYC / Claim Verifier

A reusable **GenLayer Intelligent Contract** that verifies natural-language claims
about a real-world subject (person, organization, project) against live web
evidence, using a hybrid of **deterministic programmatic checks** and **LLM
judgment**, gated by the **Equivalence Principle** so the on-chain verdict only
lands after validators independently agree.

Real-world use cases: KYC onboarding, verified professional profiles, org / grant
claim verification, and trust scores that other contracts can rely on.

> Like `ComplianceScreener`, this is a *primitive*: one contract hosts many
> independent subjects, each with its own claims, evidence trail, and live
> trust score.

---

## Why this is not a "thin LLM wrapper"

1. **Objective claims are translated into Python expressions** by an LLM, then
   evaluated **deterministically** against the fetched evidence by parsing the
   expression into an **AST and executing only an allow-listed subset of syntax**
   (no imports, no calls other than `len` / whitelisted `text` methods, no
   `__dunder__` access). Expressions that fail the check become `SKIPPED`, never
   fatal.
2. Those results are injected into the judge prompt as **ground truth**, and the
   contract **enforces** them: if a programmatic check is `VIOLATED`, the final
   status is `UNVERIFIED` *even if the judge model says otherwise*. The LLM
   cannot override verifiable facts.
3. The verdict is **not stored directly**. It is produced inside a
   `run_nondet_unsafe` leader/validator block; validators independently re-run the
   whole pipeline (re-fetching the evidence) and only accept when the derived
   `status` field matches.

## Consensus design (the Equivalence Principle)

All non-deterministic work (web fetch, expression generation, judge call) happens
inside `_run_verify_consensus`. Validators independently re-run the full pipeline
and must agree on **two derived decision fields** — the verdict `status` **and**
`prog_violated` (whether any mandatory programmatic criterion failed):

```python
def validator_fn(leader_result):
    if not isinstance(leader_result, gl.vm.Return):
        return _reproduce_leader_error(leader_result, leader_fn)
    my = leader_fn()                      # independent re-run (re-fetches web)
    return (
        bool(my["status"]) == bool(leader_result.calldata["status"])
        and bool(my["prog_violated"]) == bool(leader_result.calldata["prog_violated"])
    )
```

- **Per-criterion agreement**: `prog_violated` is a deterministic derivation from
  the generated checks, so agreeing on it means validators agree on the
  pass/fail of the mandatory criteria — not merely the final category.
- **Decision fields only**: `status` + `prog_violated` are compared. Reasoning,
  violation wording, evidence text, hashes and generated expressions remain
  non-deterministic and are *not* compared.
- **Independent verification**: validators re-fetch the evidence URLs and re-run
  the full pipeline — they never trust the leader's calldata on its own.
- **Error classification** for consensus on failure paths:

  | Prefix | Meaning | Validator behavior |
  |---|---|---|
  | `[EXPECTED]` / `[EXTERNAL]` | deterministic business / data errors | agree only if messages match exactly |
  | `[TRANSIENT]` | temporary infra failure | agree if both sides failed transiently |
  | `[LLM]` | malformed LLM output | always disagree → network rotates the leader |

## Production-grade features

### Trusted-domain whitelist
Each subject can pin the evidence domains it trusts
(`set_allowed_domains("acme", "acme.example.com")`). A URL's host must equal or
be a subdomain of an allowed entry, otherwise it is rejected **before** any
fetch — cutting the prompt-injection surface. Empty = any domain allowed.

### Verification levels
Evidence is labelled `low` / `medium` / `high`, with a minimum URL count per
level (1 / 2 / 3). A subject declares a `required_level`; verifications below it
are rejected, and the level is injected into the judge prompt so a high-level
claim cannot be passed on weak secondary sources.

### Stakes & slashing
Verifiers must `deposit_stake()` at least `STAKE_REQUIRED` before verifying.
If a `VERIFIED` result is later flipped to `UNVERIFIED` by `reverify`, the
verifier's stake is reduced by `SLASH_AMOUNT` (credited to the fee balance) and
their reputation drops — economic pressure to only certify what is true.

### Challenges (contradictory verification)
Any staked address can `challenge_verification(verification_id, evidence_urls)`
a `VERIFIED` claim with counter-evidence, paying `CHALLENGE_FEE`. A challenge is
**two-party**: the consensus pipeline re-fetches the verifier's originally
committed evidence **and** the challenger's counter-evidence (each labelled in
the judge prompt), so the verdict weighs both authenticated cases:
- **Claim falsified** (UNVERIFIED) → the verifier is slashed `SLASH_AMOUNT`, the
  original trust contribution is exactly reversed, and the challenger is
  rewarded half the slash.
- **Claim stands / inconclusive** (VERIFIED or INCONCLUSIVE) → the challenger
  only loses the challenge fee; the verifier is never slashed for an
  inconclusive outcome (no griefing).
The fee accrues to the platform in both cases. This lets anyone police false
KYC verdicts, not just the subject owner.

### Verify fee & fee balance
Each verification pays `VERIFY_FEE` (anti-spam) and each challenge pays
`CHALLENGE_FEE`; slashes also accrue. The balance is admin-withdrawable via
`withdraw_fee(amount)`. Fees are **exact**: overpayment is rejected rather than
silently sunk into the contract. All post-consensus, so a failed verification
never charges.

### Reputation-weighted trust
`trust_score` is not a flat counter: a `VERIFIED` result contributes
`1 + min(verifier.reputation_score, REPUTATION_WEIGHT_CAP)`, so reputable
verifiers move a subject's score more. `UNVERIFIED` subtracts 1 (floored at 0).
`reverify` **exactly reverses** the previous contribution rather than applying a
flat delta.

### Expiry & refresh
Verdicts expire after `VERIFICATION_TTL_TS` (180 days). `is_verified()` /
`get_subject_verdict()` only count **fresh** `VERIFIED` results; stale ones are
reported as `EXPIRED`. Anyone can submit a fresh verification to refresh.

### Evidence audit trail
The full fetched text is **SHA-256 hashed** per verification (`evidence_hash`)
so third parties can re-fetch a URL and prove what the judge actually read.
Snippets are sanitized (control-characters stripped) before storage.

### Revision trail (evidence preserved per revision)
Every verdict change archives an immutable `EvidenceRevision` entry
(`get_verification_revisions(verification_id)`): the pre-change state (status,
violations, reasoning, evidence URLs, hash, snippet) is stored **before** the
record is overwritten, and the new state is stored after. `revision_count` grows
with each verify / reverify / challenge. The exact evidence used for each
revision is therefore preserved on-chain — nothing is silently replaced.

### Independent evidence
For `medium` / `high` evidence levels, the submitted URLs must span **at least
two distinct hosts**, so a claim cannot be "verified" from a single source the
verifier controls. Combined with the trusted-domain whitelist, this pushes
towards authoritative, independent sourcing.

### Rate-limited reverify
`reverify` is owner-gated and limited by `REVERIFY_COOLDOWN_TS` (300 s) and
`MAX_REVERIFIES` (3) per verification.

### Queryable verdict API
`is_verified(subject_id)` is a `@gl.public.view`, so other contracts can call it
directly (e.g. an escrow only releases when a subject is verified).
`get_verified_subjects()` returns the **attestation registry** — every subject
with a currently-fresh `VERIFIED` verdict, with trust score and expiry — so
downstream contracts can enumerate trusted subjects on-chain.

## State design

```
Subject:      id, owner, name, description, category, required_level,
              allowed_domains, created_ts, verified_count, trust_score,
              last_verified_ts
Verification: id, subject_id, verifier, claims, evidence_urls, evidence_level,
              status, violations, reasoning, evidence_snippet, evidence_hash,
              trust_contribution, verified_ts, last_reverify_ts, reverify_count
Verifier:     address, stake, total_verifications, verified_count,
              reputation_score
```

- `category` ∈ identity | employment | education | organization | credential | other.
- All writes happen **after** consensus returns, never inside the nondet block.
- `fee_balance` accrues verify fees + challenge fees + slashes and is
  admin-withdrawable via `withdraw_fee`.

## Public API

**Subject management**: `create_subject`, `update_subject`, `set_allowed_domains`
**Staking**: `deposit_stake` (payable), `withdraw_stake`, `withdraw_fee` (admin)
**Verification**: `verify_claims` (payable, fee + stake), `reverify` (owner,
rate-limited), `challenge_verification` (payable, any staked challenger)
**Views**: `is_verified`, `get_subject_verdict`, `get_verified_subjects`,
`get_subject`, `get_all_subjects`, `get_verification`,
`get_subject_verifications`, `get_verifier`, `get_fee_balance`,
`get_contract_stats`

## Security

- **Prompt injection**: the evidence block is marked as untrusted data and the
  judge is told never to follow instructions inside it. Programmatic results are
  injected as a separate ground-truth block that cannot be overridden.
- **Unsafe generated code**: expressions are parsed into an AST and only an
  allow-listed syntax subset runs (names `text`/`len`, whitelisted `text`
  string methods, comparison/boolean/numeric operators). The sandbox also runs
  with an empty builtins dict; imports, arbitrary calls, subscripts and
  `__dunder__` access are rejected, so generated code cannot read the
  filesystem or reach the network.
- **Domain gate**: evidence hosts are validated against the subject whitelist
  before any web request.
- **Re-checks**: `reverify` re-runs verification with current evidence, exactly
  reverses stale trust contributions, and slashes false certifiers.
- **Rate limits**: verify fee, stake requirement, challenge fee, reverify
  cooldown + max count.
- **Verify anti-spam**: per-(subject, verifier) cooldown (`VERIFY_COOLDOWN_TS`)
  and a cap (`MAX_VERIFICATIONS_PER_SUBJECT_VERIFIER`) prevent a single verifier
  from spamming one subject to pump its trust score.
- **No griefing via INCONCLUSIVE**: `challenge_verification` and `reverify` only
  slash the verifier when a claim is explicitly **UNVERIFIED** (proven false).
  An inconclusive outcome costs the challenger the fee but never slashes the
  verifier, so throwing junk counter-evidence is not profitable.
- **Exact fees**: `verify_claims` / `challenge_verification` require the value to
  equal the fee exactly — overpayment is rejected instead of silently sinking
  into the contract.
- **Key-separator hygiene**: subject ids cannot contain `:`, preventing
  cross-subject contamination in `get_subject_verifications` /
  `_latest_verified_ts` prefix lookups.

## Project structure

```
contracts/veridoc.py        # the contract (single file)
tests/conftest.py           # gltest Windows workaround
tests/test_veridoc.py       # pytest suite (34 tests, incl. adversarial paths)
scripts/                    # deploy + e2e on studionet (node)
src/                        # Next.js frontend (Office Classic UI)
public/
package.json                # frontend dependencies
gltest.config.yaml          # localnet/studionet config
.gitignore
README.md                   # this document
```

## Frontend

A Next.js UI in the **Office Classic** style (Office 2003 Silver/Classic) lives
in `src/` / `public/` at this project root. It talks to the deployed contract
via `genlayer-js` and MetaMask:

```bash
npm install
npm run dev          # http://localhost:3000
npm run build        # production build
npm start
```

Pages: Dashboard (stats + attestation registry), Subjects (+ create), Subject
detail (verify / reverify / challenge), Verify, Challenge, Stake, plus wallet
connect (auto-switch to Studionet). Contract address in `.env.local`.

## Deploy & test

The contract is self-contained (a single file with only the required
`# { "Depends": ... }` header), so it needs no package install, build step, or
local runtime for Studio.

1. Open [GenLayer Studio](https://studio.genlayer.ai) (or a local Studio).
2. Create a new Python project, then paste the contents of
   `contracts/veridoc.py` into the main contract file.
3. Check that the `Depends` header is preserved on the first line.
4. Deploy, then interact with the methods listed in the example flow below.
5. Optionally run the contract through the Studio's lint/validation panel.

For local testing (no network):

```bash
python -m pytest tests/ -q
```

> The `Depends` header matches the current official boilerplate
> (`py-genlayer:1jb45aa8...`) so the contract validates and runs on the network.

## Example flow

```bash
# Owner registers a subject with a domain whitelist and a required level
create_subject("acme", "ACME Corp", "Software company headquartered in Berlin",
               category="organization", required_level="medium",
               allowed_domains="acme.example.com|registry.example.com")

# Verifier stakes once
deposit_stake(value=5000)

# Any verifier submits claims + evidence URLs (medium needs >= 2 URLs from
# >= 2 distinct hosts). Returns the new verification id.
ver_id = verify_claims("acme",
              "ACME Corp has an office in Berlin\nFounder is J. Doe",
              ["https://acme.example.com/about", "https://registry.example.com/acme"],
              evidence_level="medium",
              value=VERIFY_FEE)
# ver_id -> e.g. "acme:0xAB..:1"  (use it, do not guess from a list)

# Read results
is_verified("acme")                        # -> bool (fresh within TTL)
get_subject_verdict("acme")                # -> verified, status, expires_ts, score
get_subject("acme")                        # -> category, required_level, domains
get_subject_verifications("acme")          # -> per-verification statuses
get_verification(ver_id)                   # -> status, evidence_hash, snippet, revision_count
get_verification_revisions(ver_id)         # -> full audit trail (evidence per revision)

# Re-run with current evidence (owner only, rate-limited)
reverify(ver_id)

# Anyone with stake can challenge a VERIFIED claim with counter-evidence.
# The challenge re-fetches BOTH the verifier's evidence and the counter-evidence.
challenge_verification(ver_id,
                       ["https://registry.example.com/acme/revoked"],
                       value=CHALLENGE_FEE)

# Attestation registry (callable by other contracts)
get_verified_subjects()                    # -> {subject_id: verdict with expiry}
```

## Extension ideas

- Multi-signature subject ownership (two-of-three org owners).
- Weighted evidence: require cross-referencing from independent domains.
- Emit on-chain attestation events on every verdict change for indexers.
- Reputation-linked challenge caps to deter griefing challenges.
