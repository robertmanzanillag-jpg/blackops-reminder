import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { readFileSync } from "node:fs";
import test from "node:test";
import express, { type Request } from "express";
import {
  oneVideoExecutionControlSchema,
  type OneVideoExecutionControl,
} from "../shared/ai-media-studio-one-video-execution-control";
import { InMemoryMediaJobRepository } from "../server/ai-media-studio/in-memory";
import {
  DrizzleOneVideoExecutionControlRepository,
  deriveExactStaticProviderVerificationState,
  derivePersistedProviderVerificationState,
} from "../server/ai-media-studio/planning/drizzle-one-video-execution-control-repository";
import { OneVideoExecutionControlError } from "../server/ai-media-studio/planning/one-video-execution-control-contracts";
import { OneVideoExecutionControlService } from "../server/ai-media-studio/planning/one-video-execution-control-service";
import { FakeVideoProvider } from "../server/ai-media-studio/providers/fake-video-provider";

const planId = `plan_${"1".repeat(24)}`;
const batchId = `batch_${"2".repeat(24)}`;
const slotId = `slot_${"3".repeat(24)}`;
const scope = { ownerUserId: "owner", workspaceId: "personal" } as const;

function packet(overrides: Partial<OneVideoExecutionControl> = {}): OneVideoExecutionControl {
  return oneVideoExecutionControlSchema.parse({
    version: 1, source: "postgresql_read_only",
    subject: { planId, batchId, slotId, slotAttempt: 1 }, observedAt: "2026-07-22T12:00:00.000Z",
    selection: { selectionKey: `selection_${"4".repeat(24)}`, creator: { label: "Safe creator" },
      avatar: { key: `resource_${"5".repeat(24)}`, label: "Safe avatar" },
      voice: { key: `resource_${"6".repeat(24)}`, label: "Safe voice" } },
    format: { aspectRatio: "9:16", container: "mp4" }, binding: { state: "current", credentialVersion: 1 },
    providerVerification: { state: "verified", evidenceKey: `evidence_${"9".repeat(24)}`,
      observedAt: "2026-07-22T11:50:00.000Z",
      expiresAt: "2026-07-22T13:00:00.000Z" },
    maximumQuote: { state: "quoted", amountMicroUsd: "1250000", currency: "USD",
      evidenceKey: `evidence_${"7".repeat(24)}`, observedAt: "2026-07-22T11:51:00.000Z",
      expiresAt: "2026-07-22T12:30:00.000Z" },
    humanApproval: { state: "approved", evidenceKey: `evidence_${"8".repeat(24)}`,
      observedAt: "2026-07-22T11:52:00.000Z", expiresAt: "2026-07-22T12:30:00.000Z" },
    execute: { state: "disabled", postAvailable: false, reasonCodes: ["one_shot_executor_not_installed"] },
    effects: { providerCalled: false, secretResolved: false, verificationPerformed: false, quoteRequested: false,
      approvalRecorded: false, reservationCreated: false, renderCreated: false, outboxCreated: false,
      spendCommitted: false, publishingCreated: false },
    authoritativeForAdmission: false, canGenerate: false, spendAuthorized: false,
    ...overrides,
  });
}

test("strict v1 packet keeps an exact public subject and permanently disables execution and effects", () => {
  const value = packet();
  assert.deepEqual(value.subject, { planId, batchId, slotId, slotAttempt: 1 });
  assert.deepEqual(value.format, { aspectRatio: "9:16", container: "mp4" });
  assert.equal(value.execute.postAvailable, false);
  assert.ok(value.execute.reasonCodes.includes("one_shot_executor_not_installed"));
  assert.ok(Object.values(value.effects).every((effect) => effect === false));
  assert.equal(value.authoritativeForAdmission || value.canGenerate || value.spendAuthorized, false);
});

test("schema rejects private/native fields, money outside a quote, forged effects, and approval without exact quote binding", () => {
  for (const privateField of ["providerAccountId", "externalResourceId", "secretRef", "actorUserId", "evidenceDigest"]) {
    assert.equal(oneVideoExecutionControlSchema.safeParse({ ...packet(), [privateField]: "private" }).success, false);
  }
  const money = structuredClone(packet()) as any; money.maximumQuote.state = "stale";
  assert.equal(oneVideoExecutionControlSchema.safeParse(money).success, false);
  const effect = structuredClone(packet()) as any; effect.effects.providerCalled = true;
  assert.equal(oneVideoExecutionControlSchema.safeParse(effect).success, false);
  const noQuote = structuredClone(packet()) as any;
  noQuote.maximumQuote = { state: "missing" };
  assert.equal(oneVideoExecutionControlSchema.safeParse(noQuote).success, false);
  const noVerificationEvidence = structuredClone(packet()) as any;
  delete noVerificationEvidence.providerVerification.evidenceKey;
  assert.equal(oneVideoExecutionControlSchema.safeParse(noVerificationEvidence).success, false);
  const forgedVerificationEvidence = structuredClone(packet()) as any;
  forgedVerificationEvidence.providerVerification = { state: "not_requested", evidenceKey: `evidence_${"a".repeat(24)}` };
  assert.equal(oneVideoExecutionControlSchema.safeParse(forgedVerificationEvidence).success, false);
});

