"""抓取公開資訊觀測站「法人說明會一覽表」，存成 data/conferences.json（工作流程再複製到 site/data）。

範圍：過去兩個月 ～ 未來三個月（上市 sii、上櫃 otc 各查一次／月）。
"""
from __future__ import annotations

import datetime as dt
import re
import sys
import time
from html.parser import HTMLParser

import requests

from common import DATA_DIR, is_stock_code, load_json, save_json

URL = "https://mopsov.twse.com.tw/mops/web/ajax_t100sb02_1"
HEAD = {"User-Agent": "Mozilla/5.0 (chip-tracker)", "Referer": "https://mopsov.twse.com.tw/mops/web/t100sb02_1"}
ROC = re.compile(r"(\d{2,3})/(\d{1,2})/(\d{1,2})")


class Rows(HTMLParser):
    """把 HTML 表格攤平成 [[cell, ...], ...]。"""

    def __init__(self):
        super().__init__()
        self.rows, self.row, self.cell = [], None, None

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self.row = []
        elif tag in ("td", "th") and self.row is not None:
            self.cell = []
        elif tag == "br" and self.cell is not None:
            self.cell.append(" ")

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self.row is not None and self.cell is not None:
            self.row.append(re.sub(r"\s+", " ", "".join(self.cell)).strip())
            self.cell = None
        elif tag == "tr" and self.row is not None:
            self.rows.append(self.row)
            self.row = None

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)


def roc_dates(s: str) -> list[str]:
    out = []
    for y, m, d in ROC.findall(s):
        try:
            out.append(dt.date(int(y) + 1911, int(m), int(d)).isoformat())
        except ValueError:
            pass
    return out


def fetch(market: str, y: int, m: int) -> list[dict]:
    body = {"encodeURIComponent": 1, "step": 1, "firstin": 1, "off": 1, "TYPEK": market,
            "year": str(y - 1911), "month": f"{m:02d}", "co_id": ""}
    r = requests.post(URL, data=body, headers=HEAD, timeout=40)
    r.encoding = "utf-8"
    p = Rows()
    p.feed(r.text)
    out = []
    for row in p.rows:
        if len(row) < 6 or not is_stock_code(row[0]):
            continue
        ds = roc_dates(row[2])
        if not ds:
            continue
        out.append({
            "c": row[0], "n": row[1], "d": ds[0], "e": ds[-1] if len(ds) > 1 else "",
            "t": row[3], "loc": row[4][:60], "msg": row[5][:120],
        })
    return out


def main() -> int:
    today = dt.date.today()
    months = []
    for k in range(-2, 4):
        mm = today.month - 1 + k
        months.append((today.year + mm // 12, mm % 12 + 1))
    items, ok = {}, 0
    path = DATA_DIR / "conferences.json"
    old = load_json(path, {}) or {}
    for it in old.get("items", []):  # 先放舊資料，這次查詢失敗的月份不會消失
        items[(it["c"], it["d"], it["t"])] = it
    for y, m in months:
        for market in ("sii", "otc"):
            # 觀測站查太快會擋（回 0 筆或拒絕連線），失敗就等久一點再試
            for attempt in range(4):
                try:
                    got = fetch(market, y, m)
                except Exception as e:
                    got = None
                    print(f"  ! {y}-{m:02d} {market} 第 {attempt + 1} 次失敗：{str(e)[:80]}", file=sys.stderr)
                if got or (got is not None and attempt >= 1):
                    break
                time.sleep(20 * (attempt + 1))
            if got is not None:
                ok += 1
                for it in got:
                    items[(it["c"], it["d"], it["t"])] = it
                print(f"{y}-{m:02d} {market}：{len(got)} 筆")
            time.sleep(8)
    if not ok:
        print("全部失敗，保留舊資料", file=sys.stderr)
        return 0
    lo = months[0]
    start = dt.date(lo[0], lo[1], 1).isoformat()
    rows = sorted((v for v in items.values() if v["d"] >= start), key=lambda v: (v["d"], v["c"]))
    if not rows and old.get("items"):
        print("本次沒抓到任何資料，保留舊資料", file=sys.stderr)
        return 0
    save_json(path, {"updated": dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).strftime("%Y-%m-%d %H:%M"),
                     "from": start, "items": rows}, compact=True)
    print(f"conferences.json：{len(rows)} 筆")
    return 0


if __name__ == "__main__":
    sys.exit(main())
