import { lookup } from "node:dns/promises";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { URL } from "node:url";
import { isPublicNetworkAddress } from "../core/safe-media-downloader";
import {
  AssetIngestFailure,
  type ArtifactReadRequest,
  type ArtifactReadStream,
  type BoundedArtifactReader,
  type ExactHostSsrfPolicy,
} from "./contracts";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export interface PinnedHttpsRequest {
  hostname: string;
  path: string;
  pinnedAddress: string;
  addressFamily: 4 | 6;
  tlsServername: string;
  timeoutMs: number;
  headers: Readonly<Record<string, string>>;
}

/** A response stays streaming; transports must not buffer the artifact body. */
export interface StreamingHttpsResponse {
  statusCode?: number;
  headers: IncomingHttpHeaders;
  body: AsyncIterable<unknown>;
  discard(): void;
  abort(): void;
}

/** Injected in tests so SSRF, redirect, timeout, and streaming behavior need no real socket. */
export interface StreamingHttpsTransport {
  request(input: PinnedHttpsRequest): Promise<StreamingHttpsResponse>;
}

export interface NodeHttpsArtifactReaderOptions {
  userAgent?: string;
  requestTimeoutMs?: number;
  transport?: StreamingHttpsTransport;
}

export class NodeHttpsArtifactReader implements BoundedArtifactReader {
  private readonly timeoutMs: number;
  private readonly transport: StreamingHttpsTransport;

  constructor(private readonly options: NodeHttpsArtifactReaderOptions = {}) {
    this.timeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error("Artifact request timeout must be a positive integer");
    }
    this.transport = options.transport ?? new NodeHttpsStreamingTransport();
  }

  async open(request: ArtifactReadRequest): Promise<ArtifactReadStream> {
    validateReadBounds(request);
    const visited = new Set<string>();
    let current = parseAndValidateUrl(request.url, request.policy);

    for (let redirectCount = 0; redirectCount <= request.policy.maxRedirects; redirectCount += 1) {
      if (visited.has(current.href)) throw safeFailure("source_rejected", false);
      visited.add(current.href);

      const pinned = await resolvePinnedAddress(current.hostname, request.policy);
      const response = await this.requestOnce(current, pinned);
      const status = response.statusCode ?? 0;

      if (REDIRECT_STATUSES.has(status)) {
        const location = singleHeader(response.headers.location);
        discard(response);
        if (!location || redirectCount === request.policy.maxRedirects) {
          throw safeFailure("source_rejected", false);
        }
        current = parseRedirect(location, current, request.policy);
        continue;
      }

      if (status < 200 || status >= 300) {
        discard(response);
        const retryable = status === 408 || status === 425 || status === 429 || status >= 500 || status === 0;
        throw safeFailure(retryable ? "source_unavailable" : "source_rejected", retryable);
      }

      let declaredSizeBytes: number | undefined;
      try {
        declaredSizeBytes = parseContentLength(response.headers["content-length"]);
      } catch {
        discard(response);
        throw safeFailure("source_rejected", false);
      }
      if (declaredSizeBytes !== undefined && declaredSizeBytes > request.maxBytes) {
        discard(response);
        throw safeFailure("size_exceeded", false);
      }

      return {
        finalUrl: redactUrl(current),
        mimeType: singleHeader(response.headers["content-type"]) ?? "application/octet-stream",
        declaredSizeBytes,
        chunks: boundedChunks(response, request.maxBytes, request.maxChunkBytes),
        abort: () => response.abort(),
      };
    }

    throw safeFailure("source_rejected", false);
  }

  private async requestOnce(url: URL, pinned: { address: string; family: 4 | 6 }): Promise<StreamingHttpsResponse> {
    try {
      return await this.transport.request({
        hostname: normalizedHostname(url),
        path: `${url.pathname}${url.search}`,
        pinnedAddress: pinned.address,
        addressFamily: pinned.family,
        tlsServername: normalizedHostname(url),
        timeoutMs: this.timeoutMs,
        headers: {
          accept: "video/mp4, application/octet-stream;q=0.8",
          "user-agent": this.options.userAgent ?? "blackops-ai-media-studio/asset-ingest",
        },
      });
    } catch {
      throw safeFailure("source_unavailable", true);
    }
  }
}

/** Production transport pins the approved address while TLS still authenticates the allowlisted hostname. */
export class NodeHttpsStreamingTransport implements StreamingHttpsTransport {
  request(input: PinnedHttpsRequest): Promise<StreamingHttpsResponse> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const req = httpsRequest({
        protocol: "https:",
        method: "GET",
        hostname: input.hostname,
        path: input.path,
        port: 443,
        servername: input.tlsServername,
        headers: input.headers,
        lookup: (_hostname, _options, callback) => callback(null, input.pinnedAddress, input.addressFamily),
      }, (response) => {
        settled = true;
        resolve(wrapIncomingMessage(response));
      });
      req.setTimeout(input.timeoutMs, () => req.destroy(new Error("artifact request timed out")));
      req.once("error", (error) => {
        if (!settled) reject(error);
      });
      req.end();
    });
  }
}

