"use client";

import { useEffect, useState } from "react";

type BacktestJson = {
  metrics?: {
    cagr?: number;
    sharpe?: number;
    max_drawdown?: number;
    total_return?: number;
  };
};

type ScoreCorrelationRow = {
  quantile: string;
  avg_return: number;
  median_return?: number;
  count?: number;
  avg_score?: number;
};

type ScoreCorrelationJson = {
  data?: ScoreCorrelationRow[];
};

type TopNResult = {
  top_n: number;
  metrics: {
    cagr: number;
    sharpe: number;
    max_drawdown?: number;
  };
};

type TopNJson = {
  results?: TopNResult[];
};

type SectorExposureRow = {
  sector: string;
  weight: number;
};

type SectorExposureJson = {
  avg_sector_exposure?: SectorExposureRow[];
};

export default function StrategyPage() {
  const [backtest, setBacktest] = useState<BacktestJson | null>(null);
  const [corr, setCorr] = useState<ScoreCorrelationJson | null>(null);
  const [topn, setTopn] = useState<TopNJson | null>(null);
  const [sector, setSector] = useState<SectorExposureJson | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [b, c, t, s] = await Promise.all([
          fetch("/data/backtest_result.json").then((r) => r.json()),
          fetch("/data/score_correlation.json").then((r) => r.json()),
          fetch("/data/topn_sensitivity.json").then((r) => r.json()),
          fetch("/data/sector_exposure.json").then((r) => r.json()),
        ]);

        setBacktest(b);
        setCorr(c);
        setTopn(t);
        setSector(s);
      } catch (e) {
        setError("Failed to load strategy data.");
        console.error(e);
      }
    }

    load();
  }, []);

  if (error) {
    return <main className="mx-auto max-w-5xl p-8">{error}</main>;
  }

  return (
    <main className="mx-auto max-w-5xl p-8 space-y-10">
      <h1 className="text-3xl font-bold">Strategy Lab</h1>

      {backtest?.metrics && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Backtest Performance</h2>

          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div className="rounded border p-4">
              <div className="text-sm text-gray-500">CAGR</div>
              <div className="text-2xl font-bold">
                {((backtest.metrics.cagr ?? 0) * 100).toFixed(1)}%
              </div>
            </div>

            <div className="rounded border p-4">
              <div className="text-sm text-gray-500">Sharpe</div>
              <div className="text-2xl font-bold">
                {(backtest.metrics.sharpe ?? 0).toFixed(2)}
              </div>
            </div>

            <div className="rounded border p-4">
              <div className="text-sm text-gray-500">Max Drawdown</div>
              <div className="text-2xl font-bold">
                {((backtest.metrics.max_drawdown ?? 0) * 100).toFixed(1)}%
              </div>
            </div>

            <div className="rounded border p-4">
              <div className="text-sm text-gray-500">Total Return</div>
              <div className="text-2xl font-bold">
                {((backtest.metrics.total_return ?? 0) * 100).toFixed(0)}%
              </div>
            </div>
          </div>
        </section>
      )}

      {corr?.data && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Score → Future Return</h2>

          <div className="rounded border p-4">
            {corr.data.map((q, i) => (
              <div key={i} className="flex justify-between py-1">
                <span>{q.quantile}</span>
                <span>{((q.avg_return ?? 0) * 100).toFixed(2)}%</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {topn?.results && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Top-N Sensitivity</h2>

          <div className="space-y-2">
            {topn.results.map((r, i) => (
              <div key={i} className="rounded border p-4">
                <div className="font-semibold">Top {r.top_n}</div>
                <div className="text-sm text-gray-600">
                  CAGR {((r.metrics.cagr ?? 0) * 100).toFixed(1)}% | Sharpe{" "}
                  {(r.metrics.sharpe ?? 0).toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {sector?.avg_sector_exposure && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Sector Exposure</h2>

          <div className="space-y-2">
            {sector.avg_sector_exposure.map((s, i) => (
              <div key={i} className="flex justify-between rounded border p-3">
                <span>{s.sector}</span>
                <span>{((s.weight ?? 0) * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}