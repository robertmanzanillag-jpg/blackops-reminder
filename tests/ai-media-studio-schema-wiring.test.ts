import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const readWorkspaceFile = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

test("Drizzle Kit loads the central shared schema", () => {
  const config = readWorkspaceFile("drizzle.config.ts");
  assert.match(config, /schema:\s*["']\.\/shared\/schema\.ts["']/);
  assert.match(config, /dialect:\s*["']postgresql["']/);
});

test("the central schema re-exports the AI Media Studio table module", () => {
  const centralSchema = readWorkspaceFile("shared/schema.ts");
  assert.match(
    centralSchema,
    /export\s+\*\s+from\s+["']\.\/models\/ai-media-studio-db["'];?/,
  );
});

test("the wired module exposes key migration tables", () => {
  const model = readWorkspaceFile("shared/models/ai-media-studio-db.ts");
  for (const table of [
    ["aiMediaInfluencers", "ai_media_influencers"],
    ["aiMediaRenderJobs", "ai_media_render_jobs"],
    ["aiMediaGovernanceProfiles", "ai_media_governance_profiles"],
    ["aiMediaWebhookEvents", "ai_media_webhook_events"],
    ["aiMediaMediaAssets", "ai_media_assets"],
    ["aiMediaQualityReviews", "ai_media_quality_reviews"],
    ["aiMediaPublishingJobs", "ai_media_publishing_jobs"],
    ["aiMediaCostLedger", "ai_media_cost_ledger"],
    ["aiMediaOutbox", "ai_media_outbox"],
    ["aiMediaDailyPlans", "ai_media_daily_plans"],
    ["aiMediaDailyPlanSlots", "ai_media_daily_plan_slots"],
    ["aiMediaBudgetBuckets", "ai_media_budget_buckets"],
    ["aiMediaAdmissionPolicyRevisions", "ai_media_admission_policy_revisions"],
    ["aiMediaKillSwitchRevisions", "ai_media_kill_switch_revisions"],
    ["aiMediaLaunchEvidence", "ai_media_launch_evidence"],
    ["aiMediaLaunchAuthoritySnapshots", "ai_media_launch_authority_snapshots"],
    ["aiMediaBudgetReservations", "ai_media_budget_reservations"],
  ] as const) {
    assert.match(
      model,
      new RegExp(`export const ${table[0]} = pgTable\\(\\s*["']${table[1]}["']`),
    );
  }
});
