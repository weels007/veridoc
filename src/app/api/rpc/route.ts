import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TARGET = process.env.NEXT_PUBLIC_RPC_URL || "https://studio.genlayer.com/api";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { message: "invalid JSON body" } }, { status: 400 });
  }

  try {
    const res = await fetch(TARGET, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // Non-JSON upstream response (e.g. gateway error) — pass through raw.
      return new NextResponse(text, {
        status: res.status,
        headers: { "content-type": res.headers.get("content-type") || "text/plain" },
      });
    }

    return NextResponse.json(json, { status: res.status });
  } catch (e: any) {
    console.error("RPC proxy error:", e);
    return NextResponse.json(
      { error: { message: e?.message || "proxy failed" } },
      { status: 502 }
    );
  }
}
