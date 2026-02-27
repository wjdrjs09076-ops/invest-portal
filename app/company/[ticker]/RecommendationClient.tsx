"use client";

import { useEffect, useMemo, useState } from "react";

type RecommendationResponse = {
  ticker: string;
  generated_at_utc: string;

  signal: "BUY" | "WATCH" | "HOLD" | "AVOID";
  score: number;
  confidence?: "HIGH" | "MED" | "LOW";

  source?: {
    financials_generated_at_utc?: string;
    financials_note?: string;
    multiples_source?: string;
  };

  diagnostics?: {
    score_norm?: number;
    coverage?: number; // 0~1
    penalty_factor?: number;
    low_conf?: boolean;
    base_signal?: string;
    note?: string;
  };

  summary?: {
    revenue_cagr?: number | null;
    op_margin?: number | null;
    fcf_margin?: number | null;
    fcf_trend?: "UP" | "DOWN" | "FLAT" | "N/A";
    pe?: number | null;
    ps?: number | null;
    auto?: string;
  };

  explain?: {
    growth: {
      used: boolean;
      weight: number;
      revenue_cagr: number | null;
      score: number;
    };
    margin: {
      used: boolean;
      weight: number;
      op_margin: number | null;
      fcf_margin: number | null;
      score: number;
    };
    value: {
      used: boolean;
      weight: number;
      pe_scored: number | null;
      ps_scored: number | null;
      score: number;
    };
    coverage: {
      used_total_weight: number;
      coverage: number; // 0~1
      penalty_factor: number;
      score_norm: number;
      raw_total: number;
    };
  };

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
  // 표시용: 너무 길면 줄임
  return iso.replace("T", " ").replace("Z", "Z");
}

