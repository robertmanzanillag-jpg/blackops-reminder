import { createHash } from "node:crypto";
import { isIP } from "node:net";

// Verified 2026-10-28: https://www.pexels.com/api/documentation/
export const PEXELS_VIDEO_SEARCH = "https://api.pexels.com/v1/videos/search";
export const PEXELS_LICENSE = "https://www.pexels.com/license/";
export const NIGHTLIFE_QUERIES = ["nightclub dance floor", "dj party", "concert crowd", "nightlife city", "yacht sunset", "luxury car night"] as const;
const PEXELS_MEDIA_ORIGINS = ["https://videos.pexels.com", "https://player.vimeo.com", "https://images.pexels.com"];
export interface OnlineFootage {
  id: string; provider: "pexels" | "owner"; sourceUrl: string; mediaUrl: string;
  author: string; discoveredAt: string; rightsEvidence: string; licenseUrl?: string;
  rightsExpiresAt: string; allowedMediaOrigins: string[];
  attribution: string; audioPolicy: "remove_source_audio"; qaStatus: "pending";
  durationSeconds?: number; width?: number; height?: number;
}
type Fetcher = typeof fetch;
function text(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function httpsUrl(value: unknown): URL {
  const url = new URL(text(value));
  if (url.protocol !== "https:" || url.username || url.password || url.port || isIP(url.hostname)
    || url.hostname.includes(":") || !url.hostname.includes(".") || /\.(localhost|local|internal|test|invalid)$/i.test(url.hostname)) throw new Error("unsafe_source_url");
  return url;
}
export function approvedFootageUrl(value: string, origins: readonly string[]): string {
  const url = httpsUrl(value);
  if (!origins.some(origin => httpsUrl(origin).origin === origin && origin === url.origin)) throw new Error("unapproved_footage_origin");
  return url.href;
}
function futureExpiry(value: unknown, now: Date): string {
  const expiry = text(value);
  if (!expiry || !Number.isFinite(Date.parse(expiry)) || Date.parse(expiry) <= +now) throw new Error("source_rights_expired_or_missing");
  return new Date(expiry).toISOString();
}
async function boundedResponse(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.ok || !response.body) throw new Error(`source_http_${response.status}`);
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
    await response.body.cancel(); throw new Error("source_too_large");
  }
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > maxBytes) throw new Error("source_too_large");
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  finally { reader.releaseLock(); }
  if (!size) throw new Error("empty_source");
  return Buffer.concat(chunks);
}

