const searchInput = document.getElementById("search");
const placeSelect = document.getElementById("place-filter");
const categorySelect = document.getElementById("category-filter");
const statusMessage = document.getElementById("status");
const tableBody = document.getElementById("restaurant-body");
const mapContainer = document.getElementById("map");

const AREA_PATTERNS = [
  "代々木上原",
  "南平台町",
  "桜丘町",
  "桜丘",
  "元代々木町",
  "恵比寿南",
  "恵比寿西",
  "宇田川町",
  "代官山町",
  "鶯谷町",
  "神宮前",
  "千駄ヶ谷",
  "道玄坂",
  "猿楽町",
  "代々木",
  "恵比寿",
  "神山町",
  "神泉町",
  "神南",
  "渋谷",
  "富ヶ谷",
  "幡ヶ谷",
  "広尾",
  "円山町",
  "鉢山町",
  "大山町",
  "上原",
  "初台",
  "西原",
  "笹塚",
  "本町",
  "東",
  "松濤",
  "松涛"
].sort((a, b) => b.length - a.length);

const AREA_ROMAJI = {
  "代々木上原": "Yoyogi-Uehara",
  "南平台町": "Nanpeidai-cho",
  "桜丘町": "Sakuragaoka-cho",
  "桜丘": "Sakuragaoka",
  "元代々木町": "Motoyoyogi-cho",
  "恵比寿南": "Ebisu-Minami",
  "恵比寿西": "Ebisu-Nishi",
  "宇田川町": "Udagawa-cho",
  "代官山町": "Daikanyama-cho",
  "鶯谷町": "Uguisudani-cho",
  "神宮前": "Jingumae",
  "千駄ヶ谷": "Sendagaya",
  "道玄坂": "Dogenzaka",
  "猿楽町": "Sarugaku-cho",
  "代々木": "Yoyogi",
  "恵比寿": "Ebisu",
  "神山町": "Kamiyama-cho",
  "神泉町": "Shinsen-cho",
  "神南": "Jinnan",
  "渋谷": "Shibuya",
  "富ヶ谷": "Tomigaya",
  "幡ヶ谷": "Hatagaya",
  "広尾": "Hiroo",
  "円山町": "Maruyama-cho",
  "鉢山町": "Hachiyama-cho",
  "大山町": "Oyama-cho",
  "上原": "Uehara",
  "初台": "Hatsudai",
  "西原": "Nishihara",
  "笹塚": "Sasazuka",
  "本町": "Honmachi",
  "東": "Higashi",
  "松濤": "Shoto",
  "松涛": "Shoto"
};

let restaurants = [];
let map;
let mapMarkers = [];
let mapsLibraryLoaded = false;
let restaurantsReady = false;
let currentFilteredRows = [];
let infoWindow;

const DEFAULT_MAP_CENTER = { lat: 35.664035, lng: 139.698212 };
const DEFAULT_MAP_ZOOM = 14;

document.addEventListener("DOMContentLoaded", init);

window.initMap = function initMap() {
  mapsLibraryLoaded = true;
  initializeMap();
};

async function init() {
  try {
    statusMessage.textContent = "Loading restaurants…";
    const text = await fetchCsv("data/restaurants_geocoded.csv");
    const parsed = parseCsv(text);
    if (!parsed.length) {
      throw new Error("CSV contained no rows");
    }
    const [header, ...rows] = parsed;
    restaurants = rows
      .map((row, index) => makeRestaurant(header, row, index))
      .filter((item) => Boolean(item));

    populateFilters(restaurants);
    bindEvents();
    restaurantsReady = true;
    initializeMap();
    applyFilters();
  } catch (error) {
    console.error(error);
    statusMessage.textContent = `Failed to load data: ${error.message}`;
  }
}

async function fetchCsv(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  return response.text();
}

function parseCsv(text) {
  const rows = [];
  let currentRow = [];
  let currentValue = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (char === "\"") {
      if (inQuotes && text[i + 1] === "\"") {
        currentValue += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      currentRow.push(currentValue.trim());
      currentValue = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && text[i + 1] === "\n") {
        i += 1;
      }
      currentRow.push(currentValue.trim());
      if (currentRow.some((value) => value !== "")) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentValue = "";
      continue;
    }

    currentValue += char;
  }

  if (currentValue.length || currentRow.length) {
    currentRow.push(currentValue.trim());
    if (currentRow.some((value) => value !== "")) {
      rows.push(currentRow);
    }
  }

  return rows;
}

