const searchInput = document.getElementById("search");
const areaSelect = document.getElementById("area");
const categorySelect = document.getElementById("category");
const ratingInput = document.getElementById("rating");
const priceInput = document.getElementById("price");
const statusMessage = document.getElementById("status");
const tableBody = document.getElementById("table-body");
const mapContainer = document.getElementById("map");

let allShops = [];
let currentFilteredRows = [];
let map;
let mapMarkers = [];
let mapsLibraryLoaded = false;
let shopsReady = false;
let infoWindow;

const DEFAULT_MAP_CENTER = { lat: 35.0116, lng: 135.7681 };
const DEFAULT_MAP_ZOOM = 12;

window.initMap = function initMap() {
  mapsLibraryLoaded = true;
  initializeMap();
};

async function init() {
  try {
    await setLastUpdated();
    statusMessage.textContent = "Loading data…";
    const response = await fetch("data/kyoto_shops_geocoded.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }
    const payload = await response.json();
    allShops = processShops(payload);

    populateFilters(allShops);
    bindEvents();
    shopsReady = true;
    initializeMap();
    applyFilters();
  } catch (error) {
    console.error(error);
    statusMessage.textContent = `Failed to load data: ${error.message}`;
  }
}

async function setLastUpdated() {
  const lastUpdatedSpan = document.getElementById("last-updated");
  if (!lastUpdatedSpan) {
    return;
  }

  try {
    const response = await fetch("data/last_updated.txt", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Failed to load last updated date");
    }
    const dateString = await response.text().then(text => text.trim());

    // Check if format includes time (YYYY-MM-DD HH:MM)
    if (dateString.includes(' ')) {
      const [datePart, timePart] = dateString.split(' ');
      const date = new Date(datePart);
      const dateOptions = { year: 'numeric', month: 'long', day: 'numeric' };
      const formattedDate = date.toLocaleDateString('en-US', dateOptions);
      lastUpdatedSpan.textContent = `${formattedDate} at ${timePart}`;
    } else {
      // Just date, no time
      const date = new Date(dateString);
      const options = { year: 'numeric', month: 'long', day: 'numeric' };
      lastUpdatedSpan.textContent = date.toLocaleDateString('en-US', options);
    }
  } catch (error) {
    console.error("Error loading last updated date:", error);
    lastUpdatedSpan.textContent = "Unknown";
  }
}

document.addEventListener("DOMContentLoaded", init);

function processShops(payload) {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.map((shop) => {
    const latitude = typeof shop.Latitude === "number" ? shop.Latitude : null;
    const longitude = typeof shop.Longitude === "number" ? shop.Longitude : null;

    return {
      id: shop.ProductId,
      title: shop.Title || "",
      placeId: typeof shop.GooglePlaceId === "string" && shop.GooglePlaceId.trim()
        ? shop.GooglePlaceId.trim()
        : null,
      area: shop.AreaName || "",
      category: shop.CategoryName || "",
      subCategory: shop.SubCategoryId || null,
      rating: typeof shop.GoogleReviewRate === "number" ? shop.GoogleReviewRate : null,
      reviewCount: typeof shop.GoogleReviewCount === "number" ? shop.GoogleReviewCount : null,
      price: typeof shop.Price === "number" ? shop.Price : null,
      summary: shop.Summary || "",
      prefecture: shop.ProductPrefectureName || "",
      latitude,
      longitude,
      hasCoordinates: Number.isFinite(latitude) && Number.isFinite(longitude),
    };
  });
}

function populateFilters(rows) {
  const areas = new Set();
  const categories = new Set();

  rows.forEach((row) => {
    if (row.area) {
      areas.add(row.area);
    }
    if (row.category) {
      categories.add(row.category);
    }
  });

  fillSelect(areaSelect, [...areas].sort());
  fillSelect(categorySelect, [...categories].sort());
}

function fillSelect(select, values) {
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  }
}

function bindEvents() {
  [searchInput, ratingInput, priceInput].forEach((input) =>
    input.addEventListener("input", applyFilters)
  );

  [areaSelect, categorySelect].forEach((select) =>
    select.addEventListener("change", applyFilters)
  );
}

function applyFilters() {
  const keyword = searchInput.value.trim().toLowerCase();
  const area = areaSelect.value;
  const category = categorySelect.value;
  const minRating = parseFloat(ratingInput.value);
  const maxPrice = parseInt(priceInput.value, 10);

  const filtered = allShops.filter((shop) => {
    if (keyword) {
      const haystack = [
        shop.title,
        shop.area,
        shop.category,
        shop.summary,
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(keyword)) {
        return false;
      }
    }

    if (area && shop.area !== area) {
      return false;
    }

    if (category && shop.category !== category) {
      return false;
    }

    if (!Number.isNaN(minRating)) {
      const rating = typeof shop.rating === "number" ? shop.rating : -Infinity;
      if (rating < minRating) {
        return false;
      }
    }

    if (!Number.isNaN(maxPrice)) {
      const price = typeof shop.price === "number" ? shop.price : Infinity;
      if (price > maxPrice) {
        return false;
      }
    }

    return true;
  });

  currentFilteredRows = filtered;
  renderTable(filtered);
  updateMapMarkers(filtered);
  const message = filtered.length === allShops.length
    ? `${filtered.length} shops shown`
    : `${filtered.length} of ${allShops.length} shops match`;
  statusMessage.textContent = message;
}

