const { createClient, chains, createAccount, generatePrivateKey } = require("genlayer-js");
const fs = require("fs");
const path = require("path");

// v4: full happy path with REAL, fetchable URLs (example.com + genlayer.com).
// Subject has required_level=medium, allowed_domains="" (any). Verifies the
// returned verification id, two-party reverify/challenge, revision trail.

const LOG = path.join(__dirname, "v4.log");
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
  fs.writeFileSync(LOG, `=== veridoc v4 happy path ${new Date().toISOString()} ===\n`);
  const owner = createAccount(deployerPk);
  const verifier = createAccount(generatePrivateKey());
  const challenger = createAccount(generatePrivateKey());
  const stranger = createAccount(generatePrivateKey());

  const stamp = String(Date.now() % 100000);
  const SUBJECT = "live" + stamp;
  const CLAIMS = "example.com is a domain used for illustrative examples in documents";
  const URL_A = "https://example.com/";
  const URL_B = "https://genlayer.com/";

  log(`contract  : ${CONTRACT}`);
  log(`owner     : ${owner.address}`);
  log(`verifier  : ${verifier.address}`);
  log(`challenger: ${challenger.address}`);
  log(`stranger  : ${stranger.address}`);
  log(`subject   : ${SUBJECT}`);

  const client = createClient({ chain: chains.studionet });

  log("\n### SETUP ###");
  await submit(client, owner, "create_subject", [SUBJECT, "Example Site", "A website", "organization", "medium", ""], "create_subject (medium, any domain)");
  await sleep(20000);
  await submit(client, verifier, "deposit_stake", [], "stake verifier", { value: STAKE_REQUIRED * 2n });
  await sleep(20000);
  await submit(client, challenger, "deposit_stake", [], "stake challenger", { value: STAKE_REQUIRED * 2n });
  await sleep(20000);

  log("\n### VERIFY (medium, 2 distinct real hosts) ###");
  const r = await submit(client, verifier, "verify_claims",
    [SUBJECT, CLAIMS, [URL_A, URL_B], "medium"], "verify medium", { value: VERIFY_FEE });
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
    log(`  fallback vid: ${vid}`);
  }

  await read(client, "is_verified", [SUBJECT], "is_verified");
  await read(client, "get_subject_verdict", [SUBJECT], "verdict");

  if (vid) {
    await read(client, "get_verification", [vid], "get_verification (by id)");
    await read(client, "get_verification_revisions", [vid], "revisions (rev 1)");

    log("\n### REVERIFY (owner) ###");
    await submit(client, stranger, "reverify", [vid], "stranger reverify", { expectFail: true });
    await sleep(20000);
    await submit(client, owner, "reverify", [vid], "owner reverify", { expectFail: false });
    await sleep(20000);
    await read(client, "get_verification", [vid], "verification after reverify");
    await read(client, "get_verification_revisions", [vid], "revisions after reverify");

    log("\n### CHALLENGE (two-party) ###");
    await submit(client, verifier, "challenge_verification", [vid, [URL_A]], "self-challenge", { value: CHALLENGE_FEE, expectFail: true });
    await sleep(20000);
    await submit(client, owner, "challenge_verification", [vid, [URL_A]], "owner no-stake challenge", { value: CHALLENGE_FEE, expectFail: true });
    await sleep(20000);
    await submit(client, challenger, "challenge_verification", [vid, [URL_A]], "real challenge", { value: CHALLENGE_FEE });
    await sleep(20000);
    await read(client, "get_verification", [vid], "verification after challenge");
    await read(client, "get_verification_revisions", [vid], "revisions after challenge");
    await read(client, "get_subject_verdict", [SUBJECT], "verdict after challenge");
    await read(client, "get_verifier", [verifier.address], "verifier final");
    await read(client, "get_verifier", [challenger.address], "challenger final");
  }

  await read(client, "get_fee_balance", [], "fee balance");
  await read(client, "get_contract_stats", [], "stats");
  log("\nDONE");
}

main().catch((e) => { log(`Fatal: ${e.message}`); process.exit(1); });
