import MultiplesButton from "@/components/MultiplesButton";
import NewsClient from "./NewsClient";

export default function CompanyPage({ params }: { params: { ticker: string } }) {
  const ticker = decodeURIComponent(params.ticker).toUpperCase();

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{ticker}</h1>
          <p className="text-gray-600">Overview / Financial summary / News / Recommendation</p>
        </div>
        <MultiplesButton />
      </div>

      <div className="rounded-xl border p-4">
        <div className="mb-2 text-lg font-semibold">Overview</div>
        <div className="text-sm text-gray-600">MVP: price/market cap/52w range will be added next.</div>
      </div>

      <div className="rounded-xl border p-4">
        <div className="mb-2 text-lg font-semibold">Financials (Summary)</div>
        <div className="text-sm text-gray-600">MVP: revenue/op income/FCF/cash/debt summary will be added next.</div>
      </div>

      <NewsClient ticker={ticker} />

      <div className="rounded-xl border p-4">
        <div className="mb-2 text-lg font-semibold">Recommendation</div>
        <div className="text-sm text-gray-600">MVP: score + checklist will be added next.</div>
      </div>
    </main>
  );
}
