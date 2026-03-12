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

type PortfolioConstruction = {
  score_alpha?: number;
  absolute_momentum_63d_min?: number;
  absolute_momentum_252d_min?: number;
  sector_max_names?: number;
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

function formatPct(v?: number) {
  return `${((v ?? 0) * 100).toFixed(0)}%`;
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

  const m = data.subperiods?.find((p) => p.label === "3y")?.metrics ?? data.metrics;
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
          <h2 className="text-2xl font-semibold">Recommended Strategy (3Y)</h2>
          <p className="text-sm text-gray-500 mt-1">
            Alpha-weighted Top {topN ?? 15} selection with weekly 3-state regime filter
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
                {defensiveText && <div>Defensive asset {defensiveText}</div>}
              </>
            )}

            {pc && (
              <>
                <div>Score alpha {(pc.score_alpha ?? 0).toFixed(1)}</div>
                <div>
                  Absolute momentum 63D &gt; {(pc.absolute_momentum_63d_min ?? 0).toFixed(0)}%
                  {" · "}
                  252D &gt; {(pc.absolute_momentum_252d_min ?? 0).toFixed(0)}%
                </div>
                <div>Sector cap {pc.sector_max_names ?? 3} names</div>
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