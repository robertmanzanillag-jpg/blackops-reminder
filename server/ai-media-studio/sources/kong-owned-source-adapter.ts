import type { TenantScope } from "../core/resource-domain";
import {
  MAX_SOURCE_SNAPSHOT_ITEMS,
  SOURCE_CATEGORIES,
  type JsonValue,
  type SourceAdapter,
  type SourceAdapterItem,
  type SourceAdapterSnapshot,
  type SourceCategory,
  type SourceSnapshotRequest,
} from "./contracts";

export interface KongOwnedSourceRecord {
  id: string;
  category: SourceCategory;
  title: string;
  summary: string;
  canonicalUrl?: string;
  publishedAt?: string;
  fingerprint?: Record<string, JsonValue>;
  attributes?: Record<string, JsonValue>;
}

export interface KongOwnedSourcePage {
  records: readonly KongOwnedSourceRecord[];
  capturedAt: string;
  nextCursor?: string;
}

/**
 * Internal port owned by Kong. Implementations may read Kong's database or a
 * separately authenticated internal API, but the adapter itself performs no
 * network, secret, provider, render, spend or publishing action.
 */
export interface KongSourceReader {
  read(scope: TenantScope, request: SourceSnapshotRequest): Promise<KongOwnedSourcePage>;
}

export const KONG_OWNED_SOURCE_ADAPTER_KEY = "kong-owned-catalog" as const;

export class KongOwnedSourceAdapter implements SourceAdapter {
  readonly key = KONG_OWNED_SOURCE_ADAPTER_KEY;
  readonly categories = Object.freeze([...SOURCE_CATEGORIES]);

  constructor(private readonly reader: KongSourceReader) {
    if (!reader || typeof reader.read !== "function") throw new Error("Kong source reader is unavailable");
  }

  async fetchSnapshot(scope: TenantScope, request: SourceSnapshotRequest): Promise<SourceAdapterSnapshot> {
    if (!scope.ownerUserId.trim() || !scope.workspaceId.trim()
      || !Number.isInteger(request.limit) || request.limit < 1 || request.limit > MAX_SOURCE_SNAPSHOT_ITEMS
      || (request.cursor !== undefined && (typeof request.cursor !== "string" || request.cursor.length > 2_048))) {
      throw new Error("Invalid Kong source snapshot request");
    }
    const page = await this.reader.read(
      Object.freeze({ ownerUserId: scope.ownerUserId, workspaceId: scope.workspaceId }),
      Object.freeze({ limit: request.limit, ...(request.cursor !== undefined ? { cursor: request.cursor } : {}) }),
    );
    const rawRecords = page?.records;
    const capturedAt = readCanonicalDate(page?.capturedAt);
    const nextCursor = page?.nextCursor;
    if (!Array.isArray(rawRecords) || rawRecords.length > request.limit + 1
      || (nextCursor !== undefined && (typeof nextCursor !== "string" || nextCursor.length > 2_048))) {
      throw new Error("Invalid Kong source snapshot");
    }
    const items = Array.from(rawRecords, normalizeRecord);
    return Object.freeze({
      items: Object.freeze(items),
      capturedAt,
      ...(nextCursor !== undefined ? { nextCursor } : {}),
    });
  }
}

function normalizeRecord(raw: KongOwnedSourceRecord): SourceAdapterItem {
  if (!raw || typeof raw !== "object") throw new Error("Invalid Kong source record");
  const candidate = raw as unknown as Record<string, unknown>;
  const id = readText(candidate.id, 500);
  const category = candidate.category;
  const title = readText(candidate.title, 200);
  const summary = readText(candidate.summary, 4_000);
  const canonicalUrl = candidate.canonicalUrl === undefined ? undefined : readHttps(candidate.canonicalUrl);
  const publishedAt = candidate.publishedAt === undefined ? undefined : readCanonicalDate(candidate.publishedAt);
  const fingerprint = candidate.fingerprint === undefined ? undefined : cloneRecord(candidate.fingerprint);
  const attributes = candidate.attributes === undefined ? undefined : cloneRecord(candidate.attributes);
  if (!SOURCE_CATEGORIES.includes(category as SourceCategory)) throw new Error("Invalid Kong source category");
  return Object.freeze({
    providerExternalId: id,
    category: category as SourceCategory,
    title,
    content: summary,
    ...(canonicalUrl ? { canonicalUrl } : {}),
    ...(publishedAt ? { sourcePublishedAt: publishedAt } : {}),
    ...(fingerprint ? { fingerprint } : {}),
    ...(attributes ? { payload: attributes } : {}),
  });
}

function readText(input: unknown, max: number): string {
  if (typeof input !== "string" || input !== input.trim() || input.length < 1 || input.length > max
    || /[\u0000-\u001f\u007f]/u.test(input)) throw new Error("Invalid Kong source text");
  return input;
}

function readCanonicalDate(input: unknown): string {
  if (typeof input !== "string") throw new Error("Invalid Kong source date");
  try {
    if (new Date(input).toISOString() !== input) throw new Error("Invalid Kong source date");
    return input;
  } catch {
    throw new Error("Invalid Kong source date");
  }
}

function readHttps(input: unknown): string {
  if (typeof input !== "string") throw new Error("Invalid Kong source URL");
  try {
    const url = new URL(input);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) throw new Error("Invalid Kong source URL");
    return input;
  } catch {
    throw new Error("Invalid Kong source URL");
  }
}

function cloneRecord(input: unknown): Record<string, JsonValue> {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)) {
    throw new Error("Invalid Kong source metadata");
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(input);
    if (Buffer.byteLength(serialized, "utf8") > 16_384) throw new Error("Invalid Kong source metadata");
    const clone = JSON.parse(serialized) as unknown;
    if (!clone || typeof clone !== "object" || Array.isArray(clone)) throw new Error("Invalid Kong source metadata");
    return clone as Record<string, JsonValue>;
  } catch {
    throw new Error("Invalid Kong source metadata");
  }
}
