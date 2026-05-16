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
  ReferenceLine,
} from "recharts";

// IS/OOS 경계 (절대 수정 금지)
const IS_START  = "2014-05-01";
const IS_END    = "2019-12-31";
const OOS_START = "2020-01-01";

type Period = "is" | "oos" | "3y" | "5y" | "10y";

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
  vix_crash_filter?: string;
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

type RegimeCurvePoint = {
  date: string;
  strategy: number;
  benchmark: number;
  stock_exposure?: number;
  regime_bucket?: string;
};

type MergedCurvePoint = {
  date: string;
  spy?: number;
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

function getPeriodRange(period: Period): { start: Date | null; end: Date | null } {
  if (period === "is")  return { start: new Date(IS_START), end: new Date(IS_END) };
  if (period === "oos") return { start: new Date(OOS_START), end: null };
  if (period === "10y") return { start: null, end: null };
  const years = period === "5y" ? 5 : 3;
  const start = new Date();
  start.setFullYear(start.getFullYear() - years);
  return { start, end: null };
}

function rebaseCurve(points: MergedCurvePoint[]): MergedCurvePoint[] {
  if (!points.length) return [];
  const firstSpy    = points.find((p) => p.spy    != null)?.spy;
  const firstRegime = points.find((p) => p.regime != null)?.regime;
  return points.map((p) => ({
    date: p.date,
    spy:    p.spy    != null && firstSpy    ? p.spy    / firstSpy    : undefined,
    regime: p.regime != null && firstRegime ? p.regime / firstRegime : undefined,
  }));
}

function computeMetricsFromEquity(values: number[]): Metrics {
  if (values.length < 2) return {};
  const dailyReturns: number[] = [];
  for (let i = 1; i < values.length; i++) {
    if (values[i - 1] > 0) dailyReturns.push(values[i] / values[i - 1] - 1);
  }
  if (!dailyReturns.length) return {};
  const first = values[0];
  const last  = values[values.length - 1];
  const totalReturn = last / first - 1;
  const years = dailyReturns.length / 252;
  const cagr  = Math.pow(last / first, 1 / years) - 1;
  const mean  = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(dailyReturns.length - 1, 1);
  const vol   = Math.sqrt(variance) * Math.sqrt(252);
  const sharpe = vol > 0 ? (mean * 252) / vol : 0;
  let peak = values[0], mdd = 0;
  for (const v of values) {
    peak = Math.max(peak, v);
    const dd = peak > 0 ? (v - peak) / peak : 0;
    mdd = Math.min(mdd, dd);
  }
  return { cagr, volatility: vol, sharpe, max_drawdown: mdd, total_return: totalReturn };
}

function MetricCard({
  title,
  metrics,
  subtitle,
  highlight,
}: {
  title: string;
  metrics?: Metrics;
  subtitle?: string;
  highlight?: boolean;
}) {
  const sharpeColor =
    (metrics?.sharpe ?? 0) >= 1.0 ? "#16a34a" :
    (metrics?.sharpe ?? 0) >= 0.5 ? "#2563eb" : "#dc2626";

  return (
    <div style={{
      border: highlight ? "2px solid #4f46e5" : "1px solid #ddd",
      borderRadius: 16, padding: 18, background: "#fff",
    }}>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>{title}</div>
      {subtitle && <div style={{ color: "#666", fontSize: 13, marginBottom: 12 }}>{subtitle}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        <div>
          <div style={{ color: "#666", fontSize: 13 }}>CAGR</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: (metrics?.cagr ?? 0) >= 0 ? "#16a34a" : "#dc2626" }}>
            {formatPct(metrics?.cagr, 1)}
          </div>
        </div>
        <div>
          <div style={{ color: "#666", fontSize: 13 }}>Sharpe</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: sharpeColor }}>
            {formatNum(metrics?.sharpe, 2)}
          </div>
        </div>
        <div>
          <div style={{ color: "#666", fontSize: 13 }}>Max Drawdown</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#dc2626" }}>
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

const PERIOD_LABELS: Record<Period, string> = {
  is:  "IS (2014–2019)",
  oos: "OOS (2020–현재)",
  "3y": "3Y",
  "5y": "5Y",
  "10y": "10Y (전체)",
};

