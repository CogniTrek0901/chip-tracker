"""風險係數 β：每檔上市櫃股票相對加權指數的 β 值（5 日～3 年），存 site/data/tools/beta.json。

β ＝ Cov(個股日報酬, 大盤日報酬) ÷ Var(大盤日報酬)
- 個股用 K 線檔（site/data/k）的還原收盤（除權息調整），沒有還原值時用收盤價
- 大盤用證交所加權指數收盤（data/tools/taiex.json），上市、上櫃都對加權指數計算
- 只用個股與大盤都有收盤的日子；資料天數不足 8 成的區間不計算
"""
from __future__ import annotations

import datetime as dt
import sys

from common import DATA_DIR, META_DIR, SITE_DATA, load_json, save_json

TZ = dt.timezone(dt.timedelta(hours=8))
# (代號, 名稱, 報酬筆數)
PERIODS = [("5d", "5日", 5), ("10d", "10日", 10), ("1m", "一個月", 20), ("3m", "三個月", 60),
           ("6m", "半年", 120), ("1y", "一年", 240), ("2y", "二年", 480), ("3y", "三年", 720)]


def beta(rs: list[float], rm: list[float]):
    n = len(rs)
    if n < 3:
        return None
    ms, mm = sum(rs) / n, sum(rm) / n
    cov = sum((a - ms) * (b - mm) for a, b in zip(rs, rm))
    var = sum((b - mm) ** 2 for b in rm)
    return round(cov / var, 2) if var > 0 else None


def main() -> int:
    tx = load_json(DATA_DIR / "tools" / "taiex.json", {}) or {}
    meta = load_json(META_DIR / "stocks.json", {}) or {}
    if not tx:
        print("沒有加權指數資料，略過 β")
        return 0
    last = max(tx)
    old_days = sorted(d for d in tx if d <= last)[-800:]
    first = old_days[0]
    rows = []
    for code in sorted(meta):
        k = load_json(SITE_DATA / "k" / f"{code}.json", None)
        if not k or not k.get("d"):
            continue
        px = {r[0]: (r[6] if len(r) > 6 and r[6] else r[4]) for r in k["d"] if r[0] >= first}
        days = [d for d in old_days if d in px and tx.get(d)]
        if len(days) < 6 or days[-1] < old_days[-6]:  # 太久沒交易（停牌、下市）不列
            continue
        rs = [px[b] / px[a] - 1 for a, b in zip(days, days[1:])]
        rm = [tx[b] / tx[a] - 1 for a, b in zip(days, days[1:])]
        bs = []
        for _, _, n in PERIODS:
            # 以大盤交易日界定區間：近 n 個大盤交易日內、個股也有交易的報酬
            start = old_days[-(n + 1)] if len(old_days) > n else old_days[0]
            idx = [i for i, d in enumerate(days[1:]) if days[i] >= start]
            bs.append(beta([rs[i] for i in idx], [rm[i] for i in idx]) if len(idx) >= max(3, n * 0.8) else None)
        if all(b is None for b in bs):
            continue
        info = meta[code]
        rows.append([code, info.get("n", k.get("n", "")), info.get("m", k.get("m", "")), info.get("i", ""),
                     k["d"][-1][4]] + bs)
    save_json(SITE_DATA / "tools" / "beta.json", {
        "updated": dt.datetime.now(TZ).strftime("%Y-%m-%d %H:%M"), "d": last,
        "p": [[k, t] for k, t, _ in PERIODS],
        "f": ["代號", "名稱", "市場", "產業", "收盤"] + [t for _, t, _ in PERIODS],
        "rows": rows}, compact=True)
    n3 = sum(1 for r in rows if r[-1] is not None)
    print(f"風險係數 β：{len(rows)} 檔（三年 β 有 {n3} 檔），資料到 {last}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
