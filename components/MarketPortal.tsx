"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type BannerItem = {
  ticker: string;
  label?: string;
  reason?: string;
};

type BannerSection = {
  title: string;
  items: BannerItem[];
};

type Universe = {
  universe: string;
  sections: BannerSection[];
};

type BannersPayload = {
  generated_at_utc: string;
  universes: Universe[];
};

function Badge({ text }: { text: string }) {
  const lower = text.toLowerCase();
  const cls =
    lower.includes("buy")
      ? "border-green-300 bg-green-50 text-green-800"
      : lower.includes("sell")
      ? "border-red-300 bg-red-50 text-red-800"
      : "border-gray-300 bg-gray-50 text-gray-800";

  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${cls}`}
    >
      {text}
    </span>
  );
}

function Card({ item }: { item: BannerItem }) {
  const badgeText = item.label?.includes("BUY")
    ? "BUY"
    : item.label?.includes("SELL")
    ? "SELL"
    : "WATCH";

  return (
    <Link
      href={`/company/${encodeURIComponent(item.ticker)}`}
      className="block rounded-xl border p-4 hover:bg-gray-50 transition"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-lg font-bold">{item.ticker}</div>
        <Badge text={badgeText} />
      </div>

      {item.label && <div className="mt-1 text-sm text-gray-700">{item.label}</div>}
      {item.reason && <div className="mt-1 text-xs text-gray-500">{item.reason}</div>}
    </Link>
  );
}

export default function MarketPortal() {
  const url = process.env.NEXT_PUBLIC_BANNERS_URL;

  const [data, setData] = useState<BannersPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    async function load() {
      if (!url) {
        setErr("NEXT_PUBLIC_BANNERS_URL is missing");
        return;
      }

      try {
        setErr(null);
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as BannersPayload;
        if (!alive) return;
        setData(json);
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message || "Failed to load banners");
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, [url]);

  const highlights = useMemo(() => {
    if (!data?.universes) return [];
    const out: { universe: string; items: BannerItem[] }[] = [];

    for (const u of data.universes) {
      const sec = (u.sections || []).find((s) => s.title === "Today's BUY Candidates");
      if (sec && sec.items && sec.items.length) {
        out.push({ universe: u.universe, items: sec.items.slice(0, 3) }); // ✅ 상위 3개만
      }
    }
    return out;
  }, [data]);

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
        <div className="text-xs text-gray-500">{data.generated_at_utc}</div>
      </div>

      {highlights.length === 0 ? (
        <div className="rounded-xl border p-4 text-sm text-gray-600">
          No candidates right now. (Check banner generation / scoring rules.)
        </div>
      ) : (
        <div className="space-y-8">
          {highlights.map((g) => (
            <div key={g.universe} className="space-y-3">
              {/* ✅ 유니버스 제목 + Top3 문구 */}
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-gray-700">{g.universe}</div>

                <div className="text-xs font-semibold text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full border border-indigo-200">
                  🔥 Top 3 Recommended Today
                </div>
              </div>

              {/* ✅ 업그레이드 설명 문구 */}
              <div className="text-xs text-gray-500">
                Ranked by composite score (Momentum + RSI + Short-term strength + Risk).
              </div>

              {/* ✅ 상위 3개 카드 */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {g.items.map((it, idx) => (
                  <Card key={`${it.ticker}-${idx}`} item={it} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}