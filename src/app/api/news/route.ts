import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

function buildQuery(ticker: string) {
  const t = ticker.toUpperCase().trim();
  return `(${t}) (stock OR shares OR earnings OR revenue OR guidance OR outlook)`;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ticker = (searchParams.get("ticker") || "").trim().toUpperCase();
  const limit = Math.min(Number(searchParams.get("limit") || "25"), 50);

  if (!ticker) {
    return NextResponse.json({ error: "ticker is required" }, { status: 400 });
  }

  const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
  url.searchParams.set("query", buildQuery(ticker));
  url.searchParams.set("mode", "ArtList");
  url.searchParams.set("format", "json");
  url.searchParams.set("sort", "datedesc");
  url.searchParams.set("maxrecords", String(limit));

  const res = await fetch(url.toString(), {
    next: { revalidate: 900 }, // 15분 캐시
    headers: { "user-agent": "invest-portal/1.0" },
  });

  if (!res.ok) {
    return NextResponse.json({ error: "gdelt fetch failed" }, { status: 502 });
  }

  const data: any = await res.json();
  const articles: any[] = data?.articles || [];

  const items = articles
    .map((a) => ({
      title: a?.title ?? "",
      url: a?.url ?? "",
      domain: a?.domain ?? "",
      seendate: a?.seendate ?? "",
      sourcecountry: a?.sourcecountry ?? "",
      language: a?.language ?? "",
    }))
    .filter((x) => x.title && x.url)
    .slice(0, limit);

  return NextResponse.json({ ticker, count: items.length, items });
}