function makeRestaurant(header, row, index) {
  if (!row.length) {
    return null;
  }

  const record = Object.fromEntries(header.map((key, index) => [key, row[index] ?? ""]));
  const name = record.show_name?.trim();
  if (!name) {
    return null;
  }

  const address = record.address?.trim() ?? "";
  const area = detectArea(address);
  const areaRomaji = area ? AREA_ROMAJI[area] ?? "" : "";
  const categories = buildCategory(record);
  const latitude = parseFloat(record.latitude);
  const longitude = parseFloat(record.longitude);
  const hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude);

  return {
    id: index,
    name,
    parentCategory: record.parent_category?.trim() ?? "",
    middleCategory: record.middle_category?.trim() ?? "",
    childCategory: record.child_category?.trim() ?? "",
    categoryLabel: categories,
    address,
    tel: record.tel?.trim() ?? "",
    googleUrl: sanitizeUrl(record.google_url?.trim() ?? ""),
    area,
    areaRomaji,
    latitude: hasCoordinates ? latitude : null,
    longitude: hasCoordinates ? longitude : null,
    hasCoordinates,
    keywords: [
      name,
      area,
      areaRomaji,
      categories,
      address,
      record.tel?.trim() ?? "",
      hasCoordinates ? `${latitude} ${longitude}` : ""
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
  };
}

function buildCategory(record) {
  const parts = [record.child_category, record.middle_category, record.parent_category]
    .map((value) => (value || "").trim())
    .filter(Boolean);
  return parts.join(" › ");
}

function sanitizeUrl(url) {
  if (!url) {
    return "";
  }
  try {
    const parsed = new URL(url);
    return parsed.href;
  } catch (error) {
    return "";
  }
}

function isGoogleMapsUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === "maps.app.goo.gl") {
      return true;
    }
    if (host === "goo.gl") {
      return parsed.pathname.toLowerCase().startsWith("/maps");
    }
    if (host.includes("google.")) {
      return parsed.pathname.toLowerCase().startsWith("/maps");
    }
  } catch (error) {
    return false;
  }
  return false;
}

function detectArea(address) {
  if (!address) {
    return "";
  }
  for (const area of AREA_PATTERNS) {
    if (address.includes(area)) {
      return area;
    }
  }
  return "";
}

function populateFilters(data) {
  const uniqueAreas = new Map();
  data.forEach((item) => {
    if (!item.area) {
      return;
    }
    if (!uniqueAreas.has(item.area)) {
      uniqueAreas.set(item.area, item.areaRomaji || "");
    }
  });

  const areaOptions = Array.from(uniqueAreas.entries()).sort((a, b) => {
    const [nameA, romajiA] = a;
    const [nameB, romajiB] = b;
    const labelA = (romajiA || nameA).toLowerCase();
    const labelB = (romajiB || nameB).toLowerCase();
    return labelA.localeCompare(labelB);
  });

  areaOptions.forEach(([area, romaji]) => {
    const option = document.createElement("option");
    option.value = area;
    option.textContent = romaji ? `${romaji} / ${area}` : area;
    placeSelect.append(option);
  });

  const categorySet = new Set();
  data.forEach((item) => {
    if (item.childCategory) {
      categorySet.add(item.childCategory);
    }
  });

  Array.from(categorySet)
    .sort((a, b) => a.localeCompare(b, "ja"))
    .forEach((category) => {
      const option = document.createElement("option");
      option.value = category;
      option.textContent = category;
      categorySelect.append(option);
    });
}

function bindEvents() {
  searchInput.addEventListener("input", applyFilters);
  placeSelect.addEventListener("change", applyFilters);
  categorySelect.addEventListener("change", applyFilters);
}

function applyFilters() {
  const keyword = searchInput.value.trim().toLowerCase();
  const areaFilter = placeSelect.value;
  const categoryFilter = categorySelect.value;

  const filtered = restaurants.filter((restaurant) => {
    if (keyword && !restaurant.keywords.includes(keyword)) {
      return false;
    }

    if (areaFilter && restaurant.area !== areaFilter) {
      return false;
    }

    if (categoryFilter && restaurant.childCategory !== categoryFilter) {
      return false;
    }

    return true;
  });

  currentFilteredRows = filtered;
  renderTable(filtered);
  updateMapMarkers(filtered);
  const summary = filtered.length === restaurants.length
    ? `${filtered.length} restaurants shown`
    : `${filtered.length} of ${restaurants.length} restaurants match`;
  statusMessage.textContent = summary;
}

