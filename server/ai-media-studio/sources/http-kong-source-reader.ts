import { isIP } from "node:net";
import { TextDecoder } from "node:util";
import {
  NodeHttpsStreamingTransport,
  isPublicIp,
  resolvePublicAddresses,
  type PinnedHttpsRequest,
  type StreamingHttpsResponse,
  type StreamingHttpsTransport,
} from "../assets/http-artifact-reader";
import type { TenantScope } from "../core/resource-domain";
import { MAX_SOURCE_SNAPSHOT_ITEMS, SOURCE_CATEGORIES, type JsonValue, type SourceCategory, type SourceSnapshotRequest } from "./contracts";
import type { KongOwnedSourcePage, KongOwnedSourceRecord, KongSourceReader } from "./kong-owned-source-adapter";

export const DEFAULT_KONG_SOURCE_FEED_ENDPOINT = "https://kong--app.replit.app/api/ai-media-studio/source-feed";

const FEED_VERSION = "1";
const MAX_CURSOR_LENGTH = 1_024;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 512 * 1_024;
const DEFAULT_MAX_CHUNK_BYTES = 64 * 1_024;
const DEFAULT_MAX_CHUNKS = 128;
const JSON_CONTENT_TYPE = /^application\/json(?:\s*;\s*charset=utf-8)?$/iu;
const CANONICAL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const FINGERPRINT = /^sha256:[a-f0-9]{64}$/u;
const BASE64URL = /^[A-Za-z0-9_-]{1,1024}$/u;
const ATTRIBUTE_KEYS = new Set([
  "city", "cuisine", "duration", "endAt", "eventCategory", "experienceCategory",
  "groupSize", "location", "priceRange", "startAt", "venueName", "venueType",
]);

export interface HttpKongSourceReaderOptions {
  endpoint?: string;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
  maxChunkBytes?: number;
  maxChunks?: number;
  userAgent?: string;
  transport?: StreamingHttpsTransport;
  resolvePublicAddresses?: (hostname: string) => Promise<readonly string[]>;
}

export class HttpKongSourceReaderError extends Error {
  readonly code = "KONG_SOURCE_FEED_UNAVAILABLE" as const;

  constructor() {
    super("Kong source feed is unavailable");
    this.name = "HttpKongSourceReaderError";
  }
}

/** Strict, read-only client for the public v1 feed introduced by kong-nightlife#117. */
export class HttpKongSourceReader implements KongSourceReader {
  private readonly endpoint: URL;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly maxChunkBytes: number;
  private readonly maxChunks: number;
  private readonly userAgent: string;
  private readonly transport: StreamingHttpsTransport;
  private readonly resolver: (hostname: string) => Promise<readonly string[]>;

  constructor(options: HttpKongSourceReaderOptions = {}) {
    this.endpoint = parseEndpoint(options.endpoint ?? DEFAULT_KONG_SOURCE_FEED_ENDPOINT);
    this.timeoutMs = positiveBound(options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS, 60_000);
    this.maxResponseBytes = positiveBound(options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES, 4 * 1_024 * 1_024);
    this.maxChunkBytes = positiveBound(options.maxChunkBytes ?? DEFAULT_MAX_CHUNK_BYTES, this.maxResponseBytes);
    this.maxChunks = positiveBound(options.maxChunks ?? DEFAULT_MAX_CHUNKS, 4_096);
    if (typeof options.userAgent === "string" && (!options.userAgent.trim() || /[\r\n]/u.test(options.userAgent))) {
      throw new HttpKongSourceReaderError();
    }
    this.userAgent = options.userAgent ?? "blackops-ai-media-studio/kong-source-reader";
    this.transport = options.transport ?? new NodeHttpsStreamingTransport();
    this.resolver = options.resolvePublicAddresses ?? resolvePublicAddresses;
  }

