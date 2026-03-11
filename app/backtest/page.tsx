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
} from "recharts";

export default function BacktestPage() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    fetch("/data/backtest_result.json")
      .then((r) => r.json())
      .then(setData);
  }, []);

  if (!data) return <div>Loading...</div>;

  const m = data.metrics;
  const b = data.benchmark.metrics;

  return (
    <div style={{ padding: 40 }}>
      <h1>Strategy Backtest</h1>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4,1fr)",
          gap: 20,
          marginBottom: 30,
        }}
      >
        <div>CAGR {(m.cagr * 100).toFixed(1)}%</div>
        <div>Sharpe {m.sharpe.toFixed(2)}</div>
        <div>MDD {(m.max_drawdown * 100).toFixed(1)}%</div>
        <div>Vol {(m.volatility * 100).toFixed(1)}%</div>
      </div>

      <h2>Benchmark (SPY)</h2>

      <div style={{ marginBottom: 40 }}>
        CAGR {(b.cagr * 100).toFixed(1)}%
      </div>

      <ResponsiveContainer width="100%" height={400}>
        <LineChart>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" />
          <YAxis />
          <Tooltip />
          <Line type="monotone" dataKey="equity" stroke="#8884d8" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}