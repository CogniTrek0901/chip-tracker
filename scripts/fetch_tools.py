"""小功能資料：富台指換算、大盤融資維持率、席勒本益比、融資與外資期貨未平倉、期貨警示。

用法：
  python scripts/fetch_tools.py ft     # 只更新富台指換算（快，夜盤多次執行）
  python scripts/fetch_tools.py all    # 全部（每日收盤後），含補歷史資料

環境變數：
  TOOLS_BUDGET_MIN  本次補歷史資料最多花幾分鐘（預設 12）
資料來源：證交所 MI_MARGN／MI_INDEX／MI_QFIIS／MI_5MINS_HIST、期交所 OpenAPI、SGX 富台指（延遲報價）、
主計總處 CPI（失敗則改用名目值）。
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import sys
import time
import xml.etree.ElementTree as ET

import requests

from common import DATA_DIR, META_DIR, SITE_DATA, is_stock_code, load_json, save_json

TZ = dt.timezone(dt.timedelta(hours=8))
UA = {"User-Agent": "Mozilla/5.0 (CogniTrek; tools)"}
# 期交所網站下載檔要像一般瀏覽器
TFX_HDR = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
           "Referer": "https://www.taifex.com.tw/cht/3/futContractsDate", "Origin": "https://www.taifex.com.tw",
           "Content-Type": "application/x-www-form-urlencoded"}
TW = "https://www.twse.com.tw"
TF = "https://openapi.taifex.com.tw/v1"
CACHE = DATA_DIR / "tools"
OUT = SITE_DATA / "tools"
NOW = dt.datetime.now(TZ)
START = time.time()
BUDGET = float(os.environ.get("TOOLS_BUDGET_MIN", "12")) * 60
PX_CACHE: dict = {}  # 月底股價（融資維持率抓過就給席勒本益比沿用）
TECH = {"半導體業", "電子零組件業", "光電業", "電腦及週邊設備業", "通信網路業", "電子通路業", "資訊服務業", "其他電子業"}


def num(s):
    s = re.sub(r"<[^>]+>", "", str(s)).replace(",", "").strip()
    try:
        return float(s)
    except ValueError:
        return None


def stamp():
    return dt.datetime.now(TZ).strftime("%Y-%m-%d %H:%M")


def twse(path: str, **params):
    """證交所 JSON，遇到流量限制（回 HTML 或連線失敗）會等久一點再試。"""
    params.setdefault("response", "json")
    for k in range(4):
        try:
            r = requests.get(TW + path, params=params, headers=UA, timeout=60)
            j = r.json()
            return j
        except Exception as e:
            print(f"  ! 證交所 {path} {params.get('date')} 第 {k + 1} 次失敗：{str(e)[:60]}", file=sys.stderr)
            time.sleep(20 * (k + 1))
    return {}


def taifex(path: str):
    for k in range(3):
        try:
            r = requests.get(TF + path, headers={**UA, "Accept": "application/json"}, timeout=60)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            print(f"  ! 期交所 {path} 失敗：{str(e)[:80]}", file=sys.stderr)
            time.sleep(5 * (k + 1))
    return []


# ======================================================================
# 1. 富台指換算台指期
# ======================================================================
def sgx_ft():
    """SGX FTSE Taiwan 指數期貨（交易所網站延遲報價）。
    ref＝前一個日盤結算價（preliminary-settlement），其日期＝base-date 的前一個工作日。"""
    url = "https://api.sgx.com/derivatives/v1.0/contract-code/TWN"
    params = {"order": "asc", "orderby": "delivery-month", "category": "futures", "session": "-1",
              "t": int(time.time() * 1000), "showTAICTrades": "false"}
    hdr = {**UA, "Origin": "https://www.sgx.com", "Referer": "https://www.sgx.com/"}
    for k in range(3):
        try:
            j = requests.get(url, params=params, headers=hdr, timeout=30).json()
            rows = [x for x in j.get("data", []) if x.get("last-traded-price-adj") is not None]
            if not rows:
                return None
            x = max(rows, key=lambda r: r.get("total-volume") or 0)  # 成交量最大＝主力合約
            last = float(x["last-traded-price-adj"])
            ref = x.get("preliminary-settlement-price-abs")
            ref = float(ref) if ref not in (None, "", "-") else last - float(x.get("change-adj") or 0)
            base = str(x.get("base-date") or NOW.strftime("%Y%m%d"))
            bd = dt.datetime.strptime(base, "%Y%m%d").date() - dt.timedelta(days=1)
            while bd.weekday() >= 5:
                bd -= dt.timedelta(days=1)
            t = str(x.get("last-update-time") or "")[:16]
            if not t:
                ts = x.get("updated-time")
                t = (dt.datetime.fromtimestamp(ts / 1000, TZ) if ts else NOW).strftime("%Y-%m-%d %H:%M")
            return {"last": last, "ref": round(ref, 2), "chg": round(last - ref, 2), "sym": x.get("symbol", ""),
                    "t": t, "refDate": bd.strftime("%Y%m%d"), "base": base}
        except Exception as e:
            print(f"  ! SGX 富台指失敗：{str(e)[:80]}", file=sys.stderr)
            time.sleep(5)
    return None


def tx_close(want: str | None = None):
    """台指期近月一般盤收盤：先用期交所 OpenAPI，日期不符再用期交所下載檔（futDataDown）。"""
    rows = taifex("/DailyMarketReportFut")

    def pick(rs):
        tx = [r for r in rs if r.get("Contract") == "TX" and r.get("TradingSession") == "一般"
              and "/" not in r.get("ContractMonth(Week)", "") and num(r.get("Last"))]
        if not tx:
            return None
        tx.sort(key=lambda r: r["ContractMonth(Week)"])
        r = tx[0]
        return {"d": r["Date"], "close": num(r["Last"]), "settle": num(r.get("SettlementPrice")), "m": r["ContractMonth(Week)"].strip()}

    tx = pick(rows)
    if want and (not tx or tx["d"] != want):
        try:
            d = f"{want[:4]}/{want[4:6]}/{want[6:]}"
            r = requests.post("https://www.taifex.com.tw/cht/3/futDataDown", headers=TFX_HDR, timeout=60,
                              data={"down_type": "1", "commodity_id": "TX", "commodity_id2": "", "queryStartDate": d, "queryEndDate": d})
            text = r.content.decode("big5", errors="ignore")
            rs = []
            for line in text.splitlines()[1:]:
                c = [v.strip() for v in line.split(",")]
                if len(c) >= 18:
                    rs.append({"Date": c[0].replace("/", ""), "Contract": c[1], "ContractMonth(Week)": c[2], "Last": c[6],
                               "SettlementPrice": c[10], "TradingSession": c[17]})
            alt = pick(rs)
            if alt and alt["d"] == want:
                tx = alt
            elif not rs:
                print(f"  ! 期交所下載檔（台指期）沒有資料：{r.status_code} {text[:80]!r}", file=sys.stderr)
        except Exception as e:
            print(f"  ! 期交所下載檔（台指期）失敗：{str(e)[:80]}", file=sys.stderr)
    return tx, rows


def do_ft():
    """回傳期交所當日期貨行情（後面的期貨警示共用）。"""
    ft = sgx_ft()
    tx, fut_rows = tx_close(ft["refDate"] if ft else None)
    path = OUT / "ft.json"
    old = load_json(path, {}) or {}
    settles = dict(old.get("settles") or {})
    if old.get("ft", {}).get("refDate") and old["ft"].get("ref"):
        settles.setdefault(old["ft"]["refDate"], old["ft"]["ref"])
    if ft:
        settles[ft["refDate"]] = ft["ref"]
    settles = dict(sorted(settles.items())[-30:])
    if not ft or not tx:
        print("富台指或台指期資料取得失敗，保留舊資料")
        return fut_rows
    if tx["d"] != ft["refDate"]:
        # 台股休市但新加坡有開（或反過來）：改用台指期收盤當天的富台指結算價當基準
        if tx["d"] in settles:
            ft["ref"], ft["refDate"] = settles[tx["d"]], tx["d"]
            ft["chg"] = round(ft["last"] - ft["ref"], 2)
        else:
            print(f"台指期收盤日期 {tx['d']} 與富台指基準日 {ft['refDate']} 不一致，暫不更新換算")
            old["settles"] = settles
            save_json(path, old, compact=True)
            return fut_rows
    est = round(tx["close"] * ft["last"] / ft["ref"])
    snap = {"t": ft["t"], "ft": ft["last"], "est": est}
    hist = [h for h in old.get("hist", []) if h.get("t") != snap["t"]] + [snap]
    save_json(path, {"updated": stamp(), "ft": ft, "tx": tx, "est": est, "chg": round(est - tx["close"]),
                     "pct": round((est / tx["close"] - 1) * 100, 2), "hist": hist[-30:], "settles": settles}, compact=True)
    print(f"富台指 {ft['last']}（基準 {ft['ref']} @{ft['refDate']}）→ 台指期預估 {est}（基準 TX {tx['close']} @{tx['d']}）")
    return fut_rows


# ======================================================================
# 2. 大盤融資維持率（逐日，含補歷史）
# ======================================================================
def trading_days(months: int) -> dict:
    """近 N 個月交易日與加權指數收盤（MI_5MINS_HIST 一個月一次）。快取在 data/tools/taiex.json。"""
    path = CACHE / "taiex.json"
    tx = load_json(path, {}) or {}
    y, m = NOW.year, NOW.month
    for k in range(months):
        ym = f"{y}{m:02d}"
        have = [d for d in tx if d.startswith(ym)]
        recent = k < 2
        if not have or recent:
            j = twse("/rwd/zh/TAIEX/MI_5MINS_HIST", date=ym + "01")
            for row in j.get("data", []) or []:
                p = str(row[0]).strip().split("/")
                if len(p) == 3:
                    d = f"{int(p[0]) + 1911}{int(p[1]):02d}{int(p[2]):02d}"
                    tx[d] = num(row[4])
            time.sleep(1.5)
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    save_json(path, dict(sorted(tx.items())), compact=True)
    return tx


def day_prices(d: str) -> dict:
    """當日上市個股 {代號: (收盤, 本益比, 均價)}。"""
    j = twse("/rwd/zh/afterTrading/MI_INDEX", date=d, type="ALLBUT0999")
    if j.get("stat") != "OK":
        return {}
    t = next((x for x in j.get("tables", []) if "每日收盤行情" in str(x.get("title", ""))), None)
    if not t:
        return {}
    f = t["fields"]
    ci, pi = f.index("收盤價"), (f.index("本益比") if "本益比" in f else None)
    vi, ai = (f.index("成交股數") if "成交股數" in f else None), (f.index("成交金額") if "成交金額" in f else None)
    out = {}
    for r in t["data"]:
        c = num(r[ci])
        v, a = (num(r[vi]) if vi is not None else None), (num(r[ai]) if ai is not None else None)
        out[str(r[0]).strip()] = (c, num(r[pi]) if pi is not None else None, round(a / v, 3) if v and a else c)
    return out


def day_margin(d: str, px: dict):
    """當日融資：金額、張數、融券張數、融資股票市值 → 維持率。"""
    j = twse("/rwd/zh/marginTrading/MI_MARGN", date=d, selectType="ALL")
    if j.get("stat") != "OK" or len(j.get("tables", [])) < 2:
        return None
    tot = {str(r[0]): r for r in j["tables"][0].get("data", [])}
    amt = num(tot.get("融資金額(仟元)", [None] * 6)[5])
    lots = num(tot.get("融資(交易單位)", [None] * 6)[5])
    short = num(tot.get("融券(交易單位)", [None] * 6)[5])
    val = 0.0
    for r in j["tables"][1].get("data", []):
        c, q = str(r[0]).strip(), num(r[6])
        p = (px.get(c) or (None,))[0]
        if q and p:
            val += q * 1000 * p
    if not amt:
        return None
    amt_yi = amt * 1000 / 1e8
    return [round(amt_yi, 2), round(val / 1e8, 2), round(val / (amt * 1000) * 100, 2), int(lots or 0), int(short or 0)]


def do_margin(tx: dict, today_px: dict) -> dict:
    """data/tools/margin.json：{日期: [融資金額億, 融資市值億, 維持率%, 融資張, 融券張]}。"""
    path = CACHE / "margin.json"
    mg = load_json(path, {}) or {}
    alld = sorted(tx, reverse=True)
    # 近 400 天逐日；更早的只取每週最後一個交易日與月底（10 年約 700 天，避免對證交所請求過多）
    recent = (NOW - dt.timedelta(days=400)).strftime("%Y%m%d")
    wk, mo = {}, {}
    for d in sorted(tx):
        y, w, _ = dt.date(int(d[:4]), int(d[4:6]), int(d[6:])).isocalendar()
        wk[(y, w)] = d
        mo[d[:6]] = d
    keep = set(wk.values()) | set(mo.values())
    ten = (NOW - dt.timedelta(days=3660)).strftime("%Y%m%d")
    days = [d for d in alld if d >= recent or (d in keep and d >= ten)]
    done = 0
    for d in days:
        if d in mg and d not in alld[:2]:
            continue
        if d > NOW.strftime("%Y%m%d"):
            continue
        if time.time() - START > BUDGET * 0.6:
            print(f"已達時間上限，其餘下次補（尚缺 {sum(1 for x in days if x not in mg)} 天）")
            break
        px = today_px if (d == alld[0] and today_px) else day_prices(d)
        time.sleep(0.8)
        if not px:
            continue
        if d in mo.values():
            PX_CACHE[d] = px
        v = day_margin(d, px)
        time.sleep(0.8)
        if v:
            mg[d] = v
            done += 1
            if done % 40 == 0:
                save_json(path, dict(sorted(mg.items())), compact=True)
                print(f"  融資維持率已補 {done} 天（最新 {d}）")
    save_json(path, dict(sorted(mg.items())), compact=True)
    cut = (NOW - dt.timedelta(days=3660)).strftime("%Y%m%d")
    rows = [[d, tx.get(d)] + v[:3] for d, v in sorted(mg.items()) if d >= cut and tx.get(d)]
    save_json(OUT / "margin.json", {"updated": stamp(), "f": ["日期", "加權指數", "融資餘額(億)", "融資市值(億)", "維持率%"], "d": rows}, compact=True)
    print(f"融資維持率：共 {len(mg)} 天，本次新增 {done} 天")
    return mg


# ======================================================================
# 3. 席勒本益比（月）
# ======================================================================
def month_pe(d: str) -> list | None:
    """月底：上市普通股總市值與總盈餘（市值/本益比），回傳 [市值億, 盈餘億]。"""
    px = PX_CACHE.get(d) or day_prices(d)
    time.sleep(0.8)
    j = twse("/rwd/zh/fund/MI_QFIIS", date=d, selectType="ALLBUT0999")
    time.sleep(0.8)
    rows = j.get("data") or ((j.get("tables") or [{}])[0].get("data")) or []
    if not px or not rows:
        return None
    cap = E = 0.0
    for r in rows:
        c = str(r[0]).strip()
        if not is_stock_code(c):
            continue
        sh = num(r[3])
        p, pe = (px.get(c) or (None, None))[:2]
        if sh and p:
            cap += sh * p
            if pe and pe > 0:
                E += sh * p / pe
    return [round(cap / 1e8, 1), round(E / 1e8, 1)] if cap and E else None


def cpi_series() -> dict:
    """主計總處 CPI 總指數（月），失敗就沿用快取；都沒有則回傳空 dict（改用名目值）。"""
    path = CACHE / "cpi.json"
    cache = load_json(path, {}) or {}
    if cache and cache.get("_u", "")[:6] == NOW.strftime("%Y%m"):
        return cache
    try:
        r = requests.get("https://ws.dgbas.gov.tw/001/Upload/461/relfile/11525/230555/pr0101a1m.xml", headers=TFX_HDR, timeout=60)
        print(f"  CPI 下載：{r.status_code}，{len(r.content)} bytes，開頭 {r.content[:120]!r}")
        root = ET.fromstring(r.content)
        out = {}
        for el in root.iter():
            kids = {c.tag.split("}")[-1]: (c.text or "").strip() for c in el}
            item, per, val = kids.get("Item", ""), kids.get("TIME_PERIOD", ""), kids.get("Item_VALUE", "")
            if item and per and val and "總指數" in item and "不含" not in item:
                m = re.match(r"(\d{4})M?-?(\d{1,2})", per)
                if m and num(val):
                    out[f"{m.group(1)}{int(m.group(2)):02d}"] = num(val)
        if len(out) <= 100:
            sample = [[c.tag.split("}")[-1] + "=" + (c.text or "")[:20] for c in el] for el in list(root.iter())[:6]]
            print(f"  CPI 結構：{sample}")
        if len(out) > 100:
            out["_u"] = NOW.strftime("%Y%m%d")
            save_json(path, out, compact=True)
            print(f"CPI：{len(out) - 1} 個月")
            return out
        print(f"  ! CPI 格式不符（{len(out)} 筆），改用快取", file=sys.stderr)
    except Exception as e:
        print(f"  ! CPI 取得失敗：{str(e)[:80]}", file=sys.stderr)
    return cache


def do_cape(tx: dict):
    path = CACHE / "pe_monthly.json"
    pm = load_json(path, {}) or {}
    # 每月最後一個交易日
    ends = {}
    for d in sorted(tx):
        ends[d[:6]] = d
    first = "200601"
    # 補 2006 起月資料（加權指數用 MI_5MINS_HIST 另抓）
    y, m = 2006, 1
    while f"{y}{m:02d}" <= NOW.strftime("%Y%m"):
        ym = f"{y}{m:02d}"
        if ym not in ends:
            j = twse("/rwd/zh/TAIEX/MI_5MINS_HIST", date=ym + "01")
            rows = j.get("data", []) or []
            if rows:
                p = str(rows[-1][0]).strip().split("/")
                d = f"{int(p[0]) + 1911}{int(p[1]):02d}{int(p[2]):02d}"
                ends[ym] = d
                tx[d] = num(rows[-1][4])
            time.sleep(1.2)
        m += 1
        if m == 13:
            y, m = y + 1, 1
    cur = NOW.strftime("%Y%m")
    done = 0
    for ym in sorted(ends, reverse=True):
        if ym < first:
            continue
        d = ends[ym]
        if ym in pm and pm[ym][0] == d and ym != cur:
            continue
        if ym in pm and ym == cur and pm[ym][0] == d:
            continue
        if time.time() - START > BUDGET * 0.95:
            print("席勒本益比：已達時間上限，其餘下次補")
            break
        v = month_pe(d)
        if v:
            pm[ym] = [d, tx.get(d)] + v
            done += 1
    save_json(path, dict(sorted(pm.items())), compact=True)
    save_json(CACHE / "taiex.json", dict(sorted(tx.items())), compact=True)
    cpi = cpi_series()
    real = len([k for k in cpi if not k.startswith("_")]) > 100
    months = sorted(k for k in pm if pm[k][1] and pm[k][3])
    eps = {k: pm[k][1] * pm[k][3] / pm[k][2] for k in months}  # 加權指數尺度的每股盈餘 = 指數 / 本益比

    def cp(k):
        if not real:
            return 1.0
        if k in cpi:
            return cpi[k]
        ks = [x for x in cpi if not x.startswith("_") and x <= k]
        return cpi[max(ks)] if ks else None

    out = []
    for i, k in enumerate(months):
        win = [x for x in months if x <= k][-120:]
        y0, m0 = int(k[:4]), int(k[4:]) - 119
        while m0 <= 0:
            y0, m0 = y0 - 1, m0 + 12
        if len(win) < 115 or win[0] > f"{y0}{m0:02d}" or not cp(k):
            continue
        ok = [x for x in win if cp(x)]
        avg = sum(eps[x] * cp(k) / cp(x) for x in ok) / len(ok)
        out.append([k, round(pm[k][1], 2), round(pm[k][1] / avg, 2), round(pm[k][2] / pm[k][3], 2)])
    out = [r for r in out if r[0] >= (NOW - dt.timedelta(days=3660)).strftime("%Y%m")]
    save_json(OUT / "cape.json", {"updated": stamp(), "real": real, "f": ["年月", "加權指數", "席勒本益比", "本益比"], "m": out}, compact=True)
    print(f"席勒本益比：月資料 {len(pm)} 個月，本次新增 {done}，輸出 {len(out)} 點（{'實質' if real else '名目'}）")


# ======================================================================
# 2b. 個股融資維持率（估算）
# ======================================================================
KCACHE: dict = {}


def kline(code: str) -> list:
    if code not in KCACHE:
        KCACHE[code] = (load_json(SITE_DATA / "k" / f"{code}.json", {}) or {}).get("d") or []
    return KCACHE[code]


def init_avg(code: str, d: str, fallback):
    """沒有歷史時：用該日以前 60 個交易日的平均收盤當融資成本。"""
    cl = [r[4] for r in kline(code) if r[0] <= d][-60:]
    return round(sum(cl) / len(cl), 3) if cl else fallback


def tpex_margin():
    """上櫃：櫃買中心 OpenAPI（只有最新一日）。回傳 (日期, {代號: [買進, 前日餘額, 今日餘額, 收盤, 均價]})。"""
    base = "https://www.tpex.org.tw/openapi/v1/"
    try:
        m = requests.get(base + "tpex_mainboard_margin_balance", headers=TFX_HDR, timeout=40).json()
        q = requests.get(base + "tpex_mainboard_daily_close_quotes", headers=TFX_HDR, timeout=40).json()
    except Exception as e:
        print(f"  ! 櫃買中心 OpenAPI 無法連線：{str(e)[:80]}", file=sys.stderr)
        return None, {}
    px = {x["SecuritiesCompanyCode"].strip(): (num(x.get("Close")), num(x.get("Average"))) for x in q}
    out, day = {}, None
    for x in m:
        c = x["SecuritiesCompanyCode"].strip()
        roc = str(x.get("Date", ""))
        if len(roc) == 7:
            day = f"{int(roc[:3]) + 1911}{roc[3:]}"
        cl, av = px.get(c, (None, None))
        out[c] = [num(x.get("MarginPurchase")), num(x.get("MarginPurchaseBalancePreviousDay")), num(x.get("MarginPurchaseBalance")), cl, av or cl]
    return day, out


def roll(S: dict, code: str, d: str, buy, prev, bal, close, vwap, mkt: str):
    st = S.get(code)
    if st is None:
        if not close:
            return
        st = [prev or 0, init_avg(code, d, close), close, mkt]
    b0, avg = st[0], st[1]
    if buy and vwap and (b0 + buy) > 0:
        avg = (b0 * avg + buy * vwap) / (b0 + buy)
    if not bal:
        avg = close or avg  # 融資清空：下次重新起算
    S[code] = [int(bal or 0), round(avg, 3), close or st[2], mkt, int((bal or 0) - (prev or 0))]


def do_stock_margin(tx: dict):
    path = CACHE / "stock_margin_state.json"
    st = load_json(path, {}) or {}
    S, done_d, otc_d = st.get("s", {}), st.get("d", ""), st.get("od", "")
    today = NOW.strftime("%Y%m%d")
    recent = sorted(d for d in tx if d <= today and d >= (NOW - dt.timedelta(days=400)).strftime("%Y%m%d"))
    todo = [d for d in recent if d > done_d] if done_d else recent[-120:]
    n = 0
    for d in todo:
        if time.time() - START > BUDGET * 0.8:
            print(f"個股融資：已達時間上限，處理到 {done_d}")
            break
        px = day_prices(d)
        time.sleep(0.8)
        j = twse("/rwd/zh/marginTrading/MI_MARGN", date=d, selectType="ALL")
        time.sleep(0.8)
        if not px or j.get("stat") != "OK" or len(j.get("tables", [])) < 2:
            continue
        for r in j["tables"][1].get("data", []):
            c = str(r[0]).strip()
            p = px.get(c)
            if not p:
                continue
            roll(S, c, d, num(r[2]), num(r[5]), num(r[6]), p[0], p[2], "上市")
        done_d = d
        n += 1
    # 上櫃（OpenAPI 只有最新一日，只能從今天往後累積）
    od, om = tpex_margin()
    if od and om and od > otc_d:
        for c, (buy, prev, bal, cl, av) in om.items():
            roll(S, c, od, buy, prev, bal, cl, av, "上櫃")
        otc_d = od
    save_json(path, {"d": done_d, "od": otc_d, "s": S}, compact=True)
    meta = load_json(META_DIR / "stocks.json", {}) or {}
    rows = []
    for c, (bal, avg, close, mkt, chg) in S.items():
        if not bal or not avg or not close or c not in meta:
            continue
        lend = 0.6 if mkt == "上市" else 0.5
        ratio = close / (avg * lend) * 100
        if ratio < 90 or ratio > 500:  # 多半是減資、分割或新上市造成的估算失真，略過
            continue
        rows.append([c, meta[c].get("n", ""), mkt, meta[c].get("i", ""), close, round(avg, 2), round(ratio, 1), bal, chg])
    rows.sort(key=lambda r: r[6])
    save_json(OUT / "stock_margin.json", {"updated": stamp(), "d": done_d, "od": otc_d,
                                          "f": ["代號", "名稱", "市場", "產業", "收盤", "融資成本", "維持率%", "融資餘額(張)", "增減(張)"],
                                          "rows": rows}, compact=True)
    print(f"個股融資維持率：上市處理到 {done_d}（本次 {n} 天）、上櫃 {otc_d or '無'}；共 {len(rows)} 檔，低於 150% 有 {sum(1 for r in rows if r[6] < 150)} 檔")


# ======================================================================
# 4. 融資與外資期貨未平倉（近 5 日）
# ======================================================================
def do_flow(mg: dict, tx: dict):
    path = CACHE / "fut_oi.json"
    oi = load_json(path, {}) or {}
    rows = taifex("/MarketDataOfMajorInstitutionalTradersDetailsOfFuturesContractsBytheDate")
    for r in rows:
        if r.get("ContractCode") != "臺股期貨":
            continue
        who = {"外資及陸資": "外資", "外資": "外資", "投信": "投信", "自營商": "自營"}.get(r.get("Item", "").strip())
        if not who:
            continue
        d = r["Date"]
        oi.setdefault(d, {})[who] = [int(num(r.get("OpenInterest(Long)")) or 0), int(num(r.get("OpenInterest(Short)")) or 0),
                                    int(num(r.get("OpenInterest(Net)")) or 0)]
    if len(oi) < 6:  # 第一次：試著用期交所下載檔補近幾天
        try:
            end = NOW.date()
            st = end - dt.timedelta(days=14)
            r = requests.post("https://www.taifex.com.tw/cht/3/futContractsDateDown", headers=TFX_HDR, timeout=60, data={
                "queryStartDate": st.strftime("%Y/%m/%d"), "queryEndDate": end.strftime("%Y/%m/%d"), "commodityId": "TXF"})
            text = r.content.decode("big5", errors="ignore")
            if "臺股期貨" not in text:
                print(f"  ! 期交所三大法人下載檔沒有資料：{r.status_code} {text[:80]!r}", file=sys.stderr)
            for line in text.splitlines()[1:]:
                c = [x.strip() for x in line.split(",")]
                if len(c) < 15 or "臺股期貨" not in c[1]:
                    continue
                who = {"外資及陸資": "外資", "外資": "外資", "投信": "投信", "自營商": "自營"}.get(c[2])
                if not who:
                    continue
                d = c[0].replace("/", "")
                # 欄位：…, 多方未平倉口數(9), 多方金額, 空方未平倉口數(11), 空方金額, 淨額口數(13)
                oi.setdefault(d, {}).setdefault(who, [int(num(c[9]) or 0), int(num(c[11]) or 0), int(num(c[13]) or 0)])
        except Exception as e:
            print(f"  ! 期交所下載檔失敗：{str(e)[:80]}", file=sys.stderr)
    oi = dict(sorted(oi.items())[-60:])
    save_json(path, oi, compact=True)
    ds = [d for d in sorted(set(mg) | set(oi)) if d in mg][-6:]
    out = []
    for i, d in enumerate(ds):
        m = mg[d]
        f = oi.get(d, {}).get("外資")
        out.append({"d": d, "taiex": tx.get(d), "mAmt": m[0], "mLots": m[3], "sLots": m[4], "ratio": m[2],
                    "fL": f[0] if f else None, "fS": f[1] if f else None, "fN": f[2] if f else None,
                    "it": (oi.get(d, {}).get("投信") or [None] * 3)[2], "dl": (oi.get(d, {}).get("自營") or [None] * 3)[2]})
    save_json(OUT / "flow.json", {"updated": stamp(), "rows": out}, compact=True)
    print(f"融資／外資未平倉：{len(out)} 天")


# ======================================================================
# 5. 期貨警示（電子／半導體個股期貨與現貨價差過大）
# ======================================================================
def otc_close(codes: list[str], day: str) -> dict:
    out = {}
    want = dt.datetime.strptime(day, "%Y%m%d").date()
    for i in range(0, len(codes), 20):
        chunk = codes[i:i + 20]
        try:
            j = requests.get("https://query1.finance.yahoo.com/v8/finance/spark",
                             params={"symbols": ",".join(c + ".TWO" for c in chunk), "range": "5d", "interval": "1d"},
                             headers={"User-Agent": "Mozilla/5.0"}, timeout=20).json()
        except Exception:
            continue
        for sym, v in j.items():
            for a, b in zip(v.get("timestamp") or [], v.get("close") or []):
                if b is not None and dt.datetime.fromtimestamp(a, TZ).date() == want:
                    out[sym.split(".")[0]] = round(b, 2)
        time.sleep(0.5)
    return out


def do_futalert(fut_rows: list, today_px: dict, px_day: str, th: float = 5.0):
    meta = load_json(META_DIR / "stocks.json", {}) or {}
    under = taifex("/SingleStockFuturesMargining")
    cmap = {u["Contract"]: (u["UnderlyingSecurityCode"], u["ContractName"]) for u in under}
    rows = [r for r in fut_rows if r.get("Contract") in cmap and r.get("TradingSession") == "一般"
            and "/" not in r.get("ContractMonth(Week)", "")]
    if not rows:
        print("期貨警示：無個股期貨資料")
        return
    day = rows[0]["Date"]
    near = {}
    for r in rows:  # 每個契約取最近月
        c = r["Contract"]
        if c not in near or r["ContractMonth(Week)"] < near[c]["ContractMonth(Week)"]:
            near[c] = r
    cands = {c: r for c, r in near.items() if meta.get(cmap[c][0], {}).get("i") in TECH}
    px = today_px if (today_px and day == px_day) else day_prices(day)
    otc = [cmap[c][0] for c in cands if meta.get(cmap[c][0], {}).get("m") == "上櫃"]
    opx = otc_close(sorted(set(otc)), day) if otc else {}
    items = []
    for c, r in cands.items():
        code, cname = cmap[c]
        spot = (px.get(code) or (None,))[0] if meta.get(code, {}).get("m") != "上櫃" else opx.get(code)
        last, settle, vol = num(r.get("Last")), num(r.get("SettlementPrice")), int(num(r.get("Volume")) or 0)
        if not spot or not last or vol <= 0:
            continue
        dev = (last / spot - 1) * 100
        if abs(dev) >= th:
            items.append({"c": code, "n": meta.get(code, {}).get("n", ""), "ind": meta.get(code, {}).get("i", ""),
                          "m": meta.get(code, {}).get("m", ""), "spot": spot, "fut": cname, "fc": c,
                          "ym": r["ContractMonth(Week)"], "last": last, "settle": settle, "vol": vol, "dev": round(dev, 2),
                          "sdev": round((settle / spot - 1) * 100, 2) if settle else None})
    items.sort(key=lambda x: x["dev"])
    path = OUT / "futalert.json"
    old = load_json(path, {}) or {}
    hist = {k: v for k, v in (old.get("hist") or {}).items()}
    if items:
        hist[day] = items
    hist = dict(sorted(hist.items())[-20:])
    save_json(path, {"updated": stamp(), "d": day, "th": th, "n": len(cands), "items": items, "hist": hist}, compact=True)
    print(f"期貨警示 {day}：電子類個股期貨 {len(cands)} 檔，價差 ≥{th}% 共 {len(items)} 檔")


def main() -> int:
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    OUT.mkdir(parents=True, exist_ok=True)
    CACHE.mkdir(parents=True, exist_ok=True)
    fut_rows = do_ft()
    if mode == "ft":
        return 0
    today = NOW.strftime("%Y%m%d")
    tx = trading_days(122)
    last_day = max((d for d in tx if d <= today), default=today)
    today_px = day_prices(last_day)
    time.sleep(1.2)
    try:
        mg = do_margin(tx, today_px)
    except Exception as e:
        print(f"  ! 融資維持率失敗：{e}", file=sys.stderr)
        mg = load_json(CACHE / "margin.json", {}) or {}
    for step, fn in (("個股融資維持率", lambda: do_stock_margin(tx)),
                     ("期貨警示", lambda: do_futalert(fut_rows or taifex("/DailyMarketReportFut"), today_px, last_day)),
                     ("融資／外資", lambda: do_flow(mg, tx)),
                     ("席勒本益比", lambda: do_cape(tx))):
        try:
            fn()
        except Exception as e:
            print(f"  ! {step} 失敗：{e}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