  async read(scope: TenantScope, request: SourceSnapshotRequest): Promise<KongOwnedSourcePage> {
    let response: StreamingHttpsResponse | undefined;
    try {
      validateRequest(scope, request);
      const pinned = await this.resolvePinnedAddress();
      response = await this.transport.request(this.requestInput(request, pinned));
      if ((response.statusCode ?? 0) < 200 || (response.statusCode ?? 0) >= 300) throw new Error("status");
      if (!JSON_CONTENT_TYPE.test(singleHeader(response.headers["content-type"]) ?? "")) throw new Error("content type");
      const declaredLength = parseContentLength(response.headers["content-length"]);
      if (declaredLength !== undefined && declaredLength > this.maxResponseBytes) throw new Error("content length");
      const bytes = await readBoundedBody(response, this.maxResponseBytes, this.maxChunkBytes, this.maxChunks);
      if (declaredLength !== undefined && bytes.byteLength !== declaredLength) throw new Error("content length mismatch");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return parseFeedResponse(JSON.parse(text), request.limit);
    } catch {
      abort(response);
      throw new HttpKongSourceReaderError();
    }
  }

  private async resolvePinnedAddress(): Promise<{ address: string; family: 4 | 6 }> {
    const addresses = await this.resolver(this.endpoint.hostname);
    if (!Array.isArray(addresses) || addresses.length === 0
      || addresses.some((address) => typeof address !== "string" || !isPublicIp(address))) {
      throw new Error("unsafe DNS answer");
    }
    const address = addresses[0]!;
    const family = isIP(address);
    if (family !== 4 && family !== 6) throw new Error("invalid DNS answer");
    return { address, family };
  }

  private requestInput(request: SourceSnapshotRequest, pinned: { address: string; family: 4 | 6 }): PinnedHttpsRequest {
    const query = new URLSearchParams({ limit: String(request.limit) });
    if (request.cursor !== undefined) query.set("cursor", request.cursor);
    return {
      hostname: this.endpoint.hostname,
      path: `${this.endpoint.pathname}?${query.toString()}`,
      pinnedAddress: pinned.address,
      addressFamily: pinned.family,
      tlsServername: this.endpoint.hostname,
      timeoutMs: this.timeoutMs,
      headers: { accept: "application/json", "user-agent": this.userAgent },
    };
  }
}

function parseEndpoint(raw: string): URL {
  try {
    const endpoint = new URL(raw);
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.hash || endpoint.search
      || (endpoint.port && endpoint.port !== "443") || isIP(endpoint.hostname.replace(/^\[|\]$/gu, "")) !== 0
      || endpoint.pathname.length < 2 || endpoint.pathname.endsWith("/")) throw new Error("invalid endpoint");
    return endpoint;
  } catch {
    throw new HttpKongSourceReaderError();
  }
}

function positiveBound(value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new HttpKongSourceReaderError();
  return value;
}

function validateRequest(scope: TenantScope, request: SourceSnapshotRequest): void {
  if (!scope || typeof scope.ownerUserId !== "string" || !scope.ownerUserId.trim()
    || typeof scope.workspaceId !== "string" || !scope.workspaceId.trim()
    || !request || !Number.isInteger(request.limit) || request.limit < 1 || request.limit > MAX_SOURCE_SNAPSHOT_ITEMS) {
    throw new Error("invalid request");
  }
  if (request.cursor !== undefined) validateCursor(request.cursor);
}

function validateCursor(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length > MAX_CURSOR_LENGTH || !BASE64URL.test(value)) throw new Error("invalid cursor");
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value || decoded.byteLength > 768) throw new Error("invalid cursor");
  const cursor = asExactObject(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decoded)), ["v", "u", "i"]);
  if (cursor.v !== FEED_VERSION || !CANONICAL_ID.test(readString(cursor.i)) || readIsoDate(cursor.u) !== cursor.u) {
    throw new Error("invalid cursor");
  }
}

