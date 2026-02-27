import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Reco = {
  ticker: string;
  generated_at_utc: string;
  signal: "BUY" | "WATCH" | "HOLD" | "AVOID";
  score: number;
  diagnostics?: {
    coverage?: number;
    low_conf?: boolean;
    penalty_factor?: number;
    score_norm?: number;
  };
  warnings?: string[];
  summary?: {
    auto?: string;
    revenue_cagr?: number | null;
    op_margin?: number | null;
    fcf_margin?: number | null;
    fcf_trend?: string;
    pe?: number | null;
    ps?: number | null;
  };
};

function uniq(arr: string[]) {
  return Array.from(new Set(arr));
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const tickersParam = searchParams.get("tickers") || "";
  const tickers = uniq(
    tickersParam
      .split(",")
      .map((s) => decodeURIComponent(s).trim().toUpperCase())
      .filter(Boolean)
  );

  if (tickers.length === 0) {
    return NextResponse.json({ error: "tickers missing" }, { status: 400 });
  }

  // 안전장치(너무 많이 호출 방지)
  const limited = tickers.slice(0, 50);

  const origin = new URL(req.url).origin;

  const results = await Promise.all(
    limited.map(async (t) => {
      try {
        const r = await fetch(`${origin}/api/recommendation?ticker=${encodeURIComponent(t)}`, {
          cache: "no-store",
        });
        if (!r.ok) return null;
        const j = (await r.json()) as Reco;
        return j;
      } catch {
        return null;
      }
    })
  );

  const ok = results.filter(Boolean) as Reco[];
  return NextResponse.json({
    generated_at_utc: new Date().toISOString(),
    count: ok.length,
    items: ok,
  });
}