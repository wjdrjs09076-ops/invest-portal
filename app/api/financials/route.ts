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

function isNum(x: any): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function toUpperTicker(t: string) {
  return decodeURIComponent(t).trim().toUpperCase();
}

/** ========= fundamentals.json ========= */

async function loadFundamentalsMap(): Promise<FundamentalsMap | null> {
  const url = process.env.FUNDAMENTALS_URL;
  if (!url) return null;

  try {
    const res = await fetch(url, { next: { revalidate: 600 } });
    if (!res.ok) return null;
    return (await res.json()) as FundamentalsMap;
  } catch {
    return null;
  }
}

/** ========= FINNHUB (optional) ========= */

type FinnhubFinancialsResponse = any;

async function fetchFinnhubFinancials(ticker: string, apiKey: string) {
  const url = new URL("https://finnhub.io/api/v1/stock/financials-reported");
  url.searchParams.set("symbol", ticker);
  url.searchParams.set("token", apiKey);

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`Finnhub financials HTTP ${res.status}`);
  return (await res.json()) as FinnhubFinancialsResponse;
}

async function fetchFinnhubMultiples(ticker: string, apiKey: string) {
  const url = new URL("https://finnhub.io/api/v1/stock/metric");
  url.searchParams.set("symbol", ticker);
  url.searchParams.set("metric", "all");
  url.searchParams.set("token", apiKey);

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`Finnhub metric HTTP ${res.status}`);
  const j = await res.json();
  const pe = j?.metric?.peTTM;
  const ps = j?.metric?.psTTM;
  return {
    pe: isNum(pe) ? pe : null,
    ps: isNum(ps) ? ps : null,
  };
}

function parseFinnhubAnnualFY(data: any): {
  rows: Row[];
  coverage: { revenue: boolean; opIncome: boolean; fcf: boolean };
} {
  const reports = Array.isArray(data?.data) ? data.data : [];
  const byYear: Record<number, any[]> = {};

  for (const r of reports) {
    const year = Number(r?.year);
    const period = String(r?.period || "");
    if (!Number.isFinite(year)) continue;
    if (period !== "FY") continue;
    byYear[year] = byYear[year] || [];
    byYear[year].push(r);
  }

  const years = Object.keys(byYear)
    .map((y) => Number(y))
    .filter((y) => Number.isFinite(y))
    .sort((a, b) => a - b);

  const rows: Row[] = [];
  let hasRev = false;
  let hasOp = false;
  let hasFcf = false;

  const pickValue = (arr: any[], conceptName: string): number | null => {
    const hit = arr?.find((x) => x?.concept === conceptName);
    const v = hit?.value;
    return isNum(v) ? v : null;
  };

  for (const y of years.slice(-3)) {
    const r = byYear[y]?.[0];
    const isArr = Array.isArray(r?.report?.ic) ? r.report.ic : [];
    const cfArr = Array.isArray(r?.report?.cf) ? r.report.cf : [];

    const revenue = pickValue(isArr, "us-gaap_Revenues");
    const opIncome = pickValue(isArr, "us-gaap_OperatingIncomeLoss");

    const cfo = pickValue(cfArr, "us-gaap_NetCashProvidedByUsedInOperatingActivities");
    const capex = pickValue(cfArr, "us-gaap_PaymentsToAcquirePropertyPlantAndEquipment");

    const fcf = isNum(cfo) && isNum(capex) ? cfo - Math.abs(capex) : null;

    if (isNum(revenue)) hasRev = true;
    if (isNum(opIncome)) hasOp = true;
    if (isNum(fcf)) hasFcf = true;

    rows.push({
      year: y,
      revenue,
      opIncome,
      fcf,
      meta: {
        revenue_source: isNum(revenue) ? "finnhub" : "none",
        opIncome_source: isNum(opIncome) ? "finnhub" : "none",
        fcf_source: isNum(fcf) ? "finnhub" : "none",
      },
    });
  }

  return {
    rows,
    coverage: { revenue: hasRev, opIncome: hasOp, fcf: hasFcf },
  };
}

/** ========= SEC EDGAR ========= */

type SecTickerRow = {
  cik_str: number;
  ticker: string;
  title: string;
};

type SecCompanyFacts = any;

const SEC_TICKER_MAP_URL = "https://www.sec.gov/files/company_tickers.json";

const mem = globalThis as any;
mem.__sec_cache__ = mem.__sec_cache__ || {
  tickerMap: null as null | Map<string, string>,
  tickerMapFetchedAt: 0,
  companyFacts: new Map<string, { fetchedAt: number; data: SecCompanyFacts }>(),
};

function padCik10(cik: number | string) {
  const s = String(cik).replace(/\D/g, "");
  return s.padStart(10, "0");
}

