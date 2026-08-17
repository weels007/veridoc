import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const CONTRACT_ADDRESS =
  process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || "";
const RPC = process.env.NEXT_PUBLIC_RPC_URL || "https://studio.genlayer.com/api";

// All RPC traffic goes through our Next.js API route so the browser never
// talks cross-origin to studio.genlayer.com (which sends no CORS headers).
// Server-side proxy = no CORS, and lets us add rate-limit protection.
const ENDPOINT = "/api/rpc";

let clientInstance: ReturnType<typeof createClient> | null = null;
let cachedAddress: string | null = null;

export function getClient(address?: `0x${string}`, provider?: any) {
  if (address) {
    const wrappedProvider = provider ? wrapProvider(provider) : undefined;
    return createClient({
      chain: studionet,
      endpoint: ENDPOINT,
      account: address,
      ...(wrappedProvider && { provider: wrappedProvider }),
    });
  }

  const currentAddr = getContractAddress();
  if (clientInstance && cachedAddress === currentAddr) {
    return clientInstance;
  }

  clientInstance = createClient({ chain: studionet, endpoint: ENDPOINT });
  cachedAddress = currentAddr;
  return clientInstance;
}

function wrapProvider(provider: any) {
  if (!provider || provider.__glPatched) return provider;
  const orig = provider.request.bind(provider);
  provider.request = async (req: any) => {
    if (req?.method === "eth_sendTransaction" && Array.isArray(req.params) && req.params[0]) {
      const tx = { ...req.params[0] };
      tx.type = "0x0";
      tx.gasPrice = "0x0";
      delete tx.maxFeePerGas;
      delete tx.maxPriorityFeePerGas;
      if (!tx.gas) tx.gas = "0x100000";
      return orig({ method: "eth_sendTransaction", params: [tx] });
    }
    return orig(req);
  };
  provider.__glPatched = true;
  return provider;
}

export function getContractAddress() {
  return CONTRACT_ADDRESS;
}

export const CHAIN_CONFIG = {
  chainId: 61999,
  name: "Studionet",
  rpcUrl: RPC,
  currency: "GEN",
  explorerUrl:
    process.env.NEXT_PUBLIC_EXPLORER_URL || "https://explorer-studio.genlayer.com",
};
