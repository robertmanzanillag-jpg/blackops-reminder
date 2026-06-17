import { ensureDriveFolderAtRoot } from "../server/google-drive";
import { getSystemUserId } from "../server/user-context";

const FOLDER_NAME = "VIDEOS DE TIKTOK DE LA RADIO";

async function main() {
  const userId = process.env.USER_ID || getSystemUserId();
  const folderId = await ensureDriveFolderAtRoot(FOLDER_NAME, userId);
  console.log(`Carpeta lista en Google Drive: ${FOLDER_NAME}`);
  console.log(`Folder ID: ${folderId}`);
  console.log(`Link: https://drive.google.com/drive/folders/${folderId}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
