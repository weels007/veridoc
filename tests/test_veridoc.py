"""Direct-mode GenVM tests for the veridoc contract.

Covers the production-grade KYC features:
  1. Subject creation validates ids, categories, required levels and domain
     whitelists; update_subject / set_allowed_domains are owner-gated.
  2. Evidence URLs must be http(s) and, when a whitelist is set, must belong to
     an allowed domain (host or subdomain).
  3. Verification requires a stake and a verify fee; the required evidence
     level gates how many URLs must be supplied.
  4. The consensus pipeline produces VERIFIED / UNVERIFIED / INCONCLUSIVE and
     persists evidence hash, sanitized snippet, and trust contribution.
  5. Trust score is reputation-weighted; reverify exact-reverses a VERIFIED
     contribution and slashes the verifier when a claim flips to UNVERIFIED.
  6. Reverify is rate-limited (cooldown + max count) and owner-gated.
  7. is_verified / get_subject_verdict honour the TTL (verdicts expire).
  8. Verify fees accrue to the platform; stake deposit/withdraw accounting is
     consistent.
"""

import json
import re
from datetime import datetime, timezone

import pytest

BASE_ISO = "2026-01-01T00:00:00Z"
BASE_TS = int(datetime.fromisoformat(BASE_ISO.replace("Z", "+00:00")).timestamp())
DAY = 24 * 3600
VERIFY_FEE = 100
STAKE_REQUIRED = 1000
SLASH_AMOUNT = 500
TTL = 180 * DAY


def iso(ts: int) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).isoformat().replace("+00:00", "Z")


def to_int(v) -> int:
    return int(v)


def addr_key(a) -> str:
    """Lowercase 0x-hex of an address, whether the SDK returns Address or bytes.

    The `accounts` fixture is session-scoped; if it is created before the
    genlayer SDK is loaded, addresses come back as raw `bytes` whose `str()`
    is `"b'...'"`. This helper normalizes both representations to the same
    key the contract stores (via `_addr`).
    """
    if hasattr(a, "as_hex"):
        return str(a.as_hex).lower()
    if isinstance(a, bytes):
        return "0x" + a.hex().lower()
    return str(a).lower()


@pytest.fixture
def vm(direct_vm):
    return direct_vm


@pytest.fixture
def accounts(direct_accounts):
    return direct_accounts


@pytest.fixture
def owner(accounts):
    return accounts[0]


@pytest.fixture
def alice(accounts):
    return accounts[1]


@pytest.fixture
def bob(accounts):
    return accounts[2]


@pytest.fixture
def contract(vm, direct_deploy, owner):
    vm.warp(BASE_ISO)
    vm.sender = owner
    return direct_deploy("contracts/veridoc.py")


def create_subject(
    vm,
    contract,
    who,
    subject_id="acme",
    name="ACME Corp",
    description="Software company in Berlin",
    category="organization",
    required_level="low",
    allowed_domains="",
):
    vm.sender = who
    vm.value = 0
    return contract.create_subject(
        subject_id, name, description, category, required_level, allowed_domains
    )


def stake(vm, contract, who, amount):
    vm.sender = who
    vm.value = amount
    r = contract.deposit_stake()
    vm.value = 0
    return r


def verify(
    vm,
    contract,
    who,
    subject_id,
    claims="ACME Corp is headquartered in Berlin",
    urls=None,
    evidence_level="low",
    llm_status="VERIFIED",
    llm_violations=None,
    body=None,
):
    urls = urls or ["https://acme.example.com/about"]
    vm.sender = who
    vm.value = VERIFY_FEE
    # Mocks are matched first-hit (append-only), so clear stale ones from prior
    # verify calls before registering this call's responses.
    vm.clear_mocks()
    for u in urls:
        vm.mock_web(re.escape(u), {"status": 200, "body": body or "<html>ACME Corp HQ Berlin</html>"})
    # First LLM call: check generation.
    vm.mock_llm(
        r"Python boolean expressions",
        json.dumps(
            {
                "checks": [
                    {
                        "rule": "mentions berlin",
                        "expression": '"berlin" in text.lower()',
                        "description": "d",
                    }
                ]
            }
        ),
    )
    # Second LLM call: verdict.
    vm.mock_llm(
        r"verification judge",
        json.dumps(
            {
                "status": llm_status,
                "violations": llm_violations or [],
                "reasoning": "r",
            }
        ),
    )
    return contract.verify_claims(subject_id, claims, urls, evidence_level)


