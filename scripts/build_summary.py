"""把每週原始資料彙整成網站用的 site/data/summary.json。

每檔股票每週輸出 12 個數值：
  [400張以上持股%, 1000張以上持股%, 散戶持股%, 散戶人數, 總人數, 400張以上人數, 1000張以上人數,
   集保總張數, 400張以上持有張數, 400~600張人數, 600~800張人數, 800~1000張人數]
篩選（連續增加 / 累積幅度 / 單週跳升）在網頁端即時計算，門檻可在網頁上調整。
"""
from __future__ import annotations

import argparse
import datetime as dt
import sys

from common import (BIG400_LEVELS, BIG1000_LEVELS, META_DIR, RETAIL_LABEL,
                    RETAIL_LEVELS, SITE_DATA, list_raw_dates, load_json,
                    read_raw, save_json)


def metrics(levels: dict[int, tuple[int, int]]):
    total_shares = levels.get(17, (0, 0))[1] or sum(
        v[1] for k, v in levels.items() if 1 <= k <= 15)
    total_people = levels.get(17, (0, 0))[0] or sum(
        v[0] for k, v in levels.items() if 1 <= k <= 15)
    if total_shares <= 0:
        return None

    def pct(lvls):
        return round(sum(levels.get(k, (0, 0))[1] for k in lvls) * 100 / total_shares, 2)

    def ppl(lvls):
        return sum(levels.get(k, (0, 0))[0] for k in lvls)

    def lots(lvls):
        return round(sum(levels.get(k, (0, 0))[1] for k in lvls) / 1000)

    return [pct(BIG400_LEVELS), pct(BIG1000_LEVELS), pct(RETAIL_LEVELS),
            ppl(RETAIL_LEVELS), total_people, ppl(BIG400_LEVELS), ppl(BIG1000_LEVELS),
            round(total_shares / 1000), lots(BIG400_LEVELS),
            ppl([12]), ppl([13]), ppl([14])]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--weeks", type=int, default=26, help="網站保留幾週（預設 26）")
    ap.add_argument("--demo", action="store_true", help="標記為示範資料")
    args = ap.parse_args()

    dates = list_raw_dates()[-args.weeks:]
    if not dates:
        print("沒有任何原始資料，請先執行 fetch_weekly.py", file=sys.stderr)
        return 1
    meta = load_json(META_DIR / "stocks.json", {}) or {}
    prices = load_json(META_DIR / "prices.json", {}) or {}

    series: dict[str, list] = {}
    for i, d in enumerate(dates):
        for code, levels in read_raw(d).items():
            if meta and code not in meta:  # 只保留上市櫃普通股
                continue
            m = metrics(levels)
            if m is None:
                continue
            series.setdefault(code, [None] * len(dates))[i] = m

    # 最新股價：取有資料的最近一天
    latest_price: dict[str, float] = {}
    for d in sorted(prices):
        latest_price.update(prices[d])

    stocks = []
    for code in sorted(series):
        info = meta.get(code, {})
        s = series[code]
        if s[-1] is None:  # 最新一週沒有資料（下市等）
            continue
        stocks.append({
            "c": code,
            "n": info.get("n", ""),
            "m": info.get("m", ""),
            "i": info.get("i", ""),
            "p": latest_price.get(code),
            "s": s,
            "pr": [prices.get(d, {}).get(code) for d in dates],
        })

    out = {
        "updated": dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).strftime("%Y-%m-%d %H:%M"),
        "dates": dates,
        "retailLabel": RETAIL_LABEL,
        "fields": ["big400", "big1000", "retailPct", "retailPeople",
                   "totalPeople", "big400People", "big1000People",
                   "totalLots", "big400Lots", "people400_600", "people600_800", "people800_1000"],
        "stocks": stocks,
    }
    if args.demo:
        out["demo"] = True
    save_json(SITE_DATA / "summary.json", out, compact=True)
    print(f"summary.json：{len(stocks)} 檔、{len(dates)} 週（{dates[0]} ~ {dates[-1]}）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
