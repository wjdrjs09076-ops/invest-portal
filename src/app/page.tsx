import BannerSection from "@/components/BannerSection";
import SearchBar from "@/components/SearchBar";

export default function Home() {
  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Invest Portal</h1>
        <p className="text-gray-600">Search a US ticker to view overview, financial summary, news, and signals.</p>
      </div>

      <SearchBar />
      <BannerSection />
    </main>
  );
}
