import assert from "node:assert/strict";
import test from "node:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  DrizzleAssetIngestRepository,
  type AssetIngestDatabase,
} from "../server/ai-media-studio/assets/drizzle-ingest-repository";

interface CompiledQuery { text: string; params: unknown[] }
type QueryResponder = (query: CompiledQuery) => unknown | Promise<unknown>;

class FakeDatabase {
  readonly queries: CompiledQuery[] = [];
  transactionCalls = 0;
  private readonly dialect = new PgDialect();

  constructor(private readonly respond: QueryResponder) {}

  async execute(query: SQL): Promise<unknown> {
    const compiled = this.dialect.sqlToQuery(query);
    const entry = { text: compiled.sql.replace(/\s+/g, " ").trim(), params: compiled.params };
    this.queries.push(entry);
    return this.respond(entry);
  }

  async transaction<T>(callback: (tx: FakeDatabase) => Promise<T>): Promise<T> {
    this.transactionCalls += 1;
    return callback(this);
  }

  asDrizzle(): AssetIngestDatabase { return this as unknown as AssetIngestDatabase; }
}

const tenantId = JSON.stringify(["workspace-a", "tenant-a"]);

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    owner_user_id: "tenant-a",
    workspace_id: "workspace-a",
    render_job_id: "00000000-0000-4000-8000-000000000010",
    provider_key: "media.example.com",
    remote_artifact_ref: null,
    remote_url: "https://media.example.com/render.mp4",
    expected_mime_type: "video/mp4",
    state: "queued",
    attempts: 0,
    max_attempts: 3,
    lease_recoveries: 0,
    max_lease_recoveries: 3,
    available_at: new Date(1_000),
    lease_owner: null,
    lease_token: null,
    lease_expires_at: null,
    fencing_token: 0,
    media_asset_id: null,
    owned_object_key: null,
    sha256: null,
    size_bytes: null,
    error_code: null,
    error_message: null,
    completed_at: null,
    dead_letter_at: null,
    created_at: new Date(900),
    updated_at: new Date(1_000),
    ...overrides,
  };
}

test("enqueue is tenant/workspace/render idempotent and rejects changed private input", async () => {
  const fake = new FakeDatabase((query) => query.text.startsWith("WITH inserted AS") ? { rows: [row()] } : { rows: [] });
  const repository = new DrizzleAssetIngestRepository(fake.asDrizzle());
  const input = {
    id: "00000000-0000-4000-8000-000000000001",
    tenantId,
    renderJobId: "00000000-0000-4000-8000-000000000010",
    sourceUrl: "https://media.example.com/render.mp4",
    maxAttempts: 3,
  };
  const job = await repository.enqueue(input, 1_000);
  assert.equal(job.tenantId, tenantId);
  assert.equal(job.sourceUrl, input.sourceUrl);
  const query = fake.queries[0];
  assert.match(query.text, /ON CONFLICT \(owner_user_id, workspace_id, render_job_id\) DO NOTHING/i);
  assert.match(query.text, /existing\.owner_user_id =/i);
  assert.match(query.text, /existing\.workspace_id =/i);
  assert.match(query.text, /render\.owner_user_id =/i);
  assert.match(query.text, /render\.workspace_id =/i);
  assert.ok(query.params.includes("tenant-a"));
  assert.ok(query.params.includes("workspace-a"));

  const mismatched = new FakeDatabase(() => ({ rows: [row()] }));
  await assert.rejects(
    new DrizzleAssetIngestRepository(mismatched.asDrizzle()).enqueue({ ...input, sourceUrl: "https://media.example.com/other.mp4" }, 1_000),
    /different ingest input/,
  );
});

test("durable remote artifact identity is mapped and participates in enqueue idempotency", async () => {
  const remoteArtifactRef = "provider-artifact://ai-media-studio/render-terminal/v1/stable";
  const sourceUrl = "https://media.example.com/render.mp4?temporary=signature";
  const fake = new FakeDatabase((query) => query.text.startsWith("WITH inserted AS")
    ? { rows: [row({ remote_artifact_ref: remoteArtifactRef, remote_url: sourceUrl })] }
    : { rows: [] });
  const repository = new DrizzleAssetIngestRepository(fake.asDrizzle());
  const input = {
    id: "00000000-0000-4000-8000-000000000001",
    tenantId,
    renderJobId: "00000000-0000-4000-8000-000000000010",
    remoteArtifactRef,
    sourceUrl,
    maxAttempts: 3,
  };
  const job = await repository.enqueue(input, 1_000);
  assert.equal(job.remoteArtifactRef, remoteArtifactRef);
  assert.match(fake.queries[0].text, /remote_artifact_ref/i);
  assert.ok(fake.queries[0].params.includes(remoteArtifactRef));

  const mismatch = new FakeDatabase(() => ({ rows: [row({ remote_artifact_ref: "provider-artifact://different" })] }));
  await assert.rejects(
    new DrizzleAssetIngestRepository(mismatch.asDrizzle()).enqueue(input, 1_000),
    /different ingest input/u,
  );
});

