import { createHash, timingSafeEqual } from "node:crypto";
import type { TenantScope } from "../core/resource-domain";
import {
  MAX_SOURCE_SNAPSHOT_ITEMS,
  type CanonicalSourceItem,
  type SourceListFilter,
  type SourcePageRequest,
} from "./contracts";

const CURSOR_VERSION = 1;

type CursorPayload = readonly [version: 1, createdAtMs: number, id: string, query: string, checksum: string];

export class SourceCursorError extends Error {
  constructor(message = "Source cursor is invalid for this result set") {
    super(message);
    this.name = "SourceCursorError";
  }
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("base64url").slice(0, 16);
}

function queryFingerprint(scope: TenantScope, filter: SourceListFilter): string {
  return digest(JSON.stringify([
    scope.ownerUserId,
    scope.workspaceId,
    filter.category ?? null,
    filter.status ?? null,
    filter.rightsStatus ?? null,
  ]));
}

function payloadChecksum(payload: readonly [1, number, string, string]): string {
  return digest(JSON.stringify(payload));
}

function equalDigest(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export interface SourceCursorPosition {
  createdAt: Date;
  id: string;
}

export function boundedSourcePageLimit(limit: number | undefined): number {
  const value = limit ?? 25;
  if (!Number.isInteger(value) || value < 1 || value > MAX_SOURCE_SNAPSHOT_ITEMS) {
    throw new Error(`Source page limit must be an integer from 1 to ${MAX_SOURCE_SNAPSHOT_ITEMS}`);
  }
  return value;
}

export function encodeSourceCursor(
  scope: TenantScope,
  filter: SourceListFilter,
  item: Pick<CanonicalSourceItem, "createdAt" | "id">,
): string {
  const createdAtMs = Date.parse(item.createdAt);
  if (!Number.isFinite(createdAtMs)) throw new Error("Source cursor item has an invalid creation time");
  const query = queryFingerprint(scope, filter);
  const unsigned = [CURSOR_VERSION, createdAtMs, item.id, query] as const;
  return Buffer.from(JSON.stringify([...unsigned, payloadChecksum(unsigned)]), "utf8").toString("base64url");
}

export function decodeSourceCursor(
  scope: TenantScope,
  filter: SourceListFilter,
  cursor: string | undefined,
): SourceCursorPosition | undefined {
  if (!cursor) return undefined;
  try {
    if (!/^[A-Za-z0-9_-]{1,512}$/.test(cursor)) throw new SourceCursorError();
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    if (Buffer.from(decoded, "utf8").toString("base64url") !== cursor) throw new SourceCursorError();
    const value = JSON.parse(decoded) as unknown;
    if (!Array.isArray(value) || value.length !== 5) throw new SourceCursorError();
    const [version, createdAtMs, id, query, checksum] = value as unknown as CursorPayload;
    if (
      version !== CURSOR_VERSION
      || !Number.isSafeInteger(createdAtMs)
      || createdAtMs < 0
      || typeof id !== "string"
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)
      || typeof query !== "string"
      || typeof checksum !== "string"
    ) throw new SourceCursorError();
    const expectedQuery = queryFingerprint(scope, filter);
    const expectedChecksum = payloadChecksum([CURSOR_VERSION, createdAtMs, id, query]);
    if (!equalDigest(query, expectedQuery) || !equalDigest(checksum, expectedChecksum)) throw new SourceCursorError();
    const createdAt = new Date(createdAtMs);
    if (!Number.isFinite(createdAt.getTime())) throw new SourceCursorError();
    return { createdAt, id };
  } catch (error) {
    if (error instanceof SourceCursorError) throw error;
    throw new SourceCursorError();
  }
}

export function sourceListFilter(request: SourcePageRequest): SourceListFilter {
  return {
    ...(request.category ? { category: request.category } : {}),
    ...(request.status ? { status: request.status } : {}),
    ...(request.rightsStatus ? { rightsStatus: request.rightsStatus } : {}),
  };
}
