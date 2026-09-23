#!/usr/bin/env bash
set -euo pipefail

uv run python scripts/fetch_municipalities.py
uv run python scripts/fetch_tokyo_shops.py
uv run python scripts/fetch_hachipay_restaurants.py
uv run python scripts/geocode.py
