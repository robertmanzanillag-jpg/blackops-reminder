type JsonRecord = Record<string, any>;

export interface BlackRoomLinkInput {
  title: string;
  subtitle?: string | null;
  url: string;
  icon?: string | null;
  display_order?: number | null;
  builderStyle?: string | null;
  builderColor?: string | null;
}

export interface BlackRoomLinkTarget {
  id?: string | number | null;
  title?: string | null;
  url?: string | null;
}

export interface BlackRoomLinkUpdateInput extends BlackRoomLinkInput {
  matchId?: string | number | null;
  matchTitle?: string | null;
  matchUrl?: string | null;
}

export interface BlackRoomLinkDeactivateInput extends BlackRoomLinkTarget {
  reason?: string | null;
}

const DEFAULT_BLACKROOM_BASE_URL = "https://blackroomus.com";

function getBlackRoomBaseUrl(): string {
  return (process.env.BLACKROOM_ADMIN_BASE_URL || DEFAULT_BLACKROOM_BASE_URL).replace(/\/$/, "");
}

function getBlackRoomHeaders(hasBody: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (hasBody) headers["Content-Type"] = "application/json";
  if (process.env.BLACKROOM_ADMIN_COOKIE) headers.Cookie = process.env.BLACKROOM_ADMIN_COOKIE;
  if (process.env.BLACKROOM_ADMIN_BEARER_TOKEN) {
    headers.Authorization = `Bearer ${process.env.BLACKROOM_ADMIN_BEARER_TOKEN}`;
  }
  if (process.env.BLACKROOM_ADMIN_API_KEY) {
    headers["X-API-Key"] = process.env.BLACKROOM_ADMIN_API_KEY;
  }

  return headers;
}

async function blackRoomAdminRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const hasBody = init.body !== undefined;
  const response = await fetch(`${getBlackRoomBaseUrl()}${path}`, {
    ...init,
    headers: {
      ...getBlackRoomHeaders(hasBody),
      ...(init.headers || {}),
    },
  });

  const text = await response.text();
  const data = text ? safeJsonParse(text) : null;

  if (!response.ok) {
    const message = typeof data === "object" && data && "error" in data
      ? String((data as JsonRecord).error)
      : text.slice(0, 500);
    throw new Error(`Black Room admin request failed (${response.status}). ${message}`.trim());
  }

  return data as T;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function normalizeMatch(value?: string | number | null): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeIcon(icon?: string | null): string {
  const value = normalizeMatch(icon).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const aliases: Record<string, string> = {
    bag: "shopping-bag",
    merch: "shopping-bag",
    shop: "shopping-bag",
    shopping: "shopping-bag",
    ticket: "ticket",
    tickets: "ticket",
    event: "ticket",
    events: "ticket",
    calendar: "calendar",
    instagram: "instagram",
    ig: "instagram",
    tiktok: "tiktok",
    youtube: "youtube",
    music: "music",
    email: "envelope",
    mail: "envelope",
    link: "link",
  };

  return aliases[value] || value || "link";
}

function buildBioLinkPayload(input: BlackRoomLinkInput): JsonRecord {
  return {
    title: input.title,
    subtitle: input.subtitle || null,
    url: input.url,
    icon: normalizeIcon(input.icon),
    ...(input.display_order !== undefined && input.display_order !== null
      ? { display_order: Number(input.display_order) }
      : {}),
    is_active: true,
  };
}

function buildBioElementPayload(input: BlackRoomLinkInput): JsonRecord {
  return {
    element_type: "link",
    title: input.title,
    subtitle: input.subtitle || null,
    url: input.url,
    icon: normalizeIcon(input.icon),
    metadata: {
      style: input.builderStyle || "filled",
      color: input.builderColor || "#1a1a1a",
    },
    ...(input.display_order !== undefined && input.display_order !== null
      ? { position: Number(input.display_order) + 1 }
      : {}),
    is_active: true,
  };
}

