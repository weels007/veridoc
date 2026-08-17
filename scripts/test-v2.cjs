const { createClient, chains, createAccount, generatePrivateKey } = require("genlayer-js");
const fs = require("fs");
const path = require("path");

// veridoc v2 end-to-end on studionet. Paced (sleep between steps) to stay under
// the 500 req/hour studionet budget. Writes progress to v2.log in real time.
// Covers: input validation, subject CRUD, staking, verify (returns id),
// independent-host rule, two-party challenge, revision trail, views.

const LOG = path.join(__dirname, "v2.log");
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  fs.appendFileSync(LOG, line + "\n");
  console.log(line);
}

const CONTRACT = JSON.parse(fs.readFileSync(path.join(__dirname, "deploy.json"), "utf8")).address;
const deployerPk = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "..", "contract", "EscrowMediator", "scripts", "escrow-wallet.json"), "utf8")
).privateKey;

const VERIFY_FEE = 100n;
const CHALLENGE_FEE = 100n;
const STAKE_REQUIRED = 1000n;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFinal(client, tx, label) {
  return client.waitForTransactionReceipt({
    hash: tx, status: "FINALIZED", fullTransaction: true, interval: 30000, retries: 120,
  });
}

async function submit(client, account, fn, args, label, opts = {}) {
  const { value = 0n, expectFail = false } = opts;
  try {
    const tx = await client.writeContract({ account, address: CONTRACT, functionName: fn, args, value });
    log(`  tx ${fn} (${label}) submitted`);
    const receipt = await waitFinal(client, tx, label);
    const lr = receipt.consensus_data?.leader_receipt?.[0];
    let payload = lr?.result?.payload;
    if (payload && typeof payload === "object") payload = payload.readable ?? JSON.stringify(payload);
    const str = typeof payload === "string" ? payload : JSON.stringify(payload);
    const agreed = receipt.result_name === "MAJORITY_AGREE" || receipt.result_name === "LEADER_AGREE";
    // Unquote: contract string returns come back quoted, e.g. '"acme:0x..:1"'
    // or '"{\"staked\": \"2000\"}"'. A UserError is a plain unquoted string.
    let inner = typeof payload === "string" ? payload.trim() : "";
    if (inner.startsWith('"') && inner.endsWith('"') && inner.length >= 2) {
      inner = inner.slice(1, -1);
    }
    const isPrefixErr = inner.startsWith("[");
    const isUserErr =
      typeof payload === "string" && !isPrefixErr && inner !== "null" &&
      !inner.startsWith("{") && !/^\w+:[\w-]+:\d+$/.test(inner);
    let verdict;
    if (isUserErr) verdict = `REJECTED(${inner})`;
    else if (isPrefixErr) verdict = `REJECTED(${inner})`;
    else if (agreed) verdict = "OK";
    else verdict = `result=${receipt.result_name}`;
    log(`  [${label}] ${verdict} payload=${(str || "").slice(0, 220)}`);
    if (expectFail && verdict === "OK") log(`  !!! expected rejection but got OK`);
    if (!expectFail && verdict !== "OK") log(`  !!! expected success but got ${verdict}`);
    return { verdict, receipt, payload: inner };
  } catch (e) {
    log(`  [${label}] submit err: ${(e.message || "").slice(0, 250)}`);
    return { ok: false, err: e.message };
  }
}

async function read(client, fn, args, label = fn) {
  try {
    const r = await client.readContract({ address: CONTRACT, functionName: fn, args });
    log(`  view ${label}: ${JSON.stringify(r)}`);
    return r;
  } catch (e) {
    log(`  view ${label} FAIL: ${(e.message || "").slice(0, 120)}`);
    return null;
  }
}

