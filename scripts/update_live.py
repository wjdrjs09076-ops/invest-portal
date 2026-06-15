#!/usr/bin/env python3
"""
update_live.py — 라이브 성과 페이지(public/data/live_performance.json) 일일 갱신 (자체 완결형)

invest-portal repo 안에서 단독 실행 가능(invest-data 의존성 없음).
진실원천 = Alpaca Portfolio History API. 버그로 desync 되던 yfinance×목표가중치
추정 방식(구 invest-data/update_live_performance.py)을 폐기하고 이걸로 대체.

- LIVE_SINCE(또는 --since): 정상거래 재시작 기준일. 이 날짜 직전 종가=1.0 으로
  재기준화하고 그 이후만 표시(2026-06 버그 왜곡 구간 제외).
- 표본 5거래일 미만이면 연환산 지표(CAGR/Sharpe)는 null → 페이지에서 "—".

환경변수: ALPACA_API_KEY, ALPACA_SECRET_KEY  (paper)
사용:     python scripts/update_live.py --since 2026-06-15
"""
from __future__ import annotations

import argparse
import json
import math
import os
import datetime as dt
from pathlib import Path

import yfinance as yf
import pandas as pd
from alpaca.trading.client import TradingClient
from alpaca.trading.requests import GetPortfolioHistoryRequest

ROOT        = Path(__file__).resolve().parents[1]          # invest-portal/
PUBLIC_DATA = ROOT / "public" / "data"

API_KEY    = os.environ.get("ALPACA_API_KEY", "")
SECRET_KEY = os.environ.get("ALPACA_SECRET_KEY", "")
MIN_DAYS_FOR_ANNUAL = 5


def _load_json(path: Path):
    if path.exists():
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return None


def fetch_equity_curve(tc):
    h = tc.get_portfolio_history(GetPortfolioHistoryRequest(period="2M", timeframe="1D"))
    out = []
    for t, e in zip(h.timestamp, h.equity):
        if e and e > 0:
            d = dt.datetime.fromtimestamp(t, dt.timezone.utc).strftime("%Y-%m-%d")
            out.append((d, float(e)))
    return out, float(h.base_value or 100000.0)


def fetch_spy(start: str, end: str) -> dict[str, float]:
    raw = yf.download("SPY", start=start,
                      end=(pd.Timestamp(end) + pd.Timedelta(days=1)).strftime("%Y-%m-%d"),
                      auto_adjust=True, progress=False)
    if raw is None or raw.empty:
        return {}
    close = raw["Close"]
    if isinstance(close, pd.DataFrame):
        close = close.iloc[:, 0]
    return {str(idx.date()): float(v) for idx, v in close.items()}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default=os.environ.get("LIVE_SINCE"),
                    help="정상거래 기준일 YYYY-MM-DD (기본: env LIVE_SINCE)")
    args = ap.parse_args()
    if not API_KEY or not SECRET_KEY:
        raise SystemExit("[오류] ALPACA_API_KEY / ALPACA_SECRET_KEY 미설정")

    tc = TradingClient(API_KEY, SECRET_KEY, paper=True)
    curve, base = fetch_equity_curve(tc)
    if not curve:
        raise SystemExit("[오류] Alpaca equity 곡선 비어있음")

    acct = tc.get_account()
    pv   = float(acct.portfolio_value)
    cash = float(acct.cash)
    pos  = {p.symbol: float(p.market_value) for p in tc.get_all_positions()}

    # 당일 일별포인트가 아직 없으면 현재 계좌 equity로 보강
    today_str = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d")
    if curve[-1][0] < today_str and pv > 0:
        curve.append((today_str, pv))

    # 기준일 리셋 — 기준일 '직전 종가'를 새 1.0 베이스로
    if args.since:
        prior       = [e for d, e in curve if d < args.since]
        since_curve = [(d, e) for d, e in curve if d >= args.since]
        if not since_curve:
            raise SystemExit(f"[오류] {args.since} 이후 데이터 없음 (장 마감 후 재실행)")
        base  = prior[-1] if prior else since_curve[0][1]
        curve = since_curve

    start_date, end_date = curve[0][0], curve[-1][0]
    spy = fetch_spy(start_date, end_date)
    spy_base = next((spy[d] for d in sorted(spy) if d >= start_date), None)

    daily, running_max, prev_eq, last_spy = [], 1.0, base, spy_base
    for d, eq in curve:
        equity = eq / base
        dr = eq / prev_eq - 1.0
        prev_eq = eq
        running_max = max(running_max, equity)
        if d in spy:
            last_spy = spy[d]
        bench = (last_spy / spy_base) if (spy_base and last_spy) else 1.0
        daily.append({
            "date": d, "equity": round(equity, 6), "daily_return": round(dr, 6),
            "drawdown": round(equity / running_max - 1.0, 6), "benchmark": round(bench, 6),
            "regime": "live", "stock_exposure": round((pv - cash) / pv, 4) if pv else 1.0,
        })

    n = len(daily)
    total_ret = daily[-1]["equity"] - 1.0
    years = n / 252
    cagr = daily[-1]["equity"] ** (1 / years) - 1.0 if years > 0 else 0.0
    rets = [x["daily_return"] for x in daily[1:]]
    if rets:
        mean_r = sum(rets) / len(rets)
        vol = (sum((r - mean_r) ** 2 for r in rets) / len(rets)) ** 0.5 * math.sqrt(252)
    else:
        vol = 0.0
    sharpe = cagr / vol if vol > 0 else 0.0
    mdd = min(x["drawdown"] for x in daily)
    if n < MIN_DAYS_FOR_ANNUAL:
        cagr = sharpe = None

    current_portfolio = {t: round(v / pv, 6) for t, v in pos.items()}
    if cash > 0 and pv > 0:
        current_portfolio["CASH"] = round(cash / pv, 6)

    regime = _load_json(PUBLIC_DATA / "market_regime.json") or {}

    data = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "live_start": start_date,
        "strategy_label": "Alpaca Paper Account (live equity, MA200+VIX regime overlay)",
        "source": "alpaca_portfolio_history",
        "summary": {
            "total_return": round(total_ret, 6), "days": n,
            "cagr": round(cagr, 6) if cagr is not None else None,
            "sharpe": round(sharpe, 4) if sharpe is not None else None,
            "mdd": round(mdd, 6),
            "last_date": daily[-1]["date"], "last_equity": daily[-1]["equity"],
        },
        "account_value": round(pv, 2), "cash": round(cash, 2),
        "current_portfolio": current_portfolio,
        "regime_bucket": str(regime.get("regime", "live")).lower(),
        "stock_exposure": round((pv - cash) / pv, 4) if pv else 1.0,
        "daily": daily,
    }
    PUBLIC_DATA.mkdir(parents=True, exist_ok=True)
    with open(PUBLIC_DATA / "live_performance.json", "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    sh = f"{sharpe:.2f}" if sharpe is not None else "—"
    print(f"[OK] {start_date}~{end_date} {n}일  누적 {total_ret:+.2%}  Sharpe {sh}  "
          f"계좌 ${pv:,.0f} 현금 ${cash:,.0f}  보유 {len(pos)}종목")


if __name__ == "__main__":
    main()
