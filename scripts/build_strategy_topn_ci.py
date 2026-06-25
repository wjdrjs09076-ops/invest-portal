#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_strategy_topn_ci.py — 프로덕션 점수 Top-5 노셔널 전략 (자급/CI용)

invest-portal repo 안에서 단독 실행. yfinance 가격 + 레포/raw의 committed JSON만 사용
(Sharadar pkl 캐시 불필요). GitHub Actions 일일 자동갱신.

점수 = 사이트 프로덕션 score_group 구성 미러:
  momentum(0.75: 21/63/126/12-1 + RS63) + quality(0.15) + sector(0.05) + risk(0.05).
  - risk는 프로덕션처럼 vol/downside/drawdown 역백분위를 '산술 블렌드한 단일 점수'(0.4/0.3/0.3)로
    합성 후 기하평균에 1개 팩터로 투입 → 고변동주 과벌점 방지(반도체 유지).
  - 절대모멘텀 필터: 63D > -5% & 252D > -10%.
  - 미반영(프로덕션 대비): 뉴스필터·섹터캡·변동성타깃팅.
  ⚠️ quality는 '현재 스냅샷'(PIT 시계열 부재) → 2026 백필 구간에 경미한 look-ahead. 천천히 변하는
     재무라 영향은 작으나 0은 아님(리포트에 명시).

