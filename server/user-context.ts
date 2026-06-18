import type { NextFunction, Request, Response } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";

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

const PUBLIC_API_PATTERNS = [
  /^\/api\/clippers\/oauth\/[^/]+\/callback$/,
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

export function resolveCurrentUserId(req: Request): string | null {
  const authReq = req as RequestWithAuth;
  const requestFallbackAllowed = allowsDevUserFallback();

  return (
    cleanUserId(authReq.user?.id) ||
    cleanUserId(authReq.user?.userId) ||
    cleanUserId(authReq.user?.sub) ||
    cleanUserId(authReq.session?.userId) ||
    cleanUserId(authReq.session?.user?.id) ||
    cleanUserId(authReq.session?.user?.userId) ||
    cleanUserId(authReq.session?.user?.sub) ||
    readSignedLocalAuthCookie(req) ||
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

/**
 * User context for background jobs and connector callbacks that do not receive
 * an Express request yet. Robert's existing data remains under mock-user-123
 * until real auth maps jobs/webhooks to a stored user owner.
 *
 * TODO(auth): Route each scheduler, webhook, and integration event to the user
 * who owns the subscription/configuration instead of this single-user fallback.
 */
export function getSystemUserId(): string {
  const configuredUserId = cleanUserId(process.env.DEFAULT_USER_ID);
  if (configuredUserId) return configuredUserId;
  if (allowsDevUserFallback()) return DEFAULT_DEV_USER_ID;

  const error = new Error("DEFAULT_USER_ID is required for system jobs when dev fallback is disabled") as Error & { status?: number; statusCode?: number };
  error.status = 500;
  error.statusCode = 500;
  throw error;
}
