"""補齊每個集保資料週的收盤價（上市＋上櫃），存到 data/meta/prices.json。

每週只需兩次請求（證交所一次、櫃買一次），已經有的週次會略過。
若資料日當天休市，會往前找最多 5 天的最近交易日。
櫃買中心常擋 GitHub 主機，連不上時改用 Yahoo 財經逐檔補上櫃收盤價。
"""
from __future__ import annotations

import datetime as dt
import sys
import time

import requests

from common import META_DIR, UA, is_stock_code, list_raw_dates, load_json, save_json

TWSE = "https://www.twse.com.tw/exchangeReport/MI_INDEX"
TPEX_NEW = "https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes"
YAHOO = "https://query{}.finance.yahoo.com/v8/finance/chart/{}.TWO"
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
                          headers=UA, timeout=20)
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
        r = requests.get(TPEX_OLD, params={"l": "zh-tw", "d": roc, "o": "json"}, headers=UA, timeout=20)
        j = r.json()
        for row in j.get("aaData", []) or []:
            if is_stock_code(str(row[0]).strip()):
                v = num(row[2])
                if v:
                    out[str(row[0]).strip()] = v
    except Exception as e:
        print(f"  ! 櫃買舊版失敗：{e}", file=sys.stderr)
    return out


def yahoo_otc(codes: list[str], dates: list[str]) -> dict[str, dict[str, float]]:
    """逐檔向 Yahoo 取日線，回傳 {資料日: {代號: 收盤價}}（取資料日當天或之前最近一個交易日）。"""
    tz = dt.timezone(dt.timedelta(hours=8))
    ds = sorted(dates)
    p1 = int(dt.datetime.strptime(ds[0], "%Y%m%d").replace(tzinfo=tz).timestamp()) - 10 * 86400
    p2 = int(dt.datetime.strptime(ds[-1], "%Y%m%d").replace(tzinfo=tz).timestamp()) + 2 * 86400
    out: dict[str, dict[str, float]] = {d: {} for d in ds}
    fails = 0
    for n, code in enumerate(codes, 1):
        closes = None
        for host in (1, 2):
            try:
                r = requests.get(YAHOO.format(host, code), params={"period1": p1, "period2": p2, "interval": "1d"},
                                 headers={"User-Agent": "Mozilla/5.0"}, timeout=20)
                if r.status_code == 404:
                    closes = {}
                    break
                res = r.json()["chart"]["result"][0]
                ts = res.get("timestamp") or []
                cl = res["indicators"]["quote"][0].get("close") or []
                closes = {dt.datetime.fromtimestamp(a, tz).strftime("%Y%m%d"): round(b, 2)
                          for a, b in zip(ts, cl) if b is not None}
                break
            except Exception:
                time.sleep(2)
        if closes is None:
            fails += 1
            if fails >= 15 and fails > n // 2:
                print("  ! Yahoo 也連不上，停止", file=sys.stderr)
                break
            continue
        days = sorted(closes)
        for d in ds:
            prev = [x for x in days if x <= d and (dt.datetime.strptime(d, "%Y%m%d") - dt.datetime.strptime(x, "%Y%m%d")).days <= 6]
            if prev:
                out[d][code] = closes[prev[-1]]
        time.sleep(0.4)
        if n % 100 == 0:
            print(f"  Yahoo 進度 {n}/{len(codes)}")
    return out


def main() -> int:
    path = META_DIR / "prices.json"
    prices = load_json(path, {}) or {}
    meta = load_json(META_DIR / "stocks.json", {}) or {}
    otc = {c for c, v in meta.items() if v.get("m") == "上櫃"}

    def need_twse(d):
        return sum(1 for c in prices.get(d, {}) if c not in otc) < 900

    def need_tpex(d):
        return bool(otc) and sum(1 for c in prices.get(d, {}) if c in otc) < 500

    todo = [d for d in list_raw_dates() if need_twse(d) or need_tpex(d)]
    if not todo:
        print("各週收盤價皆已齊全")
        return 0
    tpex_ok = True  # 櫃買連不上時，本次執行就不再嘗試，下次排程再補
    for d in todo:
        base = dt.datetime.strptime(d, "%Y%m%d").date()
        want_a, want_b = need_twse(d), need_tpex(d) and tpex_ok
        if not want_a and not want_b:
            continue
        for back in range(0, 6):
            day = base - dt.timedelta(days=back)
            if day.weekday() >= 5:
                continue
            try:
                a = twse(day)
                time.sleep(3)
            except Exception as e:
                print(f"  ! {day} 證交所失敗：{e}", file=sys.stderr)
                time.sleep(5)
                continue
            if not a:  # 休市日，往前找
                continue
            b = {}
            if want_b:
                b = tpex(day)
                time.sleep(3)
                if not b:
                    tpex_ok = False
                    print("  ! 櫃買中心暫時連不上，上櫃股價留待下次補齊", file=sys.stderr)
            got = {**(a if want_a else {}), **b}
            if got:
                prices[d] = {**prices.get(d, {}), **got}
                save_json(path, prices, compact=True)
            print(f"{d}：使用 {day} 收盤價，上市 {len(a) if want_a else '已有'}、上櫃 {len(b)} 檔")
            break

    # 櫃買連不上 → 用 Yahoo 補上櫃
    miss = [d for d in list_raw_dates() if need_tpex(d)]
    if miss and otc:
        print(f"以 Yahoo 補上櫃收盤價：{len(miss)} 週 × {len(otc)} 檔")
        got = yahoo_otc(sorted(otc), miss)
        for d, m in got.items():
            if m:
                prices[d] = {**prices.get(d, {}), **m}
            print(f"{d}：Yahoo 上櫃 {len(m)} 檔")
        save_json(path, prices, compact=True)
    return 0

if __name__ == "__main__":
    sys.exit(main())
