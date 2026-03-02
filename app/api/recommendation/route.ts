import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Row = {
  year: number;
  revenue: number | null;
  opIncome: number | null;
  fcf: number | null;
  meta?: {
    revenue_source?: string;
    opIncome_source?: string;
    fcf_source?: string;
  };
};

type FinancialsPayload = {
  ticker: string;
  generated_at_utc: string;
  source_note?: string;
  rows: Row[];
  multiples?: { pe: number | null; ps: number | null };
};

type SectorPayload = {
  ticker: string;
  generated_at_utc: string;
  sector: string;
  source: string;
};

function isNum(x: any): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}

function cagr(first: number, last: number, years: number) {
  if (first <= 0 || last <= 0 || years <= 0) return null;
  return Math.pow(last / first, 1 / years) - 1;
}

function trend(a: number, b: number) {
  const chg = b / a - 1;
  if (chg > 0.05) return "UP";
  if (chg < -0.05) return "DOWN";
  return "FLAT";
}

// x0 -> 0, x1 -> 1
function scaleLinear(x: number, x0: number, x1: number) {
  return clamp((x - x0) / (x1 - x0), 0, 1);
}

// best -> 1, worst -> 0
function scaleInverse(x: number, best: number, worst: number) {
  return clamp((worst - x) / (worst - best), 0, 1);
}

/**
 * Guardrail: 멀티플이 의미 없거나 왜곡되는 케이스 처리
 * - PS가 너무 높으면(예: > 40) value scoring에서 PS 스킵
 * - PE가 너무 높으면(예: > 80) value scoring에서 PE 스킵
 */
function sanitizeMultiples(pe: number | null, ps: number | null) {
  const out = { pe, ps, notes: [] as string[] };

  if (isNum(out.ps) && out.ps > 40) {
    out.notes.push("P/S is extremely high; skipped from scoring (not comparable).");
    out.ps = null;
  }
  if (isNum(out.pe) && out.pe > 80) {
    out.notes.push("P/E is extremely high; skipped from scoring (not comparable).");
    out.pe = null;
  }
  return out;
}

function pickConfidence(coverage: number) {
  if (coverage >= 0.7) return "HIGH";
  if (coverage >= 0.35) return "MED";
  return "LOW";
}

/**
 * ✅ 섹터별 가중치(합=100 유지)
 * - Tech/Comm: 성장 비중↑
 * - Utilities/Staples/RE: 밸류+마진 비중↑
 * - Financials/Energy/Industrials: 밸류 비중 약간↑
 */
