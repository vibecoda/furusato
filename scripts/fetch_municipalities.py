#!/usr/bin/env python3
"""Fetch and serialize the municipality list from tp.furunavi.jp.

Usage
-----
python scripts/fetch_municipalities.py            # writes to data/municipalities.json
python scripts/fetch_municipalities.py --output other.json

The script keeps the JSON structure identical to the hand-curated file so downstream
processing remains stable.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys
import urllib.parse
import urllib.request
from html.parser import HTMLParser

BASE_URL = "https://tp.furunavi.jp"
LIST_PATH = "/Municipal/List"
LIST_URL = urllib.parse.urljoin(BASE_URL, LIST_PATH)


class MunicipalParser(HTMLParser):
    """Extract regions and municipalities from the municipal list HTML."""

    def __init__(self) -> None:
        super().__init__()
        self._regions: list[dict[str, object]] = []
        self._current_region: dict[str, object] | None = None
        self._capturing_region = False
        self._capturing_municipality = False
        self._pending_href: str | None = None

    @property
    def regions(self) -> list[dict[str, object]]:
        return self._regions

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr_map = {key: (value or "") for key, value in attrs}
        classes = set(attr_map.get("class", "").split())

        if tag == "div" and "global-municipal-accordion" in classes:
            self._current_region = {"region": None, "municipalities": []}
            self._regions.append(self._current_region)
        elif tag == "button" and "global-municipal-accordion-title" in classes:
            self._capturing_region = True
        elif (
            tag == "a"
            and self._current_region is not None
            and attr_map.get("href")
            and "/Municipal/Detail" in attr_map["href"]
        ):
            href = urllib.parse.urljoin(BASE_URL, attr_map["href"])
            self._pending_href = href
            self._capturing_municipality = True

    def handle_endtag(self, tag: str) -> None:
        if tag == "button" and self._capturing_region:
            self._capturing_region = False
        elif tag == "a" and self._capturing_municipality:
            # Fallback if the anchor contained no text nodes with content.
            self._capturing_municipality = False
            self._pending_href = None

    def handle_data(self, data: str) -> None:
        text = data.strip()
        if not text:
            return

        if self._capturing_region and self._current_region is not None:
            # Region titles appear once per accordion, so a single assignment is safe.
            self._current_region["region"] = text
            self._capturing_region = False
        elif (
            self._capturing_municipality
            and self._current_region is not None
            and self._pending_href is not None
        ):
            municipalities = self._current_region["municipalities"]
            assert isinstance(municipalities, list)
            municipalities.append({"name": text, "detailUrl": self._pending_href})
            self._capturing_municipality = False
            self._pending_href = None


def fetch_html(url: str) -> str:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; MunicipalFetcher/1.0)"
        },
    )
    with urllib.request.urlopen(request) as response:  # nosec: B310 - trusted host
        charset = response.headers.get_content_charset() or "utf-8"
        return response.read().decode(charset, errors="replace")


def parse_municipalities(html: str) -> list[dict[str, object]]:
    parser = MunicipalParser()
    parser.feed(html)

    # Filter out regions that failed to populate (defensive against layout changes).
    result: list[dict[str, object]] = []
    for region in parser.regions:
        name = region.get("region")
        municipalities = region.get("municipalities")
        if not name or not isinstance(municipalities, list):
            continue
        # Only keep anchors that actually captured both name and URL.
        filtered = [
            entry
            for entry in municipalities
            if isinstance(entry, dict)
            and entry.get("name")
            and entry.get("detailUrl")
        ]
        region_copy = {
            "region": name,
            "municipalities": filtered,
        }
        result.append(region_copy)
    return result


def write_json(data: list[dict[str, object]], output: pathlib.Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=True)
        fh.write("\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        type=pathlib.Path,
        default=pathlib.Path("data/municipalities.json"),
        help="Path to write the JSON output (default: data/municipalities.json)",
    )
    parser.add_argument(
        "--source",
        default=LIST_URL,
        help="Override the municipal list URL (default: %(default)s)",
    )
    args = parser.parse_args(argv)

    try:
        html = fetch_html(args.source)
    except Exception as exc:  # pragma: no cover - network errors are runtime issues
        print(f"Error fetching {args.source}: {exc}", file=sys.stderr)
        return 1

    data = parse_municipalities(html)
    if not data:
        print("No municipalities parsed; site layout may have changed.", file=sys.stderr)
        return 2

    print(f"Writing municipalities to {args.output}", file=sys.stderr)
    write_json(data, args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
