# AGENTS.md — Furusato Listings

## Overview

**Furusato Listings** is a single-page web application that displays furusato (hometown tax) gift shops and partner restaurants on an interactive Google Maps interface with sortable/filterable data tables. The app has three tabs: **Tokyo** (shops from the Furunavi Travel platform), **Kyoto** (shops, different source schema), and **Hachipay** (restaurants in the Shibuya area that accept Hachi Pay digital currency).

The frontend is a vanilla-JS SPA (no framework). Data is fetched as static JSON/CSV files from the `data/` directory. The data pipeline is a set of Python scripts that scrape APIs, scrape HTML detail pages, and geocode addresses using the Google Maps APIs.

---

## Architecture

```
index.html          — static HTML shell, loads Google Maps, boots app
js/
├── app.js          — App class: tab switching, filter→map→table coordination
├── env.js          — local dev API key (gitignored, see .env)
├── core/
│   ├── DataManager.js  — loads data from URLs (JSON or CSV)
│   ├── UIManager.js    — renders filters, table headers/rows, status bar
│   └── MapManager.js   — wraps Google Maps: markers, info windows, "Find Me"
├── config/
│   ├── tokyo.js     — Tokyo tab config (data URL, processFn, filters, columns)
│   ├── kyoto.js     — Kyoto tab config
│   └── hachipay.js  — Hachipay tab config (CSV parsing, area detection)
└── utils/
    └── helpers.js   — CSV parser, URL sanitizer, iOS detection
data/
├── municipalities.json       — all Japanese municipal regions from tp.furunavi.jp
├── tokyo_shops.json          — raw Tokyo shop data (before geocoding)
├── tokyo_shops_geocoded.json — Tokyo shops with lat/lng/Place IDs
├── kyoto_shops.json          — raw Kyoto shop data
├── kyoto_shops_geocoded.json — Kyoto shops with lat/lng/Place IDs
├── restaurants.csv           — raw Hachipay restaurant data
├── restaurants_geocoded.csv  — restaurants with lat/lng/Place IDs
├── geocode_cache.json        — persistent geocoding cache (address→coords)
└── last_updated.txt          — timestamp string shown in the UI
scripts/
├── fetch_municipalities.py   — scrapes municipal list HTML → municipalities.json
├── fetch_shops.py            — shared library: Furunavi API client + HTML detail parser
├── fetch_tokyo_shops.py      — iterates Tokyo municipalities, fetches all shop details
├── fetch_hachipay_restaurants.py — fetches restaurant data from Hachi Pay API → CSV
└── geocode.py                — geocodes all three datasets; uses Places API + Geocoding API
```

### Config-driven design

Each tab is defined by a config object (`tokyoConfig`, `kyotoConfig`, `hachipayConfig`) exported from `js/config/*.js`. A config specifies:

| Property      | Purpose                                                      |
|---------------|--------------------------------------------------------------|
| `id` / `label`| Tab identifier and display name                              |
| `dataUrl`     | Path to the geocoded data file (relative to index.html)      |
| `dataType`    | `"json"` or `"csv"`                                          |
| `processFn`   | Normalizes raw data into a uniform row shape with properties like `id`, `title`, `category`, `area`, `lat`, `lng`, `hasCoordinates`, `mapUrl` |
| `filters`     | Array of filter definitions (search, select, number, tags)   |
| `columns`     | Table column definitions (header, field, isLink, format)     |
| `mapCenter`   | `{ lat, lng }` for initial map position                      |
| `mapZoom`     | Initial zoom level                                           |

### Data flow at runtime

1. User clicks a tab → `App.switchContext(configId)`
2. `DataManager.loadData(config)` fetches `config.dataUrl`, runs `config.processFn`
3. `UIManager.init()` builds filter controls, column headers, "last updated" label
4. `App.applyFilters()` runs filter logic over the normalized data
5. `UIManager.renderTable()` and `MapManager.updateMarkers()` render the filtered set
6. Status bar shows "N of M shown"

### Data pipeline (Python)

Run the full update with:

```bash
./update.sh
```

This executes, in order:

