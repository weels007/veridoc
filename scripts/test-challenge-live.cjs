const { createClient, chains, createAccount, generatePrivateKey } = require("genlayer-js");
const fs = require("fs");
const path = require("path");

// One more on-chain attempt to get a VERIFIED verdict so we can exercise the
// challenge success path + owner reverify on the live network. Uses a claim
// that the example.com page text directly supports.

const LOG = path.join(__dirname, "challenge.log");
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
    log(`  view ${label}: ${JSON.stringify(r).slice(0, 900)}`);
    return r;
  } catch (e) {
    log(`  view ${label} FAIL: ${(e.message || "").slice(0, 200)}`);
    return null;
  }
}

async function main() {
  fs.writeFileSync(LOG, `=== veridoc challenge ${new Date().toISOString()} ===\n`);
  const owner = createAccount(deployerPk);
  const verifier = createAccount(generatePrivateKey());
  const challenger = createAccount(generatePrivateKey());

  const stamp = String(Date.now() % 100000);
  const SUBJECT = "ex" + stamp;
  const URL = "https://example.com";

  log(`contract : ${CONTRACT}`);
  log(`owner    : ${owner.address}`);
  log(`verifier : ${verifier.address}`);
  log(`challenger: ${challenger.address}`);
  log(`subject  : ${SUBJECT}`);

  const client = createClient({ chain: chains.studionet });
  await sleep(2000);

  await submit(client, owner, "create_subject", [SUBJECT, "Example Domain", "Illustrative example", "organization", "low", "example.com"], "create_subject");
  await submit(client, verifier, "deposit_stake", [], "stake verifier", { value: STAKE_REQUIRED * 2n });
  await submit(client, challenger, "deposit_stake", [], "stake challenger", { value: STAKE_REQUIRED * 2n });
  await submit(
    client,
    verifier,
    "verify_claims",
    [SUBJECT, "Example.com is a domain for use in illustrative examples in documents", [URL], "low"],
    "verify (expect VERIFIED)",
    { value: VERIFY_FEE }
  );

  const list = await read(client, "get_subject_verifications", [SUBJECT], "verifications");
  const vid = list ? Object.keys(list)[0] : null;
  const status = list?.[vid]?.status;
  log(`  verification id: ${vid} status=${status}`);

  if (status === "VERIFIED") {
    log("\n### CHALLENGE PATH (VERIFIED) ###");
    await submit(client, verifier, "challenge_verification", [vid, [URL]], "self-challenge", { value: CHALLENGE_FEE, expectFail: true });
    await submit(client, challenger, "challenge_verification", [vid, ["https://genlayer.com"]], "challenge by other", { value: CHALLENGE_FEE });
    await read(client, "get_verification", [vid], "verification after challenge");
    await read(client, "get_verification_revisions", [vid], "revisions after challenge");
    await read(client, "is_verified", [SUBJECT], "is_verified after challenge");

    log("\n### REVERIFY PATH ###");
    await submit(client, verifier, "reverify", [vid], "stranger reverify", { expectFail: true });
    await submit(client, owner, "reverify", [vid], "owner reverify", { value: 0n });
    await read(client, "get_verification", [vid], "verification after reverify");
    await read(client, "get_verification_revisions", [vid], "revisions after reverify");
  } else {
    log("  SKIP challenge/reverify (verification not VERIFIED; covered by pytest)");
  }

  await read(client, "get_contract_stats", [], "final stats");
  log("\nDONE");
}

main().catch((e) => {
  log(`Fatal: ${e.message}`);
  process.exit(1);
});