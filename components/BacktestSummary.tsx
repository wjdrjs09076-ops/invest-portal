"use client";

import { useEffect, useMemo, useState } from "react";

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

type BacktestData = {
  strategy?: StrategyInfo;
  metrics?: Metrics;
  subperiods?: SubPeriod[];
  benchmark?: {
    ticker?: string;
    metrics?: Metrics;
    subperiods?: SubPeriod[];
  };
  notes?: string[];
};

function formatPct(v?: number, digits = 1) {
  return `${((v ?? 0) * 100).toFixed(digits)}%`;
}

function formatNum(v?: number, digits = 2) {
  return (v ?? 0).toFixed(digits);
}

function getMetricsForPeriod(data: BacktestData | null, period: "3y" | "5y" | "10y"): Metrics | undefined {
  if (!data) return undefined;
  return data.subperiods?.find((p) => p.label === period)?.metrics ?? data.metrics;
}

function getBenchmarkMetricsForPeriod(
  data: BacktestData | null,
  period: "3y" | "5y" | "10y"
): Metrics | undefined {
  if (!data?.benchmark) return undefined;
  return data.benchmark.subperiods?.find((p) => p.label === period)?.metrics ?? data.benchmark.metrics;
}

function MetricCard({
  title,
  subtitle,
  metrics,
}: {
  title: string;
  subtitle: string;
  metrics?: Metrics;
}) {
  return (
    <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="text-2xl font-semibold text-gray-900">{title}</h2>
      <p className="mt-2 text-sm text-gray-500">{subtitle}</p>

      <div className="mt-6 grid grid-cols-2 gap-6 md:grid-cols-4">
        <div>
          <div className="text-sm text-gray-500">CAGR</div>
          <div className="mt-1 text-2xl font-semibold text-gray-900">
            {formatPct(metrics?.cagr, 1)}
          </div>
        </div>

        <div>
          <div className="text-sm text-gray-500">Sharpe</div>
          <div className="mt-1 text-2xl font-semibold text-gray-900">
            {formatNum(metrics?.sharpe, 2)}
          </div>
        </div>

        <div>
          <div className="text-sm text-gray-500">Max Drawdown</div>
          <div className="mt-1 text-2xl font-semibold text-gray-900">
            {formatPct(metrics?.max_drawdown, 1)}
          </div>
        </div>

        <div>
          <div className="text-sm text-gray-500">Volatility</div>
          <div className="mt-1 text-2xl font-semibold text-gray-900">
            {formatPct(metrics?.volatility, 1)}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function BacktestPage() {
  const [period, setPeriod] = useState<"3y" | "5y" | "10y">("10y");
  const [baseData, setBaseData] = useState<BacktestData | null>(null);
  const [regimeData, setRegimeData] = useState<BacktestData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        const [baseRes, regimeRes] = await Promise.allSettled([
          fetch("/data/backtest_result.json").then((r) => {
            if (!r.ok) throw new Error("base backtest missing");
            return r.json();
          }),
          fetch("/data/backtest_regime_result.json").then((r) => {
            if (!r.ok) throw new Error("regime backtest missing");
            return r.json();
          }),
        ]);

        if (!alive) return;

        if (baseRes.status === "fulfilled") {
          setBaseData(baseRes.value);
        }

        if (regimeRes.status === "fulfilled") {
          setRegimeData(regimeRes.value);
        }
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();

    return () => {
      alive = false;
    };
  }, []);

  const baseMetrics = useMemo(() => getMetricsForPeriod(baseData, period), [baseData, period]);
  const regimeMetrics = useMemo(() => getMetricsForPeriod(regimeData, period), [regimeData, period]);
  const benchmarkMetrics = useMemo(
    () => getBenchmarkMetricsForPeriod(regimeData, period),
    [regimeData, period]
  );

  const regime = regimeData?.strategy?.regime_filter;
  const benchmarkTicker = regimeData?.benchmark?.ticker ?? regime?.benchmark ?? "SPY";
  const defensiveText =
    regime?.defensive_tickers && regime.defensive_tickers.length > 0
      ? regime.defensive_tickers.join(" / ")
      : "-";

  if (loading) {
    return (
      <main className="mx-auto max-w-7xl px-6 py-10">
        <div className="text-sm text-gray-500">Loading backtest...</div>
      </main>
    );
  }

  if (!regimeData) {
    return (
      <main className="mx-auto max-w-7xl px-6 py-10">
        <div className="text-sm text-red-500">
          backtest_regime_result.json 을 불러오지 못했습니다.
        </div>
      </main>
    );
  }

  const periodTitle = period.toUpperCase();

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <h1 className="text-5xl font-bold tracking-tight text-gray-900">
        Backtest Comparison
      </h1>

      <p className="mt-4 text-2xl text-gray-600">
        Base strategy vs regime-filtered strategy · {benchmarkTicker}{" "}
        {regime?.ma_window ?? 200}DMA · Risk-off exposure{" "}
        {formatPct(regime?.risk_off_exposure, 0)}
      </p>

      <div className="mt-8 flex gap-3">
        {(["3y", "5y", "10y"] as const).map((p) => {
          const active = period === p;
          return (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={`rounded-2xl border px-6 py-4 text-3xl font-semibold transition ${
                active
                  ? "border-black bg-black text-white"
                  : "border-gray-300 bg-white text-black hover:bg-gray-50"
              }`}
            >
              {p.toUpperCase()}
            </button>
          );
        })}
      </div>

      <div className="mt-10 space-y-6">
        {baseData && (
          <MetricCard
            title={`Base Strategy (${periodTitle})`}
            subtitle="Momentum + sector strength + risk filter"
            metrics={baseMetrics}
          />
        )}

        <MetricCard
          title={`Regime-Filtered Strategy (${periodTitle})`}
          subtitle={`Buffered ${benchmarkTicker} ${regime?.ma_window ?? 200}DMA exposure scaling`}
          metrics={regimeMetrics}
        />

        <MetricCard
          title={`Benchmark (${benchmarkTicker})`}
          subtitle={`${periodTitle} benchmark reference`}
          metrics={benchmarkMetrics}
        />
      </div>

      <section className="mt-8 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-gray-900">Strategy Details</h2>

        <div className="mt-4 grid gap-6 md:grid-cols-2">
          <div>
            <div className="text-sm font-medium text-gray-900">Regime Filter</div>
            <div className="mt-2 space-y-1 text-sm text-gray-600">
              <div>
                Benchmark: {benchmarkTicker}
              </div>
              <div>
                MA window: {regime?.ma_window ?? "-"}D
              </div>
              <div>
                Momentum window: {regime?.momentum_window ?? "-"}D
              </div>
              <div>
                Buffer: {formatPct(regime?.buffer, 2)}
              </div>
              <div>
                Confirm days: {regime?.confirm_days ?? "-"}
              </div>
              <div>
                Stock rebalance: {regime?.stock_rebalance ?? "-"}
              </div>
              <div>
                Exposure rebalance: {regime?.exposure_rebalance ?? "-"}
              </div>
              <div>
                Exposure: {formatPct(regime?.risk_on_exposure)} /{" "}
                {formatPct(regime?.mid_exposure)} /{" "}
                {formatPct(regime?.risk_off_exposure)}
              </div>
              <div>
                Defensive asset: {defensiveText}
              </div>
            </div>
          </div>

          <div>
            <div className="text-sm font-medium text-gray-900">Portfolio Construction</div>
            <div className="mt-2 space-y-1 text-sm text-gray-600">
              <div>
                Top N: {regimeData.strategy?.top_n ?? "-"}
              </div>
              <div>
                Selection: {regimeData.strategy?.selection ?? "-"}
              </div>
              <div>
                Rebalance: {regimeData.strategy?.rebalance ?? "-"}
              </div>
              <div>
                Transaction cost: {formatPct(regimeData.strategy?.transaction_cost, 2)}
              </div>
              <div>
                Test period: {regimeData.strategy?.period_years ?? "-"}Y
              </div>
              <div>
                Execution lag: {regimeData.strategy?.execution_lag_days ?? "-"}D
              </div>
              <div>
                Universe: {regimeData.strategy?.universe_method ?? "-"}
              </div>
              <div>
                Absolute momentum 63D &gt;{" "}
                {formatPct(
                  regimeData.strategy?.portfolio_construction?.absolute_momentum_63d_min,
                  1
                )}
              </div>
              <div>
                Absolute momentum 252D &gt;{" "}
                {formatPct(
                  regimeData.strategy?.portfolio_construction?.absolute_momentum_252d_min,
                  1
                )}
              </div>
              <div>
                Sector cap:{" "}
                {regimeData.strategy?.portfolio_construction?.sector_max_names ?? "-"} names
              </div>
              <div>
                Score alpha:{" "}
                {formatNum(
                  regimeData.strategy?.portfolio_construction?.score_alpha,
                  1
                )}
              </div>
            </div>
          </div>
        </div>

        {regime?.summary && (
          <div className="mt-4 rounded-2xl bg-gray-50 px-4 py-3 text-sm text-gray-700">
            {regime.summary}
          </div>
        )}

        {regimeData.notes && regimeData.notes.length > 0 && (
          <div className="mt-5">
            <div className="text-sm font-medium text-gray-900">Notes</div>
            <div className="mt-2 space-y-1 text-sm text-gray-600">
              {regimeData.notes.map((note, idx) => (
                <div key={idx}>• {note}</div>
              ))}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}