1. **`fetch_municipalities.py`** — Scrapes `tp.furunavi.jp/Municipal/List` and writes `data/municipalities.json` (an array of `{region, municipalities: [{name, detailUrl}]}`).
2. **`fetch_tokyo_shops.py`** — Loads `municipalities.json`, finds all Tokyo municipalities, calls `fetch_municipal_shops()` and `fetch_shop_detail()` from `fetch_shops.py` for each one, and writes `data/tokyo_shops.json`.
3. **`fetch_hachipay_restaurants.py`** — Calls the Hachi Pay search API, resolves category names, and writes `data/restaurants.csv`.
4. **`geocode.py`** — Reads `restaurants.csv`, `tokyo_shops.json`, and `kyoto_shops.json`; geocodes missing entries via Google Places API (new, with legacy fallback) and Geocoding API; writes geocoded output files and updates `geocode_cache.json`. Requires `GOOGLE_MAPS_API_KEY` from `.env`.

Each Python script can also run independently with `--help` for options.

#### Geocoding details

- Uses a persistent cache (`data/geocode_cache.json`) to avoid redundant API calls.
- For each place, tries **Google Places API (New)** first with `{name} {address}` to get a Place ID (enables high-quality Google Maps deep links).
- Falls back to **Places API (Legacy)**, then to **Geocoding API** (address-only, no Place ID).
- Throttles at 0.25s between requests by default; adjustable with `--throttle`.
- `--force-refresh` clears the cache before running.
- Can skip individual datasets: `--skip-restaurants`, `--skip-tokyo-shops`, `--skip-kyoto-shops`.

---

## Common Workflows

### Adding a new tab/dataset

1. Create a new config file in `js/config/` exporting a config object matching the shape above.
2. Add an import in `js/app.js` and register it in the `configs` object.
3. Add a `<button class="tab-button" data-target="newtab">New Tab</button>` in `index.html`.
4. Write a Python script (or extend `geocode.py`) to produce the geocoded data file in `data/`.
5. Add the script to `update.sh`.

### Updating data

1. Ensure `.env` has a valid `GOOGLE_MAPS_API_KEY`.
2. Run `./update.sh` (or individual scripts for targeted updates).
3. Update `data/last_updated.txt` with the current date if the scripts don't do it automatically.
4. Commit and push: `./push.sh` (pushes to the `vibecoda` remote on `main`).

### Changing filter behavior

Filter definitions live in each config file under `config.filters`. Supported types:

- `search` — text input; `matchFields` is an array of row property names to search across (case-insensitive substring match).
- `select` — dropdown; auto-populated from unique values in `config.field` across all rows.
- `number` — numeric input with `operator` (`>=` or `<=`).
- `tags` — multi-select chips; all selected tags must be present in the row's tag array (AND logic).

To add a new filter type, modify `UIManager.renderFilters()` and `App.applyFilters()`.

### Changing table columns

Edit `config.columns` — each entry has `{ header, field, isLink?, format? }`. The `format` function receives `(value, fullRow)` and returns a display string. If `isLink: true`, the cell renders as an `<a>` tag using `row.mapUrl`.

### Local development

1. Copy your Google Maps API key into `js/env.js` (gitignored):
   ```js
   export const GOOGLE_MAPS_API_KEY = 'YOUR_KEY';
   ```
2. Serve with any static file server, e.g.:
   ```bash
   python3 -m http.server 8000
   ```
3. Open `http://localhost:8000`. The inline `<script>` in `index.html` dynamically imports `js/env.js` to override the hardcoded production key.

### Geocoding a new Kyoto-like dataset

The `process_shops()` helper in `geocode.py` is generic. Call it with:
- `shop_extractor` — yields `(shop_dict, group_name)` tuples from the input data
- `name_extractor` — gets the shop name string
- `query_builder` — returns a query string or list of fallback queries
- `coord_setter` — writes `lat`/`lng`/`place_id` back into the shop dict

---

## Key Dependencies

- **Frontend**: Google Maps JavaScript API (loaded dynamically in `index.html`)
- **Python scripts**: `requests` library (install with `pip install requests`); standard library otherwise
- **API keys**: Google Maps Geocoding / Places API key in `.env`; Google Maps JS API key hardcoded in `index.html` with a fallback to `js/env.js`

## Notes

- The `index.html` file contains two copies of the Google Maps JS API key (one hardcoded production key, one from `env.js` as a dynamic override). The production key is `AIzaSyAP9kDSLG9wPHPfn2u1SiTGGWYBAFhqz7E`.
- iOS detection in `helpers.js` controls whether map links use `target="_blank"` (avoided on iOS to preserve Universal Links / app switching).
- The `vibecoda` remote is used for deployment; the `push.sh` script uses `~/.ssh/id_rsa` explicitly.
- The Hachipay config has hardcoded Shibuya-area patterns and romaji mappings for area detection from addresses.
