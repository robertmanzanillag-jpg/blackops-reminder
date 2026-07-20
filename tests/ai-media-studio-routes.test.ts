import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";
import express, { type Request } from "express";
import { createGenerationResponseSchema, mediaJobResponseSchema, mediaJobsResponseSchema, mediaStudioOptionsResponseSchema } from "../shared/ai-media-studio";
import { generateScriptVariantsResponseSchema } from "../shared/ai-media-studio-scripts";
import { createAiMediaStudioRuntime } from "../server/ai-media-studio/routes";
import { InMemoryMediaJobRepository } from "../server/ai-media-studio/in-memory";
import { FakeVideoProvider } from "../server/ai-media-studio/providers/fake-video-provider";

process.env.NODE_ENV = "production";
process.env.ALLOW_DEV_USER_FALLBACK = "false";

function signature(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

test("AI Media Studio HTTP routes enforce auth, schemas and signed webhook transitions", async (t) => {
  const app = express();
  app.use(express.json({ verify: (req, _res, buffer) => { (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer); } }));
  app.use((req, _res, next) => {
    const userId = req.get("x-test-user");
    if (userId) (req as Request & { user?: { id: string } }).user = { id: userId };
    next();
  });
  const secret = "route-test-webhook-secret";
  const runtime = createAiMediaStudioRuntime({
    repository: new InMemoryMediaJobRepository(),
    providers: [new FakeVideoProvider({ autoComplete: false })],
    defaultProviderKey: "fake",
    webhookSecrets: { fake: secret, unknown: secret },
    allowedAssetHosts: new Set(["cdn.example.com"]),
  });
  app.use(runtime.router);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const jsonHeaders = { "content-type": "application/json", "x-test-user": "user-a" };

  const unauthorized = await fetch(`${baseUrl}/api/ai-media-studio/jobs`);
  assert.equal(unauthorized.status, 401);
  assert.deepEqual(await unauthorized.json(), { error: "Authentication required" });
  const optionsResponse = await fetch(`${baseUrl}/api/ai-media-studio/options`, { headers: { "x-test-user": "user-a" } });
  const optionsJson = await optionsResponse.json();
  assert.doesNotThrow(() => mediaStudioOptionsResponseSchema.parse(optionsJson));

  const invalid = await fetch(`${baseUrl}/api/ai-media-studio/generations`, { method: "POST", headers: jsonHeaders, body: "{}" });
  assert.equal(invalid.status, 400);

  const generationBody = {
    influencerId: "emily-food", script: "A grounded Miami restaurant recommendation.", voiceId: "voice-emily-en",
    language: "en", aspectRatio: "9:16", idempotencyKey: "route-generation-001",
  };
  const createdResponse = await fetch(`${baseUrl}/api/ai-media-studio/generations`, { method: "POST", headers: jsonHeaders, body: JSON.stringify(generationBody) });
  assert.equal(createdResponse.status, 202);
  const created = createGenerationResponseSchema.parse(await createdResponse.json());
  assert.equal(created.job.influencerName, "Emily");
  assert.equal(created.job.status, "rendering");

  const jobsA = mediaJobsResponseSchema.parse(await (await fetch(`${baseUrl}/api/ai-media-studio/jobs`, { headers: { "x-test-user": "user-a" } })).json());
  const jobsB = mediaJobsResponseSchema.parse(await (await fetch(`${baseUrl}/api/ai-media-studio/jobs`, { headers: { "x-test-user": "user-b" } })).json());
  assert.equal(jobsA.jobs.length, 1);
  assert.equal(jobsB.jobs.length, 0);

  const webhookBody = JSON.stringify({ event_type: "avatar_video.success", event_data: { video_id: created.job.id, video_url: "https://cdn.example.com/render.mp4" } });
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const invalidWebhook = await fetch(`${baseUrl}/api/ai-media-studio/webhooks/providers/fake`, {
    method: "POST", headers: { "content-type": "application/json", "heygen-signature": "bad", "heygen-timestamp": timestamp, "heygen-event-id": "route-event-1" }, body: webhookBody,
  });
  assert.equal(invalidWebhook.status, 401);
  assert.equal((await runtime.service.getJob("user-a", created.jobId)).status, "rendering");

  const internalJob = await runtime.service.getJob("user-a", created.jobId);
  const validWebhookBody = JSON.stringify({ event_type: "avatar_video.success", event_data: { video_id: internalJob.providerJobId, video_url: "https://cdn.example.com/render.mp4" } });
  const validWebhook = await fetch(`${baseUrl}/api/ai-media-studio/webhooks/providers/fake`, {
    method: "POST", headers: { "content-type": "application/json", "heygen-signature": signature(validWebhookBody, secret), "heygen-timestamp": timestamp, "heygen-event-id": "route-event-2" }, body: validWebhookBody,
  });
  assert.equal(validWebhook.status, 202);
  const detail = mediaJobResponseSchema.parse(await (await fetch(`${baseUrl}/api/ai-media-studio/jobs/${created.jobId}`, { headers: { "x-test-user": "user-a" } })).json());
  assert.equal(detail.job.status, "completed");
  assert.equal(detail.job.asset?.url, "https://cdn.example.com/render.mp4");
  assert.equal((await fetch(`${baseUrl}/api/ai-media-studio/jobs/${created.jobId}/cancel`, { method: "POST", headers: { "x-test-user": "user-a" } })).status, 409);

  const unknownBody = JSON.stringify({ event_type: "avatar_video.success", event_data: { video_id: "unknown" } });
  const unknown = await fetch(`${baseUrl}/api/ai-media-studio/webhooks/providers/unknown`, {
    method: "POST", headers: { "content-type": "application/json", "heygen-signature": signature(unknownBody, secret), "heygen-timestamp": timestamp, "heygen-event-id": "unknown-event" }, body: unknownBody,
  });
  assert.equal(unknown.status, 404);

  const retryCreate = await fetch(`${baseUrl}/api/ai-media-studio/generations`, {
    method: "POST", headers: jsonHeaders, body: JSON.stringify({ ...generationBody, idempotencyKey: "route-generation-002" }),
  });
  const retryTarget = createGenerationResponseSchema.parse(await retryCreate.json());
  const retryInternal = await runtime.service.getJob("user-a", retryTarget.jobId);
  const failedBody = JSON.stringify({ event_type: "avatar_video.fail", event_data: { video_id: retryInternal.providerJobId, message: "render failed" } });
  const failedWebhook = await fetch(`${baseUrl}/api/ai-media-studio/webhooks/providers/fake`, {
    method: "POST", headers: { "content-type": "application/json", "heygen-signature": signature(failedBody, secret), "heygen-timestamp": timestamp, "heygen-event-id": "route-event-failed" }, body: failedBody,
  });
  assert.equal(failedWebhook.status, 202);
  const retried = mediaJobResponseSchema.parse(await (await fetch(`${baseUrl}/api/ai-media-studio/jobs/${retryTarget.jobId}/retry`, { method: "POST", headers: { "x-test-user": "user-a" } })).json());
  assert.equal(retried.job.status, "rendering");
  assert.equal(retried.job.attempt, 2);
  const cancelled = mediaJobResponseSchema.parse(await (await fetch(`${baseUrl}/api/ai-media-studio/jobs/${retryTarget.jobId}/cancel`, { method: "POST", headers: { "x-test-user": "user-a" } })).json());
  assert.equal(cancelled.job.status, "cancelled");

  const scripts = await fetch(`${baseUrl}/api/ai-media-studio/scripts/generate`, {
    method: "POST", headers: jsonHeaders,
    body: JSON.stringify({ source: { type: "events", id: "event-1", title: "Miami Weekend", summary: "A public event summary." }, language: "en", variantCount: 2 }),
  });
  assert.equal(scripts.status, 200);
  assert.equal(generateScriptVariantsResponseSchema.parse(await scripts.json()).scriptSet.variants.length, 2);
});
