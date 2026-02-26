"use client";

import { useEffect, useState } from "react";

type QuotePayload = {
  ticker: string;
  updated_at_utc: string;
  quote: { price: number | null; change: number | null; changePct: number | null; prevClose: number | null };
  range52w: { high: number | null; low: number | null };
  marketCap: number | null;
};

function fmtNum(x: number | null, digits = 2) {
  if (x === null || Number.isNaN(x)) return "-";
  return x.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export default function OverviewClient({ ticker }: { ticker: string }) {
  const [data, setData] = useState<QuotePayload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      setErr(null);
      try {
        const res = await fetch(`/api/quote?ticker=${encodeURIComponent(ticker)}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as QuotePayload;
        if (!alive) return;
        setData(json);
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message || "Failed to load quote");
        setData(null);
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, [ticker]);

  return (
    <div className="rounded-xl border p-4">
      <h2 className="font-semibold mb-3">Overview</h2>

      {err && <div className="text-sm text-red-600">Error: {err}</div>}
      {!err && !data && <div className="text-sm text-gray-600">Loading...</div>}

      {!err && data && (
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg border p-3">
            <div className="text-gray-500">Price</div>
            <div className="text-lg font-semibold">${fmtNum(data.quote.price, 2)}</div>
            <div className="text-gray-500">
              {fmtNum(data.quote.change, 2)} ({fmtNum(data.quote.changePct, 2)}%)
            </div>
          </div>

          <div className="rounded-lg border p-3">
            <div className="text-gray-500">Market Cap (approx.)</div>
            <div className="text-lg font-semibold">
              {data.marketCap == null ? "-" : `$${fmtNum(data.marketCap, 0)}M`}
            </div>
            <div className="text-gray-500">Finnhub metric (often USD million)</div>
          </div>

          <div className="rounded-lg border p-3">
            <div className="text-gray-500">52W High</div>
            <div className="text-lg font-semibold">${fmtNum(data.range52w.high, 2)}</div>
          </div>

          <div className="rounded-lg border p-3">
            <div className="text-gray-500">52W Low</div>
            <div className="text-lg font-semibold">${fmtNum(data.range52w.low, 2)}</div>
          </div>
        </div>
      )}
    </div>
  );
}
