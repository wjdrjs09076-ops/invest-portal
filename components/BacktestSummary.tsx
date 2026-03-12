"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Metrics = {
  cagr?: number;
  sharpe?: number;
  max_drawdown?: number;
};

type SubPeriod = {
  label: string;
  metrics: Metrics;
};

type BacktestSummaryData = {
  metrics?: Metrics;
  subperiods?: SubPeriod[];
  strategy?: {
    regime_filter?: {
      ma_window?: number;
      risk_on_exposure?: number;
      risk_off_exposure?: number;
    };
  };
};

export default function BacktestSummary() {
  const [data, setData] = useState<BacktestSummaryData | null>(null);

  useEffect(() => {
    fetch("/data/backtest_regime_result.json")
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  if (!data?.metrics) return null;

  const m = data.subperiods?.find((p) => p.label === "3y")?.metrics ?? data.metrics;
  const regime = data.strategy?.regime_filter;

  return (
    <div className="border rounded-xl p-6 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-2xl font-semibold">Recommended Strategy (3Y)</h2>
          <p className="text-sm text-gray-500 mt-1">
            Regime-filtered production model
          </p>
        </div>

        {regime && (
          <div className="text-xs text-gray-500 text-right">
            <div>SPY {regime.ma_window}DMA filter</div>
            <div>
              Risk-off exposure {((regime.risk_off_exposure ?? 0) * 100).toFixed(0)}%
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4 text-sm mb-4">
        <div>
          <div className="text-gray-500">CAGR</div>
          <div className="font-semibold text-2xl">
            {((m.cagr ?? 0) * 100).toFixed(1)}%
          </div>
        </div>

        <div>
          <div className="text-gray-500">Sharpe</div>
          <div className="font-semibold text-2xl">
            {(m.sharpe ?? 0).toFixed(2)}
          </div>
        </div>

        <div>
          <div className="text-gray-500">Max Drawdown</div>
          <div className="font-semibold text-2xl">
            {((m.max_drawdown ?? 0) * 100).toFixed(1)}%
          </div>
        </div>
      </div>

      <Link href="/backtest" className="text-sm text-blue-600 hover:underline">
        Compare 3Y / 5Y / 10Y →
      </Link>
    </div>
  );
}