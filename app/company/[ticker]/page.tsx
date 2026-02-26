import Link from "next/link";
import SearchBar from "@/components/SearchBar";

import RecommendationClient from "./RecommendationClient";
import OverviewClient from "./OverviewClient";
import NewsClient from "./NewsClient";
import FinancialsClient from "@/components/FinancialsClient";

export default async function CompanyPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker: raw } = await params;
  const ticker = decodeURIComponent(raw).toUpperCase();

  return (
    <main className="mx-auto max-w-4xl p-8 space-y-6">
      {/* ✅ 상단 헤더 + 즉시 재검색 */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold">{ticker}</h1>
            <Link
              href="/"
              className="text-sm text-gray-600 underline underline-offset-4"
            >
              Home
            </Link>
          </div>
          <p className="text-sm text-gray-600">
            Search another ticker without going back.
          </p>
        </div>

        {/* ✅ 여기서 바로 다른 종목 검색 */}
        <div className="min-w-[420px] max-w-[520px] w-full">
          <SearchBar />
        </div>
      </div>

      {/* ✅ Overview */}
      <OverviewClient ticker={ticker} />

      {/* ✅ Recommendation */}
      <RecommendationClient ticker={ticker} />

      {/* ✅ News */}
      <NewsClient ticker={ticker} />

      {/* ✅ Financials */}
      <FinancialsClient ticker={ticker} />
    </main>
  );
}