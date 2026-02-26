"use client";

import { useEffect, useState } from "react";

type NewsItem = {
  title: string;
  url: string;
  domain?: string;
  seendate?: string;
};

export default function NewsClient({ ticker }: { ticker: string }) {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/news?ticker=${encodeURIComponent(ticker)}&limit=25`, {
          cache: "no-store",
        });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status} ${text.slice(0, 120)}`);
        }

        const data = await res.json();
        if (!alive) return;

        setItems(data?.items || []);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message || "Failed to load news.");
        setItems([]);
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, [ticker]);

  return (
    <div className="rounded-xl border p-4">
      <div className="mb-3 text-lg font-semibold">News</div>

      {loading && <div className="text-sm text-gray-600">Loading...</div>}

      {!loading && error && <div className="text-sm text-red-600">Error: {error}</div>}

      {!loading && !error && items.length === 0 && (
        <div className="text-sm text-gray-600">No news found.</div>
      )}

      {!loading && !error && items.length > 0 && (
        <div className="space-y-2">
          {items.map((n, i) => (
            <a
              key={i}
              href={n.url}
              target="_blank"
              rel="noreferrer"
              className="block rounded-lg border px-3 py-2 hover:bg-gray-50"
            >
              <div className="font-medium">{n.title}</div>
              <div className="text-xs text-gray-500">
                {n.domain || "source"} {n.seendate ? `• ${n.seendate}` : ""}
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
