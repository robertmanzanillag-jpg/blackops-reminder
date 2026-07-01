import assert from "node:assert/strict";
import test from "node:test";
import { buildRevenueMoneyReadinessReport } from "../server/revenue-engine";
import {
  formatRevenueMoneyReadinessText,
  isRevenueMoneyModePlaceholder,
  parseRevenueMoneyReadinessArgs,
  validateRevenueMoneyReadinessOptions,
} from "../server/revenue-money-readiness-cli";

const originalEnv = {
  DATABASE_URL: process.env.DATABASE_URL,
  SESSION_SECRET: process.env.SESSION_SECRET,
  REVENUE_ENGINE_MONEY_MODE: process.env.REVENUE_ENGINE_MONEY_MODE,
  REVENUE_ENGINE_ROBERT_CONTACT_APPROVED: process.env.REVENUE_ENGINE_ROBERT_CONTACT_APPROVED,
  REVENUE_ENGINE_MANUAL_CONTACT_APPROVED: process.env.REVENUE_ENGINE_MANUAL_CONTACT_APPROVED,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  REVENUE_ENGINE_STRIPE_CHECKOUT_ENABLED: process.env.REVENUE_ENGINE_STRIPE_CHECKOUT_ENABLED,
  REVENUE_ENGINE_PAYMENT_LINK: process.env.REVENUE_ENGINE_PAYMENT_LINK,
  REVENUE_ENGINE_PAYMENT_LINK_APPROVED_BY_ROBERT: process.env.REVENUE_ENGINE_PAYMENT_LINK_APPROVED_BY_ROBERT,
  REVENUE_ENGINE_PAYMENT_LINK_ALLOWED_HOSTS: process.env.REVENUE_ENGINE_PAYMENT_LINK_ALLOWED_HOSTS,
  REVENUE_ENGINE_PAYMENT_SMOKE_VERIFIED: process.env.REVENUE_ENGINE_PAYMENT_SMOKE_VERIFIED,
  REVENUE_ENGINE_DEPOSIT_CONFIRMED_BY_ROBERT: process.env.REVENUE_ENGINE_DEPOSIT_CONFIRMED_BY_ROBERT,
  REVENUE_ENGINE_WEBSITE_DEPLOY_ENABLED: process.env.REVENUE_ENGINE_WEBSITE_DEPLOY_ENABLED,
  REVENUE_ENGINE_WEBSITE_APP_QA_TARGET_PASSED: process.env.REVENUE_ENGINE_WEBSITE_APP_QA_TARGET_PASSED,
  REVENUE_ENGINE_WEBSITE_PREVIEW_DEPLOY_VERIFIED: process.env.REVENUE_ENGINE_WEBSITE_PREVIEW_DEPLOY_VERIFIED,
  REVENUE_ENGINE_WEBSITE_ROLLBACK_VERIFIED: process.env.REVENUE_ENGINE_WEBSITE_ROLLBACK_VERIFIED,
  REVENUE_ENGINE_WEBSITE_PUBLISH_APPROVED_BY_ROBERT: process.env.REVENUE_ENGINE_WEBSITE_PUBLISH_APPROVED_BY_ROBERT,
  REVENUE_ENGINE_DEPLOY_APPROVED_BY_ROBERT: process.env.REVENUE_ENGINE_DEPLOY_APPROVED_BY_ROBERT,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test.afterEach(restoreEnv);

test("parses revenue money readiness CLI options", () => {
  assert.deepEqual(parseRevenueMoneyReadinessArgs([]), { mode: "first-sprint", json: false });
  assert.deepEqual(parseRevenueMoneyReadinessArgs(["--mode=production-launch", "--json"]), { mode: "production-launch", json: true });
  assert.deepEqual(validateRevenueMoneyReadinessOptions(parseRevenueMoneyReadinessArgs([])), []);
  assert.deepEqual(validateRevenueMoneyReadinessOptions(parseRevenueMoneyReadinessArgs(["--mode=banana"])), [
    "--mode must be first-sprint or production-launch.",
  ]);
});

test("reports dry-run research mode until production money blockers are configured", () => {
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  delete process.env.REVENUE_ENGINE_MONEY_MODE;
  delete process.env.REVENUE_ENGINE_ROBERT_CONTACT_APPROVED;
  delete process.env.REVENUE_ENGINE_MANUAL_CONTACT_APPROVED;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.REVENUE_ENGINE_STRIPE_CHECKOUT_ENABLED;
  delete process.env.REVENUE_ENGINE_PAYMENT_LINK;
  delete process.env.REVENUE_ENGINE_PAYMENT_LINK_APPROVED_BY_ROBERT;
  delete process.env.REVENUE_ENGINE_PAYMENT_LINK_ALLOWED_HOSTS;
  delete process.env.REVENUE_ENGINE_PAYMENT_SMOKE_VERIFIED;
  delete process.env.REVENUE_ENGINE_DEPOSIT_CONFIRMED_BY_ROBERT;
  delete process.env.REVENUE_ENGINE_WEBSITE_DEPLOY_ENABLED;
  delete process.env.REVENUE_ENGINE_WEBSITE_APP_QA_TARGET_PASSED;
  delete process.env.REVENUE_ENGINE_WEBSITE_PREVIEW_DEPLOY_VERIFIED;
  delete process.env.REVENUE_ENGINE_WEBSITE_ROLLBACK_VERIFIED;
  delete process.env.REVENUE_ENGINE_WEBSITE_PUBLISH_APPROVED_BY_ROBERT;
  delete process.env.REVENUE_ENGINE_DEPLOY_APPROVED_BY_ROBERT;

  const report = buildRevenueMoneyReadinessReport({ mode: "first-sprint" });

  assert.equal(report.ready, false);
  assert.equal(report.status, "dry_run_research_only");
  assert.equal(report.canStartToday, true);
  assert.equal(report.canSearchBusinesses, true);
  assert.equal(report.canAutonomousSearchBusinesses, false);
  assert.equal(report.canContactBusinesses, false);
  assert.equal(report.canCollectMoney, false);
  assert.equal(report.canBuildWebsites, false);
  assert.equal(report.nextApiAction, "/api/revenue-engine/scout-dispatch");
  assert.equal(report.checks.find((check) => check.id === "safe_public_research")?.status, "ok");
  assert.equal(report.checks.find((check) => check.id === "autonomous_business_search")?.status, "fail");
  assert.equal(report.checks.find((check) => check.id === "production_persistence")?.status, "fail");
  assert.ok(report.blockedUntil.some((item) => item.includes("Postgres")));
});

test("keeps website publishing blocked even when contact and payments are configured", () => {
  process.env.DATABASE_URL = "postgres://ceo_user:real-pass@db.internal:5432/blackops";
  process.env.SESSION_SECRET = "a-production-session-secret-32-chars";
  process.env.REVENUE_ENGINE_MONEY_MODE = "live";
  process.env.REVENUE_ENGINE_ROBERT_CONTACT_APPROVED = "true";
  process.env.REVENUE_ENGINE_MANUAL_CONTACT_APPROVED = "true";
  process.env.REVENUE_ENGINE_PAYMENT_LINK = "https://buy.stripe.com/revenue-deposit";
  process.env.REVENUE_ENGINE_PAYMENT_LINK_APPROVED_BY_ROBERT = "true";
  process.env.REVENUE_ENGINE_PAYMENT_SMOKE_VERIFIED = "true";
  delete process.env.REVENUE_ENGINE_WEBSITE_DEPLOY_ENABLED;
  delete process.env.REVENUE_ENGINE_WEBSITE_APP_QA_TARGET_PASSED;
  delete process.env.REVENUE_ENGINE_WEBSITE_PREVIEW_DEPLOY_VERIFIED;
  delete process.env.REVENUE_ENGINE_WEBSITE_ROLLBACK_VERIFIED;
  delete process.env.REVENUE_ENGINE_WEBSITE_PUBLISH_APPROVED_BY_ROBERT;
  delete process.env.REVENUE_ENGINE_DEPLOY_APPROVED_BY_ROBERT;

  const report = buildRevenueMoneyReadinessReport({ mode: "production-launch" });

  assert.equal(report.canContactBusinesses, true);
  assert.equal(report.canCollectMoney, true);
  assert.equal(report.canBuildWebsites, false);
  assert.equal(report.ready, false);
  assert.equal(report.checks.find((check) => check.id === "website_build_pipeline")?.status, "fail");
  assert.equal(report.checks.find((check) => check.id === "production_launch")?.status, "fail");
});

test("does not treat test Stripe keys or malformed payment links as live collection", () => {
  process.env.DATABASE_URL = "postgres://ceo_user:real-pass@db.internal:5432/blackops";
  process.env.SESSION_SECRET = "a-production-session-secret-32-chars";
  process.env.REVENUE_ENGINE_MONEY_MODE = "live";
  process.env.REVENUE_ENGINE_ROBERT_CONTACT_APPROVED = "true";
  process.env.REVENUE_ENGINE_MANUAL_CONTACT_APPROVED = "true";
  process.env.STRIPE_SECRET_KEY = ["sk", "test", "123"].join("_");
  process.env.REVENUE_ENGINE_PAYMENT_LINK = "not-a-url";
  process.env.REVENUE_ENGINE_PAYMENT_LINK_APPROVED_BY_ROBERT = "true";

  const report = buildRevenueMoneyReadinessReport({ mode: "first-sprint" });

  assert.equal(report.canContactBusinesses, true);
  assert.equal(report.canCollectMoney, false);
  assert.equal(report.ready, false);
  assert.equal(report.checks.find((check) => check.id === "collect_money")?.status, "fail");
});

test("requires explicit true before manual contact is considered approved", () => {
  process.env.DATABASE_URL = "postgres://ceo_user:real-pass@db.internal:5432/blackops";
  process.env.SESSION_SECRET = "a-production-session-secret-32-chars";
  process.env.REVENUE_ENGINE_MONEY_MODE = "live";
  process.env.REVENUE_ENGINE_ROBERT_CONTACT_APPROVED = "true";
  process.env.REVENUE_ENGINE_MANUAL_CONTACT_APPROVED = "false";
  process.env.REVENUE_ENGINE_PAYMENT_LINK = "https://buy.stripe.com/revenue-deposit";
  process.env.REVENUE_ENGINE_PAYMENT_LINK_APPROVED_BY_ROBERT = "true";
  process.env.REVENUE_ENGINE_PAYMENT_SMOKE_VERIFIED = "true";

  const report = buildRevenueMoneyReadinessReport({ mode: "first-sprint" });

  assert.equal(report.canContactBusinesses, false);
  assert.equal(report.canCollectMoney, true);
  assert.equal(report.ready, false);
  assert.equal(report.checks.find((check) => check.id === "contact_businesses")?.status, "fail");
});

test("requires Robert-approved payment link or enabled live Stripe checkout before collecting money", () => {
  process.env.DATABASE_URL = "postgres://ceo_user:real-pass@db.internal:5432/blackops";
  process.env.SESSION_SECRET = "a-production-session-secret-32-chars";
  process.env.REVENUE_ENGINE_MONEY_MODE = "live";
  process.env.REVENUE_ENGINE_PAYMENT_LINK = "https://not-stripe.invalid/pay-me";
  delete process.env.REVENUE_ENGINE_PAYMENT_LINK_APPROVED_BY_ROBERT;
  process.env.STRIPE_SECRET_KEY = ["sk", "live", "123"].join("_");
  delete process.env.REVENUE_ENGINE_STRIPE_CHECKOUT_ENABLED;

  const blocked = buildRevenueMoneyReadinessReport({ mode: "first-sprint" });
  assert.equal(blocked.canCollectMoney, false);

  process.env.REVENUE_ENGINE_STRIPE_CHECKOUT_ENABLED = "true";
  const readyWithCheckout = buildRevenueMoneyReadinessReport({ mode: "first-sprint" });
  assert.equal(readyWithCheckout.canCollectMoney, false);

  process.env.REVENUE_ENGINE_PAYMENT_SMOKE_VERIFIED = "true";
  const weakLiveKey = buildRevenueMoneyReadinessReport({ mode: "first-sprint" });
  assert.equal(weakLiveKey.canCollectMoney, false);

  process.env.STRIPE_SECRET_KEY = ["sk", "live", "1234567890abcdef1234567890"].join("_");
  const verifiedCheckout = buildRevenueMoneyReadinessReport({ mode: "first-sprint" });
  assert.equal(verifiedCheckout.canCollectMoney, true);
});

test("rejects local database URLs for production persistence", () => {
  process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/blackops";
  process.env.SESSION_SECRET = "a-production-session-secret-32-chars";
  process.env.REVENUE_ENGINE_MONEY_MODE = "live";
  process.env.REVENUE_ENGINE_ROBERT_CONTACT_APPROVED = "true";
  process.env.REVENUE_ENGINE_MANUAL_CONTACT_APPROVED = "true";
  process.env.REVENUE_ENGINE_PAYMENT_LINK = "https://buy.stripe.com/revenue-deposit";
  process.env.REVENUE_ENGINE_PAYMENT_LINK_APPROVED_BY_ROBERT = "true";
  process.env.REVENUE_ENGINE_PAYMENT_SMOKE_VERIFIED = "true";

  const report = buildRevenueMoneyReadinessReport({ mode: "first-sprint" });

  assert.equal(report.ready, false);
  assert.equal(report.checks.find((check) => check.id === "production_persistence")?.status, "fail");
  assert.ok(report.blockedUntil.some((item) => item.includes("production Postgres")));

  process.env.DATABASE_URL = "postgres://user:pass@[::1]:5432/blackops";
  const ipv6Local = buildRevenueMoneyReadinessReport({ mode: "first-sprint" });
  assert.equal(ipv6Local.ready, false);
  assert.equal(ipv6Local.checks.find((check) => check.id === "production_persistence")?.status, "fail");
});

test("requires payment smoke or deposit evidence before collecting money", () => {
  process.env.DATABASE_URL = "postgres://ceo_user:real-pass@db.internal:5432/blackops";
  process.env.SESSION_SECRET = "a-production-session-secret-32-chars";
  process.env.REVENUE_ENGINE_MONEY_MODE = "live";
  process.env.REVENUE_ENGINE_PAYMENT_LINK = "https://buy.stripe.com/revenue-deposit";
  process.env.REVENUE_ENGINE_PAYMENT_LINK_APPROVED_BY_ROBERT = "true";

  const blocked = buildRevenueMoneyReadinessReport({ mode: "first-sprint" });
  assert.equal(blocked.canCollectMoney, false);

  process.env.REVENUE_ENGINE_DEPOSIT_CONFIRMED_BY_ROBERT = "true";
  const confirmed = buildRevenueMoneyReadinessReport({ mode: "first-sprint" });
  assert.equal(confirmed.canCollectMoney, true);
});

test("requires an allowed payment host for approved payment links", () => {
  process.env.DATABASE_URL = "postgres://ceo_user:real-pass@db.internal:5432/blackops";
  process.env.SESSION_SECRET = "a-production-session-secret-32-chars";
  process.env.REVENUE_ENGINE_MONEY_MODE = "live";
  process.env.REVENUE_ENGINE_PAYMENT_LINK = "https://not-stripe.invalid/pay-me";
  process.env.REVENUE_ENGINE_PAYMENT_LINK_APPROVED_BY_ROBERT = "true";
  process.env.REVENUE_ENGINE_PAYMENT_SMOKE_VERIFIED = "true";

  const blocked = buildRevenueMoneyReadinessReport({ mode: "first-sprint" });
  assert.equal(blocked.canCollectMoney, false);

  process.env.REVENUE_ENGINE_PAYMENT_LINK_ALLOWED_HOSTS = "not-stripe.invalid";
  const approvedCustomHost = buildRevenueMoneyReadinessReport({ mode: "first-sprint" });
  assert.equal(approvedCustomHost.canCollectMoney, true);
});

test("first sprint readiness can be ready while production-only gaps remain", () => {
  process.env.DATABASE_URL = "postgres://ceo_user:real-pass@db.internal:5432/blackops";
  process.env.SESSION_SECRET = "a-production-session-secret-32-chars";
  process.env.REVENUE_ENGINE_MONEY_MODE = "live";
  process.env.REVENUE_ENGINE_ROBERT_CONTACT_APPROVED = "true";
  process.env.REVENUE_ENGINE_MANUAL_CONTACT_APPROVED = "true";
  process.env.REVENUE_ENGINE_PAYMENT_LINK = "https://buy.stripe.com/revenue-deposit";
  process.env.REVENUE_ENGINE_PAYMENT_LINK_APPROVED_BY_ROBERT = "true";
  process.env.REVENUE_ENGINE_PAYMENT_SMOKE_VERIFIED = "true";
  delete process.env.REVENUE_ENGINE_WEBSITE_DEPLOY_ENABLED;
  delete process.env.REVENUE_ENGINE_WEBSITE_APP_QA_TARGET_PASSED;
  delete process.env.REVENUE_ENGINE_WEBSITE_PREVIEW_DEPLOY_VERIFIED;
  delete process.env.REVENUE_ENGINE_WEBSITE_ROLLBACK_VERIFIED;
  delete process.env.REVENUE_ENGINE_WEBSITE_PUBLISH_APPROVED_BY_ROBERT;
  delete process.env.REVENUE_ENGINE_DEPLOY_APPROVED_BY_ROBERT;

  const report = buildRevenueMoneyReadinessReport({ mode: "first-sprint" });

  assert.equal(report.ready, true);
  assert.equal(report.status, "first_sprint_money_ready");
  assert.equal(report.canContactBusinesses, true);
  assert.equal(report.canCollectMoney, true);
  assert.equal(report.canBuildWebsites, false);
  assert.deepEqual(report.blockedUntil, []);
  assert.ok(report.remainingGaps.some((item) => item.includes("preview deploy verification")));
});

test("does not treat website deploy enablement alone as publish-ready", () => {
  process.env.DATABASE_URL = "postgres://ceo_user:real-pass@db.internal:5432/blackops";
  process.env.SESSION_SECRET = "a-production-session-secret-32-chars";
  process.env.REVENUE_ENGINE_MONEY_MODE = "live";
  process.env.REVENUE_ENGINE_ROBERT_CONTACT_APPROVED = "true";
  process.env.REVENUE_ENGINE_MANUAL_CONTACT_APPROVED = "true";
  process.env.REVENUE_ENGINE_PAYMENT_LINK = "https://buy.stripe.com/revenue-deposit";
  process.env.REVENUE_ENGINE_PAYMENT_LINK_APPROVED_BY_ROBERT = "true";
  process.env.REVENUE_ENGINE_PAYMENT_SMOKE_VERIFIED = "true";
  process.env.REVENUE_ENGINE_WEBSITE_DEPLOY_ENABLED = "true";
  process.env.REVENUE_ENGINE_DEPLOY_APPROVED_BY_ROBERT = "true";
  delete process.env.REVENUE_ENGINE_WEBSITE_APP_QA_TARGET_PASSED;
  delete process.env.REVENUE_ENGINE_WEBSITE_PREVIEW_DEPLOY_VERIFIED;
  delete process.env.REVENUE_ENGINE_WEBSITE_ROLLBACK_VERIFIED;
  delete process.env.REVENUE_ENGINE_WEBSITE_PUBLISH_APPROVED_BY_ROBERT;

  const report = buildRevenueMoneyReadinessReport({ mode: "production-launch" });

  assert.equal(report.ready, false);
  assert.equal(report.canBuildWebsites, false);
  assert.equal(report.checks.find((check) => check.id === "website_build_pipeline")?.status, "fail");
  assert.ok(report.blockedUntil.some((item) => item.includes("Robert publish approval")));
});

test("production launch readiness is not blocked by the nonblocking autonomous search gap", () => {
  process.env.DATABASE_URL = "postgres://ceo_user:real-pass@db.internal:5432/blackops";
  process.env.SESSION_SECRET = "a-production-session-secret-32-chars";
  process.env.REVENUE_ENGINE_MONEY_MODE = "live";
  process.env.REVENUE_ENGINE_ROBERT_CONTACT_APPROVED = "true";
  process.env.REVENUE_ENGINE_MANUAL_CONTACT_APPROVED = "true";
  process.env.REVENUE_ENGINE_PAYMENT_LINK = "https://buy.stripe.com/revenue-deposit";
  process.env.REVENUE_ENGINE_PAYMENT_LINK_APPROVED_BY_ROBERT = "true";
  process.env.REVENUE_ENGINE_PAYMENT_SMOKE_VERIFIED = "true";
  process.env.REVENUE_ENGINE_WEBSITE_DEPLOY_ENABLED = "true";
  process.env.REVENUE_ENGINE_WEBSITE_APP_QA_TARGET_PASSED = "true";
  process.env.REVENUE_ENGINE_WEBSITE_PREVIEW_DEPLOY_VERIFIED = "true";
  process.env.REVENUE_ENGINE_WEBSITE_ROLLBACK_VERIFIED = "true";
  process.env.REVENUE_ENGINE_WEBSITE_PUBLISH_APPROVED_BY_ROBERT = "true";
  process.env.REVENUE_ENGINE_DEPLOY_APPROVED_BY_ROBERT = "true";

  const report = buildRevenueMoneyReadinessReport({ mode: "production-launch" });

  assert.equal(report.ready, true);
  assert.equal(report.status, "production_money_ready");
  assert.equal(report.canBuildWebsites, true);
  assert.deepEqual(report.blockedUntil, []);
  assert.ok(report.remainingGaps.some((item) => item.includes("trusted browser execution")));
});

test("formats revenue money readiness text output", () => {
  const output = formatRevenueMoneyReadinessText(buildRevenueMoneyReadinessReport({ mode: "first-sprint" }));

  assert.match(output, /Revenue money readiness:/);
  assert.match(output, /Can search businesses: yes/);
  assert.match(output, /Can autonomously discover businesses: no/);
  assert.match(output, /Blocked until:/);
  assert.match(output, /Remaining gaps:/);
});

test("detects money mode placeholders", () => {
  assert.equal(isRevenueMoneyModePlaceholder(undefined), true);
  assert.equal(isRevenueMoneyModePlaceholder("replace-with-live"), true);
  assert.equal(isRevenueMoneyModePlaceholder("dry-run"), true);
  assert.equal(isRevenueMoneyModePlaceholder("live"), false);
});
