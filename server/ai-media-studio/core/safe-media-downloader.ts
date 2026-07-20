import { isIP } from "node:net";
import type { DownloadedMedia, MediaAssetType, RemoteMediaDownloader } from "./asset-domain";

export interface RemoteMediaResponse {
  status: number;
  headers: Readonly<Record<string, string | undefined>>;
  body: Uint8Array;
}

export interface RemoteMediaTransport {
  /** The implementation must pin DNS, disable automatic redirects, and stop reading after maxBytes. */
  request(input: { url: string; approvedAddresses: readonly string[]; maxBytes: number }): Promise<RemoteMediaResponse>;
}

export type HostAddressResolver = (hostname: string) => Promise<readonly string[]>;

const DEFAULT_MIME_TYPES: Readonly<Record<MediaAssetType, ReadonlySet<string>>> = {
  video: new Set(["video/mp4", "video/webm", "video/quicktime"]),
  script: new Set(["text/plain", "application/json"]),
  voice: new Set(["audio/mpeg", "audio/wav", "audio/x-wav", "audio/ogg"]),
  b_roll: new Set(["video/mp4", "video/webm", "video/quicktime"]),
  image: new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]),
  music: new Set(["audio/mpeg", "audio/wav", "audio/x-wav", "audio/ogg"]),
  logo: new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]),
  subtitle: new Set(["text/vtt", "application/x-subrip", "text/plain"]),
  thumbnail: new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]),
};

const DEFAULT_MAX_BYTES: Readonly<Record<MediaAssetType, number>> = {
  video: 500_000_000,
  script: 1_000_000,
  voice: 100_000_000,
  b_roll: 500_000_000,
  image: 20_000_000,
  music: 100_000_000,
  logo: 20_000_000,
  subtitle: 5_000_000,
  thumbnail: 20_000_000,
};

function parseIpv4(address: string): number[] | undefined {
  if (isIP(address) !== 4) return undefined;
  return address.split(".").map(Number);
}

function isUnsafeIpv4(address: string): boolean {
  const octets = parseIpv4(address);
  if (!octets) return false;
  const [a, b, c] = octets;
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  );
}

