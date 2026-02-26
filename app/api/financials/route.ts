import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Row = {
  year: number;
  revenue: number | null;
  opIncome: number | null;
  fcf: number | null; // computed: CFO - Capex(abs)
  meta?: {
    revenue_source?: string; // "finnhub" | "sec" | "none"
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

function toUpperTicker(t: string) {
  return decodeURIComponent(t).trim().toUpperCase();
}

/** ========= FINNHUB (optional) ========= */
type FinnhubFinancialsResponse = any;

async function fetchFinnhubFinancials(ticker: string, apiKey: string) {
  // Finnhub "financials-reported" is often more complete than basic financials endpoints.
  // We'll use financials-reported and aggregate annual FY.
  const url = new URL("https://finnhub.io/api/v1/stock/financials-reported");
  url.searchParams.set("symbol", ticker);
  url.searchParams.set("token", apiKey);

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`Finnhub financials HTTP ${res.status}`);
  return (await res.json()) as FinnhubFinancialsResponse;
}

async function fetchFinnhubMultiples(ticker: string, apiKey: string) {
  // company basic financials includes peTTM, psTTM in many cases
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

/**
 * Finnhub financials-reported parsing:
 * We try to extract:
 * - Revenue (us-gaap:Revenues)
 * - Operating Income (us-gaap:OperatingIncomeLoss)
 * - CFO (us-gaap:NetCashProvidedByUsedInOperatingActivities)
 * - Capex (us-gaap:PaymentsToAcquirePropertyPlantAndEquipment)
 *
 * Then compute FCF = CFO - abs(Capex)
 */
function parseFinnhubAnnualFY(data: any): {
  rows: Row[];
  coverage: { revenue: boolean; opIncome: boolean; fcf: boolean };
} {
  const reports = Array.isArray(data?.data) ? data.data : [];
  const byYear: Record<number, any[]> = {};

  for (const r of reports) {
    // Finnhub provides "report" with "bs/is/cf" arrays and "year"/"period"
    // We'll accept period "FY" preferentially.
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
    // arr items may look like {concept, label, value, unit, ...}
    const hit = arr?.find((x) => x?.concept === conceptName);
    const v = hit?.value;
    return isNum(v) ? v : null;
  };

  for (const y of years.slice(-3)) {
    // take first FY report for the year
    const r = byYear[y]?.[0];
    const isArr = Array.isArray(r?.report?.ic) ? r.report.ic : []; // income statement (ic)
    const cfArr = Array.isArray(r?.report?.cf) ? r.report.cf : []; // cash flow (cf)

    const revenue = pickValue(isArr, "us-gaap_Revenues");
    const opIncome = pickValue(isArr, "us-gaap_OperatingIncomeLoss");

    const cfo = pickValue(cfArr, "us-gaap_NetCashProvidedByUsedInOperatingActivities");
    const capex = pickValue(cfArr, "us-gaap_PaymentsToAcquirePropertyPlantAndEquipment");

    const fcf =
      isNum(cfo) && isNum(capex)
        ? cfo - Math.abs(capex) // capex is cash outflow; sign can vary by source
        : null;

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

/** ========= SEC EDGAR (no key, User-Agent required) ========= */

type SecTickerRow = {
  cik_str: number;
  ticker: string;
  title: string;
};

type SecCompanyFacts = any;

const SEC_TICKER_MAP_URL = "https://www.sec.gov/files/company_tickers.json";

const mem = globalThis as any;
mem.__sec_cache__ = mem.__sec_cache__ || {
  tickerMap: null as null | Map<string, string>, // TICKER -> CIK(10)
  tickerMapFetchedAt: 0,
  companyFacts: new Map<string, { fetchedAt: number; data: SecCompanyFacts }>(),
};

function padCik10(cik: number | string) {
  const s = String(cik).replace(/\D/g, "");
  return s.padStart(10, "0");
}

async function fetchSecTickerMap(userAgent: string): Promise<Map<string, string>> {
  // cache 7 days
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
  // cache 6 hours per CIK
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
  fp?: string; // "FY", "Q1"...
  form?: string; // "10-K"
  filed?: string;
  val?: number;
  frame?: string;
};

function extractAnnualByFY(facts: SecCompanyFacts, concept: string): Map<number, number> {
  // returns FY(year) -> value, for annual (fp=FY) USD series
  const out = new Map<number, number>();
  const pts: FactPoint[] =
    facts?.facts?.["us-gaap"]?.[concept]?.units?.USD ??
    facts?.facts?.["us-gaap"]?.[concept]?.units?.["USD"] ??
    [];

  if (!Array.isArray(pts)) return out;

  // Prefer 10-K FY points
  const annual = pts.filter((p) => p && p.fp === "FY" && isNum(p.val) && Number.isFinite(p.fy || NaN));
  // sort by filed date and pick latest per FY
  annual.sort((a, b) => String(a.filed || "").localeCompare(String(b.filed || "")));

  for (const p of annual) {
    const year = Number(p.fy);
    if (!Number.isFinite(year)) continue;
    // overwrite -> last wins (latest filed)
    out.set(year, Number(p.val));
  }
  return out;
}

function buildRowsFromSEC(facts: SecCompanyFacts): { rows: Row[]; coverage: { revenue: boolean; opIncome: boolean; fcf: boolean } } {
  const rev = extractAnnualByFY(facts, "Revenues");
  const op = extractAnnualByFY(facts, "OperatingIncomeLoss");

  const cfo = extractAnnualByFY(facts, "NetCashProvidedByUsedInOperatingActivities");
  const capex = extractAnnualByFY(facts, "PaymentsToAcquirePropertyPlantAndEquipment");

  // union of years
  const years = Array.from(new Set([...rev.keys(), ...op.keys(), ...cfo.keys(), ...capex.keys()]))
    .filter((y) => Number.isFinite(y))
    .sort((a, b) => a - b)
    .slice(-3);

  const rows: Row[] = years.map((y) => {
    const revenue = rev.get(y) ?? null;
    const opIncome = op.get(y) ?? null;

    const cfoVal = cfo.get(y);
    const capexVal = capex.get(y);
    const fcf =
      isNum(cfoVal) && isNum(capexVal)
        ? cfoVal - Math.abs(capexVal) // capex sign normalize
        : null;

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

/** ========= Merge strategy =========
 * 1) Try Finnhub (if key exists) -> rows1
 * 2) Always SEC fallback -> rows2
 * 3) Merge by year, field-level fill:
 *    - Prefer Finnhub value if present, else SEC value
 *    - Meta tracks source
 */
function mergeRowsPreferFinnhub(fh: Row[], sec: Row[]): Row[] {
  const byYear = new Map<number, { fh?: Row; sec?: Row }>();
  for (const r of fh) byYear.set(r.year, { ...(byYear.get(r.year) || {}), fh: r });
  for (const r of sec) byYear.set(r.year, { ...(byYear.get(r.year) || {}), sec: r });

  const years = Array.from(byYear.keys()).sort((a, b) => a - b).slice(-3);

  return years.map((y) => {
    const pair = byYear.get(y)!;
    const a = pair.fh;
    const b = pair.sec;

    const revenue = isNum(a?.revenue) ? a!.revenue : (isNum(b?.revenue) ? b!.revenue : null);
    const opIncome = isNum(a?.opIncome) ? a!.opIncome : (isNum(b?.opIncome) ? b!.opIncome : null);
    const fcf = isNum(a?.fcf) ? a!.fcf : (isNum(b?.fcf) ? b!.fcf : null);

    return {
      year: y,
      revenue,
      opIncome,
      fcf,
      meta: {
        revenue_source: isNum(a?.revenue) ? "finnhub" : (isNum(b?.revenue) ? "sec" : "none"),
        opIncome_source: isNum(a?.opIncome) ? "finnhub" : (isNum(b?.opIncome) ? "sec" : "none"),
        fcf_source: isNum(a?.fcf) ? "finnhub" : (isNum(b?.fcf) ? "sec" : "none"),
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
    return NextResponse.json(
      { error: "SEC_USER_AGENT missing in .env.local" },
      { status: 500 }
    );
  }

  const FINNHUB_KEY = process.env.FINNHUB_API_KEY || "";

  try {
    // ---- SEC: always fetch ----
    const map = await fetchSecTickerMap(SEC_UA);
    const cik10 = map.get(ticker);
    if (!cik10) {
      return NextResponse.json(
        {
          ticker,
          generated_at_utc: new Date().toISOString(),
          source_note: "SEC has no CIK mapping for this ticker.",
          rows: [],
          multiples: { pe: null, ps: null },
        } satisfies FinancialsPayload,
        { status: 200 }
      );
    }

    const facts = await fetchSecCompanyFacts(cik10, SEC_UA);
    const secParsed = buildRowsFromSEC(facts);

    // ---- Finnhub: optional ----
    let fhRows: Row[] = [];
    let multiples: { pe: number | null; ps: number | null } = { pe: null, ps: null };
    let finnhubOk = false;

    if (FINNHUB_KEY) {
      try {
        const fh = await fetchFinnhubFinancials(ticker, FINNHUB_KEY);
        const parsed = parseFinnhubAnnualFY(fh);
        fhRows = parsed.rows;
        finnhubOk = true;
      } catch {
        finnhubOk = false;
      }

      try {
        multiples = await fetchFinnhubMultiples(ticker, FINNHUB_KEY);
      } catch {
        // ignore
      }
    }

    // ---- Merge ----
    const rows = mergeRowsPreferFinnhub(fhRows, secParsed.rows);

    const noteParts: string[] = [];
    if (finnhubOk) noteParts.push("Income/CF: Finnhub preferred, SEC used as fallback.");
    else noteParts.push("Income/CF: SEC source (Finnhub unavailable).");
    noteParts.push("FCF is computed as CFO - abs(Capex).");
    noteParts.push("Some fields may be unavailable depending on filing / tags.");

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