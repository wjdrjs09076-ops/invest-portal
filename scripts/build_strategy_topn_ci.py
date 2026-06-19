#!/usr/bin/env python3
"""
build_strategy_topn_ci.py — 모멘텀 Top-5 노셔널 전략 (자급/CI용)

invest-portal repo 안에서 단독 실행. Sharadar 캐시 불필요 — yfinance 가격 + 레포의
public/data/sp500_current_wiki.json 만 사용. GitHub Actions 일일 자동갱신용.

로컬 정밀판(invest-data/build_strategy_topn.py)과의 차이:
  - quality 블록(zscore/credit, 캐시 필요) 생략 → '모멘텀 전용' 점수.
  - 가격 yfinance(현재 S&P500 멤버). 2026 백필 구간 생존편향 미미(현 멤버·6개월).
규칙 동일: S&P500 top-5 동일가중, 3거래일 hysteresis, 턴오버 10bps, 2026-01-01 시작.
출력: public/data/strategy_topn.json (live 페이지 스키마 동일).
"""
from __future__ import annotations
import json, math, datetime as dt
from pathlib import Path
import numpy as np
import pandas as pd
import yfinance as yf

ROOT     = Path(__file__).resolve().parents[1]          # invest-portal/
PUBLIC   = ROOT / "public" / "data"
OUT      = PUBLIC / "strategy_topn.json"
SP500_F  = PUBLIC / "sp500_current_wiki.json"

START         = "2026-01-01"
HIST_START    = "2024-08-01"   # 252거래일 모멘텀 룩백 확보용
TOP_N, CONFIRM, BPS = 5, 3, 10.0
BENCH = "SPY"
# 모멘텀 서브가중치(프로덕션 일치, 합=1.0). (mom252=0 생략)
W = {"mom1": 0.05, "mom3": 0.20, "rs": 0.25, "mom6": 0.30, "mom12": 0.20}


def load_tickers() -> list[str]:
    d = json.load(open(SP500_F, encoding="utf-8"))
    items = d.get("items", d) if isinstance(d, dict) else d
    out = []
    for it in items:
        t = (it.get("ticker") if isinstance(it, dict) else it) or ""
        t = str(t).strip().upper().replace(".", "-")
        if t:
            out.append(t)
    return sorted(set(out))


def fetch_panel(tickers: list[str]) -> pd.DataFrame:
    allt = sorted(set(tickers + [BENCH]))
    frames = {}
    for i in range(0, len(allt), 100):
        batch = allt[i:i + 100]
        raw = yf.download(batch, start=HIST_START, auto_adjust=True,
                          progress=False, group_by="ticker", threads=True)
        if raw is None or raw.empty:
            continue
        if isinstance(raw.columns, pd.MultiIndex):
            for t in batch:
                try:
                    s = raw[t]["Close"].dropna()
                    if len(s) > 0:
                        frames[t] = s
                except Exception:
                    pass
        elif "Close" in raw.columns and len(batch) == 1:
            frames[batch[0]] = raw["Close"].dropna()
    panel = pd.DataFrame(frames).sort_index()
    panel.index = pd.to_datetime(panel.index)
    return panel.ffill()


def _ret(panel: pd.DataFrame, i: int, lb: int, skip: int) -> pd.Series:
    end, start = i - skip, i - skip - lb
    if start < 0:
        return pd.Series(dtype=float)
    return panel.iloc[end] / panel.iloc[start] - 1.0


def _pct(s: pd.Series) -> pd.Series:
    v = s.dropna()
    if v.empty:
        return v
    return v.rank(pct=True) * 100.0


def composite(panel: pd.DataFrame, i: int, univ: list[str]) -> dict[str, float]:
    mom1  = _ret(panel, i, 21, 0)
    mom3  = _ret(panel, i, 63, 21)
    mom6  = _ret(panel, i, 126, 21)
    mom12 = _ret(panel, i, 252, 21)
    if mom12.empty or mom3.empty:
        return {}
    spy3 = mom3.get(BENCH, np.nan)
    rs = mom3 - spy3
    raws = {"mom1": mom1, "mom3": mom3, "rs": rs, "mom6": mom6, "mom12": mom12}
    cols = [c for c in univ if c in panel.columns]
    pcts = {k: _pct(s.reindex(cols)) for k, s in raws.items()}
    num = pd.Series(0.0, index=cols); den = pd.Series(0.0, index=cols)
    for k, w in W.items():
        p = pcts[k]
        lp = np.log(p.clip(lower=0.5))
        num = num.add(w * lp, fill_value=0.0)
        den = den.add(pd.Series(w, index=p.index), fill_value=0.0)
    comp = {}
    for t in cols:
        d = den.get(t, 0.0)
        if d > 0 and not pd.isna(num.get(t, np.nan)):
            comp[t] = float(np.exp(num[t] / d))
    return comp


