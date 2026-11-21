#!/usr/bin/env python3
"""Opt-in downloader for Binance public SPOT monthly klines. No private API keys.
Not imported by Shadow's hourly cron. Fails closed on missing/checksum-corrupt files.
"""
import argparse
import calendar
import hashlib
import io
import json
from pathlib import Path
import re
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
import zipfile

BASE_URL = "https://data.binance.vision/data/spot/monthly/klines"
SYMBOLS = {"BTC": "BTCUSDT", "ADA": "ADAUSDT", "AAVE": "AAVEUSDT"}


def months_between(start, end):
    year, month = map(int, start.split("-"))
    last_year, last_month = map(int, end.split("-"))
    while (year, month) <= (last_year, last_month):
        yield f"{year:04d}-{month:02d}"
        month += 1
        if month > 12:
            month = 1
            year += 1


def fetch_url(url):
    if not url.startswith(BASE_URL + "/"):
        raise ValueError("untrusted_download_url")
    last_error = None
    for attempt in range(3):
        try:
            req = Request(url, headers={"User-Agent": "ShadowTimeMachineHistoricalImporter/0.1"})
            with urlopen(req, timeout=35) as response:
                if response.url.split("/")[2] != "data.binance.vision":
                    raise ValueError("unexpected_redirect_host")
                blob = response.read(20_000_001)
            if len(blob) > 20_000_000:
                raise ValueError("archive_too_large")
            return blob
        except (HTTPError, URLError, TimeoutError) as exc:
            last_error = exc
            if isinstance(exc, HTTPError) and exc.code == 404:
                raise RuntimeError(f"missing_required_archive:{url}") from exc
            time.sleep(attempt + 1)
    raise RuntimeError(f"failed_download:{url}") from last_error


def fetch_archive(pair, interval, month):
    filename = f"{pair}-{interval}-{month}.zip"
    url = f"{BASE_URL}/{pair}/{interval}/{filename}"
    data = fetch_url(url)
    checksum_txt = fetch_url(url + ".CHECKSUM").decode("ascii", errors="strict")
    checksum_match = re.match(r"^\s*([a-fA-F0-9]{64})\s+", checksum_txt)
    if not checksum_match:
        raise ValueError(f"invalid_official_checksum:{filename}")
    actual_sha = hashlib.sha256(data).hexdigest()
    if actual_sha != checksum_match.group(1).lower():
        raise ValueError(f"archive_checksum_mismatch:{filename}")
    with zipfile.ZipFile(io.BytesIO(data), "r") as zipped:
        files = zipped.namelist()
        expected_csv = filename[:-4] + ".csv"
        if files != [expected_csv]:
            raise ValueError(f"unexpected_archive_members:{filename}")
        content = zipped.read(expected_csv)
    if not content.endswith(b"\n"):
        content += b"\n"
    return content


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--start", default="2021-01")
    p.add_argument("--end", default="2026-10")
    p.add_argument("--interval", choices=["1d", "1h"], default="1d")
    p.add_argument("--dest", default="data/time-machine")
    args = p.parse_args()
    for date in [args.start, args.end]:
        if not re.fullmatch(r"20\d{2}-(0[1-9]|1[0-2])", date):
            raise ValueError("invalid_month")
    months = list(months_between(args.start, args.end))
    if not months or len(months) > 72:
        raise ValueError("invalid_month_range")
    dest = Path(args.dest).resolve()
    dest.mkdir(parents=True, exist_ok=True)
    manifest = {"format": "binance_spot_klines_v1", "interval": args.interval, "datasetId": f"binance_spot_{args.interval}_{args.start}_{args.end}", "assets": {}}
    for asset, pair in SYMBOLS.items():
        contents = []
        for month in months:
            contents.append(fetch_archive(pair, args.interval, month))
        merged = b"".join(contents)
        filename = f"{pair}-{args.interval}-{args.start}_{args.end}.csv"
        (dest / filename).write_bytes(merged)
        manifest["assets"][asset] = {
            "file": filename,
            "sha256": hashlib.sha256(merged).hexdigest()
        }
        print(f"IMPORTED {asset}: {len(merged.splitlines())} bars, {len(months)} monthly archives", flush=True)
    (dest / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print("TIME_MACHINE_HISTORY_FETCH=" + json.dumps({
        "datasetId": manifest["datasetId"], "source": BASE_URL,
        "archives": len(months) * len(SYMBOLS), "checksumsVerified": True,
        "executionEnabled": False, "containsSecrets": False
    }))


if __name__ == "__main__":
    main()
