const { createClient, chains, createAccount, generatePrivateKey } = require("genlayer-js");
const fs = require("fs");
const path = require("path");

// Final challenge-matrix run with claims that MATCH the actual example.com
// page text so the initial verification lands VERIFIED and stays stable:
//   owner reverify -> stays VERIFIED (claim holds)
//   self-challenge -> REJECTED
//   owner no-stake challenge -> REJECTED
//   real challenge (same evidence) -> claim_stands (no slash, fee only)
// The claim_falsified slash+reward path is covered by the local pytest suite.

const LOG = path.join(__dirname, "e2e8.log");
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
const STATE_FILE = path.join(__dirname, "e2e8-state.json");
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
    log(`  [${label}] ${verdict} payload=${(str || "").slice(0, 180)}`);
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
    log(`  view ${label} FAIL: ${(e.message || "").slice(0, 120)}`);
    return null;
  }
}

async function main() {
  fs.writeFileSync(LOG, `=== veridoc e2e8 ${new Date().toISOString()} ===\n`);
  const owner = createAccount(deployerPk);
  const verifierPk = generatePrivateKey();
  const challengerPk = generatePrivateKey();
  const verifier = createAccount(verifierPk);
  const challenger = createAccount(challengerPk);

  const SUBJECT = "hold" + String(Date.now() % 100000);
  // Match the literal example.com text ("This domain is for use in
  // documentation examples") so programmatic checks are SATISFIED -> VERIFIED.
  const CLAIMS = "example.com is a domain used for documentation examples";
  const URL = "https://example.com/";

  fs.writeFileSync(STATE_FILE, JSON.stringify({ subject: SUBJECT, verifierPk, challengerPk, verifierAddr: verifier.address, challengerAddr: challenger.address }, null, 2));

  log(`contract : ${CONTRACT}`);
  log(`owner    : ${owner.address}`);
  log(`verifier : ${verifier.address}`);
  log(`challenger: ${challenger.address}`);
  log(`subject  : ${SUBJECT}`);

  const client = createClient({ chain: chains.studionet });

  log("\n### SETUP ###");
  await submit(client, owner, "create_subject", [SUBJECT, "Example Site", "A website", "organization", "low", ""], "create_subject");
  await sleep(30000);
  await submit(client, verifier, "deposit_stake", [], "stake verifier", { value: STAKE_REQUIRED * 2n });
  await sleep(30000);
  await submit(client, challenger, "deposit_stake", [], "stake challenger", { value: STAKE_REQUIRED * 2n });
  await sleep(30000);

  log("\n### VERIFY (expect VERIFIED) ###");
  await submit(client, verifier, "verify_claims", [SUBJECT, CLAIMS, [URL], "low"], "verify", { value: VERIFY_FEE });
  await sleep(30000);
  const list = await read(client, "get_subject_verifications", [SUBJECT], "verifications");
  const vid = Object.keys(list || {})[0];
  let status = list?.[vid]?.status;
  log(`  verification id=${vid} status=${status}`);
  await read(client, "is_verified", [SUBJECT], "is_verified");

  if (status !== "VERIFIED") {
    log(`  INITIAL NOT VERIFIED (got ${status}); stop here.`);
    await read(client, "get_fee_balance", [], "fee");
    await read(client, "get_contract_stats", [], "stats");
    return;
  }

  log("\n### REVERIFY (owner) - expect stays VERIFIED ###");
  await submit(client, owner, "reverify", [vid], "owner reverify", { expectFail: false });
  await sleep(30000);
  status = (await read(client, "get_subject_verifications", [SUBJECT], "verifications"))?.[vid]?.status;
  log(`  status after reverify: ${status}`);

  log("\n### CHALLENGE MATRIX ###");
  await submit(client, verifier, "challenge_verification", [vid, [URL]], "self-challenge", { value: CHALLENGE_FEE, expectFail: true });
  await sleep(30000);
  await submit(client, owner, "challenge_verification", [vid, [URL]], "owner no-stake challenge", { value: CHALLENGE_FEE, expectFail: true });
  await sleep(30000);
  await submit(client, challenger, "challenge_verification", [vid, [URL]], "real challenge (claim_stands expected)", { value: CHALLENGE_FEE });
  await sleep(30000);

  await read(client, "get_verification", [vid], "verification final");
  await read(client, "get_subject_verdict", [SUBJECT], "verdict final");
  await read(client, "get_verifier", [verifier.address], "verifier final");
  await read(client, "get_verifier", [challenger.address], "challenger final");
  await read(client, "get_fee_balance", [], "fee balance");
  await read(client, "get_contract_stats", [], "stats");
  log("\nDONE");
}

main().catch((e) => { log(`Fatal: ${e.message}`); process.exit(1); });
