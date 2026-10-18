"""強勢族群：每日漲停與漲幅 ≥ 8% 個股，標示族群、三大法人、AI 理由，存 site/data/daily/YYYYMMDD.json。

- 上市：證交所 MI_INDEX（行情）＋ T86（三大法人）
- 上櫃：櫃買中心（常擋 GitHub 主機）→ 失敗改用 Yahoo spark 批次報價
- 每檔強勢股另抓近 5 年月收盤（Yahoo），存 site/data/price/{代號}.json
- 若有環境變數 GEMINI_API_KEY，請 Gemini（含 Google 搜尋）寫 1–2 行理由與近期重大事件
用法：python scripts/fetch_daily.py [YYYYMMDD]
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import sys
import time

import requests

from common import META_DIR, SITE_DATA, is_stock_code, load_json, save_json

UA = {"User-Agent": "Mozilla/5.0 (chip-tracker)"}
TZ = dt.timezone(dt.timedelta(hours=8))
DAILY = SITE_DATA / "daily"
PRICE = SITE_DATA / "price"
MIN_PCT = 8.0


def num(s):
    s = re.sub(r"<[^>]+>", "", str(s)).replace(",", "").strip()
    try:
        return float(s)
    except ValueError:
        return None


def is_limit_up(close, prev, high):
    """台股漲停 = 前收 ×1.1 後依升降單位無條件捨去；用 9.4% 以上且收在最高近似判斷。"""
    if not (close and prev and high):
        return False
    return (close - prev) / prev * 100 >= 9.4 and abs(close - high) < 1e-6


# ---------------- 上市 ----------------
def twse(day: str) -> dict:
    r = requests.get("https://www.twse.com.tw/exchangeReport/MI_INDEX",
                     params={"response": "json", "date": day, "type": "ALLBUT0999"}, headers=UA, timeout=60)
    j = r.json()
    if j.get("stat") != "OK":
        return {}
    t = next((x for x in j.get("tables", []) if "每日收盤行情" in str(x.get("title", ""))), None)
    if not t:
        return {}
    f = t["fields"]
    ix = {k: f.index(k) for k in ("證券代號", "證券名稱", "成交股數", "最高價", "收盤價", "漲跌(+/-)", "漲跌價差")}
    out = {}
    for row in t["data"]:
        code = str(row[ix["證券代號"]]).strip()
        if not is_stock_code(code):
            continue
        close, diff, high = num(row[ix["收盤價"]]), num(row[ix["漲跌價差"]]), num(row[ix["最高價"]])
        if close is None or diff is None:
            continue
        sign = -1 if "-" in str(row[ix["漲跌(+/-)"]]) else 1
        prev = close - sign * diff
        if prev <= 0:
            continue
        vol = num(row[ix["成交股數"]]) or 0
        out[code] = {"n": str(row[ix["證券名稱"]]).strip(), "close": close, "prev": prev, "high": high,
                     "vol": round(vol / 1000), "m": "上市"}
    return out


def twse_inst(day: str) -> dict:
    try:
        r = requests.get("https://www.twse.com.tw/rwd/zh/fund/T86",
                         params={"date": day, "selectType": "ALLBUT0999", "response": "json"}, headers=UA, timeout=60)
        j = r.json()
        if j.get("stat") != "OK":
            return {}
        f = j["fields"]
        i_f = f.index("外陸資買賣超股數(不含外資自營商)")
        i_t = f.index("投信買賣超股數")
        i_d = f.index("自營商買賣超股數")
        return {str(x[0]).strip(): [round((num(x[i_f]) or 0) / 1000), round((num(x[i_t]) or 0) / 1000),
                                    round((num(x[i_d]) or 0) / 1000)] for x in j["data"]}
    except Exception as e:
        print(f"  ! 三大法人失敗：{e}", file=sys.stderr)
        return {}


# ---------------- 上櫃 ----------------
def tpex(day: str) -> dict:
    d = f"{day[:4]}/{day[4:6]}/{day[6:]}"
    out = {}
    try:
        r = requests.post("https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes",
                          data={"date": d, "id": "", "response": "json"}, headers=UA, timeout=20)
        j = r.json()
        for t in j.get("tables", []):
            f = [str(x) for x in t.get("fields", [])]
            try:
                ic = next(i for i, x in enumerate(f) if "收盤" in x)
                idf = next(i for i, x in enumerate(f) if "漲跌" in x)
                ih = next(i for i, x in enumerate(f) if "最高" in x)
                iv = next(i for i, x in enumerate(f) if "成交股數" in x)
            except StopIteration:
                continue
            for row in t.get("data", []):
                code = str(row[0]).strip()
                if not is_stock_code(code):
                    continue
                close, diff = num(row[ic]), num(row[idf])
                if close is None or diff is None:
                    continue
                prev = close - diff
                if prev <= 0:
                    continue
                out[code] = {"n": str(row[1]).strip(), "close": close, "prev": prev, "high": num(row[ih]),
                             "vol": round((num(row[iv]) or 0) / 1000), "m": "上櫃"}
    except Exception as e:
        print(f"  ! 櫃買行情失敗：{str(e)[:80]}", file=sys.stderr)
    return out


def yahoo_spark(codes: list[str], day: str) -> dict:
    """批次取上櫃收盤與前收（Yahoo spark，一次 20 檔）。"""
    out = {}
    want = dt.datetime.strptime(day, "%Y%m%d").date()
    for i in range(0, len(codes), 20):
        chunk = codes[i:i + 20]
        try:
            r = requests.get("https://query1.finance.yahoo.com/v8/finance/spark",
                             params={"symbols": ",".join(c + ".TWO" for c in chunk), "range": "5d", "interval": "1d"},
                             headers={"User-Agent": "Mozilla/5.0"}, timeout=20)
            j = r.json()
        except Exception:
            time.sleep(2)
            continue
        for sym, v in j.items():
            ts, cl = v.get("timestamp") or [], v.get("close") or []
            pairs = [(dt.datetime.fromtimestamp(a, TZ).date(), b) for a, b in zip(ts, cl) if b is not None]
            idx = next((k for k, (d, _) in enumerate(pairs) if d == want), None)
            if idx is None or idx == 0:
                continue
            out[sym.split(".")[0]] = {"close": pairs[idx][1], "prev": pairs[idx - 1][1]}
        time.sleep(0.4)
    return out


def yahoo_chart(code: str, market: str, rng: str, interval: str):
    sfx = ".TW" if market == "上市" else ".TWO"
    for host in (1, 2):
        try:
            r = requests.get(f"https://query{host}.finance.yahoo.com/v8/finance/chart/{code}{sfx}",
                             params={"range": rng, "interval": interval}, headers={"User-Agent": "Mozilla/5.0"}, timeout=20)
            res = r.json()["chart"]["result"][0]
            q = res["indicators"]["quote"][0]
            return res.get("timestamp") or [], q
        except Exception:
            time.sleep(1.5)
    return [], {}


# ---------------- 族群 ----------------
def load_groups():
    t = load_json(SITE_DATA / "themes.json", {}) or {}
    g = {}
    for ch in t.get("chains", []):
        for st in ch.get("stages", []):
            for sg in st.get("segments", []):
                for c in sg.get("codes", []):
                    g.setdefault(c, []).append(sg["name"])
    return g


# ---------------- Gemini ----------------
def gemini_reasons(items: list[dict], day: str) -> dict:
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key or not items:
        return {}
    model = os.environ.get("GEMINI_MODEL", "gemini-flash-latest")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    out = {}
    for i in range(0, len(items), 10):
        batch = items[i:i + 10]
        lines = "\n".join(f"- {x['c']} {x['n']}（{x['m']}，{x['ind']}）今日漲 {x['pct']:.2f}%" for x in batch)
        prompt = (f"你是台股盤後分析助理。日期 {day[:4]}/{day[4:6]}/{day[6:]}。以下個股今日大漲或漲停，"
                  "請用 Google 搜尋查近期新聞、公開資訊觀測站重大訊息、營收或法說會，為每檔寫：\n"
                  "reason：今日上漲的可能原因（繁體中文，40 字內，具體、不誇大，不構成投資建議）\n"
                  "event：最近 2 週內的重大事件（含日期，40 字內；查不到就寫空字串）\n"
                  "grp：所屬題材族群（2–6 字，如 CPO、記憶體、機器人、重電）\n"
                  "只輸出 JSON 陣列，格式 [{\"c\":\"代號\",\"reason\":\"...\",\"event\":\"...\",\"grp\":\"...\"}]，不要其他文字。\n" + lines)
        body = {"contents": [{"role": "user", "parts": [{"text": prompt}]}],
                "tools": [{"google_search": {}}],
                "generationConfig": {"temperature": 0.3}}
        for attempt in range(3):
            try:
                r = requests.post(url, params={"key": key}, json=body, timeout=120)
                if r.status_code == 429:
                    time.sleep(20 * (attempt + 1))
                    continue
                r.raise_for_status()
                parts = r.json()["candidates"][0]["content"]["parts"]
                text = "".join(p.get("text", "") for p in parts)
                m = re.search(r"\[[\s\S]*\]", text)
                for x in json.loads(m.group(0)) if m else []:
                    if isinstance(x, dict) and x.get("c"):
                        out[str(x["c"]).strip()] = {k: str(x.get(k, ""))[:80] for k in ("reason", "event", "grp")}
                break
            except Exception as e:
                print(f"  ! Gemini 失敗：{str(e)[:120]}", file=sys.stderr)
                time.sleep(5)
        time.sleep(4)
    print(f"Gemini 理由：{len(out)}／{len(items)} 檔")
    return out


def main() -> int:
    day = sys.argv[1] if len(sys.argv) > 1 else dt.datetime.now(TZ).strftime("%Y%m%d")
    meta = load_json(META_DIR / "stocks.json", {}) or {}
    q = twse(day)
    if not q:
        print(f"{day} 非交易日或證交所尚無資料")
        return 0
    inst = twse_inst(day)
    otc = tpex(day)
    if len(otc) < 300:
        codes = sorted(c for c, v in meta.items() if v.get("m") == "上櫃")
        sp = yahoo_spark(codes, day)
        for c, v in sp.items():
            otc[c] = {"n": meta.get(c, {}).get("n", c), "close": v["close"], "prev": v["prev"], "high": None,
                      "vol": None, "m": "上櫃"}
        print(f"上櫃改用 Yahoo：{len(sp)} 檔")
    q.update(otc)
    groups = load_groups()

    movers = []
    for c, v in q.items():
        pct = (v["close"] - v["prev"]) / v["prev"] * 100
        if pct < MIN_PCT - 1e-9:
            continue
        movers.append({"c": c, "n": v["n"] or meta.get(c, {}).get("n", ""), "m": v["m"], "ind": meta.get(c, {}).get("i", ""),
                       "close": v["close"], "pct": round(pct, 2), "vol": v["vol"], "high": v["high"]})
    # 上櫃補量與最高價（判斷漲停）
    for x in movers:
        if x["m"] == "上櫃" and (x["vol"] is None or x["high"] is None):
            ts, qd = yahoo_chart(x["c"], "上櫃", "5d", "1d")
            want = dt.datetime.strptime(day, "%Y%m%d").date()
            for k, t in enumerate(ts):
                if dt.datetime.fromtimestamp(t, TZ).date() == want:
                    x["high"] = (qd.get("high") or [None] * len(ts))[k] or x["high"]
                    v = (qd.get("volume") or [None] * len(ts))[k]
                    x["vol"] = round(v / 1000) if v else x["vol"]
            time.sleep(0.4)
    for x in movers:
        x["lu"] = bool(x["pct"] >= 9.4 and (x["high"] is None or abs(x["close"] - x["high"]) < 1e-6))
        x["inst"] = inst.get(x["c"])
        x["grp"] = groups.get(x["c"], [])[:2]
        del x["high"]
    movers.sort(key=lambda x: (-x["lu"], -x["pct"]))

    ai = gemini_reasons(movers, day)
    for x in movers:
        a = ai.get(x["c"], {})
        x["reason"], x["event"] = a.get("reason", ""), a.get("event", "")
        if not x["grp"]:
            x["grp"] = [a["grp"]] if a.get("grp") else ([x["ind"]] if x["ind"] else ["其他"])

    # 近 5 年月收盤（每月更新一次快取）
    ym = day[:6]
    for x in movers:
        p = PRICE / f"{x['c']}.json"
        old = load_json(p, None)
        if old and old.get("u", "")[:6] == ym:
            continue
        ts, qd = yahoo_chart(x["c"], x["m"], "5y", "1mo")
        cl = qd.get("close") or []
        rows = [[dt.datetime.fromtimestamp(a, TZ).strftime("%Y%m"), round(b, 2)] for a, b in zip(ts, cl) if b is not None]
        if rows:
            save_json(p, {"c": x["c"], "u": day, "m": rows}, compact=True)
        time.sleep(0.5)

    save_json(DAILY / f"{day}.json", {"d": day, "updated": dt.datetime.now(TZ).strftime("%Y-%m-%d %H:%M"),
                                      "ai": bool(ai), "items": movers}, compact=True)
    idx = sorted({p.stem for p in DAILY.glob("2*.json")}, reverse=True)[:60]
    for p in DAILY.glob("2*.json"):
        if p.stem not in idx:
            p.unlink()
    save_json(DAILY / "index.json", {"dates": idx}, compact=True)
    lu = sum(1 for x in movers if x["lu"])
    print(f"{day}：強勢股 {len(movers)} 檔（漲停 {lu}）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
