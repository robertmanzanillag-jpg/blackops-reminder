export const BLACKROOM_METRICOOL_BLOG_ID = 6585226;
export const BLACKROOM_TIMEZONE = "America/New_York";

export interface BlackRoomMetricoolScheduleInput {
  caption: string;
  publicationDateTime: string;
  mediaUrl: string;
  blogId?: number;
  timezone?: string;
}

export interface BlackRoomMetricoolReceipt {
  metricoolId: string;
  publicationDateTime: string;
  caption: string;
  verified: true;
}

type FetchLike = typeof fetch;

function requiredEnv(env: NodeJS.ProcessEnv, name: "METRICOOL_USER_TOKEN" | "METRICOOL_USER_ID"): string {
  const value = String(env[name] || "").trim();
  if (!value || /replace|example|your[-_ ]?token/i.test(value)) throw new Error(`${name} is not configured`);
  return value;
}

function objects(value: unknown): Record<string, any>[] {
  const found: Record<string, any>[] = [];
  const visit = (candidate: unknown) => {
    if (Array.isArray(candidate)) return candidate.forEach(visit);
    if (!candidate || typeof candidate !== "object") return;
    const record = candidate as Record<string, any>;
    found.push(record);
    Object.values(record).forEach(visit);
  };
  visit(value);
  return found;
}

export function extractMetricoolMediaId(value: unknown): string {
  if (typeof value === "string") {
    const normalizedUrl = value.trim();
    try {
      const parsed = new URL(normalizedUrl);
      if (["http:", "https:"].includes(parsed.protocol)) return normalizedUrl;
    } catch { /* handled below */ }
  }
  for (const record of objects(value)) {
    const mediaId = record.mediaId ?? record.media_id;
    if (typeof mediaId === "string" || typeof mediaId === "number") return String(mediaId);
  }
  const data = value && typeof value === "object" ? (value as Record<string, any>).data : null;
  if (data && !Array.isArray(data) && (typeof data.id === "string" || typeof data.id === "number")) return String(data.id);
  throw new Error("Metricool did not return a mediaId");
}

