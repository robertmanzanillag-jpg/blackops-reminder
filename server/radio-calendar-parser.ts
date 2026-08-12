export type RadioCity = "miami" | "berlin" | "buenos_aires";

export interface RadioLineupEntry {
  hour: number;
  label: string;
  djName: string | null;
}

export const RADIO_CITY_CONFIG: Record<RadioCity, { timezone: string; label: string; hours: number[] }> = {
  miami: { timezone: "America/New_York", label: "MIAMI", hours: [7, 8, 9] },
  berlin: { timezone: "Europe/Berlin", label: "BERLIN", hours: [4, 5, 6, 7] },
  buenos_aires: { timezone: "America/Argentina/Buenos_Aires", label: "BUENOS AIRES", hours: [4, 5, 6, 7] },
};

function decodeDescription(description: string): string {
  return description
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

function cleanDjName(value: string): string | null {
  const cleaned = value.replace(/^[-–—:.\s]+/, "").replace(/\s+/g, " ").trim();
  if (!cleaned || /^(tba|open|empty|vacio|vacío|pending|pendiente)$/i.test(cleaned)) return null;
  return cleaned;
}

export function detectRadioCity(title: string, description: string | null = null): RadioCity {
  const value = `${title} ${description || ""}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/buenos\s*aires|argentina|\bba\b/.test(value)) return "buenos_aires";
  if (/berlin|alemania|germany/.test(value)) return "berlin";
  return "miami";
}

export function parseRadioDescription(description: string | null): Record<number, string | null> {
  if (!description) return {};
  const slots: Record<number, string | null> = {};
  const normalized = decodeDescription(description).replace(/\r?\n/g, " ");
  const slotPattern = /(?:^|\s)([4-9])(?:\s*:\s*00)?\s*(?:pm|p\.m\.)?\s*(?:[:.\-–—])\s*([\s\S]*?)(?=\s[4-9](?:\s*:\s*00)?\s*(?:pm|p\.m\.)?\s*(?:[:.\-–—])\s*|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = slotPattern.exec(normalized)) !== null) slots[Number(match[1])] = cleanDjName(match[2] || "");
  return slots;
}

function formatHour(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit", hour12: true })
    .format(date).replace(":00", "").replace(/\s/g, "").toUpperCase();
}

function getTimezoneAbbreviation(date: Date, city: RadioCity): string {
  if (city === "buenos_aires") return "ART";
  const offset = new Intl.DateTimeFormat("en-US", { timeZone: RADIO_CITY_CONFIG[city].timezone, timeZoneName: "shortOffset" })
    .formatToParts(date).find((part) => part.type === "timeZoneName")?.value || "";
  if (city === "berlin") return offset === "GMT+1" ? "CET" : "CEST";
  return offset === "GMT-5" ? "EST" : "EDT";
}

export function getOrdinalDay(day: number): string {
  const lastTwo = day % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${day}TH`;
  if (day % 10 === 1) return `${day}ST`;
  if (day % 10 === 2) return `${day}ND`;
  if (day % 10 === 3) return `${day}RD`;
  return `${day}TH`;
}

export function buildRadioCalendarFields(title: string, description: string | null, eventDate: Date) {
  const city = detectRadioCity(title, description);
  const parsedSlots = parseRadioDescription(description);
  const lineup = RADIO_CITY_CONFIG[city].hours.map((hour) => ({
    hour,
    label: `${hour}:00 PM`,
    djName: parsedSlots[hour] || null,
  }));
  const local = RADIO_CITY_CONFIG[city];
  const counterpartCity: RadioCity = city === "miami" ? "berlin" : "miami";
  const counterpart = RADIO_CITY_CONFIG[counterpartCity];
  const timezoneLines = [
    `${formatHour(eventDate, local.timezone)} ${getTimezoneAbbreviation(eventDate, city)} [${local.label}]`,
    `${formatHour(eventDate, counterpart.timezone)} ${getTimezoneAbbreviation(eventDate, counterpartCity)} [${counterpart.label}]`,
  ];

  return {
    city,
    timezone: local.timezone,
    lineup,
    emptySlots: lineup.filter((entry) => !entry.djName).map((entry) => entry.hour),
    timezoneLines,
    ordinalDay: getOrdinalDay(eventDate.getDate()),
  };
}
