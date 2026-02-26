import SearchBar from "@/components/SearchBar";
import MarketPortal from "@/components/MarketPortal";

export default function Home() {
  return (
    <main className="mx-auto max-w-4xl p-8 space-y-6">
      <h1 className="text-3xl font-bold">Invest Portal</h1>

      <p className="text-gray-600">
        Search a US stock ticker to view overview, financials, news, and signals.
      </p>

      <SearchBar />

      <MarketPortal />
    </main>
  );
}