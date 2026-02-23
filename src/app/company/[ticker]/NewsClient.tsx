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

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/news?ticker=${encodeURIComponent(ticker)}&limit=25`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setItems(d?.items || []);
      })
      .catch(() => {
        if (!alive) return;
        setItems([]);
      })
      .finally(() => {
        if (!alive) return;
        setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [ticker]);

  return (
    <div className="rounded-xl border p-4">
      <div className="mb-3 text-lg font-semibold">News</div>

      {loading ? (
        <div className="text-sm text-gray-600">Loading...</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-gray-600">No news found.</div>
      ) : (
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
