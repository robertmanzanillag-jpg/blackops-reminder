import { storage } from "./storage";
import { DEFAULT_DEV_USER_ID, getSystemUserId } from "./user-context";

const APPROVED_SINGLE_USER_OWNER_IDS = new Set([DEFAULT_DEV_USER_ID, "robert"]);
const APPROVED_SINGLE_USER_OWNER_USERNAMES = new Set(["robert"]);

export async function isConfiguredSingleUserOwner(userId: string): Promise<boolean> {
  try {
    if (userId === getSystemUserId()) return true;
  } catch {
    // The explicitly approved local owner IDs remain valid while DEFAULT_USER_ID is absent.
  }

  if (APPROVED_SINGLE_USER_OWNER_IDS.has(userId)) return true;
  const user = await storage.getUser(userId).catch(() => undefined);
  return Boolean(user?.username && APPROVED_SINGLE_USER_OWNER_USERNAMES.has(user.username.trim().toLowerCase()));
}