function expandIpv6(address: string): bigint | undefined {
  let normalized = address.toLowerCase().split("%")[0];
  if (normalized.startsWith("::ffff:") && isIP(normalized.slice(7)) === 4) {
    const octets = parseIpv4(normalized.slice(7));
    if (!octets) return undefined;
    normalized = `::ffff:${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  if (isIP(normalized) !== 6) return undefined;
  const sides = normalized.split("::");
  if (sides.length > 2) return undefined;
  const left = sides[0] ? sides[0].split(":") : [];
  const right = sides[1] ? sides[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  const groups = sides.length === 2 ? [...left, ...Array(missing).fill("0"), ...right] : left;
  if (groups.length !== 8) return undefined;
  return groups.reduce((result, group) => (result << 16n) | BigInt(`0x${group || "0"}`), 0n);
}

function hasIpv6Prefix(value: bigint, prefix: bigint, bits: number): boolean {
  const shift = BigInt(128 - bits);
  return value >> shift === prefix >> shift;
}

function isUnsafeIpv6(address: string): boolean {
  const value = expandIpv6(address);
  if (value === undefined) return false;
  const ipv4MappedPrefix = 0xffffn;
  if (value >> 32n === ipv4MappedPrefix) {
    const ipv4 = `${Number((value >> 24n) & 255n)}.${Number((value >> 16n) & 255n)}.${Number((value >> 8n) & 255n)}.${Number(value & 255n)}`;
    return isUnsafeIpv4(ipv4);
  }
  return (
    value === 0n || value === 1n ||
    hasIpv6Prefix(value, BigInt("0xfc000000000000000000000000000000"), 7) ||
    hasIpv6Prefix(value, BigInt("0xfe800000000000000000000000000000"), 10) ||
    hasIpv6Prefix(value, BigInt("0xff000000000000000000000000000000"), 8) ||
    hasIpv6Prefix(value, BigInt("0x20010db8000000000000000000000000"), 32)
  );
}

export function isPublicNetworkAddress(address: string): boolean {
  const version = isIP(address.split("%")[0]);
  if (version === 4) return !isUnsafeIpv4(address);
  if (version === 6) return !isUnsafeIpv6(address);
  return false;
}

function normalizedMimeType(value: string | undefined): string {
  return (value ?? "").split(";", 1)[0].trim().toLowerCase();
}

function header(headers: Readonly<Record<string, string | undefined>>, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) if (key.toLowerCase() === target) return value;
  return undefined;
}

export interface SafeRemoteMediaDownloaderOptions {
  allowedHosts: ReadonlySet<string>;
  resolveHost: HostAddressResolver;
  transport: RemoteMediaTransport;
  maxRedirects?: number;
  maxBytesByType?: Partial<Record<MediaAssetType, number>>;
  allowedMimeTypesByType?: Partial<Record<MediaAssetType, ReadonlySet<string>>>;
}

export class SafeRemoteMediaDownloader implements RemoteMediaDownloader {
  private readonly allowedHosts: ReadonlySet<string>;
  private readonly maxRedirects: number;

  constructor(private readonly options: SafeRemoteMediaDownloaderOptions) {
    this.allowedHosts = new Set([...options.allowedHosts].map((host) => host.trim().toLowerCase()).filter(Boolean));
    if (this.allowedHosts.size === 0) throw new Error("At least one exact media host must be allowlisted");
    this.maxRedirects = options.maxRedirects ?? 3;
    if (!Number.isInteger(this.maxRedirects) || this.maxRedirects < 0 || this.maxRedirects > 10) {
      throw new Error("maxRedirects must be an integer between 0 and 10");
    }
  }

  async download(input: { url: string; type: MediaAssetType }): Promise<DownloadedMedia> {
    const originalUrl = this.parseAndValidateUrl(input.url);
    const maxBytes = this.options.maxBytesByType?.[input.type] ?? DEFAULT_MAX_BYTES[input.type];
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error("Invalid remote media size policy");
    let current = originalUrl;
    const visited = new Set<string>();

    for (let redirectCount = 0; redirectCount <= this.maxRedirects; redirectCount += 1) {
      if (visited.has(current.href)) throw new Error("Remote media redirect loop detected");
      visited.add(current.href);
      const approvedAddresses = await this.resolveAndValidate(current.hostname);
      const response = await this.options.transport.request({ url: current.href, approvedAddresses, maxBytes });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirectCount === this.maxRedirects) throw new Error("Remote media exceeded the redirect limit");
        const location = header(response.headers, "location");
        if (!location) throw new Error("Remote media redirect is missing a Location header");
        current = this.parseAndValidateUrl(new URL(location, current).href);
        continue;
      }
      if (response.status !== 200) throw new Error(`Remote media request failed with status ${response.status}`);

      const mimeType = normalizedMimeType(header(response.headers, "content-type"));
      const allowedMimes = this.options.allowedMimeTypesByType?.[input.type] ?? DEFAULT_MIME_TYPES[input.type];
      if (!allowedMimes.has(mimeType)) throw new Error(`Remote media MIME type ${mimeType || "missing"} is not allowed for ${input.type}`);
      const declaredLength = header(response.headers, "content-length");
      if (declaredLength !== undefined) {
        const parsedLength = Number(declaredLength);
        if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) throw new Error("Remote media has an invalid Content-Length");
        if (parsedLength > maxBytes) throw new Error(`Remote media exceeds the ${maxBytes} byte limit`);
      }
      if (response.body.byteLength > maxBytes) throw new Error(`Remote media exceeds the ${maxBytes} byte limit`);
      return {
        originalUrl: originalUrl.href,
        finalUrl: current.href,
        bytes: new Uint8Array(response.body),
        mimeType,
      };
    }
    throw new Error("Remote media download failed");
  }

  private parseAndValidateUrl(rawUrl: string): URL {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new Error("Remote media URL is invalid");
    }
    if (url.protocol !== "https:") throw new Error("Remote media URL must use HTTPS");
    if (url.username || url.password) throw new Error("Remote media URL must not contain credentials");
    if (url.port && url.port !== "443") throw new Error("Remote media URL must use the standard HTTPS port");
    const hostname = url.hostname.replace(/^\[|\]$/gu, "").toLowerCase();
    if (!this.allowedHosts.has(hostname)) throw new Error(`Remote media host ${hostname} is not allowlisted`);
    return url;
  }

  private async resolveAndValidate(hostnameWithBrackets: string): Promise<readonly string[]> {
    const hostname = hostnameWithBrackets.replace(/^\[|\]$/gu, "").toLowerCase();
    const literalVersion = isIP(hostname);
    const addresses = literalVersion ? [hostname] : [...await this.options.resolveHost(hostname)];
    if (addresses.length === 0) throw new Error("Remote media host did not resolve to an address");
    for (const address of addresses) {
      if (!isPublicNetworkAddress(address)) throw new Error(`Remote media host resolved to a private or reserved address`);
    }
    return addresses;
  }
}
