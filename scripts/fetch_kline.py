"""K 線資料（亞當理論用）：每檔上市櫃股票近一年日 K，存 site/data/k/{代號}.json。

{"c": 代號, "n": 名稱, "m": 市場, "d": [[YYYYMMDD, 開, 高, 低, 收, 量(張)], ...]}
- 第一次（檔案不存在或太舊）抓 Yahoo range=1y，之後每天抓 range=5d 接在後面
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
KEEP = 260  # 約一年交易日
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
            out = []
            for i, t in enumerate(res.get("timestamp") or []):
                o, h, l, c, v = (q.get(k, [None])[i] for k in ("open", "high", "low", "close", "volume"))
                if None in (o, h, l, c):
                    continue
                d = dt.datetime.fromtimestamp(t, TZ).strftime("%Y%m%d")
                rd = 2 if c < 100 else 1
                out.append([d, round(o, rd), round(h, rd), round(l, rd), round(c, rd), round((v or 0) / 1000)])
            return out
        except Exception:
            time.sleep(1.5)
    return None


def work(code: str, info: dict, last_day: str):
    path = OUT / f"{code}.json"
    old = load_json(path, None)
    rows = (old or {}).get("d") or []
    if rows and rows[-1][0] >= last_day:
        return "skip"
    fresh = not rows or rows[-1][0] < (dt.datetime.now(TZ) - dt.timedelta(days=20)).strftime("%Y%m%d")
    got = yahoo(code, info.get("m", "上市"), "1y" if fresh else "5d")
    if not got:
        return "fail"
    by = {r[0]: r for r in rows}
    for r in got:
        by[r[0]] = r
    merged = [by[k] for k in sorted(by)][-KEEP:]
    save_json(path, {"c": code, "n": info.get("n", ""), "m": info.get("m", ""), "d": merged}, compact=True)
    return "new" if fresh else "upd"


def main() -> int:
    meta = load_json(META_DIR / "stocks.json", {}) or {}
    tx = load_json(DATA_DIR / "tools" / "taiex.json", {}) or {}
    today = dt.datetime.now(TZ).strftime("%Y%m%d")
    last_day = max((d for d in tx if d <= today), default=today)
    # 收盤前（14:00 前）最近交易日以前一天為準
    if last_day == today and dt.datetime.now(TZ).hour < 14:
        last_day = max((d for d in tx if d < today), default=today)
    codes = sorted(meta)
    lim = int(os.environ.get("KLINE_MAX", "0") or 0)
    if lim:
        codes = codes[:lim]
    OUT.mkdir(parents=True, exist_ok=True)
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
