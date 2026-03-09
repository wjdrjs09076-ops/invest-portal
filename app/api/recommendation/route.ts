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
  sectors: Record<string, any>;
};

type Candle = {
  c: number[];
  t: number[];
  s: string;
};

type SnapshotItem = {
  ticker: string;
  signal?: string;
  label?: string;
  score?: number | null;
  sector?: string;
  close?: number | null;
  rsi?: number | null;
  ret5d?: number | null;
  ret20d?: number | null;
  vol20?: number | null;
  dd60?: number | null;
  stock_score_raw?: number | null;
  sector_strength_20d?: number | null;
  sector_score?: number | null;
  risk_score?: number | null;
  final_score_raw?: number | null;
};

type ScoreSnapshot = {
  generated_at?: string;
  generated_at_utc?: string;
  weights?: Record<string, number>;
  method?: {
    summary?: string;
    notes?: string[];
  };
  groups?: Array<{
    key: string;
    label: string;
    description?: string;
    top3: SnapshotItem[];
    count?: number;
  }>;
  sp500?: SnapshotItem[];
  nasdaq100?: SnapshotItem[];
  dow30?: SnapshotItem[];
};

type FundamentalsRecord = {
  ticker: string;
  generated_at_utc?: string | null;
  source?: string;
  name?: string | null;
  sector?: string | null;
  market_cap?: number | null;
  multiples?: {
    pe?: number | null;
    ps?: number | null;
  };
  annual_latest?: {
    revenue?: number | null;
    op_income?: number | null;
    fcf?: number | null;
    cfo?: number | null;
    capex?: number | null;
  };
};

type FundamentalsMap = Record<string, FundamentalsRecord>;

type RiskSnapshotItem = {
  ticker: string;
  close?: number | null;
  ret5d?: number | null;
  ret20d?: number | null;
  rsi14?: number | null;
  vol20?: number | null;
  dd60?: number | null;
};

type RiskSnapshotMap = Record<string, RiskSnapshotItem>;

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

