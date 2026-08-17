const { createClient, chains, createAccount } = require("genlayer-js");
const fs = require("fs");
const path = require("path");

// Resume: subject `rev18569` now has a VERIFIED verification (id ...:2).
// Exercise owner reverify + the challenge matrix on that VERIFIED id.

const LOG = path.join(__dirname, "e2e7.log");
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  fs.appendFileSync(LOG, line + "\n");
  console.log(line);
}

const CONTRACT = JSON.parse(fs.readFileSync(path.join(__dirname, "deploy.json"), "utf8")).address;
const deployerPk = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "..", "contract", "EscrowMediator", "scripts", "escrow-wallet.json"), "utf8")
).privateKey;
const state = JSON.parse(fs.readFileSync(path.join(__dirname, "e2e6-state.json"), "utf8"));

const VERIFY_FEE = 100n;
const CHALLENGE_FEE = 100n;
const SUBJECT = state.subject;
const URL_A = "https://example.com/";
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
  fs.writeFileSync(LOG, `=== veridoc e2e7 ${new Date().toISOString()} ===\n`);
  const owner = createAccount(deployerPk);
  const verifier = createAccount(state.verifierPk);
  const challenger = createAccount(state.challengerPk);

  log(`contract  : ${CONTRACT}`);
  log(`subject   : ${SUBJECT}`);
  log(`verifier  : ${verifier.address}`);
  log(`challenger: ${challenger.address}`);

  const client = createClient({ chain: chains.studionet });

  // Pick the VERIFIED verification id.
  const list = await read(client, "get_subject_verifications", [SUBJECT], "verifications");
  const verified = Object.entries(list || {}).find(([, v]) => v.status === "VERIFIED");
  if (!verified) {
    log("  ERROR: no VERIFIED verification found.");
    return;
  }
  const vid = verified[0];
  log(`  VERIFIED verification id: ${vid}`);

  log("\n### REVERIFY (owner) ###");
  await submit(client, owner, "reverify", [vid], "owner reverify VERIFIED", { expectFail: false });
  await sleep(30000);
  await read(client, "is_verified", [SUBJECT], "is_verified after reverify");

  log("\n### CHALLENGE MATRIX ###");
  await submit(client, verifier, "challenge_verification", [vid, [URL_A]], "self-challenge", { value: CHALLENGE_FEE, expectFail: true });
  await sleep(30000);
  await submit(client, owner, "challenge_verification", [vid, [URL_A]], "owner no-stake challenge", { value: CHALLENGE_FEE, expectFail: true });
  await sleep(30000);
  await submit(client, challenger, "challenge_verification", [vid, [URL_A]], "real challenge", { value: CHALLENGE_FEE });
  await sleep(30000);

  await read(client, "get_verification", [vid], "verification after challenge");
  await read(client, "get_subject_verdict", [SUBJECT], "verdict after challenge");
  await read(client, "get_verifier", [verifier.address], "verifier final");
  await read(client, "get_verifier", [challenger.address], "challenger final");
  await read(client, "get_fee_balance", [], "fee balance");
  await read(client, "get_contract_stats", [], "stats");
  log("\nDONE");
}

main().catch((e) => { log(`Fatal: ${e.message}`); process.exit(1); });
