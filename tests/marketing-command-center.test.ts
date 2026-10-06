import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  getMarketingCommandCenterSnapshot,
  resetMarketingCommandCenterForTests,
  runMarketingCommandCenterDay,
  setMarketingCommandCenterLearningPathForTests,
} from "../server/marketing-command-center";

const testDir = path.join(os.tmpdir(), "marketing-command-center-tests");

test.beforeEach(() => {
  const learningPath = path.join(testDir, "learning-runs.json");
  rmSync(learningPath, { force: true });
  setMarketingCommandCenterLearningPathForTests(learningPath);
  resetMarketingCommandCenterForTests();
});

test.after(() => {
  setMarketingCommandCenterLearningPathForTests(null);
  resetMarketingCommandCenterForTests();
});

test("builds a global CMO with separated internal clients and strong skills", () => {
  const snapshot = getMarketingCommandCenterSnapshot("owner-a");

  assert.equal(snapshot.cmoAgent.id, "marketing-cmo");
  assert.equal(snapshot.cmoAgent.scope, "global");
  assert.equal(snapshot.capacity.maxClients, 20);
  assert.equal(snapshot.clients.length, 4);
  assert.equal(snapshot.capacity.openSlots, 16);
  assert.equal(snapshot.globalScorecard.readyClients, 0);
  assert.deepEqual(snapshot.clients.map((client) => client.id), ["black-room", "dropshipping", "kong", "clipping"]);
  assert.equal(snapshot.clients.every((client) => client.separationKey.startsWith("client:")), true);
  assert.equal(snapshot.clients.every((client) => client.status === "needs_data"), true);
  assert.equal(snapshot.clients.every((client) => client.handoff?.status === "draft_only"), true);
  const blackRoom = snapshot.clients.find((client) => client.id === "black-room");
  assert.ok(blackRoom);
  assert.equal(blackRoom.name, "Black Room (Fiesta + Radio)");
  assert.equal(blackRoom.marketingCapabilities?.includes("flyers/templates"), true);
  assert.equal(blackRoom.marketingCapabilities?.includes("promo videos"), true);
  assert.equal(blackRoom.detectedSources?.includes("server/promo-video-agent.ts"), true);
  assert.equal(blackRoom.detectedSources?.includes("client/src/components/flyer-generator.tsx"), true);
  assert.equal(snapshot.clients.some((client) => client.id === "personal-brand"), false);
  assert.equal(snapshot.clients.some((client) => client.id === "revenue-websites"), false);
  assert.equal(snapshot.detectedMarketingApps.some((app) => app.clientId === "black-room" && app.detectedSources.includes("server/promo-video-agent.ts")), true);
  assert.equal(snapshot.detectedMarketingApps.some((app) => app.clientId === "black-room" && app.detectedSources.includes("client/src/components/flyer-generator.tsx")), true);
  assert.equal(snapshot.skillStack.some((skill) => skill.id === "analytics-attribution"), true);
  assert.equal(snapshot.skillStack.some((skill) => skill.id === "paid-ads-profit-guard"), true);
  assert.equal(snapshot.skillStack.some((skill) => skill.id === "learning-system"), true);
  assert.equal(snapshot.subagents.some((agent) => agent.id === "learning-optimizer"), true);
  assert.equal(snapshot.operatingModel.requiresApproval.includes("publicar"), true);
});

test("runs self-improvement without publishing, spending, contacting, or mixing client data", () => {
  const result = runMarketingCommandCenterDay({ focusClientId: "all" }, "owner-a");

  assert.equal(result.status, "completed");
  assert.equal(result.safety.externalActionsBlocked, true);
  assert.equal(result.safety.spentUsd, 0);
  assert.equal(result.safety.publishedExternally, 0);
  assert.equal(result.safety.clientDataMixed, false);
  assert.equal(result.learning.clientsReviewed, 4);
  assert.equal(result.learning.safetyBlocks.includes("Mezcla de datos entre clientes bloqueada."), true);
  assert.equal(result.snapshot.recentLearningRuns.length, 1);
});


test("reviews are owner-isolated, idempotent and do not invent learning", () => {
  const first = runMarketingCommandCenterDay({ focusClientId: "kong", idempotencyKey: "daily-one" }, "owner-a");
  assert.equal(first.learning.rulesUpdated.length, 0);
  assert.equal(getMarketingCommandCenterSnapshot("owner-b").recentLearningRuns.length, 0);
  assert.equal(runMarketingCommandCenterDay({ focusClientId: "kong", idempotencyKey: "daily-one" }, "owner-a").learning.id, first.learning.id);
  resetMarketingCommandCenterForTests();
  assert.equal(runMarketingCommandCenterDay({ focusClientId: "kong", idempotencyKey: "daily-one" }, "owner-a").learning.id, first.learning.id);
  assert.equal(getMarketingCommandCenterSnapshot("owner-a").recentLearningRuns.length, 1);
  const other = runMarketingCommandCenterDay({ focusClientId: "kong", idempotencyKey: "daily-one" }, "owner-b");
  assert.notEqual(other.learning.id, first.learning.id);
  assert.throws(() => runMarketingCommandCenterDay({ focusClientId: "unknown" as any }, "owner-a"));
});

test("failed persistence cannot be reused as a completed review", async () => {
  const { mkdtempSync, mkdirSync } = await import("node:fs");
  const dir = mkdtempSync(path.join(os.tmpdir(), "marketing-write-failure-"));
  const badPath = path.join(dir, "directory");
  getMarketingCommandCenterSnapshot("owner-a");
  mkdirSync(badPath);
  setMarketingCommandCenterLearningPathForTests(badPath);
  assert.throws(() => runMarketingCommandCenterDay({ focusClientId: "kong", idempotencyKey: "retry-one" }, "owner-a"));
  assert.equal(getMarketingCommandCenterSnapshot("owner-a").recentLearningRuns.length, 0);
  setMarketingCommandCenterLearningPathForTests(path.join(dir, "recovered.json"));
  const recovered = runMarketingCommandCenterDay({ focusClientId: "kong", idempotencyKey: "retry-one" }, "owner-a");
  assert.equal(recovered.snapshot.recentLearningRuns.length, 1);
  resetMarketingCommandCenterForTests();
  assert.equal(getMarketingCommandCenterSnapshot("owner-a").recentLearningRuns.length, 1);
  rmSync(dir, { recursive: true, force: true });
});