def web_for(url):
    return {"status": 200, "body": "<html>ACME Corp has its HQ in Berlin</html>"}


# --------------------------------------------------------------------------
# 1. Subject management & validation
# --------------------------------------------------------------------------


def test_create_subject_requires_valid_metadata(vm, contract, owner):
    with vm.expect_revert("Subject id must be"):
        contract.create_subject("", "n", "d", "organization", "low", "")
    with vm.expect_revert("category must be"):
        create_subject(vm, contract, owner, category="not-a-category")
    with vm.expect_revert("required_level must be"):
        create_subject(vm, contract, owner, required_level="ultra")


def test_create_subject_validates_domains(vm, contract, owner):
    with vm.expect_revert("invalid domain"):
        create_subject(vm, contract, owner, allowed_domains="https://acme.com")


def test_set_allowed_domains_is_owner_gated(vm, contract, owner, alice):
    create_subject(vm, contract, owner)
    with vm.expect_revert("Only subject owner"):
        vm.sender = alice
        vm.value = 0
        contract.set_allowed_domains("acme", "acme.example.com")


def test_update_subject_is_owner_gated(vm, contract, owner, alice):
    create_subject(vm, contract, owner)
    with vm.expect_revert("Only subject owner"):
        vm.sender = alice
        vm.value = 0
        contract.update_subject("acme", "x", "y", "organization", "low")


# --------------------------------------------------------------------------
# 2. Domain whitelist enforcement
# --------------------------------------------------------------------------


def test_urls_outside_whitelist_rejected(vm, contract, owner, alice):
    create_subject(vm, contract, owner, allowed_domains="acme.example.com")
    stake(vm, contract, alice, STAKE_REQUIRED * 2)
    with vm.expect_revert("not in the allowed domains"):
        verify(
            vm,
            contract,
            alice,
            "acme",
            urls=["https://evil.example.net/phish"],
        )


def test_subdomain_of_whitelist_allowed(vm, contract, owner, alice):
    create_subject(vm, contract, owner, allowed_domains="example.com")
    stake(vm, contract, alice, STAKE_REQUIRED * 2)
    vm.mock_web(re.escape("https://sub.example.com/x"), web_for("https://sub.example.com/x"))
    verify(
        vm,
        contract,
        alice,
        "acme",
        urls=["https://sub.example.com/x"],
        llm_status="VERIFIED",
    )
    assert contract.is_verified("acme") is True


# --------------------------------------------------------------------------
# 3. Stake, fee, and evidence level requirements
# --------------------------------------------------------------------------


def test_verify_requires_stake(vm, contract, owner, alice):
    create_subject(vm, contract, owner)
    with vm.expect_revert("must stake at least"):
        verify(vm, contract, alice, "acme")


def test_verify_requires_fee(vm, contract, owner, alice):
    create_subject(vm, contract, owner)
    stake(vm, contract, alice, STAKE_REQUIRED * 2)
    vm.sender = alice
    vm.value = 0
    vm.mock_llm(r"Python boolean expressions", json.dumps({"checks": []}))
    vm.mock_llm(r"verification judge", json.dumps({"status": "VERIFIED", "violations": [], "reasoning": "r"}))
    with vm.expect_revert("must send exactly"):
        contract.verify_claims(
            "acme",
            "ACME Corp is headquartered in Berlin",
            ["https://acme.example.com/about"],
            "low",
        )
    # Overpaying is also rejected (exact fee only).
    vm.value = 999
    with vm.expect_revert("must send exactly"):
        contract.verify_claims(
            "acme",
            "ACME Corp is headquartered in Berlin",
            ["https://acme.example.com/about"],
            "low",
        )


def test_evidence_level_gates_url_count(vm, contract, owner, alice):
    create_subject(vm, contract, owner, required_level="high")
    stake(vm, contract, alice, STAKE_REQUIRED * 2)
    with vm.expect_revert("evidence_level must be at least"):
        verify(vm, contract, alice, "acme", evidence_level="low")
    with vm.expect_revert("at least 3 evidence URLs"):
        verify(
            vm,
            contract,
            alice,
            "acme",
            urls=["https://acme.example.com/a", "https://acme.example.com/b"],
            evidence_level="high",
        )


