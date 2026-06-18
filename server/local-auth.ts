import type { Express, Request, Response } from "express";
import { z } from "zod";
import { storage } from "./storage";
import {
  createSignedLocalAuthCookieValue,
  DEFAULT_DEV_USER_ID,
  LOCAL_AUTH_USER_COOKIE_NAME,
  resolveCurrentUserId,
} from "./user-context";
import { createRateLimiter } from "./rate-limit";
import { hasRealValue } from "./ceo-doctor-cli";
import {
  hashPassword,
  isLocalAuthEnabled,
  isLocalAuthRegistrationAllowed,
  normalizeUsername,
  sanitizeAuthUser,
  verifyPassword,
} from "./local-auth-core";

export {
  hashPassword,
  isLocalAuthEnabled,
  isLocalAuthRegistrationAllowed,
  normalizeUsername,
  sanitizeAuthUser,
  verifyPassword,
};

type RequestWithSession = Request & {
  session?: {
    userId?: string;
    save?: (callback: (error?: Error) => void) => void;
    destroy?: (callback: (error?: Error) => void) => void;
  };
};

const authBodySchema = z.object({
  username: z.string().trim().min(2).max(80),
  password: z.string().min(8).max(200),
});
const LOCAL_AUTH_COOKIE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;
const localAuthRateLimit = createRateLimiter({
  scope: "local-auth",
  limit: 20,
  windowMs: 15 * 60 * 1000,
  persistentStore: storage,
  onPersistentError: (error) => {
    console.warn("[RateLimit] Persistent local-auth limiter unavailable; using in-memory fallback:", error instanceof Error ? error.message : error);
  },
});

function ensureSessionAvailable(req: RequestWithSession, res: Response): boolean {
  if (req.session) return true;
  res.status(500).json({ error: "Session middleware is not configured" });
  return false;
}

function localAuthCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
}

function setLocalAuthUserCookie(res: Response, userId: string): void {
  const value = createSignedLocalAuthCookieValue(userId);
  if (!value) return;

  res.cookie(LOCAL_AUTH_USER_COOKIE_NAME, value, {
    ...localAuthCookieOptions(),
    maxAge: LOCAL_AUTH_COOKIE_MAX_AGE_MS,
  });
}

function clearLocalAuthUserCookie(res: Response): void {
  res.clearCookie(LOCAL_AUTH_USER_COOKIE_NAME, localAuthCookieOptions());
}

function saveLocalAuthSession(req: RequestWithSession): Promise<void> {
  if (!req.session?.save) return Promise.resolve();

  return new Promise((resolve, reject) => {
    req.session?.save?.((error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export function registerLocalAuthRoutes(app: Express): void {
  app.get("/api/auth/me", async (req: RequestWithSession, res: Response) => {
    try {
      if (!req.session?.userId) {
        const resolvedUserId = resolveCurrentUserId(req);
        if (!resolvedUserId) {
          return res.status(401).json({ authenticated: false });
        }

        const user = await storage.getUser(resolvedUserId).catch(() => undefined);
        return res.json({
          authenticated: true,
          sessionBacked: false,
          usingDevFallback: resolvedUserId === DEFAULT_DEV_USER_ID && !hasRealValue(process.env.DEFAULT_USER_ID),
          user: user ? sanitizeAuthUser(user) : { id: resolvedUserId, username: resolvedUserId },
        });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        req.session.userId = undefined;
        return res.status(401).json({ authenticated: false });
      }

      res.json({ authenticated: true, sessionBacked: true, usingDevFallback: false, user: sanitizeAuthUser(user) });
    } catch (error) {
      res.status(500).json({ error: "Failed to get current user" });
    }
  });

  app.post("/api/auth/register", localAuthRateLimit, async (req: RequestWithSession, res: Response) => {
    try {
      if (!isLocalAuthEnabled() || !isLocalAuthRegistrationAllowed()) {
        return res.status(403).json({ error: "Local registration is disabled" });
      }
      if (!ensureSessionAvailable(req, res)) return;

      const body = authBodySchema.parse(req.body);
      const username = normalizeUsername(body.username);
      const existing = await storage.getUserByUsername(username);
      if (existing) {
        return res.status(409).json({ error: "Username already exists" });
      }

      const user = await storage.createUser({
        username,
        password: await hashPassword(body.password),
      });
      if (req.session) req.session.userId = user.id;
      setLocalAuthUserCookie(res, user.id);
      try {
        await saveLocalAuthSession(req);
      } catch {
        return res.status(500).json({ error: "Session save failed" });
      }
      res.status(201).json({ authenticated: true, sessionBacked: true, usingDevFallback: false, user: sanitizeAuthUser(user) });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to register user" });
    }
  });

  app.post("/api/auth/login", localAuthRateLimit, async (req: RequestWithSession, res: Response) => {
    try {
      if (!isLocalAuthEnabled()) {
        return res.status(403).json({ error: "Local auth is disabled" });
      }
      if (!ensureSessionAvailable(req, res)) return;

      const body = authBodySchema.parse(req.body);
      const user = await storage.getUserByUsername(normalizeUsername(body.username));
      if (!user || !(await verifyPassword(body.password, user.password))) {
        return res.status(401).json({ error: "Invalid username or password" });
      }

      if (req.session) req.session.userId = user.id;
      setLocalAuthUserCookie(res, user.id);
      try {
        await saveLocalAuthSession(req);
      } catch {
        return res.status(500).json({ error: "Session save failed" });
      }
      res.json({ authenticated: true, sessionBacked: true, usingDevFallback: false, user: sanitizeAuthUser(user) });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to login" });
    }
  });

  app.post("/api/auth/logout", (req: RequestWithSession, res: Response) => {
    clearLocalAuthUserCookie(res);
    if (!req.session?.destroy) {
      return res.json({ authenticated: false });
    }

    req.session.destroy((error?: Error) => {
      if (error) {
        return res.status(500).json({ error: "Failed to logout" });
      }
      res.json({ authenticated: false });
    });
  });
}
