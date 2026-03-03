import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Row = {
  year: number;
  revenue: number | null;
  opIncome: number | null;
  fcf: number | null;
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
  sectors: Record<string, { pe: number[]; ps: number[] }>;
};

type Candle = {
  c: number[];
  t: number[];
  s: string; // "ok" | "no_data"
};

type ScoreSnapshot = {
  generated_at_utc: string;
  source?: string;
  universes: Record<
    string,
    {
      label: string;
      stats: { n: number; mean: number | null; p10: number | null; p50: number | null; p90: number | null };
      scores: Record<string, { score: number; confidence?: string; sector?: string }>;
    }
  >;
};

const REVALIDATE_10M = 600;

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

function scaleLinear(x: number, x0: number, x1: number) {
  return clamp((x - x0) / (x1 - x0), 0, 1);
}

function scaleInverse(x: number, best: number, worst: number) {
  return clamp((worst - x) / (worst - best), 0, 1);
}

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

function percentile(sortedAsc: number[], x: number): number | null {
  if (!Array.isArray(sortedAsc) || sortedAsc.length < 10) return null;
  if (!isNum(x)) return null;

  let lo = 0;
  let hi = sortedAsc.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedAsc[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  const n = sortedAsc.length;
  const rank = clamp(lo, 0, n - 1);
  return rank / (n - 1); // 0=cheapest, 1=most expensive
}

// ✅ 외부 JSON(깃허브 raw)은 10분 캐시
async function loadSectorDist(): Promise<SectorDist | null> {
  const url = process.env.SECTOR_DIST_URL;
  if (!url) return null;
  try {
    const r = await fetch(url, { next: { revalidate: REVALIDATE_10M } });
    if (!r.ok) return null;
    return (await r.json()) as SectorDist;
  } catch {
    return null;
  }
}

// ✅ S&P500 점수 스냅샷도 10분 캐시 (invest-data에서 생성한 파일)
async function loadScoreSnapshot(): Promise<ScoreSnapshot | null> {
  const url = process.env.SCORE_SNAPSHOT_URL;
  if (!url) return null;
  try {
    const r = await fetch(url, { next: { revalidate: REVALIDATE_10M } });
    if (!r.ok) return null;
    return (await r.json()) as ScoreSnapshot;
  } catch {
    return null;
  }
}

// map: ticker->score 를 기반으로 percentile 계산 (0=하위, 1=상위)
function scorePercentileFromMap(map: Record<string, { score: number }>, score: number): number | null {
  const arr = Object.values(map)
    .map((x) => x.score)
    .filter((x) => typeof x === "number" && Number.isFinite(x))
    .sort((a, b) => a - b);

  if (arr.length < 30) return null;

  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < score) lo = mid + 1;
    else hi = mid;
  }
  const n = arr.length;
  const rank = clamp(lo, 0, n - 1);
  return rank / (n - 1);
}

