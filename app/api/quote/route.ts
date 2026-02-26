import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ticker = (searchParams.get("ticker") || "").trim().toUpperCase();

  if (!ticker) return NextResponse.json({ error: "ticker is required" }, { status: 400 });

  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "FINNHUB_API_KEY is missing" }, { status: 500 });

  // Finnhub quote: c(현재), d(변화), dp(%), h(고가), l(저가), o(시가), pc(전일종가), t(유닉스)
  const quoteUrl = new URL("https://finnhub.io/api/v1/quote");
  quoteUrl.searchParams.set("symbol", ticker);
  quoteUrl.searchParams.set("token", apiKey);

  // Finnhub metric: 52주 고/저 등 (profile2도 가능)
  const metricUrl = new URL("https://finnhub.io/api/v1/stock/metric");
  metricUrl.searchParams.set("symbol", ticker);
  metricUrl.searchParams.set("metric", "all");
  metricUrl.searchParams.set("token", apiKey);

  try {
    const [qRes, mRes] = await Promise.all([
      fetch(quoteUrl.toString(), { next: { revalidate: 60 } }),
      fetch(metricUrl.toString(), { next: { revalidate: 3600 } }),
    ]);

    if (!qRes.ok) {
      const text = await qRes.text().catch(() => "");
      return NextResponse.json({ error: "quote fetch failed", status: qRes.status, detail: text.slice(0, 300) }, { status: 502 });
    }
    if (!mRes.ok) {
      const text = await mRes.text().catch(() => "");
      return NextResponse.json({ error: "metric fetch failed", status: mRes.status, detail: text.slice(0, 300) }, { status: 502 });
    }

    const quote = await qRes.json();
    const metricData = await mRes.json();

    const metric = metricData?.metric || {};
    const week52High = metric["52WeekHigh"] ?? metric["52_week_high"] ?? null;
    const week52Low  = metric["52WeekLow"]  ?? metric["52_week_low"]  ?? null;
    const marketCap  = metric["marketCapitalization"] ?? metric["MarketCapitalization"] ?? null; // 보통 USD million

    return NextResponse.json({
      ticker,
      updated_at_utc: new Date().toISOString(),
      quote: {
        price: quote?.c ?? null,
        change: quote?.d ?? null,
        changePct: quote?.dp ?? null,
        prevClose: quote?.pc ?? null,
      },
      range52w: {
        high: week52High,
        low: week52Low,
      },
      marketCap, // Finnhub는 보통 "USD million" 단위로 들어오는 경우가 많음
    });
  } catch (e: any) {
    return NextResponse.json({ error: "fetch failed", message: String(e?.message || e) }, { status: 502 });
  }
}
