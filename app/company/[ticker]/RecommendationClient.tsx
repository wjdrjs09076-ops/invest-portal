"use client";

import { useEffect, useMemo, useState } from "react";

type RecommendationResponse = {
  ticker: string;
  generated_at_utc: string;

  signal: "BUY" | "WATCH" | "HOLD" | "AVOID";
  score: number;
  confidence?: "HIGH" | "MED" | "LOW";

  // ✅ NEW (v4 API)
  relative?: {
    sector_value_percentile: number | null; // 0 cheap ~ 1 expensive
    sp500_avg_score: number | null;
    score_percentile_in_sp500: number | null; // 0 bottom ~ 1 top
    snapshot_asof: string | null;
  };

  summary?: {
    sector?: string;
    pe?: number | null;
    ps?: number | null;
    auto?: string;

    risk?: { vol_20d: number | null; mdd_90d: number | null };

    // (구버전 호환)
    revenue_cagr?: number | null;
    op_margin?: number | null;
    fcf_margin?: number | null;
    fcf_trend?: "UP" | "DOWN" | "FLAT" | "N/A";
  };

  diagnostics?: {
    score_norm?: number;
    coverage?: number; // 0~1
    penalty_factor?: number;
    low_conf?: boolean;
    base_signal?: string;
    note?: string;
  };

  // ✅ explain은 버전이 달라질 수 있어 any로 받고 안전하게 접근
  explain?: any;

  warnings?: string[];
  error?: string;
  message?: string;
};

function fmtPct(x: number | null | undefined) {
  if (typeof x !== "number" || !Number.isFinite(x)) return "N/A";
  return `${(x * 100).toFixed(1)}%`;
}

function fmtNum(x: number | null | undefined, digits = 2) {
  if (typeof x !== "number" || !Number.isFinite(x)) return "N/A";
  return x.toFixed(digits);
}

function fmtISO(iso?: string) {
  if (!iso) return "";
  return iso.replace("T", " ").replace("Z", "Z");
}

function badgeClass(kind: string) {
  if (kind === "BUY") return "border-green-500 text-green-700";
  if (kind === "WATCH") return "border-blue-500 text-blue-700";
  if (kind === "HOLD") return "border-gray-500 text-gray-700";
  if (kind === "AVOID") return "border-red-500 text-red-700";
  return "border-gray-300 text-gray-700";
}

function confBadgeClass(conf?: string) {
  if (conf === "HIGH") return "border-green-500 text-green-700";
  if (conf === "MED") return "border-yellow-500 text-yellow-700";
  return "border-red-500 text-red-700";
}

