"use client";

import { useEffect, useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  Legend,
  BarChart,
  Bar,
} from "recharts";

type Metrics = {
  cagr: number;
  sharpe: number;
  max_drawdown: number;
  volatility: number;
  total_return?: number;
};

type SubPeriod = {
  label: string;
  metrics: Metrics;
};

type BacktestSummary = {
  metrics: Metrics;
  subperiods?: SubPeriod[];
  benchmark: {
    ticker: string;
    metrics: Metrics;
    subperiods?: SubPeriod[];
  };
  strategy?: {
    top_n?: number;
    portfolio_construction?: {
      score_alpha?: number;
      absolute_momentum_63d_min?: number;
      absolute_momentum_252d_min?: number;
      sector_max_names?: number;
    };
    regime_filter?: {
      benchmark?: string;
      ma_window?: number;
      momentum_window?: number;
      stock_rebalance?: string;
      exposure_rebalance?: string;
      risk_on_exposure?: number;
      mid_exposure?: number;
      risk_off_exposure?: number;
      defensive_tickers?: string[];
    };
  };
};

type BaseCurvePoint = {
  date: string;
  strategy: number;
  benchmark: number;
};

type RegimeCurvePoint = {
  date: string;
  strategy: number;
  benchmark: number;
  exposure?: number;
};

type MergedCurvePoint = {
  date: string;
  spy?: number;
  base?: number;
  regime?: number;
};

type ScoreCorrelationRow = {
  quantile: string;
  avg_return: number;
  median_return: number;
  count: number;
  avg_score: number;
};

type ScoreCorrelation = {
  forward_days: number;
  data: ScoreCorrelationRow[];
};

