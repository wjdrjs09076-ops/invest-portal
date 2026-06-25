#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
top5_paper_rebalance.py — Top-5 전략 전용 Alpaca 페이퍼 계좌 자동 리밸런싱

타깃 = public/data/strategy_topn.json 의 current_portfolio(프로덕션 점수 top-5, 3일 hysteresis
반영된 종목) → 동일가중(각 20%)으로 Alpaca paper 계좌를 매칭. 매도 먼저 → 매수(시장가).
사전등록(FORWARD_TEST_TOP5.md)된 전향 검증용 — 규칙 동결.

환경변수: ALPACA_TOP5_API_KEY, ALPACA_TOP5_SECRET_KEY
사용: python scripts/top5_paper_rebalance.py            # 실행
      DRY_RUN=true python scripts/top5_paper_rebalance.py
"""
from __future__ import annotations
import os, sys, json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET_F = ROOT / "public" / "data" / "strategy_topn.json"
LOG_F = ROOT / "public" / "data" / "top5_paper_trades.json"
API_KEY = os.environ.get("ALPACA_TOP5_API_KEY", "")
SECRET  = os.environ.get("ALPACA_TOP5_SECRET_KEY", "")
DRY = os.environ.get("DRY_RUN", "false").lower() == "true"
MIN_ORDER_USD = 1.0


def load_target() -> list[str]:
    d = json.load(open(TARGET_F, encoding="utf-8"))
    return [t for t in d.get("current_portfolio", {}) if t != "CASH"]


def get_prices(dc, tickers):
    from alpaca.data.requests import StockLatestQuoteRequest, StockLatestTradeRequest
    prices = {}
    q = dc.get_stock_latest_quote(StockLatestQuoteRequest(symbol_or_symbols=tickers))
    for s, x in q.items():
        bid, ask = float(x.bid_price), float(x.ask_price)
        if bid > 0 and ask > 0:
            prices[s] = (bid + ask) / 2
    miss = [t for t in tickers if t not in prices]
    if miss:
        try:
            tr = dc.get_stock_latest_trade(StockLatestTradeRequest(symbol_or_symbols=miss))
            for s, x in tr.items():
                if float(x.price) > 0:
                    prices[s] = float(x.price)
        except Exception as e:
            print(f"  [WARN] 체결가 조회 실패: {e}")
    return prices


def main():
    if not API_KEY or not SECRET:
        raise SystemExit("[오류] ALPACA_TOP5_API_KEY / ALPACA_TOP5_SECRET_KEY 미설정")
    from alpaca.trading.client import TradingClient
    from alpaca.data.historical import StockHistoricalDataClient
    from alpaca.trading.requests import MarketOrderRequest
    from alpaca.trading.enums import OrderSide, TimeInForce

    tc = TradingClient(API_KEY, SECRET, paper=True)
    dc = StockHistoricalDataClient(API_KEY, SECRET)
    target = load_target()
    print(f"=== Top-5 페이퍼 리밸런싱 {'[DRY] ' if DRY else ''}{datetime.now(timezone.utc).isoformat()} ===")
    print(f"타깃 top-5: {target}")
    if len(target) < 1:
        raise SystemExit("[오류] 타깃 비어있음")

    # 거래가능 필터
    tradable = []
    for t in target:
        try:
            a = tc.get_asset(t)
            if a.tradable and str(a.status).split(".")[-1].upper() == "ACTIVE":
                tradable.append(t)
            else:
                print(f"  [제외] {t} 거래불가")
        except Exception:
            print(f"  [제외] {t} asset 조회실패")
    if not tradable:
        raise SystemExit("[중단] 거래가능 타깃 없음")
    w = 1.0 / len(tradable)

    acct = tc.get_account()
    pv = float(acct.portfolio_value)
    positions = {p.symbol: float(p.qty) for p in tc.get_all_positions()}
    print(f"계좌가치 ${pv:,.0f} | 현재보유 {list(positions)}")

    # ★ 멤버십 변동 없으면 리밸런싱 안 함(가중 드리프트 재맞춤 churn 방지 = 승자 안 깎음).
    # 전략 취지 = top-5 '멤버십'이 바뀔 때만 거래. 비중은 종목 교체 시에만 1/N 재설정.
    if set(positions.keys()) == set(tradable):
        print("리밸런싱 불필요 — 보유 = 타깃(멤버십 동일). 가중 드리프트 방치(승자 유지).")
        return

    all_t = sorted(set(tradable) | set(positions))
    prices = get_prices(dc, all_t)
    # 매수 타깃 가격 누락 → 부분청산 방지 위해 중단
    unpriced = [t for t in tradable if t not in prices]
    if unpriced:
        print(f"[중단] 타깃 가격조회 실패 {unpriced} — 리밸런싱 취소(부분청산 방지)")
        return

    tgt_shares = {t: (pv * w) / prices[t] for t in tradable}
    sells, buys = [], []
    for t in all_t:
        cur = positions.get(t, 0.0)
        tgt = tgt_shares.get(t, 0.0)
        d = tgt - cur
        px = prices.get(t, 0.0)
        if abs(d) * px < MIN_ORDER_USD:
            continue
        (buys if d > 0 else sells).append((t, abs(d)))

    orders = []
    def submit(sym, qty, side):
        q = max(1, round(qty))
        if DRY:
            print(f"  [DRY] {side.upper()} {sym} x{q}")
            orders.append({"symbol": sym, "side": side, "qty": q, "status": "dry"})
            return
        try:
            o = tc.submit_order(MarketOrderRequest(symbol=sym, qty=q,
                side=OrderSide.SELL if side == "sell" else OrderSide.BUY,
                time_in_force=TimeInForce.DAY))
            print(f"  [주문] {side.upper()} {sym} x{q}  id={o.id}")
            orders.append({"symbol": sym, "side": side, "qty": q, "order_id": str(o.id), "status": str(o.status)})
        except Exception as e:
            print(f"  [실패] {side.upper()} {sym}: {e}")
            orders.append({"symbol": sym, "side": side, "qty": q, "error": str(e)})

    print(f"\n[매도 {len(sells)}건]")
    for t, q in sorted(sells, key=lambda x: -x[1] * prices.get(x[0], 0)):
        submit(t, q, "sell")
    print(f"[매수 {len(buys)}건]")
    for t, q in sorted(buys, key=lambda x: -x[1] * prices.get(x[0], 0)):
        submit(t, q, "buy")

    # 로그
    log = json.load(open(LOG_F, encoding="utf-8")) if LOG_F.exists() else []
    log.append({"date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "target": tradable, "portfolio_value": round(pv, 2),
                "orders": orders, "dry_run": DRY})
    if not DRY:
        json.dump(log, open(LOG_F, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
    print(f"\n완료: {len(orders)}건 ({'DRY' if DRY else '실행'})")


if __name__ == "__main__":
    main()
