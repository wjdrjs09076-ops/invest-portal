import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ticker = (searchParams.get("ticker") || "").trim().toUpperCase();

  if (!ticker) return NextResponse.json({ error: "ticker is required" }, { status: 400 });

  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "FINNHUB_API_KEY is missing" }, { status: 500 });

  const quoteUrl = new URL("https://finnhub.io/api/v1/quote");
  quoteUrl.searchParams.set("symbol", ticker);
  quoteUrl.searchParams.set("token", apiKey);

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
      return NextResponse.json({ error: "quote fetch failed", status: qRes.status, detail: text.slice(0, 200) }, { status: 502 });
    }
    if (!mRes.ok) {
      const text = await mRes.text().catch(() => "");
      return NextResponse.json({ error: "metric fetch failed", status: mRes.status, detail: text.slice(0, 200) }, { status: 502 });
    }

    const quote = await qRes.json();
    const metricData = await mRes.json();
    const metric = metricData?.metric || {};

    const price = Number(quote?.c ?? NaN);

    const week52High = Number(metric["52WeekHigh"] ?? metric["52_week_high"] ?? NaN);
    const week52Low = Number(metric["52WeekLow"] ?? metric["52_week_low"] ?? NaN);

    // 일부는 없을 수 있음(없으면 룰에서 제외)
    const peTTM = Number(metric["peTTM"] ?? metric["pe_ttm"] ?? NaN);
    const roeTTM = Number(metric["roeTTM"] ?? metric["roe_ttm"] ?? NaN);

    // ----- 점수 룰 (MVP) -----
    // 0~100, 기본 50에서 시작
    let score = 50;
    const reasons: string[] = [];

    // (1) 52주 밴드 위치: 저점 근접 = 긍정(리버설), 고점 근접 = 과열(-)
    if (Number.isFinite(price) && Number.isFinite(week52High) && Number.isFinite(week52Low) && week52High > week52Low) {
      const pos = (price - week52Low) / (week52High - week52Low); // 0(저점)~1(고점)
      if (pos <= 0.2) {
        score += 15;
        reasons.push(`Near 52W low (band pos ${(pos * 100).toFixed(0)}%) → potential rebound`);
      } else if (pos >= 0.8) {
        score -= 15;
        reasons.push(`Near 52W high (band pos ${(pos * 100).toFixed(0)}%) → risk of overheating`);
      } else {
        reasons.push(`Mid 52W band (pos ${(pos * 100).toFixed(0)}%)`);
      }
    } else {
      reasons.push("52W range unavailable");
    }

    // (2) 당일 모멘텀: 상승이면 +, 하락이면 -
    const changePct = Number(quote?.dp ?? NaN);
    if (Number.isFinite(changePct)) {
      const adj = clamp(changePct, -3, 3) * 2; // -6 ~ +6
      score += adj;
      reasons.push(`Day move ${changePct.toFixed(2)}%`);
    }

    // (3) 밸류에이션(아주 러프): P/E가 너무 높으면 감점, 너무 낮으면 가점
    if (Number.isFinite(peTTM)) {
      if (peTTM >= 35) {
        score -= 8;
        reasons.push(`High P/E (TTM ${peTTM.toFixed(1)})`);
      } else if (peTTM <= 12) {
        score += 8;
        reasons.push(`Low P/E (TTM ${peTTM.toFixed(1)})`);
      } else {
        reasons.push(`P/E (TTM ${peTTM.toFixed(1)})`);
      }
    }

    // (4) 수익성(ROE): 높으면 가점
    if (Number.isFinite(roeTTM)) {
      if (roeTTM >= 20) {
        score += 6;
        reasons.push(`Strong ROE (TTM ${roeTTM.toFixed(1)}%)`);
      } else if (roeTTM <= 5) {
        score -= 4;
        reasons.push(`Weak ROE (TTM ${roeTTM.toFixed(1)}%)`);
      } else {
        reasons.push(`ROE (TTM ${roeTTM.toFixed(1)}%)`);
      }
    }

    score = clamp(score, 0, 100);

    let label: "BUY" | "HOLD" | "SELL" = "HOLD";
    if (score >= 70) label = "BUY";
    else if (score <= 35) label = "SELL";

    return NextResponse.json({
      ticker,
      updated_at_utc: new Date().toISOString(),
      score,
      label,
      inputs: {
        price: Number.isFinite(price) ? price : null,
        changePct: Number.isFinite(changePct) ? changePct : null,
        week52High: Number.isFinite(week52High) ? week52High : null,
        week52Low: Number.isFinite(week52Low) ? week52Low : null,
        peTTM: Number.isFinite(peTTM) ? peTTM : null,
        roeTTM: Number.isFinite(roeTTM) ? roeTTM : null,
      },
      reasons: reasons.slice(0, 6),
    });
  } catch (e: any) {
    return NextResponse.json({ error: "fetch failed", message: String(e?.message || e) }, { status: 502 });
  }
}