test("tenant reads require an unambiguous structured scope", async () => {
  const fake = new FakeDatabase(() => ({ rows: [row()] }));
  const repository = new DrizzleAssetIngestRepository(fake.asDrizzle());
  await assert.rejects(repository.getForTenant("tenant-a:workspace-a", "job-1"), /structured/);
  await repository.getForTenant(tenantId, "job-1");
  const query = fake.queries[0];
  assert.match(query.text, /owner_user_id =/i);
  assert.match(query.text, /workspace_id =/i);
  assert.ok(query.params.includes("tenant-a"));
  assert.ok(query.params.includes("workspace-a"));
});

test("claim is atomic, ordered, SKIP LOCKED, and keeps explicit row scope", async () => {
  const fake = new FakeDatabase((query) => query.text.startsWith("WITH candidate AS")
    ? { rows: [row({ state: "leased", attempts: 1, lease_owner: "worker-a", lease_token: query.params.find((part) => typeof part === "string" && /^[0-9a-f-]{36}$/.test(part as string)), lease_expires_at: new Date(2_000), fencing_token: 1 })] }
    : { rows: [] });
  const claimed = await new DrizzleAssetIngestRepository(fake.asDrizzle()).claimDue({
    workerId: "worker-a", nowMs: 1_000, leaseDurationMs: 1_000,
  });
  assert.ok(claimed);
  assert.equal(claimed.job.state, "leased");
  assert.equal(fake.transactionCalls, 1);
  const query = fake.queries[0];
  assert.match(query.text, /FOR UPDATE SKIP LOCKED/i);
  assert.match(query.text, /state IN \('queued', 'retry_wait'\)/i);
  assert.match(query.text, /ORDER BY available_at, created_at, id/i);
  assert.match(query.text, /job\.owner_user_id = candidate\.owner_user_id/i);
  assert.match(query.text, /job\.workspace_id = candidate\.workspace_id/i);
  assert.match(query.text, /fencing_token = job\.fencing_token \+ 1/i);
});

test("complete and fail require a matching unexpired lease and never persist signed delivery URLs", async () => {
  const fake = new FakeDatabase((query) => {
    if (query.text.includes("SET state = 'completed'")) return { rows: [row({
      state: "completed", attempts: 1, owned_object_key: "tenant-a/video.mp4", sha256: "abc", size_bytes: 100,
      completed_at: new Date(1_500), updated_at: new Date(1_500),
    })] };
    if (query.text.includes("SET state = CASE")) return { rows: [row({
      state: "dead_letter", attempts: 3, error_code: "storage_failed", dead_letter_at: new Date(1_500), updated_at: new Date(1_500),
    })] };
    return { rows: [] };
  });
  const repository = new DrizzleAssetIngestRepository(fake.asDrizzle());
  const completed = await repository.complete({
    jobId: "job-1", leaseToken: "lease-1", ownedObjectKey: "tenant-a/video.mp4",
    sha256: "abc", sizeBytes: 100, nowMs: 1_500,
  });
  assert.equal(completed?.ownedObjectKey, "tenant-a/video.mp4");
  const failed = await repository.fail({
    jobId: "job-2", leaseToken: "lease-2", errorCode: "storage_failed",
    retryable: true, retryAtMs: 2_500, nowMs: 1_500,
  });
  assert.equal(failed?.deadLettered, true);
  for (const query of fake.queries) {
    assert.match(query.text, /job\.lease_token =/i);
    assert.match(query.text, /job\.lease_expires_at >/i);
    assert.match(query.text, /job\.owner_user_id = candidate\.owner_user_id/i);
    assert.match(query.text, /job\.workspace_id = candidate\.workspace_id/i);
    assert.doesNotMatch(query.text, /delivery_url/i);
  }
  assert.match(fake.queries[1].text, /job\.attempts < job\.max_attempts/i);
  assert.match(fake.queries[1].text, /CAST\([^)]* AS timestamp with time zone\)/i);
  assert.match(fake.queries[1].text, /CAST\(NULL AS timestamp with time zone\)/i);
});

test("expired lease reconciliation is locked, fenced by explicit scope, and bounded", async () => {
  const fake = new FakeDatabase((query) => query.text.startsWith("WITH expired AS")
    ? { rows: [{ id: "job-1", __previous_owner: "worker-a", __dead_lettered: true }] }
    : { rows: [] });
  const recovered = await new DrizzleAssetIngestRepository(fake.asDrizzle()).reconcileExpiredLeases(2_000);
  assert.deepEqual(recovered, [{ jobId: "job-1", previousOwner: "worker-a", deadLettered: true }]);
  const query = fake.queries[0];
  assert.match(query.text, /FOR UPDATE SKIP LOCKED/i);
  assert.match(query.text, /lease_recoveries \+ 1 >= max_lease_recoveries/i);
  assert.match(query.text, /job\.owner_user_id = expired\.owner_user_id/i);
  assert.match(query.text, /job\.workspace_id = expired\.workspace_id/i);
  assert.match(query.text, /THEN 'dead_letter' ELSE 'queued'/i);
  assert.match(query.text, /dead_letter_at = CASE/i);
  assert.match(query.text, /CAST\([^)]* AS timestamp with time zone\)/i);
  assert.match(query.text, /CAST\(NULL AS timestamp with time zone\)/i);
});

