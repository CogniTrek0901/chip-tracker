"""排程守門：GitHub 排程常延遲數小時甚至漏跑，所以每個工作流程設了多個備援時段，
由這支程式判斷「這一次需不需要跑、跑哪種模式」，已經完成的就直接略過。

用法：python scripts/plan_run.py hot|tools   → 把 RUN=0/1、MODE=all/ft 寫進 $GITHUB_ENV
"""
from __future__ import annotations

import datetime as dt
import json
import os
import sys
from pathlib import Path

import requests

TZ = dt.timezone(dt.timedelta(hours=8))
ROOT = Path(__file__).resolve().parent.parent
NOW = dt.datetime.now(TZ)
TODAY = NOW.strftime("%Y%m%d")
HDR = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"}


def load(p: str) -> dict:
    try:
        return json.loads((ROOT / p).read_text(encoding="utf-8"))
    except Exception:
        return {}


def trading_days() -> set[str] | None:
    """證交所本月＋上月的交易日（FMTQIK）；連不上回傳 None。"""
    out: set[str] = set()
    first = NOW.replace(day=1)
    for m in (first, (first - dt.timedelta(days=1)).replace(day=1)):
        try:
            r = requests.get("https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK",
                             params={"date": m.strftime("%Y%m01"), "response": "json"}, headers=HDR, timeout=20)
            for row in r.json().get("data") or []:
                y, mo, d = row[0].split("/")
                out.add(f"{int(y) + 1911}{int(mo):02d}{int(d):02d}")
        except Exception as e:
            print(f"FMTQIK 失敗：{e}")
            return None
    return out


def plan_hot(td: set[str] | None) -> tuple[bool, str]:
    if NOW.hour < 14:
        return False, "還沒收盤"
    if td is not None and TODAY not in td:
        return False, "今天不是交易日（或證交所還沒公布）"
    j = load(f"site/data/daily/{TODAY}.json")
    if not j:
        return True, "今天的強勢族群還沒產生"
    upd = j.get("updated", "")
    if NOW.hour >= 19 and upd[11:13] < "19":
        return True, f"晚間更新（上次 {upd}）"
    return False, f"今天已更新（{upd}）"


def plan_tools(td: set[str] | None) -> tuple[bool, str, str]:
    sm = load("site/data/tools/stock_margin.json")
    mg = load("site/data/tools/margin.json")
    have = sm.get("d", "")
    # 應該已經有資料的最近交易日：今天 21:00 以後算今天，否則算前一個交易日
    if td:
        cands = [d for d in td if d < TODAY or (d == TODAY and NOW.hour >= 21)]
        target = max(cands) if cands else ""
    else:
        target = TODAY if NOW.hour >= 21 else ""
    if target and have < target:
        return True, "all", f"融資資料停在 {have or '無'}，應有 {target}"
    upd = mg.get("updated", "")
    if 7 <= NOW.hour < 21 and upd < f"{NOW:%Y-%m-%d} 07:00":
        return True, "all", f"早上補跑（上次 {upd}）"
    return True, "ft", f"全部資料已是最新（{have}），只更新富台指"


def main() -> int:
    kind = sys.argv[1]
    event = os.environ.get("GITHUB_EVENT_NAME", "")
    env = os.environ.get("GITHUB_ENV")
    td = None if event == "workflow_dispatch" else trading_days()
    if event == "workflow_dispatch":
        run, mode, why = True, os.environ.get("INPUT_MODE") or "all", "手動執行"
    elif kind == "hot":
        run, why = plan_hot(td)
        mode = ""
    else:
        run, mode, why = plan_tools(td)
    print(f"台北 {NOW:%Y-%m-%d %H:%M}｜{kind}｜{'執行' if run else '略過'} {mode}｜{why}")
    if env:
        with open(env, "a", encoding="utf-8") as f:
            f.write(f"RUN={'1' if run else '0'}\nMODE={mode}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
