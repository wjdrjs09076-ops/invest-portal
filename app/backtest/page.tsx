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
} from "recharts";

export default function BacktestPage() {
  const [curve, setCurve] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);

  useEffect(() => {
    fetch("/data/backtest_result.json")
      .then((r) => r.json())
      .then(setSummary);

    fetch("/data/equity_curve.json")
      .then((r) => r.json())
      .then(setCurve);
  }, []);

  if (!summary) return <div style={{ padding: 40 }}>Loading...</div>;

  const m = summary.metrics;
  const b = summary.benchmark.metrics;

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
    </div>
  );
}