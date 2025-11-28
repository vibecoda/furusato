function buildMapUrl(shop) {
  if (shop.GooglePlaceId && typeof shop.GooglePlaceId === 'string' && shop.GooglePlaceId.trim()) {
    return `https://www.google.com/maps/place/?q=place_id:${shop.GooglePlaceId.trim()}`;
  }

  const queryParts = [shop.Title, shop.AreaName, shop.ProductPrefectureName]
    .filter((value) => typeof value === "string" && value.trim().length)
    .join(" ");

  if (queryParts) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(queryParts)}`;
  }

  if (typeof shop.Latitude === 'number' && typeof shop.Longitude === 'number') {
    return `https://www.google.com/maps/search/?api=1&query=${shop.Latitude},${shop.Longitude}`;
  }

  return "https://www.google.com/maps";
}

export const kyotoConfig = {
  id: 'kyoto',
  label: 'Kyoto',
  dataUrl: 'data/kyoto_shops_geocoded.json',
  dataType: 'json',

  processFn: (payload) => {
    if (!Array.isArray(payload)) return [];
    
    return payload.map((shop) => {
      const latitude = typeof shop.Latitude === "number" ? shop.Latitude : null;
      const longitude = typeof shop.Longitude === "number" ? shop.Longitude : null;

      return {
        id: shop.ProductId,
        title: shop.Title || "",
        category: shop.CategoryName || "",
        area: shop.AreaName || "",
        rating: typeof shop.GoogleReviewRate === "number" ? shop.GoogleReviewRate : null,
        reviewCount: typeof shop.GoogleReviewCount === "number" ? shop.GoogleReviewCount : null,
        metric: typeof shop.Price === "number" ? shop.Price : null,
        description: shop.Summary || "",
        lat: latitude,
        lng: longitude,
        hasCoordinates: Number.isFinite(latitude) && Number.isFinite(longitude),
        mapUrl: buildMapUrl(shop)
      };
    });
  },

  filters: [
    { type: 'search', field: 'keyword', placeholder: 'Search name, area, category...', matchFields: ['title', 'area', 'category', 'description'] },
    { type: 'select', field: 'area', label: 'Area' },
    { type: 'select', field: 'category', label: 'Category' },
    { type: 'number', field: 'rating', label: 'Min Rating', operator: '>=' },
    { type: 'number', field: 'metric', label: 'Max Price', operator: '<=' }
  ],

  columns: [
    { header: 'Shop Name', field: 'title', isLink: true },
    { header: 'Category', field: 'category' },
    { header: 'Area', field: 'area' },
    { header: 'Rating', field: 'rating', format: (val, row) => val ? `${val.toFixed(1)} (${row.reviewCount})` : '–' },
    { header: 'Price', field: 'metric', format: (val) => val ? `¥${val.toLocaleString()}` : '–' }
  ],
  
  mapCenter: { lat: 35.0116, lng: 135.7681 },
  mapZoom: 12
};
