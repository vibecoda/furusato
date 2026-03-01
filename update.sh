#!/bin/bash
python scripts/fetch_municipalities.py
python scripts/fetch_tokyo_shops.py
python scripts/fetch_hachipay_restaurants.py
python scripts/geocode.py
