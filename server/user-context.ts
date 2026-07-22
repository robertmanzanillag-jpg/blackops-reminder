import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { hasRealValue } from "./ceo-doctor-cli";

export const DEFAULT_DEV_USER_ID = "mock-user-123";
export const LOCAL_AUTH_USER_COOKIE_NAME = "blackops.uid";
const DEV_FALLBACK_ENVS = new Set(["development", "test"]);

type RequestWithAuth = Request & {
  user?: { id?: string; userId?: string; sub?: string };
  session?: {
    userId?: string;
    user?: { id?: string; userId?: string; sub?: string };
  };
};

const PUBLIC_API_PATHS = [
  "/api/auth/me",
  "/api/auth/register",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/telegram/webhook",
  "/api/google-drive/oauth/callback",
  "/api/canva/oauth/callback",
  "/api/zoho/callback",
];

const PUBLIC_API_PATTERNS: RegExp[] = [
  /^\/api\/ai-media-studio\/webhooks\/providers\/[a-z0-9][a-z0-9_-]{0,63}$/,
  /^\/api\/ai-media-studio\/webhooks\/providers\/[a-z0-9][a-z0-9_-]{0,63}\/accounts\/[A-Za-z0-9_-]{24,128}$/,
];

function cleanUserId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned.length > 0 ? cleaned : null;
}

function getLocalAuthCookieSecret(): string | null {
  const secret = process.env.SESSION_SECRET?.trim();
  return secret ? secret : null;
}

function signLocalAuthCookiePayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSignedLocalAuthCookieValue(userId: string): string | null {
  const cleanedUserId = cleanUserId(userId);
  const secret = getLocalAuthCookieSecret();
  if (!cleanedUserId || !secret) return null;

  const payload = Buffer.from(cleanedUserId, "utf8").toString("base64url");
  return `v1.${payload}.${signLocalAuthCookiePayload(payload, secret)}`;
}

