"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Metrics = {
  total_return?: number;
  cagr?: number;
  volatility?: number;
  sharpe?: number;
  max_drawdown?: number;
};

type SubPeriod = {
  label: string;
  metrics: Metrics;
};

type PortfolioConstruction = {
  method?: string;
  score_alpha?: number;
  min_weight?: number;
  max_weight?: number;
  vol_fallback?: number;
  vol_floor?: number;
  absolute_momentum_63d_min?: number;
  absolute_momentum_252d_min?: number;
  sector_max_names?: number;
  formula?: string;
};

type RegimeFilter = {
  benchmark?: string;
  ma_window?: number;
  momentum_window?: number;
  buffer?: number;
  confirm_days?: number;
  stock_rebalance?: string;
  exposure_rebalance?: string;
  risk_on_exposure?: number;
  mid_exposure?: number;
  risk_off_exposure?: number;
  defensive_tickers?: string[];
  summary?: string;
};

type StrategyInfo = {
  rebalance?: string;
  selection?: string;
  top_n?: number;
  transaction_cost?: number;
  period_years?: number;
  execution_lag_days?: number;
  universe_method?: string;
  portfolio_construction?: PortfolioConstruction;
  regime_filter?: RegimeFilter;
};

type BenchmarkInfo = {
  ticker?: string;
  metrics?: Metrics;
};

type BacktestSummaryData = {
  strategy?: StrategyInfo;
  metrics?: Metrics;
  subperiods?: SubPeriod[];
  benchmark?: BenchmarkInfo;
  notes?: string[];
};

function formatPct(v?: number, digits = 1) {
  return `${((v ?? 0) * 100).toFixed(digits)}%`;
}

function formatNum(v?: number, digits = 2) {
  return (v ?? 0).toFixed(digits);
}

function formatText(value?: string | number | null) {
  if (value === undefined || value === null || value === "") return "-";
  return String(value);
}

