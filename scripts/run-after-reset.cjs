const { createClient, chains } = require("genlayer-js");
const { spawn } = require("child_process");
const path = require("path");

const PROBE = "0xd0F9D80b85D455dfd355ef63f8569047144b143E"; // existing contract
const POLL_MS = 120000;
const MAX_WAIT_MS = 100 * 60 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForReset(client) {
  const started = Date.now();
  while (Date.now() - started < MAX_WAIT_MS) {
    try {
      await client.readContract({ address: PROBE, functionName: "get_contract_stats", args: [] });
      console.log(`[${new Date().toISOString()}] RPC is back.`);
      return;
    } catch (e) {
      console.log(`[${new Date().toISOString()}] still rate-limited (${String(e.message || "").slice(0, 60)})`);
    }
    await sleep(POLL_MS);
  }
  throw new Error("Timed out waiting for RPC rate-limit reset");
}

async function main() {
  const client = createClient({ chain: chains.studionet });
  const script = process.argv[2] || "test-challenge.cjs";
  console.log(`[${new Date().toISOString()}] waiting for RPC reset, then running ${script}...`);
  await waitForReset(client);
  console.log(`[${new Date().toISOString()}] launching ${script}`);
  const child = spawn("node", [script], { cwd: __dirname, stdio: "inherit" });
  child.on("exit", (code) => process.exit(code ?? 0));
}

main().catch((e) => { console.error("Fatal:", e.message); process.exit(1); });