async function fetchSecTickerMap(userAgent: string): Promise<Map<string, string>> {
  const now = Date.now();
  const cached = mem.__sec_cache__.tickerMap as Map<string, string> | null;
  if (cached && now - mem.__sec_cache__.tickerMapFetchedAt < 7 * 24 * 3600 * 1000) return cached;

  const res = await fetch(SEC_TICKER_MAP_URL, {
    headers: { "User-Agent": userAgent, "Accept-Encoding": "gzip, deflate, br" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`SEC ticker map HTTP ${res.status}`);

  const j = (await res.json()) as Record<string, SecTickerRow>;

  const map = new Map<string, string>();
  for (const k of Object.keys(j)) {
    const row = j[k];
    if (!row?.ticker || row?.cik_str == null) continue;
    map.set(String(row.ticker).toUpperCase(), padCik10(row.cik_str));
  }

  mem.__sec_cache__.tickerMap = map;
  mem.__sec_cache__.tickerMapFetchedAt = now;
  return map;
}

async function fetchSecCompanyFacts(cik10: string, userAgent: string): Promise<SecCompanyFacts> {
  const now = Date.now();
  const hit = mem.__sec_cache__.companyFacts.get(cik10);
  if (hit && now - hit.fetchedAt < 6 * 3600 * 1000) return hit.data;

  const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik10}.json`;
  const res = await fetch(url, {
    headers: { "User-Agent": userAgent, "Accept-Encoding": "gzip, deflate, br" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`SEC companyfacts HTTP ${res.status}`);

  const data = await res.json();
  mem.__sec_cache__.companyFacts.set(cik10, { fetchedAt: now, data });
  return data;
}

type FactPoint = {
  fy?: number;
  fp?: string;
  filed?: string;
  val?: number;
};

function extractAnnualByFY(facts: SecCompanyFacts, concepts: string[]): Map<number, number> {
  const out = new Map<number, number>();

  for (const concept of concepts) {
    const pts: FactPoint[] =
      facts?.facts?.["us-gaap"]?.[concept]?.units?.USD ??
      facts?.facts?.["us-gaap"]?.[concept]?.units?.["USD"] ??
      [];

    if (!Array.isArray(pts)) continue;

    const annual = pts.filter((p) => p && p.fp === "FY" && isNum(p.val) && Number.isFinite(p.fy || NaN));
    annual.sort((a, b) => String(a.filed || "").localeCompare(String(b.filed || "")));

    for (const p of annual) {
      const year = Number(p.fy);
      if (!Number.isFinite(year)) continue;
      out.set(year, Number(p.val));
    }

    if (out.size > 0) break;
  }

  return out;
}

function buildRowsFromSEC(facts: SecCompanyFacts): { rows: Row[]; coverage: { revenue: boolean; opIncome: boolean; fcf: boolean } } {
  const rev = extractAnnualByFY(facts, ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax"]);
  const op = extractAnnualByFY(facts, ["OperatingIncomeLoss"]);

  const cfo = extractAnnualByFY(facts, [
    "NetCashProvidedByUsedInOperatingActivities",
    "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
  ]);
  const capex = extractAnnualByFY(facts, [
    "PaymentsToAcquirePropertyPlantAndEquipment",
    "CapitalExpendituresIncurredButNotYetPaid",
  ]);

  const years = Array.from(new Set([...rev.keys(), ...op.keys(), ...cfo.keys(), ...capex.keys()]))
    .filter((y) => Number.isFinite(y))
    .sort((a, b) => a - b)
    .slice(-3);

  const rows: Row[] = years.map((y) => {
    const revenue = rev.get(y) ?? null;
    const opIncome = op.get(y) ?? null;
    const cfoVal = cfo.get(y);
    const capexVal = capex.get(y);
    const fcf = isNum(cfoVal) && isNum(capexVal) ? cfoVal - Math.abs(capexVal) : null;

    return {
      year: y,
      revenue: isNum(revenue) ? revenue : null,
      opIncome: isNum(opIncome) ? opIncome : null,
      fcf: isNum(fcf) ? fcf : null,
      meta: {
        revenue_source: isNum(revenue) ? "sec" : "none",
        opIncome_source: isNum(opIncome) ? "sec" : "none",
        fcf_source: isNum(fcf) ? "sec" : "none",
      },
    };
  });

  const hasRev = rows.some((r) => isNum(r.revenue));
  const hasOp = rows.some((r) => isNum(r.opIncome));
  const hasFcf = rows.some((r) => isNum(r.fcf));

  return { rows, coverage: { revenue: hasRev, opIncome: hasOp, fcf: hasFcf } };
}

/** ========= merge ========= */

function mergeRowsPreferFundamentalsThenFinnhubThenSEC(
  latestFund: FundamentalsRecord | null,
  fh: Row[],
  sec: Row[]
): Row[] {
  const byYear = new Map<number, { fh?: Row; sec?: Row }>();

  for (const r of fh) byYear.set(r.year, { ...(byYear.get(r.year) || {}), fh: r });
  for (const r of sec) byYear.set(r.year, { ...(byYear.get(r.year) || {}), sec: r });

  let years = Array.from(byYear.keys()).sort((a, b) => a - b).slice(-3);

  if (years.length === 0) {
    const currentYear = new Date().getUTCFullYear();
    years = [currentYear - 2, currentYear - 1, currentYear];
  }

  return years.map((y, idx) => {
    const pair = byYear.get(y) || {};
    const a = pair.fh;
    const b = pair.sec;

    const isLatest = idx === years.length - 1;

    const fundRevenue = isLatest ? latestFund?.annual_latest?.revenue : null;
    const fundOp = isLatest ? latestFund?.annual_latest?.op_income : null;
    const fundFcf = isLatest ? latestFund?.annual_latest?.fcf : null;

    const revenue =
      isNum(fundRevenue) ? fundRevenue :
      isNum(a?.revenue) ? a!.revenue :
      isNum(b?.revenue) ? b!.revenue :
      null;

    const opIncome =
      isNum(fundOp) ? fundOp :
      isNum(a?.opIncome) ? a!.opIncome :
      isNum(b?.opIncome) ? b!.opIncome :
      null;

    const fcf =
      isNum(fundFcf) ? fundFcf :
      isNum(a?.fcf) ? a!.fcf :
      isNum(b?.fcf) ? b!.fcf :
      null;

    return {
      year: y,
      revenue,
      opIncome,
      fcf,
      meta: {
        revenue_source:
          isNum(fundRevenue) ? "fundamentals" :
          isNum(a?.revenue) ? "finnhub" :
          isNum(b?.revenue) ? "sec" :
          "none",
        opIncome_source:
          isNum(fundOp) ? "fundamentals" :
          isNum(a?.opIncome) ? "finnhub" :
          isNum(b?.opIncome) ? "sec" :
          "none",
        fcf_source:
          isNum(fundFcf) ? "fundamentals" :
          isNum(a?.fcf) ? "finnhub" :
          isNum(b?.fcf) ? "sec" :
          "none",
      },
    };
  });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const tickerRaw = searchParams.get("ticker");
  if (!tickerRaw) return NextResponse.json({ error: "ticker missing" }, { status: 400 });

  const ticker = toUpperTicker(tickerRaw);

  const SEC_UA = process.env.SEC_USER_AGENT || "";
  if (!SEC_UA) {
    return NextResponse.json({ error: "SEC_USER_AGENT missing in .env.local" }, { status: 500 });
  }

  const FINNHUB_KEY = process.env.FINNHUB_API_KEY || "";

  try {
    const fundamentalsMap = await loadFundamentalsMap();
    const fund = fundamentalsMap?.[ticker] ?? null;

    const map = await fetchSecTickerMap(SEC_UA);
    const cik10 = map.get(ticker);

    let secRows: Row[] = [];
    if (cik10) {
      const facts = await fetchSecCompanyFacts(cik10, SEC_UA);
      secRows = buildRowsFromSEC(facts).rows;
    }

    let fhRows: Row[] = [];
    let finnhubOk = false;
    let multiples: { pe: number | null; ps: number | null } = {
      pe: fund?.multiples?.pe ?? null,
      ps: fund?.multiples?.ps ?? null,
    };

    if (FINNHUB_KEY) {
      try {
        const fh = await fetchFinnhubFinancials(ticker, FINNHUB_KEY);
        const parsed = parseFinnhubAnnualFY(fh);
        fhRows = parsed.rows;
        finnhubOk = true;
      } catch {
        finnhubOk = false;
      }

      // fundamentals.json에 없을 때만 Finnhub multiples 보강
      if (!isNum(multiples.pe) || !isNum(multiples.ps)) {
        try {
          const fhMult = await fetchFinnhubMultiples(ticker, FINNHUB_KEY);
          multiples = {
            pe: isNum(multiples.pe) ? multiples.pe : fhMult.pe,
            ps: isNum(multiples.ps) ? multiples.ps : fhMult.ps,
          };
        } catch {
          // ignore
        }
      }
    }

    const rows = mergeRowsPreferFundamentalsThenFinnhubThenSEC(fund, fhRows, secRows);

    const noteParts: string[] = [];
    if (fund) noteParts.push("Latest annual values: fundamentals.json (Yahoo pipeline) preferred.");
    if (finnhubOk) noteParts.push("Historical annual fill: Finnhub preferred, SEC used as fallback.");
    else noteParts.push("Historical annual fill: SEC fallback used where needed.");
    noteParts.push("FCF is computed as CFO - abs(Capex) when source does not provide direct FCF.");
    noteParts.push("Some fields may remain unavailable depending on filing / tags / source coverage.");

    const payload: FinancialsPayload = {
      ticker,
      generated_at_utc: new Date().toISOString(),
      source_note: noteParts.join(" "),
      rows,
      multiples,
    };

    return NextResponse.json(payload);
  } catch (err: any) {
    return NextResponse.json(
      { error: "financials failed", message: String(err?.message || err) },
      { status: 500 }
    );
  }
}