// ✅ Finnhub candle도 10분 캐시
async function fetchCandle(ticker: string): Promise<Candle | null> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return null;

  const now = Math.floor(Date.now() / 1000);
  const from = now - 220 * 24 * 3600;
  const url = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(
    ticker
  )}&resolution=D&from=${from}&to=${now}&token=${encodeURIComponent(key)}`;

  try {
    const r = await fetch(url, { next: { revalidate: REVALIDATE_10M } });
    if (!r.ok) return null;
    const j = (await r.json()) as Candle;
    if (!j || j.s !== "ok" || !Array.isArray(j.c) || j.c.length < 30) return null;
    return j;
  } catch {
    return null;
  }
}

function std(arr: number[]) {
  if (arr.length < 2) return null;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const v = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(v);
}

function computeRisk(closes: number[]) {
  if (!Array.isArray(closes) || closes.length < 30) return null;

  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const a = closes[i - 1];
    const b = closes[i];
    if (!isNum(a) || !isNum(b) || a <= 0) continue;
    rets.push(b / a - 1);
  }

  const rets20 = rets.slice(-20);
  const s20 = std(rets20);
  const vol20 = s20 === null ? null : s20 * Math.sqrt(252);

  const c90 = closes.slice(-90);
  if (c90.length < 30) {
    return { vol_20d: vol20, mdd_90d: null };
  }

  let peak = c90[0];
  let mdd = 0;
  for (const p of c90) {
    if (!isNum(p)) continue;
    peak = Math.max(peak, p);
    const dd = peak > 0 ? (peak - p) / peak : 0;
    mdd = Math.max(mdd, dd);
  }

  return { vol_20d: vol20, mdd_90d: mdd };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const tickerRaw = searchParams.get("ticker");
  if (!tickerRaw) return NextResponse.json({ error: "ticker missing" }, { status: 400 });

  const ticker = decodeURIComponent(tickerRaw).trim().toUpperCase();

  try {
    const origin = new URL(req.url).origin;

    // 내부 API는 no-store 유지
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
    const w0 = sectorWeights(sector);

    const dist = await loadSectorDist();
    const secBlock = dist?.sectors?.[sector] || null;

    const candle = await fetchCandle(ticker);
    const riskRaw = candle ? computeRisk(candle.c) : null;

    // ✅ S&P500 점수 스냅샷 로드
    const snapshot = await loadScoreSnapshot();
    const sp500 = snapshot?.universes?.["sp500"] || null;

    // ===== feature engineering =====
    const rows = [...(fin.rows || [])].sort((a, b) => a.year - b.year);
    const latest = rows[rows.length - 1] || null;
    const prev = rows.length >= 2 ? rows[rows.length - 2] : null;
    const oldest = rows[0] || null;

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

    const pe0 = fin.multiples?.pe ?? null;
    const ps0 = fin.multiples?.ps ?? null;
    const mult = sanitizeMultiples(pe0, ps0);
    const pe = mult.pe;
    const ps = mult.ps;

    const pePct = secBlock && isNum(pe) ? percentile(secBlock.pe || [], pe) : null; // 0=cheap
    const psPct = secBlock && isNum(ps) ? percentile(secBlock.ps || [], ps) : null;

    // ✅ 섹터 밸류 요약 percentile(0=cheap, 1=expensive)
    const sectorValuePct =
      pePct !== null && psPct !== null ? (pePct + psPct) / 2 : pePct !== null ? pePct : psPct !== null ? psPct : null;

    // ===== weights =====
    const FUND = 80;
    const RISK_W = 20;

    const wg = (w0.growth / 100) * FUND;
    const wm = (w0.margin / 100) * FUND;
    const wv = (w0.value / 100) * FUND;

    const used = { growth: false, margin: false, value: false, risk: false };

    // growth
    let growthScore = 0;
    if (isNum(revCagr)) {
      used.growth = true;
      growthScore = scaleLinear(revCagr, -0.2, 0.3) * wg;
    }

    // margin
    let marginScore = 0;
    let marginUsed = false;

    const opPart = wm * (20 / 35);
    const fcfPart = wm * (15 / 35);

    if (isNum(opMargin)) {
      marginUsed = true;
      marginScore += scaleLinear(opMargin, 0, 0.25) * opPart;
    }
    if (isNum(fcfMargin)) {
      marginUsed = true;
      marginScore += scaleLinear(fcfMargin, 0, 0.2) * fcfPart;
    }
    if (marginUsed) used.margin = true;

    // value (sector percentile) — cheap => high score
    let valueScore = 0;
    let valueUsed = false;

    const pePart = wv * (18 / 30);
    const psPart = wv * (12 / 30);

    if (pePct !== null) {
      valueUsed = true;
      valueScore += (1 - pePct) * pePart;
    }
    if (psPct !== null) {
      valueUsed = true;
      valueScore += (1 - psPct) * psPart;
    }
    if (valueUsed) used.value = true;

    // risk
    let riskScore = 0;
    const vol20 = riskRaw?.vol_20d ?? null;
    const mdd90 = riskRaw?.mdd_90d ?? null;

    if (isNum(vol20) || isNum(mdd90)) {
      used.risk = true;

      const vol01 = isNum(vol20) ? scaleInverse(vol20, 0.2, 0.8) : null;
      const mdd01 = isNum(mdd90) ? scaleInverse(mdd90, 0.1, 0.5) : null;

      let r01: number | null = null;
      if (vol01 !== null && mdd01 !== null) r01 = 0.6 * vol01 + 0.4 * mdd01;
      else if (vol01 !== null) r01 = vol01;
      else if (mdd01 !== null) r01 = mdd01;

      if (r01 !== null) riskScore = r01 * RISK_W;
      else used.risk = false;
    }

    const usedTotalWeight =
      (used.growth ? wg : 0) + (used.margin ? wm : 0) + (used.value ? wv : 0) + (used.risk ? RISK_W : 0);

    let scoreNorm: number;
    if (usedTotalWeight === 0) scoreNorm = 50;
    else
      scoreNorm = clamp(
        Math.round(((growthScore + marginScore + valueScore + riskScore) / usedTotalWeight) * 100),
        0,
        100
      );

    const coverage = usedTotalWeight / 100;
    const penaltyFactor = 0.7 + 0.3 * coverage;
    const scoreFinal = clamp(Math.round(scoreNorm * penaltyFactor), 0, 100);

    // ✅ 상대 비교 계산 (S&P500 평균 / S&P500 내 percentile)
    const sp500AvgScore = sp500?.stats?.mean ?? null;
    const scorePctInSp500 =
      sp500 && sp500.scores ? scorePercentileFromMap(sp500.scores, scoreFinal) : null; // 0=하위, 1=상위

    let signal: "BUY" | "WATCH" | "HOLD" | "AVOID" = "WATCH";
    if (scoreFinal >= 70) signal = "BUY";
    else if (scoreFinal >= 55) signal = "WATCH";
    else if (scoreFinal >= 40) signal = "HOLD";
    else signal = "AVOID";

    const lowConf = coverage < 0.6;
    const baseSignal = signal;

    const warnings: string[] = [];
    if (mult.notes.length) warnings.push(...mult.notes);
    if (!dist) warnings.push("Sector distribution not loaded; Value percentile may be unavailable.");
    if (!secBlock) warnings.push(`No sector bucket found for "${sector}" in sector_dist.json.`);
    if (!candle) warnings.push("Price candles unavailable; RiskScore skipped.");
    if (!snapshot) warnings.push("Score snapshot not loaded; S&P500 relative metrics unavailable.");

    if (coverage === 0) warnings.push("No usable signals; neutral score used.");
    else if (coverage < 0.35) warnings.push("Very low coverage; treat as WATCH (not a strong call).");
    else if (coverage < 0.6) warnings.push("Low coverage; treat as WATCH (not a strong call).");

    if (lowConf && signal !== "WATCH") signal = "WATCH";

    const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
    const autoSummary = [
      isNum(revCagr) ? `Rev CAGR ${pct(revCagr)}` : "Rev CAGR N/A",
      isNum(opMargin) ? `OpM ${pct(opMargin)}` : "OpM N/A",
      isNum(fcfMargin) ? `FCF M ${pct(fcfMargin)}` : "FCF M N/A",
      `FCF Trend ${fcfTrend}`,
      isNum(vol20) || isNum(mdd90)
        ? `Risk Vol ${isNum(vol20) ? pct(vol20) : "N/A"}, MDD ${isNum(mdd90) ? pct(mdd90) : "N/A"}`
        : "Risk N/A",
    ].join(" / ");

    const confidence = pickConfidence(coverage);

    const explain = {
      cache: { revalidate_seconds: REVALIDATE_10M },
      sector: {
        sector,
        source: sectorInfo?.source ?? "unknown",
        dist_asof: dist?.generated_at_utc ?? null,
      },
      weights_used: { growth: wg, margin: wm, value: wv, risk: RISK_W },
      growth: { used: used.growth, revenue_cagr: revCagr, score: Math.round(growthScore) },
      margin: { used: used.margin, op_margin: opMargin, fcf_margin: fcfMargin, score: Math.round(marginScore) },
      value: {
        used: used.value,
        mode: "sector_percentile",
        pe: pe0,
        ps: ps0,
        pe_percentile: pePct, // 0 cheap
        ps_percentile: psPct,
        sector_value_percentile: sectorValuePct,
        score: Math.round(valueScore),
      },
      risk: { used: used.risk, vol_20d: vol20, mdd_90d: mdd90, score: Math.round(riskScore) },
      coverage: {
        used_total_weight: usedTotalWeight,
        coverage: Number(coverage.toFixed(2)),
        penalty_factor: Number(penaltyFactor.toFixed(2)),
        score_norm: Math.round(scoreNorm),
      },
      relative: {
        snapshot_asof: snapshot?.generated_at_utc ?? null,
        sp500_avg_score: sp500AvgScore,
        score_percentile_in_sp500: scorePctInSp500, // 0 bottom -> 1 top
      },
    };

    return NextResponse.json({
      ticker,
      generated_at_utc: new Date().toISOString(),
      signal,
      score: scoreFinal,
      confidence,

      // ✅ 상대 비교 결과(프론트에서 바로 쓰기 좋게 summary 옆에 분리)
      relative: {
        sector_value_percentile: sectorValuePct, // 0 cheap ~ 1 expensive (섹터 내 멀티플 상대 위치)
        sp500_avg_score: sp500AvgScore,
        score_percentile_in_sp500: scorePctInSp500, // 0 bottom ~ 1 top
        snapshot_asof: snapshot?.generated_at_utc ?? null,
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
        pe: pe0,
        ps: ps0,
        risk: { vol_20d: vol20, mdd_90d: mdd90 },
        auto: autoSummary,
      },
      explain,
      warnings,
    });
  } catch (err: any) {
    return NextResponse.json({ error: "recommendation failed", message: String(err?.message || err) }, { status: 500 });
  }
}