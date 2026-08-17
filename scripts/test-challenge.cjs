const { createClient, chains, createAccount, generatePrivateKey } = require("genlayer-js");
const fs = require("fs");
const path = require("path");

// Focused test: exercise reverify (owner) + challenge on a VERIFIED claim.
// Runs minimal transactions to respect the 500 req/hour studionet budget.

const LOG = path.join(__dirname, "e2e2.log");
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  fs.appendFileSync(LOG, line + "\n");
  console.log(line);
}

const CONTRACT = JSON.parse(fs.readFileSync(path.join(__dirname, "deploy.json"), "utf8")).address;
const deployerPk = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "..", "..", "contract", "EscrowMediator", "scripts", "escrow-wallet.json"),
    "utf8"
  )
).privateKey;

const VERIFY_FEE = 100n;
const CHALLENGE_FEE = 100n;
const STAKE_REQUIRED = 1000n;

async function waitFinal(client, tx, label) {
  return client.waitForTransactionReceipt({
    hash: tx, status: "FINALIZED", fullTransaction: true, interval: 15000, retries: 400,
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
  fs.writeFileSync(LOG, `=== veridoc e2e2 ${new Date().toISOString()} ===\n`);
  const owner = createAccount(deployerPk);
  const verifier = createAccount(generatePrivateKey());
  const challenger = createAccount(generatePrivateKey());

  const stamp = String(Date.now() % 100000);
  const SUBJECT = "chall" + stamp;
  // Claims that the real example.com page actually contains, so consensus
  // should return VERIFIED for the initial verification.
  const CLAIMS = "example.com is a website owned by IANA";
  const URL = "https://example.com/";

  log(`contract : ${CONTRACT}`);
  log(`owner    : ${owner.address}`);
  log(`verifier : ${verifier.address}`);
  log(`challenger: ${challenger.address}`);
  log(`subject  : ${SUBJECT}`);

  const client = createClient({ chain: chains.studionet });

  await submit(client, owner, "create_subject", [SUBJECT, "Example Site", "A website", "organization", "low", ""], "create_subject");
  await submit(client, verifier, "deposit_stake", [], "stake verifier", { value: STAKE_REQUIRED * 2n });
  await submit(client, challenger, "deposit_stake", [], "stake challenger", { value: STAKE_REQUIRED * 2n });
  await submit(client, verifier, "verify_claims", [SUBJECT, CLAIMS, [URL], "low"], "verify (aim VERIFIED)", { value: VERIFY_FEE });

  const list = await read(client, "get_subject_verifications", [SUBJECT], "verifications");
  const keys = list ? Object.keys(list) : [];
  const vid = keys[0];
  const status = list?.[vid]?.status;
  log(`  verification id=${vid} status=${status}`);
  await read(client, "is_verified", [SUBJECT], "is_verified");

  if (status === "VERIFIED") {
    // Owner reverify first (rate-limited) - keep it VERIFIED.
    await submit(client, owner, "reverify", [vid], "owner reverify (VERIFIED)", { expectFail: false });
    // Self-challenge must be rejected.
    await submit(client, verifier, "challenge_verification", [vid, [URL]], "self-challenge", { value: CHALLENGE_FEE, expectFail: true });
    // Unstaked challenge must be rejected.
    await submit(client, owner, "challenge_verification", [vid, [URL]], "owner (no stake) challenge", { value: CHALLENGE_FEE, expectFail: true });
    // Real challenge by a staked third party.
    await submit(client, challenger, "challenge_verification", [vid, [URL]], "challenger challenge", { value: CHALLENGE_FEE });
    await read(client, "get_verification", [vid], "verification after challenge");
    await read(client, "get_subject_verdict", [SUBJECT], "verdict after challenge");
    await read(client, "get_verifier", [verifier.address], "verifier final");
    await read(client, "get_verifier", [challenger.address], "challenger final");
    await read(client, "get_fee_balance", [], "fee balance");
  } else {
    log("  INITIAL VERIFY NOT VERIFIED -> cannot exercise challenge; outcome recorded above.");
  }

  await read(client, "get_contract_stats", [], "stats");
  log("\nDONE");
}

main().catch((e) => { log(`Fatal: ${e.message}`); process.exit(1); });
