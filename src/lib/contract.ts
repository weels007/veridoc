"use client";

import { getClient, getContractAddress } from "./genlayer-client";
import { toast } from "sonner";

export const VERIFY_FEE = 100n;
export const CHALLENGE_FEE = 100n;
export const STAKE_REQUIRED = 1000n;

const CONTRACT = getContractAddress();

// --- Global rate-limit lock ------------------------------------------------
// Studionet throttles RPC (30 req/min, 500 req/hour). When one call hits the
// limit, we stop issuing requests for a while so the UI stops hammering the RPC
// and the budget can refill.
let rateLimitedUntil = 0;
export function isRateLimited(): boolean {
  return Date.now() < rateLimitedUntil;
}
export function markRateLimited(): void {
  // Longer lock: studionet's window is per-minute, so hold off ~2 min so the
  // next minute's budget has a chance to be available.
  rateLimitedUntil = Date.now() + 120_000;
}
function looksRateLimited(msg: string): boolean {
  return /rate limit/i.test(msg);
}

// --- Client-side throttle ------------------------------------------------
// Studionet allows only ~30 req/min. The UI polls many views, so we serialize
// every RPC call with a minimum gap to stay far under the limit. Each call
// waits its turn; a 429 extends the lock.
const MIN_GAP_MS = 2200; // ~27 req/min max
let lastRpcAt = 0;
let throttleQueue: Promise<void> = Promise.resolve();

function rpcThrottle(): Promise<void> {
  const next = throttleQueue.then(async () => {
    const now = Date.now();
    const wait = Math.max(0, lastRpcAt + MIN_GAP_MS - now);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRpcAt = Date.now();
  });
  // Keep the chain alive even if a step rejects.
  throttleQueue = next.catch(() => {});
  return next;
}

function describeRpcError(e: any): string {
  const msg = String(e?.message || e || "");
  if (looksRateLimited(msg)) markRateLimited();
  return msg;
}

export async function readContract(fn: string, args: any[] = []): Promise<any> {
  // Fast-fail while the lock is active (no RPC call at all).
  if (isRateLimited()) {
    console.warn(`read ${fn} skipped (rate-limited)`);
    return null;
  }
  await rpcThrottle();
  if (isRateLimited()) return null; // lock may have engaged while waiting
  try {
    const client = getClient();
    return await client.readContract({
      address: CONTRACT as `0x${string}`,
      functionName: fn,
      args,
    });
  } catch (e: any) {
    console.error(`read ${fn} failed:`, e);
    describeRpcError(e);
    return null;
  }
}

async function resolveSignerAddress(provider: any, preferred?: string): Promise<string | null> {
  if (preferred) return preferred;
  if (provider?.selectedAddress) return provider.selectedAddress;
  try {
    const accounts = await provider?.request?.({ method: "eth_accounts" });
    if (Array.isArray(accounts) && accounts.length > 0) return accounts[0];
  } catch (e) {
    console.error("resolveSignerAddress failed:", e);
  }
  return null;
}

export async function writeContract(
  provider: any,
  fn: string,
  args: any[] = [],
  value: bigint = 0n,
  preferredAddress?: string
): Promise<any> {
  const account = await resolveSignerAddress(provider, preferredAddress);
  if (!account) {
    throw new Error("Wallet not connected — please connect your wallet first");
  }
  // Respect the rate-limit lock: if the RPC is cooling down, tell the user to
  // wait instead of firing a failing (and budget-wasting) request.
  if (isRateLimited()) {
    throw new Error("RPC rate-limited — please wait ~2 minutes and retry");
  }
  // Account is bound in the client config (like betcle does), so writeContract
  // only needs the function signature + value.
  const client = getClient(account as `0x${string}`, provider);
  let tx: string;
  try {
    await rpcThrottle();
    tx = await client.writeContract({
      address: CONTRACT as `0x${string}`,
      functionName: fn,
      args,
      value,
    });
  } catch (e: any) {
    describeRpcError(e);
    throw new Error(String(e?.shortMessage || e?.message || "Transaction failed"));
  }
  toast.info(`Transaction submitted: ${tx}`);
  const receipt = await client.waitForTransactionReceipt({
    hash: tx,
    status: "FINALIZED" as any,
    fullTransaction: true,
    interval: 20000,
    retries: 120,
  } as any);
  return receipt;
}

export function extractPayload(receipt: any): string {
  const lr = receipt?.consensus_data?.leader_receipt?.[0];
  let payload = lr?.result?.payload;
  if (payload && typeof payload === "object") {
    payload = (payload as any).readable ?? JSON.stringify(payload);
  }
  return typeof payload === "string" ? payload : "";
}

/** Extract the verification id returned by verify_claims (e.g. "acme:0x..:1"). */
export function extractVerificationId(receipt: any): string | null {
  const payload = extractPayload(receipt).trim();
  // Contract returns the id as a quoted string, e.g. '"acme:0xabc:1"'.
  let inner = payload;
  if (inner.startsWith('"') && inner.endsWith('"') && inner.length >= 2) {
    inner = inner.slice(1, -1);
  }
  // Strict ver-id shape: <subject>:0x<40hex>:<count>. Anything else (error
  // messages, JSON) is NOT a verification id.
  if (/^[^:]+:0x[0-9a-fA-F]{40}:\d+$/.test(inner)) return inner;
  return null;
}

/**
 * Decide whether a write transaction succeeded, given the raw leader payload.
 * Success covers: empty/undefined, "null", a JSON object (challenge outcome,
 * quoted `{"staked":...}` / `{"withdrawn":...}`), and a returned verification id.
 * Anything else (plain string like a UserError message) is a rejection.
 */
export function isTxSuccess(receipt: any): { ok: boolean; reason: string } {
  const payload = extractPayload(receipt).trim();
  if (!payload || payload === "null") return { ok: true, reason: "" };
  let inner = payload;
  if (inner.startsWith('"') && inner.endsWith('"') && inner.length >= 2) {
    inner = inner.slice(1, -1);
  }
  if (inner.startsWith("{")) return { ok: true, reason: "" };
  if (/^[^:]+:0x[0-9a-fA-F]{40}:\d+$/.test(inner)) return { ok: true, reason: "" };
  // Prefix errors ([TRANSIENT]/[EXTERNAL]/[LLM]) are infra/fetch failures, not
  // business rejections — surface them with a clearer label.
  if (inner.startsWith("[TRANSIENT]")) return { ok: false, reason: `Temporary network failure: ${inner}` };
  if (inner.startsWith("[EXTERNAL]")) return { ok: false, reason: `External data problem: ${inner}` };
  if (inner.startsWith("[LLM]")) return { ok: false, reason: `AI consensus problem, please retry: ${inner}` };
  return { ok: false, reason: payload };
}

export function shortAddr(addr?: string) {
  if (!addr) return "-";
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

export function tsToDate(ts: any): string {
  const n = Number(ts ?? 0);
  if (!n) return "—";
  return new Date(n * 1000).toLocaleString();
}
