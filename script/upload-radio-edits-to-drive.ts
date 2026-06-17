import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { google } from "googleapis";

const DEFAULT_FOLDER_ID = "1DFAJg05WgnKj1rXu0YUrOWWrT15ilVWW";
const DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_IG_EDITS_FOLDER_ID || DEFAULT_FOLDER_ID;
const SOURCE_DIR =
  process.env.RADIO_EDIT_OUTPUT_DIR ||
  path.join(process.cwd(), "radio_video_edits", "03_listos_para_subir");

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function findExistingFile(drive: any, filename: string): Promise<string | null> {
  const response = await drive.files.list({
    q: [
      `'${escapeDriveQueryValue(DRIVE_FOLDER_ID)}' in parents`,
      `name = '${escapeDriveQueryValue(filename)}'`,
      "trashed = false",
    ].join(" and "),
    fields: "files(id, name)",
    spaces: "drive",
    pageSize: 1,
  });

  return response.data.files?.[0]?.id || null;
}

async function uploadFile(drive: any, filePath: string) {
  const filename = path.basename(filePath);
  const existingFileId = await findExistingFile(drive, filename);
  const media = {
    mimeType: "video/mp4",
    body: Readable.from(fs.readFileSync(filePath)),
  };

  const response = existingFileId
    ? await drive.files.update({
        fileId: existingFileId,
        media,
        requestBody: { name: filename },
        fields: "id, webViewLink",
      })
    : await drive.files.create({
        requestBody: {
          name: filename,
          parents: [DRIVE_FOLDER_ID],
        },
        media,
        fields: "id, webViewLink",
      });

  console.log(`${existingFileId ? "Actualizado" : "Subido"}: ${filename}`);
  if (response.data.webViewLink) console.log(`Link: ${response.data.webViewLink}`);
}

async function main() {
  if (!fs.existsSync(SOURCE_DIR)) {
    throw new Error(`No existe la carpeta de edits: ${SOURCE_DIR}`);
  }

  const files = fs
    .readdirSync(SOURCE_DIR)
    .filter((file) => file.toLowerCase().endsWith(".mp4"))
    .map((file) => path.join(SOURCE_DIR, file));

  if (files.length === 0) {
    console.log(`No hay .mp4 para subir en ${SOURCE_DIR}`);
    return;
  }

  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/drive.file"],
  });
  const drive = google.drive({ version: "v3", auth });

  for (const file of files) {
    await uploadFile(drive, file);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
