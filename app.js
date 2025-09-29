const searchInput = document.getElementById("search");
const municipalitySelect = document.getElementById("municipality");
const categorySelect = document.getElementById("category");
const tagContainer = document.getElementById("tag-chips");
const clearTagsButton = document.getElementById("clear-tags");
const ratingInput = document.getElementById("rating");
const pointInput = document.getElementById("points");
const statusMessage = document.getElementById("status");
const tableBody = document.getElementById("table-body");
const mapContainer = document.getElementById("map");

let allShops = [];
const activeTags = new Set();
let currentFilteredRows = [];
let map;
let mapMarkers = [];
let mapsLibraryLoaded = false;
let shopsReady = false;

const DEFAULT_MAP_CENTER = { lat: 35.6895, lng: 139.6917 };
const DEFAULT_MAP_ZOOM = 12;

window.initMap = function initMap() {
  mapsLibraryLoaded = true;
  initializeMap();
};

async function init() {
  try {
    statusMessage.textContent = "Loading data…";
    const response = await fetch("data/tokyo_shops_geocoded.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }
    const payload = await response.json();
    allShops = flattenShops(payload);

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

document.addEventListener("DOMContentLoaded", init);

function flattenShops(payload) {
  if (!payload || !Array.isArray(payload.data)) {
    return [];
  }

  const rows = [];
  for (const entry of payload.data) {
    const municipalityName = entry.municipalityName || "";
    if (!Array.isArray(entry.shops)) {
      continue;
    }
    for (const shop of entry.shops) {
      rows.push({
        id: shop.id,
        name: shop.name || "",
        municipality: municipalityName,
        category: shop.category || "",
        region: shop.area?.region || "",
        prefecture: shop.area?.prefecture || "",
        locality: shop.area?.locality || "",
        rating: shop.googleReview?.rating ?? null,
        reviewCount: shop.googleReview?.count ?? null,
        pointGuide: typeof shop.pointGuide === "number" ? shop.pointGuide : null,
        tags: Array.isArray(shop.tags) ? shop.tags : [],
        description: shop.description || "",
      });
    }
  }
  return rows;
}

function populateFilters(rows) {
  const municipalities = new Set();
  const categories = new Set();
  const tags = new Set();

  rows.forEach((row) => {
    if (row.municipality) {
      municipalities.add(row.municipality);
    }
    if (row.category) {
      categories.add(row.category);
    }
    row.tags.forEach((tag) => tags.add(tag));
  });

  fillSelect(municipalitySelect, [...municipalities].sort());
  fillSelect(categorySelect, [...categories].sort());
  renderTagChips([...tags].sort());
}

function fillSelect(select, values) {
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  }
}

function renderTagChips(tagValues) {
  activeTags.clear();
  tagContainer.replaceChildren();

  tagValues.forEach((value) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = value;
    chip.dataset.tag = value;
    chip.dataset.active = "false";
    chip.setAttribute("role", "option");
    chip.setAttribute("aria-selected", "false");
    chip.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.currentTarget.click();
      }
    });
    tagContainer.append(chip);
  });
}

function bindEvents() {
  [searchInput, ratingInput, pointInput].forEach((input) =>
    input.addEventListener("input", applyFilters)
  );

  [municipalitySelect, categorySelect].forEach((select) =>
    select.addEventListener("change", applyFilters)
  );

  tagContainer.addEventListener("click", (event) => {
    const chip = event.target.closest(".chip");
    if (!chip || !chip.dataset.tag) {
      return;
    }
    toggleTag(chip);
    applyFilters();
  });

  clearTagsButton.addEventListener("click", () => {
    if (!activeTags.size) {
      return;
    }
    activeTags.clear();
    tagContainer.querySelectorAll(".chip").forEach((chip) => {
      chip.dataset.active = "false";
      chip.setAttribute("aria-selected", "false");
    });
    applyFilters();
  });
}

function toggleTag(chip) {
  const tagValue = chip.dataset.tag;
  if (!tagValue) {
    return;
  }
  const isActive = activeTags.has(tagValue);
  if (isActive) {
    activeTags.delete(tagValue);
    chip.dataset.active = "false";
    chip.setAttribute("aria-selected", "false");
  } else {
    activeTags.add(tagValue);
    chip.dataset.active = "true";
    chip.setAttribute("aria-selected", "true");
  }
}

function applyFilters() {
  const keyword = searchInput.value.trim().toLowerCase();
  const municipality = municipalitySelect.value;
  const category = categorySelect.value;
  const selectedTags = [...activeTags];
  const minRating = parseFloat(ratingInput.value);
  const maxPoint = parseInt(pointInput.value, 10);

  const filtered = allShops.filter((shop) => {
    if (keyword) {
      const haystack = [
        shop.name,
        shop.municipality,
        shop.category,
        shop.locality,
        shop.tags.join(" "),
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(keyword)) {
        return false;
      }
    }

    if (municipality && shop.municipality !== municipality) {
      return false;
    }

    if (category && shop.category !== category) {
      return false;
    }

    if (selectedTags.length) {
      const hasEveryTag = selectedTags.every((tag) => shop.tags.includes(tag));
      if (!hasEveryTag) {
        return false;
      }
    }

    if (!Number.isNaN(minRating)) {
      const rating = typeof shop.rating === "number" ? shop.rating : -Infinity;
      if (rating < minRating) {
        return false;
      }
    }

    if (!Number.isNaN(maxPoint)) {
      const point = typeof shop.pointGuide === "number" ? shop.pointGuide : Infinity;
      if (point > maxPoint) {
        return false;
      }
    }

    return true;
  });

  renderTable(filtered);
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
    emptyCell.colSpan = 6;
    emptyCell.textContent = "No shops match the current filters.";
    emptyRow.append(emptyCell);
    tableBody.append(emptyRow);
    return;
  }

  for (const shop of rows) {
    const tr = document.createElement("tr");

    const nameCell = document.createElement("td");
    const link = document.createElement("a");
    const displayName = shop.name || "(No title)";
    link.textContent = displayName;
    const queryParts = [displayName, shop.municipality, shop.prefecture]
      .filter(Boolean)
      .join(" ");
  link.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(queryParts)}`;
    link.target = "_blank";
    link.rel = "noopener";
    nameCell.append(link);
    tr.append(nameCell);

    const categoryCell = document.createElement("td");
    categoryCell.textContent = shop.category;
    tr.append(categoryCell);

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

    const pointCell = document.createElement("td");
    if (typeof shop.pointGuide === "number") {
      pointCell.textContent = shop.pointGuide.toLocaleString();
    } else {
      pointCell.textContent = "–";
    }
    tr.append(pointCell);

    tableBody.append(tr);
  }
}
