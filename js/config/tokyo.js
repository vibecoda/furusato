function buildMapUrl(shop, municipality) {
  if (shop.googlePlaceId && typeof shop.googlePlaceId === 'string' && shop.googlePlaceId.trim()) {
    return `https://www.google.com/maps/place/?q=place_id:${shop.googlePlaceId.trim()}`;
  }

  const queryParts = [shop.name, shop.details?.["住所"], municipality, shop.area?.prefecture]
    .filter((value) => typeof value === "string" && value.trim().length)
    .join(" ");

  if (queryParts) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(queryParts)}`;
  }

  if (typeof shop.latitude === 'number' && typeof shop.longitude === 'number') {
    return `https://www.google.com/maps/search/?api=1&query=${shop.latitude},${shop.longitude}`;
  }

  return "https://www.google.com/maps";
}

export const tokyoConfig = {
  id: 'tokyo',
  label: 'Tokyo',
  dataUrl: 'data/tokyo_shops_geocoded.json',
  dataType: 'json',
  
  processFn: (payload) => {
    if (!payload || !Array.isArray(payload.data)) return [];
    const rows = [];
    for (const entry of payload.data) {
      const municipalityName = entry.municipalityName || "";
      if (!Array.isArray(entry.shops)) continue;
      
      for (const shop of entry.shops) {
        const latitude = typeof shop.latitude === "number" ? shop.latitude : null;
        const longitude = typeof shop.longitude === "number" ? shop.longitude : null;
        
        rows.push({
          id: shop.id,
          title: shop.name || "",
          category: shop.category || "",
          area: municipalityName, 
          rating: shop.googleReview?.rating ?? null,
          reviewCount: shop.googleReview?.count ?? null,
          metric: typeof shop.pointGuide === "number" ? shop.pointGuide : null,
          tags: Array.isArray(shop.tags) ? shop.tags : [],
          description: shop.description || "",
          address: shop.details?.["住所"] || "",
          lat: latitude,
          lng: longitude,
          hasCoordinates: Number.isFinite(latitude) && Number.isFinite(longitude),
          mapUrl: buildMapUrl(shop, municipalityName)
        });
      }
    }
    return rows;
  },

  filters: [
    { type: 'search', field: 'keyword', placeholder: 'Search name, area, category, tags...', matchFields: ['title', 'area', 'category', 'tags'] },
    { type: 'select', field: 'area', label: 'Municipality' },
    { type: 'select', field: 'category', label: 'Category' },
    { type: 'tags', field: 'tags', label: 'Tags' },
    { type: 'number', field: 'rating', label: 'Min Rating', operator: '>=' },
    { type: 'number', field: 'metric', label: 'Max Points', operator: '<=' }
  ],

  columns: [
    { header: 'Shop Name', field: 'title', isLink: true },
    { header: 'Category', field: 'category' },
    { header: 'Rating', field: 'rating', format: (val, row) => val ? `${val.toFixed(1)} (${row.reviewCount})` : '–' },
    { header: 'Points', field: 'metric', format: (val) => val ? val.toLocaleString() : '–' }
  ],

  mapCenter: { lat: 35.6895, lng: 139.6917 },
  mapZoom: 12
};