function MetricCard({
  title,
  cagr,
  sharpe,
  mdd,
  vol,
  subtitle,
}: {
  title: string;
  cagr: number;
  sharpe: number;
  mdd: number;
  vol?: number;
  subtitle?: string;
}) {
  return (
    <div
      style={{
        border: "1px solid #ddd",
        borderRadius: 16,
        padding: 18,
        background: "#fff",
      }}
    >
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>{title}</div>
      {subtitle ? (
        <div style={{ color: "#666", fontSize: 13, marginBottom: 12 }}>{subtitle}</div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        <div>
          <div style={{ color: "#666", fontSize: 13 }}>CAGR</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{(cagr * 100).toFixed(1)}%</div>
        </div>
        <div>
          <div style={{ color: "#666", fontSize: 13 }}>Sharpe</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{sharpe.toFixed(2)}</div>
        </div>
        <div>
          <div style={{ color: "#666", fontSize: 13 }}>Max Drawdown</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{(mdd * 100).toFixed(1)}%</div>
        </div>
        <div>
          <div style={{ color: "#666", fontSize: 13 }}>Volatility</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>
            {vol != null ? `${(vol * 100).toFixed(1)}%` : "-"}
          </div>
        </div>
      </div>
    </div>
  );
}

function getMetricsByPeriod(summary: BacktestSummary, period: "3y" | "5y" | "10y"): Metrics {
  if (period === "10y") return summary.metrics;
  const found = summary.subperiods?.find((p) => p.label === period);
  return found?.metrics ?? summary.metrics;
}

function getBenchmarkMetricsByPeriod(
  summary: BacktestSummary,
  period: "3y" | "5y" | "10y"
): Metrics {
  if (period === "10y") return summary.benchmark.metrics;
  const found = summary.benchmark.subperiods?.find((p) => p.label === period);
  return found?.metrics ?? summary.benchmark.metrics;
}

function getPeriodStartDate(period: "3y" | "5y" | "10y"): Date | null {
  if (period === "10y") return null;
  const years = period === "5y" ? 5 : 3;
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - years);
  return cutoff;
}

function rebaseCurve(points: MergedCurvePoint[]): MergedCurvePoint[] {
  if (!points.length) return [];

  const firstSpy = points.find((p) => p.spy != null)?.spy;
  const firstBase = points.find((p) => p.base != null)?.base;
  const firstRegime = points.find((p) => p.regime != null)?.regime;

  return points.map((p) => ({
    date: p.date,
    spy: p.spy != null && firstSpy != null && firstSpy !== 0 ? p.spy / firstSpy : undefined,
    base:
      p.base != null && firstBase != null && firstBase !== 0 ? p.base / firstBase : undefined,
    regime:
      p.regime != null && firstRegime != null && firstRegime !== 0
        ? p.regime / firstRegime
        : undefined,
  }));
}

export default function BacktestPage() {
  const [period, setPeriod] = useState<"3y" | "5y" | "10y">("10y");

  const [baseSummary, setBaseSummary] = useState<BacktestSummary | null>(null);
  const [regimeSummary, setRegimeSummary] = useState<BacktestSummary | null>(null);
  const [baseCurve, setBaseCurve] = useState<BaseCurvePoint[]>([]);
  const [regimeCurve, setRegimeCurve] = useState<RegimeCurvePoint[]>([]);
  const [scoreCorr, setScoreCorr] = useState<ScoreCorrelation | null>(null);

  useEffect(() => {
    fetch("/data/backtest_result.json")
      .then((r) => r.json())
      .then((data) => setBaseSummary(data))
      .catch(() => {});

    fetch("/data/backtest_regime_result.json")
      .then((r) => r.json())
      .then((data) => setRegimeSummary(data))
      .catch(() => {});

    fetch("/data/equity_curve.json")
      .then((r) => r.json())
      .then((data) => setBaseCurve(data))
      .catch(() => {});

    fetch("/data/equity_curve_regime.json")
      .then((r) => r.json())
      .then((data) => setRegimeCurve(data))
      .catch(() => {});

    fetch("/data/score_correlation.json")
      .then((r) => r.json())
      .then((data) => setScoreCorr(data))
      .catch(() => {});
  }, []);

  const mergedCurve: MergedCurvePoint[] = useMemo(() => {
    const map = new Map<string, MergedCurvePoint>();

    for (const row of baseCurve) {
      map.set(row.date, {
        date: row.date,
        base: row.strategy,
        spy: row.benchmark,
      });
    }

    for (const row of regimeCurve) {
      const existing = map.get(row.date) ?? { date: row.date };
      existing.regime = row.strategy;
      if (existing.spy == null) existing.spy = row.benchmark;
      map.set(row.date, existing);
    }

    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [baseCurve, regimeCurve]);

  const filteredCurve: MergedCurvePoint[] = useMemo(() => {
    if (!mergedCurve.length) return [];

    const cutoff = getPeriodStartDate(period);
    const sliced =
      cutoff == null
        ? mergedCurve
        : mergedCurve.filter((row) => new Date(row.date) >= cutoff);

    return rebaseCurve(sliced);
  }, [mergedCurve, period]);

  const corrChartData =
    scoreCorr?.data?.map((x) => ({
      quantile: x.quantile,
      avg_return_pct: x.avg_return * 100,
    })) ?? [];

  if (!baseSummary || !regimeSummary) {
    return <div style={{ padding: 40 }}>Loading...</div>;
  }

  const base = getMetricsByPeriod(baseSummary, period);
  const regime = getMetricsByPeriod(regimeSummary, period);
  const spy = getBenchmarkMetricsByPeriod(regimeSummary, period);
  const regimeInfo = regimeSummary.strategy?.regime_filter;

  return (
    <div style={{ padding: 40, maxWidth: 1240, margin: "0 auto" }}>
      <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 8 }}>Backtest Comparison</h1>
      <div style={{ color: "#555", marginBottom: 16 }}>
        Base strategy vs regime-filtered strategy
        {regimeInfo
          ? ` · ${regimeInfo.benchmark ?? "SPY"} ${regimeInfo.ma_window ?? 200}DMA · Risk-off exposure ${((regimeInfo.risk_off_exposure ?? 0) * 100).toFixed(0)}%`
          : ""}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        {(["3y", "5y", "10y"] as const).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            style={{
              padding: "8px 14px",
              borderRadius: 10,
              border: "1px solid #ddd",
              background: period === p ? "#111" : "#fff",
              color: period === p ? "#fff" : "#111",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            {p.toUpperCase()}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gap: 16, marginBottom: 24 }}>
        <MetricCard
          title={`Base Strategy (${period.toUpperCase()})`}
          subtitle="Momentum + sector strength + risk filter"
          cagr={base.cagr}
          sharpe={base.sharpe}
          mdd={base.max_drawdown}
          vol={base.volatility}
        />

        <MetricCard
          title={`Regime-Filtered Strategy (${period.toUpperCase()})`}
          subtitle="Base strategy with SPY 200DMA exposure scaling"
          cagr={regime.cagr}
          sharpe={regime.sharpe}
          mdd={regime.max_drawdown}
          vol={regime.volatility}
        />

        <MetricCard
          title={`Benchmark (${regimeSummary.benchmark.ticker})`}
          subtitle={`${period.toUpperCase()} benchmark reference`}
          cagr={spy.cagr}
          sharpe={spy.sharpe}
          mdd={spy.max_drawdown}
          vol={spy.volatility}
        />
      </div>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 16,
          padding: 20,
          background: "#fff",
          marginBottom: 28,
        }}
      >
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>
          SPY vs Base vs Regime ({period.toUpperCase()})
        </h2>

        <div style={{ color: "#666", marginBottom: 12 }}>
          Rebased to 1.0 at the start of the selected period
        </div>

        <ResponsiveContainer width="100%" height={460}>
          <LineChart data={filteredCurve}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" minTickGap={40} />
            <YAxis domain={["auto", "auto"]} />
            <Tooltip />
            <Legend />
            <Line
              type="monotone"
              dataKey="spy"
              name="SPY"
              stroke="#16a34a"
              dot={false}
              strokeWidth={2}
            />
            <Line
              type="monotone"
              dataKey="base"
              name="Base Strategy"
              stroke="#2563eb"
              dot={false}
              strokeWidth={2}
            />
            <Line
              type="monotone"
              dataKey="regime"
              name="Regime Strategy"
              stroke="#dc2626"
              dot={false}
              strokeWidth={2}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 16,
          padding: 20,
          background: "#fff",
        }}
      >
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
          Score to Future Return Correlation
        </h2>

        <div style={{ color: "#666", marginBottom: 16 }}>
          Higher score buckets should ideally show higher forward returns over{" "}
          <strong>{scoreCorr?.forward_days ?? 20} trading days</strong>.
        </div>

        <ResponsiveContainer width="100%" height={360}>
          <BarChart data={corrChartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="quantile" />
            <YAxis tickFormatter={(value) => `${Number(value).toFixed(1)}%`} />
            <Tooltip formatter={(value) => `${Number(value).toFixed(2)}%`} />
            <Legend />
            <Bar dataKey="avg_return_pct" name="Avg Forward Return" fill="#7c3aed" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}