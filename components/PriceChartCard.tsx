"use client";

import { useEffect, useMemo, useState } from "react";

type RangeKey = "1M" | "3M" | "6M" | "1Y";

type ChartPoint = {
  date: string;
  close: number;
};

type ChartPayload = {
  ticker: string;
  range: RangeKey;
  currency: string;
  points: ChartPoint[];
  latest_close: number;
  first_close: number;
  generated_at_utc: string;
  source: string;
};

const RANGES: RangeKey[] = ["1M", "3M", "6M", "1Y"];

function formatPrice(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return value.toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
}

function formatPct(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function formatDateLabel(iso: string, range: RangeKey) {
  const d = new Date(iso);
  if (range === "1Y") {
    return d.toLocaleDateString(undefined, { year: "2-digit", month: "short" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function buildPath(points: ChartPoint[], width: number, height: number, padding: number) {
  if (!points.length) return "";

  const closes = points.map((p) => p.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;

  return points
    .map((p, i) => {
      const x =
        padding + (i / Math.max(points.length - 1, 1)) * (width - padding * 2);
      const y =
        height -
        padding -
        ((p.close - min) / span) * (height - padding * 2);

      return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function yPosition(
  value: number,
  min: number,
  max: number,
  height: number,
  padding: number
) {
  const span = max - min || 1;
  return height - padding - ((value - min) / span) * (height - padding * 2);
}

export default function PriceChartCard({ ticker }: { ticker: string }) {
  const [range, setRange] = useState<RangeKey>("6M");
  const [data, setData] = useState<ChartPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      setErr(null);

      try {
        const res = await fetch(
          `/api/chart?ticker=${encodeURIComponent(ticker)}&range=${range}`,
          { cache: "no-store" }
        );

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const json = (await res.json()) as ChartPayload;
        if (!alive) return;
        setData(json);
      } catch (e: unknown) {
        if (!alive) return;
        setErr(e instanceof Error ? e.message : String(e));
        setData(null);
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, [ticker, range]);

  const chart = useMemo(() => {
    const points = data?.points ?? [];
    const width = 760;
    const height = 280;
    const padding = 28;

    if (!points.length) {
      return {
        width,
        height,
        padding,
        path: "",
        min: 0,
        max: 0,
      };
    }

    const closes = points.map((p) => p.close);
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const path = buildPath(points, width, height, padding);

    return { width, height, padding, path, min, max };
  }, [data]);

  const perf = useMemo(() => {
    if (!data) return null;
    if (!data.first_close || !data.latest_close) return null;
    return ((data.latest_close / data.first_close) - 1) * 100;
  }, [data]);

  const hoverPoint =
    hoverIndex !== null && data?.points?.[hoverIndex]
      ? data.points[hoverIndex]
      : null;

  return (
    <section className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold">Price Chart</h3>
          <div className="mt-1 text-sm text-gray-500">
            Recent close trend with selectable time range
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                range === r
                  ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                  : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="rounded-xl border bg-gray-50 p-6 text-sm text-gray-600">
          Loading chart...
        </div>
      ) : err ? (
        <div className="rounded-xl border border-red-300 bg-red-50 p-6 text-sm text-red-700">
          Failed to load chart: {err}
        </div>
      ) : !data || !data.points?.length ? (
        <div className="rounded-xl border bg-gray-50 p-6 text-sm text-gray-600">
          No chart data available.
        </div>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-gray-50 p-3">
              <div className="text-xs text-gray-500">Latest Close</div>
              <div className="mt-1 text-lg font-semibold">
                {formatPrice(data.latest_close)} {data.currency}
              </div>
            </div>

            <div className="rounded-xl bg-gray-50 p-3">
              <div className="text-xs text-gray-500">{range} Return</div>
              <div className="mt-1 text-lg font-semibold">
                {formatPct(perf)}
              </div>
            </div>

            <div className="rounded-xl bg-gray-50 p-3">
              <div className="text-xs text-gray-500">Range</div>
              <div className="mt-1 text-lg font-semibold">{range}</div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[760px]">
              <svg
                viewBox={`0 0 ${chart.width} ${chart.height}`}
                className="h-[280px] w-full"
                onMouseLeave={() => setHoverIndex(null)}
              >
                {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                  const y =
                    chart.padding +
                    ratio * (chart.height - chart.padding * 2);
                  return (
                    <line
                      key={ratio}
                      x1={chart.padding}
                      x2={chart.width - chart.padding}
                      y1={y}
                      y2={y}
                      stroke="#e5e7eb"
                      strokeWidth="1"
                    />
                  );
                })}

                <path
                  d={chart.path}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  className="text-indigo-600"
                />

                {data.points.map((p, i) => {
                  const x =
                    chart.padding +
                    (i / Math.max(data.points.length - 1, 1)) *
                      (chart.width - chart.padding * 2);
                  const y = yPosition(
                    p.close,
                    chart.min,
                    chart.max,
                    chart.height,
                    chart.padding
                  );

                  return (
                    <circle
                      key={`${p.date}-${i}`}
                      cx={x}
                      cy={y}
                      r={hoverIndex === i ? 4 : 2}
                      fill={hoverIndex === i ? "#4f46e5" : "transparent"}
                      stroke={hoverIndex === i ? "#4f46e5" : "transparent"}
                      onMouseEnter={() => setHoverIndex(i)}
                    />
                  );
                })}

                <text
                  x={chart.padding}
                  y={18}
                  fontSize="12"
                  fill="#6b7280"
                >
                  {formatPrice(chart.max)}
                </text>
                <text
                  x={chart.padding}
                  y={chart.height - 8}
                  fontSize="12"
                  fill="#6b7280"
                >
                  {formatPrice(chart.min)}
                </text>
              </svg>
            </div>
          </div>

          <div className="mt-3 flex flex-col gap-2 text-sm text-gray-600 sm:flex-row sm:items-center sm:justify-between">
            <div>
              {hoverPoint ? (
                <>
                  <span className="font-medium text-gray-800">
                    {formatDateLabel(hoverPoint.date, range)}
                  </span>
                  {" · "}
                  {formatPrice(hoverPoint.close)} {data.currency}
                </>
              ) : (
                <>Hover over the chart to inspect daily closes.</>
              )}
            </div>

            <div className="text-xs text-gray-500">
              Source: {data.source} · {data.generated_at_utc}
            </div>
          </div>
        </>
      )}
    </section>
  );
}