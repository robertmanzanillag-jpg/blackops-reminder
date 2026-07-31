const NETWORK_BY_FILENAME = [
  { pattern: /^tiktok-posts_.+\.csv$/i, network: "tiktok" },
  { pattern: /^facebook-(?:posts|reels)_.+\.csv$/i, network: "facebook" },
  { pattern: /^youtube-published-videos-posts_.+\.csv$/i, network: "youtube" },
];

function cleanHeader(value) {
  return String(value || "").replace(/^\uFEFF/, "").trim();
}

function cleanNumber(value) {
  const normalized = String(value ?? "").replace(/[,\s]/g, "");
  if (!normalized) return null;
  const number = Number(normalized);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function first(row, names) {
  for (const name of names) {
    const value = row[name];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function isoDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return undefined;
  const local = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})(?::(\d{2}))?$/.exec(raw);
  const normalized = local ? `${local[1]}T${local[2]}:${local[3] || "00"}` : raw;
  const parsed = new Date(normalized);
  return Number.isFinite(parsed.getTime()) ? normalized : undefined;
}

export function parseMetricoolCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const source = String(text || "");
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  const headers = (rows.shift() || []).map(cleanHeader);
  return rows
    .filter((values) => values.some((value) => String(value).trim()))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

export function classifyMetricoolCsv(filename) {
  return NETWORK_BY_FILENAME.find(({ pattern }) => pattern.test(String(filename || "")))?.network || null;
}

export function extractMetricoolCsvSamples(filename, text) {
  const network = classifyMetricoolCsv(filename);
  if (!network) return null;
  const samples = new Map();
  for (const row of parseMetricoolCsv(text)) {
    const id = network === "tiktok"
      ? first(row, ["URL", "Link"])
      : network === "facebook"
        ? first(row, ["PostLink", "Reel Link"])
        : first(row, ["videoId", "watchUrl"]);
    const views = network === "tiktok"
      ? cleanNumber(first(row, ["Views"]))
      : network === "facebook"
        ? cleanNumber(first(row, ["VideoViews", "Video Views", "Impressions", "Reach"]))
        : cleanNumber(first(row, ["views"]));
    if (!id || views == null) continue;
    const durationSeconds = cleanNumber(first(row, ["Duration", "Avg. time watched (Seconds)"]));
    samples.set(id, {
      id,
      views: Math.floor(views),
      publishedAt: isoDate(first(row, ["Date", "publishedAt"])),
      ...(durationSeconds != null && durationSeconds > 0
        ? { durationSeconds: Math.min(86_400, Math.round(durationSeconds)) }
        : {}),
    });
  }
  return { network, samples: [...samples.values()] };
}
