"use client";

import { useEffect, useMemo, useState } from "react";

type Row = {
  year: number;
  revenue: number | null;
  opIncome: number | null;
  fcf: number | null;
};

type Payload = {
  ticker: string;
  generated_at_utc: string;
  rows: Row[];
  multiples?: { pe: number | null; ps: number | null };
};

function isNum(x: any): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function fmtUSD(x: number | null) {
  if (!isNum(x)) return "N/A";
  const abs = Math.abs(x);
  const sign = x < 0 ? "-" : "";
  const v = Math.abs(x);

  if (abs >= 1e12) return `${sign}$${(v / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}$${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(v / 1e3).toFixed(1)}K`;
  return `${sign}$${v.toFixed(0)}`;
}

function fmtPct(x: number | null, digits = 1) {
  if (!isNum(x)) return "N/A";
  return `${(x * 100).toFixed(digits)}%`;
}

function yoy(curr: number | null, prev: number | null): number | null {
  if (!isNum(curr) || !isNum(prev) || prev === 0) return null;
  return curr / prev - 1;
}

function margin(numer: number | null, denom: number | null): number | null {
  if (!isNum(numer) || !isNum(denom) || denom === 0) return null;
  return numer / denom;
}

// 간단한 품질 점수(표시용): 값이 몇 개 채워졌는지
function completenessScore(r: Row) {
  const keys: (keyof Row)[] = ["revenue", "opIncome", "fcf"];
  const filled = keys.reduce((a, k) => a + (isNum(r[k]) ? 1 : 0), 0);
  return { filled, total: keys.length };
}

function badgeTone(filled: number) {
  // 3개면 good, 2개면 ok, 0~1이면 low
  if (filled >= 3) return "bg-green-50 text-green-700 border-green-200";
  if (filled >= 2) return "bg-yellow-50 text-yellow-700 border-yellow-200";
  return "bg-gray-50 text-gray-700 border-gray-200";
}

export default function FinancialsClient({ ticker }: { ticker: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setErr(null);

    fetch(`/api/financials?ticker=${encodeURIComponent(ticker)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j) => {
        if (!alive) return;
        setData(j);
      })
      .catch((e) => {
        if (!alive) return;
        setErr(String(e?.message || e));
      });

    return () => {
      alive = false;
    };
  }, [ticker]);

  const table = useMemo(() => {
    const rows = data?.rows || [];
    // 최신 -> 과거 정렬되어 있다고 가정, 안전하게 다시 정렬
    const sorted = [...rows].sort((a, b) => b.year - a.year);

    // YoY/마진은 "바로 전 연도"가 있을 때만 계산
    return sorted.map((r, idx) => {
      const prev = sorted[idx + 1] || null;

      const revY = prev ? yoy(r.revenue, prev.revenue) : null;
      const fcfY = prev ? yoy(r.fcf, prev.fcf) : null;

      const opm = margin(r.opIncome, r.revenue);
      const fcfm = margin(r.fcf, r.revenue);

      const { filled, total } = completenessScore(r);

      return { ...r, revY, fcfY, opm, fcfm, filled, total };
    });
  }, [data]);

  return (
    <section className="rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Financials (Last 3 Years)</h2>
          <p className="text-xs text-gray-500 mt-1">
            Source: Finnhub. Some fields may be unavailable depending on the filing format.
          </p>
        </div>
        <div className="text-xs text-gray-500">
          {data?.generated_at_utc ? data.generated_at_utc : ""}
        </div>
      </div>

      {err && (
        <div className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          Error: {err}
        </div>
      )}

      {!err && !data && (
        <div className="mt-3 text-sm text-gray-500">Loading...</div>
      )}

      {!err && data && (
        <>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-2 text-left font-semibold">Year</th>
                  <th className="py-2 text-right font-semibold">Revenue</th>
                  <th className="py-2 text-right font-semibold">Op Income</th>
                  <th className="py-2 text-right font-semibold">FCF</th>
                  <th className="py-2 text-right font-semibold">Rev YoY</th>
                  <th className="py-2 text-right font-semibold">FCF YoY</th>
                  <th className="py-2 text-right font-semibold">Op Margin</th>
                  <th className="py-2 text-right font-semibold">FCF Margin</th>
                  <th className="py-2 text-right font-semibold">Data</th>
                </tr>
              </thead>
              <tbody>
                {table.length === 0 && (
                  <tr>
                    <td className="py-3 text-gray-500" colSpan={9}>
                      No financial rows found.
                    </td>
                  </tr>
                )}

                {table.map((r) => (
                  <tr key={r.year} className="border-b last:border-b-0">
                    <td className="py-2 font-medium">{r.year}</td>

                    <td className="py-2 text-right tabular-nums">
                      {fmtUSD(r.revenue)}
                    </td>

                    <td className="py-2 text-right tabular-nums">
                      {fmtUSD(r.opIncome)}
                    </td>

                    <td className="py-2 text-right tabular-nums">
                      {fmtUSD(r.fcf)}
                    </td>

                    <td className="py-2 text-right tabular-nums">
                      {fmtPct(r.revY)}
                    </td>

                    <td className="py-2 text-right tabular-nums">
                      {fmtPct(r.fcfY)}
                    </td>

                    <td className="py-2 text-right tabular-nums">
                      {fmtPct(r.opm)}
                    </td>

                    <td className="py-2 text-right tabular-nums">
                      {fmtPct(r.fcfm)}
                    </td>

                    <td className="py-2 text-right">
                      <span
                        className={[
                          "inline-flex items-center rounded-full border px-2 py-0.5 text-xs",
                          badgeTone(r.filled),
                        ].join(" ")}
                        title="How many of (Revenue/OpIncome/FCF) were available"
                      >
                        {r.filled}/{r.total}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 border-t pt-3 space-y-2">
            <div className="text-sm font-medium">Multiples (TTM)</div>
            <div className="text-sm text-gray-700">
              <div>P/E: {isNum(data?.multiples?.pe) ? data!.multiples!.pe!.toFixed(2) : "N/A"}</div>
              <div>P/S: {isNum(data?.multiples?.ps) ? data!.multiples!.ps!.toFixed(2) : "N/A"}</div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}