/** One bounded request per call; caller persists cursor and seen IDs. No key is read implicitly. */
export async function discoverPexelsFootage(input: {
  apiKey?: string; cursor?: number; seenIds?: readonly string[]; fetcher?: Fetcher; now?: Date;
}): Promise<{ candidates: OnlineFootage[]; nextCursor: number; status: "ok" | "not_configured"; query: string }> {
  const cursor = Number.isSafeInteger(input.cursor) && input.cursor! >= 0 ? input.cursor! : 0;
  const query = NIGHTLIFE_QUERIES[cursor % NIGHTLIFE_QUERIES.length];
  if (!input.apiKey?.trim()) return { candidates: [], nextCursor: cursor, status: "not_configured", query };
  const now = input.now || new Date(); const fetcher = input.fetcher || fetch;
  const url = new URL(PEXELS_VIDEO_SEARCH);
  url.search = new URLSearchParams({ query, orientation: "portrait", per_page: "20", page: String(1 + Math.floor(cursor / NIGHTLIFE_QUERIES.length)) }).toString();
  const response = await fetcher(url.href, { headers: { Authorization: input.apiKey.trim() }, redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) { await response.body?.cancel(); throw new Error("invalid_source_json_type"); }
  const body = JSON.parse((await boundedResponse(response, 2_000_000)).toString("utf8"));
  if (!Array.isArray(body.videos)) throw new Error("invalid_pexels_response");
  const seen = new Set(input.seenIds || []); const candidates: OnlineFootage[] = [];
  for (const video of body.videos.slice(0, 20)) {
    if (!Number.isSafeInteger(video?.id) || video.id < 1) continue;
    const id = `pexels-${video.id}`; if (seen.has(id)) continue;
    try {
      const sourceUrl = approvedFootageUrl(video.url, ["https://www.pexels.com"]);
      const author = text(video.user?.name); if (!author) continue;
      if (!Number.isFinite(video.duration) || video.duration < 3 || video.duration > 300) continue;
      const files = (Array.isArray(video.video_files) ? video.video_files : []).filter((file: any) =>
        file.file_type === "video/mp4" && Number.isInteger(file.width) && Number.isInteger(file.height)
        && file.width >= 540 && file.width <= 1080 && file.height > file.width && file.height <= 1920);
      files.sort((a: any, b: any) => b.width - a.width);
      const file = files.find((f: any) => { try { approvedFootageUrl(f.link, PEXELS_MEDIA_ORIGINS); return true; } catch { return false; } });
      if (!file) continue;
      candidates.push({ id, provider: "pexels", sourceUrl, mediaUrl: approvedFootageUrl(file.link, PEXELS_MEDIA_ORIGINS),
        author, discoveredAt: now.toISOString(), rightsEvidence: `${sourceUrl} | ${PEXELS_LICENSE}`,
        licenseUrl: PEXELS_LICENSE, rightsExpiresAt: new Date(+now + 14 * 86400_000).toISOString(),
        allowedMediaOrigins: [...PEXELS_MEDIA_ORIGINS], attribution: `Video by ${author} on Pexels: ${sourceUrl}`,
        audioPolicy: "remove_source_audio", qaStatus: "pending", durationSeconds: video.duration, width: file.width, height: file.height });
      seen.add(id);
    } catch { /* Untrusted provider record is ineligible, never a publication-ready asset. */ }
  }
  return { candidates, nextCursor: cursor + 1, status: "ok", query };
}

/** trustedMediaOrigins is deployment-owned, never taken from the incoming manifest. */
export function intakeOwnerFootage(manifest: unknown, trustedMediaOrigins: readonly string[], now = new Date()): OnlineFootage[] {
  if (!Array.isArray(manifest) || manifest.length > 500) throw new Error("invalid_owner_manifest");
  const seen = new Set<string>();
  return manifest.map(row => {
    if (!row || typeof row !== "object" || !/^[a-zA-Z0-9_-]{1,100}$/.test(row.id)
      || row.authorizedByOwner !== true || !text(row.author) || text(row.rightsEvidence).length < 20
      || row.commercialPromotionAllowed !== true) throw new Error("missing_owner_rights_evidence");
    const id = `owner-${row.id}`; if (seen.has(id)) throw new Error("duplicate_owner_source"); seen.add(id);
    return { id, provider: "owner", sourceUrl: httpsUrl(row.sourceUrl).href,
      mediaUrl: approvedFootageUrl(row.mediaUrl, trustedMediaOrigins), author: text(row.author),
      discoveredAt: now.toISOString(), rightsEvidence: text(row.rightsEvidence),
      rightsExpiresAt: futureExpiry(row.rightsExpiresAt, now), allowedMediaOrigins: [...trustedMediaOrigins],
      attribution: text(row.attribution), audioPolicy: "remove_source_audio", qaStatus: "pending" };
  });
}

/** Download to cloud memory only. Redirects rejected; no API credentials sent to media hosts.
 * Approved origins must be trusted public provider/CDN origins controlled by deployment configuration.
 * Downstream renderer must remove source audio and independently QA people/brand context and output.
 */
export async function downloadFootage(candidate: OnlineFootage, options: { fetcher?: Fetcher; maxBytes?: number; now?: Date } = {}) {
  futureExpiry(candidate.rightsExpiresAt, options.now || new Date());
  const maxBytes = options.maxBytes ?? 80_000_000;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 100_000_000) throw new Error("invalid_media_size_limit");
  const url = approvedFootageUrl(candidate.mediaUrl, candidate.allowedMediaOrigins);
  const response = await (options.fetcher || fetch)(url, { redirect: "error", signal: AbortSignal.timeout(60_000) });
  if (response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "video/mp4") {
    await response.body?.cancel(); throw new Error("invalid_footage_content_type");
  }
  const bytes = await boundedResponse(response, maxBytes);
  // Basic MP4 container signature is not a substitute for ffprobe/decode verification.
  if (bytes.length < 12 || bytes.toString("ascii", 4, 8) !== "ftyp") throw new Error("invalid_mp4_signature");
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex"), sizeBytes: bytes.length, qaStatus: "pending" as const };
}
