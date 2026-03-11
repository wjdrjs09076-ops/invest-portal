"use client";

import { useEffect, useMemo, useState } from "react";

type RangeKey = "1M" | "3M" | "6M" | "1Y";

type ChartPoint = {
  date: string;
  close: number;
  volume: number | null;
};

type ChartPayload = {
  ticker: string;
  range: RangeKey;
  currency: string;
  points: ChartPoint[];
  latest_close: number;
  first_close: number;
  latest_volume: number | null;
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

function formatVolume(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";

  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(2)}B`;
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return String(Math.round(value));
}

function formatDateLabel(iso: string, range: RangeKey) {
  const d = new Date(iso);
  if (range === "1M") {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  if (range === "3M" || range === "6M") {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString(undefined, { year: "2-digit", month: "short" });
}

function buildLinePath(
  points: ChartPoint[],
  width: number,
  height: number,
  padding: number
) {
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
  return (
    height - padding - ((value - min) / span) * (height - padding * 2)
  );
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
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message || "Failed to load chart");
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

  const priceChart = useMemo(() => {
    const points = data?.points ?? [];
    const width = 760;
    const height = 240;
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
    const path = buildLinePath(points, width, height, padding);

    return { width, height, padding, path, min, max };
  }, [data]);

  const volumeChart = useMemo(() => {
    const points = data?.points ?? [];
    const width = 760;
    const height = 110;
    const padding = 16;

    const vols = points
      .map((p) => p.volume)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));

    const maxVol = vols.length ? Math.max(...vols) : 0;

    return {
      width,
      height,
      padding,
      maxVol,
    };
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
            Price trend with selectable time range and daily trading volume
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
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-4">
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

            <div className="rounded-xl bg-gray-50 p-3">
              <div className="text-xs text-gray-500">Latest Volume</div>
              <div className="mt-1 text-lg font-semibold">
                {formatVolume(data.latest_volume)}
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[760px]">
              <svg
                viewBox={`0 0 ${priceChart.width} ${priceChart.height}`}
                className="h-[240px] w-full"
                onMouseLeave={() => setHoverIndex(null)}
              >
                {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                  const y =
                    priceChart.padding +
                    ratio * (priceChart.height - priceChart.padding * 2);
                  return (
                    <line
                      key={ratio}
                      x1={priceChart.padding}
                      x2={priceChart.width - priceChart.padding}
                      y1={y}
                      y2={y}
                      stroke="#e5e7eb"
                      strokeWidth="1"
                    />
                  );
                })}

                <path
                  d={priceChart.path}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  className="text-indigo-600"
                />

                {data.points.map((p, i) => {
                  const x =
                    priceChart.padding +
                    (i / Math.max(data.points.length - 1, 1)) *
                      (priceChart.width - priceChart.padding * 2);
                  const y = yPosition(
                    p.close,
                    priceChart.min,
                    priceChart.max,
                    priceChart.height,
                    priceChart.padding
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
                  x={priceChart.padding}
                  y={18}
                  fontSize="12"
                  fill="#6b7280"
                >
                  {formatPrice(priceChart.max)}
                </text>
                <text
                  x={priceChart.padding}
                  y={priceChart.height - 8}
                  fontSize="12"
                  fill="#6b7280"
                >
                  {formatPrice(priceChart.min)}
                </text>
              </svg>

              <div className="mt-2 text-xs font-medium text-gray-500">
                Daily Volume
              </div>

              <svg
                viewBox={`0 0 ${volumeChart.width} ${volumeChart.height}`}
                className="h-[110px] w-full"
              >
                <line
                  x1={volumeChart.padding}
                  x2={volumeChart.width - volumeChart.padding}
                  y1={volumeChart.height - volumeChart.padding}
                  y2={volumeChart.height - volumeChart.padding}
                  stroke="#e5e7eb"
                  strokeWidth="1"
                />

                {data.points.map((p, i) => {
                  const x =
                    volumeChart.padding +
                    (i / Math.max(data.points.length - 1, 1)) *
                      (volumeChart.width - volumeChart.padding * 2);

                  const barWidth = Math.max(
                    2,
                    (volumeChart.width - volumeChart.padding * 2) /
                      Math.max(data.points.length, 1) *
                      0.7
                  );

                  const vol =
                    typeof p.volume === "number" && Number.isFinite(p.volume)
                      ? p.volume
                      : 0;

                  const h =
                    volumeChart.maxVol > 0
                      ? (vol / volumeChart.maxVol) *
                        (volumeChart.height - volumeChart.padding * 2)
                      : 0;

                  const y = volumeChart.height - volumeChart.padding - h;

                  const active = hoverIndex === i;

                  return (
                    <rect
                      key={`${p.date}-vol-${i}`}
                      x={x - barWidth / 2}
                      y={y}
                      width={barWidth}
                      height={Math.max(1, h)}
                      rx={1.5}
                      fill={active ? "#4f46e5" : "#c7d2fe"}
                      onMouseEnter={() => setHoverIndex(i)}
                    />
                  );
                })}

                <text
                  x={volumeChart.padding}
                  y={14}
                  fontSize="12"
                  fill="#6b7280"
                >
                  {formatVolume(volumeChart.maxVol)}
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
                  {" · Close "}
                  {formatPrice(hoverPoint.close)} {data.currency}
                  {" · Vol "}
                  {formatVolume(hoverPoint.volume)}
                </>
              ) : (
                <>Hover over the chart to inspect price and volume.</>
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