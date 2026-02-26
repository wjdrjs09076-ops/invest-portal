"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SearchBar() {
  const router = useRouter();
  const [q, setQ] = useState("");

  function go() {
    const t = q.trim().toUpperCase();
    if (!t) return;
    router.push(`/company/${encodeURIComponent(t)}`);
  }

  return (
    <div className="flex gap-2">
      <input
        className="w-full rounded-lg border px-3 py-2"
        placeholder="Search ticker (e.g., AAPL)"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") go();
        }}
      />
      <button
        className="rounded-lg border px-4 py-2 hover:bg-gray-100"
        onClick={go}
      >
        Search
      </button>
    </div>
  );
}
