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

function renderClipperPublicLegalHtml(title: string, body: string[]): string {
  const escapedTitle = title.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>${escapedTitle}</title>`,
    '<style>body{font-family:Inter,Arial,sans-serif;max-width:860px;margin:0 auto;padding:40px 20px;line-height:1.6;color:#18181b}h1,h2{line-height:1.2}.meta{color:#71717a}</style>',
    "</head>",
    "<body>",
    `<h1>${escapedTitle}</h1>`,
    '<p class="meta">Last updated: June 17, 2026</p>',
    ...body,
    "</body>",
    "</html>",
  ].join("\n");
}

app.get("/clippers/legal/privacy", (_req, res) => {
  res.type("html").send(renderClipperPublicLegalHtml("Clippers Privacy Policy", [
    "<p>Clippers is an internal short-form content operations system for preparing, reviewing, scheduling, and reporting on social video workflows for accounts we own or manage.</p>",
    "<h2>Information We Process</h2>",
    "<p>The system may process account names, platform handles, OAuth authorization metadata, encrypted platform tokens, upload metadata, draft captions, content source records, permission evidence references, and performance metrics imported by an operator.</p>",
    "<h2>How Information Is Used</h2>",
    "<p>Information is used to verify account readiness, confirm publishing permissions, prevent unauthorized content use, prepare drafts, run approval-required publishing workflows, and measure content performance.</p>",
    "<h2>Tokens And Secrets</h2>",
    "<p>OAuth tokens are stored encrypted server-side when configured. Plaintext tokens and secrets are not displayed in reports or policy artifacts.</p>",
    "<h2>Content Rights</h2>",
    "<p>Third-party footage is blocked unless an allowlist or evidence record confirms ownership, license, official-source use, or creator/rightsholder permission.</p>",
    "<h2>Data Sharing</h2>",
    "<p>Data is shared with TikTok, Meta/Instagram, YouTube/Google, and storage providers only as needed to authenticate accounts, submit approved content, or operate connected workflows authorized by the account owner.</p>",
  ]));
});

app.get("/clippers/legal/terms", (_req, res) => {
  res.type("html").send(renderClipperPublicLegalHtml("Clippers Terms of Service", [
    "<p>These terms describe the operational rules for using Clippers to prepare and publish short-form video content for owned or managed social accounts.</p>",
    "<h2>Authorized Use</h2>",
    "<p>Operators may use Clippers only for accounts they own, manage, or have explicit authorization to operate. Platform terms, creator permissions, and applicable laws must be followed.</p>",
    "<h2>Publishing Controls</h2>",
    "<p>New accounts and workflows must remain in approval-required mode until credentials, permissions, content rights, and quality checks are verified.</p>",
    "<h2>Content Rights</h2>",
    "<p>Operators must not publish copyrighted, private, or third-party content without a valid ownership, license, official source, or creator/rightsholder permission record.</p>",
    "<h2>Platform APIs</h2>",
    "<p>Use of TikTok, Meta/Instagram, YouTube/Google, and other platform APIs must comply with each platform's developer policies, app review requirements, rate limits, and user consent requirements.</p>",
  ]));
});

app.get("/clippers/review-demo", (_req, res) => {
  res.type("html").send([
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    "<title>Clippers App Review Demo</title>",
    '<style>body{font-family:Inter,Arial,sans-serif;margin:0;background:#09090b;color:#f4f4f5}main{max-width:980px;margin:0 auto;padding:40px 20px 56px}.hero,.card{border:1px solid #27272a;background:#18181b;border-radius:8px;padding:24px;margin:14px 0}h1,h2{line-height:1.15}p,li{line-height:1.65;color:#d4d4d8}a{color:#67e8f9}.tag{color:#a7f3d0;font-size:12px}</style>',
    "</head>",
    "<body>",
    "<main>",
    '<section class="hero">',
    '<p class="tag">Public reviewer demo, no login required</p>',
    "<h1>Clippers App Review Demo</h1>",
    "<p>Clippers is a short-form content operations system for accounts we own or manage. It prepares clips, verifies rights evidence, runs OAuth-based account authorization, keeps publishing approval-gated, and reports performance for optimization.</p>",
    "<p>This demo page is read-only. It does not expose tokens, secrets, private user data, or live publishing controls.</p>",
    "</section>",
    '<section class="card">',
    "<h2>Reviewer Walkthrough</h2>",
    "<ol>",
    "<li>Review platform setup status, credential readiness, and permission blockers.</li>",
    "<li>Confirm rights evidence before any source item can move to publishing.</li>",
    "<li>Connect TikTok through OAuth after app review, scopes, redirect URI, and public policies are prepared.</li>",
    "<li>Prepare a draft package for operator approval before posting.</li>",
    "<li>Import performance metrics after publication to improve planning without bypassing safety gates.</li>",
    "</ol>",
    "</section>",
    '<section class="card">',
    "<h2>Public Policy Links</h2>",
    '<p><a href="/clippers/legal/privacy">Privacy Policy</a> · <a href="/clippers/legal/terms">Terms of Service</a></p>',
    "</section>",
    "</main>",
    "</body>",
    "</html>",
  ].join("\n"));
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
