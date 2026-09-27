"""回補歷史週資料（選用）。

集保開放資料只提供「最新一週」，歷史週次需逐檔向集保查詢頁
https://www.tdcc.com.tw/portal/zh/smWeb/qryStock 查詢（約可查近一年）。
全市場約 1,800 檔 × 每週一次請求，速度刻意放慢以免造成對方負擔，
因此支援中斷續跑：進度存在 data/backfill_tmp/，下次執行會接續。

用法：
  python scripts/backfill.py --weeks 8 --max-minutes 300
"""
from __future__ import annotations

import argparse
import html
import json
import random
import re
import sys
import time

import requests

from common import (DATA_DIR, UA, is_stock_code, list_raw_dates, load_json,
                    META_DIR, raw_path, read_raw, to_int, write_raw)

URL = "https://www.tdcc.com.tw/portal/zh/smWeb/qryStock"
TMP_DIR = DATA_DIR / "backfill_tmp"

HIDDEN_RE = re.compile(r'<input[^>]*type="hidden"[^>]*>', re.I)
NAME_RE = re.compile(r'name="([^"]+)"')
VALUE_RE = re.compile(r'value="([^"]*)"')
SELECT_RE = re.compile(r'<select[^>]*name="scaDate"[^>]*>(.*?)</select>', re.S | re.I)
OPTION_RE = re.compile(r'<option[^>]*value="(\d{8})"')
TR_RE = re.compile(r"<tr[^>]*>(.*?)</tr>", re.S | re.I)
TD_RE = re.compile(r"<td[^>]*>(.*?)</td>", re.S | re.I)
TAG_RE = re.compile(r"<[^>]+>")


class Tdcc:
    def __init__(self):
        self.s = requests.Session()
        self.s.headers.update(UA)
        self.hidden: dict[str, str] = {}
        self.dates: list[str] = []
        self.refresh()

    def _parse_hidden(self, text: str) -> None:
        for tag in HIDDEN_RE.findall(text):
            n, v = NAME_RE.search(tag), VALUE_RE.search(tag)
            if n:
                self.hidden[n.group(1)] = html.unescape(v.group(1)) if v else ""

    def refresh(self) -> None:
        r = self.s.get(URL, timeout=60)
        r.raise_for_status()
        self._parse_hidden(r.text)
        m = SELECT_RE.search(r.text)
        self.dates = OPTION_RE.findall(m.group(1)) if m else []
        if not self.dates:
            raise RuntimeError("找不到集保查詢頁的日期清單，頁面格式可能已變更")

    def query(self, code: str, date: str) -> dict[int, tuple[int, int]]:
        data = dict(self.hidden)
        data.update({
            "SYNCHRONIZER_URI": "/portal/zh/smWeb/qryStock",
            "method": "submit",
            "firDate": self.dates[0],
            "scaDate": date,
            "sqlMethod": "StockNo",
            "stockNo": code,
            "stockName": "",
        })
        r = self.s.post(URL, data=data, timeout=60)
        r.raise_for_status()
        self._parse_hidden(r.text)  # token 可能每次更新
        levels: dict[int, tuple[int, int]] = {}
        for tr in TR_RE.findall(r.text):
            cells = [re.sub(r"\s", "", html.unescape(TAG_RE.sub("", c))) for c in TD_RE.findall(tr)]
            if len(cells) < 4:
                continue
            label = cells[1] if len(cells) >= 5 else ""
            if "合計" in label or "合計" in cells[0]:
                lv = 17
            elif "差異" in label:
                continue
            elif cells[0].isdigit() and 1 <= int(cells[0]) <= 15:
                lv = int(cells[0])
            else:
                continue
            nums = cells[-3:]  # 人數、股數、比例
            levels[lv] = (to_int(nums[0]), to_int(nums[1]))
        return levels


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--weeks", type=int, default=8, help="回補最近幾週（含已存在的週）")
    ap.add_argument("--max-minutes", type=float, default=300, help="最長執行時間，到了就存檔停止")
    ap.add_argument("--delay", type=float, default=0.8, help="每次請求間隔秒數")
    args = ap.parse_args()

    start = time.time()
    t = Tdcc()
    have = set(list_raw_dates())
    targets = [d for d in t.dates[:args.weeks] if d not in have]
    if not targets:
        print("指定週數都已存在，無需回補")
        return 0

    # 要查的股票：用最新一週原始資料或名稱清單
    codes = sorted((read_raw(max(have)) if have else {}).keys()) or \
        sorted((load_json(META_DIR / "stocks.json", {}) or {}).keys())
    codes = [c for c in codes if is_stock_code(c)]
    if not codes:
        print("沒有股票清單，請先執行 fetch_weekly.py", file=sys.stderr)
        return 1
    print(f"回補 {targets}，每週 {len(codes)} 檔")

    TMP_DIR.mkdir(parents=True, exist_ok=True)
    fails = 0
    for date in targets:
        tmp = TMP_DIR / f"{date}.json"
        done = {k: {int(lv): tuple(v) for lv, v in d.items()}
                for k, d in (load_json(tmp, {}) or {}).items()}
        todo = [c for c in codes if c not in done]
        print(f"[{date}] 已完成 {len(done)}，剩 {len(todo)}")
        for n, code in enumerate(todo, 1):
            if (time.time() - start) / 60 > args.max_minutes:
                tmp.write_text(json.dumps(done), encoding="utf-8")
                print("到達時間上限，已儲存進度，下次會接續")
                return 0
            try:
                lv = t.query(code, date)
                done[code] = lv if lv else {}
                fails = 0
            except Exception as e:
                fails += 1
                print(f"  ! {code} {date}：{e}", file=sys.stderr)
                if fails >= 5:
                    time.sleep(60)
                    try:
                        t.refresh()
                    except Exception:
                        pass
                if fails >= 20:
                    tmp.write_text(json.dumps(done), encoding="utf-8")
                    print("連續失敗過多，停止", file=sys.stderr)
                    return 1
            if n % 100 == 0:
                tmp.write_text(json.dumps(done), encoding="utf-8")
                print(f"  {n}/{len(todo)}")
            time.sleep(args.delay + random.random() * 0.4)

        rows = {c: v for c, v in done.items() if v}
        write_raw(date, rows)
        tmp.unlink(missing_ok=True)
        print(f"[{date}] 完成，{len(rows)} 檔 → {raw_path(date).name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
