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

type SectorDist = {
  generated_at_utc: string;
  sectors: Record<
    string,
    {
      pe: number[];
      ps: number[];
      pe_n?: number;
      ps_n?: number;
      n?: number;
    }
  >;
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

/**
 * Guardrail: 멀티플 왜곡 케이스
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

// ---- Sector weights (그대로 유지) ----
function sectorWeights(sectorRaw: string | null | undefined) {
  const sector = (sectorRaw || "Unknown").toLowerCase();
  let w = { growth: 35, margin: 35, value: 30 };

  const is = (k: string) => sector.includes(k);

  if (is("technology") || is("information technology") || is("communication") || is("software") || is("internet")) {
    w = { growth: 40, margin: 30, value: 30 };
  } else if (
    is("utilities") ||
    is("real estate") ||
    is("consumer defensive") ||
    is("consumer staples") ||
    is("staples")
  ) {
    w = { growth: 25, margin: 40, value: 35 };
  } else if (is("financial") || is("banks") || is("insurance")) {
    w = { growth: 30, margin: 35, value: 35 };
  } else if (is("energy") || is("industrials") || is("materials")) {
    w = { growth: 30, margin: 35, value: 35 };
  } else if (is("health care") || is("healthcare") || is("pharma")) {
    w = { growth: 35, margin: 35, value: 30 };
  }

  return w;
}

// ---- percentile helper ----
// returns percentile in [0,1] where 0=cheapest (low multiple), 1=most expensive
function percentile(sortedAsc: number[], x: number): number | null {
  if (!Array.isArray(sortedAsc) || sortedAsc.length < 10) return null; // too small = unreliable
  if (!isNum(x)) return null;

  // binary search: first index where arr[i] >= x
  let lo = 0;
  let hi = sortedAsc.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedAsc[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  // lo in [0..n]
  const n = sortedAsc.length;
  const rank = clamp(lo, 0, n - 1);
  return rank / (n - 1);
}

async function loadSectorDist(): Promise<SectorDist | null> {
  const url = process.env.SECTOR_DIST_URL;
  if (!url) return null;
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as SectorDist;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const tickerRaw = searchParams.get("ticker");
  if (!tickerRaw) return NextResponse.json({ error: "ticker missing" }, { status: 400 });

  const ticker = decodeURIComponent(tickerRaw).trim().toUpperCase();

  try {
    const origin = new URL(req.url).origin;

    const finRes = await fetch(`${origin}/api/financials?ticker=${encodeURIComponent(ticker)}`, { cache: "no-store" });
    if (!finRes.ok) return NextResponse.json({ error: `financials HTTP ${finRes.status}` }, { status: 500 });
    const fin = (await finRes.json()) as FinancialsPayload;

    let sectorInfo: SectorPayload | null = null;
    try {
      const secRes = await fetch(`${origin}/api/sector?ticker=${encodeURIComponent(ticker)}`, { cache: "no-store" });
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

    // ===== Features =====
    let revCagr: number | null = null;
    if (oldest && latest && isNum(oldest.revenue) && isNum(latest.revenue) && rows.length >= 3) {
      revCagr = cagr(oldest.revenue, latest.revenue, rows.length - 1);
    } else if (prev && latest && isNum(prev.revenue) && isNum(latest.revenue) && prev.revenue !== 0) {
      revCagr = latest.revenue / prev.revenue - 1;
    }

    const opMargin =
      latest && isNum(latest.opIncome) && isNum(latest.revenue) && latest.revenue !== 0
        ? latest.opIncome / latest.revenue
        : null;

    const fcfMargin =
      latest && isNum(latest.fcf) && isNum(latest.revenue) && latest.revenue !== 0 ? latest.fcf / latest.revenue : null;

    let fcfTrend: "UP" | "DOWN" | "FLAT" | "N/A" = "N/A";
    if (prev && latest && isNum(prev.fcf) && isNum(latest.fcf) && prev.fcf !== 0) {
      fcfTrend = trend(Math.abs(prev.fcf), Math.abs(latest.fcf)) as any;
    }

    // multiples (from finnhub route)
    const pe0 = fin.multiples?.pe ?? null;
    const ps0 = fin.multiples?.ps ?? null;
    const mult = sanitizeMultiples(pe0, ps0);
    const pe = mult.pe;
    const ps = mult.ps;

    // sector distribution
    const dist = await loadSectorDist();
    const secBlock = dist?.sectors?.[sector] || null;

    const pePct = secBlock && isNum(pe) ? percentile(secBlock.pe || [], pe) : null;
    const psPct = secBlock && isNum(ps) ? percentile(secBlock.ps || [], ps) : null;

    // ===== Scoring =====
    const used = { growth: false, margin: false, value: false };

    // Growth
    let growthScore = 0;
    if (isNum(revCagr)) {
      used.growth = true;
      growthScore = scaleLinear(revCagr, -0.2, 0.3) * weights.growth;
    }

    // Margin (비율 유지: Op 20/35, FCF 15/35)
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

    // ✅ Value: sector percentile (cheap => high score)
    let valueScore = 0;
    let valueUsed = false;

    const pePart = weights.value * (18 / 30);
    const psPart = weights.value * (12 / 30);

    if (pePct !== null) {
      valueUsed = true;
      valueScore += (1 - pePct) * pePart;
    }
    if (psPct !== null) {
      valueUsed = true;
      valueScore += (1 - psPct) * psPart;
    }
    if (valueUsed) used.value = true;

    const usedTotalWeight =
      (used.growth ? weights.growth : 0) + (used.margin ? weights.margin : 0) + (used.value ? weights.value : 0);

    // Normalize
    let scoreNorm: number;
    if (usedTotalWeight === 0) scoreNorm = 50;
    else scoreNorm = clamp(Math.round(((growthScore + marginScore + valueScore) / usedTotalWeight) * 100), 0, 100);

    // Coverage penalty
    const coverage = usedTotalWeight / 100;
    const penaltyFactor = 0.7 + 0.3 * coverage;
    let scoreFinal = clamp(Math.round(scoreNorm * penaltyFactor), 0, 100);

    // Signal
    let signal: "BUY" | "WATCH" | "HOLD" | "AVOID" = "WATCH";
    if (scoreFinal >= 70) signal = "BUY";
    else if (scoreFinal >= 55) signal = "WATCH";
    else if (scoreFinal >= 40) signal = "HOLD";
    else signal = "AVOID";

    // Low conf adjustment
    const lowConf = coverage < 0.6;
    const baseSignal = signal;

    const warnings: string[] = [];
    if (mult.notes.length) warnings.push(...mult.notes);

    if (!dist) warnings.push("Sector distribution not loaded; Value percentile may be unavailable.");
    if (!secBlock) warnings.push(`No sector bucket found for "${sector}" in sector_dist.json.`);

    if (coverage === 0) warnings.push("No usable financial/value signals; neutral score used.");
    else if (coverage < 0.35) warnings.push("Very low coverage; treat as WATCH (not a strong call).");
    else if (coverage < 0.6) warnings.push("Low coverage; treat as WATCH (not a strong call).");

    if (lowConf && signal !== "WATCH") signal = "WATCH";

    // Auto summary
    const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
    const revTxt = isNum(revCagr) ? `Rev CAGR ${pct(revCagr)}` : "Rev CAGR N/A";
    const opmTxt = isNum(opMargin) ? `OpM ${pct(opMargin)}` : "OpM N/A";
    const fcfmTxt = isNum(fcfMargin) ? `FCF M ${pct(fcfMargin)}` : "FCF M N/A";
    const fcfTxt = `FCF Trend ${fcfTrend}`;
    const autoSummary = `${revTxt} / ${opmTxt} / ${fcfmTxt} / ${fcfTxt}`;

    const confidence = pickConfidence(coverage);

    // Explain
    const explain = {
      sector: {
        sector,
        source: sectorInfo?.source ?? "unknown",
        weights_used: weights,
        dist_asof: dist?.generated_at_utc ?? null,
      },
      growth: { used: used.growth, weight: weights.growth, revenue_cagr: revCagr, score: Math.round(growthScore) },
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
        mode: "sector_percentile",
        pe: pe0,
        ps: ps0,
        pe_scored: pe,
        ps_scored: ps,
        pe_percentile: pePct,
        ps_percentile: psPct,
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

      source: {
        financials_generated_at_utc: fin.generated_at_utc,
        financials_note: fin.source_note ?? "",
        multiples_source: "finnhub",
        sector_source: sectorInfo?.source ?? "unknown",
        sector_dist_url: process.env.SECTOR_DIST_URL ? "set" : "missing",
      },

      diagnostics: {
        score_norm: scoreNorm,
        coverage: Number(coverage.toFixed(2)),
        penalty_factor: Number(penaltyFactor.toFixed(2)),
        low_conf: lowConf,
        base_signal: baseSignal,
        note: fin.source_note ?? "",
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
    return NextResponse.json({ error: "recommendation failed", message: String(err?.message || err) }, { status: 500 });
  }
}