const { createClient, chains, createAccount, generatePrivateKey } = require("genlayer-js");
const fs = require("fs");
const path = require("path");

// Self-contained paced run: persists ephemeral keys so it can be resumed, and
// covers the full challenge/reverify story on a VERIFIED claim.
//   node test-continue.cjs            (creates fresh subject)
//   node test-continue.cjs --resume    (reuses persisted subject/keys)

const LOG = path.join(__dirname, "e2e6.log");
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
const STATE_FILE = path.join(__dirname, "e2e6-state.json");
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
  fs.writeFileSync(LOG, `=== veridoc e2e6 ${new Date().toISOString()} ===\n`);
  const resume = process.argv.includes("--resume");
  const owner = createAccount(deployerPk);

  let state;
  if (resume && fs.existsSync(STATE_FILE)) {
    state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    log(`  RESUMING subject=${state.subject} verifier=${state.verifierAddr}`);
  } else {
    const verifierPk = generatePrivateKey();
    const challengerPk = generatePrivateKey();
    const verifier = createAccount(verifierPk);
    const challenger = createAccount(challengerPk);
    state = {
      subject: "rev" + String(Date.now() % 100000),
      verifierPk,
      challengerPk,
      verifierAddr: verifier.address,
      challengerAddr: challenger.address,
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    log(`  NEW subject=${state.subject} verifier=${verifier.address} challenger=${challenger.address}`);
  }

  const verifier = createAccount(state.verifierPk);
  const challenger = createAccount(state.challengerPk);
  const SUBJECT = state.subject;
  const CLAIMS = "example.com is used for illustrative examples in documents";
  const URL_A = "https://example.com/";
  const URL_B = "https://example.com/#notes";

  log(`contract : ${CONTRACT}`);
  log(`owner    : ${owner.address}`);

  const client = createClient({ chain: chains.studionet });

  if (!resume) {
    log("\n### SETUP ###");
    await submit(client, owner, "create_subject", [SUBJECT, "Example Site", "A website", "organization", "low", ""], "create_subject");
    await sleep(30000);
    await submit(client, verifier, "deposit_stake", [], "stake verifier", { value: STAKE_REQUIRED * 2n });
    await sleep(30000);
    await submit(client, challenger, "deposit_stake", [], "stake challenger", { value: STAKE_REQUIRED * 2n });
    await sleep(30000);
  }

  log("\n### VERIFY (low level, 1 url) ###");
  await submit(client, verifier, "verify_claims", [SUBJECT, CLAIMS, [URL_A], "low"], "verify low", { value: VERIFY_FEE });
  await sleep(30000);
  let list = await read(client, "get_subject_verifications", [SUBJECT], "verifications");
  let keysArr = list ? Object.keys(list) : [];
  let vid = keysArr[0];
  let status = list?.[vid]?.status;
  log(`  verification id=${vid} status=${status}`);
  await read(client, "is_verified", [SUBJECT], "is_verified");

  if (status !== "VERIFIED") {
    log("\n  Not VERIFIED with low level; retrying with medium + 2 urls...");
    await submit(client, verifier, "verify_claims", [SUBJECT, CLAIMS, [URL_A, URL_B], "medium"], "verify medium", { value: VERIFY_FEE });
    await sleep(30000);
    list = await read(client, "get_subject_verifications", [SUBJECT], "verifications (retry)");
    keysArr = list ? Object.keys(list) : [];
    vid = keysArr[0];
    status = list?.[vid]?.status;
    log(`  verification id=${vid} status=${status}`);
    await read(client, "is_verified", [SUBJECT], "is_verified (retry)");
  }

  if (status === "VERIFIED") {
    log("\n### REVERIFY (owner) ###");
    await submit(client, owner, "reverify", [vid], "owner reverify VERIFIED", { expectFail: false });
    await sleep(30000);

    log("\n### CHALLENGE ###");
    await submit(client, verifier, "challenge_verification", [vid, [URL_A]], "self-challenge", { value: CHALLENGE_FEE, expectFail: true });
    await sleep(30000);
    await submit(client, owner, "challenge_verification", [vid, [URL_A]], "owner no-stake challenge", { value: CHALLENGE_FEE, expectFail: true });
    await sleep(30000);
    await submit(client, challenger, "challenge_verification", [vid, [URL_A]], "real challenge", { value: CHALLENGE_FEE });
    await sleep(30000);
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