def test_fee_accrues_on_successful_verify(vm, contract, owner, alice):
    create_subject(vm, contract, owner)
    stake(vm, contract, alice, STAKE_REQUIRED * 2)
    verify(vm, contract, alice, "acme", llm_status="VERIFIED")
    assert to_int(contract.get_fee_balance()) == VERIFY_FEE
    assert to_int(contract.get_subject("acme")["trust_score"]) == 1


# --------------------------------------------------------------------------
# 4. Verdicts, evidence hash, sanitized snippet, reputation weighting
# --------------------------------------------------------------------------


def test_unverified_and_inconclusive_verdicts(vm, contract, owner, alice):
    create_subject(vm, contract, owner)
    stake(vm, contract, alice, STAKE_REQUIRED * 2)
    verify(vm, contract, alice, "acme", llm_status="UNVERIFIED", llm_violations=["no proof"])
    v = contract.get_subject_verifications("acme")
    assert list(v.values())[0]["status"] == "UNVERIFIED"
    assert contract.is_verified("acme") is False


def test_evidence_hash_and_snippet_stored(vm, contract, owner, alice):
    create_subject(vm, contract, owner)
    stake(vm, contract, alice, STAKE_REQUIRED * 2)
    vm.mock_web(re.escape("https://acme.example.com/about"), web_for("https://acme.example.com/about"))
    verify(vm, contract, alice, "acme", llm_status="VERIFIED")
    vid = list(contract.get_subject_verifications("acme").keys())[0]
    rec = contract.get_verification(vid)
    assert rec["evidence_hash"]  # sha256 hex
    assert "ACME Corp" in rec["evidence_snippet"]


def test_reputation_weights_trust(vm, contract, owner, alice, bob):
    create_subject(vm, contract, owner)
    stake(vm, contract, alice, STAKE_REQUIRED * 2)
    stake(vm, contract, bob, STAKE_REQUIRED * 2)
    # Alice verifies two subjects to build reputation 2.
    create_subject(vm, contract, owner, subject_id="one")
    create_subject(vm, contract, owner, subject_id="two")
    verify(vm, contract, alice, "one", llm_status="VERIFIED")
    verify(vm, contract, alice, "two", llm_status="VERIFIED")
    assert to_int(contract.get_verifier(addr_key(alice))["reputation_score"]) == 2
    # Now Alice's next VERIFIED adds 1 + min(2, 5) = 3 to acme's trust.
    verify(vm, contract, alice, "acme", llm_status="VERIFIED")
    assert to_int(contract.get_subject("acme")["trust_score"]) == 3
    # Bob (reputation 0) contributes only 1.
    verify(vm, contract, bob, "acme", llm_status="VERIFIED")
    assert to_int(contract.get_subject("acme")["trust_score"]) == 4


# --------------------------------------------------------------------------
# 5. Reverify: exact reversal + slashing + rate limit
# --------------------------------------------------------------------------


def test_reverify_slashes_verifier_on_false_claim(vm, contract, owner, alice):
    create_subject(vm, contract, owner)
    stake(vm, contract, alice, STAKE_REQUIRED * 2)
    verify(vm, contract, alice, "acme", llm_status="VERIFIED")
    subject = contract.get_subject("acme")
    trust_before = to_int(subject["trust_score"])
    stake_before = to_int(contract.get_verifier(addr_key(alice))["stake"])
    fee_before = to_int(contract.get_fee_balance())

    # Owner reverifies; now the claim is false -> UNVERIFIED.
    vm.sender = owner
    vm.value = 0
    vm.clear_mocks()
    vm.mock_web(re.escape("https://acme.example.com/about"), web_for("https://acme.example.com/about"))
    vm.mock_llm(r"Python boolean expressions", json.dumps({"checks": []}))
    vm.mock_llm(r"verification judge", json.dumps({"status": "UNVERIFIED", "violations": ["fraud"], "reasoning": "r"}))
    vid = list(contract.get_subject_verifications("acme").keys())[0]
    contract.reverify(vid)

    subject_after = contract.get_subject("acme")
    assert to_int(subject_after["trust_score"]) == trust_before - 1
    assert to_int(contract.get_verifier(addr_key(alice))["stake"]) == stake_before - SLASH_AMOUNT
    assert to_int(contract.get_fee_balance()) == fee_before + SLASH_AMOUNT
    assert contract.is_verified("acme") is False


