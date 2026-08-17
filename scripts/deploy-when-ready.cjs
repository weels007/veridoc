const { createClient, chains, createAccount } = require("genlayer-js");
const fs = require("fs");
const path = require("path");

const CODE = fs.readFileSync(path.join(__dirname, "..", "contracts", "veridoc.py"), "utf8");

const PROBE = "0xd0F9D80b85D455dfd355ef63f8569047144b143E"; // existing ConditionAssessor contract
const POLL_MS = 120000; // 2 min between probes (budget-conscious)
const MAX_WAIT_MS = 100 * 60 * 1000; // up to 100 minutes

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForReset(client) {
  const started = Date.now();
  while (Date.now() - started < MAX_WAIT_MS) {
    try {
      await client.readContract({
        address: PROBE,
        functionName: "get_contract_stats",
        args: [],
      });
      console.log(`[${new Date().toISOString()}] RPC is back.`);
      return;
    } catch (e) {
      const msg = String(e.message || "");
      console.log(`[${new Date().toISOString()}] still rate-limited (${msg.slice(0, 60)})`);
    }
    await sleep(POLL_MS);
  }
  throw new Error("Timed out waiting for RPC rate-limit reset");
}

async function main() {
  const w = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "..", "..", "contract", "EscrowMediator", "scripts", "escrow-wallet.json"),
      "utf8"
    )
  );
  const account = createAccount(w.privateKey);
  const client = createClient({ chain: chains.studionet });

  console.log(`[${new Date().toISOString()}] waiting for RPC rate-limit reset...`);
  await waitForReset(client);

  console.log("Deploying veridoc from", account.address);
  const tx = await client.deployContract({
    account, code: CODE, args: [], consensusMaxRotations: 3,
  });
  console.log("Deploy tx hash:", tx);

  const receipt = await client.waitForTransactionReceipt({
    hash: tx, status: "FINALIZED", fullTransaction: true,
    interval: 15000, retries: 400,
  });
  console.log("receipt.status_name:", receipt.status_name, "result_name:", receipt.result_name);
  console.log("result:", JSON.stringify(receipt.result));
  const address = receipt.recipient || receipt.to_address || null;
  console.log("CONTRACT_ADDRESS:", address);

  const out = { deployedAt: new Date().toISOString(), tx, address, owner: account.address };
  fs.writeFileSync(path.join(__dirname, "deploy.json"), JSON.stringify(out, null, 2));
  console.log("saved scripts/deploy.json");
}

main().catch((e) => { console.error("Fatal:", e.message); process.exit(1); });
