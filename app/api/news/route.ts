import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function toUnixSeconds(d: Date) {
  return Math.floor(d.getTime() / 1000);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ticker = (searchParams.get("ticker") || "").trim().toUpperCase();
  const limit = Math.min(Number(searchParams.get("limit") || "25"), 50);

  if (!ticker) {
    return NextResponse.json({ error: "ticker is required" }, { status: 400 });
  }

  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "FINNHUB_API_KEY is missing" }, { status: 500 });
  }

  // 최근 14일 뉴스 (너무 짧으면 결과 0개 뜨는 경우가 있어 14일 추천)
  const to = new Date();
  const from = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  const url = new URL("https://finnhub.io/api/v1/company-news");
  url.searchParams.set("symbol", ticker);
  url.searchParams.set("from", from.toISOString().slice(0, 10)); // YYYY-MM-DD
  url.searchParams.set("to", to.toISOString().slice(0, 10));
  url.searchParams.set("token", apiKey);

  try {
    const res = await fetch(url.toString(), {
      headers: { "accept": "application/json" },
      // 10분 정도 캐시(무료 플랜 레이트리밋 완화)
      next: { revalidate: 600 },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json(
        { error: "finnhub fetch failed", status: res.status, detail: text.slice(0, 300) },
        { status: 502 }
      );
    }

    const data: any[] = await res.json();

    // Finnhub 응답: [{ headline, url, source, datetime, summary, ...}, ...]
    const items = (Array.isArray(data) ? data : [])
      .map((a) => ({
        title: a?.headline ?? "",
        url: a?.url ?? "",
        domain: a?.source ?? "",
        seendate: a?.datetime ? new Date(a.datetime * 1000).toISOString() : "",
      }))
      .filter((x) => x.title && x.url)
      .slice(0, limit);

    return NextResponse.json({
      ticker,
      generated_at_utc: new Date().toISOString(),
      count: items.length,
      items,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "fetch failed", message: String(e?.message || e) },
      { status: 502 }
    );
  }
}