function wrapIncomingMessage(response: IncomingMessage): StreamingHttpsResponse {
  return {
    statusCode: response.statusCode,
    headers: response.headers,
    body: response,
    discard: () => response.destroy(),
    abort: () => response.destroy(),
  };
}

function validateReadBounds(request: ArtifactReadRequest): void {
  if (!Number.isSafeInteger(request.maxBytes) || request.maxBytes <= 0
    || !Number.isSafeInteger(request.maxChunkBytes) || request.maxChunkBytes <= 0) {
    throw safeFailure("source_rejected", false);
  }
}

function parseAndValidateUrl(rawUrl: string, policy: ExactHostSsrfPolicy): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw safeFailure("source_rejected", false);
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw safeFailure("source_rejected", false);
  }
  if (url.port && url.port !== "443") throw safeFailure("source_rejected", false);
  const hostname = normalizedHostname(url);
  if (!hostname || !policy.allowedHosts.has(hostname)) throw safeFailure("source_rejected", false);
  return url;
}

function parseRedirect(location: string, current: URL, policy: ExactHostSsrfPolicy): URL {
  try {
    return parseAndValidateUrl(new URL(location, current).href, policy);
  } catch (error) {
    if (error instanceof AssetIngestFailure) throw error;
    throw safeFailure("source_rejected", false);
  }
}

async function resolvePinnedAddress(hostnameWithBrackets: string, policy: ExactHostSsrfPolicy): Promise<{ address: string; family: 4 | 6 }> {
  const hostname = hostnameWithBrackets.replace(/^\[|\]$/gu, "").toLowerCase();
  let addresses: readonly string[];
  try {
    addresses = await policy.resolvePublicAddresses(hostname);
  } catch {
    throw safeFailure("source_unavailable", true);
  }
  if (addresses.length === 0 || addresses.some((address) => !isPublicNetworkAddress(address))) {
    throw safeFailure("source_rejected", false);
  }
  const address = addresses[0]!;
  const family = isIP(address.split("%", 1)[0]);
  if (family !== 4 && family !== 6) throw safeFailure("source_rejected", false);
  return { address, family };
}

export async function resolvePublicAddresses(hostname: string): Promise<readonly string[]> {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

/** Kept as the assets-layer public API while sharing the hardened IPv4/IPv6 classifier. */
export function isPublicIp(address: string): boolean {
  return isPublicNetworkAddress(address);
}

async function* boundedChunks(response: StreamingHttpsResponse, maxBytes: number, maxChunkBytes: number): AsyncIterable<Uint8Array> {
  let total = 0;
  let completed = false;
  try {
    for await (const chunk of response.body) {
      const bytes = toBytes(chunk);
      if (bytes.byteLength > maxChunkBytes) throw safeFailure("chunk_exceeded", false);
      total += bytes.byteLength;
      if (total > maxBytes) throw safeFailure("size_exceeded", false);
      yield bytes;
    }
    completed = true;
  } catch (error) {
    response.abort();
    if (error instanceof AssetIngestFailure) throw error;
    throw safeFailure("source_unavailable", true);
  } finally {
    if (!completed) response.abort();
  }
}

function toBytes(chunk: unknown): Uint8Array {
  if (chunk instanceof Uint8Array) return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  if (typeof chunk === "string") return new Uint8Array(Buffer.from(chunk));
  throw safeFailure("source_unavailable", true);
}

function parseContentLength(value: string | string[] | undefined): number | undefined {
  if (value === undefined) return undefined;
  const raw = singleHeader(value);
  if (raw === undefined || !/^(0|[1-9]\d*)$/u.test(raw)) throw new Error("invalid content length");
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) throw new Error("invalid content length");
  return parsed;
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value.length === 1 ? value[0] : undefined;
  return value;
}

function normalizedHostname(url: URL): string {
  return url.hostname.replace(/^\[|\]$/gu, "").toLowerCase();
}

function discard(response: StreamingHttpsResponse): void {
  try {
    response.abort();
  } catch {
    // The response is already unusable; never fall back to draining an untrusted body.
  }
}

function redactUrl(url: URL): string {
  return `${url.origin}${url.pathname}`;
}

function safeFailure(code: "source_rejected" | "source_unavailable" | "size_exceeded" | "chunk_exceeded", retryable: boolean): AssetIngestFailure {
  return new AssetIngestFailure(code, retryable);
}
