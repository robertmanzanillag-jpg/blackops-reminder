// Black Room "Sets para clips" Drive folder, exposed to the cloud clip worker through the agent API.
// Every call re-checks that the file sits directly in the configured folder, so the token can't reach other Drive files.
import type { Response } from "express";
import { getDriveClient } from "../google-drive";
import { getSystemUserId } from "../user-context";

export const DEFAULT_SETS_FOLDER_ID = "1O8IqLFcD5RKRuOlH9CSXOx839mdXcIaM";
export const setsFolderId = () => (process.env.BLACKROOM_SETS_DRIVE_FOLDER_ID || DEFAULT_SETS_FOLDER_ID).trim();
const ID = /^[A-Za-z0-9_-]{10,128}$/;

export interface SetVideo { id: string; name: string; size: number | null; createdTime: string | null }

async function drive() { return getDriveClient(getSystemUserId()); }

export async function listSetVideos(): Promise<SetVideo[]> {
  const d: any = await drive();
  const out: SetVideo[] = [];
  let pageToken: string | undefined;
  do {
    const r = await d.files.list({
      q: `'${setsFolderId()}' in parents and trashed = false and mimeType contains 'video/'`,
      fields: "nextPageToken, files(id, name, size, createdTime)", pageSize: 200, pageToken,
      supportsAllDrives: true, includeItemsFromAllDrives: true,
    });
    for (const f of r.data.files ?? []) out.push({ id: f.id, name: f.name, size: f.size ? Number(f.size) : null, createdTime: f.createdTime ?? null });
    pageToken = r.data.nextPageToken || undefined;
  } while (pageToken);
  return out;
}

async function assertInFolder(d: any, id: string) {
  if (!ID.test(id)) throw new Error("ID de Drive inválido.");
  const m = await d.files.get({ fileId: id, fields: "id, name, size, mimeType, parents, trashed", supportsAllDrives: true });
  if (!(m.data.parents ?? []).includes(setsFolderId()) || !String(m.data.mimeType || "").startsWith("video/")) throw new Error("El archivo no está en la carpeta de sets.");
  return m.data;
}

export async function streamSetVideo(id: string, res: Response): Promise<void> {
  const d: any = await drive();
  const meta = await assertInFolder(d, id);
  const r = await d.files.get({ fileId: id, alt: "media", supportsAllDrives: true }, { responseType: "stream" });
  res.setHeader("Content-Type", meta.mimeType || "video/mp4");
  if (meta.size) res.setHeader("Content-Length", String(meta.size));
  await new Promise<void>((resolve, reject) => { r.data.on("error", reject); res.on("close", resolve); r.data.pipe(res); });
}

/** Moves the set to Drive trash (recoverable for 30 days). */
export async function trashSetVideo(id: string): Promise<{ id: string; trashed: true }> {
  const d: any = await drive();
  await assertInFolder(d, id);
  await d.files.update({ fileId: id, requestBody: { trashed: true }, supportsAllDrives: true });
  return { id, trashed: true };
}
