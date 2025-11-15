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

# Base endpoints for Google Maps APIs
GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"
PLACE_SEARCH_URL_NEW = "https://places.googleapis.com/v1/places:searchText"
PLACE_SEARCH_URL_LEGACY = "https://maps.googleapis.com/maps/api/place/findplacefromtext/json"

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DEFAULT_CACHE_PATH = DATA_DIR / "geocode_cache.json"


def _normalize_coords(value: Dict[str, Any]) -> Dict[str, Any]:
    """Return a shallow copy containing float lat/lng and optional place_id."""

    lat = float(value["lat"])
    lng = float(value["lng"])
    normalized: Dict[str, Any] = {"lat": lat, "lng": lng}
    place_id = value.get("place_id")
    if place_id:
        normalized["place_id"] = str(place_id)
    return normalized


class GeocodeError(RuntimeError):
    """Custom error raised when the geocoding API returns an unexpected status."""


def load_cache(path: Path) -> Dict[str, Optional[Dict[str, Any]]]:
    if not path.exists():
        return {}
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        # Only keep address entries that look like coordinate dicts or null
        return {
            addr: value if value is None else _normalize_coords(value)
            for addr, value in data.items()
        }
    except (json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
        raise GeocodeError(f"Failed to load cache file {path}: {exc}") from exc


def save_cache(path: Path, cache: Dict[str, Optional[Dict[str, Any]]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=2, sort_keys=True)


def load_dotenv_file(path: Path) -> None:
    """Populate missing environment variables from a .env file."""

    if not path.exists():
        return

    with path.open("r", encoding="utf-8") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            if not key:
                continue
            value = value.strip()
            if value.startswith(("'", '"')) and value.endswith(value[0]):
                value = value[1:-1]
            os.environ.setdefault(key, value)


def find_place_new(
    query: str,
    session: requests.Session,
    api_key: str,
    *,
    language: str = "ja",
    throttle: float = 0.25,
) -> Optional[Dict[str, Any]]:
    """Use Places API (New) to find a place. Returns {'lat', 'lng', 'place_id'} or None."""
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": api_key,
        "X-Goog-FieldMask": "places.id,places.location",
    }

    body = {
        "textQuery": query,
        "languageCode": language,
    }

    response = session.post(PLACE_SEARCH_URL_NEW, json=body, headers=headers, timeout=15)

    if response.status_code != 200:
        return None

    payload = response.json()
    places = payload.get("places", [])

    if places:
        place = places[0]
        location = place.get("location", {})
        place_id = place.get("id", "").replace("places/", "")

        if location and place_id:
            if throttle:
                time.sleep(throttle)
            return {
                "lat": float(location["latitude"]),
                "lng": float(location["longitude"]),
                "place_id": str(place_id),
            }
    return None


def find_place_legacy(
    query: str,
    session: requests.Session,
    api_key: str,
    *,
    language: str = "ja",
    throttle: float = 0.25,
) -> Optional[Dict[str, Any]]:
    """Use Places API (Legacy) to find a place. Returns {'lat', 'lng', 'place_id'} or None."""
    params = {
        "input": query,
        "inputtype": "textquery",
        "fields": "place_id,geometry",
        "key": api_key,
        "language": language,
    }

    response = session.get(PLACE_SEARCH_URL_LEGACY, params=params, timeout=15)

    if response.status_code != 200:
        return None

    payload = response.json()
    status = payload.get("status")

    if status == "OK" and payload.get("candidates"):
        candidate = payload["candidates"][0]
        location = candidate["geometry"]["location"]
        if throttle:
            time.sleep(throttle)
        return {
            "lat": float(location["lat"]),
            "lng": float(location["lng"]),
            "place_id": str(candidate["place_id"]),
        }
    return None


def find_place(
    query: str,
    session: requests.Session,
    api_key: str,
    cache: Dict[str, Optional[Dict[str, Any]]],
    *,
    language: str = "ja",
    throttle: float = 0.25,
) -> Optional[Dict[str, Any]]:
    """Try both Places APIs to find a place. Returns {'lat', 'lng', 'place_id'}."""
    if not query:
        return None

    cache_key = f"place:{query}"
    if cache_key in cache:
        return cache[cache_key]

    result = None

    # Try new API first
    try:
        result = find_place_new(query, session, api_key, language=language, throttle=throttle)
    except Exception:
        pass

    # Fallback to legacy API
    if not result:
        try:
            result = find_place_legacy(query, session, api_key, language=language, throttle=throttle)
        except Exception:
            pass

    cache[cache_key] = result
    return result


def geocode_address(
    address: str,
    session: requests.Session,
    api_key: str,
    cache: Dict[str, Optional[Dict[str, Any]]],
    *,
    region: str = "jp",
    language: str = "ja",
    throttle: float = 0.25,
) -> Optional[Dict[str, Any]]:
    """Return {'lat', 'lng', 'place_id'?} for an address or None if not found."""
    if not address:
        return None

    if address in cache:
        cached = cache[address]
        if cached is None or cached.get("place_id"):
            return cached
        # Older cache entry is missing place_id; fall through to refresh it.

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
        result = payload["results"][0]
        location = result["geometry"]["location"]
        cache[address] = {
            "lat": float(location["lat"]),
            "lng": float(location["lng"]),
        }
        place_id = result.get("place_id")
        if place_id:
            cache[address]["place_id"] = str(place_id)
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
    cache: Dict[str, Optional[Dict[str, Any]]],
    *,
    throttle: float,
) -> None:
    input_path = DATA_DIR / "restaurants.csv"
    output_path = DATA_DIR / "restaurants_geocoded.csv"

    if not input_path.exists():
        raise FileNotFoundError(f"Missing input file: {input_path}")

    print(f"\n📍 Processing restaurants from {input_path.name}")

    with input_path.open("r", encoding="utf-8", newline="") as f_in:
        reader = csv.DictReader(f_in)
        fieldnames = list(reader.fieldnames or [])
        for extra_field in ("latitude", "longitude", "google_place_id"):
            if extra_field not in fieldnames:
                fieldnames.append(extra_field)
        rows = list(reader)

    total = len(rows)
    print(f"   Total restaurants: {total}\n")

    with output_path.open("w", encoding="utf-8", newline="") as f_out:
        writer = csv.DictWriter(f_out, fieldnames=fieldnames)
        writer.writeheader()

        for idx, row in enumerate(rows, 1):
            name = row.get("show_name") or row.get("name") or "Unknown"
            address = row.get("address", "").strip()
            print(f"   [{idx}/{total}] {name[:50]:<50}", end=" ", flush=True)

            # Try Places API first with name + address for accurate Place ID
            coords = None
            used_places_api = False
            if name and name != "Unknown" and address:
                query = f"{name} {address}"
                coords = find_place(query, session, api_key, cache, throttle=throttle)
                used_places_api = coords is not None

            # Fallback to Geocoding API if Places API fails
            if not coords and address:
                coords = geocode_address(address, session, api_key, cache, throttle=throttle)

            row["latitude"] = coords["lat"] if coords else ""
            row["longitude"] = coords["lng"] if coords else ""
            row["google_place_id"] = coords.get("place_id", "") if coords else ""
            writer.writerow(row)

            if coords:
                if coords.get("place_id"):
                    print(f"✓ {'[Places API]' if used_places_api else '[Geocoding]'}")
                else:
                    print("~ (coords only)")
            else:
                print("✗ (not found)")

    print(f"\n✅ Saved to {output_path.name}\n")


