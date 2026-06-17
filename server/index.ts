import "./env-loader";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { startReminderScheduler } from "./reminder-scheduler";
import { startHealthCheckScheduler } from "./health-check";
import { startMarketNewsScheduler } from "./market-news";
import { setupTelegramWebhook } from "./telegram-chat";
import { storage } from "./storage";
import { getSystemUserId, requireAppUser } from "./user-context";
import { registerLocalAuthRoutes } from "./local-auth";
import { createSessionMiddleware, resolveSessionRuntimeSettings } from "./session-config";
import { startPromoVideoDailyScheduler } from "./promo-video-agent";
import { startCybersecurityScheduler } from "./cybersecurity-agent";

const app = express();
const httpServer = createServer(app);

async function getStartupMaintenanceUserIds(): Promise<string[]> {
  const configuredOwners = (await storage.getEnabledTelegramConfigs())
    .map((config) => config.userId)
    .filter((userId): userId is string => Boolean(userId));
  const uniqueOwners = Array.from(new Set(configuredOwners));
  return uniqueOwners.length ? uniqueOwners : [getSystemUserId()];
}

async function runStartupTaskDeduplication(): Promise<void> {
  const userIds = await getStartupMaintenanceUserIds();
  await Promise.all(userIds.map(async (userId) => {
    const [weeklyRemoved, mainRemoved] = await Promise.all([
      storage.deduplicateRecurringTasks(userId),
      storage.deduplicateMainTasks(userId),
    ]);
    if (weeklyRemoved > 0) {
      log(`Cleaned up ${weeklyRemoved} duplicate weekly tasks for ${userId}`, "weekly-tasks");
    }
    if (mainRemoved > 0) {
      log(`Cleaned up ${mainRemoved} duplicate main tasks for ${userId}`, "tasks");
    }
  }));
}

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: '50mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

app.get("/tiktokzjohuZmzXSsUwXRmI6fqM3JDKo7jsLUN.txt", (_req, res) => {
  res
    .type("text/plain")
    .send("tiktok-developers-site-verification=zjohuZmzXSsUwXRmI6fqM3JDKo7jsLUN\n");
});

app.get("/tiktokxXFfBZAFcOIGUKNMLUhs8E9M66NBKXCP.txt", (_req, res) => {
  res
    .type("text/plain")
    .send("tiktok-developers-site-verification=xXFfBZAFcOIGUKNMLUhs8E9M66NBKXCP\n");
});

const sessionSettings = resolveSessionRuntimeSettings();
const sessionMiddleware = createSessionMiddleware(sessionSettings);
if (sessionMiddleware) {
  app.use(sessionMiddleware);
  log(`Session auth enabled with ${sessionSettings.storeKind} store`, "auth");
} else {
  log("SESSION_SECRET not configured; local session auth is disabled", "auth");
}

app.use(requireAppUser);

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  registerLocalAuthRoutes(app);
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  const host = process.env.HOST || "0.0.0.0";
  httpServer.listen(
    {
      port,
      host,
      reusePort: host === "0.0.0.0",
    },
    () => {
      log(`serving on ${host}:${port}`);
      startReminderScheduler();
      startHealthCheckScheduler();
      startMarketNewsScheduler();
      startPromoVideoDailyScheduler();
      startCybersecurityScheduler();
      
      runStartupTaskDeduplication().catch(err => {
        log(`Failed to deduplicate startup tasks: ${err.message}`, "tasks");
      });

      // Setup Telegram webhook for chat
      setupTelegramWebhook().then(result => {
        if (result.success) {
          log(`Telegram webhook configured: ${result.message}`, "telegram");
        } else {
          log(`Telegram webhook setup failed: ${result.message}`, "telegram");
        }
      }).catch(err => {
        log(`Telegram webhook error: ${err.message}`, "telegram");
      });
    },
  );
})();
