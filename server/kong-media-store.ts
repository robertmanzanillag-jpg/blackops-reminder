import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const MAX_BYTES = 100_000_000;
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function boundedStorageOperation<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Error("storage_outcome_uncertain_reconcile_before_retry")), 60_000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
export interface MediaStoreDependencies {
  upload(filePath: string, folderId: string, userId: string): Promise<string>;
  publicUrl(fileId: string, userId: string): Promise<string>;
  fetch: typeof fetch;
}
export interface MediaReconciliationDependencies {
  find(input: { sha256: string; folderId: string; userId: string }): Promise<{ fileId: string } | null>;
  fetch: typeof fetch;
  downloadUrl?(fileId: string): string;
}
/** Unknown writes reconcile by exact hash filename and anonymous complete bytes.
 * No upload/publicUrl/permission mutation is reachable through this interface. */
export async function reconcileRenderedMedia(input: { sha256: string; folderId: string; userId: string;
  approvedPublicOrigins: string[]; authorizedForPublicDistribution: boolean }, deps?: MediaReconciliationDependencies) {
  if (input.authorizedForPublicDistribution !== true || !/^[a-f0-9]{64}$/.test(input.sha256)
    || !/^[A-Za-z0-9_-]{10,160}$/.test(input.folderId) || !input.userId?.trim()) return null;
  try {
    const drive = deps ? undefined : await import("./google-drive");
    const adapter: MediaReconciliationDependencies = deps || { find: drive!.findUniqueDriveHashFile, downloadUrl: drive!.buildGoogleDrivePublicDownloadUrl, fetch };
    const found = await boundedStorageOperation(adapter.find({ sha256: input.sha256, folderId: input.folderId, userId: input.userId }));
    if (!found || !/^[A-Za-z0-9_-]{10,160}$/.test(found.fileId)) return null;
    const mediaUrl = adapter.downloadUrl ? adapter.downloadUrl(found.fileId)
      : `https://drive.usercontent.google.com/download?id=${encodeURIComponent(found.fileId)}&export=download&authuser=0&confirm=t`;
    await verifyImmutableMedia(mediaUrl, input.sha256, input.approvedPublicOrigins, adapter.fetch);
    return { fileId: found.fileId, mediaUrl, sha256: input.sha256, verifiedAt: new Date().toISOString() };
  } catch { return null; }
}
/** Follows only exact operator-approved origins, without forwarding credentials.
 * The complete anonymous body must equal the rendered hash, not just be a 200 page. */
export async function verifyImmutableMedia(url: string, expectedHash: string, origins: string[], fetcher: typeof fetch = fetch) {
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw Error("invalid_media_hash");
  const signal = AbortSignal.timeout(60_000);
  let current = url;
  for (let redirects = 0; redirects <= 4; redirects++) {
    const parsed = new URL(current);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || !origins.includes(parsed.origin)
      || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[|0\.)/i.test(parsed.hostname)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(parsed.hostname)) throw Error("unapproved_media_origin");
    const response = await fetcher(current, { redirect: "manual", signal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const next = response.headers.get("location");
      if (!next) throw Error("missing_media_redirect");
      current = new URL(next, current).href;
      continue;
    }
    if (!response.ok || !response.body || !/^video\/mp4(?:;|$)/i.test(response.headers.get("content-type") || "")) {
      await response.body?.cancel(); throw Error("invalid_public_video_response");
    }
    const reader = response.body.getReader();
    const digest = createHash("sha256"); let bytes = 0;
    try {
      while (true) {
        signal.throwIfAborted();
        const part = await reader.read(); if (part.done) break;
        bytes += part.value.length;
        if (bytes > MAX_BYTES) throw Error("public_video_too_large");
        digest.update(part.value);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    if (!bytes || digest.digest("hex") !== expectedHash) throw Error("public_media_hash_mismatch");
    return { verifiedUrl: current, bytes, sha256: expectedHash };
  }
  throw Error("too_many_media_redirects");
}

async function defaultDependencies(): Promise<MediaStoreDependencies> {
  const drive = await import("./google-drive");
  return {
    upload: async (filePath, folderId, userId) => (await drive.uploadLocalFileToDriveFolder({ filePath, folderId, userId, mimeType: "video/mp4" })).fileId,
    publicUrl: (fileId, userId) => drive.ensureDriveFilePublicDownload({ fileId, userId }),
    fetch,
  };
}
/** Publishes only the rendered, authorized marketing asset to existing Drive.
 * Caller must persist the receipt in Postgres. Does not grant broader account access.
 * No storage/quota/cost assumption is made from having this adapter. */
export async function storeRenderedMedia(input: { filePath: string; sha256: string; folderId: string; userId: string;
  approvedPublicOrigins: string[]; authorizedForPublicDistribution: boolean }, deps?: MediaStoreDependencies) {
  if (input.authorizedForPublicDistribution !== true) throw Error("public_distribution_not_authorized");
  if (!input.userId || !/^[A-Za-z0-9_-]{10,160}$/.test(input.folderId)) throw Error("missing_storage_identity");
  const size = (await stat(input.filePath)).size;
  if (!size || size > MAX_BYTES) throw Error("invalid_render_size");
  const bytes = await readFile(input.filePath);
  if (bytes.length > MAX_BYTES || hash(bytes) !== input.sha256) throw Error("render_hash_mismatch");
  const directory = await mkdtemp(path.join(tmpdir(), "kong-store-"));
  try {
    const immutablePath = path.join(directory, `${input.sha256}.mp4`);
    await writeFile(immutablePath, bytes, { flag: "wx", mode: 0o600 });
    const adapter = deps || await defaultDependencies();
    // The existing Drive helper cannot cancel a timed-out write. The caller must
    // persist intent and reconcile by hash filename, never retry an unknown outcome.
    const fileId = await boundedStorageOperation(adapter.upload(immutablePath, input.folderId, input.userId));
    const publicUrl = await boundedStorageOperation(adapter.publicUrl(fileId, input.userId));
    const verified = await verifyImmutableMedia(publicUrl, input.sha256, input.approvedPublicOrigins, adapter.fetch);
    return { fileId, mediaUrl: publicUrl, ...verified, verifiedAt: new Date().toISOString() };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
