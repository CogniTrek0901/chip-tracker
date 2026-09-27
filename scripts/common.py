"""共用設定與工具函式。"""
from __future__ import annotations

import csv
import gzip
import io
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
RAW_DIR = DATA_DIR / "raw"          # 每週一個檔：YYYYMMDD.csv.gz
META_DIR = DATA_DIR / "meta"        # 股票名稱、市場、產業、股價
SITE_DATA = ROOT / "site" / "data"  # 網站讀取的彙總資料

UA = {"User-Agent": "Mozilla/5.0 (chip-tracker; weekly shareholder distribution)"}

# 集保戶股權分散表 15 個持股分級（單位：股）
# 1:1-999 2:1,000-5,000 3:5,001-10,000 4:10,001-15,000 5:15,001-20,000
# 6:20,001-30,000 7:30,001-40,000 8:40,001-50,000 9:50,001-100,000
# 10:100,001-200,000 11:200,001-400,000 12:400,001-600,000
# 13:600,001-800,000 14:800,001-1,000,000 15:1,000,001 以上
# 16: 差異數調整  17: 合計
BIG400_LEVELS = range(12, 16)   # 超過 400 張
BIG1000_LEVELS = range(15, 16)  # 超過 1000 張
RETAIL_LEVELS = range(1, 9)     # 50 張（含）以下 = 散戶
RETAIL_LABEL = "≤50張"

STOCK_CODE_RE = re.compile(r"^[1-9]\d{3}$")  # 一般股票（排除 00 開頭 ETF、權證等）


def is_stock_code(code: str) -> bool:
    return bool(STOCK_CODE_RE.match(code))


def raw_path(date: str) -> Path:
    return RAW_DIR / f"{date}.csv.gz"


def list_raw_dates() -> list[str]:
    return sorted(p.name[:8] for p in RAW_DIR.glob("*.csv.gz"))


def write_raw(date: str, rows: dict[str, dict[int, tuple[int, int]]]) -> Path:
    """rows: {code: {level: (people, shares)}}"""
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["code", "level", "people", "shares"])
    for code in sorted(rows):
        for lv in sorted(rows[code]):
            p, s = rows[code][lv]
            w.writerow([code, lv, p, s])
    path = raw_path(date)
    with gzip.open(path, "wt", encoding="utf-8", newline="") as f:
        f.write(buf.getvalue())
    return path


def read_raw(date: str) -> dict[str, dict[int, tuple[int, int]]]:
    out: dict[str, dict[int, tuple[int, int]]] = {}
    with gzip.open(raw_path(date), "rt", encoding="utf-8") as f:
        r = csv.DictReader(f)
        for row in r:
            out.setdefault(row["code"], {})[int(row["level"])] = (
                int(row["people"]), int(row["shares"]))
    return out


def load_json(path: Path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def save_json(path: Path, obj, compact: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if compact:
        text = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    else:
        text = json.dumps(obj, ensure_ascii=False, indent=1)
    path.write_text(text, encoding="utf-8")


def to_int(s: str) -> int:
    s = (s or "").replace(",", "").strip()
    if not s or s in {"-", "--"}:
        return 0
    return int(float(s))