function renderTable(rows) {
  tableBody.replaceChildren();

  if (!rows.length) {
    const emptyRow = document.createElement("tr");
    const emptyCell = document.createElement("td");
    emptyCell.colSpan = 5;
    emptyCell.textContent = "No restaurants match the current filters.";
    emptyRow.append(emptyCell);
    tableBody.append(emptyRow);
    return;
  }

  rows.forEach((restaurant) => {
    const tr = document.createElement("tr");

    const nameCell = document.createElement("td");
    const link = document.createElement("a");
    link.dataset.role = "map-link";
    link.textContent = restaurant.name;
    link.href = buildMapUrl(restaurant);
    link.target = "_blank";
    link.rel = "noopener";
    nameCell.append(link);
    tr.append(nameCell);

    const placeCell = document.createElement("td");
    if (restaurant.area) {
      placeCell.textContent = restaurant.areaRomaji
        ? `${restaurant.areaRomaji} (${restaurant.area})`
        : restaurant.area;
    } else {
      placeCell.textContent = "–";
    }
    tr.append(placeCell);

    const categoryCell = document.createElement("td");
    categoryCell.textContent = restaurant.categoryLabel || "–";
    tr.append(categoryCell);

    const addressCell = document.createElement("td");
    addressCell.textContent = restaurant.address || "–";
    tr.append(addressCell);

    const phoneCell = document.createElement("td");
    if (restaurant.tel) {
      const telLink = document.createElement("a");
      telLink.href = `tel:${restaurant.tel.replace(/[^0-9+]/g, "")}`;
      telLink.textContent = restaurant.tel;
      telLink.rel = "nofollow";
      phoneCell.append(telLink);
    } else {
      phoneCell.textContent = "–";
    }
    tr.append(phoneCell);

    tableBody.append(tr);
  });
}

function buildMapUrl(restaurant) {
  if (restaurant.googleUrl && isGoogleMapsUrl(restaurant.googleUrl)) {
    return restaurant.googleUrl;
  }
  const query = [restaurant.name, restaurant.address].filter(Boolean).join(" ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function initializeMap() {
  if (!mapContainer || map || !mapsLibraryLoaded || !restaurantsReady) {
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
    fullscreenControl: false
  });

  infoWindow = new google.maps.InfoWindow();

  const rowsToRender = currentFilteredRows.length ? currentFilteredRows : restaurants;
  updateMapMarkers(rowsToRender);
}

function updateMapMarkers(rows) {
  if (!map || typeof window.google === "undefined" || !window.google.maps) {
    return;
  }

  clearMapMarkers();

  const bounds = new google.maps.LatLngBounds();
  let hasMarker = false;

  rows.forEach((restaurant) => {
    if (!restaurant.hasCoordinates) {
      return;
    }

    const position = { lat: restaurant.latitude, lng: restaurant.longitude };
    const marker = new google.maps.Marker({
      map,
      position,
      title: restaurant.name
    });

    marker.addListener("click", () => {
      if (infoWindow) {
        infoWindow.close();
        infoWindow.setContent(createInfoWindowContent(restaurant));
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

  map.fitBounds(bounds, 48);
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

function createInfoWindowContent(restaurant) {
  const container = document.createElement("div");
  container.className = "map-info-window";
  container.style.display = "grid";
  container.style.gap = "0.2rem";

  const titleLink = document.createElement("a");
  titleLink.href = buildMapUrl(restaurant);
  titleLink.target = "_blank";
  titleLink.rel = "noopener";
  titleLink.textContent = restaurant.name || "(No title)";
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

  if (restaurant.address) {
    const addressLine = document.createElement("div");
    addressLine.textContent = restaurant.address;
    addressLine.style.fontSize = "0.85rem";
    addressLine.style.color = "#5f6368";
    container.append(addressLine);
  }

  if (restaurant.areaRomaji || restaurant.area) {
    const areaLine = document.createElement("div");
    const parts = [restaurant.areaRomaji, restaurant.area].filter(Boolean);
    areaLine.textContent = parts.join(" · ");
    areaLine.style.fontSize = "0.75rem";
    areaLine.style.color = "#7a7a7a";
    container.append(areaLine);
  }

  return container;
}
