#!/usr/bin/env python3
"""Geocode local datasets using the Google Maps Geocoding API.

Outputs:
  - data/restaurants_geocoded.csv
  - data/tokyo_shops_geocoded.json
  - updates/creates a persistent cache file (data/geocode_cache.json)
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, Optional

import requests

# Base endpoint for Google Maps Geocoding API
GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DEFAULT_CACHE_PATH = DATA_DIR / "geocode_cache.json"


class GeocodeError(RuntimeError):
    """Custom error raised when the geocoding API returns an unexpected status."""


def load_cache(path: Path) -> Dict[str, Optional[Dict[str, float]]]:
    if not path.exists():
        return {}
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        # Only keep address entries that look like coordinate dicts or null
        return {
            addr: value if value is None else {"lat": float(value["lat"]), "lng": float(value["lng"])}
            for addr, value in data.items()
        }
    except (json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
        raise GeocodeError(f"Failed to load cache file {path}: {exc}") from exc


def save_cache(path: Path, cache: Dict[str, Optional[Dict[str, float]]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=2, sort_keys=True)


def geocode_address(
    address: str,
    session: requests.Session,
    api_key: str,
    cache: Dict[str, Optional[Dict[str, float]]],
    *,
    region: str = "jp",
    language: str = "ja",
    throttle: float = 0.25,
) -> Optional[Dict[str, float]]:
    """Return {'lat': float, 'lng': float} for an address or None if not found."""
    if not address:
        return None

    if address in cache:
        return cache[address]

    params = {
        "address": address,
        "key": api_key,
        "region": region,
        "language": language,
    }

    response = session.get(GEOCODE_URL, params=params, timeout=15)
    if response.status_code != 200:
        raise GeocodeError(f"Geocoding request failed with HTTP {response.status_code}: {response.text}")

    payload = response.json()
    status = payload.get("status")
    if status == "OK":
        location = payload["results"][0]["geometry"]["location"]
        cache[address] = {"lat": float(location["lat"]), "lng": float(location["lng"])}
    elif status in {"ZERO_RESULTS", "NOT_FOUND"}:
        cache[address] = None
    elif status in {"OVER_DAILY_LIMIT", "OVER_QUERY_LIMIT", "REQUEST_DENIED"}:
        message = payload.get("error_message", "")
        raise GeocodeError(f"Geocoding quota or permission issue ({status}): {message}")
    else:
        message = payload.get("error_message", "")
        raise GeocodeError(f"Unexpected geocoding status {status}: {message}")

    # Gentle throttle to avoid hitting rate limits
    if throttle:
        time.sleep(throttle)

    return cache[address]


def process_restaurants(
    session: requests.Session,
    api_key: str,
    cache: Dict[str, Optional[Dict[str, float]]],
    *,
    throttle: float,
) -> None:
    input_path = DATA_DIR / "restaurants.csv"
    output_path = DATA_DIR / "restaurants_geocoded.csv"

    if not input_path.exists():
        raise FileNotFoundError(f"Missing input file: {input_path}")

    with input_path.open("r", encoding="utf-8", newline="") as f_in:
        reader = csv.DictReader(f_in)
        fieldnames = list(reader.fieldnames or []) + ["latitude", "longitude"]
        rows = list(reader)

    with output_path.open("w", encoding="utf-8", newline="") as f_out:
        writer = csv.DictWriter(f_out, fieldnames=fieldnames)
        writer.writeheader()

        for row in rows:
            address = row.get("address", "").strip()
            coords = geocode_address(address, session, api_key, cache, throttle=throttle)
            row["latitude"] = coords["lat"] if coords else ""
            row["longitude"] = coords["lng"] if coords else ""
            writer.writerow(row)


def process_tokyo_shops(
    session: requests.Session,
    api_key: str,
    cache: Dict[str, Optional[Dict[str, float]]],
    *,
    throttle: float,
) -> None:
    input_path = DATA_DIR / "tokyo_shops.json"
    output_path = DATA_DIR / "tokyo_shops_geocoded.json"

    if not input_path.exists():
        raise FileNotFoundError(f"Missing input file: {input_path}")

    data = json.loads(input_path.read_text(encoding="utf-8"))

    for municipality in data.get("data", []):
        for shop in municipality.get("shops", []):
            details = shop.get("details", {})
            address = (details.get("住所") or "").strip()
            if not address:
                continue
            coords = geocode_address(address, session, api_key, cache, throttle=throttle)
            if coords:
                shop["latitude"] = coords["lat"]
                shop["longitude"] = coords["lng"]
            else:
                shop.pop("latitude", None)
                shop.pop("longitude", None)

    output_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Geocode local datasets with Google Maps")
    parser.add_argument(
        "--api-key",
        dest="api_key",
        default=os.environ.get("GOOGLE_MAPS_API_KEY"),
        help="Google Maps Geocoding API key (defaults to GOOGLE_MAPS_API_KEY env var)",
    )
    parser.add_argument(
        "--cache",
        type=Path,
        default=DEFAULT_CACHE_PATH,
        help=f"Path to persistent cache file (default: {DEFAULT_CACHE_PATH})",
    )
    parser.add_argument(
        "--throttle",
        type=float,
        default=0.25,
        help="Seconds to sleep between requests (default: 0.25)",
    )
    parser.add_argument(
        "--skip-restaurants",
        action="store_true",
        help="Skip geocoding restaurants.csv",
    )
    parser.add_argument(
        "--skip-shops",
        action="store_true",
        help="Skip geocoding tokyo_shops.json",
    )
    return parser.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    args = parse_args(argv)

    if not args.api_key:
        print("Error: Google Maps API key is required. Pass --api-key or set GOOGLE_MAPS_API_KEY.", file=sys.stderr)
        return 2

    session = requests.Session()
    cache = load_cache(args.cache)

    try:
        if not args.skip_restaurants:
            process_restaurants(session, args.api_key, cache, throttle=args.throttle)
        if not args.skip_shops:
            process_tokyo_shops(session, args.api_key, cache, throttle=args.throttle)
    finally:
        save_cache(args.cache, cache)

    print("Geocoding complete.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
