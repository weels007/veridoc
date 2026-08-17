const { createClient, chains, createAccount, generatePrivateKey } = require("genlayer-js");
const fs = require("fs");
const path = require("path");

// v5: real two-party challenge on a claim that STAYS VERIFIED (no reverify
// first), then admin withdraw_fee. Uses real URLs (example.com + genlayer.com).

const LOG = path.join(__dirname, "v5.log");
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
    let inner = typeof payload === "string" ? payload.trim() : "";
    if (inner.startsWith('"') && inner.endsWith('"') && inner.length >= 2) inner = inner.slice(1, -1);
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
  fs.writeFileSync(LOG, `=== veridoc v5 challenge+withdraw ${new Date().toISOString()} ===\n`);
  const owner = createAccount(deployerPk);
  const verifier = createAccount(generatePrivateKey());
  const challenger = createAccount(generatePrivateKey());

  const stamp = String(Date.now() % 100000);
  const SUBJECT = "ch" + stamp;
  // Claim that matches example.com content so the verdict stays VERIFIED.
  const CLAIMS = "example.com is a domain used for illustrative examples in documents";
  const URL_A = "https://example.com/";
  const URL_B = "https://genlayer.com/";

  log(`contract  : ${CONTRACT}`);
  log(`owner     : ${owner.address}`);
  log(`verifier  : ${verifier.address}`);
  log(`challenger: ${challenger.address}`);
  log(`subject   : ${SUBJECT}`);

  const client = createClient({ chain: chains.studionet });

  log("\n### SETUP ###");
  await submit(client, owner, "create_subject", [SUBJECT, "Example Site", "A website", "organization", "low", ""], "create_subject");
  await sleep(20000);
  await submit(client, verifier, "deposit_stake", [], "stake verifier", { value: STAKE_REQUIRED * 2n });
  await sleep(20000);
  await submit(client, challenger, "deposit_stake", [], "stake challenger", { value: STAKE_REQUIRED * 2n });
  await sleep(20000);

  log("\n### VERIFY (low, 1 real url) ###");
  const r = await submit(client, verifier, "verify_claims", [SUBJECT, CLAIMS, [URL_A], "low"], "verify low", { value: VERIFY_FEE });
  await sleep(20000);

  let vid = null;
  if (r.payload && typeof r.payload === "string") {
    const m = r.payload.match(/(\w+:[\w-]+:\d+)/);
    if (m) vid = m[1];
  }
  log(`  verification id from tx: ${vid}`);
  if (!vid) {
    const list = await read(client, "get_subject_verifications", [SUBJECT], "verifications (fallback)");
    vid = list ? Object.keys(list)[0] : null;
  }
  await read(client, "is_verified", [SUBJECT], "is_verified");
  await read(client, "get_subject_verdict", [SUBJECT], "verdict");

  if (vid) {
    log("\n### REAL TWO-PARTY CHALLENGE ###");
    const stakeBefore = (await read(client, "get_verifier", [verifier.address], "verifier stake before"))?.stake;
    const feeBefore = (await read(client, "get_fee_balance", [], "fee before")) ?? 0;
    await submit(client, challenger, "challenge_verification", [vid, [URL_A]], "real challenge (claim_stands expected)", { value: CHALLENGE_FEE });
    await sleep(20000);
    await read(client, "get_verification", [vid], "verification after challenge");
    await read(client, "get_verification_revisions", [vid], "revisions after challenge");
    await read(client, "get_verifier", [verifier.address], "verifier after challenge");
    await read(client, "get_subject_verdict", [SUBJECT], "verdict after challenge");
    log(`  stakeBefore=${stakeBefore} feeBefore=${feeBefore}`);
  }

  log("\n### WITHDRAW_FEE (admin) ###");
  await submit(client, owner, "withdraw_fee", [1n], "owner withdraw_fee 1 wei");
  await sleep(20000);
  await submit(client, verifier, "withdraw_fee", [1n], "non-admin withdraw_fee", { expectFail: true });
  await sleep(20000);
  await read(client, "get_fee_balance", [], "fee balance final");
  await read(client, "get_contract_stats", [], "stats");
  log("\nDONE");
}

main().catch((e) => { log(`Fatal: ${e.message}`); process.exit(1); });
