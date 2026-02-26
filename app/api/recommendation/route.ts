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
 * Guardrail: “이런 종목은 멀티플이 의미 없거나 왜곡” 케이스 처리
 * - PS가 너무 높으면(예: > 40) value scoring에서 PS는 스킵
 * - PE가 너무 높으면(예: > 80) value scoring에서 PE는 스킵
 * - (원하면 임계치 바꿔도 됨)
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

/**
 * Coverage rule:
 * - used weight 0% -> neutral base 50 but LOW CONF
 * - low coverage면 신호를 WATCH로 완화(과대/과소평가 방지)
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const tickerRaw = searchParams.get("ticker");
  if (!tickerRaw) return NextResponse.json({ error: "ticker missing" }, { status: 400 });

  const ticker = decodeURIComponent(tickerRaw).trim().toUpperCase();

  try {
    const origin = new URL(req.url).origin;

    // ✅ financials는 이제 SEC fallback 포함 route.ts를 사용
    const finRes = await fetch(`${origin}/api/financials?ticker=${encodeURIComponent(ticker)}`, {
      cache: "no-store",
    });
    if (!finRes.ok) {
      return NextResponse.json({ error: `financials HTTP ${finRes.status}` }, { status: 500 });
    }

    const fin = (await finRes.json()) as FinancialsPayload;

    const rows = [...(fin.rows || [])].sort((a, b) => a.year - b.year);
    const latest = rows[rows.length - 1] || null;
    const prev = rows.length >= 2 ? rows[rows.length - 2] : null;
    const oldest = rows[0] || null;

    // ===== Feature engineering =====

    // 성장: 3개년(=2 interval) CAGR 우선, 없으면 YoY
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

    // FCF 추세 (abs로 비교: 부호 변동에 덜 민감)
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
    const WEIGHTS = { growth: 35, margin: 35, value: 30 } as const;
    const used = { growth: false, margin: false, value: false };

    // Growth(0~35): -20% ~ +30%를 0~1로
    let growthScore = 0;
    if (isNum(revCagr)) {
      used.growth = true;
      const s01 = scaleLinear(revCagr, -0.2, 0.3);
      growthScore = s01 * WEIGHTS.growth;
    }

    // Margin(0~35): Op 0~25% -> 0~20, FCF 0~20% -> 0~15
    let marginScore = 0;
    let marginUsed = false;
    if (isNum(opMargin)) {
      marginUsed = true;
      marginScore += scaleLinear(opMargin, 0, 0.25) * 20;
    }
    if (isNum(fcfMargin)) {
      marginUsed = true;
      marginScore += scaleLinear(fcfMargin, 0, 0.2) * 15;
    }
    if (marginUsed) used.margin = true;

    // Value(0~30): PE 10~40 (18), PS 1~12 (12)
    let valueScore = 0;
    let valueUsed = false;
    if (isNum(pe)) {
      valueUsed = true;
      valueScore += scaleInverse(pe, 10, 40) * 18;
    }
    if (isNum(ps)) {
      valueUsed = true;
      valueScore += scaleInverse(ps, 1, 12) * 12;
    }
    if (valueUsed) used.value = true;

    const usedTotalWeight =
      (used.growth ? WEIGHTS.growth : 0) +
      (used.margin ? WEIGHTS.margin : 0) +
      (used.value ? WEIGHTS.value : 0);

    // ===== Normalize (0~100) =====
    // 아무것도 없으면 “중립 50”
    let scoreNorm: number;
    if (usedTotalWeight === 0) {
      scoreNorm = 50;
    } else {
      const raw = growthScore + marginScore + valueScore; // 0~usedTotalWeight
      scoreNorm = Math.round((raw / usedTotalWeight) * 100);
      scoreNorm = clamp(scoreNorm, 0, 100);
    }

    // ===== Coverage penalty =====
    // coverage = 사용한 가중치 / 100
    const coverage = usedTotalWeight / 100;

    // soft penalty: 0% coverage -> 70%만 인정, 100% coverage -> 100% 인정
    const penaltyFactor = 0.7 + 0.3 * coverage;

    let scoreFinal = Math.round(scoreNorm * penaltyFactor);
    scoreFinal = clamp(scoreFinal, 0, 100);

    // ===== Signal =====
    // 기본 신호
    let signal: "BUY" | "WATCH" | "HOLD" | "AVOID" = "WATCH";
    if (scoreFinal >= 70) signal = "BUY";
    else if (scoreFinal >= 55) signal = "WATCH";
    else if (scoreFinal >= 40) signal = "HOLD";
    else signal = "AVOID";

    // ===== Low confidence adjustment =====
    // coverage가 낮으면 “강한 콜”을 피하기 위해 WATCH로 완화
    // (너가 지적한 QSI/IONQ 같은 케이스 과대평가/과소평가 모두 방지)
    const lowConf = coverage < 0.6; // 기준: 60% 미만이면 LOW CONF
    const baseSignal = signal;

    const warnings: string[] = [];
    if (mult.notes.length) warnings.push(...mult.notes);

    if (coverage === 0) warnings.push("No usable financial/value signals; neutral score used.");
    else if (coverage < 0.35) warnings.push("Very low coverage; treat as WATCH (not a strong call).");
    else if (coverage < 0.6) warnings.push("Low coverage; treat as WATCH (not a strong call).");

    if (lowConf && signal !== "WATCH") {
      signal = "WATCH";
    }

    // ===== Auto summary =====
    const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
    const revTxt = isNum(revCagr) ? `Rev CAGR ${pct(revCagr)}` : "Rev CAGR N/A";
    const opmTxt = isNum(opMargin) ? `OpM ${pct(opMargin)}` : "OpM N/A";
    const fcfmTxt = isNum(fcfMargin) ? `FCF M ${pct(fcfMargin)}` : "FCF M N/A";
    const fcfTxt = `FCF Trend ${fcfTrend}`;

    const autoSummary = `${revTxt} / ${opmTxt} / ${fcfmTxt} / ${fcfTxt}`;

    return NextResponse.json({
      ticker,
      generated_at_utc: new Date().toISOString(),

      signal,
      score: scoreFinal,

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
        revenue_cagr: revCagr,
        op_margin: opMargin,
        fcf_margin: fcfMargin,
        fcf_trend: fcfTrend,
        pe: pe0,
        ps: ps0,
        auto: autoSummary,
      },

      warnings,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "recommendation failed", message: String(err?.message || err) },
      { status: 500 }
    );
  }
}