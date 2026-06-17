import fs from "node:fs";
import path from "node:path";
import { Readable } from "stream";
import { google } from "googleapis";
import { getGoogleAccessToken, getGoogleOAuthClient } from "./google-calendar";
import { getGoogleDriveOAuthClient } from "./google-drive-oauth";
import { getSystemUserId } from "./user-context";

const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";
const ROOT_FOLDER_NAME = "Black Room Radio Templates";

export interface DriveUploadResult {
  fileId: string;
  webViewLink: string | null;
  webContentLink: string | null;
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function isDrivePermissionError(error: any): boolean {
  const status = error?.code || error?.response?.status;
  const message = String(error?.message || error?.response?.data?.error_description || "");
  return status === 401 || status === 403 || /insufficient|permission|scope|unauthorized/i.test(message);
}

async function getDriveClient(userId: string) {
  if (
    process.env.GOOGLE_DRIVE_REFRESH_TOKEN ||
    process.env.GOOGLE_REFRESH_TOKEN ||
    ((process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID) &&
      (process.env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET))
  ) {
    return google.drive({ version: "v3", auth: await getGoogleDriveOAuthClient(userId) });
  }

  const accessToken = await getGoogleAccessToken();
  return google.drive({ version: "v3", auth: getGoogleOAuthClient(accessToken) });
}

async function findFolder(drive: any, name: string, parentId: string): Promise<string | null> {
  const query = [
    `mimeType = '${DRIVE_FOLDER_MIME}'`,
    `name = '${escapeDriveQueryValue(name)}'`,
    `'${escapeDriveQueryValue(parentId)}' in parents`,
    "trashed = false",
  ].join(" and ");

  const response = await drive.files.list({
    q: query,
    fields: "files(id, name)",
    spaces: "drive",
    pageSize: 1,
  });

  return response.data.files?.[0]?.id || null;
}

async function createFolder(drive: any, name: string, parentId: string): Promise<string> {
  const response = await drive.files.create({
    requestBody: {
      name,
      mimeType: DRIVE_FOLDER_MIME,
      parents: [parentId],
    },
    fields: "id",
  });

  if (!response.data.id) {
    throw new Error(`Google Drive did not return an id for folder ${name}`);
  }

  return response.data.id;
}

async function findOrCreateFolder(drive: any, name: string, parentId: string): Promise<string> {
  return (await findFolder(drive, name, parentId)) || createFolder(drive, name, parentId);
}

export async function ensureDriveFolderPath(folderNames: string[], userId = getSystemUserId()): Promise<string> {
  try {
    const drive = await getDriveClient(userId);
    let parentId = "root";
    for (const folderName of folderNames) {
      const cleanName = folderName.trim();
      if (!cleanName) continue;
      parentId = await findOrCreateFolder(drive, cleanName, parentId);
    }
    return parentId;
  } catch (error: any) {
    if (isDrivePermissionError(error)) {
      throw new Error("Google Drive permission is missing.");
    }
    throw error;
  }
}

export async function ensureRadioDriveFolder(dateFolderName: string, userId = getSystemUserId()): Promise<string> {
  try {
    const drive = await getDriveClient(userId);
    const configuredRootId = process.env.GOOGLE_DRIVE_RADIO_FOLDER_ID;
    const rootId = configuredRootId || (await findOrCreateFolder(drive, ROOT_FOLDER_NAME, "root"));
    return findOrCreateFolder(drive, dateFolderName, rootId);
  } catch (error: any) {
    if (isDrivePermissionError(error)) {
      throw new Error("Google Drive permission is missing.");
    }
    throw error;
  }
}

export async function ensureDriveFolderAtRoot(folderName: string, userId = getSystemUserId()): Promise<string> {
  try {
    const drive = await getDriveClient(userId);
    return findOrCreateFolder(drive, folderName, "root");
  } catch (error: any) {
    if (isDrivePermissionError(error)) {
      throw new Error("Google Drive permission is missing.");
    }
    throw error;
  }
}

async function findFileInFolder(drive: any, filename: string, folderId: string): Promise<string | null> {
  const query = [
    `name = '${escapeDriveQueryValue(filename)}'`,
    `'${escapeDriveQueryValue(folderId)}' in parents`,
    "trashed = false",
  ].join(" and ");

  const response = await drive.files.list({
    q: query,
    fields: "files(id, name)",
    spaces: "drive",
    pageSize: 1,
  });

  return response.data.files?.[0]?.id || null;
}

export async function uploadLocalFileToDriveFolder(params: {
  filePath: string;
  folderId: string;
  mimeType?: string;
  userId?: string;
}): Promise<DriveUploadResult> {
  try {
    const drive = await getDriveClient(params.userId || getSystemUserId());
    const filename = path.basename(params.filePath);
    const existingFileId = await findFileInFolder(drive, filename, params.folderId);
    const media = {
      mimeType: params.mimeType || "application/octet-stream",
      body: Readable.from(fs.readFileSync(params.filePath)),
    };

    const response = existingFileId
      ? await drive.files.update({
          fileId: existingFileId,
          media,
          requestBody: { name: filename },
          fields: "id, webViewLink, webContentLink",
        })
      : await drive.files.create({
          requestBody: {
            name: filename,
            parents: [params.folderId],
          },
          media,
          fields: "id, webViewLink, webContentLink",
        });

    if (!response.data.id) {
      throw new Error(`Google Drive did not return an id for ${filename}`);
    }

    return {
      fileId: response.data.id,
      webViewLink: response.data.webViewLink || null,
      webContentLink: response.data.webContentLink || null,
    };
  } catch (error: any) {
    if (isDrivePermissionError(error)) {
      throw new Error("Google Drive permission is missing.");
    }
    throw error;
  }
}

export async function uploadRadioTemplatePng(params: {
  buffer: Buffer;
  filename: string;
  folderId: string;
  existingFileId?: string | null;
  userId?: string;
}): Promise<DriveUploadResult> {
  try {
    const drive = await getDriveClient(params.userId || getSystemUserId());
    const media = {
      mimeType: "image/png",
      body: Readable.from(params.buffer),
    };

    const response = params.existingFileId
      ? await drive.files.update({
          fileId: params.existingFileId,
          media,
          requestBody: { name: params.filename },
          fields: "id, webViewLink, webContentLink",
        })
      : await drive.files.create({
          requestBody: {
            name: params.filename,
            parents: [params.folderId],
          },
          media,
          fields: "id, webViewLink, webContentLink",
        });

    if (!response.data.id) {
      throw new Error(`Google Drive did not return an id for ${params.filename}`);
    }

    return {
      fileId: response.data.id,
      webViewLink: response.data.webViewLink || null,
      webContentLink: response.data.webContentLink || null,
    };
  } catch (error: any) {
    if (isDrivePermissionError(error)) {
      throw new Error("Google Drive permission is missing.");
    }
    throw error;
  }
}
