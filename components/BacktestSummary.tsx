"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export default function BacktestSummary() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    fetch("/data/backtest_result.json")
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  if (!data) return null;

  const m = data.metrics;

  return (
    <div className="border rounded-xl p-5 bg-white shadow-sm">
      <h2 className="text-xl font-semibold mb-3">Strategy Backtest (3Y)</h2>

      <div className="grid grid-cols-3 gap-4 text-sm mb-4">
        <div>
          <div className="text-gray-500">CAGR</div>
          <div className="font-semibold">
            {(m.cagr * 100).toFixed(1)}%
          </div>
        </div>

        <div>
          <div className="text-gray-500">Sharpe</div>
          <div className="font-semibold">{m.sharpe.toFixed(2)}</div>
        </div>

        <div>
          <div className="text-gray-500">Max Drawdown</div>
          <div className="font-semibold">
            {(m.max_drawdown * 100).toFixed(1)}%
          </div>
        </div>
      </div>

      <Link
        href="/backtest"
        className="text-sm text-blue-600 hover:underline"
      >
        View Full Backtest →
      </Link>
    </div>
  );
}