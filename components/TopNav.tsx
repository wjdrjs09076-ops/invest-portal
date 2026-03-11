import Link from "next/link";

export default function TopNav() {
  return (
    <header className="border-b bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="text-xl font-bold">
          Invest Portal
        </Link>

        <nav className="flex items-center gap-6 text-sm text-gray-700">
          <Link href="/" className="hover:text-black">
            Discover
          </Link>
          <Link href="/backtest" className="hover:text-black">
            Backtest
          </Link>
          <Link href="/strategy" className="hover:text-black">
            Strategy Lab
          </Link>
        </nav>
      </div>
    </header>
  );
}