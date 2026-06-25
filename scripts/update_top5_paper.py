#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
update_top5_paper.py — Top-5 전향 실험 페이퍼 계좌의 '브로커 검증' equity 트랙 갱신

별도 Alpaca paper 계좌(2026-06-25 $100k 시작)의 실제 equity를 매일 누적.
진실원천 = get_account().equity. update_live.py와 동일 방식(당일 append + 직전일
last_equity 보정). 기준선 = 100000(6/25=1.0). 벤치 SPY(yfinance).

환경변수: ALPACA_TOP5_API_KEY, ALPACA_TOP5_SECRET_KEY
출력: public/data/top5_paper_performance.json (live 페이지 스키마)
"""
from __future__ import annotations
import json, math, os, datetime as dt
from pathlib import Path
import yfinance as yf, pandas as pd
from alpaca.trading.client import TradingClient

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public" / "data"
PERF = PUBLIC / "top5_paper_performance.json"
API = os.environ.get("ALPACA_TOP5_API_KEY", "")
SEC = os.environ.get("ALPACA_TOP5_SECRET_KEY", "")
BASELINE = 100000.0
LIVE_START = "2026-06-25"
MIN_DAYS_ANNUAL = 60


def _load(p):
    return json.load(open(p, encoding="utf-8")) if p.exists() else {}


def fetch_spy(start, end):
    raw = yf.download("SPY", start=start, end=(pd.Timestamp(end)+pd.Timedelta(days=1)).strftime("%Y-%m-%d"),
                      auto_adjust=True, progress=False)
    if raw is None or raw.empty: return {}
    c = raw["Close"]
    if isinstance(c, pd.DataFrame): c = c.iloc[:, 0]
    return {str(i.date()): float(v) for i, v in c.items()}


def main():
    if not API or not SEC:
        raise SystemExit("[오류] ALPACA_TOP5 키 미설정")
    tc = TradingClient(API, SEC, paper=True)
    acct = tc.get_account()
    eq, cash, pv = float(acct.equity), float(acct.cash), float(acct.portfolio_value)
    last_eq = float(getattr(acct, "last_equity", 0) or 0)
    pos = {p.symbol: float(p.market_value) for p in tc.get_all_positions()}
    clock = tc.get_clock()
    today = clock.timestamp.strftime("%Y-%m-%d")
    market_open = bool(clock.is_open)

    prev = _load(PERF)
    usd = {d["date"]: float(d["equity"]) * BASELINE for d in prev.get("daily", [])}
    prior = [dd for dd in usd if dd < today]
    if last_eq > 0 and prior:
        usd[max(prior)] = last_eq            # 직전일 공식종가 self-heal
    if not market_open or not usd:
        usd[today] = eq                       # 당일은 마감 후에만 기록

    dates = sorted(usd)
    if not dates:
        print("[대기] 아직 거래일 없음"); return
    spy = fetch_spy(dates[0], dates[-1])
    spy_base = next((spy[d] for d in sorted(spy) if d >= dates[0]), None)

    daily, hwm, prev_eq, last_spy = [], 1.0, BASELINE, spy_base
    for d in dates:
        e = usd[d]; equity = e / BASELINE
        dr = e / prev_eq - 1.0; prev_eq = e
        hwm = max(hwm, equity)
        if d in spy: last_spy = spy[d]
        bench = (last_spy / spy_base) if (spy_base and last_spy) else 1.0
        daily.append({"date": d, "equity": round(equity, 6), "daily_return": round(dr, 6),
                      "drawdown": round(equity/hwm-1, 6), "benchmark": round(bench, 6),
                      "regime": "live", "stock_exposure": round((pv-cash)/pv, 4) if pv else 1.0})

    n = len(daily); total = daily[-1]["equity"] - 1.0
    rets = [x["daily_return"] for x in daily[1:]]
    vol = (sum((x-sum(rets)/len(rets))**2 for x in rets)/len(rets))**0.5*math.sqrt(252) if rets else 0.0
    years = n/252; cagr = daily[-1]["equity"]**(1/years)-1.0 if years > 0 else 0.0
    sharpe = cagr/vol if vol > 0 else 0.0; mdd = min(x["drawdown"] for x in daily)
    if n < MIN_DAYS_ANNUAL: cagr = sharpe = None
    cp = {t: round(v/pv, 6) for t, v in pos.items()}
    if cash > 0 and pv: cp["CASH"] = round(cash/pv, 6)

    data = {"generated_at": dt.datetime.now(dt.timezone.utc).isoformat(), "live_start": LIVE_START,
            "strategy_label": "Top-5 전향 검증 (Alpaca 페이퍼 실계좌 · 브로커 검증)",
            "source": "alpaca_top5_paper", "baseline_equity": BASELINE,
            "summary": {"total_return": round(total, 6), "days": n,
                        "cagr": round(cagr, 6) if cagr is not None else None,
                        "sharpe": round(sharpe, 4) if sharpe is not None else None,
                        "mdd": round(mdd, 6), "last_date": daily[-1]["date"], "last_equity": daily[-1]["equity"]},
            "account_value": round(pv, 2), "cash": round(cash, 2),
            "current_portfolio": cp, "regime_bucket": "live", "stock_exposure": round((pv-cash)/pv, 4) if pv else 1.0,
            "daily": daily}
    PUBLIC.mkdir(parents=True, exist_ok=True)
    json.dump(data, open(PERF, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
    print(f"[OK] {dates[0]}~{daily[-1]['date']} {n}일  누적 {total:+.2%}  계좌 ${pv:,.0f}  보유 {list(pos)}")


if __name__ == "__main__":
    main()