async function readBoundedBody(response: StreamingHttpsResponse, maximum: number, maximumChunk: number, maximumChunks: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const raw of response.body) {
    if (!(raw instanceof Uint8Array) || raw.byteLength > maximumChunk || chunks.length >= maximumChunks) throw new Error("body limit");
    total += raw.byteLength;
    if (total > maximum) throw new Error("body limit");
    chunks.push(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function parseFeedResponse(input: unknown, requestedLimit: number): KongOwnedSourcePage {
  const root = asExactObject(input, ["version", "capturedAt", "items", "page"]);
  if (root.version !== FEED_VERSION || !Array.isArray(root.items) || root.items.length > requestedLimit) throw new Error("invalid response");
  const capturedAt = readIsoDate(root.capturedAt);
  const page = asExactObject(root.page, ["limit", "hasMore", "nextCursor"]);
  if (page.limit !== requestedLimit || typeof page.hasMore !== "boolean") throw new Error("invalid page");
  const nextCursor = page.nextCursor;
  if (nextCursor !== null) validateCursor(nextCursor);
  if ((page.hasMore && nextCursor === null) || (!page.hasMore && nextCursor !== null)) throw new Error("invalid page");
  const records = root.items.map(parseItem);
  return Object.freeze({
    records: Object.freeze(records),
    capturedAt,
    ...(nextCursor !== null ? { nextCursor } : {}),
  });
}

function parseItem(input: unknown): KongOwnedSourceRecord {
  const item = asExactObject(input, ["id", "category", "title", "summary", "publishedAt", "updatedAt", "fingerprint", "attributes"]);
  const id = readString(item.id);
  const category = item.category;
  const title = readBoundedText(item.title, 200);
  const summary = readBoundedText(item.summary, 2_000);
  const publishedAt = readIsoDate(item.publishedAt);
  readIsoDate(item.updatedAt);
  const fingerprint = readString(item.fingerprint);
  if (!CANONICAL_ID.test(id) || !SOURCE_CATEGORIES.includes(category as SourceCategory) || !FINGERPRINT.test(fingerprint)) {
    throw new Error("invalid item");
  }
  const attributes = parseAttributes(item.attributes);
  return Object.freeze({
    id,
    category: category as SourceCategory,
    title,
    summary,
    publishedAt,
    fingerprint: Object.freeze({ digest: fingerprint }),
    attributes: Object.freeze(attributes),
  });
}

function parseAttributes(input: unknown): Record<string, JsonValue> {
  const attributes = asObject(input);
  if (Buffer.byteLength(JSON.stringify(attributes), "utf8") > 4_096) throw new Error("invalid attributes");
  const copy: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (!ATTRIBUTE_KEYS.has(key) || typeof value !== "string" || value.length < 1 || value.length > 500
      || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error("invalid attributes");
    if ((key === "startAt" || key === "endAt") && readIsoDate(value) !== value) throw new Error("invalid attributes");
    if (key === "venueType" && value !== "nightclub" && value !== "beach_club") throw new Error("invalid attributes");
    copy[key] = value;
  }
  return copy;
}

function asObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("invalid object");
  return input as Record<string, unknown>;
}

function asExactObject(input: unknown, keys: readonly string[]): Record<string, unknown> {
  const object = asObject(input);
  const actual = Object.keys(object);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) throw new Error("invalid object");
  return object;
}

function readString(input: unknown): string {
  if (typeof input !== "string") throw new Error("invalid string");
  return input;
}

function readBoundedText(input: unknown, maximum: number): string {
  const value = readString(input);
  if (!value || value !== value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error("invalid text");
  return value;
}

function readIsoDate(input: unknown): string {
  const value = readString(input);
  if (new Date(value).toISOString() !== value) throw new Error("invalid date");
  return value;
}

function parseContentLength(value: string | string[] | undefined): number | undefined {
  const raw = singleHeader(value);
  if (raw === undefined) return undefined;
  if (!/^(0|[1-9]\d*)$/u.test(raw)) throw new Error("invalid content length");
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) throw new Error("invalid content length");
  return parsed;
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    if (value.length !== 1) throw new Error("invalid header");
    return value[0];
  }
  return value;
}

function abort(response: StreamingHttpsResponse | undefined): void {
  try { response?.abort(); } catch { /* Response is already unusable. */ }
}
