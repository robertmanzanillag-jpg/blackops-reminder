import { createHash, timingSafeEqual } from "node:crypto";
import type { ReusableScriptAssetListRequest } from "../../../shared/ai-media-studio-reusable-script-assets";
import type { TenantScope } from "../core/resource-domain";
import { ReusableScriptAssetRepositoryError } from "./reusable-script-asset-contracts";

type CursorPayload = readonly [version: 1, createdAtMs: number, id: string, query: string, checksum: string];

function digest(value: string): string {
  return createHash("sha256").update(value).digest("base64url").slice(0, 16);
}

function queryFingerprint(scope: TenantScope, status: ReusableScriptAssetListRequest["status"]): string {
  return digest(JSON.stringify([scope.ownerUserId, scope.workspaceId, status ?? null]));
}

function checksum(value: readonly [1, number, string, string]): string {
  return digest(JSON.stringify(value));
}

function equal(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export interface ReusableScriptAssetCursorPosition {
  createdAt: Date;
  id: string;
}

export function encodeReusableScriptAssetCursor(
  scope: TenantScope,
  status: ReusableScriptAssetListRequest["status"],
  item: Pick<{ createdAt: string; id: string }, "createdAt" | "id">,
): string {
  const createdAtMs = Date.parse(item.createdAt);
  if (!Number.isFinite(createdAtMs)) throw new ReusableScriptAssetRepositoryError("PERSISTENCE_UNAVAILABLE");
  const query = queryFingerprint(scope, status);
  const unsigned = [1, createdAtMs, item.id, query] as const;
  return Buffer.from(JSON.stringify([...unsigned, checksum(unsigned)]), "utf8").toString("base64url");
}

export function decodeReusableScriptAssetCursor(
  scope: TenantScope,
  status: ReusableScriptAssetListRequest["status"],
  cursor: string | undefined,
): ReusableScriptAssetCursorPosition | undefined {
  if (!cursor) return undefined;
  try {
    if (!/^[A-Za-z0-9_-]{1,512}$/.test(cursor)) throw new Error();
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    if (Buffer.from(decoded, "utf8").toString("base64url") !== cursor) throw new Error();
    const value = JSON.parse(decoded) as unknown;
    if (!Array.isArray(value) || value.length !== 5) throw new Error();
    const [version, createdAtMs, id, query, storedChecksum] = value as unknown as CursorPayload;
    if (version !== 1 || !Number.isSafeInteger(createdAtMs) || createdAtMs < 0
      || typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id)
      || typeof query !== "string" || typeof storedChecksum !== "string") throw new Error();
    const expectedQuery = queryFingerprint(scope, status);
    const expectedChecksum = checksum([1, createdAtMs, id, query]);
    if (!equal(query, expectedQuery) || !equal(storedChecksum, expectedChecksum)) throw new Error();
    const createdAt = new Date(createdAtMs);
    if (!Number.isFinite(createdAt.getTime())) throw new Error();
    return { createdAt, id };
  } catch {
    throw new ReusableScriptAssetRepositoryError("INVALID_CURSOR");
  }
}