def process_tokyo_shops(
    session: requests.Session,
    api_key: str,
    cache: Dict[str, Optional[Dict[str, Any]]],
    *,
    throttle: float,
) -> None:
    input_path = DATA_DIR / "tokyo_shops.json"
    output_path = DATA_DIR / "tokyo_shops_geocoded.json"

    if not input_path.exists():
        raise FileNotFoundError(f"Missing input file: {input_path}")

    data = json.loads(input_path.read_text(encoding="utf-8"))

    # Count total shops
    total_shops = sum(len(m.get("shops", [])) for m in data.get("data", []))
    print(f"\n🏪 Processing Tokyo shops from {input_path.name}")
    print(f"   Total shops: {total_shops}\n")

    processed = 0
    found_place_id = 0
    found_coords_only = 0
    not_found = 0

    for municipality in data.get("data", []):
        municipality_name = municipality.get("municipalityName", "Unknown")
        shops = municipality.get("shops", [])

        if shops:
            print(f"   📍 {municipality_name} ({len(shops)} shops)")

        for shop in shops:
            processed += 1
            name = (shop.get("name") or "").strip()
            details = shop.get("details", {})
            address = (details.get("住所") or "").strip()

            print(f"      [{processed}/{total_shops}] {name[:45]:<45}", end=" ", flush=True)

            if not address:
                print("✗ (no address)")
                not_found += 1
                continue

            # Try Places API first with name + address for accurate Place ID
            coords = None
            used_places_api = False
            if name:
                query = f"{name} {address}"
                coords = find_place(query, session, api_key, cache, throttle=throttle)
                used_places_api = coords is not None

            # Fallback to Geocoding API if Places API fails
            if not coords:
                coords = geocode_address(address, session, api_key, cache, throttle=throttle)

            if coords:
                shop["latitude"] = coords["lat"]
                shop["longitude"] = coords["lng"]
                place_id = coords.get("place_id")
                if place_id:
                    shop["googlePlaceId"] = place_id
                    print(f"✓ {'[Places API]' if used_places_api else '[Geocoding]'}")
                    found_place_id += 1
                else:
                    shop.pop("googlePlaceId", None)
                    print("~ (coords only)")
                    found_coords_only += 1
            else:
                shop.pop("latitude", None)
                shop.pop("longitude", None)
                shop.pop("googlePlaceId", None)
                print("✗ (not found)")
                not_found += 1

    output_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\n📊 Summary:")
    print(f"   ✓ Place ID found:    {found_place_id}")
    print(f"   ~ Coordinates only:  {found_coords_only}")
    print(f"   ✗ Not found:         {not_found}")
    print(f"   Total processed:     {processed}")
    print(f"\n✅ Saved to {output_path.name}\n")


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    load_dotenv_file(Path.cwd() / ".env")
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
    parser.add_argument(
        "--force-refresh",
        action="store_true",
        help="Force refresh all entries, ignoring cache",
    )
    return parser.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    args = parse_args(argv)

    if not args.api_key:
        print("Error: Google Maps API key is required. Pass --api-key or set GOOGLE_MAPS_API_KEY.", file=sys.stderr)
        return 2

    print("=" * 70)
    print("🗺️  Google Maps Geocoding Script")
    print("=" * 70)
    print(f"Cache file: {args.cache}")
    print(f"Throttle: {args.throttle}s between requests")
    print("=" * 70)

    session = requests.Session()
    cache_before = load_cache(args.cache)
    cache_entries_before = len(cache_before)

    try:
        if args.force_refresh:
            print("⚠️  Force refresh enabled - will ignore cache and re-geocode all entries\n")
            cache_before.clear()

        if not args.skip_restaurants:
            process_restaurants(session, args.api_key, cache_before, throttle=args.throttle)
        if not args.skip_shops:
            process_tokyo_shops(session, args.api_key, cache_before, throttle=args.throttle)
    finally:
        save_cache(args.cache, cache_before)
        cache_entries_after = len(cache_before)

    print("=" * 70)
    print("✅ Geocoding complete!")
    print(f"   Cache entries: {cache_entries_before} → {cache_entries_after} (+{cache_entries_after - cache_entries_before})")
    print("=" * 70)
    return 0


if __name__ == "__main__":
    sys.exit(main())
