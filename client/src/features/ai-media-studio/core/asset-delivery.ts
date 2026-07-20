import type { AssetDelivery } from "./types";

export type PendingDeliveryWindow = {
  closed: boolean;
  close: () => void;
  location: { replace: (url: string) => void };
};

export async function completeAssetDelivery({
  request,
  pendingWindow,
  origin,
  now = Date.now(),
}: {
  request: () => Promise<AssetDelivery>;
  pendingWindow: PendingDeliveryWindow;
  origin: string;
  now?: number;
}): Promise<AssetDelivery> {
  try {
    const result = await request();
    const expiration = Date.parse(result.expiresAt);
    let safeUrl: URL | null = null;
    try {
      safeUrl = new URL(result.url, origin);
    } catch {
      // Malformed provider output must never be assigned to browser location.
    }
    if (pendingWindow.closed || !safeUrl || safeUrl.protocol !== "https:" || !Number.isFinite(expiration) || expiration <= now) {
      throw new Error("The secure link is invalid or expired. Request a new link.");
    }
    pendingWindow.location.replace(safeUrl.href);
    return result;
  } catch (error) {
    if (!pendingWindow.closed) pendingWindow.close();
    throw error;
  }
}