function renderTable(rows) {
  tableBody.replaceChildren();

  if (rows.length === 0) {
    const emptyRow = document.createElement("tr");
    const emptyCell = document.createElement("td");
    emptyCell.colSpan = 5;
    emptyCell.textContent = "No shops match the current filters.";
    emptyRow.append(emptyCell);
    tableBody.append(emptyRow);
    return;
  }

  for (const shop of rows) {
    const tr = document.createElement("tr");

    const titleCell = document.createElement("td");
    const link = document.createElement("a");
    const displayTitle = shop.title || "(No title)";
    link.textContent = displayTitle;
    link.href = buildMapUrl(shop);
    link.target = "_blank";
    link.rel = "noopener";
    titleCell.append(link);
    tr.append(titleCell);

    const categoryCell = document.createElement("td");
    categoryCell.textContent = shop.category;
    tr.append(categoryCell);

    const areaCell = document.createElement("td");
    areaCell.textContent = shop.area;
    tr.append(areaCell);

    const ratingCell = document.createElement("td");
    if (typeof shop.rating === "number") {
      const ratingParts = [shop.rating.toFixed(1)];
      if (typeof shop.reviewCount === "number") {
        ratingParts.push(`(${shop.reviewCount})`);
      }
      ratingCell.textContent = ratingParts.join(" ");
    } else {
      ratingCell.textContent = "–";
    }
    tr.append(ratingCell);

    const priceCell = document.createElement("td");
    if (typeof shop.price === "number") {
      priceCell.textContent = `¥${shop.price.toLocaleString()}`;
    } else {
      priceCell.textContent = "–";
    }
    tr.append(priceCell);

    tableBody.append(tr);
  }
}

function buildMapUrl(shop) {
  if (shop.placeId) {
    return `https://www.google.com/maps/place/?q=place_id:${shop.placeId}`;
  }

  const queryParts = [shop.title, shop.area, shop.prefecture]
    .filter((value) => typeof value === "string" && value.trim().length)
    .join(" ");

  if (queryParts) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(queryParts)}`;
  }

  if (shop.hasCoordinates) {
    return `https://www.google.com/maps/search/?api=1&query=${shop.latitude},${shop.longitude}`;
  }

  return "https://www.google.com/maps";
}

function initializeMap() {
  if (!mapContainer || map || !mapsLibraryLoaded || !shopsReady) {
    return;
  }

  if (typeof window.google === "undefined" || !window.google.maps) {
    return;
  }

  map = new google.maps.Map(mapContainer, {
    center: DEFAULT_MAP_CENTER,
    zoom: DEFAULT_MAP_ZOOM,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
  });

  infoWindow = new google.maps.InfoWindow();

  const rowsToRender = currentFilteredRows.length ? currentFilteredRows : allShops;
  updateMapMarkers(rowsToRender);
}

function updateMapMarkers(rows) {
  if (!map || typeof window.google === "undefined" || !window.google.maps) {
    return;
  }

  clearMapMarkers();

  const bounds = new google.maps.LatLngBounds();
  let hasMarker = false;

  rows.forEach((shop) => {
    if (!shop.hasCoordinates) {
      return;
    }

    const position = { lat: shop.latitude, lng: shop.longitude };
    const marker = new google.maps.Marker({
      map,
      position,
      title: shop.title,
    });

    marker.addListener("click", () => {
      if (infoWindow) {
        infoWindow.close();
        infoWindow.setContent(createInfoWindowContent(shop));
        infoWindow.open({ anchor: marker, map });
      }
    });

    mapMarkers.push(marker);
    bounds.extend(position);
    hasMarker = true;
  });

  if (!hasMarker) {
    map.setCenter(DEFAULT_MAP_CENTER);
    map.setZoom(DEFAULT_MAP_ZOOM);
    return;
  }

  if (mapMarkers.length === 1) {
    map.setCenter(bounds.getCenter());
    map.setZoom(16);
    return;
  }

  map.fitBounds(bounds, 72);
}

function clearMapMarkers() {
  mapMarkers.forEach((marker) => {
    marker.setMap(null);
  });
  mapMarkers = [];

  if (infoWindow) {
    infoWindow.close();
  }
}

function createInfoWindowContent(shop) {
  const container = document.createElement("div");
  container.className = "map-info-window";
  container.style.display = "grid";
  container.style.gap = "0.25rem";

  const titleLink = document.createElement("a");
  titleLink.href = buildMapUrl(shop);
  titleLink.target = "_blank";
  titleLink.rel = "noopener";
  titleLink.textContent = shop.title || "(No title)";
  titleLink.style.fontWeight = "600";
  titleLink.style.color = "#1a73e8";
  titleLink.style.textDecoration = "none";

  titleLink.addEventListener("mouseenter", () => {
    titleLink.style.textDecoration = "underline";
  });
  titleLink.addEventListener("mouseleave", () => {
    titleLink.style.textDecoration = "none";
  });

  container.append(titleLink);

  if (shop.summary) {
    const summaryLine = document.createElement("div");
    summaryLine.textContent = shop.summary.substring(0, 100) + (shop.summary.length > 100 ? "..." : "");
    summaryLine.style.fontSize = "0.85rem";
    summaryLine.style.color = "#5f6368";
    container.append(summaryLine);
  }

  const metadata = [shop.area, shop.category].filter(Boolean);
  if (metadata.length) {
    const metaLine = document.createElement("div");
    metaLine.textContent = metadata.join(" · ");
    metaLine.style.fontSize = "0.75rem";
    metaLine.style.color = "#7a7a7a";
    container.append(metaLine);
  }

  if (typeof shop.price === "number") {
    const priceLine = document.createElement("div");
    priceLine.textContent = `¥${shop.price.toLocaleString()}`;
    priceLine.style.fontSize = "0.85rem";
    priceLine.style.fontWeight = "600";
    priceLine.style.color = "#1c1d1f";
    container.append(priceLine);
  }

  return container;
}
