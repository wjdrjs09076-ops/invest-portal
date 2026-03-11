"use client";

import { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  Legend,
  BarChart,
  Bar,
} from "recharts";

type BacktestSummary = {
  metrics: {
    cagr: number;
    sharpe: number;
    max_drawdown: number;
    volatility: number;
  };
  benchmark: {
    ticker: string;
    metrics: {
      cagr: number;
      max_drawdown: number;
    };
  };
};

type CurvePoint = {
  date: string;
  strategy: number;
  benchmark: number;
};

type ScoreCorrelationRow = {
  quantile: string;
  avg_return: number;
  median_return: number;
  count: number;
  avg_score: number;
};

type ScoreCorrelation = {
  forward_days: number;
  data: ScoreCorrelationRow[];
};

export default function BacktestPage() {
  const [curve, setCurve] = useState<CurvePoint[]>([]);
  const [summary, setSummary] = useState<BacktestSummary | null>(null);
  const [scoreCorr, setScoreCorr] = useState<ScoreCorrelation | null>(null);

  useEffect(() => {
    fetch("/data/backtest_result.json")
      .then((r) => r.json())
      .then((data) => setSummary(data))
      .catch(() => {});

    fetch("/data/equity_curve.json")
      .then((r) => r.json())
      .then((data) => setCurve(data))
      .catch(() => {});

    fetch("/data/score_correlation.json")
      .then((r) => r.json())
      .then((data) => setScoreCorr(data))
      .catch(() => {});
  }, []);

  if (!summary) {
    return <div style={{ padding: 40 }}>Loading...</div>;
  }

  const m = summary.metrics;
  const b = summary.benchmark.metrics;

  const corrChartData =
    scoreCorr?.data?.map((x) => ({
      quantile: x.quantile,
      avg_return_pct: x.avg_return * 100,
      median_return_pct: x.median_return * 100,
      count: x.count,
      avg_score: x.avg_score,
    })) ?? [];

  return (
    <div style={{ padding: 40, maxWidth: 1200, margin: "0 auto" }}>
      <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 24 }}>
        Strategy Backtest
      </h1>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 20,
          marginBottom: 24,
        }}
      >
        <div>
          <div style={{ color: "#666" }}>CAGR</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>
            {(m.cagr * 100).toFixed(1)}%
          </div>
        </div>

        <div>
          <div style={{ color: "#666" }}>Sharpe</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>
            {m.sharpe.toFixed(2)}
          </div>
        </div>

        <div>
          <div style={{ color: "#666" }}>Max Drawdown</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>
            {(m.max_drawdown * 100).toFixed(1)}%
          </div>
        </div>

        <div>
          <div style={{ color: "#666" }}>Volatility</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>
            {(m.volatility * 100).toFixed(1)}%
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 32, color: "#444" }}>
        Benchmark ({summary.benchmark.ticker}) CAGR{" "}
        <strong>{(b.cagr * 100).toFixed(1)}%</strong>, MDD{" "}
        <strong>{(b.max_drawdown * 100).toFixed(1)}%</strong>
      </div>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 16,
          padding: 20,
          background: "#fff",
          marginBottom: 28,
        }}
      >
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>
          Strategy vs SPY
        </h2>

        <ResponsiveContainer width="100%" height={420}>
          <LineChart data={curve}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" minTickGap={40} />
            <YAxis domain={["auto", "auto"]} />
            <Tooltip />
            <Legend />
            <Line
              type="monotone"
              dataKey="strategy"
              name="Strategy"
              stroke="#2563eb"
              dot={false}
              strokeWidth={2}
            />
            <Line
              type="monotone"
              dataKey="benchmark"
              name="SPY"
              stroke="#16a34a"
              dot={false}
              strokeWidth={2}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 16,
          padding: 20,
          background: "#fff",
        }}
      >
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
          Score to Future Return Correlation
        </h2>

        <div style={{ color: "#666", marginBottom: 16 }}>
          Higher score buckets should ideally show higher forward returns over{" "}
          <strong>{scoreCorr?.forward_days ?? 20} trading days</strong>.
        </div>

        <ResponsiveContainer width="100%" height={360}>
          <BarChart data={corrChartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="quantile" />
            <YAxis tickFormatter={(value) => `${Number(value).toFixed(1)}%`} />
            <Tooltip
              formatter={(value) => `${Number(value).toFixed(2)}%`}
            />
            <Legend />
            <Bar
              dataKey="avg_return_pct"
              name="Avg Forward Return"
              fill="#7c3aed"
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}