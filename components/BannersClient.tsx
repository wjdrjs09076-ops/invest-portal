"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type BannerItem = {
  ticker: string;
  label?: string;   // 예: "20D 12.3%"
  reason?: string;  // optional
};

type BannerSection = {
  title: string;    // 예: "Momentum TOP"
  items: BannerItem[];
};

type UniverseBlock = {
  universe: string;         // "S&P 500" / "NASDAQ-100" / "Dow 30"
  sections: BannerSection[]; // 3개 섹션(모멘텀/리버설/리스크)
};

type BannersJson = {
  generated_at_utc?: string;
  universes?: UniverseBlock[];
};

export default function BannersClient() {
  const url = process.env.NEXT_PUBLIC_BANNERS_URL;

  const [data, setData] = useState<BannersJson | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    async function load() {
      setErr(null);
      setData(null);

      try {
        if (!url) throw new Error("NEXT_PUBLIC_BANNERS_URL is missing in .env.local");

        const res = await fetch(url, { cache: "no-store" });
        const text = await res.text();

        if (!res.ok) {
          throw new Error(`HTTP ${res.status} - ${text.slice(0, 120)}`);
        }
        if (!text.trim()) {
          throw new Error("Empty response (banners.json is empty)");
        }

        const json = JSON.parse(text) as BannersJson;

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

  const universes = useMemo(() => data?.universes || [], [data]);

  function UniverseCard({ u }: { u: UniverseBlock }) {
    const updated = data?.generated_at_utc;

    return (
      <div className="rounded-xl border p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{u.universe}</h2>
          {updated && <div className="text-xs text-gray-500">{updated}</div>}
        </div>

        <div className="grid grid-cols-1 gap-3">
          {u.sections?.map((sec) => (
            <div key={sec.title} className="rounded-lg border p-3">
              <div className="font-semibold mb-2">{sec.title}</div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {(sec.items || []).slice(0, 10).map((it) => (
                  <Link
                    key={`${sec.title}-${it.ticker}`}
                    href={`/company/${encodeURIComponent(it.ticker)}`}
                    className="block rounded-lg border px-3 py-2 hover:bg-gray-50"
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-semibold">{it.ticker}</div>
                      {it.label && <div className="text-xs text-gray-500">{it.label}</div>}
                    </div>
                    {it.reason ? (
                      <div className="text-xs text-gray-600 line-clamp-2">{it.reason}</div>
                    ) : (
                      <div className="text-xs text-gray-600">Open company page</div>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Market Portal</h1>

      {err && <div className="rounded-xl border p-4 text-sm text-red-600">Error: {err}</div>}
      {!err && !data && <div className="rounded-xl border p-4 text-sm text-gray-600">Loading banners…</div>}

      {!err && data && universes.length === 0 && (
        <div className="rounded-xl border p-4 text-sm text-gray-600">
          No banner data yet. Check GitHub Actions / banners.json.
        </div>
      )}

      {universes.map((u) => (
        <UniverseCard key={u.universe} u={u} />
      ))}
    </div>
  );
}
