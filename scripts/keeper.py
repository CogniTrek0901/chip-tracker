"""排程管家：GitHub 的 cron 排程常延遲好幾個小時甚至整天沒觸發，
所以用一個「長時間執行的工作」每 10 分鐘檢查一次，需要時主動觸發「每日強勢族群」與「小功能資料」。

- 盤後（台北 13:30～24:00）與早上（07:00～10:30）的週一～五才工作，其他時間直接結束
- 判斷條件與各工作流程自己的守門程式（plan_run.py）相同
- 同一個工作流程正在跑或排隊中就不重複觸發；小功能「全部更新」最多 30 分鐘觸發一次
- 單一工作最長 6 小時，快到時會觸發新的管家接手
需要環境變數 GH_TOKEN（工作流程內的 GITHUB_TOKEN）與 GITHUB_REPOSITORY。
"""
from __future__ import annotations

import datetime as dt
import json
import os
import subprocess
import sys
import time

import plan_run as P

TZ = dt.timezone(dt.timedelta(hours=8))
START = time.time()
LIFE = 5 * 3600 + 40 * 60   # 5 小時 40 分後交棒
STEP = 600                  # 每 10 分鐘檢查一次


def now():
    return dt.datetime.now(TZ)


def in_window(t: dt.datetime) -> bool:
    if t.weekday() >= 5:
        return False
    m = t.hour * 60 + t.minute
    return 13 * 60 + 30 <= m or 7 * 60 <= m <= 10 * 60 + 30


def gh(*args: str) -> str:
    r = subprocess.run(["gh", *args], capture_output=True, text=True)
    if r.returncode:
        print(f"  ! gh {' '.join(args)}：{r.stderr.strip()[:200]}")
    return r.stdout


def recent_runs(wf: str) -> list[dict]:
    out = gh("run", "list", "--workflow", wf, "--limit", "8", "--json", "status,createdAt,updatedAt,event")
    try:
        return json.loads(out or "[]")
    except Exception:
        return []


def busy_or_recent(wf: str, minutes: int) -> bool:
    lim = dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=minutes)
    for r in recent_runs(wf):
        if r.get("status") in ("queued", "in_progress", "waiting", "pending", "requested"):
            return True
        t = r.get("updatedAt") or r.get("createdAt") or ""
        try:
            if dt.datetime.fromisoformat(t.replace("Z", "+00:00")) > lim:
                return True
        except ValueError:
            pass
    return False


def pull():
    subprocess.run(["git", "pull", "-q", "--ff-only", "origin", "main"], capture_output=True)


def tick(td_cache: dict):
    t = now()
    P.NOW, P.TODAY = t, t.strftime("%Y%m%d")
    pull()
    key = t.strftime("%Y%m%d%H")
    if td_cache.get("k") != key:  # 交易日清單每小時查一次
        td_cache["k"], td_cache["v"] = key, P.trading_days()
    td = td_cache["v"]
    run, why = P.plan_hot(td)
    if run and not busy_or_recent("daily.yml", 20):
        print(f"{t:%H:%M} 觸發強勢族群：{why}")
        gh("workflow", "run", "daily.yml")
    else:
        print(f"{t:%H:%M} 強勢族群：{'等待執行中的工作' if run else why}")
    _, mode, why = P.plan_tools(td)
    if mode == "all" and not busy_or_recent("tools.yml", 30):
        print(f"{t:%H:%M} 觸發小功能（全部）：{why}")
        gh("workflow", "run", "tools.yml", "-f", "mode=all")
    elif mode == "ft" and t.hour >= 17 and not busy_or_recent("tools.yml", 60):
        print(f"{t:%H:%M} 觸發小功能（富台指）")
        gh("workflow", "run", "tools.yml", "-f", "mode=ft")
    else:
        print(f"{t:%H:%M} 小功能：{why}")


def main() -> int:
    td_cache: dict = {}
    while True:
        t = now()
        if not in_window(t):
            print(f"{t:%m-%d %H:%M} 不在工作時段，結束")
            return 0
        try:
            tick(td_cache)
        except Exception as e:  # 單次失敗不影響下一輪
            print(f"  ! 檢查失敗：{e}")
        if time.time() - START > LIFE:
            print("工作時間將滿，交棒給新的管家")
            gh("workflow", "run", "keeper.yml")
            return 0
        time.sleep(STEP)


if __name__ == "__main__":
    sys.exit(main())