export default function BacktestPage() {
  const [period, setPeriod] = useState<Period>("oos");

  const [regimeSummary, setRegimeSummary] = useState<BacktestSummary | null>(null);
  const [regimeCurve, setRegimeCurve]     = useState<RegimeCurvePoint[]>([]);
  const [scoreCorr, setScoreCorr]         = useState<ScoreCorrelation | null>(null);

  useEffect(() => {
    fetch("/data/backtest_regime_result.json").then((r) => r.json()).then(setRegimeSummary).catch(() => {});
    fetch("/data/equity_curve_regime.json").then((r) => r.json()).then(setRegimeCurve).catch(() => {});
    fetch("/data/score_correlation.json").then((r) => r.json()).then(setScoreCorr).catch(() => {});
  }, []);

  // 전체 에쿼티 커브를 date-keyed map으로 병합
  const mergedCurve: MergedCurvePoint[] = useMemo(() => {
    const map = new Map<string, MergedCurvePoint>();
    for (const row of regimeCurve) {
      map.set(row.date, { date: row.date, regime: row.strategy, spy: row.benchmark });
    }
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [regimeCurve]);

  // 선택 기간으로 필터 후 rebase
  const filteredCurve: MergedCurvePoint[] = useMemo(() => {
    if (!mergedCurve.length) return [];
    const { start, end } = getPeriodRange(period);
    const sliced = mergedCurve.filter((row) => {
      const d = new Date(row.date);
      if (start && d < start) return false;
      if (end   && d > end)   return false;
      return true;
    });
    return rebaseCurve(sliced);
  }, [mergedCurve, period]);

  // 기간별 전략 메트릭 — IS/OOS는 커브에서 직접 계산
  const regimeMetrics: Metrics = useMemo(() => {
    if (period === "is" || period === "oos") {
      const values = filteredCurve.map((p) => p.regime).filter((v): v is number => v != null);
      return computeMetricsFromEquity(values);
    }
    const fromJson = regimeSummary?.subperiods?.find((p) => p.label === period)?.metrics;
    return fromJson ?? regimeSummary?.metrics ?? {};
  }, [period, filteredCurve, regimeSummary]);

  // 기간별 SPY 메트릭 — 커브에서 직접 계산
  const spyMetrics: Metrics = useMemo(() => {
    const values = filteredCurve.map((p) => p.spy).filter((v): v is number => v != null);
    return computeMetricsFromEquity(values);
  }, [filteredCurve]);

  // IS/OOS generalization ratio
  const generalizationRatio: number | null = useMemo(() => {
    if (period !== "oos" && period !== "is") return null;
    const isVals  = mergedCurve
      .filter((p) => p.date >= IS_START  && p.date <= IS_END)
      .map((p) => p.regime).filter((v): v is number => v != null);
    const oosVals = mergedCurve
      .filter((p) => p.date >= OOS_START)
      .map((p) => p.regime).filter((v): v is number => v != null);
    const isSharpe  = computeMetricsFromEquity(isVals).sharpe;
    const oosSharpe = computeMetricsFromEquity(oosVals).sharpe;
    if (!isSharpe || isSharpe <= 0 || oosSharpe == null) return null;
    return oosSharpe / isSharpe;
  }, [mergedCurve, period]);

  const corrChartData = scoreCorr?.data?.map((x) => ({
    quantile: x.quantile,
    avg_return_pct: x.avg_return * 100,
  })) ?? [];

  if (!regimeSummary) return <div style={{ padding: 40 }}>Loading...</div>;

  const strategy    = regimeSummary.strategy;
  const regimeInfo  = strategy?.regime_filter;
  const pc          = strategy?.portfolio_construction;
  const benchTicker = regimeSummary.benchmark?.ticker ?? regimeInfo?.benchmark ?? "SPY";

  const regimeSubtitle =
    period === "is"  ? `IS (In-Sample): ${IS_START} ~ ${IS_END}` :
    period === "oos" ? `OOS (Out-of-Sample): ${OOS_START} ~ 현재` :
    regimeInfo
      ? `${benchTicker} ${regimeInfo.ma_window ?? 200}DMA + ${regimeInfo.momentum_window ?? 63}D momentum`
      : "Regime filtered strategy";

  // 10y 전체 차트에서만 IS/OOS 경계선 표시
  const showBoundary = period === "10y";

  return (
    <div style={{ padding: 40, maxWidth: 1240, margin: "0 auto" }}>
      <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 8 }}>Backtest</h1>
      <div style={{ color: "#555", marginBottom: 20 }}>
        Regime-Filtered Strategy · SPY {regimeInfo?.ma_window ?? 200}DMA ·
        Risk-off {formatPct(regimeInfo?.risk_off_exposure, 0)}
      </div>

      {/* 기간 탭 */}
      <div style={{ display: "flex", gap: 8, marginBottom: 28, flexWrap: "wrap" }}>
        {(["is", "oos", "3y", "5y", "10y"] as Period[]).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            style={{
              padding: "8px 16px",
              borderRadius: 10,
              border: "1px solid #ddd",
              background: period === p
                ? p === "is" ? "#7c3aed" : p === "oos" ? "#4f46e5" : "#111"
                : "#fff",
              color: period === p ? "#fff" : "#111",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            {PERIOD_LABELS[p]}
          </button>
        ))}
      </div>

      {/* IS/OOS 일반화 배너 */}
      {generalizationRatio !== null && (
        <div style={{
          padding: "12px 18px",
          borderRadius: 12,
          marginBottom: 20,
          background: generalizationRatio >= 0.7 ? "#dcfce7" : generalizationRatio >= 0.5 ? "#fef9c3" : "#fee2e2",
          color: generalizationRatio >= 0.7 ? "#15803d" : generalizationRatio >= 0.5 ? "#854d0e" : "#b91c1c",
          fontWeight: 600,
          fontSize: 14,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}>
          <span>
            일반화 ratio (OOS Sharpe / IS Sharpe) = {generalizationRatio.toFixed(2)}
          </span>
          <span style={{ fontWeight: 400 }}>
            {generalizationRatio >= 0.7 ? "✓ PASS — 과적합 없음" :
             generalizationRatio >= 0.5 ? "~ MARGINAL — 경계" : "✗ FAIL — 과적합 의심"}
          </span>
        </div>
      )}

      {/* 메트릭 카드 */}
      <div style={{ display: "grid", gap: 16, marginBottom: 24 }}>
        <MetricCard
          title={`Regime Strategy · ${PERIOD_LABELS[period]}`}
          subtitle={regimeSubtitle}
          metrics={regimeMetrics}
          highlight={period === "oos"}
        />
        <MetricCard
          title={`Benchmark (${benchTicker}) · ${PERIOD_LABELS[period]}`}
          metrics={spyMetrics}
        />
      </div>

      {/* 에쿼티 커브 차트 */}
      <div style={{
        border: "1px solid #ddd", borderRadius: 16,
        padding: 20, background: "#fff", marginBottom: 28,
      }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>
          SPY vs Regime · {PERIOD_LABELS[period]}
        </h2>
        <div style={{ color: "#666", fontSize: 13, marginBottom: 16 }}>
          {showBoundary
            ? "수직 점선: IS/OOS 경계 (2020-01-01). 좌측 IS(학습), 우측 OOS(검증)"
            : "기간 시작 기준 1.0으로 재기준화"}
        </div>

        <ResponsiveContainer width="100%" height={460}>
          <LineChart data={filteredCurve}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" minTickGap={40} tick={{ fontSize: 11 }} />
            <YAxis domain={["auto", "auto"]} tickFormatter={(v) => v.toFixed(1)} />
            <Tooltip formatter={(v) => (typeof v === "number" ? v.toFixed(4) : v)} />
            <Legend />
            {showBoundary && (
              <ReferenceLine
                x={OOS_START}
                stroke="#7c3aed"
                strokeDasharray="5 5"
                strokeWidth={2}
                label={{ value: "OOS →", position: "insideTopRight", fill: "#7c3aed", fontSize: 12 }}
              />
            )}
            <Line type="monotone" dataKey="spy" name="SPY" stroke="#16a34a" dot={false} strokeWidth={2} />
            <Line type="monotone" dataKey="regime" name="Regime Strategy" stroke="#dc2626" dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Strategy Details */}
      <div style={{
        border: "1px solid #ddd", borderRadius: 16,
        padding: 20, background: "#fff", marginBottom: 28,
      }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Strategy Details</h2>
        <div style={{ color: "#666", marginBottom: 16, fontSize: 13 }}>
          backtest_regime_result.json 기준
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 20 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Regime Filter</div>
            <div style={{ color: "#555", fontSize: 14, lineHeight: 1.8 }}>
              <div>Benchmark: {formatText(benchTicker)}</div>
              <div>MA window: {formatText(regimeInfo?.ma_window)}D</div>
              <div>Momentum window: {formatText(regimeInfo?.momentum_window)}D</div>
              <div>Buffer: {formatPct(regimeInfo?.buffer, 2)}</div>
              <div>Confirm days: {formatText(regimeInfo?.confirm_days)}D</div>
              <div>Stock rebalance: {formatText(regimeInfo?.stock_rebalance)}</div>
              <div>
                Exposure rebalance:{" "}
                <strong style={{ color: regimeInfo?.exposure_rebalance === "daily" ? "#dc2626" : "inherit" }}>
                  {formatText(regimeInfo?.exposure_rebalance)}
                </strong>
              </div>
              <div>VIX crash filter: <strong>{formatText(regimeInfo?.vix_crash_filter)}</strong></div>
              <div>
                Exposure: {formatPct(regimeInfo?.risk_on_exposure)} /{" "}
                {formatPct(regimeInfo?.mid_exposure)} /{" "}
                {formatPct(regimeInfo?.risk_off_exposure)}
              </div>
              <div>Defensive: {regimeInfo?.defensive_tickers?.join(" / ") ?? "-"}</div>
            </div>
          </div>

          <div>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Portfolio Construction</div>
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
              <div>Weight min / max: {formatPct(pc?.min_weight)} / {formatPct(pc?.max_weight)}</div>
              <div>Vol floor: {pc?.vol_floor != null ? pc.vol_floor.toFixed(3) : "-"}</div>
              <div>Abs momentum 63D &gt; {formatPct(pc?.absolute_momentum_63d_min, 1)}</div>
              <div>Abs momentum 252D &gt; {formatPct(pc?.absolute_momentum_252d_min, 1)}</div>
              <div>Sector cap: {formatText(pc?.sector_max_names)} names</div>
              <div>News filter: <strong>Regex Hard-Kill Active</strong></div>
            </div>
          </div>
        </div>

        {regimeInfo?.summary && (
          <div style={{ marginTop: 16, padding: 14, borderRadius: 12, background: "#f6f6f6", color: "#444", fontSize: 14 }}>
            {regimeInfo.summary}
          </div>
        )}
        {pc?.formula && (
          <div style={{ marginTop: 12, padding: 14, borderRadius: 12, background: "#fafafa", color: "#444", fontSize: 14 }}>
            <strong>Weight formula:</strong> {pc.formula}
          </div>
        )}

        {regimeSummary.notes && regimeSummary.notes.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Notes</div>
            <div style={{ color: "#555", fontSize: 14, lineHeight: 1.8 }}>
              {regimeSummary.notes.map((note, idx) => <div key={idx}>• {note}</div>)}
            </div>
          </div>
        )}
      </div>

      {/* Score to Return Correlation */}
      <div style={{ border: "1px solid #ddd", borderRadius: 16, padding: 20, background: "#fff" }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
          Score → Future Return Correlation
        </h2>
        <div style={{ color: "#666", marginBottom: 16, fontSize: 13 }}>
          점수 분위수별 {scoreCorr?.forward_days ?? 20}거래일 선행수익률 평균
        </div>
        <ResponsiveContainer width="100%" height={360}>
          <BarChart data={corrChartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="quantile" />
            <YAxis tickFormatter={(v) => `${Number(v).toFixed(1)}%`} />
            <Tooltip formatter={(v) => `${Number(v).toFixed(2)}%`} />
            <Legend />
            <Bar dataKey="avg_return_pct" name="Avg Forward Return" fill="#7c3aed" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
