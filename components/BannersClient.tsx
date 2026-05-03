"use client";

import { useEffect, useMemo, useState } from "react";

type BannerItem = {
  ticker: string;
  label?: string;
  reason?: string;
};

type BannerSection = {
  title: string;
  items: BannerItem[];
};

type BannerUniverse = {
  universe: string;
  sections: BannerSection[];
};

type BannersPayload = {
  generated_at_utc: string;
  universes: BannerUniverse[];
};

type Reco = {
  ticker: string;
  generated_at_utc: string;
  signal: "BUY" | "WATCH" | "HOLD" | "AVOID";
  score: number;
  diagnostics?: {
    coverage?: number;
    low_conf?: boolean;
    penalty_factor?: number;
    score_norm?: number;
  };
};

function fmtIsoShort(iso?: string) {
  if (!iso) return "";
  return iso.replace("T", " ").replace("Z", "");
}

function uniq(arr: string[]) {
  return Array.from(new Set(arr));
}

function signalBadge(signal: Reco["signal"]) {
  if (signal === "BUY") return "BUY";
  if (signal === "WATCH") return "WATCH";
  if (signal === "HOLD") return "HOLD";
  return "AVOID";
}

export default function BannersClient() {
  const bannersUrl =
    process.env.NEXT_PUBLIC_BANNERS_URL ||
    "https://raw.githubusercontent.com/wjdrjs09076-ops/invest-data/main/data/banners.json";

  const [data, setData] = useState<BannersPayload | null>(null);
  const [recos, setRecos] = useState<Record<string, Reco>>({});
  const [error, setError] = useState<string | null>(null);

  // 1) banners.json fetch
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setError(null);
        const res = await fetch(bannersUrl, { cache: "no-store" });
        const txt = await res.text();
        if (!txt || txt.trim().length === 0) {
          throw new Error("Empty response (banners.json is empty)");
        }
        const json = JSON.parse(txt) as BannersPayload;
        if (alive) setData(json);
      } catch (e: any) {
        if (alive) setError(`Error: ${String(e?.message || e)}`);
      }
    })();
    return () => {
      alive = false;
    };
  }, [bannersUrl]);

  // 후보 티커 모으기(각 유니버스의 모든 섹션 items에서)
  const allTickers = useMemo(() => {
    if (!data?.universes) return [];
    const list: string[] = [];
    for (const u of data.universes) {
      for (const s of u.sections || []) {
        for (const it of s.items || []) {
          if (it?.ticker) list.push(String(it.ticker).toUpperCase());
        }
      }
    }
    return uniq(list);
  }, [data]);

  // 2) 후보 티커들에 대해 /api/banner-recos로 recommendation fetch
  useEffect(() => {
    if (!allTickers.length) return;
    let alive = true;

    (async () => {
      try {
        const qs = encodeURIComponent(allTickers.join(","));
        const res = await fetch(`/api/banner-recos?tickers=${qs}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`banner-recos HTTP ${res.status}`);
        const j = await res.json();
        const items = (j.items || []) as Reco[];
        const map: Record<string, Reco> = {};
        for (const r of items) map[r.ticker.toUpperCase()] = r;
        if (alive) setRecos(map);
      } catch (e: any) {
        // recos 못 가져와도 banners는 보여주고, 점수는 label로 fallback 가능
        if (alive) console.error(e);
      }
    })();

    return () => {
      alive = false;
    };
  }, [allTickers]);

  if (error) {
    return (
      <div className="rounded-xl border p-4">
        <h2 className="font-semibold mb-2">Market Portal</h2>
        <div className="rounded-lg border border-red-300 p-3 text-red-600">{error}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-xl border p-4">
        <h2 className="font-semibold mb-2">Market Portal</h2>
        <p className="text-sm text-gray-600">Loading…</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border p-4 space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Market Portal</h2>
        </div>
        <div className="text-xs text-gray-500">{data.generated_at_utc}</div>
      </div>

      {data.universes.map((u) => {
        // 이 유니버스에서 후보 티커 모으기
        const tickers: string[] = [];
        for (const s of u.sections || []) for (const it of s.items || []) tickers.push(it.ticker);

        const uniqTickers = uniq(tickers.map((t) => String(t).toUpperCase()));

        // recommendation 결과가 있는 것만 모아서 점수 정렬
        const scored = uniqTickers
          .map((t) => recos[t])
          .filter((x): x is Reco => x !== undefined)
          .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

        const top3 = scored.slice(0, 3);

        if (top3.length === 0) return null;

        return (
          <section key={u.universe} className=”space-y-3”>
            <div className=”flex items-center justify-between gap-4”>
              <h3 className=”font-semibold”>{u.universe}</h3>

              {/* ✅ 문구: Top3가 “추천 상위 3개 종목”임을 명시 */}
              <span className=”text-xs rounded-full border px-3 py-1 bg-blue-50 text-blue-700”>
                🔥 Top 3 Recommended Today (same as Company score)
              </span>
            </div>

            <p className=”text-sm text-gray-600”>
              Ranked by <b>Company Recommendation Score</b> (same engine used on the company page).
            </p>

            <div className=”grid gap-4 md:grid-cols-2”>
              {top3.map((r) => {
                const lowConf = Boolean(r.diagnostics?.low_conf);
                const coverage = r.diagnostics?.coverage;

                return (
                  <a
                    key={r.ticker}
                    href={`/company/${encodeURIComponent(r.ticker)}`}
                    className="rounded-xl border p-4 hover:bg-gray-50 transition"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="text-xl font-bold">{r.ticker}</div>
                        <div className="text-sm text-gray-700">
                          {r.signal} • score {r.score}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-xs rounded border px-2 py-0.5">
                          {signalBadge(r.signal)}
                        </span>
                        {lowConf && (
                          <span className="text-xs rounded border border-red-300 text-red-600 px-2 py-0.5">
                            LOW CONF
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="mt-2 text-xs text-gray-500">
                      Coverage: {typeof coverage === "number" ? `${Math.round(coverage * 100)}%` : "N/A"} •{" "}
                      {fmtIsoShort(r.generated_at_utc)}
                    </div>
                  </a>
                );
              })}
            </div>

          </section>
        );
      })}
    </div>
  );
}