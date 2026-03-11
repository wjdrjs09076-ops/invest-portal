"use client";

import { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";

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
    return <main className="mx-auto max-w-6xl p-8">{error}</main>;
  }

  const corrChartData =
    corr?.data?.map((row) => ({
      quantile: row.quantile,
      avgReturnPct: (row.avg_return ?? 0) * 100,
      avgScore: row.avg_score ?? 0,
    })) ?? [];

  const topnChartData =
    topn?.results?.map((row) => ({
      topN: `Top ${row.top_n}`,
      cagrPct: (row.metrics.cagr ?? 0) * 100,
      sharpe: row.metrics.sharpe ?? 0,
      mddPct: ((row.metrics.max_drawdown ?? 0) * 100) * -1,
    })) ?? [];

  const sectorChartData =
    sector?.avg_sector_exposure?.map((row) => ({
      sector: row.sector,
      weightPct: (row.weight ?? 0) * 100,
    })) ?? [];

  return (
    <main className="mx-auto max-w-6xl p-8 space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Strategy Lab</h1>
        <p className="text-sm text-gray-600">
          Research dashboard for model validation, robustness, and portfolio structure.
        </p>
      </div>

      {backtest?.metrics && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Backtest Performance</h2>

          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div className="rounded-xl border bg-white p-4 shadow-sm">
              <div className="text-sm text-gray-500">CAGR</div>
              <div className="text-2xl font-bold">
                {((backtest.metrics.cagr ?? 0) * 100).toFixed(1)}%
              </div>
            </div>

            <div className="rounded-xl border bg-white p-4 shadow-sm">
              <div className="text-sm text-gray-500">Sharpe</div>
              <div className="text-2xl font-bold">
                {(backtest.metrics.sharpe ?? 0).toFixed(2)}
              </div>
            </div>

            <div className="rounded-xl border bg-white p-4 shadow-sm">
              <div className="text-sm text-gray-500">Max Drawdown</div>
              <div className="text-2xl font-bold">
                {((backtest.metrics.max_drawdown ?? 0) * 100).toFixed(1)}%
              </div>
            </div>

            <div className="rounded-xl border bg-white p-4 shadow-sm">
              <div className="text-sm text-gray-500">Total Return</div>
              <div className="text-2xl font-bold">
                {((backtest.metrics.total_return ?? 0) * 100).toFixed(0)}%
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="mb-2 text-xl font-semibold">Score → Future Return</h2>
          <p className="mb-4 text-sm text-gray-600">
            Higher buckets should ideally show higher forward returns.
          </p>

          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={corrChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="quantile" />
                <YAxis tickFormatter={(v) => `${Number(v).toFixed(1)}%`} />
                <Tooltip formatter={(v) => `${Number(v).toFixed(2)}%`} />
                <Legend />
                <Bar dataKey="avgReturnPct" name="Avg Forward Return" fill="#7c3aed" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="mb-2 text-xl font-semibold">Top-N Sensitivity</h2>
          <p className="mb-4 text-sm text-gray-600">
            Compare strategy stability across portfolio concentration levels.
          </p>

          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={topnChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="topN" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="sharpe" name="Sharpe" stroke="#2563eb" strokeWidth={2} />
                <Line type="monotone" dataKey="cagrPct" name="CAGR %" stroke="#16a34a" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-5 shadow-sm">
        <h2 className="mb-2 text-xl font-semibold">Sector Exposure</h2>
        <p className="mb-4 text-sm text-gray-600">
          Average portfolio exposure by sector for the selected strategy configuration.
        </p>

        <div className="h-[520px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={sectorChartData}
              layout="vertical"
              margin={{ left: 30, right: 20, top: 10, bottom: 10 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" tickFormatter={(v) => `${Number(v).toFixed(0)}%`} />
              <YAxis type="category" dataKey="sector" width={150} />
              <Tooltip formatter={(v) => `${Number(v).toFixed(1)}%`} />
              <Legend />
              <Bar dataKey="weightPct" name="Avg Exposure %" fill="#f59e0b" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
    </main>
  );
}