function badgeClass(kind: string) {
  // 최소한의 스타일 분기
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
        const res = await fetch(`/api/recommendation?ticker=${encodeURIComponent(ticker)}`, {
          cache: "no-store",
        });
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

  const usedText = useMemo(() => {
    const ex = data?.explain;
    if (!ex) return "N/A";
    const used: string[] = [];
    if (ex.growth.used) used.push("Growth");
    if (ex.margin.used) used.push("Margin");
    if (ex.value.used) used.push("Value");
    return used.length ? used.join(", ") : "(none)";
  }, [data]);

  const lowConf = data?.diagnostics?.low_conf ?? (data?.confidence ? data.confidence !== "HIGH" : false);

  return (
    <section className="rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-lg">Recommendation</h2>
          <p className="text-xs text-gray-500">{data?.generated_at_utc ? fmtISO(data.generated_at_utc) : ""}</p>
        </div>

        <div className="flex items-center gap-2">
          {data?.signal && (
            <span className={`text-xs px-2 py-1 rounded-full border ${badgeClass(data.signal)}`}>
              {data.signal}
            </span>
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

      {/* Loading / Error */}
      {loading && <p className="mt-3 text-sm text-gray-600">Loading recommendation...</p>}
      {err && (
        <div className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          Error: {err}
        </div>
      )}

      {!loading && !err && data && (
        <>
          {/* Top cards */}
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border p-3">
              <div className="text-xs text-gray-500">Score</div>
              <div className="text-3xl font-bold">{Number.isFinite(data.score) ? data.score : "-"}</div>
              <div className="mt-1 text-xs text-gray-500">
                Norm {fmtNum(data.diagnostics?.score_norm ?? null, 0)} / Penalty{" "}
                {fmtNum(data.diagnostics?.penalty_factor ?? null, 2)}
              </div>
            </div>

            <div className="rounded-lg border p-3">
              <div className="text-xs text-gray-500">Valuation (Multiples)</div>
              <div className="mt-1 text-sm">
                <div>
                  <span className="text-gray-500">P/E:</span> <span className="font-medium">{fmtNum(data.summary?.pe ?? null, 2)}</span>
                </div>
                <div>
                  <span className="text-gray-500">P/S:</span> <span className="font-medium">{fmtNum(data.summary?.ps ?? null, 2)}</span>
                </div>
              </div>
              <div className="mt-2 text-xs text-gray-500">Source: {data.source?.multiples_source || "N/A"}</div>
            </div>
          </div>

          {/* Auto summary */}
          <div className="mt-3 rounded-lg border p-3">
            <div className="text-sm font-semibold">Auto Summary</div>
            <div className="mt-1 text-sm text-gray-700">{data.summary?.auto || "N/A"}</div>
          </div>

          {/* Coverage / Used */}
          <ul className="mt-3 text-sm text-gray-700 list-disc pl-5 space-y-1">
            <li>Coverage: {data.diagnostics?.coverage != null ? `${(data.diagnostics.coverage * 100).toFixed(1)}%` : "N/A"}</li>
            <li>Used: {usedText}</li>
            {data.diagnostics?.base_signal && (
              <li className="text-gray-600">
                Base signal was <span className="font-medium">{data.diagnostics.base_signal}</span>
                {lowConf ? ", adjusted to WATCH due to low coverage." : "."}
              </li>
            )}
          </ul>

          {/* Explain table */}
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
                      <td className="py-2 pr-3">{data.explain.growth.used ? "Yes" : "No"}</td>
                      <td className="py-2 pr-3">{data.explain.growth.weight}</td>
                      <td className="py-2 pr-3">Rev CAGR: {fmtPct(data.explain.growth.revenue_cagr)}</td>
                      <td className="py-2 pr-3">{data.explain.growth.score}</td>
                    </tr>

                    <tr className="border-b">
                      <td className="py-2 pr-3 font-medium">Margin</td>
                      <td className="py-2 pr-3">{data.explain.margin.used ? "Yes" : "No"}</td>
                      <td className="py-2 pr-3">{data.explain.margin.weight}</td>
                      <td className="py-2 pr-3">
                        OpM: {fmtPct(data.explain.margin.op_margin)} / FCFM: {fmtPct(data.explain.margin.fcf_margin)}
                      </td>
                      <td className="py-2 pr-3">{data.explain.margin.score}</td>
                    </tr>

                    <tr className="border-b">
                      <td className="py-2 pr-3 font-medium">Value</td>
                      <td className="py-2 pr-3">{data.explain.value.used ? "Yes" : "No"}</td>
                      <td className="py-2 pr-3">{data.explain.value.weight}</td>
                      <td className="py-2 pr-3">
                        P/E(scored): {fmtNum(data.explain.value.pe_scored ?? null, 2)} / P/S(scored):{" "}
                        {fmtNum(data.explain.value.ps_scored ?? null, 2)}
                      </td>
                      <td className="py-2 pr-3">{data.explain.value.score}</td>
                    </tr>

                    <tr>
                      <td className="py-2 pr-3 font-medium">Coverage</td>
                      <td className="py-2 pr-3">—</td>
                      <td className="py-2 pr-3">{data.explain.coverage.used_total_weight}</td>
                      <td className="py-2 pr-3">
                        Cov: {(data.explain.coverage.coverage * 100).toFixed(1)}% / Penalty:{" "}
                        {fmtNum(data.explain.coverage.penalty_factor, 2)}
                        {" / "}Norm: {data.explain.coverage.score_norm}
                      </td>
                      <td className="py-2 pr-3">Raw: {data.explain.coverage.raw_total}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Source / AsOf */}
          <div className="mt-4 rounded-lg border p-3">
            <div className="text-sm font-semibold">Data Source / As Of</div>
            <div className="mt-2 text-sm text-gray-700 space-y-1">
              <div>
                <span className="text-gray-500">Financials as of:</span>{" "}
                <span className="font-medium">{data.source?.financials_generated_at_utc ? fmtISO(data.source.financials_generated_at_utc) : "N/A"}</span>
              </div>
              <div>
                <span className="text-gray-500">Financials note:</span>{" "}
                <span className="font-medium">{data.source?.financials_note || "N/A"}</span>
              </div>
              <div>
                <span className="text-gray-500">Confidence:</span>{" "}
                <span className="font-medium">{data.confidence || (lowConf ? "LOW" : "HIGH")}</span>
              </div>
            </div>
          </div>

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