test("service reparses repository output and verifies requested identity plus all denied effects", async () => {
  const calls: unknown[] = [];
  const service = new OneVideoExecutionControlService({ observe: async (...args) => { calls.push(args); return packet(); } });
  assert.equal((await service.observe(scope, planId, slotId)).subject.slotId, slotId);
  assert.deepEqual(calls, [[scope, planId, slotId]]);
  const wrong = new OneVideoExecutionControlService({ observe: async () => packet({
    subject: { planId, batchId, slotId: `slot_${"9".repeat(24)}`, slotAttempt: 1 },
  }) });
  await assert.rejects(wrong.observe(scope, planId, slotId),
    (error: unknown) => error instanceof OneVideoExecutionControlError && error.code === "UNAVAILABLE");
});

function queryText(query: unknown): string {
  const candidate = query as { queryChunks?: unknown[] };
  return (candidate.queryChunks ?? []).map((chunk: any) => typeof chunk === "string" ? chunk
    : typeof chunk?.value?.[0] === "string" ? chunk.value[0] : "?").join("");
}

test("repository begins with PostgreSQL time in one repeatable-read/read-only tenant-scoped SELECT snapshot", async () => {
  const queries: string[] = []; let config: unknown;
  const repository = new DrizzleOneVideoExecutionControlRepository({
    execute: async () => ({ rows: [] }),
    transaction: async (callback, value) => { config = value; return callback({ execute: async (query) => {
      queries.push(queryText(query));
      return queries.length === 1 ? { rows: [{ observed_at: new Date("2026-07-22T12:00:00Z") }] } : { rows: [] };
    } }); },
  });
  assert.equal(await repository.observe(scope, planId, slotId), undefined);
  assert.deepEqual(config, { isolationLevel: "repeatable read", accessMode: "read only" });
  assert.ok(queries.every((query) => /^\s*SELECT/iu.test(query)));
  assert.ok(queries.every((query) => !/\b(?:INSERT|UPDATE|DELETE|FOR\s+UPDATE|LOCK|MERGE|CALL)\b/iu.test(query)));
  assert.match(queries[1]!, /owner_user_id=.*workspace_id=.*public_plan_key/isu);
});