function sectorWeights(sectorRaw: string | null | undefined) {
  const sector = (sectorRaw || "Unknown").toLowerCase();

  // 기본
  let w = { growth: 35, margin: 35, value: 30 };

  const is = (k: string) => sector.includes(k);

  if (is("technology") || is("information technology") || is("communication") || is("software") || is("internet")) {
    w = { growth: 40, margin: 30, value: 30 };
  } else if (is("utilities") || is("real estate") || is("consumer defensive") || is("consumer staples") || is("staples")) {
    w = { growth: 25, margin: 40, value: 35 };
  } else if (is("financial") || is("banks") || is("insurance")) {
    w = { growth: 30, margin: 35, value: 35 };
  } else if (is("energy") || is("industrials") || is("materials")) {
    w = { growth: 30, margin: 35, value: 35 };
  } else if (is("health care") || is("healthcare") || is("pharma")) {
    w = { growth: 35, margin: 35, value: 30 };
  }

  // 혹시라도 합이 100이 아니면 안전장치(현재는 항상 100)
  const sum = w.growth + w.margin + w.value;
  if (sum !== 100) {
    const scale = 100 / sum;
    w = {
      growth: Math.round(w.growth * scale),
      margin: Math.round(w.margin * scale),
      value: 100 - Math.round(w.growth * scale) - Math.round(w.margin * scale),
    };
  }

  return w;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const tickerRaw = searchParams.get("ticker");
  if (!tickerRaw) return NextResponse.json({ error: "ticker missing" }, { status: 400 });

  const ticker = decodeURIComponent(tickerRaw).trim().toUpperCase();

  try {
    const origin = new URL(req.url).origin;

    // 1) financials
    const finRes = await fetch(`${origin}/api/financials?ticker=${encodeURIComponent(ticker)}`, {
      cache: "no-store",
    });
    if (!finRes.ok) {
      return NextResponse.json({ error: `financials HTTP ${finRes.status}` }, { status: 500 });
    }
    const fin = (await finRes.json()) as FinancialsPayload;

    // 2) sector (실패해도 default weights로 계속 진행)
    let sectorInfo: SectorPayload | null = null;
    try {
      const secRes = await fetch(`${origin}/api/sector?ticker=${encodeURIComponent(ticker)}`, {
        cache: "no-store",
      });
      if (secRes.ok) sectorInfo = (await secRes.json()) as SectorPayload;
    } catch {
      sectorInfo = null;
    }

    const sector = sectorInfo?.sector ?? "Unknown";
    const weights = sectorWeights(sector);

    const rows = [...(fin.rows || [])].sort((a, b) => a.year - b.year);
    const latest = rows[rows.length - 1] || null;
    const prev = rows.length >= 2 ? rows[rows.length - 2] : null;
    const oldest = rows[0] || null;

    // ===== Feature engineering =====
    // 성장: 3개년 CAGR 우선, 없으면 YoY
    let revCagr: number | null = null;
    if (oldest && latest && isNum(oldest.revenue) && isNum(latest.revenue) && rows.length >= 3) {
      revCagr = cagr(oldest.revenue, latest.revenue, rows.length - 1);
    } else if (prev && latest && isNum(prev.revenue) && isNum(latest.revenue) && prev.revenue !== 0) {
      revCagr = latest.revenue / prev.revenue - 1;
    }

    // 마진
    const opMargin =
      latest && isNum(latest.opIncome) && isNum(latest.revenue) && latest.revenue !== 0
        ? latest.opIncome / latest.revenue
        : null;

    const fcfMargin =
      latest && isNum(latest.fcf) && isNum(latest.revenue) && latest.revenue !== 0
        ? latest.fcf / latest.revenue
        : null;

    // FCF 추세 (abs 비교)
    let fcfTrend: "UP" | "DOWN" | "FLAT" | "N/A" = "N/A";
    if (prev && latest && isNum(prev.fcf) && isNum(latest.fcf) && prev.fcf !== 0) {
      fcfTrend = trend(Math.abs(prev.fcf), Math.abs(latest.fcf)) as any;
    }

    // 밸류
    const pe0 = fin.multiples?.pe ?? null;
    const ps0 = fin.multiples?.ps ?? null;
    const mult = sanitizeMultiples(pe0, ps0);
    const pe = mult.pe;
    const ps = mult.ps;

    // ===== Scoring (missing은 0점이 아니라 "스킵") =====
    const used = { growth: false, margin: false, value: false };

    // Growth(0~weights.growth): -20% ~ +30%
    let growthScore = 0;
    if (isNum(revCagr)) {
      used.growth = true;
      const s01 = scaleLinear(revCagr, -0.2, 0.3);
      growthScore = s01 * weights.growth;
    }

    // Margin(0~weights.margin): 내부 배분은 “가중치 비율”로 자동 맞춤
    // 기본 비율: Op 20 / FCF 15 (총 35) -> 섹터 marginWeight에 맞춰 스케일
    let marginScore = 0;
    let marginUsed = false;

    const opPart = weights.margin * (20 / 35);
    const fcfPart = weights.margin * (15 / 35);

    if (isNum(opMargin)) {
      marginUsed = true;
      marginScore += scaleLinear(opMargin, 0, 0.25) * opPart;
    }
    if (isNum(fcfMargin)) {
      marginUsed = true;
      marginScore += scaleLinear(fcfMargin, 0, 0.2) * fcfPart;
    }
    if (marginUsed) used.margin = true;

    // Value(0~weights.value): 내부 배분도 비율(PE 18 / PS 12 총 30)
    let valueScore = 0;
    let valueUsed = false;

    const pePart = weights.value * (18 / 30);
    const psPart = weights.value * (12 / 30);

    if (isNum(pe)) {
      valueUsed = true;
      valueScore += scaleInverse(pe, 10, 40) * pePart;
    }
    if (isNum(ps)) {
      valueUsed = true;
      valueScore += scaleInverse(ps, 1, 12) * psPart;
    }
    if (valueUsed) used.value = true;

    const usedTotalWeight =
      (used.growth ? weights.growth : 0) +
      (used.margin ? weights.margin : 0) +
      (used.value ? weights.value : 0);

    // ===== Normalize (0~100) =====
    let scoreNorm: number;
    if (usedTotalWeight === 0) {
      scoreNorm = 50;
    } else {
      const raw = growthScore + marginScore + valueScore; // 0~usedTotalWeight
      scoreNorm = Math.round((raw / usedTotalWeight) * 100);
      scoreNorm = clamp(scoreNorm, 0, 100);
    }

    // ===== Coverage penalty =====
    const coverage = usedTotalWeight / 100;
    const penaltyFactor = 0.7 + 0.3 * coverage;

    let scoreFinal = Math.round(scoreNorm * penaltyFactor);
    scoreFinal = clamp(scoreFinal, 0, 100);

    // ===== Signal =====
    let signal: "BUY" | "WATCH" | "HOLD" | "AVOID" = "WATCH";
    if (scoreFinal >= 70) signal = "BUY";
    else if (scoreFinal >= 55) signal = "WATCH";
    else if (scoreFinal >= 40) signal = "HOLD";
    else signal = "AVOID";

    // ===== Low confidence adjustment =====
    const lowConf = coverage < 0.6;
    const baseSignal = signal;

    const warnings: string[] = [];
    if (mult.notes.length) warnings.push(...mult.notes);

    if (coverage === 0) warnings.push("No usable financial/value signals; neutral score used.");
    else if (coverage < 0.35) warnings.push("Very low coverage; treat as WATCH (not a strong call).");
    else if (coverage < 0.6) warnings.push("Low coverage; treat as WATCH (not a strong call).");

    if (lowConf && signal !== "WATCH") signal = "WATCH";

    // ===== Auto summary =====
    const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
    const revTxt = isNum(revCagr) ? `Rev CAGR ${pct(revCagr)}` : "Rev CAGR N/A";
    const opmTxt = isNum(opMargin) ? `OpM ${pct(opMargin)}` : "OpM N/A";
    const fcfmTxt = isNum(fcfMargin) ? `FCF M ${pct(fcfMargin)}` : "FCF M N/A";
    const fcfTxt = `FCF Trend ${fcfTrend}`;
    const autoSummary = `${revTxt} / ${opmTxt} / ${fcfmTxt} / ${fcfTxt}`;

    const confidence = pickConfidence(coverage);

    // ===== Explain (분해표) =====
    const explain = {
      sector: {
        sector,
        source: sectorInfo?.source ?? "unknown",
        weights_used: weights, // ✅ 핵심: 섹터별 가중치 노출
      },
      growth: {
        used: used.growth,
        weight: weights.growth,
        revenue_cagr: revCagr,
        score: Math.round(growthScore),
      },
      margin: {
        used: used.margin,
        weight: weights.margin,
        op_margin: opMargin,
        fcf_margin: fcfMargin,
        score: Math.round(marginScore),
      },
      value: {
        used: used.value,
        weight: weights.value,
        pe_scored: pe,
        ps_scored: ps,
        score: Math.round(valueScore),
      },
      coverage: {
        used_total_weight: usedTotalWeight,
        coverage: Number(coverage.toFixed(2)),
        penalty_factor: Number(penaltyFactor.toFixed(2)),
        score_norm: Math.round(scoreNorm),
        raw_total: Math.round(growthScore + marginScore + valueScore),
      },
    };

    return NextResponse.json({
      ticker,
      generated_at_utc: new Date().toISOString(),

      signal,
      score: scoreFinal,
      confidence,

      // Source/AsOf 표기용
      source: {
        financials_generated_at_utc: fin.generated_at_utc,
        financials_note: fin.source_note ?? "",
        multiples_source: "finnhub",
        sector_source: sectorInfo?.source ?? "unknown",
      },

      diagnostics: {
        score_norm: scoreNorm,
        coverage: Number(coverage.toFixed(2)),
        penalty_factor: Number(penaltyFactor.toFixed(2)),
        low_conf: lowConf,
        base_signal: baseSignal,
        note: fin.source_note ?? "",
      },

      used: {
        growth: used.growth,
        margin: used.margin,
        value: used.value,
        used_total_weight: usedTotalWeight,
      },

      breakdown: {
        growth: Math.round(growthScore),
        margin: Math.round(marginScore),
        value: Math.round(valueScore),
        raw_total: Math.round(growthScore + marginScore + valueScore),
      },

      summary: {
        sector,
        revenue_cagr: revCagr,
        op_margin: opMargin,
        fcf_margin: fcfMargin,
        fcf_trend: fcfTrend,
        pe: pe0,
        ps: ps0,
        auto: autoSummary,
      },

      explain,
      warnings,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "recommendation failed", message: String(err?.message || err) },
      { status: 500 }
    );
  }
}