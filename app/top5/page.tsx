"use client";

import { useEffect, useState } from "react";
import {
  ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend,
} from "recharts";

type DailyRecord = {
  date: string;
  equity: number;
  daily_return: number;
  drawdown: number;
  benchmark: number;
};

type Summary = {
  total_return: number;
  days: number;
  cagr: number | null;
  sharpe: number | null;
  mdd: number;
  last_date: string | null;
  last_equity: number;
};

type StratData = {
  generated_at: string;
  live_start: string;
  strategy_label: string;
  note?: string;
  summary: Summary;
  current_portfolio: Record<string, number>;
  daily: DailyRecord[];
};

function pct(v: number | null | undefined) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${(v * 100).toFixed(2)}%`;
}

export default function Top5Page() {
  const [data, setData] = useState<StratData | null>(null);

  useEffect(() => {
    fetch("/data/strategy_topn.json")
      .then((r) => r.json())
      .then(setData)
      .catch(console.error);
  }, []);

  if (!data) {
    return (
      <main className="mx-auto max-w-4xl p-8">
        <p className="text-gray-500">Loading strategy…</p>
      </main>
    );
  }

  const { summary, current_portfolio, daily } = data;
  const spyRet = daily.length ? daily[daily.length - 1].benchmark - 1 : 0;
  const excess = summary.total_return - spyRet;

  const chartData = daily.map((d) => ({
    date: d.date.slice(5),
    "Top-5": +((d.equity - 1) * 100).toFixed(2),
    SPY: +((d.benchmark - 1) * 100).toFixed(2),
  }));

  const holdings = Object.entries(current_portfolio).sort((a, b) => b[1] - a[1]);

  return (
    <main className="mx-auto max-w-4xl p-8 space-y-8">
      {/* 헤더 */}
      <div>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-3xl font-bold">⚡ 모멘텀 Top-5</h1>
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
            시뮬레이션 (노셔널) · Alpaca 실계좌 아님
          </span>
        </div>
        <p className="text-gray-500 mt-1 text-sm">
          S&P500 점수 상위 5종목 동일가중 · 3거래일 확정 · {data.live_start} 시작
          {summary.last_date ? ` · 최근 ${summary.last_date}` : ""}
        </p>
        <p className="text-gray-400 mt-1 text-xs">
          /live(복잡 14종목 Alpaca 실계좌)와 별개 전략입니다. 매일 마감 후 2026-01-01부터 재시뮬.
        </p>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "누적 수익률", value: pct(summary.total_return), color: summary.total_return >= 0 ? "text-emerald-600" : "text-red-500" },
          { label: "SPY 대비 초과", value: pct(excess), color: excess >= 0 ? "text-emerald-600" : "text-red-500" },
          { label: "최대 낙폭(MDD)", value: pct(summary.mdd), color: "text-red-500" },
          { label: "거래일수", value: String(summary.days), color: "text-gray-700" },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-xl border p-4 shadow-sm bg-white">
            <p className="text-xs text-gray-500">{label}</p>
            <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-500">
        SPY 같은 구간 {pct(spyRet)} · 연환산 지표는 1년 누적 후 표시(현재 표본 부족).
      </p>

      {/* 에쿼티 차트 */}
      <div className="rounded-xl border p-6 bg-white shadow-sm">
        <h2 className="text-lg font-semibold mb-4">누적 수익률 vs SPY (%)</h2>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={24} />
            <YAxis tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} domain={["auto", "auto"]} />
            <Tooltip formatter={(v) => [`${Number(v).toFixed(1)}%`]} />
            <Legend />
            <Line type="monotone" dataKey="Top-5" stroke="#059669" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="SPY" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* 현재 보유 */}
      <div className="rounded-xl border p-6 bg-white shadow-sm">
        <h2 className="text-lg font-semibold mb-1">현재 보유 (Top-5 동일가중)</h2>
        <p className="text-xs text-gray-400 mb-4">{holdings.length}개 종목 · 각 {holdings.length ? (100 / holdings.length).toFixed(0) : 0}%</p>
        <div className="flex flex-wrap gap-2">
          {holdings.map(([ticker]) => (
            <span key={ticker} className="px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-800 font-mono font-semibold text-sm border border-emerald-200">
              {ticker}
            </span>
          ))}
        </div>
      </div>

      {/* 일별 테이블 */}
      <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
        <h2 className="text-lg font-semibold p-6 pb-3">일별 (최근 30)</h2>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs">
            <tr>
              {["날짜", "전략 equity", "일수익률", "드로우다운", "SPY equity"].map((h) => (
                <th key={h} className="px-4 py-2 text-right first:text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {[...daily].reverse().slice(0, 30).map((d) => (
              <tr key={d.date} className="hover:bg-gray-50">
                <td className="px-4 py-2 font-mono text-gray-700">{d.date}</td>
                <td className="px-4 py-2 text-right">{d.equity.toFixed(4)}</td>
                <td className={`px-4 py-2 text-right font-medium ${d.daily_return >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                  {d.daily_return >= 0 ? "+" : ""}{pct(d.daily_return)}
                </td>
                <td className="px-4 py-2 text-right text-red-500">{pct(d.drawdown)}</td>
                <td className="px-4 py-2 text-right text-gray-500">{d.benchmark.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-400 text-right">
        데이터 생성: {new Date(data.generated_at).toLocaleString("ko-KR")} · 노셔널 시뮬레이션
      </p>
    </main>
  );
}
