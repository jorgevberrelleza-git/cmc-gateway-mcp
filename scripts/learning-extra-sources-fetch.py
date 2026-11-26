#!/usr/bin/env python3
"""Research-only downloader for extra public market sources (no keys, no orders).
- Crypto Fear & Greed Index history (alternative.me public API).
- Binance USD-M futures funding rates, monthly archives with official checksums.
Never imported by the hourly cron."""
import argparse, hashlib, io, json, re, sys, time, zipfile
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ALLOWED = ("https://api.alternative.me/", "https://data.binance.vision/data/futures/um/monthly/fundingRate/")

def get(url, limit=30_000_000):
    if not url.startswith(ALLOWED):
        raise ValueError("untrusted_url")
    last = None
    for attempt in range(3):
        try:
            with urlopen(Request(url, headers={"User-Agent": "ShadowResearch/0.1"}), timeout=40) as r:
                if r.url.split("/")[2] not in ("api.alternative.me", "data.binance.vision"):
                    raise ValueError("unexpected_redirect_host")
                b = r.read(limit + 1)
            if len(b) > limit:
                raise ValueError("too_large")
            return b
        except HTTPError as e:
            if e.code == 404:
                return None
            last = e
        except (URLError, TimeoutError) as e:
            last = e
        time.sleep(attempt + 1)
    raise RuntimeError(f"failed:{url}") from last

def months(a, b):
    y, m = map(int, a.split("-")); y2, m2 = map(int, b.split("-"))
    while (y, m) <= (y2, m2):
        yield f"{y:04d}-{m:02d}"; m += 1
        if m > 12: y, m = y + 1, 1

def main():
    p = argparse.ArgumentParser(); p.add_argument("--start", default="2020-12"); p.add_argument("--end", default="2026-10")
    p.add_argument("--dest", default="data/extra"); a = p.parse_args()
    dest = Path(a.dest); dest.mkdir(parents=True, exist_ok=True)
    fng = json.loads(get("https://api.alternative.me/fng/?limit=0&format=json"))
    rows = [{"day": time.strftime("%Y-%m-%d", time.gmtime(int(x["timestamp"]))), "value": int(x["value"])} for x in fng["data"]]
    (dest / "fear_greed.json").write_text(json.dumps(sorted(rows, key=lambda r: r["day"])))
    print(f"FEAR_GREED days={len(rows)}")
    out, missing = [], 0
    for mo in months(a.start, a.end):
        base = f"https://data.binance.vision/data/futures/um/monthly/fundingRate/BTCUSDT/BTCUSDT-fundingRate-{mo}.zip"
        z = get(base)
        if z is None:
            missing += 1; continue
        chk = get(base + ".CHECKSUM")
        m = re.match(r"^\s*([a-fA-F0-9]{64})\s+", (chk or b"").decode())
        if not m or hashlib.sha256(z).hexdigest() != m.group(1).lower():
            raise ValueError(f"checksum_mismatch:{mo}")
        with zipfile.ZipFile(io.BytesIO(z)) as zf:
            for line in zf.read(zf.namelist()[0]).decode().splitlines():
                c = line.split(",")
                if not c[0].isdigit(): continue
                out.append({"t": int(c[0]), "rate": float(c[-1])})
    (dest / "funding_btc.json").write_text(json.dumps(out))
    print(f"FUNDING_BTC rows={len(out)} missing_months={missing}")

if __name__ == "__main__":
    main()