test("repository source has no network, secret resolver, mutation, budget admission, render, or outbox execution surface", () => {
  const source = readFileSync(new URL("../server/ai-media-studio/planning/drizzle-one-video-execution-control-repository.ts",
    import.meta.url), "utf8");
  assert.doesNotMatch(source, /fetch\s*\(|axios|secretRef|externalResourceId|reserveAndAdmit|FOR UPDATE/iu);
  assert.match(source, /verifyApprovedProductionBatchSlotMetadata/u);
  assert.match(source, /isolationLevel: "repeatable read", accessMode: "read only"/u);
  assert.match(source, /ORDER BY slots\.source_member_key,slots\.video_number\s+LIMIT 101/u);
  assert.match(source, /static_api_key.*disconnected.*unverified/su);
  assert.match(source, /ai_media_static_heygen_verification_headers/u);
  assert.match(source, /ai_media_static_heygen_resource_verifications/u);
  assert.match(source, /accounts\.granted_scopes='\[\]'::jsonb/u);
  assert.match(source, /accounts\.capabilities='\["render_video"\]'::jsonb/u);
  assert.match(source, /verification_resource_evidence_id=avatar_evidence\.id/u);
  assert.match(source, /verification_resource_evidence_id=voice_evidence\.id/u);
  assert.match(source, /AS static_current/u);
  assert.match(source, /one_shot_executor_not_installed/u);
});

test("pinned HeyGen V3 profile binds render avatar_id to a look and keeps group consent separate", () => {
  const profile = readFileSync(new URL("../docs/ai-media-studio/heygen-v3-provider-profile.md", import.meta.url), "utf8");
  assert.match(profile, /GET `?\/v3\/avatars\/looks/u);
  assert.match(profile, /look ID as the `avatar_id`/u);
  assert.match(profile, /parent group is separately resolved/u);
  assert.match(profile, /Group identity alone can never satisfy render-resource verification/u);
});

test("static disconnected/unverified metadata is explicitly not_requested even when resources make binding stale", () => {
  assert.equal(derivePersistedProviderVerificationState({ bindingState: "stale", credentialSource: "static_api_key",
    accountStatus: "disconnected", credentialStatus: "unverified" }), "not_requested");
  assert.equal(derivePersistedProviderVerificationState({ bindingState: "invalid", credentialSource: "static_api_key",
    accountStatus: "disconnected", credentialStatus: "unverified" }), "unavailable");
  assert.equal(derivePersistedProviderVerificationState({ bindingState: "current", credentialSource: "static_api_key",
    accountStatus: "active", credentialStatus: "active" }), "unavailable");
});

test("exact static verification state can become verified only from unexpired immutable header and both resource evidence rows", () => {
  const databaseNow = new Date("2026-07-22T12:00:00.000Z");
  const base = {
    bindingState: "current" as const,
    credentialSource: "static_api_key",
    accountStatus: "active",
    credentialStatus: "active",
    evidenceId: "4f79de93-90fe-4d6b-9939-95d67a250f34",
    evidenceObservedAt: "2026-07-22T11:50:00.000Z",
    evidenceExpiresAt: "2026-07-22T13:00:00.000Z",
    databaseNow,
  };
  const verified = deriveExactStaticProviderVerificationState({ ...base, evidenceCurrent: true });
  assert.equal(verified.state, "verified");
  assert.match(verified.evidenceKey ?? "", /^evidence_[a-f0-9]{24}$/u);
  assert.equal(deriveExactStaticProviderVerificationState({ ...base, evidenceCurrent: false }).state, "stale");
  assert.equal(deriveExactStaticProviderVerificationState({ ...base, evidenceCurrent: true,
    evidenceExpiresAt: "2026-07-22T12:00:00.000Z" }).state, "stale");
  assert.equal(deriveExactStaticProviderVerificationState({ ...base, evidenceCurrent: true,
    evidenceId: "" }).state, "stale");
  assert.equal(deriveExactStaticProviderVerificationState({ ...base, bindingState: "invalid",
    evidenceCurrent: true }).state, "unavailable");
  assert.equal(deriveExactStaticProviderVerificationState({ ...base, accountStatus: "disconnected",
    credentialStatus: "unverified", evidenceCurrent: true }).state, "not_requested");
});

test("route surface is GET-only and installs no prepare, execute, generate, or retry mutation for the exact slot", () => {
  const routes = readFileSync(new URL("../server/ai-media-studio/routes.ts", import.meta.url), "utf8");
  assert.match(routes, /router\.get\(`\$\{AI_MEDIA_STUDIO_API_BASE\}\/production-batches\/:planId\/one-video-execution-control\/:slotId`/u);
  assert.doesNotMatch(routes, /router\.post\(`\$\{AI_MEDIA_STUDIO_API_BASE\}\/production-batches\/:planId\/one-video-execution-control/u);
  assert.doesNotMatch(routes, /one-video-execution-control\/:slotId\/(?:prepare|execute|generate|retry)/u);
});

async function getWithBody(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: "GET", headers: { "x-test-user": "owner", "content-type": "application/json",
      "content-length": "2" } }, (res) => { res.resume(); res.once("end", () => resolve(res.statusCode ?? 0)); });
    req.once("error", reject); req.end("{}");
  });
}

async function routeHarness() {
  const { createAiMediaStudioRuntime } = await import("../server/ai-media-studio/routes");
  const previous = process.env.ALLOW_DEV_USER_FALLBACK; process.env.ALLOW_DEV_USER_FALLBACK = "false";
  const calls: unknown[] = []; const app = express(); app.use(express.json());
  app.use((req, _res, next) => { const id = req.get("x-test-user");
    if (id) (req as Request & { user?: { id: string } }).user = { id }; next(); });
  const runtime = createAiMediaStudioRuntime({ repository: new InMemoryMediaJobRepository(),
    providers: [new FakeVideoProvider()], defaultProviderKey: "fake", runtimeEnvironment: "test",
    oneVideoExecutionControlRepository: { observe: async (...args) => { calls.push(args); return packet(); } },
    operations: { runtimeEnvironment: "test" } });
  app.use(runtime.router); const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address === "object");
  return { base: `http://127.0.0.1:${address.port}`, calls, close: async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (previous === undefined) delete process.env.ALLOW_DEV_USER_FALLBACK; else process.env.ALLOW_DEV_USER_FALLBACK = previous;
  } };
}

test("authenticated GET is exact, bodyless, queryless, no-store, redacted, and has no execution POST", async (t) => {
  let server: Awaited<ReturnType<typeof routeHarness>>;
  try { server = await routeHarness(); } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ERR_MODULE_NOT_FOUND") {
      t.skip("optional route dependency is not installed in this worktree"); return;
    }
    throw error;
  }
  t.after(server.close);
  const url = `${server.base}/api/ai-media-studio/production-batches/${planId}/one-video-execution-control/${slotId}`;
  assert.equal((await fetch(url)).status, 401);
  const response = await fetch(url, { headers: { "x-test-user": "owner" } });
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
  const body = await response.text();
  assert.doesNotMatch(body, /providerAccountId|externalResourceId|secretRef|actorUserId|evidenceDigest|sha256:/iu);
  assert.deepEqual(server.calls, [[scope, planId, slotId]]);
  assert.equal(await getWithBody(url), 400);
  assert.equal((await fetch(`${url}?execute=true`, { headers: { "x-test-user": "owner" } })).status, 400);
  assert.equal((await fetch(url, { method: "POST", headers: { "x-test-user": "owner" } })).status, 404);
});
