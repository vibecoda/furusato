#!/usr/bin/env python3
"""Utilities for fetching municipality shops and their detail pages.

The module exposes two public helpers:

``fetch_municipal_shops``
    Returns the full list of shop metadata for a municipality by paging the
    `/Plan/Search` endpoint until every result is collected.

``fetch_shop_detail``
    Downloads and parses a shop's detail page, converting the "詳細情報" block
    into a structured dictionary together with the summary attributes shown at
    the top of the page.

Both helpers are available on the command line via sub‑commands. Examples:

    python scripts/fetch_shops.py list 1
    python scripts/fetch_shops.py detail 11456
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.parse
import urllib.request
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Iterable

BASE_URL = "https://tp.furunavi.jp"
SEARCH_PATH = "/Plan/Search"
DETAIL_PATH = "/Plan/Detail"

DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; FurunaviScraper/1.0)",
    "Accept": "application/json, text/html;q=0.9,*/*;q=0.8",
}


def _fetch_bytes(url: str) -> bytes:
    request = urllib.request.Request(url, headers=DEFAULT_HEADERS)
    with urllib.request.urlopen(request) as response:  # nosec: B310
        return response.read()


def fetch_json(url: str) -> dict:
    data = _fetch_bytes(url)
    try:
        # The API responses are UTF-8 but fall back to strict ASCII on error.
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        text = data.decode("ascii", errors="replace")
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:  # pragma: no cover - defensive guard
        raise ValueError(f"Unexpected JSON payload from {url!r}") from exc


def fetch_html(url: str) -> str:
    data = _fetch_bytes(url)
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return data.decode("utf-8", errors="replace")


def fetch_municipal_shops(
    municipal_id: int,
    *,
    sort_type: int = 1,
) -> list[dict[str, object]]:
    """Return every shop entry for ``municipal_id``.

    The endpoint returns 30 records per page. We iterate ``pageNo`` until we
    have gathered at least ``TotalCount`` items or the API stops yielding data.
    """

    if municipal_id <= 0:
        raise ValueError("municipal_id must be a positive integer")

    results: list[dict[str, object]] = []
    total_count: int | None = None
    page = 1

    while True:
        query = urllib.parse.urlencode(
            {
                "municipalIds": municipal_id,
                "subCategoryIds": "",
                "pageNo": page,
                "sortType": sort_type,
            }
        )
        url = urllib.parse.urljoin(BASE_URL, f"{SEARCH_PATH}?{query}")
        payload = fetch_json(url)

        product_list = payload.get("ProductList") or []
        if not isinstance(product_list, list):
            raise ValueError("Unexpected ProductList format from Plan/Search")

        if total_count is None:
            count = payload.get("TotalCount")
            if isinstance(count, int):
                total_count = count

        if not product_list:
            break

        for item in product_list:
            if isinstance(item, dict):
                results.append(item)

        page += 1
        if total_count is not None and len(results) >= total_count:
            break

    if total_count is not None and len(results) < total_count:
        # The service occasionally returns stale counts; we surface a warning so
        # callers can decide whether retrying is necessary.
        sys.stderr.write(
            f"Warning: expected {total_count} results, received {len(results)}\n"
        )

    return results


_WS_RE = re.compile(r"\s+")


def _collapse(text: str) -> str:
    return _WS_RE.sub(" ", text).strip()


def _collapse_lines(lines: Iterable[str]) -> str:
    cleaned: list[str] = []
    for line in lines:
        line = _collapse(line)
        if line:
            cleaned.append(line)
    return "\n".join(cleaned)


@dataclass
class ShopDetail:
    product_id: int
    name: str | None = None
    category: str | None = None
    area_region: str | None = None
    area_prefecture: str | None = None
    area_locality: str | None = None
    google_rating: float | None = None
    google_review_count: int | None = None
    point_guide: int | None = None
    tags: list[str] | None = None
    description: str | None = None
    details: dict[str, object] | None = None


class ShopDetailParser(HTMLParser):
    """Extract key/value fields from a shop detail page."""

    def __init__(self, product_id: int) -> None:
        super().__init__()
        self._product_id = product_id
        self._summary_depth = 0
        self._area_depth = 0
        self._tags_depth = 0
        self._detail_depth = 0
        self._point_depth = 0
        self._div_stack: list[bool] = []
        self._capture_stack: list[tuple[str, list[str]]] = []
        self._last_detail_key: str | None = None
        self._current_detail_href: str | None = None

        self.detail = ShopDetail(product_id)
        self.detail.tags = []
        self._review_raw: str | None = None

    # -- helpers ---------------------------------------------------------

    def _push(self, field: str) -> None:
        self._capture_stack.append((field, []))

    def _append_text(self, text: str) -> None:
        if self._capture_stack:
            self._capture_stack[-1][1].append(text)

    def _pop(self, expected_field: str | None = None) -> tuple[str, str] | None:
        if not self._capture_stack:
            return None
        field, pieces = self._capture_stack.pop()
        if expected_field is not None and field != expected_field:
            return None
        joined = "".join(pieces)
        return field, joined

    # -- HTMLParser overrides -------------------------------------------

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr_map = {key: (value or "") for key, value in attrs}
        classes = set(attr_map.get("class", "").split())

        if tag == "div":
            is_summary = "plan-info-summary" in classes
            self._div_stack.append(is_summary)
            if is_summary:
                self._summary_depth += 1
                category = attr_map.get("data-plan-category")
                if category:
                    self.detail.category = category
            if "plan-info-text" in classes:
                self._push("description")
            return

        if tag == "h1" and self._summary_depth:
            self._push("name")
        elif tag == "ul" and "plan-info-summary-area" in classes:
            self._area_depth += 1
        elif tag == "ul" and "plan-info-summary-tag" in classes:
            self._tags_depth += 1
        elif tag == "li" and self._area_depth:
            self._push("area")
        elif tag == "li" and self._tags_depth:
            self._push("tag")
        elif tag == "p" and "plan-info-summary-reputation" in classes:
            self._push("review")
        elif tag == "dl" and "plan-info-summary-point" in classes:
            self._point_depth += 1
        elif tag == "dd" and self._point_depth:
            self._push("point")
        elif tag == "dl" and "list-facility-info" in classes:
            self._detail_depth += 1
            if self.detail.details is None:
                self.detail.details = {}
        elif tag == "dt" and self._detail_depth:
            self._push("detail_key")
        elif tag == "dd" and self._detail_depth:
            self._push("detail_value")
            self._current_detail_href = None
        elif tag == "a" and self._detail_depth and self._capture_stack:
            if self._capture_stack[-1][0] == "detail_value" and attr_map.get("href"):
                self._current_detail_href = urllib.parse.urljoin(
                    BASE_URL, attr_map["href"]
                )
        elif tag == "br" and self._capture_stack:
            self._capture_stack[-1][1].append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag == "div":
            if self._capture_stack and self._capture_stack[-1][0] == "description":
                popped = self._pop("description")
                if popped:
                    _, text = popped
                    self.detail.description = _collapse(text)
            if self._div_stack:
                was_summary = self._div_stack.pop()
                if was_summary and self._summary_depth:
                    self._summary_depth -= 1
            return

        if tag == "h1":
            popped = self._pop("name")
            if popped:
                _, text = popped
                self.detail.name = _collapse(text)

        if tag == "ul" and self._area_depth:
            self._area_depth -= 1
        if tag == "ul" and self._tags_depth:
            self._tags_depth -= 1

        if tag == "li" and self._capture_stack:
            top_field = self._capture_stack[-1][0]
            if top_field == "area":
                _, text = self._pop("area") or ("", "")
                text = _collapse(text)
                if text:
                    sequence = [self.detail.area_region, self.detail.area_prefecture, self.detail.area_locality]
                    if sequence[0] is None:
                        self.detail.area_region = text
                    elif sequence[1] is None:
                        self.detail.area_prefecture = text
                    elif sequence[2] is None:
                        self.detail.area_locality = text
            elif top_field == "tag":
                _, text = self._pop("tag") or ("", "")
                text = _collapse(text)
                if text:
                    assert self.detail.tags is not None
                    self.detail.tags.append(text)

        if tag == "p":
            popped = self._pop("review")
            if popped:
                _, text = popped
                text = _collapse(text)
                self._review_raw = text

        if tag == "dd" and self._capture_stack:
            field = self._capture_stack[-1][0]
            if field == "point":
                _, text = self._pop("point") or ("", "")
                text = _collapse(text)
                digits = re.sub(r"[^0-9]", "", text)
                if digits:
                    self.detail.point_guide = int(digits)
            elif field == "detail_value":
                _, text = self._pop("detail_value") or ("", "")
                key = self._last_detail_key
                if key and self.detail.details is not None:
                    value = _collapse_lines(text.splitlines())
                    if key == "公式サイト" and self._current_detail_href:
                        value = self._current_detail_href
                    existing = self.detail.details.get(key)
                    if existing is None:
                        self.detail.details[key] = value
                    elif isinstance(existing, list):
                        existing.append(value)
                    else:
                        self.detail.details[key] = [existing, value]

        if tag == "dt":
            popped = self._pop("detail_key")
            if popped:
                _, text = popped
                self._last_detail_key = _collapse(text)

        if tag == "dl" and self._detail_depth:
            self._detail_depth -= 1
        if tag == "dl" and self._point_depth:
            self._point_depth -= 1

    def handle_data(self, data: str) -> None:
        if not data:
            return
        self._append_text(data)

    def close(self) -> ShopDetail:
        super().close()
        if self._review_raw:
            match = re.search(r"([0-9]+(?:\.[0-9]+)?)", self._review_raw)
            if match:
                self.detail.google_rating = float(match.group(1))
            count_match = re.search(r"\((\d+)\)", self._review_raw)
            if count_match:
                self.detail.google_review_count = int(count_match.group(1))
        return self.detail


def fetch_shop_detail(product_id: int) -> dict[str, object]:
    if product_id <= 0:
        raise ValueError("product_id must be a positive integer")

    query = urllib.parse.urlencode({"plId": product_id})
    url = urllib.parse.urljoin(BASE_URL, f"{DETAIL_PATH}?{query}")
    html = fetch_html(url)

    parser = ShopDetailParser(product_id)
    parser.feed(html)
    detail = parser.close()

    result: dict[str, object] = {
        "id": detail.product_id,
        "name": detail.name,
        "category": detail.category,
        "area": {
            "region": detail.area_region,
            "prefecture": detail.area_prefecture,
            "locality": detail.area_locality,
        },
        "googleReview": {
            "rating": detail.google_rating,
            "count": detail.google_review_count,
        },
        "pointGuide": detail.point_guide,
        "tags": detail.tags or [],
        "description": detail.description,
        "details": detail.details or {},
    }

    # Remove empty dictionaries/None values for cleanliness.
    result["area"] = {k: v for k, v in result["area"].items() if v is not None}
    if not result["area"]:
        result.pop("area")

    if result["googleReview"]["rating"] is None and result["googleReview"]["count"] is None:
        result.pop("googleReview")

    return result


def _write_output(data: object, path: str | None) -> None:
    text = json.dumps(data, ensure_ascii=False, indent=2)
    if path:
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(text)
            fh.write("\n")
    else:
        print(text)


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    list_parser = subparsers.add_parser("list", help="Fetch shops for a municipality")
    list_parser.add_argument("municipal_id", type=int)
    list_parser.add_argument(
        "--sort-type",
        type=int,
        default=1,
        help="Sort type passed to the Plan/Search endpoint (default: %(default)s)",
    )
    list_parser.add_argument("--output", help="Optional output file")

    detail_parser = subparsers.add_parser("detail", help="Fetch a shop detail page")
    detail_parser.add_argument("product_id", type=int)
    detail_parser.add_argument("--output", help="Optional output file")

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)

    if args.command == "list":
        data = fetch_municipal_shops(args.municipal_id, sort_type=args.sort_type)
        _write_output(data, args.output)
        return 0
    if args.command == "detail":
        data = fetch_shop_detail(args.product_id)
        _write_output(data, args.output)
        return 0

    parser.error("No command supplied")
    return 1
