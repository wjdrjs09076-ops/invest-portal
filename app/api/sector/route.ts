import { NextResponse } from "next/server";

export const runtime = "nodejs";

type FinnhubProfile2 = {
  ticker?: string;
  name?: string;
  finnhubIndustry?: string; // Finnhub에서 sector 느낌으로 주는 값
  gicsSector?: string;
  gicsIndustry?: string;
};

function pickSector(p: FinnhubProfile2 | null): { sector: string; source: string } {
  if (!p) return { sector: "Unknown", source: "none" };

  // 우선순위: gicsSector > finnhubIndustry > Unknown
  const s =
    (p.gicsSector && p.gicsSector.trim()) ||
    (p.finnhubIndustry && p.finnhubIndustry.trim()) ||
    "Unknown";

  const source = p.gicsSector ? "finnhub.profile2.gicsSector" : p.finnhubIndustry ? "finnhub.profile2.finnhubIndustry" : "none";
  return { sector: s, source };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const tickerRaw = searchParams.get("ticker");
  if (!tickerRaw) return NextResponse.json({ error: "ticker missing" }, { status: 400 });

  const ticker = decodeURIComponent(tickerRaw).trim().toUpperCase();

  const key = process.env.FINNHUB_API_KEY;
  if (!key) return NextResponse.json({ error: "FINNHUB_API_KEY missing" }, { status: 500 });

  try {
    const url = `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(ticker)}&token=${encodeURIComponent(
      key
    )}`;

    const r = await fetch(url, {
      cache: "no-store",
      headers: {
        // Finnhub가 이걸 요구하진 않지만, 안정적으로 두자
        "User-Agent": process.env.SEC_USER_AGENT || "invest-portal (contact: your-email@example.com)",
      },
    });

    if (!r.ok) {
      return NextResponse.json({ error: `finnhub profile2 HTTP ${r.status}` }, { status: 500 });
    }

    const p = (await r.json()) as FinnhubProfile2;
    const { sector, source } = pickSector(p);

    return NextResponse.json({
      ticker,
      generated_at_utc: new Date().toISOString(),
      sector,
      source,
      raw: {
        gicsSector: p?.gicsSector ?? null,
        gicsIndustry: p?.gicsIndustry ?? null,
        finnhubIndustry: p?.finnhubIndustry ?? null,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "sector failed", message: String(e?.message || e) },
      { status: 500 }
    );
  }
}