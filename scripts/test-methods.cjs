const { createClient, chains, createAccount, generatePrivateKey } = require("genlayer-js");
const fs = require("fs");
const path = require("path");

// Focused on-chain test for the methods not exercised by test-e2e.cjs:
// update_subject, set_allowed_domains, withdraw_stake, challenge success
// path, get_verification, get_verification_revisions, get_all_verifications.

const LOG = path.join(__dirname, "methods.log");
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

async function waitFinal(client, tx) {
  return client.waitForTransactionReceipt({
    hash: tx,
    status: "FINALIZED",
    fullTransaction: true,
    interval: 15000,
    retries: 100,
  });
}

async function submit(client, account, fn, args, label, opts = {}) {
  const { value = 0n, expectFail = false } = opts;
  try {
    const tx = await client.writeContract({ account, address: CONTRACT, functionName: fn, args, value });
    const receipt = await waitFinal(client, tx);
    const lr = receipt.consensus_data?.leader_receipt?.[0];
    const payload = lr?.result?.payload;
    const raw = typeof payload === "object" && payload !== null ? payload.readable : payload;
    const str = typeof raw === "string" ? raw : JSON.stringify(raw);
    const agreed = receipt.result_name === "MAJORITY_AGREE" || receipt.result_name === "LEADER_AGREE";
    const isUserErr = typeof payload === "string" && !payload.startsWith("[");
    let verdict;
    if (typeof payload === "string") verdict = `REJECTED(${payload})`;
    else if (agreed) verdict = "OK";
    else verdict = `result=${receipt.result_name}`;
    log(`  [${label}] ${verdict} payload=${(str || "").slice(0, 260)}`);
    if (expectFail && verdict === "OK") log("  !!! expected rejection but got OK");
    if (!expectFail && verdict !== "OK") log(`  !!! expected success but got ${verdict}`);
    return { verdict, payload };
  } catch (e) {
    log(`  [${label}] submit err: ${(e.message || "").slice(0, 300)}`);
    if (!expectFail) log("  !!! unexpected submit error");
    return { ok: false, err: e.message };
  }
}

async function read(client, fn, args, label = fn) {
  try {
    const r = await client.readContract({ address: CONTRACT, functionName: fn, args });
    log(`  view ${label}: ${JSON.stringify(r).slice(0, 800)}`);
    return r;
  } catch (e) {
    log(`  view ${label} FAIL: ${(e.message || "").slice(0, 200)}`);
    return null;
  }
}

async function main() {
  fs.writeFileSync(LOG, `=== veridoc methods ${new Date().toISOString()} ===\n`);
  const owner = createAccount(deployerPk);
  const verifier = createAccount(generatePrivateKey());
  const challenger = createAccount(generatePrivateKey());

  const stamp = String(Date.now() % 100000);
  const SUBJECT = "gl" + stamp;
  const URL_G = "https://genlayer.com";
  const URL_E = "https://example.com";

  log(`contract : ${CONTRACT}`);
  log(`owner    : ${owner.address}`);
  log(`verifier : ${verifier.address}`);
  log(`challenger: ${challenger.address}`);
  log(`subject  : ${SUBJECT}`);

  const client = createClient({ chain: chains.studionet });
  await sleep(2000);

  log("\n### 1. CREATE SUBJECT + OWNER-GATED UPDATE METHODS ###");
  await submit(client, owner, "create_subject", [SUBJECT, "GenLayer", "Layer-1 intelligent contract chain", "organization", "low", ""], "create_subject");
  await submit(client, verifier, "update_subject", [SUBJECT, "x", "y", "organization", "low"], "stranger update_subject", { expectFail: true });
  await submit(client, verifier, "set_allowed_domains", [SUBJECT, "genlayer.com"], "stranger set_allowed_domains", { expectFail: true });
  await submit(client, owner, "update_subject", [SUBJECT, "GenLayer Network", "Layer-1 intelligent contract chain", "organization", "low"], "owner update_subject");
  await submit(client, owner, "set_allowed_domains", [SUBJECT, "genlayer.com"], "owner set_allowed_domains");

  log("\n### 2. STAKE + VERIFY (expect VERIFIED against genlayer.com) ###");
  await submit(client, verifier, "deposit_stake", [], "stake verifier", { value: STAKE_REQUIRED * 2n });
  await submit(client, challenger, "deposit_stake", [], "stake challenger", { value: STAKE_REQUIRED * 2n });
  await submit(client, verifier, "verify_claims", [SUBJECT, "GenLayer is a layer-1 blockchain network that runs intelligent contracts", [URL_G], "low"], "verify", { value: VERIFY_FEE });

  const list = await read(client, "get_subject_verifications", [SUBJECT], "verifications");
  const vid = list ? Object.keys(list)[0] : null;
  const status = list?.[vid]?.status;
  log(`  verification id: ${vid} status=${status}`);

  await read(client, "get_verification", [vid], "get_verification");
  await read(client, "get_verification_revisions", [vid], "revision trail");
  await read(client, "get_all_verifications", [], "all verifications");

  log("\n### 3. CHALLENGE (success or claim_stands, both record a revision) ###");
  if (status === "VERIFIED") {
    await submit(client, verifier, "challenge_verification", [vid, [URL_G]], "self-challenge", { value: CHALLENGE_FEE, expectFail: true });
    await submit(client, challenger, "challenge_verification", [vid, [URL_E]], "challenge", { value: CHALLENGE_FEE });
    await read(client, "get_verification", [vid], "verification after challenge");
    await read(client, "get_verification_revisions", [vid], "revisions after challenge");
  } else {
    log("  SKIP challenge (verification not VERIFIED)");
  }

  log("\n### 4. WITHDRAW STAKE ###");
  await submit(client, verifier, "withdraw_stake", [500n], "withdraw_stake", { value: 0n });
  await read(client, "get_verifier", [verifier.address], "verifier after withdraw");
  await submit(client, verifier, "withdraw_stake", [999999n], "over-withdraw", { value: 0n, expectFail: true });

  log("\n### 5. FINAL STATS ###");
  await read(client, "get_contract_stats", [], "stats");
  log("\nDONE");
}

main().catch((e) => {
  log(`Fatal: ${e.message}`);
  process.exit(1);
});