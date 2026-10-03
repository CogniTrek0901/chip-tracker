"""補齊每個集保資料週的收盤價（上市＋上櫃），存到 data/meta/prices.json。

每週只需兩次請求（證交所一次、櫃買一次），已經有的週次會略過。
若資料日當天休市，會往前找最多 5 天的最近交易日。
"""
from __future__ import annotations

import datetime as dt
import sys
import time

import requests

from common import META_DIR, UA, is_stock_code, list_raw_dates, load_json, save_json

TWSE = "https://www.twse.com.tw/exchangeReport/MI_INDEX"
TPEX_NEW = "https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes"
TPEX_OLD = "https://www.tpex.org.tw/web/stock/aftertrading/daily_close_quotes/stk_quote_result.php"


def num(s) -> float | None:
    try:
        return float(str(s).replace(",", "").strip())
    except ValueError:
        return None


def close_idx(fields) -> int | None:
    for i, f in enumerate(fields or []):
        if "收盤" in str(f):
            return i
    return None


def twse(day: dt.date) -> dict[str, float]:
    r = requests.get(TWSE, params={"response": "json", "date": day.strftime("%Y%m%d"), "type": "ALLBUT0999"},
                     headers=UA, timeout=60)
    j = r.json()
    if j.get("stat") != "OK":
        return {}
    out = {}
    for t in j.get("tables", []):
        if "每日收盤行情" not in str(t.get("title", "")):
            continue
        ci = close_idx(t.get("fields"))
        for row in t.get("data", []):
            if ci is not None and is_stock_code(str(row[0]).strip()):
                v = num(row[ci])
                if v:
                    out[str(row[0]).strip()] = v
    return out


def tpex(day: dt.date) -> dict[str, float]:
    out = {}
    try:  # 新版網址
        r = requests.post(TPEX_NEW, data={"date": day.strftime("%Y/%m/%d"), "id": "", "response": "json"},
                          headers=UA, timeout=60)
        j = r.json()
        for t in j.get("tables", []):
            ci = close_idx(t.get("fields"))
            for row in t.get("data", []):
                if ci is not None and is_stock_code(str(row[0]).strip()):
                    v = num(row[ci])
                    if v:
                        out[str(row[0]).strip()] = v
    except Exception as e:
        print(f"  ! 櫃買新版失敗：{e}", file=sys.stderr)
    if out:
        return out
    try:  # 舊版網址（民國日期）
        roc = f"{day.year - 1911}/{day:%m/%d}"
        r = requests.get(TPEX_OLD, params={"l": "zh-tw", "d": roc, "o": "json"}, headers=UA, timeout=60)
        j = r.json()
        for row in j.get("aaData", []) or []:
            if is_stock_code(str(row[0]).strip()):
                v = num(row[2])
                if v:
                    out[str(row[0]).strip()] = v
    except Exception as e:
        print(f"  ! 櫃買舊版失敗：{e}", file=sys.stderr)
    return out


def main() -> int:
    path = META_DIR / "prices.json"
    prices = load_json(path, {}) or {}
    todo = [d for d in list_raw_dates() if len(prices.get(d, {})) < 1000]
    if not todo:
        print("各週收盤價皆已齊全")
        return 0
    for d in todo:
        base = dt.datetime.strptime(d, "%Y%m%d").date()
        got: dict[str, float] = {}
        for back in range(0, 6):
            day = base - dt.timedelta(days=back)
            if day.weekday() >= 5:
                continue
            try:
                a = twse(day)
                time.sleep(3)
                b = tpex(day) if a else {}
                time.sleep(3)
            except Exception as e:
                print(f"  ! {day} 失敗：{e}", file=sys.stderr)
                time.sleep(5)
                continue
            if a:
                got = {**a, **b}
                print(f"{d}：使用 {day} 收盤價，上市 {len(a)}、上櫃 {len(b)} 檔")
                break
        if got:
            prices[d] = {**prices.get(d, {}), **got}
            save_json(path, prices, compact=True)
        else:
            print(f"{d}：找不到收盤價", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