def test_reverify_is_owner_gated(vm, contract, owner, alice, bob):
    create_subject(vm, contract, owner)
    stake(vm, contract, alice, STAKE_REQUIRED * 2)
    verify(vm, contract, alice, "acme", llm_status="VERIFIED")
    vid = list(contract.get_subject_verifications("acme").keys())[0]
    with vm.expect_revert("Only subject owner"):
        vm.sender = bob
        vm.value = 0
        contract.reverify(vid)


def test_reverify_rate_limited(vm, contract, owner, alice):
    create_subject(vm, contract, owner)
    stake(vm, contract, alice, STAKE_REQUIRED * 2)
    verify(vm, contract, alice, "acme", llm_status="VERIFIED")
    vid = list(contract.get_subject_verifications("acme").keys())[0]

    def reverify_ok():
        vm.sender = owner
        vm.value = 0
        vm.mock_web(re.escape("https://acme.example.com/about"), web_for("https://acme.example.com/about"))
        vm.mock_llm(r"Python boolean expressions", json.dumps({"checks": []}))
        vm.mock_llm(r"verification judge", json.dumps({"status": "VERIFIED", "violations": [], "reasoning": "r"}))
        contract.reverify(vid)

    reverify_ok()
    # Cooldown (300s) not elapsed yet -> cooling down.
    with vm.expect_revert("cooling down"):
        reverify_ok()
    # Advance past cooldown; still allowed.
    vm.warp(iso(BASE_TS + 301))
    reverify_ok()
    vm.warp(iso(BASE_TS + 2 * 301))
    reverify_ok()
    # Max reverifies (3) reached.
    with vm.expect_revert("Max reverifications"):
        vm.warp(iso(BASE_TS + 3 * 301))
        reverify_ok()


# --------------------------------------------------------------------------
# 6. TTL / freshness
# --------------------------------------------------------------------------


def test_verdict_expires_after_ttl(vm, contract, owner, alice):
    create_subject(vm, contract, owner)
    stake(vm, contract, alice, STAKE_REQUIRED * 2)
    verify(vm, contract, alice, "acme", llm_status="VERIFIED")
    assert contract.is_verified("acme") is True
    vm.warp(iso(BASE_TS + TTL + 1))
    assert contract.is_verified("acme") is False
    verdict = contract.get_subject_verdict("acme")
    assert verdict["status"] == "EXPIRED"


# --------------------------------------------------------------------------
# 7. Stake accounting
# --------------------------------------------------------------------------


def test_stake_deposit_and_withdraw_accounting(vm, contract, alice):
    stake(vm, contract, alice, 5000)
    v = contract.get_verifier(addr_key(alice))
    assert to_int(v["stake"]) == 5000

    # Withdraw back 2000.
    vm.sender = alice
    vm.value = 0
    contract.withdraw_stake(2000)
    v = contract.get_verifier(addr_key(alice))
    assert to_int(v["stake"]) == 3000

    # Over-withdrawal reverts.
    with vm.expect_revert("insufficient stake"):
        contract.withdraw_stake(9999)


# --------------------------------------------------------------------------
# 8. Challenge (contradictory verification)
# --------------------------------------------------------------------------


def challenge(
    vm,
    contract,
    who,
    verification_id,
    llm_status="UNVERIFIED",
    urls=None,
    body=None,
    verifier_urls=None,
):
    # The two-party challenge fetches BOTH the verifier's originally-committed
    # evidence AND the challenger's counter-evidence. Default verifier evidence
    # matches what verify() submits for subject "acme".
    urls = urls or ["https://acme.example.com/counter"]
    verifier_urls = verifier_urls or ["https://acme.example.com/about"]
    vm.sender = who
    vm.value = 100  # CHALLENGE_FEE
    vm.clear_mocks()
    for u in verifier_urls:
        vm.mock_web(re.escape(u), {"status": 200, "body": body or "<html>ACME Corp HQ Berlin</html>"})
    for u in urls:
        vm.mock_web(re.escape(u), {"status": 200, "body": body or "<html>counter evidence</html>"})
    vm.mock_llm(r"Python boolean expressions", json.dumps({"checks": []}))
    vm.mock_llm(r"verification judge", json.dumps({"status": llm_status, "violations": ["fraud"], "reasoning": "r"}))
    return contract.challenge_verification(verification_id, urls)


