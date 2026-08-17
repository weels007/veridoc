"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { readContract, isRateLimited } from "./contract";

// Base + max polling delays. We keep them conservative because Studionet
// throttles RPC heavily (30 req/min). Backoff grows the delay on failures.
const BASE_MS = 15_000;
const MAX_MS = 60_000;

/**
 * Poll a read-only contract view. Uses a self-rescheduling setTimeout so the
 * delay can grow (backoff) when reads fail or the RPC is rate-limited, and
 * shrink back to the base when reads succeed. Keeps the last good value on
 * transient errors instead of wiping the UI.
 */
export function useLive<T = any>(fn: string, args: any[] = [], deps: any[] = [], intervalMs: number = BASE_MS) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<number>(0);

  const delayRef = useRef(intervalMs);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    // Fast-fail while the global rate-limit lock is active.
    if (isRateLimited()) {
      delayRef.current = Math.min(MAX_MS, delayRef.current * 2);
      return;
    }
    const r = await readContract(fn, args);
    if (r !== null) {
      setData(r as T);
      delayRef.current = intervalMs; // success -> back to base
    } else {
      delayRef.current = Math.min(MAX_MS, delayRef.current * 2); // failure -> backoff
    }
    setLoading(false);
    setLastUpdated(Date.now());
  }, [fn, JSON.stringify(args), intervalMs]);

  useEffect(() => {
    setLoading(true);
    delayRef.current = intervalMs;
    load();
  }, [load, ...deps]);

  // Self-rescheduling timeout (dynamic delay for backoff).
  useEffect(() => {
    timerRef.current = setTimeout(function tick() {
      load();
      timerRef.current = setTimeout(tick, delayRef.current);
    }, intervalMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [load, intervalMs]);

  return { data, loading, lastUpdated, reload: load };
}

/**
 * Same as useLive but for several independent views fetched together.
 */
export function useLiveMany<T = any>(calls: { fn: string; args?: any[] }[], deps: any[] = [], intervalMs: number = BASE_MS) {
  const [data, setData] = useState<Record<string, T | null>>({});
  const [loading, setLoading] = useState(true);

  const delayRef = useRef(intervalMs);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (isRateLimited()) {
      delayRef.current = Math.min(MAX_MS, delayRef.current * 2);
      return;
    }
    const out: Record<string, T | null> = {};
    let hadData = false;
    for (const c of calls) {
      const r = await readContract(c.fn, c.args || []);
      if (r !== null) {
        out[c.fn] = r as T;
        hadData = true;
      }
    }
    if (hadData) {
      setData((prev) => ({ ...prev, ...out }));
      delayRef.current = intervalMs;
    } else {
      delayRef.current = Math.min(MAX_MS, delayRef.current * 2);
    }
    setLoading(false);
  }, [JSON.stringify(calls), intervalMs]);

  useEffect(() => {
    setLoading(true);
    delayRef.current = intervalMs;
    load();
  }, [load, ...deps]);

  useEffect(() => {
    timerRef.current = setTimeout(function tick() {
      load();
      timerRef.current = setTimeout(tick, delayRef.current);
    }, intervalMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [load, intervalMs]);

  return { data, loading, reload: load };
}