test("completed ingest attaches a tenant-owned canonical asset and updates its render atomically", async () => {
  const mediaAssetId = "00000000-0000-4000-8000-000000000020";
  const fake = new FakeDatabase((query) => {
    if (query.text.startsWith("WITH candidate AS")) return { rows: [row({
      state: "completed", completed_at: new Date(1_500), media_asset_id: mediaAssetId,
    })] };
    if (query.text.startsWith("UPDATE \"ai_media_render_jobs\" AS render")) return { rows: [{ id: "render-1" }] };
    return { rows: [] };
  });
  const repository = new DrizzleAssetIngestRepository(fake.asDrizzle());
  const attached = await repository.attachMediaAsset({
    tenantId, jobId: "00000000-0000-4000-8000-000000000001", mediaAssetId, nowMs: 2_000,
  });
  assert.equal(attached?.mediaAssetId, mediaAssetId);
  const repeated = await repository.attachMediaAsset({
    tenantId, jobId: "00000000-0000-4000-8000-000000000001", mediaAssetId, nowMs: 2_100,
  });
  assert.equal(repeated?.mediaAssetId, mediaAssetId);
  assert.equal(fake.transactionCalls, 2);
  const attach = fake.queries[0];
  assert.match(attach.text, /asset\.owner_user_id = job\.owner_user_id/i);
  assert.match(attach.text, /asset\.workspace_id = job\.workspace_id/i);
  assert.match(attach.text, /asset\.kind = 'video'/i);
  assert.match(attach.text, /asset\.status = 'ready'/i);
  assert.match(attach.text, /asset\.checksum = job\.sha256/i);
  assert.match(attach.text, /asset\.storage_key = job\.owned_object_key/i);
  assert.match(attach.text, /job\.state = 'completed'/i);
  assert.match(attach.text, /job\.owner_user_id =/i);
  assert.match(attach.text, /job\.workspace_id =/i);
  assert.match(attach.text, /job\.media_asset_id IS NULL OR job\.media_asset_id =/i);
  const render = fake.queries[1];
  assert.match(render.text, /output_media_asset_id =/i);
  assert.match(render.text, /render\.owner_user_id =/i);
  assert.match(render.text, /render\.workspace_id =/i);
  assert.match(render.text, /status = 'completed', stage = 'completed', progress = 100/i);
  assert.match(render.text, /output_url = NULL/i);
  assert.match(render.text, /completed_at = COALESCE\(render\.completed_at,/i);
  assert.match(render.text, /error_code = NULL, error_message = NULL/i);
  assert.match(render.text, /render\.stage IN \('artifact_ingest_queued', 'artifact_ingest_retrying'\)/i);
  assert.match(render.text, /render\.output_media_asset_id IS NULL/i);
  assert.match(render.text, /render\.stage = 'completed' AND render\.status = 'completed' AND render\.progress = 100/i);
  assert.match(render.text, /render\.output_media_asset_id =/i);
});

test("canonical asset attachment is same-id idempotent and rejects mismatches", async () => {
  const mediaAssetId = "00000000-0000-4000-8000-000000000020";
  const differentAssetId = "00000000-0000-4000-8000-000000000021";
  const fake = new FakeDatabase((query) => {
    if (query.text.startsWith("WITH candidate AS")) return { rows: [] };
    if (query.text.startsWith("SELECT * FROM \"ai_media_asset_ingest_jobs\"")) {
      return { rows: [row({ state: "completed", media_asset_id: mediaAssetId })] };
    }
    return { rows: [] };
  });
  const repository = new DrizzleAssetIngestRepository(fake.asDrizzle());
  await assert.rejects(repository.attachMediaAsset({
    tenantId, jobId: "00000000-0000-4000-8000-000000000001", mediaAssetId: differentAssetId, nowMs: 2_000,
  }), /different canonical media asset/);
  await assert.rejects(repository.attachMediaAsset({ tenantId, jobId: "not-a-uuid", mediaAssetId, nowMs: 2_000 }), /must be UUIDs/);
});

test("completed-unlinked reconciliation listing is deterministic and strictly bounded", async () => {
  const fake = new FakeDatabase((query) => query.text.startsWith("SELECT * FROM \"ai_media_asset_ingest_jobs\"")
    ? { rows: [row({ state: "completed", completed_at: new Date(1_500) })] }
    : { rows: [] });
  const repository = new DrizzleAssetIngestRepository(fake.asDrizzle());
  const jobs = await repository.listCompletedUnlinked(25);
  assert.equal(jobs.length, 1);
  const query = fake.queries[0];
  assert.match(query.text, /state = 'completed' AND media_asset_id IS NULL/i);
  assert.match(query.text, /ORDER BY completed_at, created_at, id/i);
  assert.match(query.text, /LIMIT /i);
  assert.ok(query.params.includes(25));
  await assert.rejects(repository.listCompletedUnlinked(0), /between 1 and 100/);
  await assert.rejects(repository.listCompletedUnlinked(101), /between 1 and 100/);
});
