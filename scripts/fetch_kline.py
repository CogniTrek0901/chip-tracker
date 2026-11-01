"""K 線資料（亞當理論、風險係數 β 用）：每檔上市櫃股票近三年日 K，存 site/data/k/{代號}.json。
另維護 site/data/price/{代號}.json 近 5 年月收盤（月營收圖上的股價線）。

{"c": 代號, "n": 名稱, "m": 市場, "d": [[YYYYMMDD, 開, 高, 低, 收, 量(張), 還原收盤], ...]}
- 第一次（檔案不存在、太舊或還沒抓過 5 年）抓 Yahoo range=5y（月收盤取 5 年、日 K 留 3 年），之後每天抓 range=5d 接在後面
- 最新一筆已是最近交易日就略過（早上補跑時不會重抓）
環境變數 KLINE_MAX：本次最多處理幾檔（預設全部）
"""
from __future__ import annotations

import datetime as dt
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

from common import DATA_DIR, META_DIR, SITE_DATA, load_json, save_json

TZ = dt.timezone(dt.timedelta(hours=8))
OUT = SITE_DATA / "k"
TDAYS: set = set()
TMAX = ""
KEEP = 760  # 約三年交易日（三年 β 值需要）
PRICE = SITE_DATA / "price"
HDR = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"}


def yahoo(code: str, market: str, rng: str):
    sfx = ".TW" if market == "上市" else ".TWO"
    for host in (1, 2, 1):
        try:
            r = requests.get(f"https://query{host}.finance.yahoo.com/v8/finance/chart/{code}{sfx}",
                             params={"range": rng, "interval": "1d"}, headers=HDR, timeout=25)
            if r.status_code == 429:
                time.sleep(5)
                continue
            res = r.json()["chart"]["result"][0]
            q = res["indicators"]["quote"][0]
            adj = ((res["indicators"].get("adjclose") or [{}])[0].get("adjclose")) or []
            out = []
            for i, t in enumerate(res.get("timestamp") or []):
                o, h, l, c, v = (q.get(k, [None])[i] for k in ("open", "high", "low", "close", "volume"))
                if None in (o, h, l, c):
                    continue
                d = dt.datetime.fromtimestamp(t, TZ).strftime("%Y%m%d")
                rd = 2 if c < 100 else 1
                a = adj[i] if i < len(adj) and adj[i] else c  # 還原收盤（除權息調整），算 β 用
                out.append([d, round(o, rd), round(h, rd), round(l, rd), round(c, rd), round((v or 0) / 1000), round(a, 4)])
            return out
        except Exception:
            time.sleep(1.5)
    return None


def work(code: str, info: dict, last_day: str):
    path = OUT / f"{code}.json"
    old = load_json(path, None)
    rows = (old or {}).get("d") or []
    full = bool((old or {}).get("f3"))
    # Yahoo 偶爾在休市日（例如颱風假）多給一根 K 棒，以證交所交易日為準剔除
    clean = [r for r in rows if r[0] in TDAYS or r[0] > TMAX]
    if full and rows and rows[-1][0] >= last_day:
        if len(clean) != len(rows):
            save_json(path, {**old, "d": clean}, compact=True)
            return "fix"
        return "skip"
    rows = clean
    fresh = not full or not rows or rows[-1][0] < (dt.datetime.now(TZ) - dt.timedelta(days=20)).strftime("%Y%m%d")
    got = yahoo(code, info.get("m", "上市"), "5y" if fresh else "5d")
    if not got:
        return "fail"
    by = {r[0]: r for r in rows}
    for r in got:
        if r[0] in TDAYS or r[0] > TMAX:
            by[r[0]] = r
    allrows = [by[k] for k in sorted(by)]
    save_json(path, {"c": code, "n": info.get("n", ""), "m": info.get("m", ""), "f3": 1, "d": allrows[-KEEP:]}, compact=True)
    save_price(code, allrows if fresh else allrows[-30:])
    return "new" if fresh else "upd"


def save_price(code: str, rows: list):
    """月收盤（每月最後一個交易日的收盤）併入 site/data/price/{代號}.json，保留 61 個月。"""
    if not rows:
        return
    p = PRICE / f"{code}.json"
    old = load_json(p, None) or {}
    m = {k: v for k, v in (old.get("m") or [])}
    for r in rows:
        m[r[0][:6]] = r[4]
    keep = sorted(m.items())[-61:]
    save_json(p, {"c": code, "u": rows[-1][0], "m": [[k, v] for k, v in keep]}, compact=True)


def main() -> int:
    meta = load_json(META_DIR / "stocks.json", {}) or {}
    tx = load_json(DATA_DIR / "tools" / "taiex.json", {}) or {}
    today = dt.datetime.now(TZ).strftime("%Y%m%d")
    last_day = max((d for d in tx if d <= today), default=today)
    global TDAYS, TMAX
    TDAYS, TMAX = set(tx), max(tx, default="")
    # 收盤前（14:00 前）最近交易日以前一天為準
    if last_day == today and dt.datetime.now(TZ).hour < 14:
        last_day = max((d for d in tx if d < today), default=today)
    codes = sorted(meta)
    lim = int(os.environ.get("KLINE_MAX", "0") or 0)
    if lim:
        codes = codes[:lim]
    OUT.mkdir(parents=True, exist_ok=True)
    PRICE.mkdir(parents=True, exist_ok=True)
    stat = {}
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=6) as ex:
        futs = {ex.submit(work, c, meta[c], last_day): c for c in codes}
        for i, f in enumerate(as_completed(futs), 1):
            try:
                s = f.result()
            except Exception:
                s = "fail"
            stat[s] = stat.get(s, 0) + 1
            if i % 300 == 0:
                print(f"  K 線 {i}/{len(codes)} {stat}（{time.time() - t0:.0f}s）")
    print(f"K 線：{stat}，最近交易日 {last_day}，{time.time() - t0:.0f} 秒")
    return 0


if __name__ == "__main__":
    sys.exit(main())