export default function BacktestSummary() {
  const [data, setData] = useState<BacktestSummaryData | null>(null);

  useEffect(() => {
    fetch("/data/backtest_regime_result.json")
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  if (!data?.metrics) return null;

  const selectedPeriod =
    data.subperiods?.find((p) => p.label === "3y") ??
    data.subperiods?.[0] ??
    null;

  const m = selectedPeriod?.metrics ?? data.metrics;
  const periodLabel = selectedPeriod?.label?.toUpperCase() ?? "FULL";

  const strategy = data.strategy;
  const regime = strategy?.regime_filter;
  const pc = strategy?.portfolio_construction;
  const benchmark = data.benchmark;

  const topN = strategy?.top_n ?? 15;
  const benchmarkTicker = benchmark?.ticker ?? regime?.benchmark ?? "SPY";

  const defensiveText =
    regime?.defensive_tickers && regime.defensive_tickers.length > 0
      ? regime.defensive_tickers.join(" / ")
      : "-";

  const notesPreview = data.notes?.slice(0, 3) ?? [];

  return (
    <div className="border rounded-xl p-6 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-6 mb-5">
        <div>
          <h2 className="text-2xl font-semibold">
            Recommended Strategy ({periodLabel})
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            {strategy?.selection ?? "TOP"} selection · Top {topN} ·{" "}
            {formatText(strategy?.rebalance)} stock rebalance ·{" "}
            {formatText(regime?.exposure_rebalance)} exposure rebalance
          </p>
        </div>

        <div className="text-xs text-gray-500 text-right leading-5 max-w-[420px]">
          <div>
            Universe:{" "}
            {strategy?.universe_method
              ? strategy.universe_method.replaceAll("_", " ")
              : "-"}
          </div>
          <div>
            Backtest: {formatText(strategy?.period_years)}Y · Execution lag{" "}
            {formatText(strategy?.execution_lag_days)}D · Cost{" "}
            {formatPct(strategy?.transaction_cost, 2)}
          </div>
          {regime?.summary && <div>{regime.summary}</div>}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 text-sm mb-5">
        <div>
          <div className="text-gray-500">CAGR</div>
          <div className="font-semibold text-2xl">
            {formatPct(m.cagr, 1)}
          </div>
        </div>

        <div>
          <div className="text-gray-500">Sharpe</div>
          <div className="font-semibold text-2xl">
            {formatNum(m.sharpe, 2)}
          </div>
        </div>

        <div>
          <div className="text-gray-500">Max Drawdown</div>
          <div className="font-semibold text-2xl">
            {formatPct(m.max_drawdown, 1)}
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-5">
        <div className="rounded-lg border p-4">
          <div className="text-sm font-semibold mb-2">Regime Filter</div>
          <div className="space-y-1 text-sm text-gray-600">
            <div>
              Benchmark {formatText(regime?.benchmark ?? benchmarkTicker)}
            </div>
            <div>
              {formatText(regime?.ma_window)}DMA +{" "}
              {formatText(regime?.momentum_window)}D momentum
            </div>
            <div>
              Exposure {formatPct(regime?.risk_on_exposure)} /{" "}
              {formatPct(regime?.mid_exposure)} /{" "}
              {formatPct(regime?.risk_off_exposure)}
            </div>
            <div>
              Buffer {formatPct(regime?.buffer, 2)} · Confirm{" "}
              {formatText(regime?.confirm_days)}D
            </div>
            <div>
              Stock rebalance {formatText(regime?.stock_rebalance)} · Exposure{" "}
              {formatText(regime?.exposure_rebalance)}
            </div>
            <div>Defensive asset {defensiveText}</div>
          </div>
        </div>

        <div className="rounded-lg border p-4">
          <div className="text-sm font-semibold mb-2">Portfolio Construction</div>
          <div className="space-y-1 text-sm text-gray-600">
            <div>Method {formatText(pc?.method)}</div>
            <div>Score alpha {formatNum(pc?.score_alpha, 1)}</div>
            <div>
              Weight min {formatPct(pc?.min_weight, 1)} · max{" "}
              {formatPct(pc?.max_weight, 1)}
            </div>
            <div>Vol floor {formatNum(pc?.vol_floor, 3)}</div>
            <div>
              Absolute momentum 63D &gt;{" "}
              {formatPct(pc?.absolute_momentum_63d_min, 1)} · 252D &gt;{" "}
              {formatPct(pc?.absolute_momentum_252d_min, 1)}
            </div>
            <div>Sector cap {formatText(pc?.sector_max_names)} names</div>
          </div>
        </div>
      </div>

      {(benchmark?.metrics || notesPreview.length > 0) && (
        <div className="grid md:grid-cols-2 gap-4 mb-5">
          <div className="rounded-lg border p-4">
            <div className="text-sm font-semibold mb-2">
              Benchmark ({benchmarkTicker})
            </div>
            <div className="space-y-1 text-sm text-gray-600">
              <div>CAGR {formatPct(benchmark?.metrics?.cagr, 1)}</div>
              <div>Sharpe {formatNum(benchmark?.metrics?.sharpe, 2)}</div>
              <div>
                Max Drawdown {formatPct(benchmark?.metrics?.max_drawdown, 1)}
              </div>
            </div>
          </div>

          <div className="rounded-lg border p-4">
            <div className="text-sm font-semibold mb-2">Backtest Notes</div>
            <div className="space-y-1 text-sm text-gray-600">
              {notesPreview.length > 0 ? (
                notesPreview.map((note, idx) => <div key={idx}>• {note}</div>)
              ) : (
                <div>-</div>
              )}
            </div>
          </div>
        </div>
      )}

      {pc?.formula && (
        <div className="mb-5 rounded-lg bg-gray-50 border px-4 py-3">
          <div className="text-xs text-gray-500 mb-1">Weight Formula</div>
          <div className="text-sm text-gray-700 break-words">{pc.formula}</div>
        </div>
      )}

      <Link href="/backtest" className="text-sm text-blue-600 hover:underline">
        Compare 3Y / 5Y / 10Y →
      </Link>
    </div>
  );
}