export default function RecommendationClient({ ticker }: { ticker: string }) {
  const [data, setData] = useState<RecommendationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    async function run() {
      setLoading(true);
      setErr(null);

      try {
        const res = await fetch(`/api/recommendation?ticker=${encodeURIComponent(ticker)}`, { cache: "no-store" });
        const json = (await res.json()) as RecommendationResponse;

        if (!res.ok) {
          throw new Error(json?.error || `HTTP ${res.status}`);
        }

        if (alive) setData(json);
      } catch (e: any) {
        if (alive) setErr(String(e?.message || e));
      } finally {
        if (alive) setLoading(false);
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, [ticker]);

  const lowConf = data?.diagnostics?.low_conf ?? (data?.confidence ? data.confidence !== "HIGH" : false);

  const usedText = useMemo(() => {
    const ex = data?.explain;
    if (!ex) return "N/A";

    // ✅ NEW explain: growth.used / margin.used / value.used / risk.used
    const used: string[] = [];
    if (ex?.growth?.used) used.push("Growth");
    if (ex?.margin?.used) used.push("Margin");
    if (ex?.value?.used) used.push("Value");
    if (ex?.risk?.used) used.push("Risk");
    return used.length ? used.join(", ") : "(none)";
  }, [data]);

  // ✅ 게이지: S&P500 내 score percentile (0~1) -> 0~100
  const gauge = useMemo(() => {
    const p = data?.relative?.score_percentile_in_sp500;
    if (typeof p !== "number" || !Number.isFinite(p)) return null;
    return Math.round(p * 100);
  }, [data]);

  // ✅ 상대 비교 한 줄 텍스트
  const relativeLine = useMemo(() => {
    const r = data?.relative;
    if (!r) return null;

    const sectorPct = r.sector_value_percentile;
    const spAvg = r.sp500_avg_score;
    const spPct = r.score_percentile_in_sp500;

    return {
      sectorPctTxt: sectorPct == null ? "N/A" : `${Math.round(sectorPct * 100)}%`,
      spAvgTxt: spAvg == null ? "N/A" : String(spAvg),
      spPctTxt: spPct == null ? "N/A" : `${Math.round(spPct * 100)}%`,
      asof: r.snapshot_asof ? fmtISO(r.snapshot_asof) : "N/A",
    };
  }, [data]);

  // ✅ breakdown에 표시할 weight(구버전/신버전 모두 대응)
  const weights = useMemo(() => {
    const ex = data?.explain;
    if (!ex) return null;

    // NEW: explain.weights_used.{growth, margin, value, risk}
    if (ex?.weights_used) {
      return {
        growth: ex.weights_used.growth,
        margin: ex.weights_used.margin,
        value: ex.weights_used.value,
        risk: ex.weights_used.risk,
        mode: "new",
      };
    }

    // OLD: explain.growth.weight 등
    if (ex?.growth?.weight != null || ex?.margin?.weight != null || ex?.value?.weight != null) {
      return {
        growth: ex?.growth?.weight,
        margin: ex?.margin?.weight,
        value: ex?.value?.weight,
        risk: ex?.risk?.weight,
        mode: "old",
      };
    }

    return null;
  }, [data]);

  // ✅ Value key inputs (구버전: pe_scored/ps_scored, 신버전: percentiles)
  const valueKeyInputs = useMemo(() => {
    const ex = data?.explain;
    if (!ex) return "N/A";

    // NEW
    if (ex?.value?.mode === "sector_percentile" || ex?.value?.pe_percentile != null || ex?.value?.ps_percentile != null) {
      const peP = ex?.value?.pe_percentile;
      const psP = ex?.value?.ps_percentile;
      const svP = ex?.value?.sector_value_percentile;
      const peTxt = typeof peP === "number" ? `${Math.round(peP * 100)}%` : "N/A";
      const psTxt = typeof psP === "number" ? `${Math.round(psP * 100)}%` : "N/A";
      const svTxt = typeof svP === "number" ? `${Math.round(svP * 100)}%` : "N/A";
      return `PE pct: ${peTxt} / PS pct: ${psTxt} / Sector value pct: ${svTxt}`;
    }

    // OLD
    if (ex?.value?.pe_scored != null || ex?.value?.ps_scored != null) {
      return `P/E(scored): ${fmtNum(ex.value.pe_scored, 2)} / P/S(scored): ${fmtNum(ex.value.ps_scored, 2)}`;
    }

    return "N/A";
  }, [data]);

  return (
    <section className="rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-lg">Recommendation</h2>
          <p className="text-xs text-gray-500">{data?.generated_at_utc ? fmtISO(data.generated_at_utc) : ""}</p>
        </div>

        <div className="flex items-center gap-2">
          {data?.signal && (
            <span className={`text-xs px-2 py-1 rounded-full border ${badgeClass(data.signal)}`}>{data.signal}</span>
          )}
          <span
            className={`text-xs px-2 py-1 rounded-full border ${confBadgeClass(
              data?.confidence || (lowConf ? "LOW" : "HIGH")
            )}`}
            title="Confidence is based on coverage of usable signals."
          >
            {(data?.confidence || (lowConf ? "LOW" : "HIGH")) + " CONF"}
          </span>
        </div>
      </div>

      {loading && <p className="mt-3 text-sm text-gray-600">Loading recommendation...</p>}
      {err && (
        <div className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">Error: {err}</div>
      )}

      {!loading && !err && data && (
        <>
          {/* ✅ Relative one-liner + Gauge */}
          {relativeLine && (
            <div className="mt-4 rounded-lg border p-3">
              <div className="text-sm font-semibold">Relative Position</div>
              <div className="mt-1 text-sm text-gray-700">
                Sector value percentile: <span className="font-medium">{relativeLine.sectorPctTxt}</span> · S&amp;P500 avg
                score: <span className="font-medium">{relativeLine.spAvgTxt}</span> · This score percentile (S&amp;P500):{" "}
                <span className="font-medium">{relativeLine.spPctTxt}</span>
              </div>
              <div className="mt-1 text-xs text-gray-500">Snapshot as of: {relativeLine.asof}</div>

              <div className="mt-3">
                <div className="flex justify-between text-xs text-gray-500">
                  <span>Score position (S&amp;P500)</span>
                  <span>{gauge != null ? `${gauge}%` : "N/A"}</span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-gray-200 overflow-hidden">
                  <div className="h-2 bg-black" style={{ width: gauge != null ? `${gauge}%` : "0%" }} />
                </div>
              </div>
            </div>
          )}

          {/* Top cards */}
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border p-3">
              <div className="text-xs text-gray-500">Score</div>
              <div className="text-3xl font-bold">{Number.isFinite(data.score) ? data.score : "-"}</div>
              <div className="mt-1 text-xs text-gray-500">
                Norm {fmtNum(data.diagnostics?.score_norm ?? null, 0)} / Penalty {fmtNum(data.diagnostics?.penalty_factor ?? null, 2)}
              </div>
            </div>

            <div className="rounded-lg border p-3">
              <div className="text-xs text-gray-500">Valuation (Multiples)</div>
              <div className="mt-1 text-sm">
                <div>
                  <span className="text-gray-500">P/E:</span>{" "}
                  <span className="font-medium">{fmtNum(data.summary?.pe ?? null, 2)}</span>
                </div>
                <div>
                  <span className="text-gray-500">P/S:</span>{" "}
                  <span className="font-medium">{fmtNum(data.summary?.ps ?? null, 2)}</span>
                </div>
              </div>
              <div className="mt-2 text-xs text-gray-500">Sector: {data.summary?.sector || "N/A"}</div>
            </div>
          </div>

          {/* Auto summary */}
          <div className="mt-3 rounded-lg border p-3">
            <div className="text-sm font-semibold">Auto Summary</div>
            <div className="mt-1 text-sm text-gray-700">{data.summary?.auto || "N/A"}</div>
          </div>

          {/* Coverage / Used */}
          <ul className="mt-3 text-sm text-gray-700 list-disc pl-5 space-y-1">
            <li>
              Coverage:{" "}
              {data.diagnostics?.coverage != null ? `${(data.diagnostics.coverage * 100).toFixed(1)}%` : "N/A"}
            </li>
            <li>Used: {usedText}</li>
            {data.diagnostics?.base_signal && (
              <li className="text-gray-600">
                Base signal was <span className="font-medium">{data.diagnostics.base_signal}</span>
                {lowConf ? ", adjusted to WATCH due to low coverage." : "."}
              </li>
            )}
          </ul>

          {/* Explain table (구버전/신버전 모두 표시되게) */}
          {data.explain && (
            <div className="mt-4 rounded-lg border p-3">
              <div className="text-sm font-semibold">Score Breakdown</div>

              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left border-b">
                      <th className="py-2 pr-3">Component</th>
                      <th className="py-2 pr-3">Used</th>
                      <th className="py-2 pr-3">Weight</th>
                      <th className="py-2 pr-3">Key inputs</th>
                      <th className="py-2 pr-3">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b">
                      <td className="py-2 pr-3 font-medium">Growth</td>
                      <td className="py-2 pr-3">{data.explain?.growth?.used ? "Yes" : "No"}</td>
                      <td className="py-2 pr-3">{weights?.growth ?? data.explain?.growth?.weight ?? "N/A"}</td>
                      <td className="py-2 pr-3">Rev CAGR: {fmtPct(data.explain?.growth?.revenue_cagr)}</td>
                      <td className="py-2 pr-3">{data.explain?.growth?.score ?? "N/A"}</td>
                    </tr>

                    <tr className="border-b">
                      <td className="py-2 pr-3 font-medium">Margin</td>
                      <td className="py-2 pr-3">{data.explain?.margin?.used ? "Yes" : "No"}</td>
                      <td className="py-2 pr-3">{weights?.margin ?? data.explain?.margin?.weight ?? "N/A"}</td>
                      <td className="py-2 pr-3">
                        OpM: {fmtPct(data.explain?.margin?.op_margin)} / FCFM: {fmtPct(data.explain?.margin?.fcf_margin)}
                      </td>
                      <td className="py-2 pr-3">{data.explain?.margin?.score ?? "N/A"}</td>
                    </tr>

                    <tr className="border-b">
                      <td className="py-2 pr-3 font-medium">Value</td>
                      <td className="py-2 pr-3">{data.explain?.value?.used ? "Yes" : "No"}</td>
                      <td className="py-2 pr-3">{weights?.value ?? data.explain?.value?.weight ?? "N/A"}</td>
                      <td className="py-2 pr-3">{valueKeyInputs}</td>
                      <td className="py-2 pr-3">{data.explain?.value?.score ?? "N/A"}</td>
                    </tr>

                    {/* ✅ Risk row (신버전에서만 의미 있음) */}
                    {"risk" in (data.explain || {}) && (
                      <tr className="border-b">
                        <td className="py-2 pr-3 font-medium">Risk</td>
                        <td className="py-2 pr-3">{data.explain?.risk?.used ? "Yes" : "No"}</td>
                        <td className="py-2 pr-3">{weights?.risk ?? "20"}</td>
                        <td className="py-2 pr-3">
                          Vol20: {fmtPct(data.explain?.risk?.vol_20d)} / MDD90: {fmtPct(data.explain?.risk?.mdd_90d)}
                        </td>
                        <td className="py-2 pr-3">{data.explain?.risk?.score ?? "N/A"}</td>
                      </tr>
                    )}

                    <tr>
                      <td className="py-2 pr-3 font-medium">Coverage</td>
                      <td className="py-2 pr-3">—</td>
                      <td className="py-2 pr-3">{data.explain?.coverage?.used_total_weight ?? "N/A"}</td>
                      <td className="py-2 pr-3">
                        Cov:{" "}
                        {data.explain?.coverage?.coverage != null
                          ? `${(data.explain.coverage.coverage * 100).toFixed(1)}%`
                          : "N/A"}{" "}
                        / Penalty: {fmtNum(data.explain?.coverage?.penalty_factor ?? null, 2)}
                        {" / "}Norm: {data.explain?.coverage?.score_norm ?? "N/A"}
                      </td>
                      <td className="py-2 pr-3">
                        Raw: {data.explain?.coverage?.raw_total ?? data.explain?.coverage?.score_norm ?? "N/A"}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Warnings */}
          {data.warnings && data.warnings.length > 0 && (
            <div className="mt-4 rounded-lg border p-3">
              <div className="text-sm font-semibold">Warnings</div>
              <ul className="mt-2 text-sm text-gray-700 list-disc pl-5 space-y-1">
                {data.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}