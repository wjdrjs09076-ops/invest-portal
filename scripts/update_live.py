#!/usr/bin/env python3
"""
update_live.py — 라이브 성과 페이지(public/data/live_performance.json) 일일 누적 갱신

진실원천 = Alpaca get_account().equity (권위값). 매 거래일 마감 후 1회 호출되어
당일 종가 equity를 기존 트랙에 **append/upsert**한다(누적). 과거 일자는 보존.

※ 왜 portfolio_history를 안 쓰나(2026-06-16 교훈):
  Alpaca PortfolioHistory(1D)는 하루 밀려서 들어오고(당일 종가 누락, 직전종가를
  당일로 라벨), 특정일을 통째로 건너뛰기도 함. 그걸로 매번 전체 재구성하면
  ① 누적된 과거일이 사라지고 ② 밀린 값으로 손익이 왜곡됨. 그래서 폐기.

기준선(baseline) = 정상거래 재시작 직전 자본. 파일의 baseline_equity에 고정 저장.
표본 5거래일 미만이면 연환산 지표(CAGR/Sharpe)는 null → 페이지에서 "—".

환경변수: ALPACA_API_KEY, ALPACA_SECRET_KEY (paper),
          LIVE_BASELINE(최초 1회, 파일에 baseline 없을 때만), LIVE_START(표시용)
사용:     python scripts/update_live.py
"""
from __future__ import annotations

import json
import math
import os
import datetime as dt
from pathlib import Path

import yfinance as yf
import pandas as pd
from alpaca.trading.client import TradingClient

ROOT        = Path(__file__).resolve().parents[1]
PUBLIC_DATA = ROOT / "public" / "data"
PERF_PATH   = PUBLIC_DATA / "live_performance.json"

API_KEY    = os.environ.get("ALPACA_API_KEY", "")
SECRET_KEY = os.environ.get("ALPACA_SECRET_KEY", "")
MIN_DAYS_FOR_ANNUAL = 5


def _load_json(path: Path):
    if path.exists():
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return None


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
    if not API_KEY or not SECRET_KEY:
        raise SystemExit("[오류] ALPACA_API_KEY / ALPACA_SECRET_KEY 미설정")

    tc   = TradingClient(API_KEY, SECRET_KEY, paper=True)
    acct = tc.get_account()
    equity_now = float(acct.equity)
    cash = float(acct.cash)
    pv   = float(acct.portfolio_value)
    pos  = {p.symbol: float(p.market_value) for p in tc.get_all_positions()}

    # 당일(미 동부) 거래일자 + 장 개장여부 — Alpaca 시계 기준
    clock = tc.get_clock()
    today = clock.timestamp.strftime("%Y-%m-%d")
    market_open = bool(clock.is_open)
    last_equity = float(getattr(acct, "last_equity", 0) or 0)   # 직전 거래일 '공식' 종가

    prev = _load_json(PERF_PATH) or {}
    baseline = prev.get("baseline_equity")
    if baseline is None:
        baseline = float(os.environ.get("LIVE_BASELINE", "0") or 0) or equity_now
    baseline = float(baseline)

    # 기존 트랙의 일자별 USD equity 복원 (norm × baseline)
    usd_by_date: dict[str, float] = {}
    for d in prev.get("daily", []):
        usd_by_date[d["date"]] = float(d["equity"]) * baseline

    # 직전 거래일을 Alpaca 공식 종가(last_equity)로 보정 — 시간외 캡처 오차 self-heal.
    # (마감 직후 캡처한 equity는 시간외 마크로 공식 4pm 종가와 다를 수 있음)
    prior_dates = [dd for dd in usd_by_date if dd < today]
    if last_equity > 0 and prior_dates:
        usd_by_date[max(prior_dates)] = last_equity

    # 당일 종가는 '장 마감 후'에만 기록(장중 노이즈 방지). 트랙이 비어있으면 최소 당일이라도.
    if not market_open or not usd_by_date:
        usd_by_date[today] = equity_now

    dates = sorted(usd_by_date)
    start_date, end_date = dates[0], dates[-1]
    spy = fetch_spy(start_date, end_date)
    spy_base = next((spy[d] for d in sorted(spy) if d >= start_date), None)

    daily, running_max, prev_eq, last_spy = [], 1.0, baseline, spy_base
    for d in dates:
        usd = usd_by_date[d]
        equity = usd / baseline
        dr = usd / prev_eq - 1.0
        prev_eq = usd
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
        "live_start": prev.get("live_start") or os.environ.get("LIVE_START") or start_date,
        "strategy_label": "Alpaca Paper Account (live equity, MA200+VIX regime overlay)",
        "source": "alpaca_account_equity",
        "baseline_equity": round(baseline, 2),
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
    with open(PERF_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    sh = f"{sharpe:.2f}" if sharpe is not None else "—"
    print(f"[OK] {start_date}~{end_date} {n}일  누적 {total_ret:+.2%}  Sharpe {sh}  "
          f"기준 ${baseline:,.0f}  당일 equity ${equity_now:,.0f}")


if __name__ == "__main__":
    main()