def main():
    tickers = load_tickers()
    print(f"[load] {len(tickers)} S&P500 tickers; yfinance {HIST_START}~today ...", flush=True)
    panel = fetch_panel(tickers)
    if BENCH not in panel.columns:
        raise SystemExit("[오류] SPY 가격 없음")
    dates = [d for d in panel.index if d >= pd.Timestamp(START)]
    print(f"[panel] {panel.shape[1]} tickers, sim {len(dates)} days", flush=True)

    cur_w: dict[str, float] = {}
    in_s: dict[str, int] = {}; out_s: dict[str, int] = {}
    pend_w = None; pend_turn = 0.0
    side = BPS / 10000.0
    eq, hwm = 1.0, 1.0
    base_spy = None; last_spy = 1.0
    daily = []

    for d in dates:
        i = panel.index.get_loc(d)
        # 1일 lag
        cost_turn = 0.0
        if pend_w is not None:
            cost_turn = pend_turn; cur_w = pend_w; pend_w = None; pend_turn = 0.0
        # 당일 수익(보유 가중)
        if cur_w:
            r = panel.iloc[i] / panel.iloc[i - 1] - 1.0
            wr = sum(w * float(r.get(t, 0.0)) for t, w in cur_w.items() if not pd.isna(r.get(t, np.nan)))
            uw = sum(w for t, w in cur_w.items() if not pd.isna(r.get(t, np.nan)))
            dr = wr / uw if uw > 0 else 0.0
        else:
            dr = 0.0
        if cost_turn > 0:
            eq *= (1 - cost_turn * side)
        eq *= (1 + dr); hwm = max(hwm, eq)
        px = float(panel.iloc[i].get(BENCH, np.nan))
        if not pd.isna(px):
            base_spy = base_spy or px; last_spy = px / base_spy
        daily.append({"date": str(d.date()), "equity": round(eq, 6),
                      "daily_return": round(dr, 6), "drawdown": round(eq / hwm - 1, 6),
                      "benchmark": round(last_spy, 6), "regime": "sim", "stock_exposure": 1.0})

        # 목표 top-5 (hysteresis)
        comp = composite(panel, i, tickers)
        if not comp:
            pend_w = dict(cur_w); pend_turn = 0.0; continue
        ranked = sorted(comp, key=lambda t: comp[t], reverse=True)
        cand = set(ranked[:TOP_N])
        for t in comp:
            if t in cand:
                in_s[t] = in_s.get(t, 0) + 1; out_s[t] = 0
            else:
                out_s[t] = out_s.get(t, 0) + 1; in_s[t] = 0
        held = set(cur_w.keys())
        if not held:
            new_held = set(ranked[:TOP_N])
        else:
            dead = {t for t in held if t not in comp}
            alive = held - dead
            conf_exit = sorted([t for t in alive if out_s.get(t, 0) >= CONFIRM],
                               key=lambda t: comp.get(t, 0))
            conf_in = [t for t in ranked if t not in held and in_s.get(t, 0) >= CONFIRM]
            n_swap = min(len(conf_exit), len(conf_in))
            out_set = dead | set(conf_exit[:n_swap])
            keep = held - out_set
            need = TOP_N - len(keep)
            cands = conf_in + [t for t in ranked if t not in held and t not in conf_in]
            add = []
            for t in cands:
                if len(add) >= need:
                    break
                if t not in keep:
                    add.append(t)
            new_held = keep | set(add)
        tgt = {t: 1.0 / len(new_held) for t in new_held} if new_held else {}
        allt = set(cur_w) | set(tgt)
        pend_turn = sum(abs(tgt.get(t, 0.0) - cur_w.get(t, 0.0)) for t in allt)
        pend_w = tgt

    n = len(daily)
    total_ret = daily[-1]["equity"] - 1.0 if daily else 0.0
    rets = [x["daily_return"] for x in daily[1:]]
    vol = (sum((x - sum(rets)/len(rets))**2 for x in rets)/len(rets))**0.5 * math.sqrt(252) if rets else 0.0
    years = n / 252
    cagr = daily[-1]["equity"] ** (1/years) - 1.0 if (years > 0 and daily) else 0.0
    sharpe = cagr/vol if vol > 0 else 0.0
    mdd = min((x["drawdown"] for x in daily), default=0.0)
    if n < 252:
        cagr = sharpe = None
    cur_hold = sorted(pend_w.keys()) if pend_w else sorted(cur_w.keys())
    current_portfolio = {t: round(1.0/len(cur_hold), 6) for t in cur_hold} if cur_hold else {}

    data = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "live_start": daily[0]["date"] if daily else START,
        "strategy_label": "Momentum Top-5 (S&P500, 시뮬레이션 — 점수 상위 5종목 동일가중, 3일 확정)",
        "source": "notional_simulation_ci",
        "note": "노셔널 시뮬레이션(가상, 모멘텀 전용·yfinance). Alpaca 실계좌 아님. 매일 자동 재시뮬.",
        "summary": {"total_return": round(total_ret, 6), "days": n,
                    "cagr": round(cagr, 6) if cagr is not None else None,
                    "sharpe": round(sharpe, 4) if sharpe is not None else None,
                    "mdd": round(mdd, 6),
                    "last_date": daily[-1]["date"] if daily else None,
                    "last_equity": daily[-1]["equity"] if daily else 1.0},
        "current_portfolio": current_portfolio,
        "regime_bucket": "sim", "stock_exposure": 1.0, "daily": daily,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    json.dump(data, open(OUT, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
    print(f"[OK] {data['live_start']}~{data['summary']['last_date']} {n}일  "
          f"top5 누적 {total_ret:+.1%}  SPY {(last_spy-1):+.1%}  보유 {cur_hold}", flush=True)


if __name__ == "__main__":
    main()
