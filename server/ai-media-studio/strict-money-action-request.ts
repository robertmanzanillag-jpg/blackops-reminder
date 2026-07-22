export interface StrictMoneyActionHttpRequest {
  readonly method?: string;
  get(name: string): string | undefined;
}

export type StrictMoneyActionRequestErrorCode =
  | "INVALID_CONFIGURATION"
  | "METHOD_NOT_ALLOWED"
  | "UNAUTHENTICATED"
  | "JSON_REQUIRED"
  | "ORIGIN_REQUIRED"
  | "CROSS_ORIGIN_DENIED";

export class StrictMoneyActionRequestError extends Error {
  readonly statusCode: number;

  constructor(readonly code: StrictMoneyActionRequestErrorCode) {
    super("Money-authority request was denied");
    this.name = "StrictMoneyActionRequestError";
    this.statusCode = code === "METHOD_NOT_ALLOWED" ? 405
      : code === "UNAUTHENTICATED" ? 401
        : code === "JSON_REQUIRED" ? 415
          : code === "ORIGIN_REQUIRED" || code === "CROSS_ORIGIN_DENIED" ? 403
            : 503;
  }
}

declare const strictMoneyActionPrincipalBrand: unique symbol;

/** Minted only after all server-owned authentication and browser-origin gates pass. */
export interface StrictMoneyActionPrincipal {
  readonly authenticatedUserId: string;
  readonly canonicalOrigin: string;
  readonly transport: "same-origin-browser";
  readonly [strictMoneyActionPrincipalBrand]: true;
}

export interface StrictMoneyActionRequestGuard<TRequest extends StrictMoneyActionHttpRequest> {
  authorize(request: TRequest): StrictMoneyActionPrincipal;
}

export interface StrictMoneyActionRequestGuardOptions<TRequest extends StrictMoneyActionHttpRequest> {
  /** Explicit server-owned application URL. It is never inferred from request headers. */
  readonly canonicalAppUrl: string;
  /** Test/local-only escape hatch. Production authority actions require HTTPS. */
  readonly allowInsecureLoopback?: boolean;
  /** Must resolve only a real authenticated session; dev/header/body fallbacks are forbidden. */
  readonly resolveAuthenticatedUserId: (request: TRequest) => string | null | undefined;
}

/**
 * Fail-closed browser guard for POST actions that can create authority, reserve
 * money or lead to spend. Non-browser clients are deliberately rejected: they
 * have neither a mandatory Origin nor `sec-fetch-site: same-origin`. A future
 * machine client requires a separate server-owned capability boundary.
 */
export function createStrictMoneyActionRequestGuard<TRequest extends StrictMoneyActionHttpRequest>(
  options: StrictMoneyActionRequestGuardOptions<TRequest>,
): StrictMoneyActionRequestGuard<TRequest> {
  if (!options || typeof options.resolveAuthenticatedUserId !== "function") {
    throw new StrictMoneyActionRequestError("INVALID_CONFIGURATION");
  }
  const canonicalOrigin = configuredCanonicalOrigin(
    options.canonicalAppUrl,
    options.allowInsecureLoopback === true,
  );

  return Object.freeze({
    authorize(request: TRequest): StrictMoneyActionPrincipal {
      if (!request || request.method !== "POST" || typeof request.get !== "function") {
        throw new StrictMoneyActionRequestError("METHOD_NOT_ALLOWED");
      }

      let authenticatedUserId: string | null | undefined;
      try {
        authenticatedUserId = options.resolveAuthenticatedUserId(request);
      } catch {
        throw new StrictMoneyActionRequestError("UNAUTHENTICATED");
      }
      if (!validAuthenticatedUserId(authenticatedUserId)) {
        throw new StrictMoneyActionRequestError("UNAUTHENTICATED");
      }

      const contentType = safeHeader(request, "content-type");
      if (!isApplicationJson(contentType)) {
        throw new StrictMoneyActionRequestError("JSON_REQUIRED");
      }

      const origin = safeHeader(request, "origin");
      if (!origin) throw new StrictMoneyActionRequestError("ORIGIN_REQUIRED");
      if (origin !== canonicalOrigin
        || safeHeader(request, "sec-fetch-site") !== "same-origin") {
        throw new StrictMoneyActionRequestError("CROSS_ORIGIN_DENIED");
      }

      return Object.freeze({
        authenticatedUserId,
        canonicalOrigin,
        transport: "same-origin-browser",
      }) as StrictMoneyActionPrincipal;
    },
  });
}

function configuredCanonicalOrigin(value: unknown, allowInsecureLoopback: boolean): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    throw new StrictMoneyActionRequestError("INVALID_CONFIGURATION");
  }
  try {
    const url = new URL(value);
    const allowedProtocol = url.protocol === "https:"
      || (url.protocol === "http:" && allowInsecureLoopback && isLoopbackHost(url.hostname));
    if (!allowedProtocol
      || !url.hostname
      || url.username
      || url.password
      || (url.pathname !== "" && url.pathname !== "/")
      || url.search
      || url.hash
      || (value !== url.origin && value !== `${url.origin}/`)) {
      throw new Error("not an explicit canonical application origin");
    }
    return url.origin;
  } catch (error) {
    if (error instanceof StrictMoneyActionRequestError) throw error;
    throw new StrictMoneyActionRequestError("INVALID_CONFIGURATION");
  }
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function safeHeader(request: StrictMoneyActionHttpRequest, name: string): string | undefined {
  try {
    const value = request.get(name);
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

function isApplicationJson(value: string | undefined): boolean {
  if (!value) return false;
  const [mediaType] = value.split(";", 1);
  return mediaType?.trim().toLowerCase() === "application/json";
}

function validAuthenticatedUserId(value: unknown): value is string {
  return typeof value === "string"
    && value === value.trim()
    && value.length >= 1
    && value.length <= 255;
}
