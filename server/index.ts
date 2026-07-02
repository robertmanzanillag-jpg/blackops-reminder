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
import { startAppQaScheduler } from "./app-qa-agent";

const app = express();
const httpServer = createServer(app);

if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

app.get(["/health", "/api/health"], (_req, res) => {
  res.status(200).json({ status: "ok" });
});

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
    limit: '8mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "64kb", parameterLimit: 100 }));

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

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "blackops-reminder",
    checkedAt: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  });
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

function renderDropshippingPublicLegalHtml(title: string, body: string[]): string {
  const escapedTitle = title.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>${escapedTitle}</title>`,
    '<style>body{font-family:Inter,Arial,sans-serif;max-width:860px;margin:0 auto;padding:40px 20px;line-height:1.6;color:#18181b}h1,h2{line-height:1.2}.meta{color:#71717a}.notice{border:1px solid #d4d4d8;background:#fafafa;padding:16px;border-radius:8px}</style>',
    "</head>",
    "<body>",
    `<h1>${escapedTitle}</h1>`,
    '<p class="meta">Draft operating policy for Dropshipping CEO. Last updated: June 18, 2026.</p>',
    '<p class="notice">This policy is a starter template for a no-inventory dropshipping store. Final store name, legal entity, contact email, supplier terms, payment processor, and jurisdiction should be reviewed before public launch.</p>',
    ...body,
    "</body>",
    "</html>",
  ].join("\n");
}

app.get("/dropshipping/legal/privacy", (_req, res) => {
  res.type("html").send(renderDropshippingPublicLegalHtml("Dropshipping Store Privacy Policy", [
    "<p>This store collects customer information only as needed to process orders, provide support, prevent fraud, improve the shopping experience, and comply with legal obligations.</p>",
    "<h2>Information We Process</h2>",
    "<p>Order details may include name, shipping address, email, phone number, billing details handled by the payment processor, payment status, product selections, support messages, device/session data, and marketing attribution data.</p>",
    "<h2>Service Providers</h2>",
    "<p>We may share order and fulfillment information with ecommerce, payment, shipping, analytics, email, advertising, and dropshipping supplier tools only when needed to operate the store.</p>",
    "<h2>Supplier Fulfillment</h2>",
    "<p>Because the store uses supplier fulfillment, limited order details may be shared with the supplier or fulfillment partner so the order can be shipped and tracked.</p>",
    "<h2>Marketing</h2>",
    "<p>Email, SMS, retargeting, and social advertising should run only after the customer has provided the required consent or where allowed by applicable law and platform policy.</p>",
    "<h2>Retention And Security</h2>",
    "<p>Order and support records should be retained only as long as needed for accounting, fraud prevention, legal compliance, customer support, and platform requirements. Tokens and secrets must not be exposed in public reports.</p>",
    "<h2>Customer Requests</h2>",
    "<p>Customers can request access, correction, deletion, or opt-out support through the store contact channel once configured.</p>",
  ]));
});

app.get("/dropshipping/legal/refund-policy", (_req, res) => {
  res.type("html").send(renderDropshippingPublicLegalHtml("Dropshipping Store Refund Policy", [
    "<p>Refunds and replacements are handled case by case. The store should clearly disclose shipping times, item condition requirements, and evidence needed before launch.</p>",
    "<h2>Cancellation Before Shipment</h2>",
    "<p>If an order cannot be shipped within the stated shipping window or a lawful delay notice cannot be completed, the customer should be offered cancellation and a prompt refund before the item ships.</p>",
    "<h2>Damaged Or Incorrect Items</h2>",
    "<p>Customers should contact support with the order number, photos or video, packaging evidence, and a short description of the issue within the posted return window.</p>",
    "<h2>Change Of Mind</h2>",
    "<p>Change-of-mind returns may be limited by supplier and product type. Any customer-paid return shipping should be clearly disclosed before checkout.</p>",
    "<h2>Non-Returnable Items</h2>",
    "<p>Hygiene, personalized, final-sale, used, or safety-sensitive items may be non-returnable when allowed by law and clearly disclosed.</p>",
    "<h2>Refund Timing</h2>",
    "<p>Approved refunds should be returned to the original payment method after inspection, supplier confirmation, cancellation, or delay handling, subject to payment processor timelines.</p>",
  ]));
});

app.get("/dropshipping/legal/shipping-policy", (_req, res) => {
  res.type("html").send(renderDropshippingPublicLegalHtml("Dropshipping Store Shipping Policy", [
    "<p>This store uses supplier fulfillment and does not hold bulk inventory. Shipping estimates must be displayed clearly on each product page before launch.</p>",
    "<h2>Processing Time</h2>",
    "<p>Orders should be reviewed for payment, fraud, address quality, supplier availability, and fulfillment approval before shipment. The shipment clock should be measured from a properly completed paid order.</p>",
    "<h2>Transit Time</h2>",
    "<p>Transit times vary by supplier, destination, carrier, customs, and seasonal demand. Product pages should show estimated ranges, not guaranteed delivery dates unless verified.</p>",
    "<h2>Delay Handling</h2>",
    "<p>If the store learns it cannot ship within the represented time, support should notify the customer quickly, provide a revised shipment date when available, and offer cancellation with a prompt refund where required.</p>",
    "<h2>Tracking</h2>",
    "<p>Tracking should be provided when available from the supplier or fulfillment partner. If tracking is delayed, customer support should communicate the current order state.</p>",
    "<h2>Customs And Duties</h2>",
    "<p>International customers may be responsible for customs, import taxes, duties, and local fees unless the checkout clearly states otherwise.</p>",
  ]));
});

app.get("/dropshipping/legal/terms", (_req, res) => {
  res.type("html").send(renderDropshippingPublicLegalHtml("Dropshipping Store Terms of Service", [
    "<p>These terms describe the starter operating rules for a no-inventory ecommerce store using supplier fulfillment.</p>",
    "<h2>Product Information</h2>",
    "<p>Product descriptions, photos, prices, availability, shipping estimates, and promotions should be accurate, current, and free of unsupported claims.</p>",
    "<h2>Orders</h2>",
    "<p>The store may refuse, cancel, or hold an order for fraud review, unavailable supplier stock, pricing errors, shipping restrictions, or policy violations.</p>",
    "<h2>No Medical Or Unsupported Claims</h2>",
    "<p>Marketing copy must not promise health, safety, legal, financial, or performance outcomes without reliable evidence and required approvals.</p>",
    "<h2>Limitation</h2>",
    "<p>The final public terms should be reviewed for the store jurisdiction, payment processor, supplier agreements, platform policies, and consumer protection rules.</p>",
  ]));
});

app.get("/dropshipping/legal/checkout-readiness", (_req, res) => {
  res.type("html").send(renderDropshippingPublicLegalHtml("Dropshipping Checkout Readiness Checklist", [
    "<p>This checklist is for pre-account setup. It becomes complete only after Shopify, payment processing, supplier operations, and tracking are connected and tested.</p>",
    "<h2>Before Enabling Checkout</h2>",
    "<ul><li>Product page shows price, estimated shipping range, return/refund link, privacy link, terms link, support contact, and no unsupported claims.</li><li>Shipping estimate has supplier evidence and a reasonable basis.</li><li>Payment processor is connected in test mode or live mode as appropriate.</li><li>Tax, shipping, discount, abandoned checkout, and order confirmation settings are reviewed.</li><li>Supplier primary and backup are documented before paid traffic.</li></ul>",
    "<h2>Test Order</h2>",
    "<ul><li>Create one test checkout with a low-risk product draft.</li><li>Verify payment authorization, receipt, order status, customer email, shipping address, tax/shipping display, refund path, and cancellation path.</li><li>Do not send supplier fulfillment until the order is paid and approval is recorded.</li></ul>",
    "<h2>First Live Order Guardrail</h2>",
    "<p>For the first real order, fulfillment must stay approval-required. The team should verify payment captured, product margin positive, supplier stock available, tracking available, and customer promise still accurate.</p>",
  ]));
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

const LOG_BODY_LIMIT = 700;
const LOG_STRING_LIMIT = 160;
const LOG_ARRAY_LIMIT = 3;
const LOG_OBJECT_KEY_LIMIT = 16;
const SENSITIVE_LOG_KEY_PATTERN = /(access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|secret|password|authorization|cookie|encryptedPayload|api[_-]?key|private[_-]?key)/i;

function redactLogString(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/(access_token|refresh_token|id_token|client_secret|api_key)=([^&\s]+)/gi, "$1=[redacted]")
    .replace(/(access_token|refresh_token|id_token|client_secret|api_key)"\s*:\s*"[^"]+"/gi, '$1":"[redacted]"');
}

function summarizeJsonForLog(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    const redacted = redactLogString(value);
    return redacted.length > LOG_STRING_LIMIT ? `${redacted.slice(0, LOG_STRING_LIMIT)}...[truncated ${redacted.length - LOG_STRING_LIMIT} chars]` : redacted;
  }
  if (Array.isArray(value)) {
    const sample = value.slice(0, LOG_ARRAY_LIMIT).map((item) => summarizeJsonForLog(item, depth + 1));
    return value.length > LOG_ARRAY_LIMIT ? [...sample, `[${value.length - LOG_ARRAY_LIMIT} more items]`] : sample;
  }
  if (typeof value === "object") {
    if (depth >= 4) return "[max depth]";
    const entries = Object.entries(value as Record<string, unknown>);
    const summarized: Record<string, unknown> = {};
    for (const [key, item] of entries.slice(0, LOG_OBJECT_KEY_LIMIT)) {
      summarized[key] = SENSITIVE_LOG_KEY_PATTERN.test(key) ? "[redacted]" : summarizeJsonForLog(item, depth + 1);
    }
    if (entries.length > LOG_OBJECT_KEY_LIMIT) summarized.__omittedKeys = entries.length - LOG_OBJECT_KEY_LIMIT;
    return summarized;
  }
  return String(value);
}

function formatJsonForLog(value: unknown): string {
  const text = JSON.stringify(summarizeJsonForLog(value));
  return text.length > LOG_BODY_LIMIT ? `${text.slice(0, LOG_BODY_LIMIT)}...[truncated ${text.length - LOG_BODY_LIMIT} chars]` : text;
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: unknown;

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
        logLine += ` :: ${formatJsonForLog(capturedJsonResponse)}`;
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
      startAppQaScheduler();
      
      runStartupTaskDeduplication().catch(err => {
        log(`Failed to deduplicate startup tasks: ${err.message}`, "tasks");
      });

      if (process.env.TELEGRAM_AUTO_SETUP_WEBHOOK === "true") {
        setupTelegramWebhook().then(result => {
          if (result.success) {
            log(`Telegram webhook configured: ${result.message}`, "telegram");
          } else {
            log(`Telegram webhook setup failed: ${result.message}`, "telegram");
          }
        }).catch(err => {
          log(`Telegram webhook error: ${err.message}`, "telegram");
        });
      } else {
        log("Telegram webhook auto-setup skipped; run `npm run telegram:webhook -- setup --execute` when ready", "telegram");
      }
    },
  );
})();
