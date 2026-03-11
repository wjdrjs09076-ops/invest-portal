"use client";

import { useEffect, useState } from "react";

export default function StrategyPage() {

  const [backtest, setBacktest] = useState<any>(null);
  const [corr, setCorr] = useState<any>(null);
  const [topn, setTopn] = useState<any>(null);
  const [sector, setSector] = useState<any>(null);

  useEffect(() => {

    async function load() {

      const b = await fetch("/data/backtest_result.json").then(r => r.json());
      const c = await fetch("/data/score_correlation.json").then(r => r.json());
      const t = await fetch("/data/topn_sensitivity.json").then(r => r.json());
      const s = await fetch("/data/sector_exposure.json").then(r => r.json());

      setBacktest(b);
      setCorr(c);
      setTopn(t);
      setSector(s);
    }

    load();

  }, []);

  return (

    <main className="mx-auto max-w-5xl p-8 space-y-10">

      <h1 className="text-3xl font-bold">
        Strategy Lab
      </h1>

      {/* BACKTEST */}

      {backtest && (

        <section className="space-y-3">

          <h2 className="text-xl font-semibold">
            Backtest Performance
          </h2>

          <div className="grid grid-cols-2 gap-4">

            <div className="border p-4 rounded">
              CAGR
              <div className="text-2xl font-bold">
                {(backtest.metrics.cagr * 100).toFixed(1)}%
              </div>
            </div>

            <div className="border p-4 rounded">
              Sharpe
              <div className="text-2xl font-bold">
                {backtest.metrics.sharpe.toFixed(2)}
              </div>
            </div>

            <div className="border p-4 rounded">
              Max Drawdown
              <div className="text-2xl font-bold">
                {(backtest.metrics.max_drawdown * 100).toFixed(1)}%
              </div>
            </div>

            <div className="border p-4 rounded">
              Total Return
              <div className="text-2xl font-bold">
                {(backtest.metrics.total_return * 100).toFixed(0)}%
              </div>
            </div>

          </div>

        </section>

      )}

      {/* SCORE CORRELATION */}

      {corr && (

        <section className="space-y-3">

          <h2 className="text-xl font-semibold">
            Score → Future Return
          </h2>

          <div className="border p-4 rounded">

            {corr.quantiles.map((q:any,i:number)=>(
              <div key={i} className="flex justify-between py-1">

                <span>Quantile {q.quantile}</span>

                <span>
                  {(q.avg_return * 100).toFixed(2)}%
                </span>

              </div>
            ))}

          </div>

        </section>

      )}

      {/* TOP N */}

      {topn && (

        <section className="space-y-3">

          <h2 className="text-xl font-semibold">
            Top-N Sensitivity
          </h2>

          <div className="space-y-2">

            {topn.results.map((r:any,i:number)=>(
              <div key={i} className="border p-4 rounded">

                Top {r.top_n}

                <div className="text-sm text-gray-600">

                  CAGR {(r.metrics.cagr*100).toFixed(1)}% | Sharpe {r.metrics.sharpe.toFixed(2)}

                </div>

              </div>
            ))}

          </div>

        </section>

      )}

      {/* SECTOR */}

      {sector && (

        <section className="space-y-3">

          <h2 className="text-xl font-semibold">
            Sector Exposure
          </h2>

          <div className="space-y-2">

            {sector.avg_sector_exposure.map((s:any,i:number)=>(
              <div key={i} className="flex justify-between border p-3 rounded">

                <span>{s.sector}</span>

                <span>
                  {(s.weight*100).toFixed(0)}%
                </span>

              </div>
            ))}

          </div>

        </section>

      )}

    </main>

  );

}