def test_challenge_slashes_verifier_and_reverses_trust(vm, contract, owner, alice, bob):
    create_subject(vm, contract, owner)
    stake(vm, contract, alice, STAKE_REQUIRED * 2)
    stake(vm, contract, bob, STAKE_REQUIRED * 2)
    verify(vm, contract, alice, "acme", llm_status="VERIFIED")
    vid = list(contract.get_subject_verifications("acme").keys())[0]

    trust_before = to_int(contract.get_subject("acme")["trust_score"])
    stake_before = to_int(contract.get_verifier(addr_key(alice))["stake"])
    fee_before = to_int(contract.get_fee_balance())
    assert trust_before == 1
    assert contract.is_verified("acme") is True

    result = json.loads(challenge(vm, contract, bob, vid, llm_status="UNVERIFIED"))
    assert result["outcome"] == "claim_falsified"
    assert result["slashed"] == SLASH_AMOUNT

    assert to_int(contract.get_subject("acme")["trust_score"]) == 0
    assert to_int(contract.get_verifier(addr_key(alice))["stake"]) == stake_before - SLASH_AMOUNT
    # Challenge fee + full slash credited, half paid out as reward.
    assert to_int(contract.get_fee_balance()) == fee_before + 100 + SLASH_AMOUNT // 2
    assert contract.is_verified("acme") is False
    assert to_int(contract.get_verifier(addr_key(bob))["reputation_score"]) == 0


def test_challenge_claim_stands_only_loses_fee(vm, contract, owner, alice, bob):
    create_subject(vm, contract, owner)
    stake(vm, contract, alice, STAKE_REQUIRED * 2)
    stake(vm, contract, bob, STAKE_REQUIRED * 2)
    verify(vm, contract, alice, "acme", llm_status="VERIFIED")
    vid = list(contract.get_subject_verifications("acme").keys())[0]

    stake_before = to_int(contract.get_verifier(addr_key(alice))["stake"])
    fee_before = to_int(contract.get_fee_balance())

    result = json.loads(challenge(vm, contract, bob, vid, llm_status="VERIFIED"))
    assert result["outcome"] == "claim_stands"

    assert to_int(contract.get_verifier(addr_key(alice))["stake"]) == stake_before  # no slash
    assert to_int(contract.get_fee_balance()) == fee_before + 100  # fee only
    assert contract.is_verified("acme") is True  # verdict unchanged


def test_challenge_requires_stake_and_distinct_verifier(vm, contract, owner, alice):
    create_subject(vm, contract, owner)
    stake(vm, contract, alice, STAKE_REQUIRED * 2)
    verify(vm, contract, alice, "acme", llm_status="VERIFIED")
    vid = list(contract.get_subject_verifications("acme").keys())[0]

    # A verifier cannot challenge its own verification.
    with vm.expect_revert("cannot challenge its own"):
        challenge(vm, contract, alice, vid, llm_status="UNVERIFIED")

    # An unstaked address cannot challenge.
    with vm.expect_revert("must stake at least"):
        challenge(vm, contract, owner, vid, llm_status="UNVERIFIED")


def test_challenge_only_on_verified(vm, contract, owner, alice, bob):
    create_subject(vm, contract, owner)
    stake(vm, contract, alice, STAKE_REQUIRED * 2)
    stake(vm, contract, bob, STAKE_REQUIRED * 2)
    verify(vm, contract, alice, "acme", llm_status="UNVERIFIED")
    vid = list(contract.get_subject_verifications("acme").keys())[0]
    with vm.expect_revert("Only a VERIFIED verification"):
        challenge(vm, contract, bob, vid, llm_status="UNVERIFIED")


# --------------------------------------------------------------------------
# 9. Admin fee withdrawal
# --------------------------------------------------------------------------


def test_withdraw_fee_is_admin_gated_and_credits(vm, contract, owner, alice, bob):
    create_subject(vm, contract, owner)
    stake(vm, contract, alice, STAKE_REQUIRED * 2)
    verify(vm, contract, alice, "acme", llm_status="VERIFIED")
    assert to_int(contract.get_fee_balance()) == VERIFY_FEE

    # Non-admin cannot withdraw fees.
    with vm.expect_revert("only admin"):
        vm.sender = alice
        vm.value = 0
        contract.withdraw_fee(VERIFY_FEE)

    # Admin can, and balance drops by exactly the withdrawn amount.
    vm.sender = owner
    vm.value = 0
    contract.withdraw_fee(VERIFY_FEE)
    assert to_int(contract.get_fee_balance()) == 0
    with vm.expect_revert("insufficient fee balance"):
        contract.withdraw_fee(1)


