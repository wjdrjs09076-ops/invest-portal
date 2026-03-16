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
  cagr?: number;
  sharpe?: number;
  max_drawdown?: number;
  volatility?: number;
  total_return?: number;
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
  vix_crash_filter?: string; // [수정됨] 백엔드에서 넘어오는 VIX 데이터 타입 추가
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

type BacktestSummary = {
  metrics?: Metrics;
  subperiods?: SubPeriod[];
  benchmark?: {
    ticker?: string;
    metrics?: Metrics;
    subperiods?: SubPeriod[];
  };
  strategy?: StrategyInfo;
  notes?: string[];
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
  stock_exposure?: number;
  defensive_exposure?: number;
  regime_bucket?: string;
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

function formatPct(v?: number, digits = 1) {
  return `${((v ?? 0) * 100).toFixed(digits)}%`;
}

function formatNum(v?: number, digits = 2) {
  return (v ?? 0).toFixed(digits);
}

function formatText(v?: string | number | null) {
  if (v === undefined || v === null || v === "") return "-";
  return String(v);
}

function MetricCard({
  title,
  metrics,
  subtitle,
}: {
  title: string;
  metrics?: Metrics;
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
          <div style={{ fontSize: 22, fontWeight: 700 }}>
            {formatPct(metrics?.cagr, 1)}
          </div>
        </div>

        <div>
          <div style={{ color: "#666", fontSize: 13 }}>Sharpe</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>
            {formatNum(metrics?.sharpe, 2)}
          </div>
        </div>

        <div>
          <div style={{ color: "#666", fontSize: 13 }}>Max Drawdown</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>
            {formatPct(metrics?.max_drawdown, 1)}
          </div>
        </div>

        <div>
          <div style={{ color: "#666", fontSize: 13 }}>Volatility</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>
            {metrics?.volatility != null ? formatPct(metrics.volatility, 1) : "-"}
          </div>
        </div>
      </div>
    </div>
  );
}

function getMetricsByPeriod(
  summary: BacktestSummary,
  period: "3y" | "5y" | "10y"
): Metrics {
  const fromSubperiod = summary.subperiods?.find((p) => p.label === period)?.metrics;
  return fromSubperiod ?? summary.metrics ?? {};
}

function getBenchmarkMetricsByPeriod(
  summary: BacktestSummary,
  period: "3y" | "5y" | "10y"
): Metrics {
  const fromSubperiod = summary.benchmark?.subperiods?.find((p) => p.label === period)?.metrics;
  return fromSubperiod ?? summary.benchmark?.metrics ?? {};
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
    spy:
      p.spy != null && firstSpy != null && firstSpy !== 0 ? p.spy / firstSpy : undefined,
    base:
      p.base != null && firstBase != null && firstBase !== 0
        ? p.base / firstBase
        : undefined,
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

  if (!regimeSummary) {
    return <div style={{ padding: 40 }}>Loading...</div>;
  }

  const base = baseSummary ? getMetricsByPeriod(baseSummary, period) : undefined;
  const regime = getMetricsByPeriod(regimeSummary, period);
  const spy = getBenchmarkMetricsByPeriod(regimeSummary, period);

  const strategy = regimeSummary.strategy;
  const regimeInfo = strategy?.regime_filter;
  const pc = strategy?.portfolio_construction;
  const benchmarkTicker = regimeSummary.benchmark?.ticker ?? regimeInfo?.benchmark ?? "SPY";

  const defensiveText =
    regimeInfo?.defensive_tickers && regimeInfo.defensive_tickers.length > 0
      ? regimeInfo.defensive_tickers.join(" / ")
      : "-";

  const regimeSubtitle = regimeInfo
    ? `${benchmarkTicker} ${regimeInfo.ma_window ?? 200}DMA + ${regimeInfo.momentum_window ?? 63}D momentum · buffered 3-state exposure`
    : "Regime filtered strategy";

  return (
    <div style={{ padding: 40, maxWidth: 1240, margin: "0 auto" }}>
      <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 8 }}>Backtest Comparison</h1>

      <div style={{ color: "#555", marginBottom: 16 }}>
        Base strategy vs regime-filtered strategy
        {regimeInfo
          ? ` · ${benchmarkTicker} ${regimeInfo.ma_window ?? 200}DMA · Risk-off exposure ${formatPct(
              regimeInfo.risk_off_exposure,
              0
            )}`
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
        {baseSummary && (
          <MetricCard
            title={`Base Strategy (${period.toUpperCase()})`}
            subtitle="Momentum + sector strength + risk filter"
            metrics={base}
          />
        )}

        <MetricCard
          title={`Regime-Filtered Strategy (${period.toUpperCase()})`}
          subtitle={regimeSubtitle}
          metrics={regime}
        />

        <MetricCard
          title={`Benchmark (${benchmarkTicker})`}
          subtitle={`${period.toUpperCase()} benchmark reference`}
          metrics={spy}
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
          marginBottom: 28,
        }}
      >
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
          Strategy Details
        </h2>

        <div style={{ color: "#666", marginBottom: 16 }}>
          Current regime/backtest configuration loaded from{" "}
          <strong>backtest_regime_result.json</strong>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: 20,
          }}
        >
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Regime Filter</div>
            <div style={{ color: "#555", fontSize: 14, lineHeight: 1.8 }}>
              <div>Benchmark: {formatText(benchmarkTicker)}</div>
              <div>MA window: {formatText(regimeInfo?.ma_window)}D</div>
              <div>Momentum window: {formatText(regimeInfo?.momentum_window)}D</div>
              <div>Buffer: {formatPct(regimeInfo?.buffer, 2)}</div>
              <div>Confirm days: {formatText(regimeInfo?.confirm_days)}D</div>
              <div>Stock rebalance: {formatText(regimeInfo?.stock_rebalance)}</div>
              {/* [수정됨] Exposure rebalance가 daily일 때 색상 강조 */}
              <div>
                Exposure rebalance: <strong style={{ color: regimeInfo?.exposure_rebalance === "daily" ? "#dc2626" : "inherit" }}>{formatText(regimeInfo?.exposure_rebalance)}</strong>
              </div>
              {/* [수정됨] 백엔드에서 받아온 VIX Crash Filter 출력 */}
              <div>VIX crash filter: <strong>{formatText(regimeInfo?.vix_crash_filter)}</strong></div>
              <div>
                Exposure: {formatPct(regimeInfo?.risk_on_exposure)} /{" "}
                {formatPct(regimeInfo?.mid_exposure)} /{" "}
                {formatPct(regimeInfo?.risk_off_exposure)}
              </div>
              <div>Defensive asset: {defensiveText}</div>
            </div>
          </div>

          <div>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>
              Portfolio Construction
            </div>
            <div style={{ color: "#555", fontSize: 14, lineHeight: 1.8 }}>
              <div>Selection: {formatText(strategy?.selection)}</div>
              <div>Top N: {formatText(strategy?.top_n)}</div>
              <div>Rebalance: {formatText(strategy?.rebalance)}</div>
              <div>Transaction cost: {formatPct(strategy?.transaction_cost, 2)}</div>
              <div>Backtest period: {formatText(strategy?.period_years)}Y</div>
              <div>Execution lag: {formatText(strategy?.execution_lag_days)}D</div>
              <div>Universe: {formatText(strategy?.universe_method)}</div>
              <div>Method: {formatText(pc?.method)}</div>
              <div>Score alpha: {formatNum(pc?.score_alpha, 1)}</div>
              <div>
                Weight min / max: {formatPct(pc?.min_weight)} / {formatPct(pc?.max_weight)}
              </div>
              <div>Vol floor: {pc?.vol_floor != null ? pc.vol_floor.toFixed(3) : "-"}</div>
              <div>
                Absolute momentum 63D &gt; {formatPct(pc?.absolute_momentum_63d_min, 1)}
              </div>
              <div>
                Absolute momentum 252D &gt; {formatPct(pc?.absolute_momentum_252d_min, 1)}
              </div>
              <div>Sector cap: {formatText(pc?.sector_max_names)} names</div>
              {/* [수정됨] 뉴스 필터 정보 추가 */}
              <div>News filter: <strong>Regex Hard-Kill Active</strong></div>
            </div>
          </div>
        </div>

        {regimeInfo?.summary ? (
          <div
            style={{
              marginTop: 16,
              padding: 14,
              borderRadius: 12,
              background: "#f6f6f6",
              color: "#444",
              fontSize: 14,
            }}
          >
            {regimeInfo.summary}
          </div>
        ) : null}

        {pc?.formula ? (
          <div
            style={{
              marginTop: 12,
              padding: 14,
              borderRadius: 12,
              background: "#fafafa",
              color: "#444",
              fontSize: 14,
            }}
          >
            <strong>Weight formula:</strong> {pc.formula}
          </div>
        ) : null}

        {regimeSummary.notes && regimeSummary.notes.length > 0 ? (
          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Notes</div>
            <div style={{ color: "#555", fontSize: 14, lineHeight: 1.8 }}>
              {regimeSummary.notes.map((note, idx) => (
                <div key={idx}>• {note}</div>
              ))}
            </div>
          </div>
        ) : null}
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