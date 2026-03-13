"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

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

type PortfolioConstruction = {
  score_alpha?: number;
  absolute_momentum_63d_min?: number;
  absolute_momentum_252d_min?: number;
  sector_max_names?: number;
  min_weight?: number;
  max_weight?: number;
  vol_floor?: number;
};

type RegimeFilter = {
  ma_window?: number;
  momentum_window?: number;
  stock_rebalance?: string;
  exposure_rebalance?: string;
  risk_on_exposure?: number;
  mid_exposure?: number;
  risk_off_exposure?: number;
  defensive_tickers?: string[];
  buffer?: number;
  confirm_days?: number;
};

type BacktestSummaryData = {
  metrics?: Metrics;
  subperiods?: SubPeriod[];
  strategy?: {
    top_n?: number;
    portfolio_construction?: PortfolioConstruction;
    regime_filter?: RegimeFilter;
  };
};

function formatPct(v?: number, digits = 0) {
  return `${((v ?? 0) * 100).toFixed(digits)}%`;
}

function formatNum(v?: number, digits = 2) {
  return (v ?? 0).toFixed(digits);
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

  const subperiods = data.subperiods ?? [];

  const chosenPeriod =
    subperiods.find((p) => p.label === "10y") ??
    subperiods.find((p) => p.label === "5y") ??
    subperiods.find((p) => p.label === "3y");

  const m = chosenPeriod?.metrics ?? data.metrics;
  const label = chosenPeriod?.label ?? "Full";

  const regime = data.strategy?.regime_filter;
  const pc = data.strategy?.portfolio_construction;
  const topN = data.strategy?.top_n;

  const defensiveText =
    regime?.defensive_tickers && regime.defensive_tickers.length > 0
      ? regime.defensive_tickers.join(" / ")
      : null;

  return (
    <div className="border rounded-xl p-6 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-2xl font-semibold">Backtest Summary ({label})</h2>
          <p className="text-sm text-gray-500 mt-1">
            Top {topN ?? 15} momentum portfolio with buffered regime filter and inverse-volatility sizing
          </p>
        </div>

        {(regime || pc) && (
          <div className="text-xs text-gray-500 text-right leading-5">
            {regime && (
              <>
                <div>
                  SPY {regime.ma_window}DMA + {regime.momentum_window}D momentum
                </div>
                <div>
                  Exposure {formatPct(regime.risk_on_exposure)} / {formatPct(regime.mid_exposure)} / {formatPct(regime.risk_off_exposure)}
                </div>
                <div>
                  Stock rebalance {regime.stock_rebalance} · Exposure rebalance {regime.exposure_rebalance}
                </div>
                {typeof regime.buffer === "number" && (
                  <div>Buffer ±{formatPct(regime.buffer, 1)}</div>
                )}
                {typeof regime.confirm_days === "number" && (
                  <div>Confirmation {regime.confirm_days} days</div>
                )}
                {defensiveText && <div>Defensive asset {defensiveText}</div>}
              </>
            )}

            {pc && (
              <>
                <div>Score alpha {formatNum(pc.score_alpha, 1)}</div>
                <div>
                  Absolute momentum 63D &gt; {(pc.absolute_momentum_63d_min ?? 0).toFixed(0)}%
                  {" · "}
                  252D &gt; {(pc.absolute_momentum_252d_min ?? 0).toFixed(0)}%
                </div>
                <div>Sector cap {pc.sector_max_names ?? 3} names</div>
                {typeof pc.min_weight === "number" && typeof pc.max_weight === "number" && (
                  <div>
                    Weight range {formatPct(pc.min_weight)} ~ {formatPct(pc.max_weight)}
                  </div>
                )}
                {typeof pc.vol_floor === "number" && (
                  <div>Vol floor {formatNum(pc.vol_floor, 2)}</div>
                )}
              </>
            )}
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