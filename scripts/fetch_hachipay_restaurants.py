#!/usr/bin/env python3
import argparse
import csv
import sys
from pathlib import Path
from typing import Dict, Iterable, Tuple

import requests

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"

API_BASE = "https://i0zhcu8mz1.execute-api.ap-northeast-1.amazonaws.com/prod/shibuya"
RESTAURANT_PARENT_ID = "50"


def fetch_categories(session: requests.Session) -> Iterable[Dict]:
    response = session.get(f"{API_BASE}/shops/categories", timeout=30)
    response.raise_for_status()
    payload = response.json()
    if payload.get("resultCode") != 1:
        raise RuntimeError("Unexpected response while fetching categories")
    return payload.get("result", [])


def resolve_category_name(categories: Iterable[Dict], target_id: str) -> str:
    for category in categories:
        if category.get("id") == target_id:
            return category.get("name", "")
    raise ValueError(f"Could not find category name for id={target_id}")


def fetch_restaurant_data(session: requests.Session, parent_name: str) -> Tuple[Iterable[Dict], int]:
    params = {
        "is_furusato": "1",
        "parent": parent_name,
        "search": "",
        "cursor": "",
    }
    response = session.get(f"{API_BASE}/shops", params=params, timeout=30)
    response.raise_for_status()
    payload = response.json()
    if payload.get("resultCode") != 1:
        raise RuntimeError("Unexpected response while fetching restaurants")
    result = payload.get("result", {})
    data = result.get("data", [])
    total = result.get("totalCount", len(data))
    return data, total


def compose_address(entry: Dict) -> str:
    if str(entry.get("addr_no_disp")) == "1":
        return ""
    if entry.get("app_pref"):
        parts = [
            entry.get("app_addr"),
            entry.get("app_addr_shi"),
            entry.get("app_addr_buil"),
        ]
    else:
        parts = [
            entry.get("addr03"),
            entry.get("addr_shi03"),
            entry.get("addr_buil03"),
        ]
    return "".join(filter(None, parts))


def write_csv(rows: Iterable[Dict], output_path: Path) -> int:
    fieldnames = [
        "show_name",
        "parent_category",
        "middle_category",
        "child_category",
        "address",
        "tel",
        "google_url",
    ]
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        count = 0
        for row in rows:
            writer.writerow(row)
            count += 1
    return count


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch the Hachi Pay restaurant list via the search API")
    parser.add_argument(
        "--output",
        type=Path,
        default=DATA_DIR / "restaurants.csv",
        help=f"Path for the generated CSV file (default: {DATA_DIR / 'restaurants.csv'})",
    )
    args = parser.parse_args()

    session = requests.Session()

    try:
        categories = fetch_categories(session)
        parent_name = resolve_category_name(categories, RESTAURANT_PARENT_ID)
        raw_entries, total = fetch_restaurant_data(session, parent_name)
    except requests.HTTPError as exc:
        print(f"HTTP error: {exc}", file=sys.stderr)
        sys.exit(1)
    except requests.RequestException as exc:
        print(f"Network error: {exc}", file=sys.stderr)
        sys.exit(1)
    except Exception as exc:  # noqa: BLE001
        print(f"Failed to fetch restaurant data: {exc}", file=sys.stderr)
        sys.exit(1)

    csv_ready_rows = []
    for entry in raw_entries:
        csv_ready_rows.append(
            {
                "show_name": entry.get("show_name", ""),
                "parent_category": entry.get("parent_category", ""),
                "middle_category": entry.get("middle_category", ""),
                "child_category": entry.get("child_category", ""),
                "address": compose_address(entry),
                "tel": entry.get("tel", ""),
                "google_url": entry.get("google_url", ""),
            }
        )

    written = write_csv(csv_ready_rows, args.output)
    print(f"Fetched {total} restaurants; wrote {written} rows to {args.output}")


if __name__ == "__main__":
    main()
