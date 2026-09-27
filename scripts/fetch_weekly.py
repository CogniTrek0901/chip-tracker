"""每週抓取：集保戶股權分散表（全市場最新一週）＋ 股票名稱/產業 ＋ 收盤價。

資料來源（皆為官方公開資料）：
  - 集保結算所 開放資料 1-5 集保戶股權分散表
    https://opendata.tdcc.com.tw/getOD.ashx?id=1-5
  - 證交所 ISIN 代碼表（上市 strMode=2、上櫃 strMode=4）
  - 證交所 / 櫃買中心 OpenAPI 每日收盤價

重複執行是安全的：同一資料日期已存在就跳過集保資料下載。
"""
from __future__ import annotations

import csv
import html
import io
import re
import sys
import time

import requests

from common import (META_DIR, UA, is_stock_code, list_raw_dates, load_json,
                    raw_path, save_json, to_int, write_raw)

TDCC_URL = "https://opendata.tdcc.com.tw/getOD.ashx?id=1-5"
ISIN_URL = "https://isin.twse.com.tw/isin/C_public.jsp?strMode={mode}"
TWSE_PRICE_URL = "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL"
TPEX_PRICE_URL = "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes"


def get(url: str, retries: int = 4, timeout: int = 90) -> requests.Response:
    last = None
    for i in range(retries):
        try:
            r = requests.get(url, headers=UA, timeout=timeout)
            r.raise_for_status()
            return r
        except requests.RequestException as e:  # noqa: PERF203
            last = e
            wait = 10 * (i + 1)
            print(f"  ! {url} 失敗（{e}），{wait}s 後重試", file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError(f"下載失敗：{url}：{last}")


# ---------------------------------------------------------------- 集保資料
def fetch_tdcc() -> str | None:
    """下載並儲存最新一週。回傳資料日期；若已存在回傳 None。"""
    print("下載集保戶股權分散表 …")
    r = get(TDCC_URL)
    text = r.content.decode("utf-8-sig", errors="replace")
    reader = csv.reader(io.StringIO(text))
    header = next(reader, None)
    if not header or "證券代號" not in "".join(header):
        raise RuntimeError(f"集保 CSV 格式不符：{header}")

    rows: dict[str, dict[int, tuple[int, int]]] = {}
    date = None
    for rec in reader:
        if len(rec) < 5:
            continue
        d, code, level = rec[0].strip(), rec[1].strip(), rec[2].strip()
        if not is_stock_code(code):
            continue
        lv = int(level)
        if lv == 16:  # 差異數調整，不需要
            continue
        date = date or d
        rows.setdefault(code, {})[lv] = (to_int(rec[3]), to_int(rec[4]))

    if not date or not rows:
        raise RuntimeError("集保 CSV 沒有股票資料")
    if raw_path(date).exists():
        print(f"  {date} 已存在，略過")
        return None
    write_raw(date, rows)
    print(f"  已儲存 {date}：{len(rows)} 檔股票")
    return date


# ---------------------------------------------------------------- 名稱/產業
TR_RE = re.compile(r"<tr[^>]*>(.*?)</tr>", re.S | re.I)
TD_RE = re.compile(r"<td[^>]*>(.*?)</td>", re.S | re.I)
TAG_RE = re.compile(r"<[^>]+>")


def fetch_isin(mode: int, market: str) -> dict[str, dict]:
    r = get(ISIN_URL.format(mode=mode))
    text = r.content.decode("cp950", errors="ignore")
    out = {}
    for tr in TR_RE.findall(text):
        cells = [html.unescape(TAG_RE.sub("", c)).strip() for c in TD_RE.findall(tr)]
        if len(cells) < 6:
            continue
        first = cells[0].replace("　", " ").split(None, 1)
        if len(first) != 2:
            continue
        code, name = first[0].strip(), first[1].strip()
        cfi = cells[5] if len(cells) > 5 else ""
        if not is_stock_code(code) or not cfi.startswith("ES"):
            continue
        out[code] = {"n": name, "m": market, "i": cells[4]}
    print(f"  {market}：{len(out)} 檔")
    return out


def fetch_meta() -> dict[str, dict]:
    print("下載股票名稱與產業 …")
    meta_path = META_DIR / "stocks.json"
    old = load_json(meta_path, {}) or {}
    new: dict[str, dict] = {}
    for mode, market in ((2, "上市"), (4, "上櫃")):
        try:
            new.update(fetch_isin(mode, market))
        except Exception as e:  # 失敗就沿用舊資料
            print(f"  ! ISIN {market} 失敗：{e}", file=sys.stderr)
    if len(new) < 500:  # 不完整 → 沿用舊的並合併
        print("  ! 名稱清單不完整，與舊資料合併", file=sys.stderr)
        merged = dict(old)
        merged.update(new)
        new = merged
    save_json(meta_path, new)
    return new


# ---------------------------------------------------------------- 收盤價
def fetch_prices(date: str) -> None:
    print("下載收盤價 …")
    prices: dict[str, float] = {}
    try:
        for row in get(TWSE_PRICE_URL).json():
            c, p = row.get("Code", ""), row.get("ClosingPrice", "")
            if is_stock_code(c):
                try:
                    prices[c] = float(str(p).replace(",", ""))
                except ValueError:
                    pass
    except Exception as e:
        print(f"  ! 上市股價失敗：{e}", file=sys.stderr)
    try:
        for row in get(TPEX_PRICE_URL).json():
            c = row.get("SecuritiesCompanyCode", "")
            p = row.get("Close", "")
            if is_stock_code(c):
                try:
                    prices[c] = float(str(p).replace(",", ""))
                except ValueError:
                    pass
    except Exception as e:
        print(f"  ! 上櫃股價失敗：{e}", file=sys.stderr)
    if prices:
        all_prices = load_json(META_DIR / "prices.json", {}) or {}
        all_prices[date] = prices
        save_json(META_DIR / "prices.json", all_prices, compact=True)
        print(f"  {len(prices)} 檔股價")


def main() -> int:
    new_date = fetch_tdcc()
    fetch_meta()
    latest = new_date or (list_raw_dates() or [None])[-1]
    if latest:
        prices = load_json(META_DIR / "prices.json", {}) or {}
        if new_date or latest not in prices:
            fetch_prices(latest)
    return 0


if __name__ == "__main__":
    sys.exit(main())