function verifySignedLocalAuthCookieValue(value: string): string | null {
  const secret = getLocalAuthCookieSecret();
  if (!secret) return null;

  const [version, payload, signature] = value.split(".");
  if (version !== "v1" || !payload || !signature) return null;

  const expected = signLocalAuthCookiePayload(payload, secret);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    return null;
  }

  try {
    return cleanUserId(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function readCookieHeader(req: Request): string {
  const directHeader = req.headers?.cookie;
  if (typeof directHeader === "string") return directHeader;
  const header = req.header("cookie");
  return typeof header === "string" ? header : "";
}

function readSignedLocalAuthCookie(req: Request): string | null {
  const cookieHeader = readCookieHeader(req);
  const cookies = cookieHeader.split(";").map((part) => part.trim()).filter(Boolean);
  const prefix = `${LOCAL_AUTH_USER_COOKIE_NAME}=`;
  const rawValue = cookies.find((cookie) => cookie.startsWith(prefix))?.slice(prefix.length);
  if (!rawValue) return null;

  try {
    return verifySignedLocalAuthCookieValue(decodeURIComponent(rawValue));
  } catch {
    return null;
  }
}

export function allowsDevUserFallback(): boolean {
  if (process.env.ALLOW_DEV_USER_FALLBACK === "true") return true;
  if (process.env.ALLOW_DEV_USER_FALLBACK === "false") return false;
  return DEV_FALLBACK_ENVS.has(process.env.NODE_ENV || "development");
}

/**
 * Resolve only authenticated, request-bound identity sources.
 *
 * Money- or authority-bearing routes must use this resolver so development
 * bridges such as x-user-id and the mock user can never become authorization.
 */
export function resolveAuthenticatedUserId(req: Request): string | null {
  const authReq = req as RequestWithAuth;

  return (
    cleanUserId(authReq.user?.id) ||
    cleanUserId(authReq.user?.userId) ||
    cleanUserId(authReq.user?.sub) ||
    cleanUserId(authReq.session?.userId) ||
    cleanUserId(authReq.session?.user?.id) ||
    cleanUserId(authReq.session?.user?.userId) ||
    cleanUserId(authReq.session?.user?.sub) ||
    readSignedLocalAuthCookie(req)
  );
}

export function resolveCurrentUserId(req: Request): string | null {
  const requestFallbackAllowed = allowsDevUserFallback();

  return (
    resolveAuthenticatedUserId(req) ||
    (requestFallbackAllowed ? cleanUserId(req.header("x-user-id")) : null) ||
    (requestFallbackAllowed ? DEFAULT_DEV_USER_ID : null)
  );
}

export function isPublicApiPath(path: string): boolean {
  return PUBLIC_API_PATHS.includes(path) || PUBLIC_API_PATTERNS.some((pattern) => pattern.test(path));
}

export function resolveRequestApiPath(req: Request): string {
  const request = req as Request & { originalUrl?: string; baseUrl?: string };
  const rawPath = request.originalUrl || `${request.baseUrl || ""}${req.path || ""}`;
  return rawPath.split("?")[0] || "/";
}

export function isPublicApiRequest(req: Request): boolean {
  return isPublicApiPath(resolveRequestApiPath(req));
}

/**
 * Central place for resolving the active application user.
 *
 * Supports provider-neutral auth state (Passport/Replit/Clerk/Auth.js adapters
 * can populate req.user or req.session). Request fallbacks such as x-user-id and
 * the mock user are limited to dev/test unless explicitly enabled with
 * ALLOW_DEV_USER_FALLBACK=true. DEFAULT_USER_ID is reserved for system jobs.
 */
export function getCurrentUserId(req: Request): string {
  const userId = resolveCurrentUserId(req);
  if (!userId) {
    const error = new Error("Authentication required") as Error & { status?: number; statusCode?: number };
    error.status = 401;
    error.statusCode = 401;
    throw error;
  }
  return userId;
}

export function requireAppUser(req: Request, res: Response, next: NextFunction): void {
  if (!req.path.startsWith("/api")) return next();
  if (isPublicApiRequest(req)) return next();

  const userId = resolveCurrentUserId(req);
  if (!userId) {
    res.status(401).json({
      error: "Authentication required",
      reason: "missing_user_context",
    });
    return;
  }

  next();
}

const PRODUCTION_BATCH_MUTATION_PATH = /^\/api\/ai-media-studio\/production-batches\/[^/?#]+\/(?:prepare-scripts|approve-scripts)\/?$/iu;
const REUSABLE_SCRIPT_ASSET_MUTATION_PATH = /^\/api\/ai-media-studio\/automation\/sources\/scripts\/assets\/?$/iu;
const JSON_DECOMPRESSION_ERROR_CODES = new Set([
  "Z_BUF_ERROR",
  "Z_DATA_ERROR",
  "Z_NEED_DICT",
  "Z_STREAM_ERROR",
]);

export function isProductionBatchMutationRequest(method: string | undefined, originalUrl: string | undefined): boolean {
  if (method !== "POST" || typeof originalUrl !== "string") return false;
  return PRODUCTION_BATCH_MUTATION_PATH.test(originalUrl.split("?", 1)[0] ?? "");
}

export function isReusableScriptAssetMutationRequest(method: string | undefined, originalUrl: string | undefined): boolean {
  if (method !== "POST" || typeof originalUrl !== "string") return false;
  return REUSABLE_SCRIPT_ASSET_MUTATION_PATH.test(originalUrl.split("?", 1)[0] ?? "");
}

export function isEarlyAuthenticatedJsonMutationRequest(
  method: string | undefined,
  originalUrl: string | undefined,
): boolean {
  return isProductionBatchMutationRequest(method, originalUrl)
    || isReusableScriptAssetMutationRequest(method, originalUrl);
}

export function requestHasRawQuery(originalUrl: string | undefined): boolean {
  return typeof originalUrl === "string" && originalUrl.includes("?");
}

export function onlyProductionBatchMutations(middleware: RequestHandler): RequestHandler {
  return (req, res, next) => isProductionBatchMutationRequest(req.method, req.originalUrl)
    ? middleware(req, res, next) : next();
}

export function exceptProductionBatchMutations(middleware: RequestHandler): RequestHandler {
  return (req, res, next) => isProductionBatchMutationRequest(req.method, req.originalUrl)
    ? next() : middleware(req, res, next);
}

export function onlyEarlyAuthenticatedJsonMutations(middleware: RequestHandler): RequestHandler {
  return (req, res, next) => isEarlyAuthenticatedJsonMutationRequest(req.method, req.originalUrl)
    ? middleware(req, res, next) : next();
}

export function exceptEarlyAuthenticatedJsonMutations(middleware: RequestHandler): RequestHandler {
  return (req, res, next) => isEarlyAuthenticatedJsonMutationRequest(req.method, req.originalUrl)
    ? next() : middleware(req, res, next);
}

/** Runs before body parsing so unauthenticated callers cannot exercise the JSON parser. */
export const requireAuthenticatedProductionBatchMutationBeforeBody: RequestHandler = (req, res, next) => {
  if (!isProductionBatchMutationRequest(req.method, req.originalUrl)) {
    next();
    return;
  }
  if (!resolveAuthenticatedUserId(req)) {
    res.status(401).json({ error: "Production batch mutation is not authorized", code: "UNAUTHENTICATED" });
    return;
  }
  next();
};

/** Runs before body parsing for every strict authenticated JSON mutation. */
export const requireAuthenticatedJsonMutationBeforeBody: RequestHandler = (req, res, next) => {
  if (!isEarlyAuthenticatedJsonMutationRequest(req.method, req.originalUrl)) {
    next();
    return;
  }
  if (!resolveAuthenticatedUserId(req)) {
    res.status(401).json({
      error: isProductionBatchMutationRequest(req.method, req.originalUrl)
        ? "Production batch mutation is not authorized"
        : "AI Media Studio mutation is not authorized",
      code: "UNAUTHENTICATED",
    });
    return;
  }
  next();
};

/** Prevent body-parser implementation details or request fragments from entering responses. */
export const sanitizeProductionBatchJsonParserError: ErrorRequestHandler = (error, req, res, next) => {
  if (!isProductionBatchMutationRequest(req.method, req.originalUrl) || !isJsonParserError(error)) {
    next(error);
    return;
  }
  const status = parserErrorStatus(error);
  res.status(status).json({
    error: status === 413 ? "Production batch JSON body is too large"
      : status === 415 ? "Production batch JSON body is unsupported"
        : "Production batch JSON body is invalid",
    code: status === 413 ? "JSON_BODY_TOO_LARGE"
      : status === 415 ? "UNSUPPORTED_JSON_BODY"
        : "INVALID_JSON_BODY",
  });
};

/** Prevents parser implementation details from leaking on strict authenticated JSON mutations. */
export const sanitizeAuthenticatedJsonMutationParserError: ErrorRequestHandler = (error, req, res, next) => {
  if (!isEarlyAuthenticatedJsonMutationRequest(req.method, req.originalUrl) || !isJsonParserError(error)) {
    next(error);
    return;
  }
  const status = parserErrorStatus(error);
  const label = isProductionBatchMutationRequest(req.method, req.originalUrl)
    ? "Production batch"
    : "AI Media Studio";
  res.status(status).json({
    error: status === 413 ? `${label} JSON body is too large`
      : status === 415 ? `${label} JSON body is unsupported`
        : `${label} JSON body is invalid`,
    code: status === 413 ? "JSON_BODY_TOO_LARGE"
      : status === 415 ? "UNSUPPORTED_JSON_BODY"
        : "INVALID_JSON_BODY",
  });
};

function isJsonParserError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; status?: unknown; statusCode?: unknown; type?: unknown };
  const knownBodyParserError = candidate.type === "charset.unsupported"
    || candidate.type === "encoding.unsupported"
    || candidate.type === "entity.parse.failed"
    || candidate.type === "entity.too.large"
    || candidate.type === "entity.verify.failed"
    || candidate.type === "request.aborted"
    || candidate.type === "request.size.invalid";
  if (knownBodyParserError) return true;
  const status = candidate.status ?? candidate.statusCode;
  return status === 400
    && typeof candidate.code === "string"
    && JSON_DECOMPRESSION_ERROR_CODES.has(candidate.code);
}

function parserErrorStatus(error: unknown): 400 | 413 | 415 {
  const type = (error as { type?: unknown }).type;
  return type === "entity.too.large" ? 413
    : type === "charset.unsupported" || type === "encoding.unsupported" ? 415
      : 400;
}

/**
 * User context for background jobs and connector callbacks that do not receive
 * an Express request. Request-bound APIs should use the authenticated request
 * user; schedulers and webhooks should prefer the owner from their stored
 * subscription/configuration. This fallback is only for explicit single-user
 * system jobs and local/dev data migration.
 */
export function getSystemUserId(): string {
  const configuredUserId = cleanUserId(process.env.DEFAULT_USER_ID);
  if (configuredUserId && hasRealValue(configuredUserId)) return configuredUserId;
  if (allowsDevUserFallback()) return DEFAULT_DEV_USER_ID;

  const error = new Error("DEFAULT_USER_ID is required for system jobs when dev fallback is disabled") as Error & { status?: number; statusCode?: number };
  error.status = 500;
  error.statusCode = 500;
  throw error;
}