# --------------------------------------------------------------------------
# 10. Attestation registry
# --------------------------------------------------------------------------


def test_verified_subjects_registry_honors_freshness(vm, contract, owner, alice, bob):
    create_subject(vm, contract, owner, subject_id="acme")
    create_subject(vm, contract, owner, subject_id="nexus")
    stake(vm, contract, alice, STAKE_REQUIRED * 2)
    verify(vm, contract, alice, "acme", llm_status="VERIFIED")
    verify(vm, contract, alice, "nexus", llm_status="UNVERIFIED")

    registry = contract.get_verified_subjects()
    assert "acme" in registry
    assert "nexus" not in registry
    assert registry["acme"]["name"] == "ACME Corp"

    # After TTL, the subject drops out of the attestation registry.
    vm.warp(iso(BASE_TS + TTL + 1))
    assert contract.get_verified_subjects() == {}


# --------------------------------------------------------------------------
# 11. Security hardening
# --------------------------------------------------------------------------


def test_subject_id_cannot_contain_colon(vm, contract, owner):
    with vm.expect_revert("cannot contain ':'"):
        create_subject(vm, contract, owner, subject_id="a:b")


def test_verify_cooldown_blocks_immediate_double_submit(vm, contract, owner, alice):
    create_subject(vm, contract, owner)
    stake(vm, contract, alice, STAKE_REQUIRED * 2)
    verify(vm, contract, alice, "acme", llm_status="VERIFIED")
    # Immediate second verification of the same subject is rate-limited.
    with vm.expect_revert("cooling down"):
        verify(vm, contract, alice, "acme", llm_status="VERIFIED")
    # Different subject is fine (per-(subject, verifier) key).
    create_subject(vm, contract, owner, subject_id="other")
    verify(vm, contract, alice, "other", llm_status="VERIFIED")
    assert contract.is_verified("acme") is True


def test_verify_cap_per_subject_verifier(vm, contract, owner, alice):
    create_subject(vm, contract, owner)
    stake(vm, contract, alice, STAKE_REQUIRED * 2)
    for i in range(5):
        verify(vm, contract, alice, "acme", llm_status="VERIFIED")
        vm.warp(iso(BASE_TS + (i + 1) * 301))
    # The 6th verification is capped.
    with vm.expect_revert("Max 5 verifications"):
        verify(vm, contract, alice, "acme", llm_status="VERIFIED")


def test_inconclusive_does_not_slash_verifier(vm, contract, owner, alice, bob):
    create_subject(vm, contract, owner)
    stake(vm, contract, alice, STAKE_REQUIRED * 2)
    stake(vm, contract, bob, STAKE_REQUIRED * 2)
    verify(vm, contract, alice, "acme", llm_status="VERIFIED")
    vid = list(contract.get_subject_verifications("acme").keys())[0]
    stake_before = to_int(contract.get_verifier(addr_key(alice))["stake"])
    rep_before = to_int(contract.get_verifier(addr_key(alice))["reputation_score"])
    fee_before = to_int(contract.get_fee_balance())

    # Challenge with inconclusive evidence: claim_stands, NO slash.
    result = json.loads(challenge(vm, contract, bob, vid, llm_status="INCONCLUSIVE"))
    assert result["outcome"] == "claim_stands"
    assert to_int(contract.get_verifier(addr_key(alice))["stake"]) == stake_before
    assert to_int(contract.get_verifier(addr_key(alice))["reputation_score"]) == rep_before
    assert to_int(contract.get_fee_balance()) == fee_before + 100  # challenge fee only


def test_reverify_inconclusive_does_not_slash(vm, contract, owner, alice):
    create_subject(vm, contract, owner)
    stake(vm, contract, alice, STAKE_REQUIRED * 2)
    verify(vm, contract, alice, "acme", llm_status="VERIFIED")
    vid = list(contract.get_subject_verifications("acme").keys())[0]
    stake_before = to_int(contract.get_verifier(addr_key(alice))["stake"])

    vm.sender = owner
    vm.value = 0
    vm.clear_mocks()
    vm.mock_web(re.escape("https://acme.example.com/about"), web_for("https://acme.example.com/about"))
    vm.mock_llm(r"Python boolean expressions", json.dumps({"checks": []}))
    vm.mock_llm(r"verification judge", json.dumps({"status": "INCONCLUSIVE", "violations": [], "reasoning": "r"}))
    contract.reverify(vid)

    assert to_int(contract.get_verifier(addr_key(alice))["stake"]) == stake_before  # no slash
    assert contract.is_verified("acme") is False  # no longer fresh-verified