function toNumArray(v: any): number[] {
  const raw =
    (Array.isArray(v) ? v : null) ??
    (Array.isArray(v?.values) ? v.values : null) ??
    (Array.isArray(v?.list) ? v.list : null) ??
    (Array.isArray(v?.data) ? v.data : null) ??
    [];

  return raw
    .map((x: any) => (typeof x === "string" ? Number(x) : x))
    .filter((x: any) => typeof x === "number" && Number.isFinite(x))
    .sort((a: number, b: number) => a - b);
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

  if (
    is("technology") ||
    is("information technology") ||
    is("communication") ||
    is("software") ||
    is("internet")
  ) {
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
  if (!Array.isArray(sortedAsc) || sortedAsc.length < 3) return null;
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
  return rank / (n - 1);
}

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

async function loadFundamentalsMap(): Promise<FundamentalsMap | null> {
  const url = process.env.FUNDAMENTALS_URL;
  if (!url) return null;

  try {
    const res = await fetch(url, { next: { revalidate: REVALIDATE_10M } });
    if (!res.ok) return null;

    const text = await res.text();
    const json = JSON.parse(text) as FundamentalsMap;
    return json;
  } catch {
    return null;
  }
}

async function loadRiskSnapshotMap(): Promise<RiskSnapshotMap | null> {
  const url = process.env.RISK_SNAPSHOT_URL;
  if (!url) return null;

  try {
    const res = await fetch(url, { next: { revalidate: REVALIDATE_10M } });
    if (!res.ok) return null;

    const text = await res.text();
    const json = JSON.parse(text) as RiskSnapshotMap;
    return json;
  } catch {
    return null;
  }
}

function findTickerInSnapshot(snapshot: ScoreSnapshot | null, ticker: string) {
  if (!snapshot) return null;

  const pools: SnapshotItem[][] = [
    Array.isArray(snapshot.sp500) ? snapshot.sp500 : [],
    Array.isArray(snapshot.nasdaq100) ? snapshot.nasdaq100 : [],
    Array.isArray(snapshot.dow30) ? snapshot.dow30 : [],
  ];

  for (const pool of pools) {
    const found = pool.find((x) => (x.ticker || "").toUpperCase() === ticker.toUpperCase());
    if (found) return found;
  }

  if (Array.isArray(snapshot.groups)) {
    for (const g of snapshot.groups) {
      const found = (g.top3 || []).find((x) => (x.ticker || "").toUpperCase() === ticker.toUpperCase());
      if (found) return found;
    }
  }

  return null;
}

function findTickerUniverse(snapshot: ScoreSnapshot | null, ticker: string) {
  if (!snapshot) return null;

  const t = ticker.toUpperCase();

  if (Array.isArray(snapshot.sp500) && snapshot.sp500.some((x) => (x.ticker || "").toUpperCase() === t)) {
    return "sp500";
  }
  if (Array.isArray(snapshot.nasdaq100) && snapshot.nasdaq100.some((x) => (x.ticker || "").toUpperCase() === t)) {
    return "nasdaq100";
  }
  if (Array.isArray(snapshot.dow30) && snapshot.dow30.some((x) => (x.ticker || "").toUpperCase() === t)) {
    return "dow30";
  }

  return null;
}

function normalizeSectorName(sectorRaw: string | null | undefined): string {
  const s = (sectorRaw || "").trim();

  const map: Record<string, string> = {
    Technology: "Information Technology",
    "Information Technology": "Information Technology",
    Healthcare: "Health Care",
    "Health Care": "Health Care",
    "Consumer Defensive": "Consumer Staples",
    "Consumer Staples": "Consumer Staples",
    "Consumer Cyclical": "Consumer Discretionary",
    "Consumer Discretionary": "Consumer Discretionary",
    Financial: "Financials",
    Financials: "Financials",
    Industrials: "Industrials",
    Energy: "Energy",
    Materials: "Materials",
    Utilities: "Utilities",
    "Real Estate": "Real Estate",
    Communication: "Communication Services",
    "Communication Services": "Communication Services",
  };

  return map[s] || s || "Unknown";
}

function sectorCandidates(sectorRaw: string | null | undefined): string[] {
  const s = normalizeSectorName(sectorRaw);

  const aliasMap: Record<string, string[]> = {
    "Information Technology": ["Information Technology", "Technology"],
    "Health Care": ["Health Care", "Healthcare"],
    "Consumer Staples": ["Consumer Staples", "Consumer Defensive"],
    "Consumer Discretionary": ["Consumer Discretionary", "Consumer Cyclical"],
    Financials: ["Financials", "Financial"],
    "Communication Services": ["Communication Services", "Communication"],
  };

  const base = aliasMap[s] || [s];
  const all = new Set<string>();

  for (const item of base) {
    all.add(item);
    all.add(item.toLowerCase());
    all.add(item.toUpperCase());
  }

  return Array.from(all);
}

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

function pct(x: number | null) {
  return isNum(x) ? `${(x * 100).toFixed(1)}%` : "N/A";
}

function yoy(prev: number, latest: number) {
  if (prev <= 0 || latest <= 0) return null;
  return latest / prev - 1;
}

function computeRevenueGrowth(rows: Row[]) {
  const valid = rows.filter((r) => isNum(r.revenue) && (r.revenue as number) > 0);
  if (valid.length < 2) {
    return {
      value: null as number | null,
      method: "unavailable",
      note: "Not enough positive revenue history",
    };
  }

  const latest = valid[valid.length - 1];
  const prev = valid.length >= 2 ? valid[valid.length - 2] : null;
  const oldest = valid[0];

  if (valid.length >= 4 && oldest && latest) {
    const years = latest.year - oldest.year;
    const v = cagr(oldest.revenue as number, latest.revenue as number, years);
    if (isNum(v)) {
      return {
        value: v,
        method: "revenue_3y_cagr",
        note: `Using ${years}Y revenue CAGR`,
      };
    }
  }

  if (valid.length >= 3) {
    const a = valid[valid.length - 3];
    const b = latest;
    const years = b.year - a.year;
    const v = cagr(a.revenue as number, b.revenue as number, years);
    if (isNum(v)) {
      return {
        value: v,
        method: "revenue_2y_cagr",
        note: `Using ${years}Y revenue CAGR fallback`,
      };
    }
  }

  if (prev && latest) {
    const v = yoy(prev.revenue as number, latest.revenue as number);
    if (isNum(v)) {
      return {
        value: v,
        method: "revenue_yoy",
        note: "Using 1Y revenue growth fallback",
      };
    }
  }

  return {
    value: null as number | null,
    method: "unavailable",
    note: "Revenue growth unavailable",
  };
}

function computeMargins(rows: Row[]) {
  const latest = rows[rows.length - 1] || null;
  if (!latest || !isNum(latest.revenue) || latest.revenue === 0) {
    return {
      opMargin: null as number | null,
      fcfMargin: null as number | null,
      note: "Revenue unavailable for margin calculation",
    };
  }

  const revenue = latest.revenue as number;
  const opMargin = isNum(latest.opIncome) ? (latest.opIncome as number) / revenue : null;
  const fcfMargin = isNum(latest.fcf) ? (latest.fcf as number) / revenue : null;

  let note = "";
  if (opMargin === null && fcfMargin === null) note = "Both operating margin and FCF margin unavailable";
  else if (opMargin === null) note = "Operating margin unavailable; using FCF margin only";
  else if (fcfMargin === null) note = "FCF margin unavailable; using operating margin only";
  else note = "Using operating margin and FCF margin";

  return { opMargin, fcfMargin, note };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const tickerRaw = searchParams.get("ticker");
  if (!tickerRaw) return NextResponse.json({ error: "ticker missing" }, { status: 400 });

  const ticker = decodeURIComponent(tickerRaw).trim().toUpperCase();

  try {
    const origin = new URL(req.url).origin;

    const [finRes, sectorRes, dist, snapshot, fundamentalsMap, riskSnapshotMap] = await Promise.all([
      fetch(`${origin}/api/financials?ticker=${encodeURIComponent(ticker)}`, {
        cache: "no-store",
      }),
      fetch(`${origin}/api/sector?ticker=${encodeURIComponent(ticker)}`, {
        cache: "no-store",
      }).catch(() => null),
      loadSectorDist(),
      loadScoreSnapshot(),
      loadFundamentalsMap(),
      loadRiskSnapshotMap(),
    ]);

    if (!finRes.ok) {
      return NextResponse.json({ error: `financials HTTP ${finRes.status}` }, { status: 500 });
    }

    const fin = (await finRes.json()) as FinancialsPayload;
    const sectorInfo = sectorRes && "ok" in sectorRes && sectorRes.ok ? ((await sectorRes.json()) as SectorPayload) : null;

    const snapshotItem = findTickerInSnapshot(snapshot, ticker);
    const snapshotUniverse = findTickerUniverse(snapshot, ticker);
    const fundamentals = fundamentalsMap?.[ticker] ?? null;
    const riskSnapshot = riskSnapshotMap?.[ticker] ?? null;

    const sector = normalizeSectorName(
      sectorInfo?.sector ?? fundamentals?.sector ?? snapshotItem?.sector ?? "Unknown"
    );

    const w0 = sectorWeights(sector);

    let secBlock: any = null;
    if (dist?.sectors) {
      for (const key of sectorCandidates(sector)) {
        if (dist.sectors[key]) {
          secBlock = dist.sectors[key];
          break;
        }
      }
    }

    const peArr = secBlock ? toNumArray(secBlock.pe) : [];
    const psArr = secBlock ? toNumArray(secBlock.ps) : [];

    const candle = await fetchCandle(ticker);
    const riskRaw = candle ? computeRisk(candle.c) : null;

    const rows = [...(fin.rows || [])].sort((a, b) => a.year - b.year);
    const latest = rows[rows.length - 1] || null;
    const prev = rows.length >= 2 ? rows[rows.length - 2] : null;

    const growthInfo = computeRevenueGrowth(rows);
    const revGrowth = growthInfo.value;

    const marginInfo = computeMargins(rows);
    const opMargin = marginInfo.opMargin;
    const fcfMargin = marginInfo.fcfMargin;

    let fcfTrend: "UP" | "DOWN" | "FLAT" | "N/A" = "N/A";
    if (prev && latest && isNum(prev.fcf) && isNum(latest.fcf) && prev.fcf !== 0) {
      fcfTrend = trend(Math.abs(prev.fcf), Math.abs(latest.fcf)) as any;
    }

    const pe0 =
      (isNum(fundamentals?.multiples?.pe) ? fundamentals?.multiples?.pe : null) ??
      fin.multiples?.pe ??
      null;

    const ps0 =
      (isNum(fundamentals?.multiples?.ps) ? fundamentals?.multiples?.ps : null) ??
      fin.multiples?.ps ??
      null;

    const mult = sanitizeMultiples(pe0, ps0);
    const pe = mult.pe;
    const ps = mult.ps;

    const pePct = peArr.length && isNum(pe) ? percentile(peArr, pe) : null;
    const psPct = psArr.length && isNum(ps) ? percentile(psArr, ps) : null;

    const sectorValuePct =
      pePct !== null && psPct !== null
        ? (pePct + psPct) / 2
        : pePct !== null
        ? pePct
        : psPct !== null
        ? psPct
        : null;

    const FUND = 80;
    const RISK_W = 20;

    const wg = (w0.growth / 100) * FUND;
    const wm = (w0.margin / 100) * FUND;
    const wv = (w0.value / 100) * FUND;

    const used = { growth: false, margin: false, value: false, risk: false };

    let growthScore = 0;
    if (isNum(revGrowth)) {
      used.growth = true;
      growthScore = scaleLinear(revGrowth, -0.2, 0.3) * wg;
    }

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

    let vol20 = riskRaw?.vol_20d ?? null;
    let mdd90 = riskRaw?.mdd_90d ?? null;

    if (!isNum(vol20) && isNum(riskSnapshot?.vol20)) {
      vol20 = riskSnapshot!.vol20!;
    } else if (!isNum(vol20) && isNum(snapshotItem?.vol20)) {
      vol20 = snapshotItem!.vol20!;
    }

    if (!isNum(mdd90) && isNum(riskSnapshot?.dd60)) {
      mdd90 = Math.abs(riskSnapshot!.dd60!);
    } else if (!isNum(mdd90) && isNum(snapshotItem?.dd60)) {
      mdd90 = Math.abs(snapshotItem!.dd60!);
    }

    let riskScore = 0;

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
    } else if (isNum(snapshotItem?.risk_score)) {
      used.risk = true;
      riskScore = snapshotItem!.risk_score! * RISK_W;
    }

    const usedTotalWeight =
      (used.growth ? wg : 0) +
      (used.margin ? wm : 0) +
      (used.value ? wv : 0) +
      (used.risk ? RISK_W : 0);

    let scoreNorm: number;
    if (usedTotalWeight === 0) scoreNorm = 50;
    else {
      scoreNorm = clamp(
        Math.round(((growthScore + marginScore + valueScore + riskScore) / usedTotalWeight) * 100),
        0,
        100
      );
    }

    const coverage = usedTotalWeight / 100;
    const penaltyFactor = 0.7 + 0.3 * coverage;
    const scoreFinal = clamp(Math.round(scoreNorm * penaltyFactor), 0, 100);

    const sp500AvgScore = null;
    const scorePctInSp500 = null;

    let signal: "BUY" | "WATCH" | "HOLD" | "AVOID" = "WATCH";
    if (scoreFinal >= 70) signal = "BUY";
    else if (scoreFinal >= 55) signal = "WATCH";
    else if (scoreFinal >= 40) signal = "HOLD";
    else signal = "AVOID";

    const lowConf = coverage < 0.6;
    const baseSignal = signal;

    const warnings: string[] = [];
    if (mult.notes.length) warnings.push(...mult.notes);

    if (!dist) warnings.push("Sector distribution not loaded; value percentile may be unavailable.");
    if (!secBlock) warnings.push(`No sector bucket found for "${sector}" in sector_dist.json.`);

    if (!candle && riskSnapshot) {
      warnings.push("Price candles unavailable; using risk_snapshot.json fallback.");
    } else if (!candle && snapshotItem) {
      warnings.push("Price candles unavailable; using score snapshot risk fallback.");
    } else if (!candle) {
      warnings.push("Price candles unavailable; risk score skipped.");
    }

    if (!snapshot) warnings.push("Score snapshot not loaded; relative market snapshot unavailable.");
    if (snapshot && !snapshotItem) warnings.push("Ticker not found in current score_snapshot top selections.");
    if (snapshot && snapshotItem) {
      warnings.push(`Snapshot scoring loaded from ${snapshotUniverse ?? "unknown"} top selections.`);
    }

    if (fundamentals) warnings.push("Value inputs enriched from fundamentals.json.");
    if (riskSnapshot) warnings.push("Risk inputs enriched from risk_snapshot.json.");

    warnings.push(`SectorDist sizes: pe=${peArr.length}, ps=${psArr.length} (sector="${sector}")`);

    if (!isNum(revGrowth)) warnings.push(`Growth fallback exhausted: ${growthInfo.note}`);
    if (!isNum(opMargin) || !isNum(fcfMargin)) warnings.push(marginInfo.note);

    if (pePct === null && psPct === null) {
      warnings.push("Both P/E and P/S percentile unavailable; value score skipped.");
    } else if (pePct === null && psPct !== null) {
      warnings.push("P/E unavailable; using P/S percentile only.");
    } else if (pePct !== null && psPct === null) {
      warnings.push("P/S unavailable; using P/E percentile only.");
    }

    if (coverage === 0) warnings.push("No usable signals; neutral score used.");
    else if (coverage < 0.35) warnings.push("Very low coverage; treat as WATCH (not a strong call).");
    else if (coverage < 0.6) warnings.push("Low coverage; treat as WATCH (not a strong call).");

    if (lowConf && signal !== "WATCH") signal = "WATCH";

    const autoSummary = [
      `Growth ${isNum(revGrowth) ? pct(revGrowth) : "N/A"} (${growthInfo.method})`,
      `OpM ${pct(opMargin)}`,
      `FCF M ${pct(fcfMargin)}`,
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
        source: sectorInfo?.source ?? (fundamentals?.sector ? "fundamentals" : "unknown"),
        dist_asof: dist?.generated_at_utc ?? null,
      },
      weights_used: { growth: wg, margin: wm, value: wv, risk: RISK_W },
      growth: {
        used: used.growth,
        revenue_growth: revGrowth,
        method: growthInfo.method,
        note: growthInfo.note,
        score: Math.round(growthScore),
      },
      margin: {
        used: used.margin,
        op_margin: opMargin,
        fcf_margin: fcfMargin,
        note: marginInfo.note,
        score: Math.round(marginScore),
      },
      value: {
        used: used.value,
        mode: "sector_percentile",
        pe,
        ps,
        pe_percentile: pePct,
        ps_percentile: psPct,
        sector_value_percentile: sectorValuePct,
        score: Math.round(valueScore),
      },
      risk: {
        used: used.risk,
        vol_20d: vol20,
        mdd_90d: mdd90,
        score: Math.round(riskScore),
        source: candle
          ? "finnhub candle"
          : riskSnapshot
          ? "risk_snapshot fallback"
          : snapshotItem
          ? "score_snapshot fallback"
          : "unavailable",
      },
      coverage: {
        used_total_weight: usedTotalWeight,
        coverage: Number(coverage.toFixed(2)),
        penalty_factor: Number(penaltyFactor.toFixed(2)),
        score_norm: Math.round(scoreNorm),
      },
      relative: {
        snapshot_asof: snapshot?.generated_at ?? snapshot?.generated_at_utc ?? null,
        sp500_avg_score: sp500AvgScore,
        score_percentile_in_sp500: scorePctInSp500,
      },
    };

    return NextResponse.json({
      ticker,
      generated_at_utc: new Date().toISOString(),
      signal,
      score: scoreFinal,
      confidence,

      relative: {
        sector_value_percentile: sectorValuePct,
        sp500_avg_score: sp500AvgScore,
        score_percentile_in_sp500: scorePctInSp500,
        snapshot_asof: snapshot?.generated_at ?? snapshot?.generated_at_utc ?? null,
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
        pe,
        ps,
        risk: { vol_20d: vol20, mdd_90d: mdd90 },
        auto: autoSummary,
        snapshot_scoring: {
          universe: snapshotUniverse,
          snapshot_asof: snapshot?.generated_at ?? snapshot?.generated_at_utc ?? null,
          snapshot_score: snapshotItem?.score ?? null,
          snapshot_signal: snapshotItem?.signal ?? snapshotItem?.label ?? null,
          sector_strength_20d: snapshotItem?.sector_strength_20d ?? null,
          sector_score: snapshotItem?.sector_score ?? null,
          risk_score: snapshotItem?.risk_score ?? null,
          stock_score_raw: snapshotItem?.stock_score_raw ?? null,
          final_score_raw: snapshotItem?.final_score_raw ?? null,
          ret5d: snapshotItem?.ret5d ?? null,
          ret20d: snapshotItem?.ret20d ?? null,
          rsi: snapshotItem?.rsi ?? null,
          vol20: snapshotItem?.vol20 ?? null,
          dd60: snapshotItem?.dd60 ?? null,
        },
        risk_snapshot: {
          ret5d: riskSnapshot?.ret5d ?? null,
          ret20d: riskSnapshot?.ret20d ?? null,
          rsi14: riskSnapshot?.rsi14 ?? null,
          vol20: riskSnapshot?.vol20 ?? null,
          dd60: riskSnapshot?.dd60 ?? null,
        },
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