async function main() {
  fs.writeFileSync(LOG, `=== veridoc v2 e2e ${new Date().toISOString()} ===\n`);
  const owner = createAccount(deployerPk);
  const verifier = createAccount(generatePrivateKey());
  const challenger = createAccount(generatePrivateKey());
  const stranger = createAccount(generatePrivateKey());

  const stamp = String(Date.now() % 100000);
  const SUBJECT = "v2" + stamp;

  log(`contract  : ${CONTRACT}`);
  log(`owner     : ${owner.address}`);
  log(`verifier  : ${verifier.address}`);
  log(`challenger: ${challenger.address}`);
  log(`stranger  : ${stranger.address}`);
  log(`subject   : ${SUBJECT}`);

  const client = createClient({ chain: chains.studionet });

  // ---- 1. INPUT VALIDATION ----
  log("\n### 1. INPUT VALIDATION ###");
  await submit(client, owner, "create_subject", ["bad", "N", "D", "not-a-category", "low", ""], "bad category", { expectFail: true });
  await sleep(20000);
  await submit(client, owner, "create_subject", ["bad", "N", "D", "organization", "ultra", ""], "bad level", { expectFail: true });
  await sleep(20000);
  await submit(client, owner, "create_subject", ["bad", "N", "D", "organization", "low", "https://x.com"], "bad domain", { expectFail: true });
  await sleep(20000);
  await submit(client, owner, "create_subject", ["a:b", "N", "D", "organization", "low", ""], "colon in id", { expectFail: true });
  await sleep(20000);

  // ---- 2. SUBJECT + STAKE ----
  log("\n### 2. SUBJECT + STAKE ###");
  await submit(client, owner, "create_subject", [SUBJECT, "ACME Corp", "Software company in Berlin", "organization", "low", "acme.example.com|registry.example.com"], "create_subject");
  await sleep(20000);
  await submit(client, owner, "update_subject", [SUBJECT, "ACME Corp Ltd", "Updated", "organization", "medium"], "update_subject");
  await sleep(20000);
  await submit(client, verifier, "deposit_stake", [], "stake verifier", { value: STAKE_REQUIRED * 2n });
  await sleep(20000);
  await submit(client, challenger, "deposit_stake", [], "stake challenger", { value: STAKE_REQUIRED * 2n });
  await sleep(20000);
  await submit(client, verifier, "withdraw_stake", [200n], "withdraw_stake 200");
  await sleep(20000);

  // ---- 3. VERIFY (returns id) + independent-host rule ----
  log("\n### 3. VERIFY ###");
  // medium level requires >= 2 distinct hosts -> single host must be rejected.
  await submit(client, verifier, "verify_claims", [SUBJECT, "ACME Corp is headquartered in Berlin", ["https://acme.example.com/a", "https://acme.example.com/b"], "medium"], "same-host medium", { value: VERIFY_FEE, expectFail: true });
  await sleep(20000);
  // low level with 1 url (allowed domain).
  const r1 = await submit(client, verifier, "verify_claims", [SUBJECT, "ACME Corp is headquartered in Berlin", ["https://acme.example.com/about"], "low"], "verify low", { value: VERIFY_FEE });
  await sleep(20000);
  let vid = null;
  if (r1.payload && typeof r1.payload === "string") {
    const m = r1.payload.match(/(\w+:[\w-]+:\d+)/);
    if (m) vid = m[1];
  }
  log(`  verification id from tx: ${vid}`);
  if (vid) {
    await read(client, "get_verification", [vid], "get_verification (by returned id)");
    await read(client, "get_verification_revisions", [vid], "revisions (rev 1)");
  } else {
    // fallback: pick from list (we prefer the returned id, but prove fallback works too)
    const list = await read(client, "get_subject_verifications", [SUBJECT], "verifications");
    vid = list ? Object.keys(list)[0] : null;
  }
  await sleep(10000);
  await read(client, "is_verified", [SUBJECT], "is_verified");
  await read(client, "get_subject_verdict", [SUBJECT], "verdict");
  await read(client, "get_verifier", [verifier.address], "verifier");
  await read(client, "get_fee_balance", [], "fee balance");
  await read(client, "get_contract_stats", [], "stats");

  // ---- 4. REVERIFY (owner) ----
  log("\n### 4. REVERIFY ###");
  if (vid) {
    await submit(client, stranger, "reverify", [vid], "stranger reverify", { expectFail: true });
    await sleep(20000);
    await submit(client, owner, "reverify", [vid], "owner reverify", { expectFail: false });
    await sleep(20000);
    await read(client, "get_verification_revisions", [vid], "revisions after reverify");
  }

  // ---- 5. CHALLENGE (two-party) ----
  log("\n### 5. CHALLENGE ###");
  if (vid) {
    await submit(client, verifier, "challenge_verification", [vid, ["https://registry.example.com/revoked"]], "self-challenge", { value: CHALLENGE_FEE, expectFail: true });
    await sleep(20000);
    await submit(client, stranger, "challenge_verification", [vid, ["https://registry.example.com/revoked"]], "no-stake challenge", { value: CHALLENGE_FEE, expectFail: true });
    await sleep(20000);
    await submit(client, challenger, "challenge_verification", [vid, ["https://registry.example.com/revoked"]], "real challenge", { value: CHALLENGE_FEE });
    await sleep(20000);
    await read(client, "get_verification_revisions", [vid], "revisions after challenge");
    await read(client, "get_subject_verdict", [SUBJECT], "verdict after challenge");
  }

  // ---- 6. VIEWS ----
  log("\n### 6. VIEWS ###");
  await read(client, "get_subject", [SUBJECT], "subject");
  await read(client, "get_all_subjects", [], "all subjects");
  await read(client, "get_verified_subjects", [], "attestation registry");
  await read(client, "get_verifier", [verifier.address], "verifier final");
  await read(client, "get_verifier", [challenger.address], "challenger final");
  await read(client, "get_fee_balance", [], "fee final");
  await read(client, "get_contract_stats", [], "stats final");

  log("\nDONE");
}

main().catch((e) => { log(`Fatal: ${e.message}`); process.exit(1); });
