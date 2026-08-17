const { createClient, chains, createAccount } = require("genlayer-js");
const fs = require("fs");
const path = require("path");

const CODE = fs.readFileSync(
  path.join(__dirname, "..", "contracts", "veridoc.py"),
  "utf8"
);

const argOf = (name) => {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
};

async function main() {
  const walletArg = argOf("wallet");
  const walletPath = walletArg
    ? path.resolve(__dirname, walletArg)
    : path.join(__dirname, "..", "..", "contract", "EscrowMediator", "scripts", "escrow-wallet.json");
  const w = JSON.parse(fs.readFileSync(walletPath, "utf8"));
  const account = createAccount(w.privateKey);
  const client = createClient({ chain: chains.studionet });

  console.log("Deploying veridoc from", account.address);
  const tx = await client.deployContract({
    account,
    code: CODE,
    args: [],
    consensusMaxRotations: 3,
  });
  console.log("Deploy tx hash:", tx);

  const receipt = await client.waitForTransactionReceipt({
    hash: tx,
    status: "FINALIZED",
    fullTransaction: true,
    interval: 10000,
    retries: 1500,
  });
  console.log("receipt.status_name:", receipt.status_name, "result_name:", receipt.result_name);
  console.log("result:", JSON.stringify(receipt.result));
  const address = receipt.recipient || receipt.to_address || null;
  console.log("CONTRACT_ADDRESS:", address);

  const out = {
    deployedAt: new Date().toISOString(),
    tx,
    address,
    owner: account.address,
  };
  fs.writeFileSync(path.join(__dirname, "deploy.json"), JSON.stringify(out, null, 2));
  console.log("saved scripts/deploy.json");
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