선택: top-5 동일가중, 3거래일 hysteresis, 턴오버 10bps, 2026-01-01 시작.
출력: public/data/strategy_topn.json (live 페이지 스키마).
"""
from __future__ import annotations
import json, math, datetime as dt
from pathlib import Path
import numpy as np
import pandas as pd
import yfinance as yf

ROOT     = Path(__file__).resolve().parents[1]
PUBLIC   = ROOT / "public" / "data"
OUT      = PUBLIC / "strategy_topn.json"
SP500_F  = PUBLIC / "sp500_current_wiki.json"
QUAL_URL = "https://raw.githubusercontent.com/wjdrjs09076-ops/invest-data/main/data/quality_snapshot.json"

START, HIST_START = "2026-01-01", "2024-08-01"
TOP_N, CONFIRM, BPS, BENCH = 5, 3, 10.0, "SPY"
# 모멘텀 서브가중치(합 0.75) + quality 0.15 + sector 0.05 + risk 0.05
WMOM = {"mom1": 0.05, "mom3": 0.20, "rs": 0.25, "mom6": 0.30, "mom12": 0.20}
W = {**{k: 0.75 * v for k, v in WMOM.items()}, "quality": 0.15, "sector": 0.05, "risk": 0.05}


def load_meta():
    d = json.load(open(SP500_F, encoding="utf-8"))
    items = d.get("items", d) if isinstance(d, dict) else d
    tickers, sect = [], {}
    for it in items:
        t = str(it.get("ticker", "")).strip().upper().replace(".", "-")
        if t:
            tickers.append(t); sect[t] = it.get("sector", "Unknown") or "Unknown"
    # quality: raw URL(있으면) → {ticker: quality_score_100}
    qual = {}
    try:
        import urllib.request
        with urllib.request.urlopen(QUAL_URL, timeout=30) as r:
            qd = json.loads(r.read().decode())
        for x in qd.get("items", []):
            t = str(x.get("ticker", "")).strip().upper().replace(".", "-")
            q = x.get("quality_score_100")
            if t and q is not None and not (isinstance(q, float) and math.isnan(q)):
                qual[t] = float(q)
    except Exception as e:
        print(f"[WARN] quality 로드 실패({e}) — quality 블록 생략", flush=True)
    return sorted(set(tickers)), sect, qual


def fetch_panel(tickers):
    allt = sorted(set(tickers + [BENCH]))
    frames = {}
    for i in range(0, len(allt), 100):
        batch = allt[i:i+100]
        raw = yf.download(batch, start=HIST_START, auto_adjust=True, progress=False,
                          group_by="ticker", threads=True)
        if raw is None or raw.empty:
            continue
        if isinstance(raw.columns, pd.MultiIndex):
            for t in batch:
                try:
                    s = raw[t]["Close"].dropna()
                    if len(s) > 0: frames[t] = s
                except Exception: pass
        elif "Close" in raw.columns and len(batch) == 1:
            frames[batch[0]] = raw["Close"].dropna()
    panel = pd.DataFrame(frames).sort_index()
    panel.index = pd.to_datetime(panel.index)
    return panel.ffill()


def _ret(panel, i, lb, skip):
    end, start = i - skip, i - skip - lb
    if start < 0: return pd.Series(dtype=float)
    return panel.iloc[end] / panel.iloc[start] - 1.0


def _pct(s):
    v = s.dropna()
    return v.rank(pct=True) * 100.0 if not v.empty else v


def composite(panel, rets, i, univ, sect, qual):
    mom1  = _ret(panel, i, 21, 0)
    mom3  = _ret(panel, i, 63, 21)
    mom6  = _ret(panel, i, 126, 21)
    mom12 = _ret(panel, i, 252, 21)
    if mom12.empty or mom3.empty: return {}
    rs = mom3 - mom3.get(BENCH, np.nan)
    # 절대모멘텀 필터: 63D(skip0) > -5% & 252D(skip0) > -10%
    m63  = _ret(panel, i, 63, 0); m252 = _ret(panel, i, 252, 0)
    cols = [t for t in univ if t in panel.columns]
    ok = [t for t in cols if (m63.get(t, -1) > -0.05) and (m252.get(t, -1) > -0.10)
          and not pd.isna(mom12.get(t, np.nan))]
    if not ok: return {}
    # 리스크 지표(window) — 산술 블렌드 단일 risk 점수(고변동 과벌점 방지)
    w = rets.iloc[max(0, i-59):i+1]
    vol20  = w.iloc[-20:].std() * math.sqrt(252)
    neg = w.iloc[-20:].where(w.iloc[-20:] < 0)
    down20 = neg.std() * math.sqrt(252)
    px60 = panel.iloc[max(0, i-59):i+1]
    mdd60 = (px60 / px60.cummax() - 1.0).min().abs()
    def goodpct(s):  # 낮을수록 좋음 → 높은 점수
        p = _pct(s.reindex(ok)); return (100.0 - p)
    risk = (0.4*goodpct(vol20) + 0.3*goodpct(down20) + 0.3*goodpct(mdd60))
    # 섹터 강도: 종목 섹터 평균 63D - 전체 평균 63D
    m3 = mom3.reindex(ok)
    df_s = pd.DataFrame({"r": m3, "sec": [sect.get(t, "Unknown") for t in ok]}, index=ok)
    sec_mean = df_s.groupby("sec")["r"].transform("mean")
    sector_strength = sec_mean - m3.mean()
    # quality
    qser = pd.Series({t: qual.get(t, np.nan) for t in ok})
    # 팩터 백분위
    P = {
        "mom1": _pct(mom1.reindex(ok)), "mom3": _pct(mom3.reindex(ok)),
        "rs": _pct(rs.reindex(ok)), "mom6": _pct(mom6.reindex(ok)),
        "mom12": _pct(mom12.reindex(ok)),
        "quality": _pct(qser), "sector": _pct(sector_strength), "risk": risk,
    }
    num = pd.Series(0.0, index=ok); den = pd.Series(0.0, index=ok)
    for k, wt in W.items():
        p = P[k].reindex(ok)
        lp = np.log(p.clip(lower=0.5))
        num = num.add(wt*lp, fill_value=0.0)
        den = den.add(pd.Series(wt, index=p.dropna().index), fill_value=0.0)
    comp = {}
    for t in ok:
        dd = den.get(t, 0.0)
        if dd > 0 and not pd.isna(num.get(t, np.nan)):
            comp[t] = float(np.exp(num[t]/dd))
    return comp


def main():
    tickers, sect, qual = load_meta()
    print(f"[load] {len(tickers)} tickers, quality {len(qual)}개; yfinance {HIST_START}~ ...", flush=True)
    panel = fetch_panel(tickers)
    if BENCH not in panel.columns: raise SystemExit("[오류] SPY 없음")
    rets = panel.pct_change()
    dates = [d for d in panel.index if d >= pd.Timestamp(START)]
    print(f"[panel] {panel.shape[1]} tickers, sim {len(dates)} days", flush=True)

    cur_w = {}; in_s = {}; out_s = {}; pend_w = None; pend_turn = 0.0
    side = BPS/10000.0; eq = hwm = 1.0; base_spy = None; last_spy = 1.0
    daily = []
    for d in dates:
        i = panel.index.get_loc(d)
        cost_turn = 0.0
        if pend_w is not None:
            cost_turn = pend_turn; cur_w = pend_w; pend_w = None; pend_turn = 0.0
        if cur_w:
            r = panel.iloc[i] / panel.iloc[i-1] - 1.0
            wr = sum(wt*float(r.get(t, 0.0)) for t, wt in cur_w.items() if not pd.isna(r.get(t, np.nan)))
            uw = sum(wt for t, wt in cur_w.items() if not pd.isna(r.get(t, np.nan)))
            dr = wr/uw if uw > 0 else 0.0
        else: dr = 0.0
        if cost_turn > 0: eq *= (1 - cost_turn*side)
        eq *= (1 + dr); hwm = max(hwm, eq)
        px = float(panel.iloc[i].get(BENCH, np.nan))
        if not pd.isna(px):
            base_spy = base_spy or px; last_spy = px/base_spy
        daily.append({"date": str(d.date()), "equity": round(eq, 6), "daily_return": round(dr, 6),
                      "drawdown": round(eq/hwm-1, 6), "benchmark": round(last_spy, 6),
                      "regime": "sim", "stock_exposure": 1.0})
        comp = composite(panel, rets, i, tickers, sect, qual)
        if not comp: pend_w = dict(cur_w); pend_turn = 0.0; continue
        ranked = sorted(comp, key=lambda t: comp[t], reverse=True)
        cand = set(ranked[:TOP_N])
        for t in comp:
            if t in cand: in_s[t] = in_s.get(t, 0)+1; out_s[t] = 0
            else: out_s[t] = out_s.get(t, 0)+1; in_s[t] = 0
        held = set(cur_w.keys())
        if not held: new_held = set(ranked[:TOP_N])
        else:
            dead = {t for t in held if t not in comp}
            alive = held - dead
            ce = sorted([t for t in alive if out_s.get(t, 0) >= CONFIRM], key=lambda t: comp.get(t, 0))
            ci = [t for t in ranked if t not in held and in_s.get(t, 0) >= CONFIRM]
            ns = min(len(ce), len(ci)); out_set = dead | set(ce[:ns])
            keep = held - out_set; need = TOP_N - len(keep)
            cands = ci + [t for t in ranked if t not in held and t not in ci]
            add = []
            for t in cands:
                if len(add) >= need: break
                if t not in keep: add.append(t)
            new_held = keep | set(add)
        tgt = {t: 1.0/len(new_held) for t in new_held} if new_held else {}
        allt = set(cur_w) | set(tgt)
        pend_turn = sum(abs(tgt.get(t, 0.0) - cur_w.get(t, 0.0)) for t in allt); pend_w = tgt

    n = len(daily); total_ret = daily[-1]["equity"]-1.0 if daily else 0.0
    rr = [x["daily_return"] for x in daily[1:]]
    vol = (sum((x-sum(rr)/len(rr))**2 for x in rr)/len(rr))**0.5*math.sqrt(252) if rr else 0.0
    years = n/252; cagr = daily[-1]["equity"]**(1/years)-1.0 if (years > 0 and daily) else 0.0
    sharpe = cagr/vol if vol > 0 else 0.0; mdd = min((x["drawdown"] for x in daily), default=0.0)
    if n < 252: cagr = sharpe = None
    cur_hold = sorted(pend_w.keys()) if pend_w else sorted(cur_w.keys())
    current_portfolio = {t: round(1.0/len(cur_hold), 6) for t in cur_hold} if cur_hold else {}
    data = {"generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "live_start": daily[0]["date"] if daily else START,
            "strategy_label": "Top-5 (S&P500 프로덕션 점수 — 모멘텀+퀄리티+섹터+리스크, 동일가중, 3일 확정)",
            "source": "notional_simulation_ci",
            "note": "노셔널 시뮬레이션(가상). 프로덕션 점수 구성 미러(quality는 현재 스냅샷→백필 경미 look-ahead). Alpaca 실계좌 아님.",
            "summary": {"total_return": round(total_ret, 6), "days": n,
                        "cagr": round(cagr, 6) if cagr is not None else None,
                        "sharpe": round(sharpe, 4) if sharpe is not None else None,
                        "mdd": round(mdd, 6), "last_date": daily[-1]["date"] if daily else None,
                        "last_equity": daily[-1]["equity"] if daily else 1.0},
            "current_portfolio": current_portfolio, "regime_bucket": "sim", "stock_exposure": 1.0,
            "daily": daily}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    json.dump(data, open(OUT, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
    print(f"[OK] {data['live_start']}~{data['summary']['last_date']} {n}일  top5 누적 {total_ret:+.1%}  "
          f"SPY {(last_spy-1):+.1%}  보유 {cur_hold}", flush=True)


if __name__ == "__main__":
    main()
