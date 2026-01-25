#!/usr/bin/env python3
"""Fetch every Furunavi Travel shop for Tokyo municipalities.

The script relies on ``fetch_municipal_shops`` and ``fetch_shop_detail`` to
retrieve the data and writes a single JSON payload under the ``data``
directory. By default the output file is ``data/tokyo_shops.json``.

Example usage::

    python scripts/fetch_tokyo_shops.py
    python scripts/fetch_tokyo_shops.py --output data/custom.json
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib
import sys
import urllib.parse
from typing import Iterable

from fetch_shops import fetch_municipal_shops, fetch_shop_detail

DEFAULT_MUNICIPAL_PATH = pathlib.Path("data/municipalities.json")
DEFAULT_OUTPUT_PATH = pathlib.Path("data/tokyo_shops.json")


def load_municipalities(path: pathlib.Path) -> list[dict[str, object]]:
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def iter_tokyo_municipalities(
    regions: Iterable[dict[str, object]]
) -> Iterable[tuple[int, str]]:
    for region in regions:
        municipalities = region.get("municipalities")
        if not isinstance(municipalities, list):
            continue
        for entry in municipalities:
            if not isinstance(entry, dict):
                continue
            name = entry.get("name")
            detail_url = entry.get("detailUrl")
            if not (isinstance(name, str) and isinstance(detail_url, str)):
                continue
            if not name.startswith("東京都"):
                continue
            municipal_id = extract_municipal_id(detail_url)
            if municipal_id is None:
                continue
            yield municipal_id, name


def extract_municipal_id(url: str) -> int | None:
    parsed = urllib.parse.urlparse(url)
    params = urllib.parse.parse_qs(parsed.query)
    try:
        value = params.get("municipalid") or params.get("municipalId")
        if not value:
            return None
        return int(value[0])
    except (TypeError, ValueError):
        return None


def _to_float(value: object) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            return float(text)
        except ValueError:
            return None
    return None


class ProgressPrinter:
    def __init__(self, stream: object) -> None:
        self._stream = stream
        self._inline_active = False
        self._last_len = 0

    def _clear_inline(self) -> None:
        if not self._inline_active:
            return
        self._stream.write("\r" + (" " * self._last_len) + "\r")
        self._inline_active = False
        self._last_len = 0

    def log(self, message: str) -> None:
        self._clear_inline()
        self._stream.write(message + "\n")
        self._stream.flush()

    def inline(self, message: str) -> None:
        padding = ""
        if self._inline_active and len(message) < self._last_len:
            padding = " " * (self._last_len - len(message))
        self._stream.write("\r" + message + padding)
        self._stream.flush()
        self._inline_active = True
        self._last_len = len(message)

    def finish_inline(self, message: str | None = None) -> None:
        if message:
            self.inline(message)
        if self._inline_active:
            self._stream.write("\n")
            self._stream.flush()
            self._inline_active = False
            self._last_len = 0


def build_tokyo_dataset(
    regions: Iterable[dict[str, object]],
) -> list[dict[str, object]]:
    progress = ProgressPrinter(sys.stderr)
    tokyo_municipalities = list(iter_tokyo_municipalities(regions))
    total_municipalities = len(tokyo_municipalities)
    dataset: list[dict[str, object]] = []
    for municipal_index, (municipal_id, name) in enumerate(
        tokyo_municipalities, start=1
    ):
        try:
            progress.log(
                f"[{municipal_index}/{total_municipalities}] "
                f"Fetching shop list for {name} (ID {municipal_id})"
            )
            shop_summaries = fetch_municipal_shops(municipal_id)
        except Exception as exc:  # pragma: no cover - runtime/network issues
            progress.log(
                f"Failed to fetch shop list for {name} (ID {municipal_id}): {exc}"
            )
            continue
        total_shops = len(shop_summaries)
        progress.log(
            f"[{municipal_index}/{total_municipalities}] "
            f"{name}: {total_shops} shops found"
        )

        details: list[dict[str, object]] = []
        for shop_index, summary in enumerate(shop_summaries, start=1):
            if total_shops:
                progress.inline(
                    f"[{municipal_index}/{total_municipalities}] "
                    f"{name}: {shop_index}/{total_shops} details"
                )
            product_id = None
            if isinstance(summary, dict):
                product_id = summary.get("ProductId")
            if not isinstance(product_id, int):
                continue

            try:
                detail = fetch_shop_detail(product_id)
            except Exception as exc:  # pragma: no cover - runtime/network issues
                progress.log(
                    f"Failed to fetch shop detail {product_id} in {name}: {exc}"
                )
                continue

            # Enrich with summary attributes that are not present on the detail page.
            latitude = None
            longitude = None
            if isinstance(summary, dict):
                latitude = _to_float(summary.get("Latitude"))
                longitude = _to_float(summary.get("Longitude"))
                if detail.get("category") in (None, ""):
                    category_name = summary.get("CategoryName")
                    if isinstance(category_name, str) and category_name:
                        detail["category"] = category_name
                if detail.get("pointGuide") is None:
                    price = summary.get("Price")
                    if isinstance(price, (int, float)):
                        detail["pointGuide"] = int(price)

            if latitude is not None and longitude is not None:
                detail["location"] = {"lat": latitude, "lng": longitude}

            detail["municipalId"] = municipal_id
            detail["municipalityName"] = name
            detail["detailPageUrl"] = (
                f"https://tp.furunavi.jp/Plan/Detail?plId={product_id}"
            )

            details.append(detail)

        if total_shops:
            progress.finish_inline(
                f"[{municipal_index}/{total_municipalities}] "
                f"{name}: {len(details)}/{total_shops} details complete"
            )
        dataset.append(
            {
                "municipalId": municipal_id,
                "municipalityName": name,
                "shopCount": len(details),
                "shops": details,
            }
        )

    return dataset


def write_output(data: object, path: pathlib.Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "updatedAt": dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
        "data": data,
    }
    with path.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--municipal-file",
        type=pathlib.Path,
        default=DEFAULT_MUNICIPAL_PATH,
        help="Path to municipalities JSON (default: %(default)s)",
    )
    parser.add_argument(
        "--output",
        type=pathlib.Path,
        default=DEFAULT_OUTPUT_PATH,
        help="Destination JSON file (default: %(default)s)",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        regions = load_municipalities(args.municipal_file)
    except OSError as exc:
        sys.stderr.write(f"Unable to read {args.municipal_file}: {exc}\n")
        return 1

    dataset = build_tokyo_dataset(regions)
    write_output(dataset, args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