function findMatchingItem<T extends JsonRecord>(items: T[], target: BlackRoomLinkTarget): T | null {
  const targetId = target.id !== undefined && target.id !== null ? String(target.id) : null;
  const targetTitle = normalizeMatch(target.title);
  const targetUrl = normalizeMatch(target.url);

  return items.find((item) => {
    if (targetId && String(item.id) === targetId) return true;
    if (targetUrl && normalizeMatch(item.url) === targetUrl) return true;
    if (targetTitle && normalizeMatch(item.title) === targetTitle) return true;
    return false;
  }) || null;
}

export async function listBlackRoomBioLinks(): Promise<JsonRecord[]> {
  const stats = await blackRoomAdminRequest<any>("/api/admin/link-stats", {
    method: "GET",
  });
  if (Array.isArray(stats)) return stats;
  if (Array.isArray(stats?.links)) return stats.links;

  const links = await blackRoomAdminRequest<any>("/api/admin/bio-links", {
    method: "GET",
  });
  return Array.isArray(links) ? links : links?.links || [];
}

export async function listBlackRoomBioElements(): Promise<JsonRecord[]> {
  const elements = await blackRoomAdminRequest<any>("/api/admin/bio-elements", {
    method: "GET",
  });
  return Array.isArray(elements) ? elements : elements?.elements || [];
}

export async function addBlackRoomLink(input: BlackRoomLinkInput) {
  const bioLink = await blackRoomAdminRequest<JsonRecord>("/api/admin/bio-links", {
    method: "POST",
    body: JSON.stringify(buildBioLinkPayload(input)),
  });

  const bioElement = await blackRoomAdminRequest<JsonRecord>("/api/admin/bio-elements", {
    method: "POST",
    body: JSON.stringify(buildBioElementPayload(input)),
  });

  return { bioLink, bioElement, action: "added" };
}

export async function updateBlackRoomLink(input: BlackRoomLinkUpdateInput) {
  const target = {
    id: input.matchId,
    title: input.matchTitle || input.title,
    url: input.matchUrl,
  };
  const links = await listBlackRoomBioLinks();
  const elements = await listBlackRoomBioElements();
  const existingLink = findMatchingItem(links, target);
  const existingElement = findMatchingItem(elements, target);

  if (!existingLink && !existingElement) {
    throw new Error("No matching Black Room link was found to update.");
  }

  const bioLink = existingLink
    ? await blackRoomAdminRequest<JsonRecord>(`/api/admin/bio-links/${existingLink.id}`, {
        method: "PUT",
        body: JSON.stringify(buildBioLinkPayload(input)),
      })
    : null;

  const bioElement = existingElement
    ? await blackRoomAdminRequest<JsonRecord>(`/api/admin/bio-elements/${existingElement.id}`, {
        method: "PUT",
        body: JSON.stringify({
          ...existingElement,
          ...buildBioElementPayload(input),
          id: existingElement.id,
        }),
      })
    : null;

  return { bioLink, bioElement, action: "updated" };
}

export async function deactivateBlackRoomLink(input: BlackRoomLinkDeactivateInput) {
  const links = await listBlackRoomBioLinks();
  const elements = await listBlackRoomBioElements();
  const existingLink = findMatchingItem(links, input);
  const existingElement = findMatchingItem(elements, input);

  if (!existingLink && !existingElement) {
    throw new Error("No matching Black Room link was found to deactivate.");
  }

  const bioLink = existingLink
    ? await blackRoomAdminRequest<JsonRecord>(`/api/admin/bio-links/${existingLink.id}`, {
        method: "PUT",
        body: JSON.stringify({ is_active: false }),
      })
    : null;

  const bioElement = existingElement
    ? await blackRoomAdminRequest<JsonRecord>(`/api/admin/bio-elements/${existingElement.id}`, {
        method: "PUT",
        body: JSON.stringify({ ...existingElement, is_active: false }),
      })
    : null;

  return {
    bioLink,
    bioElement,
    action: "deactivated",
    preservedData: true,
    note: "The link was deactivated instead of deleted so historical analytics remain available.",
  };
}
