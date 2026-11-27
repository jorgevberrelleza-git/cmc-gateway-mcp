#!/usr/bin/env python3
"""Research-only: daily closes for US stocks/ETFs from stooq.com (public CSV, no key).
Writes Binance-like CSV rows (open_time_ms,open,high,low,close) + manifest.json so the
existing backtester can load them. Never imported by the hourly cron."""
import argparse, csv, io, json, time
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

ALLOWED = ("SPY","QQQ","AAPL","MSFT","NVDA","GOOGL","AMZN","META","TLT","GLD")

def get(sym):
    url = f"https://stooq.com/q/d/l/?s={sym.lower()}.us&i=d"
    for k in range(3):
        try:
            with urlopen(Request(url, headers={"User-Agent": "ShadowResearch/0.1"}), timeout=40) as r:
                if r.url.split("/")[2] != "stooq.com": raise ValueError("redirect")
                return r.read(20_000_000).decode()
        except Exception as e:
            last = e; time.sleep(k + 1)
    raise RuntimeError(f"failed:{sym}") from last

def main():
    p = argparse.ArgumentParser(); p.add_argument("--symbols", required=True); p.add_argument("--dest", default="data/stocks"); a = p.parse_args()
    dest = Path(a.dest); dest.mkdir(parents=True, exist_ok=True); man = {"source": "stooq.com daily", "assets": {}}
    for s in [x.strip().upper() for x in a.symbols.split(",") if x.strip()]:
        if s not in ALLOWED: raise ValueError("symbol_not_allowed")
        rows = list(csv.DictReader(io.StringIO(get(s))))
        out = []
        for r in rows:
            try:
                t = int(datetime.strptime(r["Date"], "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp() * 1000)
                out.append(f'{t},{r["Open"]},{r["High"]},{r["Low"]},{r["Close"]}')
            except (KeyError, ValueError): continue
        if len(out) < 500: raise ValueError(f"too_few_rows:{s}:{len(out)}")
        (dest / f"{s}.csv").write_text("\n".join(out)); man["assets"][s] = {"file": f"{s}.csv", "rows": len(out), "first": rows[0]["Date"], "last": rows[-1]["Date"]}
        print(f"STOOQ {s} rows={len(out)} {rows[0]['Date']}..{rows[-1]['Date']}")
    (dest / "manifest.json").write_text(json.dumps(man, indent=2))

if __name__ == "__main__": main()
