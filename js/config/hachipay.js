import { sanitizeUrl, isGoogleMapsUrl } from '../utils/helpers.js';

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

function detectArea(address) {
  if (!address) return "";
  for (const area of AREA_PATTERNS) {
    if (address.includes(area)) return area;
  }
  return "";
}

function buildCategory(record) {
  const parts = [record.child_category, record.middle_category, record.parent_category]
    .map((value) => (value || "").trim())
    .filter(Boolean);
  return parts.join(" › ");
}

function buildMapUrl(record, name, address, latitude, longitude, hasCoordinates) {
  const googleUrl = sanitizeUrl(record.google_url?.trim() ?? "");
  if (googleUrl && isGoogleMapsUrl(googleUrl)) {
    return googleUrl;
  }

  if (record.google_place_id?.trim()) {
    return `https://www.google.com/maps/place/?q=place_id:${record.google_place_id.trim()}`;
  }

  const queryParts = [name, address]
    .filter((value) => typeof value === "string" && value.trim().length)
    .join(" ");

  if (queryParts) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(queryParts)}`;
  }

  if (hasCoordinates) {
    return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
  }

  return "https://www.google.com/maps";
}

export const hachipayConfig = {
  id: 'hachipay',
  label: 'Hachipay',
  dataUrl: 'data/restaurants_geocoded.csv',
  dataType: 'csv',

  processFn: (parsedCsv) => {
    if (!parsedCsv || parsedCsv.length < 2) return [];
    const [header, ...rows] = parsedCsv;
    
    return rows.map((row, index) => {
      if (!row.length) return null;
      
      // Basic mapping of header index to value
      const record = {};
      header.forEach((key, i) => {
          record[key] = row[i] ?? "";
      });
      
      const name = record.show_name?.trim();
      if (!name) return null;

      const address = record.address?.trim() ?? "";
      const area = detectArea(address);
      const areaRomaji = area ? AREA_ROMAJI[area] ?? "" : "";
      const categories = buildCategory(record);
      const latitude = parseFloat(record.latitude);
      const longitude = parseFloat(record.longitude);
      const hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude);
      const category = record.child_category?.trim() ?? "";

      // Construct generic item
      return {
        id: index,
        title: name,
        category: category,
        displayCategory: categories,
        // Combine Romaji and Kanji for display and filtering
        area: areaRomaji ? `${areaRomaji} (${area})` : area,
        address: address,
        tel: record.tel?.trim() ?? "",
        lat: latitude,
        lng: longitude,
        hasCoordinates: hasCoordinates,
        mapUrl: buildMapUrl(record, name, address, latitude, longitude, hasCoordinates)
      };
    }).filter(Boolean);
  },

  filters: [
    { type: 'search', field: 'keyword', placeholder: 'Search...', matchFields: ['title', 'area', 'displayCategory', 'address'] },
    { type: 'select', field: 'area', label: 'Area' }, 
    { type: 'select', field: 'category', label: 'Category' }
  ],

  columns: [
    { header: 'Shop Name', field: 'title', isLink: true },
    { header: 'Area', field: 'area' },
    { header: 'Category', field: 'displayCategory' },
    { header: 'Address', field: 'address' },
    { header: 'Tel', field: 'tel', format: (val) => {
        if (!val) return '–';
        // Simple tel link
        const digits = val.replace(/[^0-9+]/g, "");
        // We can't generate HTML in format currently unless UIManager allows innerHTML. 
        // UIManager.js renderTable sets textContent by default unless isLink is true.
        // For now return text.
        return val;
    }} 
  ],

  mapCenter: { lat: 35.664035, lng: 139.698212 },
  mapZoom: 14
};
