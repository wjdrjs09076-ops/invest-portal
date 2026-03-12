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

type Metrics = {
  cagr?: number;
  sharpe?: number;
  max_drawdown?: number;
  total_return?: number;
  volatility?: number;
};

type SubPeriod = {
  label: string;
  metrics: Metrics;
};

type BacktestJson = {
  metrics?: Metrics;
  subperiods?: SubPeriod[];
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

type RegimeJson = {
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

type FactorJson = {
  average_factor_scores?: {
    momentum_21d?: number;
    momentum_63d?: number;
    sector?: number;
    risk?: number;
  };
};

function getMetricsByPeriod<T extends { metrics?: Metrics; subperiods?: SubPeriod[] }>(
  summary: T | null,
  period: "3y" | "5y" | "10y"
): Metrics | null {
  if (!summary?.metrics) return null;
  if (period === "10y") return summary.metrics;

  const found = summary.subperiods?.find((p) => p.label === period);
  return found?.metrics ?? summary.metrics;
}

export default function StrategyPage() {
  const [period, setPeriod] = useState<"3y" | "5y" | "10y">("10y");

  const [backtest, setBacktest] = useState<BacktestJson | null>(null);
  const [corr, setCorr] = useState<ScoreCorrelationJson | null>(null);
  const [topn, setTopn] = useState<TopNJson | null>(null);
  const [sector, setSector] = useState<SectorExposureJson | null>(null);
  const [regime, setRegime] = useState<RegimeJson | null>(null);
  const [factor, setFactor] = useState<FactorJson | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [b, c, t, s, r, f] = await Promise.all([
          fetch("/data/backtest_result.json").then((res) => res.json()),
          fetch("/data/score_correlation.json").then((res) => res.json()),
          fetch("/data/topn_sensitivity.json").then((res) => res.json()),
          fetch("/data/sector_exposure.json").then((res) => res.json()),
          fetch("/data/backtest_regime_result.json")
            .then((res) => res.json())
            .catch(() => null),
          fetch("/data/factor_decomposition.json")
            .then((res) => res.json())
            .catch(() => null),
        ]);

        setBacktest(b);
        setCorr(c);
        setTopn(t);
        setSector(s);
        setRegime(r);
        setFactor(f);
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

  const selectedBacktestMetrics = getMetricsByPeriod(backtest, period);
  const selectedRegimeMetrics = getMetricsByPeriod(regime, period);

  const corrChartData =
    corr?.data?.map((row) => ({
      quantile: row.quantile,
      avgReturnPct: (row.avg_return ?? 0) * 100,
    })) ?? [];

  const topnChartData =
    topn?.results?.map((row) => ({
      topN: `Top ${row.top_n}`,
      cagrPct: (row.metrics.cagr ?? 0) * 100,
      sharpe: row.metrics.sharpe ?? 0,
    })) ?? [];

  const sectorChartData =
    sector?.avg_sector_exposure?.map((row) => ({
      sector: row.sector,
      weightPct: (row.weight ?? 0) * 100,
    })) ?? [];

  const factorChartData = factor?.average_factor_scores
    ? [
        { factor: "Momentum 21D", value: (factor.average_factor_scores.momentum_21d ?? 0) * 100 },
        { factor: "Momentum 63D", value: (factor.average_factor_scores.momentum_63d ?? 0) * 100 },
        { factor: "Sector", value: (factor.average_factor_scores.sector ?? 0) * 100 },
        { factor: "Risk", value: (factor.average_factor_scores.risk ?? 0) * 100 },
      ]
    : [];

  return (
    <main className="mx-auto max-w-6xl p-8 space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Strategy Lab</h1>
        <p className="text-sm text-gray-600">
          Research dashboard for model validation, robustness, and portfolio structure.
        </p>
      </div>

      <div className="flex gap-2">
        {(["3y", "5y", "10y"] as const).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`rounded-lg border px-4 py-2 text-sm font-medium transition ${
              period === p
                ? "bg-black text-white border-black"
                : "bg-white text-gray-800 border-gray-300 hover:bg-gray-50"
            }`}
          >
            {p.toUpperCase()}
          </button>
        ))}
      </div>

      {selectedBacktestMetrics && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Backtest Performance ({period.toUpperCase()})</h2>

          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div className="rounded-xl border bg-white p-4 shadow-sm">
              <div className="text-sm text-gray-500">CAGR</div>
              <div className="text-2xl font-bold">
                {((selectedBacktestMetrics.cagr ?? 0) * 100).toFixed(1)}%
              </div>
            </div>

            <div className="rounded-xl border bg-white p-4 shadow-sm">
              <div className="text-sm text-gray-500">Sharpe</div>
              <div className="text-2xl font-bold">
                {(selectedBacktestMetrics.sharpe ?? 0).toFixed(2)}
              </div>
            </div>

            <div className="rounded-xl border bg-white p-4 shadow-sm">
              <div className="text-sm text-gray-500">Max Drawdown</div>
              <div className="text-2xl font-bold">
                {((selectedBacktestMetrics.max_drawdown ?? 0) * 100).toFixed(1)}%
              </div>
            </div>

            <div className="rounded-xl border bg-white p-4 shadow-sm">
              <div className="text-sm text-gray-500">Total Return</div>
              <div className="text-2xl font-bold">
                {((selectedBacktestMetrics.total_return ?? 0) * 100).toFixed(0)}%
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
                <Line
                  type="monotone"
                  dataKey="sharpe"
                  name="Sharpe"
                  stroke="#2563eb"
                  strokeWidth={2}
                />
                <Line
                  type="monotone"
                  dataKey="cagrPct"
                  name="CAGR %"
                  stroke="#16a34a"
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="mb-2 text-xl font-semibold">
            Market Regime Filter Impact ({period.toUpperCase()})
          </h2>
          <p className="mb-4 text-sm text-gray-600">
            SPY vs 200DMA filter scales exposure in risk-off markets.
          </p>

          {selectedRegimeMetrics ? (
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-xl border p-4">
                <div className="text-sm text-gray-500">Regime CAGR</div>
                <div className="text-2xl font-bold">
                  {((selectedRegimeMetrics.cagr ?? 0) * 100).toFixed(1)}%
                </div>
              </div>

              <div className="rounded-xl border p-4">
                <div className="text-sm text-gray-500">Regime Sharpe</div>
                <div className="text-2xl font-bold">
                  {(selectedRegimeMetrics.sharpe ?? 0).toFixed(2)}
                </div>
              </div>

              <div className="rounded-xl border p-4">
                <div className="text-sm text-gray-500">Regime MDD</div>
                <div className="text-2xl font-bold">
                  {((selectedRegimeMetrics.max_drawdown ?? 0) * 100).toFixed(1)}%
                </div>
              </div>

              <div className="rounded-xl border p-4">
                <div className="text-sm text-gray-500">Risk-Off Exposure</div>
                <div className="text-2xl font-bold">
                  {(((regime?.strategy?.regime_filter?.risk_off_exposure ?? 0) as number) * 100).toFixed(0)}%
                </div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-500">Run regime backtest first.</div>
          )}
        </div>

        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="mb-2 text-xl font-semibold">Factor Decomposition</h2>
          <p className="mb-4 text-sm text-gray-600">
            Average percentile contribution of each factor among selected holdings.
          </p>

          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={factorChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="factor" />
                <YAxis tickFormatter={(v) => `${Number(v).toFixed(0)}`} />
                <Tooltip formatter={(v) => `${Number(v).toFixed(1)}`} />
                <Legend />
                <Bar dataKey="value" name="Avg Factor Score" fill="#dc2626" />
              </BarChart>
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