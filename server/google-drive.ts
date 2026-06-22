import fs from "node:fs";
import path from "node:path";
import { Readable } from "stream";
import { getGoogleAccessToken, getGoogleOAuthClient, hasReplitGoogleConnectorEnv } from "./google-calendar";
import { getGoogleDriveOAuthClient, getGoogleDriveRefreshTokenFromEnv, hasGoogleDriveOAuthClientConfig } from "./google-drive-oauth";
import { getSystemUserId } from "./user-context";
import { hasRealValue } from "./ceo-doctor-cli";

const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";
export const DRIVE_APP_ROOT_FOLDER = "Robert A";
export const DRIVE_RADIO_FLYERS_FOLDER = "Flyers de la radio";
export const DRIVE_BLACK_ROOM_VIDEOS_FOLDER = "Videos de Black Room";
export const DRIVE_KONG_VIDEOS_FOLDER = "Videos de Kong";

export interface DriveUploadResult {
  fileId: string;
  webViewLink: string | null;
  webContentLink: string | null;
}

export interface DriveFolderSetupResult {
  rootFolderId: string;
  folders: Array<{
    label: string;
    path: string[];
    folderId: string;
  }>;
}

async function getGoogleApis() {
  return (await import("googleapis")).google;
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function isDrivePermissionError(error: any): boolean {
  const status = error?.code || error?.response?.status;
  const message = String(error?.message || error?.response?.data?.error_description || "");
  return status === 401 || status === 403 || /insufficient|permission|scope|unauthorized/i.test(message);
}

function readOptionalRealDriveFolderId(envName: string): string | null {
  const value = process.env[envName];
  if (!value) return null;
  if (hasRealValue(value)) return value;
  throw new Error(`${envName} must be a real Google Drive folder id, not a placeholder.`);
}

export function getConfiguredClippersDriveRootFolderId(): string | null {
  return (
    readOptionalRealDriveFolderId("GOOGLE_DRIVE_CLIPPERS_ROOT_FOLDER_ID") ||
    readOptionalRealDriveFolderId("CLIPPERS_DRIVE_ROOT_FOLDER_ID")
  );
}

async function getDriveClient(userId: string) {
  const google = await getGoogleApis();
  if (
    getGoogleDriveRefreshTokenFromEnv() ||
    hasGoogleDriveOAuthClientConfig()
  ) {
    return google.drive({ version: "v3", auth: await getGoogleDriveOAuthClient(userId) });
  }

  if (!hasReplitGoogleConnectorEnv()) {
    throw new Error("Google Drive is not connected. Open /api/google-drive/auth to connect Drive before asking the agent to save videos there.");
  }

  const accessToken = await getGoogleAccessToken();
  return google.drive({ version: "v3", auth: await getGoogleOAuthClient(accessToken) });
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

export async function findDriveFolderPath(folderNames: string[], userId = getSystemUserId()): Promise<string | null> {
  return findDriveFolderPathUnderParent(folderNames, "root", userId);
}

export async function findDriveFolderPathUnderParent(folderNames: string[], parentFolderId: string, userId = getSystemUserId()): Promise<string | null> {
  try {
    const drive = await getDriveClient(userId);
    let parentId = parentFolderId.trim() || "root";
    for (const folderName of folderNames) {
      const cleanName = folderName.trim();
      if (!cleanName) continue;
      const folderId = await findFolder(drive, cleanName, parentId);
      if (!folderId) return null;
      parentId = folderId;
    }
    return parentId;
  } catch (error: any) {
    if (isDrivePermissionError(error)) {
      throw new Error("Google Drive permission is missing.");
    }
    throw error;
  }
}

export async function searchDriveFoldersByName(folderName: string, userId = getSystemUserId()): Promise<Array<{ id: string; name: string; webViewLink: string | null }>> {
  try {
    const cleanName = folderName.trim();
    if (!cleanName) return [];
    const drive = await getDriveClient(userId);
    const query = [
      `mimeType = '${DRIVE_FOLDER_MIME}'`,
      `name = '${escapeDriveQueryValue(cleanName)}'`,
      "trashed = false",
    ].join(" and ");

    const response = await drive.files.list({
      q: query,
      fields: "files(id, name, webViewLink)",
      spaces: "drive",
      pageSize: 10,
    });

    return (response.data.files || [])
      .filter((file: any) => file.id && file.name)
      .map((file: any) => ({
        id: file.id,
        name: file.name,
        webViewLink: file.webViewLink || null,
      }));
  } catch (error: any) {
    if (isDrivePermissionError(error)) {
      throw new Error("Google Drive permission is missing.");
    }
    throw error;
  }
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
  return ensureDriveFolderPathUnderParent(folderNames, "root", userId);
}

export async function ensureDriveFolderPathUnderParent(folderNames: string[], parentFolderId: string, userId = getSystemUserId()): Promise<string> {
  try {
    const drive = await getDriveClient(userId);
    let parentId = parentFolderId.trim() || "root";
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

export async function ensureAppDriveFolderPath(folderNames: string[], userId = getSystemUserId()): Promise<string> {
  return ensureDriveFolderPath([DRIVE_APP_ROOT_FOLDER, ...folderNames], userId);
}

export async function ensureAppDriveStructure(userId = getSystemUserId()): Promise<DriveFolderSetupResult> {
  const rootFolderId = await ensureDriveFolderPath([DRIVE_APP_ROOT_FOLDER], userId);
  const folderSpecs = [
    { label: "Flyers de la radio", path: [DRIVE_RADIO_FLYERS_FOLDER] },
    { label: "Videos de Black Room", path: [DRIVE_BLACK_ROOM_VIDEOS_FOLDER] },
    { label: "Videos de Black Room / Instagram", path: [DRIVE_BLACK_ROOM_VIDEOS_FOLDER, "Instagram"] },
    { label: "Videos de Black Room / TikTok", path: [DRIVE_BLACK_ROOM_VIDEOS_FOLDER, "TikTok"] },
    { label: "Videos de Kong", path: [DRIVE_KONG_VIDEOS_FOLDER] },
  ];

  const folders = [];
  for (const spec of folderSpecs) {
    folders.push({
      label: spec.label,
      path: [DRIVE_APP_ROOT_FOLDER, ...spec.path],
      folderId: await ensureAppDriveFolderPath(spec.path, userId),
    });
  }

  return { rootFolderId, folders };
}

export async function ensureRadioDriveFolder(dateFolderName: string, userId = getSystemUserId()): Promise<string> {
  try {
    const drive = await getDriveClient(userId);
    const configuredRootId = readOptionalRealDriveFolderId("GOOGLE_DRIVE_RADIO_FOLDER_ID");
    const appRootId = configuredRootId || (await findOrCreateFolder(drive, DRIVE_APP_ROOT_FOLDER, "root"));
    const flyersRootId = await findOrCreateFolder(drive, DRIVE_RADIO_FLYERS_FOLDER, appRootId);
    return findOrCreateFolder(drive, dateFolderName, flyersRootId);
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