# --------------------------------------------------------------------------
# 12. Two-party challenge, revision trail, verification-id return
# --------------------------------------------------------------------------


def test_verify_returns_verification_id(vm, contract, owner, alice):
    create_subject(vm, contract, owner)
    stake(vm, contract, alice, STAKE_REQUIRED * 2)
    vid = verify(vm, contract, alice, "acme", llm_status="VERIFIED")
    # verify_claims now returns the exact verification id (not None).
    assert isinstance(vid, str) and vid.startswith("acme:")
    assert vid in contract.get_subject_verifications("acme")


def test_two_party_challenge_fetches_verifier_evidence(vm, contract, owner, alice, bob):
    """The challenge pipeline must fetch BOTH the original verifier evidence
    and the challenger's counter-evidence. If the verifier's original URL is NOT
    mocked, the challenge must fail with a web error (proves it was fetched)."""
    create_subject(vm, contract, owner)
    stake(vm, contract, alice, STAKE_REQUIRED * 2)
    stake(vm, contract, bob, STAKE_REQUIRED * 2)
    verify(vm, contract, alice, "acme", llm_status="VERIFIED")
    vid = list(contract.get_subject_verifications("acme").keys())[0]

    # Challenge with NO mock for the original verifier URL -> web fetch fails.
    vm.sender = bob
    vm.value = 100
    vm.clear_mocks()
    vm.mock_web(re.escape("https://acme.example.com/counter"), {"status": 200, "body": "<html>x</html>"})
    vm.mock_llm(r"Python boolean expressions", json.dumps({"checks": []}))
    vm.mock_llm(r"verification judge", json.dumps({"status": "UNVERIFIED", "violations": [], "reasoning": "r"}))
    with vm.expect_revert("[TRANSIENT]Web fetch failed"):
        contract.challenge_verification(vid, ["https://acme.example.com/counter"])


def test_challenge_archives_revision_trail(vm, contract, owner, alice, bob):
    create_subject(vm, contract, owner)
    stake(vm, contract, alice, STAKE_REQUIRED * 2)
    stake(vm, contract, bob, STAKE_REQUIRED * 2)
    verify(vm, contract, alice, "acme", llm_status="VERIFIED")
    vid = list(contract.get_subject_verifications("acme").keys())[0]

    # Revision 1 exists at creation.
    revs = contract.get_verification_revisions(vid)
    assert "1" in revs
    assert revs["1"]["status"] == "VERIFIED"

    # Successful falsifying challenge archives revision 2 (UNVERIFIED).
    challenge(vm, contract, bob, vid, llm_status="UNVERIFIED")
    revs = contract.get_verification_revisions(vid)
    assert "2" in revs
    assert revs["2"]["status"] == "UNVERIFIED"
    # Original evidence hash is preserved, not lost.
    assert revs["1"]["evidence_hash"]
    assert revs["1"]["evidence_urls"] == "https://acme.example.com/about"
    # Both revisions share the verification's audit trail.
    assert to_int(contract.get_verification(vid)["revision_count"]) >= 2


def test_reverify_archives_revision_trail(vm, contract, owner, alice):
    create_subject(vm, contract, owner)
    stake(vm, contract, alice, STAKE_REQUIRED * 2)
    verify(vm, contract, alice, "acme", llm_status="VERIFIED")
    vid = list(contract.get_subject_verifications("acme").keys())[0]

    vm.sender = owner
    vm.value = 0
    vm.clear_mocks()
    vm.mock_web(re.escape("https://acme.example.com/about"), web_for("https://acme.example.com/about"))
    vm.mock_llm(r"Python boolean expressions", json.dumps({"checks": []}))
    vm.mock_llm(r"verification judge", json.dumps({"status": "VERIFIED", "violations": [], "reasoning": "r"}))
    contract.reverify(vid)

    revs = contract.get_verification_revisions(vid)
    assert "1" in revs and "2" in revs
    assert revs["2"]["status"] == "VERIFIED"


