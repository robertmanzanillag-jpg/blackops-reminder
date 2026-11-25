// Uploaded media for Social Hub posts. Stored in Postgres (Replit wipes local files on redeploy)
// and served from an unguessable URL so Meta/TikTok/YouTube can pull it.
import { randomBytes } from "node:crypto";

export const MEDIA_MAX_BYTES = Number(process.env.SOCIAL_HUB_MEDIA_MAX_MB ?? 200) * 1024 * 1024;
const ALLOWED = /^(image\/(jpeg|png|webp|gif)|video\/(mp4|quicktime|webm))$/;

export interface MediaRow { id: string; contentType: string; filename: string; data: Buffer }
export interface MediaStore {
  put(row: MediaRow): Promise<void>;
  get(id: string): Promise<MediaRow | null>;
}

export function postgresMediaStore(): MediaStore {
  let conn: Promise<{ db: any; sql: any }> | undefined;
  const connect = () => (conn ||= (async () => {
    const [{ db }, { sql }] = await Promise.all([import("../db"), import("drizzle-orm")]);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS social_hub_media (id text PRIMARY KEY, content_type text NOT NULL, filename text NOT NULL, bytes integer NOT NULL, data bytea NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`);
    return { db, sql };
  })().catch((e) => { conn = undefined; throw e; }));
  return {
    async put(r) {
      const { db, sql } = await connect();
      await db.execute(sql`INSERT INTO social_hub_media (id, content_type, filename, bytes, data) VALUES (${r.id}, ${r.contentType}, ${r.filename}, ${r.data.length}, ${r.data})`);
    },
    async get(id) {
      const { db, sql } = await connect();
      const res: any = await db.execute(sql`SELECT id, content_type, filename, data FROM social_hub_media WHERE id = ${id}`);
      const row = res.rows?.[0];
      return row ? { id: row.id, contentType: row.content_type, filename: row.filename, data: Buffer.from(row.data) } : null;
    },
  };
}

export function memoryMediaStore(): MediaStore {
  const m = new Map<string, MediaRow>();
  return { async put(r) { m.set(r.id, r); }, async get(id) { return m.get(id) ?? null; } };
}

export class MediaRejected extends Error {}

export async function saveUpload(store: MediaStore, data: Buffer, contentType: string, filename: string): Promise<{ id: string; kind: "image" | "video" }> {
  const type = (contentType || "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED.test(type)) throw new MediaRejected("Formato no permitido. Usa JPG, PNG, WEBP, GIF, MP4, MOV o WEBM.");
  if (!data.length) throw new MediaRejected("El archivo está vacío.");
  if (data.length > MEDIA_MAX_BYTES) throw new MediaRejected(`El archivo pasa de ${Math.round(MEDIA_MAX_BYTES / 1024 / 1024)} MB.`);
  const ext = type.split("/")[1].replace("quicktime", "mov").replace("jpeg", "jpg");
  const id = `${randomBytes(18).toString("base64url")}.${ext}`;
  await store.put({ id, contentType: type, filename: filename.slice(0, 200) || id, data });
  return { id, kind: type.startsWith("video/") ? "video" : "image" };
}

/** Returns status/headers/body for a (possibly ranged) media request. */
export function serveMedia(row: MediaRow, range?: string): { status: number; headers: Record<string, string>; body: Buffer } {
  const total = row.data.length;
  const base = { "Content-Type": row.contentType, "Accept-Ranges": "bytes", "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff" };
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : total - Number(m[2]);
    let end = m[1] && m[2] ? Number(m[2]) : total - 1;
    start = Math.max(0, start); end = Math.min(total - 1, end);
    if (start > end) return { status: 416, headers: { ...base, "Content-Range": `bytes */${total}` }, body: Buffer.alloc(0) };
    return { status: 206, headers: { ...base, "Content-Range": `bytes ${start}-${end}/${total}`, "Content-Length": String(end - start + 1) }, body: row.data.subarray(start, end + 1) };
  }
  return { status: 200, headers: { ...base, "Content-Length": String(total) }, body: row.data };
}
