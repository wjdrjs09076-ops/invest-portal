"use client";

import { useEffect, useMemo, useState } from "react";

type RecResponse = {
  ticker: string;
  generated_at_utc?: string;

  // 기존
  signal?: string; // BUY / WATCH / AVOID ...
  score?: number;

  diagnostics?: {
    score_norm?: number;
    coverage?: number; // 0~1
    penalty_factor?: number;

    used?: {
      growth?: boolean;
      margin?: boolean;
      value?: boolean;
      used_total_weight?: number;
    };

    breakdown?: {
      growth?: number;
      margin?: number;
      value?: number;
      raw_total?: number;
    };

    summary?: {
      revenue_cagr?: number | null;
      op_margin?: number | null;
      fcf_margin?: number | null;
      fcf_trend?: string | null;
      pe?: number | null;
      ps?: number | null;
    };
  };

  // ✅ (추가) API에서 내려주면 우선 사용
  effective_signal?: string; // BUY/WATCH/AVOID...
  confidence?: "LOW" | "MEDIUM" | "HIGH";
  warnings?: string[];

  error?: string;
  message?: string;
};

function pct(x: number) {
  return `${(x * 100).toFixed(1)}%`;
}
function num(x: number) {
  if (!Number.isFinite(x)) return "N/A";
  return x.toFixed(2);
}
function badgeTone(signal: string) {
  if (signal === "BUY") return "bg-green-50 border-green-300 text-green-800";
  if (signal === "AVOID") return "bg-red-50 border-red-300 text-red-800";
  return "bg-gray-50 border-gray-300 text-gray-800";
}
function confidenceTone(level: "LOW" | "MEDIUM" | "HIGH") {
  if (level === "HIGH") return "bg-green-50 border-green-300 text-green-800";
  if (level === "MEDIUM") return "bg-yellow-50 border-yellow-300 text-yellow-800";
  return "bg-red-50 border-red-300 text-red-800";
}

export default function RecommendationClient({ ticker }: { ticker: string }) {
  const [data, setData] = useState<RecResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);

    fetch(`/api/recommendation?ticker=${encodeURIComponent(ticker)}`, {
      cache: "no-store",
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const txt = await r.text();
        if (!txt) throw new Error("Empty response");
        return JSON.parse(txt) as RecResponse;
      })
      .then((json) => {
        if (cancelled) return;
        if (json?.error) throw new Error(json.message || json.error);
        setData(json);
      })
      .catch((e: any) => {
        if (cancelled) return;
        setErr(String(e?.message || e));
        setData(null);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [ticker]);

  const computed = useMemo(() => {
    const coverage = data?.diagnostics?.coverage ?? null;
    const baseSignal = (data?.signal || "WATCH").toUpperCase();
    const used = data?.diagnostics?.used || {};
    const summary = data?.diagnostics?.summary || {};

    // ✅ 1) API가 내려주면 그걸 최우선으로 사용
    const apiEffective = data?.effective_signal?.toUpperCase();
    const apiConf = data?.confidence;

    // ✅ 2) 없으면 프론트에서 fallback 계산 (기존 방식)
    let confidence: "LOW" | "MEDIUM" | "HIGH" = "MEDIUM";
    if (apiConf) confidence = apiConf;
    else if (coverage !== null) {
      if (coverage < 0.4) confidence = "LOW";
      else if (coverage >= 0.7) confidence = "HIGH";
      else confidence = "MEDIUM";
    }

    let effectiveSignal = apiEffective || baseSignal;
    if (!apiEffective && coverage !== null && coverage < 0.4) {
      effectiveSignal = "WATCH"; // low coverage면 AVOID 방지
    }

    const reasons: string[] = [];
    if (coverage !== null) reasons.push(`Coverage ${pct(coverage)}`);

    const parts: string[] = [];
    if (used.growth) parts.push("Growth");
    if (used.margin) parts.push("Margin");
    if (used.value) parts.push("Value");
    reasons.push(`Used: ${parts.length ? parts.join(" + ") : "(none)"}`);

    const notes: string[] = [];
    // API warnings 있으면 우선 표시
    if (data?.warnings?.length) notes.push(...data.warnings);

    // 없으면 기본 안내
    if (!data?.warnings?.length) {
      if ((coverage ?? 1) < 0.4) notes.push("⚠ Low data coverage: treat as WATCH, not a negative call.");
      else if (!used.growth || !used.margin) notes.push("Some fundamentals missing; score may be less reliable.");
    }

    const summaryBits: string[] = [];
    if (summary.revenue_cagr != null) summaryBits.push(`Rev CAGR ${pct(summary.revenue_cagr)}`);
    if (summary.op_margin != null) summaryBits.push(`Op Mgn ${pct(summary.op_margin)}`);
    if (summary.fcf_trend) summaryBits.push(`FCF Trend ${summary.fcf_trend}`);
    const summaryLine = summaryBits.length ? summaryBits.join(" / ") : null;

    return {
      coverage,
      confidence,
      baseSignal,
      effectiveSignal,
      reasons,
      notes,
      summaryLine,
      pe: summary.pe,
      ps: summary.ps,
    };
  }, [data]);

  return (
    <div className="rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold mb-1">Recommendation</h2>
          <p className="text-xs text-gray-500">
            {data?.generated_at_utc ? data.generated_at_utc : ""}
          </p>
        </div>

        <div className="flex gap-2 items-center">
          <span className={`text-xs px-2 py-1 rounded-full border ${badgeTone(computed.effectiveSignal)}`}>
            {computed.effectiveSignal}
          </span>

          <span
            className={`text-xs px-2 py-1 rounded-full border ${confidenceTone(computed.confidence)}`}
            title="Reliability based on data coverage."
          >
            {computed.confidence} CONF
          </span>
        </div>
      </div>

      {loading && <p className="text-sm text-gray-600 mt-2">Loading…</p>}

      {!loading && err && (
        <div className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          Error: {err}
        </div>
      )}

      {!loading && !err && data && (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border p-3">
              <div className="text-xs text-gray-500">Score</div>
              <div className="text-2xl font-bold">{data.score ?? "N/A"}</div>
              <div className="text-xs text-gray-500">
                Norm {data.diagnostics?.score_norm ?? "N/A"} / Penalty {data.diagnostics?.penalty_factor ?? "N/A"}
              </div>
            </div>

            <div className="rounded-lg border p-3">
              <div className="text-xs text-gray-500">Valuation</div>
              <div className="text-sm">P/E: {computed.pe == null ? "N/A" : num(computed.pe)}</div>
              <div className="text-sm">P/S: {computed.ps == null ? "N/A" : num(computed.ps)}</div>
            </div>
          </div>

          {computed.summaryLine && (
            <div className="rounded-lg border p-3 text-sm">
              <span className="font-semibold">Auto Summary:</span> {computed.summaryLine}
            </div>
          )}

          <div className="text-sm text-gray-700">
            <ul className="list-disc ml-5 space-y-1">
              {computed.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>

          {computed.notes.length > 0 && (
            <div className="rounded-lg border bg-gray-50 p-3 text-sm text-gray-800">
              {computed.notes.map((n, i) => (
                <div key={i}>{n}</div>
              ))}
            </div>
          )}

          {computed.baseSignal !== computed.effectiveSignal && (
            <div className="text-xs text-gray-500">
              Base signal was <b>{computed.baseSignal}</b>, but adjusted to <b>{computed.effectiveSignal}</b> due to low coverage.
            </div>
          )}
        </div>
      )}
    </div>
  );
}