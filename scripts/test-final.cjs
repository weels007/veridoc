const { createClient, chains, createAccount, generatePrivateKey } = require("genlayer-js");
const fs = require("fs");
const path = require("path");

// Ultra-lean on-chain coverage of the remaining veridoc paths, paced to fit the
// 500 req/hour sliding-window studionet budget:
//   update_subject, set_allowed_domains, withdraw_stake, verify->VERIFIED,
//   owner reverify, challenge (self / unstaked / real).
// Every step sleeps generously before/after so the sliding window refills.

const LOG = path.join(__dirname, "e2e5.log");
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  fs.appendFileSync(LOG, line + "\n");
  console.log(line);
}

const PROBE = "0xd0F9D80b85D455dfd355ef63f8569047144b143E";
const CONTRACT = JSON.parse(fs.readFileSync(path.join(__dirname, "deploy.json"), "utf8")).address;
const deployerPk = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "..", "contract", "EscrowMediator", "scripts", "escrow-wallet.json"), "utf8")
).privateKey;

const VERIFY_FEE = 100n;
const CHALLENGE_FEE = 100n;
const STAKE_REQUIRED = 1000n;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForSlots(client, minSlots) {
  // Confirm RPC responds (probe) before doing anything.
  const started = Date.now();
  while (Date.now() - started < 110 * 60 * 1000) {
    try {
      await client.readContract({ address: PROBE, functionName: "get_contract_stats", args: [] });
      log("  RPC responsive.");
      return;
    } catch (e) {
      log(`  waiting for rate-limit reset (${String(e.message || "").slice(0, 50)})`);
      await sleep(60000);
    }
  }
  throw new Error("timed out waiting for RPC");
}

async function submit(client, account, fn, args, label, opts = {}) {
  const { value = 0n, expectFail = false } = opts;
  try {
    const tx = await client.writeContract({ account, address: CONTRACT, functionName: fn, args, value });
    log(`  tx ${fn} (${label}) submitted`);
    const receipt = await client.waitForTransactionReceipt({
      hash: tx, status: "FINALIZED", fullTransaction: true, interval: 30000, retries: 120,
    });
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
  fs.writeFileSync(LOG, `=== veridoc e2e5 ${new Date().toISOString()} ===\n`);
  const owner = createAccount(deployerPk);
  const verifier = createAccount(generatePrivateKey());
  const challenger = createAccount(generatePrivateKey());

  const stamp = String(Date.now() % 100000);
  const SUBJECT = "fin" + stamp;
  const CLAIMS = "example.com is used for illustrative examples in documents";
  const URL = "https://example.com/";

  log(`contract : ${CONTRACT}`);
  log(`owner    : ${owner.address}`);
  log(`verifier : ${verifier.address}`);
  log(`challenger: ${challenger.address}`);
  log(`subject  : ${SUBJECT}`);

  const client = createClient({ chain: chains.studionet });

  log("\n### waiting for RPC slots ###");
  await waitForSlots(client);

  log("\n### SETUP ###");
  await submit(client, owner, "create_subject", [SUBJECT, "Example Site", "A website", "organization", "low", ""], "create_subject");
  await sleep(60000);
  await submit(client, owner, "update_subject", [SUBJECT, "Example Site Ltd", "Updated desc", "organization", "medium"], "update_subject");
  await sleep(60000);
  await submit(client, owner, "set_allowed_domains", [SUBJECT, "example.com"], "set_allowed_domains");
  await sleep(60000);
  await submit(client, verifier, "deposit_stake", [], "stake verifier", { value: STAKE_REQUIRED * 2n });
  await sleep(60000);
  await submit(client, challenger, "deposit_stake", [], "stake challenger", { value: STAKE_REQUIRED * 2n });
  await sleep(60000);
  await submit(client, verifier, "withdraw_stake", [500n], "withdraw_stake 500");
  await sleep(60000);
  await read(client, "get_verifier", [verifier.address], "verifier stake after withdraw");

  log("\n### VERIFY -> VERIFIED ###");
  await submit(client, verifier, "verify_claims", [SUBJECT, CLAIMS, [URL], "low"], "verify VERIFIED", { value: VERIFY_FEE });
  await sleep(60000);
  const list = await read(client, "get_subject_verifications", [SUBJECT], "verifications");
  const keys = list ? Object.keys(list) : [];
  const vid = keys[0];
  const status = list?.[vid]?.status;
  log(`  verification id=${vid} status=${status}`);
  await read(client, "is_verified", [SUBJECT], "is_verified");

  if (status === "VERIFIED") {
    log("\n### REVERIFY (owner) ###");
    await submit(client, owner, "reverify", [vid], "owner reverify VERIFIED", { expectFail: false });
    await sleep(60000);
    log("\n### CHALLENGE ###");
    await submit(client, verifier, "challenge_verification", [vid, [URL]], "self-challenge", { value: CHALLENGE_FEE, expectFail: true });
    await sleep(60000);
    await submit(client, owner, "challenge_verification", [vid, [URL]], "owner no-stake challenge", { value: CHALLENGE_FEE, expectFail: true });
    await sleep(60000);
    await submit(client, challenger, "challenge_verification", [vid, [URL]], "real challenge", { value: CHALLENGE_FEE });
    await sleep(60000);
    await read(client, "get_verification", [vid], "verification after challenge");
    await read(client, "get_subject_verdict", [SUBJECT], "verdict after challenge");
  } else {
    log("  INITIAL VERIFY NOT VERIFIED -> challenge/reverify-succ skipped.");
  }

  await read(client, "get_fee_balance", [], "fee balance");
  await read(client, "get_contract_stats", [], "stats");
  log("\nDONE");
}

main().catch((e) => { log(`Fatal: ${e.message}`); process.exit(1); });
