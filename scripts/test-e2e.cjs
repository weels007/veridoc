const { createClient, chains, createAccount, generatePrivateKey } = require("genlayer-js");
const fs = require("fs");
const path = require("path");

// veridoc end-to-end test on studionet.
// Writes progress to e2e.log in real time (so a timeout never hides partial
// results). Tolerant of non-deterministic LLM/web verdicts: it records whatever
// status consensus produced and still exercises every public method.

const LOG = path.join(__dirname, "e2e.log");
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  fs.appendFileSync(LOG, line + "\n");
  console.log(line);
}

const argOf = (name) => {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
};

const CONTRACT = argOf("address")
  || JSON.parse(fs.readFileSync(path.join(__dirname, "deploy.json"), "utf8")).address;

const walletArg = argOf("wallet");
const deployerPk = walletArg
  ? JSON.parse(fs.readFileSync(path.resolve(__dirname, walletArg), "utf8")).privateKey
  : JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "..", "..", "contract", "EscrowMediator", "scripts", "escrow-wallet.json"),
        "utf8"
      )
    ).privateKey;

const VERIFY_FEE = 100n;
const CHALLENGE_FEE = 100n;
const STAKE_REQUIRED = 1000n;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Sparse polling via the SDK receipt waiter (the same pattern the sibling
// ConditionAssessor e2e uses and that works against studionet).
async function waitFinal(client, tx, label) {
  return client.waitForTransactionReceipt({
    hash: tx,
    status: "FINALIZED",
    fullTransaction: true,
    interval: 15000,
    retries: 400,
  });
}

async function submit(client, account, fn, args, label, opts = {}) {
  const { value = 0n, expectFail = false } = opts;
  try {
    const tx = await client.writeContract({ account, address: CONTRACT, functionName: fn, args, value });
    log(`  tx ${fn} (${label}) submitted: ${tx}`);
    const receipt = await waitFinal(client, tx, label);
    const lr = receipt.consensus_data?.leader_receipt?.[0];
    const payload = lr?.result?.payload;
    const raw = typeof payload === "object" && payload !== null ? payload.readable : payload;
    const str = typeof raw === "string" ? raw : JSON.stringify(raw);
    const agreed = receipt.result_name === "MAJORITY_AGREE" || receipt.result_name === "LEADER_AGREE";
    // A contract UserError (deterministic business error) surfaces as a plain
    // string payload on an agreed rollback. That is a REJECTED outcome, even
    // though result_name may read MAJORITY_AGREE.
    const isPrefixErr = typeof payload === "string" && payload.startsWith("[");
    const isUserErr = typeof payload === "string" && !isPrefixErr;
    let verdict;
    if (isUserErr) verdict = `REJECTED(${payload})`;
    else if (isPrefixErr) verdict = `REJECTED(${payload})`;
    else if (agreed) verdict = "OK";
    else verdict = `result=${receipt.result_name}`;
    log(`  [${label}] ${verdict} payload=${(str || "").slice(0, 200)}`);
    if (expectFail && verdict === "OK") log(`  !!! expected rejection but got OK`);
    if (!expectFail && verdict !== "OK") log(`  !!! expected success but got ${verdict}`);
    return { verdict, receipt, payload };
  } catch (e) {
    log(`  [${label}] submit err: ${(e.message || "").slice(0, 300)}`);
    if (!expectFail) log(`  !!! unexpected submit error`);
    return { ok: false, err: e.message };
  }
}

async function read(client, fn, args, label = fn) {
  try {
    const r = await client.readContract({ address: CONTRACT, functionName: fn, args });
    log(`  view ${label}: ${JSON.stringify(r)}`);
    return r;
  } catch (e) {
    log(`  view ${label} FAIL: ${(e.message || "").slice(0, 200)}`);
    return null;
  }
}

async function main() {
  fs.writeFileSync(LOG, `=== veridoc e2e ${new Date().toISOString()} ===\n`);
  const owner = createAccount(deployerPk);
  const verifierA = createAccount(generatePrivateKey());
  const verifierB = createAccount(generatePrivateKey());
  const challenger = createAccount(generatePrivateKey());
  const stranger = createAccount(generatePrivateKey());

  const stamp = String(Date.now() % 100000);
  const SUBJECT = "acme" + stamp;
  const URL_A = "https://example.com";
  const URL_B = "https://genlayer.com";

  log(`contract   : ${CONTRACT}`);
  log(`owner/admin: ${owner.address}`);
  log(`verifierA  : ${verifierA.address}`);
  log(`verifierB  : ${verifierB.address}`);
  log(`challenger : ${challenger.address}`);
  log(`stranger   : ${stranger.address}`);
  log(`subject    : ${SUBJECT}`);

  const client = createClient({ chain: chains.studionet });
  await sleep(2000);

  // ---- 1. INPUT VALIDATION (expect rejection) ----
  log("\n### 1. INPUT VALIDATION ###");
  await submit(client, owner, "create_subject", ["bad", "N", "D", "not-a-category", "low", ""], "bad category", { expectFail: true });
  await submit(client, owner, "create_subject", ["bad", "N", "D", "organization", "ultra", ""], "bad level", { expectFail: true });
  await submit(client, owner, "create_subject", ["bad", "N", "D", "organization", "low", "https://x.com"], "bad domain", { expectFail: true });

  // ---- 2. STAKE / ROLE CHECKS ----
  log("\n### 2. STAKE / ROLE CHECKS ###");
  await submit(client, stranger, "withdraw_fee", [1n], "stranger withdraw_fee", { expectFail: true });
  await submit(client, verifierA, "deposit_stake", [], "no value stake", { expectFail: true });

  // ---- 3. CREATE SUBJECT + STAKE + VERIFY ----
  log("\n### 3. CREATE + STAKE + VERIFY ###");
  await submit(client, owner, "create_subject", [SUBJECT, "ACME Corp", "Software company in Berlin", "organization", "low", ""], "create_subject");
  await submit(client, verifierA, "deposit_stake", [], "stake A", { value: STAKE_REQUIRED * 2n });
  await submit(client, verifierB, "deposit_stake", [], "stake B", { value: STAKE_REQUIRED * 2n });
  await submit(client, challenger, "deposit_stake", [], "stake challenger", { value: STAKE_REQUIRED * 2n });

  await submit(client, verifierA, "verify_claims", [SUBJECT, "ACME Corp is headquartered in Berlin", [URL_A, URL_B], "low"], "verify A", { value: VERIFY_FEE });
  await sleep(2000);

  await read(client, "is_verified", [SUBJECT], "is_verified");
  await read(client, "get_subject_verdict", [SUBJECT], "verdict");
  await read(client, "get_subject", [SUBJECT], "get_subject");
  await read(client, "get_subject_verifications", [SUBJECT], "subject verifications");
  await read(client, "get_verifier", [verifierA.address], "verifier A");
  await read(client, "get_verifier", [verifierB.address], "verifier B");
  await read(client, "get_verifier", [challenger.address], "challenger");
  await read(client, "get_fee_balance", [], "fee balance");
  await read(client, "get_verified_subjects", [], "attestation registry");
  await read(client, "get_all_subjects", [], "all subjects");
  await read(client, "get_contract_stats", [], "stats");

  // ---- 4. REVERIFY / CHALLENGE ----
  log("\n### 4. REVERIFY / CHALLENGE ###");
  const list = await read(client, "get_subject_verifications", [SUBJECT], "list for reverify");
  const keys = list ? Object.keys(list) : [];
  const vid = keys[0];
  log(`  verification id: ${vid} status=${list?.[vid]?.status}`);
  await submit(client, stranger, "reverify", [vid], "stranger reverify", { expectFail: true });

  if (list?.[vid]?.status === "VERIFIED") {
    await submit(client, verifierA, "challenge_verification", [vid, [URL_A]], "self-challenge", { value: CHALLENGE_FEE, expectFail: true });
    await submit(client, verifierB, "challenge_verification", [vid, [URL_A]], "challenge by B", { value: CHALLENGE_FEE });
    await read(client, "is_verified", [SUBJECT], "is_verified after challenge");
    await read(client, "get_verification", [vid], "get_verification");
  } else {
    log("  SKIP challenge (verification not VERIFIED; cannot be challenged by design)");
  }

  // ---- 5. ADMIN FEE WITHDRAWAL ----
  log("\n### 5. ADMIN FEE WITHDRAWAL ###");
  const fee = await read(client, "get_fee_balance", [], "fee before withdraw");
  const feeN = fee && fee !== null ? (typeof fee === "object" ? Number(fee.toString?.() ?? fee) : Number(fee)) : 0;
  if (feeN > 0n || feeN > 0) {
    const amount = 1n;
    await submit(client, owner, "withdraw_fee", [amount], "owner withdraw_fee", { expectFail: feeN < 1 });
    await read(client, "get_fee_balance", [], "fee after withdraw");
  } else {
    await submit(client, owner, "withdraw_fee", [1n], "owner withdraw_fee (expect fail, empty)", { expectFail: true });
  }

  log("\n### 6. FINAL STATS ###");
  await read(client, "get_contract_stats", [], "stats final");
  log("\nDONE");
}

main().catch((e) => {
  log(`Fatal: ${e.message}`);
  process.exit(1);
});
