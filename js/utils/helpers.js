export function parseCsv(text) {
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

export function sanitizeUrl(url) {
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

export function isGoogleMapsUrl(url) {
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