async function metricoolMediaId(response: Response): Promise<string> {
  const raw = (await response.text()).trim();
  if (!response.ok) {
    const detail = raw.replace(/(token|authorization|x-mc-auth)["'\s:=]+[^,"'\s}]+/gi, "$1=[redacted]").replace(/\s+/g, " ").slice(0, 500);
    throw new Error(`Metricool media normalization failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  if (!raw) throw new Error("Metricool media normalization returned an empty response");
  if (/^application\/json\b/i.test(response.headers.get("content-type") || "") || /^[\[{]/.test(raw)) {
    try { return extractMetricoolMediaId(JSON.parse(raw)); }
    catch (error) {
      if (error instanceof SyntaxError) throw new Error("Metricool media normalization returned invalid JSON");
      throw error;
    }
  }
  return extractMetricoolMediaId(raw);
}

export function buildMetricoolTikTokPayload(input: BlackRoomMetricoolScheduleInput, mediaId: string) {
  const timezone = input.timezone || BLACKROOM_TIMEZONE;
  return {
    autoPublish: true,
    descendants: [],
    draft: false,
    firstCommentText: "",
    hasNotReadNotes: false,
    media: { mediaId },
    mediaAltText: [],
    providers: [{ network: "tiktok" }],
    publicationDate: { dateTime: input.publicationDateTime, timezone },
    shortener: false,
    smartLinkData: { ids: [] },
    text: input.caption,
    tiktokData: {
      disableComment: false,
      disableDuet: false,
      disableStitch: false,
      privacyOption: "PUBLIC_TO_EVERYONE",
      commercialContentThirdParty: false,
      commercialContentOwnBrand: false,
      title: "",
      autoAddMusic: false,
      photoCoverIndex: 0,
    },
  };
}

export function findVerifiedMetricoolPost(value: unknown, caption: string, publicationDateTime: string): Record<string, any> | null {
  return objects(value).find((record) => {
    const text = String(record.text ?? record.caption ?? record.content ?? "");
    const publication = record.publicationDate;
    const dateTime = typeof publication === "string"
      ? publication
      : String(publication?.dateTime ?? record.publicationDateTime ?? record.date ?? "");
    return text === caption && dateTime.startsWith(publicationDateTime);
  }) || null;
}

async function metricoolJson(response: Response, operation: string): Promise<any> {
  const raw = await response.text();
  if (!response.ok) {
    const detail = raw.replace(/(token|authorization|x-mc-auth)["'\s:=]+[^,"'\s}]+/gi, "$1=[redacted]").replace(/\s+/g, " ").trim().slice(0, 500);
    throw new Error(`Metricool ${operation} failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  const value = raw ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : null;
  if (value == null) throw new Error(`Metricool ${operation} returned no JSON`);
  return value;
}

export async function scheduleBlackRoomMetricoolPost(
  input: BlackRoomMetricoolScheduleInput,
  options: { env?: NodeJS.ProcessEnv; fetch?: FetchLike } = {},
): Promise<BlackRoomMetricoolReceipt> {
  const env = options.env || process.env;
  const fetcher = options.fetch || fetch;
  const token = requiredEnv(env, "METRICOOL_USER_TOKEN");
  const userId = requiredEnv(env, "METRICOOL_USER_ID");
  const blogId = input.blogId || Number(env.BLACKROOM_METRICOOL_BLOG_ID || BLACKROOM_METRICOOL_BLOG_ID);
  if (!Number.isInteger(blogId) || blogId <= 0) throw new Error("Invalid Metricool blogId");
  if (!input.caption.trim() || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(input.publicationDateTime)) {
    throw new Error("Invalid Metricool caption or publication date");
  }
  // Match Metricool's official MCP client exactly. Its scheduler route uses the
  // MCP integration source and explicitly requests JSON in both directions.
  const headers = { "X-Mc-Auth": token, "content-type": "application/json", accept: "application/json" };
  // The normalize endpoint can return a plain URL. Advertising JSON-only in
  // Accept makes Metricool answer 500 "No acceptable representation".
  const normalizeHeaders = { "X-Mc-Auth": token, accept: "*/*" };
  const date = input.publicationDateTime.slice(0, 10);
  const timezone = encodeURIComponent(input.timezone || BLACKROOM_TIMEZONE);
  const schedulerUrl = `https://app.metricool.com/api/v2/scheduler/posts?blogId=${blogId}&userId=${encodeURIComponent(userId)}&integrationSource=MCP`;
  const verifyUrl = `${schedulerUrl}&start=${date}T00%3A00%3A00&end=${date}T23%3A59%3A59&timezone=${timezone}&extendedRange=false`;
  const existing = await metricoolJson(await fetcher(verifyUrl, { headers, signal: AbortSignal.timeout(60_000) }), "duplicate preflight");
  const existingMatch = findVerifiedMetricoolPost(existing, input.caption, input.publicationDateTime);
  if (existingMatch) {
    const existingId = existingMatch.id ?? existingMatch.uuid;
    if (existingId == null || String(existingId).trim() === "") throw new Error("Existing Metricool post has no identifier");
    return { metricoolId: String(existingId), publicationDateTime: input.publicationDateTime, caption: input.caption, verified: true };
  }
  const normalizeUrl = `https://app.metricool.com/api/actions/normalize/image/url?url=${encodeURIComponent(input.mediaUrl)}`;
  const mediaId = await metricoolMediaId(await fetcher(normalizeUrl, { headers: normalizeHeaders, signal: AbortSignal.timeout(120_000) }));
  const payload = buildMetricoolTikTokPayload(input, mediaId);
  const scheduled = await metricoolJson(await fetcher(schedulerUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120_000),
  }), "post scheduling");

  const verification = await metricoolJson(await fetcher(verifyUrl, { headers, signal: AbortSignal.timeout(60_000) }), "post verification");
  const matched = findVerifiedMetricoolPost(verification, input.caption, input.publicationDateTime);
  if (!matched) throw new Error("Metricool did not return unequivocal scheduled-post evidence");
  const id = matched.id ?? matched.uuid ?? scheduled?.id ?? scheduled?.uuid;
  if (id == null || String(id).trim() === "") throw new Error("Metricool scheduled post has no identifier");
  return { metricoolId: String(id), publicationDateTime: input.publicationDateTime, caption: input.caption, verified: true };
}