def test_evidence_independent_hosts_required_for_medium(vm, contract, owner, alice):
    create_subject(vm, contract, owner, required_level="medium")
    stake(vm, contract, alice, STAKE_REQUIRED * 2)
    # Two URLs from the SAME host -> rejected (not independent evidence).
    with vm.expect_revert("at least 2 distinct evidence hosts"):
        verify(
            vm,
            contract,
            alice,
            "acme",
            urls=["https://acme.example.com/a", "https://acme.example.com/b"],
            evidence_level="medium",
        )
    # Two URLs from DIFFERENT hosts -> accepted.
    verify(
        vm,
        contract,
        alice,
        "acme",
        urls=["https://acme.example.com/a", "https://registry.example.com/acme"],
        evidence_level="medium",
        llm_status="VERIFIED",
    )
    assert contract.is_verified("acme") is True


# --------------------------------------------------------------------------
# 13. Leader/validator consensus: exact verdict comparison
# --------------------------------------------------------------------------


def _replay_validator(vm, llm_status, violations=None):
    """Re-run the captured validator with fresh mocks, as if the validator's
    independent re-run of the pipeline saw `llm_status`. Returns the validator's
    verdict (True = agrees with the leader, False = disagrees)."""
    vm.clear_mocks()
    vm.mock_web(re.escape("https://acme.example.com/about"), web_for("https://acme.example.com/about"))
    vm.mock_llm(r"Python boolean expressions", json.dumps({"checks": []}))
    vm.mock_llm(
        r"verification judge",
        json.dumps({"status": llm_status, "violations": violations or [], "reasoning": "r"}),
    )
    return vm.run_validator()


def test_consensus_rejects_exact_status_disagreement(vm, contract, owner, alice):
    """The leader returns VERIFIED but the validator's re-run returns
    UNVERIFIED. Because consensus compares the EXACT status strings, the
    validator must disagree even though both statuses are non-empty."""
    create_subject(vm, contract, owner)
    stake(vm, contract, alice, STAKE_REQUIRED * 2)
    # Leader pipeline sees a VERIFIED verdict.
    verify(vm, contract, alice, "acme", llm_status="VERIFIED")

    # Validator independently re-runs the pipeline and sees UNVERIFIED.
    assert _replay_validator(vm, "UNVERIFIED", ["fraud"]) is False


def test_consensus_rejects_verified_vs_inconclusive_mismatch(vm, contract, owner, alice):
    """VERIFIED vs INCONCLUSIVE are different verdicts and must not agree."""
    create_subject(vm, contract, owner)
    stake(vm, contract, alice, STAKE_REQUIRED * 2)
    verify(vm, contract, alice, "acme", llm_status="VERIFIED")

    assert _replay_validator(vm, "INCONCLUSIVE") is False


def test_consensus_accepts_exact_status_match(vm, contract, owner, alice):
    """Same exact status (and matching prog_violated) -> validator agrees."""
    create_subject(vm, contract, owner)
    stake(vm, contract, alice, STAKE_REQUIRED * 2)
    verify(vm, contract, alice, "acme", llm_status="VERIFIED")

    assert _replay_validator(vm, "VERIFIED") is True


# --------------------------------------------------------------------------
# 14. get_all_subjects owner filter (Verify page alignment)
# --------------------------------------------------------------------------


def test_get_all_subjects_filters_by_owner(vm, contract, owner, alice):
    create_subject(vm, contract, owner, subject_id="acme")
    create_subject(vm, contract, owner, subject_id="nexus")
    # Alice owns a different subject.
    vm.sender = alice
    vm.value = 0
    contract.create_subject("alice-inc", "Alice Inc", "d", "organization", "low", "")

    # No filter -> everything.
    all_subjects = contract.get_all_subjects()
    assert set(all_subjects.keys()) == {"acme", "nexus", "alice-inc"}

    # Filtered by owner (case-insensitive, same as the Verify page).
    mine = contract.get_all_subjects(addr_key(owner))
    assert set(mine.keys()) == {"acme", "nexus"}
    alice_only = contract.get_all_subjects(addr_key(alice))
    assert set(alice_only.keys()) == {"alice-inc"}

    # Filtered results still expose the owner field the page compares.
    assert all(str(s["owner"]).lower() == addr_key(owner) for s in mine.values())
