"""月營收：抓公開資訊觀測站「上市／上櫃 每月營業收入彙總表」，保留近 5 年。

- data/revenue/YYYYMM.json：{代號: [當月營收(千元), 月增%, 年增%, 累計年增%]}
- site/data/rev/{代號}.json：網站用，近 61 個月，單位「億元」
每次執行會補缺的月份（一次最多 REV_MAX_PAGES 頁），並重抓最近 2 個月（公司陸續申報到每月 10 日）。
"""
from __future__ import annotations

import datetime as dt
import os
import re
import sys
import time
from html.parser import HTMLParser

import requests

from common import DATA_DIR, SITE_DATA, META_DIR, is_stock_code, load_json, save_json

BASE = "https://mopsov.twse.com.tw/nas/t21/{mk}/t21sc03_{roc}_{m}_{kind}.html"
REV_DIR = DATA_DIR / "revenue"
MONTHS = 61
HEAD = {"User-Agent": "Mozilla/5.0 (chip-tracker)"}


class Cells(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows, self.row, self.cell = [], None, None

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self.row = []
        elif tag in ("td", "th") and self.row is not None:
            self.cell = []

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self.row is not None and self.cell is not None:
            self.row.append("".join(self.cell).strip())
            self.cell = None
        elif tag == "tr" and self.row is not None:
            self.rows.append(self.row)
            self.row = None

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)


def num(s):
    s = str(s).replace(",", "").strip()
    try:
        return float(s)
    except ValueError:
        return None


def fetch_page(mk: str, y: int, m: int, kind: int) -> dict | None:
    url = BASE.format(mk=mk, roc=y - 1911, m=m, kind=kind)
    r = requests.get(url, headers=HEAD, timeout=40)
    if r.status_code == 404:
        return {}
    r.raise_for_status()
    text = r.content.decode("big5", errors="ignore")
    p = Cells()
    p.feed(text)
    out = {}
    for row in p.rows:
        if len(row) < 10 or not is_stock_code(row[0].strip()):
            continue
        cur = num(row[2])
        if cur is None:
            continue
        out[row[0].strip()] = [int(cur), num(row[5]), num(row[6]), num(row[9])]
    return out


def months_back(n: int) -> list[tuple[int, int]]:
    today = dt.date.today()
    y, m = today.year, today.month - 1  # 本月營收下個月才公布
    if m == 0:
        y, m = y - 1, 12
    out = []
    for _ in range(n):
        out.append((y, m))
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return out  # 新 → 舊


def main() -> int:
    max_pages = int(os.environ.get("REV_MAX_PAGES", "60"))
    months = months_back(MONTHS)
    pages = 0
    for i, (y, m) in enumerate(months):
        key = f"{y}{m:02d}"
        path = REV_DIR / f"{key}.json"
        have = load_json(path, None)
        if have and i >= 2:
            continue
        if pages + 4 > max_pages:
            print(f"已達本次上限 {max_pages} 頁，其餘下次再補")
            break
        merged = {}
        ok = True
        for mk in ("sii", "otc"):
            for kind in (0, 1):
                try:
                    got = fetch_page(mk, y, m, kind)
                except Exception as e:
                    print(f"  ! {key} {mk}{kind} 失敗：{str(e)[:80]}", file=sys.stderr)
                    got = None
                    ok = False
                pages += 1
                if got:
                    merged.update(got)
                time.sleep(2.5)
        if merged and (ok or not have):
            save_json(path, merged, compact=True)
            print(f"{key}：{len(merged)} 家")
        elif not merged:
            print(f"{key}：尚無資料")

    # 產生網站用每檔檔案
    meta = load_json(META_DIR / "stocks.json", {}) or {}
    table = {}
    for (y, m) in reversed(months):
        key = f"{y}{m:02d}"
        d = load_json(REV_DIR / f"{key}.json", None)
        if not d:
            continue
        for code, (cur, mom, yoy, cum) in d.items():
            if meta and code not in meta:
                continue
            table.setdefault(code, []).append([key, round(cur / 1e5, 2), mom, yoy, cum])
    out_dir = SITE_DATA / "rev"
    for code, rows in table.items():
        save_json(out_dir / f"{code}.json", {"c": code, "n": meta.get(code, {}).get("n", ""), "m": rows}, compact=True)
    print(f"rev/*.json：{len(table)} 檔")
    return 0


if __name__ == "__main__":
    sys.exit(main())
