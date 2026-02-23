type BannerItem = { ticker: string; label?: string; reason?: string };
type BannerSection = { title: string; items: BannerItem[] };
type UniverseBlock = { universe: string; sections: BannerSection[] };
type BannersPayload = { generated_at_utc: string; universes: UniverseBlock[] };

async function fetchBanners(): Promise<BannersPayload | null> {
  const url = process.env.NEXT_PUBLIC_BANNERS_URL;
  if (!url) return null;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  return res.json();
}

export default async function BannerSection() {
  const data = await fetchBanners();

  if (!data) {
    return (
      <div className="rounded-xl border p-4">
        <div className="font-semibold">Banners</div>
        <div className="text-sm text-gray-600">No banner data. Check NEXT_PUBLIC_BANNERS_URL.</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-sm text-gray-500">Updated: {data.generated_at_utc}</div>

      {data.universes.map((u) => (
        <div key={u.universe} className="rounded-xl border p-4">
          <div className="mb-3 text-lg font-semibold">{u.universe}</div>

          <div className="grid gap-4 md:grid-cols-3">
            {u.sections.map((sec) => (
              <div key={sec.title} className="rounded-xl border p-3">
                <div className="mb-2 font-medium">{sec.title}</div>
                <div className="space-y-2">
                  {sec.items.slice(0, 8).map((it) => (
                    <a
                      key={it.ticker}
                      href={`/company/${encodeURIComponent(it.ticker)}`}
                      className="flex items-center justify-between rounded-lg border px-3 py-2 hover:bg-gray-50"
                    >
                      <div className="font-semibold">{it.ticker}</div>
                      <div className="text-sm text-gray-600">{it.label ?? ""}</div>
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
