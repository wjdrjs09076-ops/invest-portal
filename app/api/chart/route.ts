import { NextResponse } from "next/server";

export const runtime = "nodejs";

type YahooChartResponse = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          close?: Array<number | null>;
        }>;
      };
      meta?: {
        symbol?: string;
        currency?: string;
      };
    }>;
    error?: unknown;
  };
};

type RangeKey = "1M" | "3M" | "6M" | "1Y";

type ChartPoint = {
  date: string;
  close: number;
};

const RANGE_MAP: Record<RangeKey, { range: string; interval: string }> = {
  "1M": { range: "1mo", interval: "1d" },
  "3M": { range: "3mo", interval: "1d" },
  "6M": { range: "6mo", interval: "1d" },
  "1Y": { range: "1y", interval: "1d" },
};

function normalizeRange(input: string | null): RangeKey {
  const key = (input || "6M").toUpperCase();
  if (key === "1M" || key === "3M" || key === "6M" || key === "1Y") {
    return key;
  }
  return "6M";
}

function isNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function isChartPoint(x: ChartPoint | null): x is ChartPoint {
  return x !== null;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const tickerRaw = searchParams.get("ticker");
  const rangeKey = normalizeRange(searchParams.get("range"));

  if (!tickerRaw) {
    return NextResponse.json({ error: "ticker missing" }, { status: 400 });
  }

  const ticker = decodeURIComponent(tickerRaw).trim().toUpperCase();
  const { range, interval } = RANGE_MAP[rangeKey];

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    ticker
  )}?range=${range}&interval=${interval}`;

  try {
    const res = await fetch(url, {
      next: { revalidate: 600 },
      headers: {
        "User-Agent": "Mozilla/5.0",
      },
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `yahoo chart http ${res.status}` },
        { status: 500 }
      );
    }

    const json = (await res.json()) as YahooChartResponse;
    const result = json.chart?.result?.[0];

    const timestamps = result?.timestamp ?? [];
    const closes = result?.indicators?.quote?.[0]?.close ?? [];
    const currency = result?.meta?.currency ?? "USD";

    if (!timestamps.length || !closes.length) {
      return NextResponse.json({ error: "no chart data" }, { status: 404 });
    }

    const points: ChartPoint[] = timestamps
      .map((ts, i): ChartPoint | null => {
        const close = closes[i];
        if (!isNumber(close)) return null;

        return {
          date: new Date(ts * 1000).toISOString(),
          close,
        };
      })
      .filter(isChartPoint);

    if (!points.length) {
      return NextResponse.json(
        { error: "empty usable chart data" },
        { status: 404 }
      );
    }

    const latestPoint = points[points.length - 1];
    const firstPoint = points[0];

    return NextResponse.json({
      ticker,
      range: rangeKey,
      currency,
      points,
      latest_close: latestPoint.close,
      first_close: firstPoint.close,
      generated_at_utc: new Date().toISOString(),
      source: "yahoo_chart",
    });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        error: "chart failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}