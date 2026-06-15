"use client";

import { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";

type DailyRecord = {
  date: string;
  equity: number;
  daily_return: number;
  drawdown: number;
  benchmark: number;
  regime: string;
  stock_exposure: number;
};

type Summary = {
  total_return: number;
  days: number;
  cagr: number | null;
  sharpe: number | null;
  mdd: number;
  last_date: string;
  last_equity: number;
};

type LiveData = {
  generated_at: string;
  live_start: string;
  strategy_label: string;
  summary: Summary;
  current_portfolio: Record<string, number>;
  regime_bucket: string;
  stock_exposure: number;
  daily: DailyRecord[];
};

function pct(v: number | null | undefined) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${(v * 100).toFixed(2)}%`;
}

function fmt(v: number | null | undefined, digits = 2) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toFixed(digits);
}

const REGIME_COLOR: Record<string, string> = {
  risk_on: "bg-green-100 text-green-800",
  mid: "bg-yellow-100 text-yellow-800",
  risk_off: "bg-red-100 text-red-800",
  live: "bg-blue-100 text-blue-800",
};

export default function LivePage() {
  const [data, setData] = useState<LiveData | null>(null);

  useEffect(() => {
    fetch("/data/live_performance.json")
      .then((r) => r.json())
      .then(setData)
      .catch(console.error);
  }, []);

  if (!data) {
    return (
      <main className="mx-auto max-w-4xl p-8">
        <p className="text-gray-500">Loading live performance…</p>
      </main>
    );
  }

  const { summary, current_portfolio, regime_bucket, stock_exposure, daily } = data;

  // 차트용 데이터: equity 1.0 기준 → % 수익률로 변환
  const chartData = daily.map((d) => ({
    date: d.date.slice(5),         // MM-DD
    전략: +((d.equity - 1) * 100).toFixed(2),
    SPY: +((d.benchmark - 1) * 100).toFixed(2),
  }));

  // 포트폴리오 정렬 (비중 내림차순)
  const holdings = Object.entries(current_portfolio)
    .sort((a, b) => b[1] - a[1]);

  const regimeBadge = REGIME_COLOR[regime_bucket] ?? "bg-gray-100 text-gray-800";

  return (
    <main className="mx-auto max-w-4xl p-8 space-y-8">
      {/* 헤더 */}
      <div>
        <h1 className="text-3xl font-bold">라이브 성과 추적</h1>
        <p className="text-gray-500 mt-1 text-sm">
          {data.live_start} 전략 시작 · 마지막 업데이트: {summary.last_date}
        </p>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "누적 수익률", value: pct(summary.total_return), color: summary.total_return >= 0 ? "text-green-600" : "text-red-500" },
          { label: "Sharpe", value: fmt(summary.sharpe), color: "text-blue-600" },
          { label: "CAGR(연환산)", value: pct(summary.cagr), color: "text-indigo-600" },
          { label: "MDD", value: pct(summary.mdd), color: "text-red-500" },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-xl border p-4 shadow-sm bg-white">
            <p className="text-xs text-gray-500">{label}</p>
            <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* 레짐 상태 */}
      <div className="flex items-center gap-3 text-sm">
        <span className="text-gray-500">현재 레짐:</span>
        <span className={`px-2 py-0.5 rounded-full font-medium ${regimeBadge}`}>
          {regime_bucket}
        </span>
        <span className="text-gray-500 ml-4">주식 노출:</span>
        <span className="font-semibold">{pct(stock_exposure)}</span>
        <span className="text-gray-400 ml-4 text-xs">{summary.days}거래일</span>
      </div>

      {/* 에쿼티 차트 */}
      <div className="rounded-xl border p-6 bg-white shadow-sm">
        <h2 className="text-lg font-semibold mb-4">누적 수익률 vs SPY (%)</h2>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis
              tickFormatter={(v) => `${v}%`}
              tick={{ fontSize: 11 }}
              domain={["auto", "auto"]}
            />
            <Tooltip formatter={(v) => [`${Number(v).toFixed(2)}%`]} />
            <Legend />
            <Line
              type="monotone"
              dataKey="전략"
              stroke="#4f46e5"
              strokeWidth={2}
              dot={{ r: 4 }}
              activeDot={{ r: 6 }}
            />
            <Line
              type="monotone"
              dataKey="SPY"
              stroke="#94a3b8"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* 포트폴리오 비중 */}
      <div className="rounded-xl border p-6 bg-white shadow-sm">
        <h2 className="text-lg font-semibold mb-1">현재 포트폴리오 구성</h2>
        <p className="text-xs text-gray-400 mb-4">
          {holdings.length}개 종목 · 리밸런싱 기준: 월 1회
        </p>

        <div className="space-y-2">
          {holdings.map(([ticker, weight]) => {
            const barPct = (weight * 100).toFixed(1);
            return (
              <div key={ticker} className="flex items-center gap-3">
                <span className="w-14 text-sm font-mono font-semibold text-gray-800">
                  {ticker}
                </span>
                <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                  <div
                    className="h-4 rounded-full bg-indigo-500"
                    style={{ width: `${Math.min(weight * 100 * 6, 100)}%` }}
                  />
                </div>
                <span className="w-12 text-right text-sm text-gray-600">
                  {barPct}%
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 일별 수익률 테이블 */}
      <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
        <h2 className="text-lg font-semibold p-6 pb-3">일별 수익률</h2>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs">
            <tr>
              {["날짜", "전략 equity", "일수익률", "드로우다운", "SPY equity", "레짐"].map(
                (h) => (
                  <th key={h} className="px-4 py-2 text-right first:text-left">
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {[...daily].reverse().map((d) => (
              <tr key={d.date} className="hover:bg-gray-50">
                <td className="px-4 py-2 font-mono text-gray-700">{d.date}</td>
                <td className="px-4 py-2 text-right">{d.equity.toFixed(4)}</td>
                <td
                  className={`px-4 py-2 text-right font-medium ${
                    d.daily_return >= 0 ? "text-green-600" : "text-red-500"
                  }`}
                >
                  {d.daily_return >= 0 ? "+" : ""}
                  {pct(d.daily_return)}
                </td>
                <td className="px-4 py-2 text-right text-red-500">
                  {pct(d.drawdown)}
                </td>
                <td className="px-4 py-2 text-right text-gray-500">
                  {d.benchmark.toFixed(4)}
                </td>
                <td className="px-4 py-2 text-right">
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs ${
                      REGIME_COLOR[d.regime] ?? "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {d.regime}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-400 text-right">
        데이터 생성: {new Date(data.generated_at).toLocaleString("ko-KR")}
      </p>
    </main>
  );
}
