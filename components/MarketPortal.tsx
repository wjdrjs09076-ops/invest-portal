"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type SnapshotItem = {
  ticker: string;
  signal?: string;
  label?: string;
  score?: number | null;
  sector?: string;
  close?: number | null;
  rsi?: number | null;
  ret5d?: number | null;
  ret20d?: number | null;
  vol20?: number | null;
  dd60?: number | null;
  stock_score_raw?: number | null;
  sector_strength_20d?: number | null;
  sector_score?: number | null;
  risk_score?: number | null;
  final_score_raw?: number | null;
};

type SnapshotGroup = {
  key: string;
  label: string;
  description?: string;
  top3: SnapshotItem[];
  count?: number;
};

type ScoreSnapshotPayload = {
  generated_at?: string;
  generated_at_utc?: string;
  weights?: Record<string, number>;
  method?: {
    summary?: string;
    notes?: string[];
  };
  groups?: SnapshotGroup[];
  sp500?: SnapshotItem[];
  nasdaq100?: SnapshotItem[];
  dow30?: SnapshotItem[];
};

function formatNumber(value?: number | null, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return value.toFixed(digits);
}

function formatPercent(value?: number | null, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

function formatSigned(value?: number | null, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}`;
}

function Badge({ text }: { text: string }) {
  const lower = text.toLowerCase();

  const cls =
    lower.includes("buy")
      ? "border-green-300 bg-green-50 text-green-800"
      : lower.includes("avoid")
      ? "border-red-300 bg-red-50 text-red-800"
      : lower.includes("hold")
      ? "border-yellow-300 bg-yellow-50 text-yellow-800"
      : "border-blue-300 bg-blue-50 text-blue-800";

  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${cls}`}
    >
      {text}
    </span>
  );
}

function Card({ item }: { item: SnapshotItem }) {
  const badgeText = item.signal || item.label || "WATCH";

  return (
    <Link
      href={`/company/${encodeURIComponent(item.ticker)}`}
      className="block rounded-xl border p-4 hover:bg-gray-50 transition"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-bold">{item.ticker}</div>
          <div className="mt-1 text-sm text-gray-600">
            {item.sector || "Unknown"}
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          <Badge text={badgeText} />
          <div className="text-sm font-semibold text-indigo-700">
            Score {item.score ?? "-"}
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
        <div className="rounded-lg bg-gray-50 p-2">
          <div className="text-gray-500">RSI</div>
          <div className="mt-1 font-semibold">{formatNumber(item.rsi, 1)}</div>
        </div>

        <div className="rounded-lg bg-gray-50 p-2">
          <div className="text-gray-500">5D</div>
          <div className="mt-1 font-semibold">{formatPercent(item.ret5d, 1)}</div>
        </div>

        <div className="rounded-lg bg-gray-50 p-2">
          <div className="text-gray-500">20D</div>
          <div className="mt-1 font-semibold">{formatPercent(item.ret20d, 1)}</div>
        </div>
      </div>

      <div className="mt-3 space-y-1 text-xs text-gray-600">
        <div>
          <span className="font-medium text-gray-700">Sector strength:</span>{" "}
          {formatPercent(item.sector_strength_20d, 2)}
        </div>
        <div>
          <span className="font-medium text-gray-700">Risk score:</span>{" "}
          {formatSigned(item.risk_score, 2)}
        </div>
        <div>
          <span className="font-medium text-gray-700">Vol(20D):</span>{" "}
          {formatNumber(item.vol20, 3)}
          {" · "}
          <span className="font-medium text-gray-700">DD(60D):</span>{" "}
          {formatPercent(
            item.dd60 !== null && item.dd60 !== undefined ? item.dd60 * 100 : null,
            1
          )}
        </div>
      </div>
    </Link>
  );
}

export default function MarketPortal() {
  const url = process.env.NEXT_PUBLIC_SCORE_SNAPSHOT_URL;

  const [data, setData] = useState<ScoreSnapshotPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    async function load() {
      if (!url) {
        setErr("NEXT_PUBLIC_SCORE_SNAPSHOT_URL is missing");
        return;
      }

      try {
        setErr(null);
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as ScoreSnapshotPayload;
        if (!alive) return;
        setData(json);
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message || "Failed to load score snapshot");
      }
    }

    load();

    return () => {
      alive = false;
    };
  }, [url]);

  const groups = useMemo(() => {
    if (!data) return [];

    if (Array.isArray(data.groups) && data.groups.length > 0) {
      return data.groups.map((g) => ({
        key: g.key,
        label: g.label,
        description:
          g.description ||
          "Ranked by composite score (Momentum + RSI + Sector strength + Risk).",
        top3: Array.isArray(g.top3) ? g.top3.slice(0, 3) : [],
      }));
    }

    return [
      {
        key: "sp500",
        label: "S&P 500",
        description:
          "Ranked by composite score (Momentum + RSI + Sector strength + Risk).",
        top3: Array.isArray(data.sp500) ? data.sp500.slice(0, 3) : [],
      },
      {
        key: "nasdaq100",
        label: "NASDAQ-100",
        description:
          "Ranked by composite score (Momentum + RSI + Sector strength + Risk).",
        top3: Array.isArray(data.nasdaq100) ? data.nasdaq100.slice(0, 3) : [],
      },
      {
        key: "dow30",
        label: "Dow 30",
        description:
          "Ranked by composite score (Momentum + RSI + Sector strength + Risk).",
        top3: Array.isArray(data.dow30) ? data.dow30.slice(0, 3) : [],
      },
    ].filter((g) => g.top3.length > 0);
  }, [data]);

  const generatedAt = data?.generated_at || data?.generated_at_utc || "-";

  if (err) {
    return (
      <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-700">
        Error: {err}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-xl border p-4 text-sm text-gray-600">
        Loading market portal...
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Market Portal</h2>
        <div className="text-xs text-gray-500">{generatedAt}</div>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-xl border p-4 text-sm text-gray-600">
          No candidates right now. (Check score snapshot generation.)
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map((g) => (
            <div key={g.key} className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-gray-700">{g.label}</div>

                <div className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-600">
                  🔥 Top 3 Recommended Today
                </div>
              </div>

              <div className="text-xs text-gray-500">{g.description}</div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {g.top3.map((it, idx) => (
                  <Card key={`${g.key}-${it.ticker}-${idx}`} item={it} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}