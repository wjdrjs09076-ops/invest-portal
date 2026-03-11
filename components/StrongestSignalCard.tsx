"use client";

import { useEffect, useState } from "react";
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

type ScoreSnapshot = {
  generated_at?: string;
  groups?: Array<{
    key: string;
    label: string;
    description?: string;
    top3: SnapshotItem[];
  }>;
  sp500?: SnapshotItem[];
  nasdaq100?: SnapshotItem[];
  dow30?: SnapshotItem[];
};

export default function StrongestSignalCard() {
  const [item, setItem] = useState<SnapshotItem | null>(null);

  useEffect(() => {
    fetch("/data/score_snapshot.json")
      .then((r) => r.json())
      .then((data: ScoreSnapshot) => {
        const pools = [
          ...(data.sp500 ?? []),
          ...(data.nasdaq100 ?? []),
          ...(data.dow30 ?? []),
        ];

        if (!pools.length) return;

        const sorted = [...pools].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
        setItem(sorted[0] ?? null);
      })
      .catch(() => {});
  }, []);

  if (!item) return null;

  return (
    <div className="border rounded-xl p-5 bg-white shadow-sm">
      <div className="text-sm text-gray-500 mb-2">🔥 Today&apos;s Strongest Signal</div>

      <div className="flex items-center justify-between mb-3">
        <div className="text-2xl font-bold">{item.ticker}</div>
        <div className="text-lg font-semibold text-blue-600">
          Score {item.score ?? "-"}
        </div>
      </div>

      <div className="text-sm text-gray-600 mb-4">
        {item.sector || "Unknown"} · {item.signal || item.label || "N/A"}
      </div>

      <div className="grid grid-cols-3 gap-3 text-sm mb-4">
        <div className="rounded-lg bg-gray-50 p-3">
          <div className="text-gray-500">20D</div>
          <div className="font-semibold">
            {item.ret20d != null ? `${item.ret20d > 0 ? "+" : ""}${item.ret20d.toFixed(1)}%` : "N/A"}
          </div>
        </div>

        <div className="rounded-lg bg-gray-50 p-3">
          <div className="text-gray-500">RSI</div>
          <div className="font-semibold">
            {item.rsi != null ? item.rsi.toFixed(1) : "N/A"}
          </div>
        </div>

        <div className="rounded-lg bg-gray-50 p-3">
          <div className="text-gray-500">Sector</div>
          <div className="font-semibold">
            {item.sector_strength_20d != null
              ? `${item.sector_strength_20d > 0 ? "+" : ""}${item.sector_strength_20d.toFixed(1)}%`
              : "N/A"}
          </div>
        </div>
      </div>

      <div className="text-sm text-gray-700 mb-4 leading-6">
        {item.ret20d != null && item.ret20d > 0 && "Strong 20D momentum. "}
        {item.sector_strength_20d != null && item.sector_strength_20d > 0 && "Sector is outperforming. "}
        {item.dd60 != null && item.dd60 > -0.12 && "Drawdown remains relatively contained. "}
      </div>

      <Link
        href={`/company/${item.ticker}`}
        className="text-sm text-blue-600 hover:underline"
      >
        View detailed analysis →
      </Link>
    </div>
  );
}