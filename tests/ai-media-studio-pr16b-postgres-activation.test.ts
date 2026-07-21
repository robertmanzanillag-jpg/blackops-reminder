import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import { basename, dirname } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";
import test, { after, before } from "node:test";
import { Pool, type PoolClient } from "pg";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { DrizzleOAuthProviderActivationRepository } from
  "../server/ai-media-studio/oauth/drizzle-provider-activation-repository";
import type { OAuthProviderConnectionDatabase, OAuthProviderConnectionTransactionalDatabase } from
  "../server/ai-media-studio/oauth/drizzle-provider-connection-repository";
import {
  OAuthProviderConnectionError,
  deriveOAuthProviderSelectionDigest,
  oauthProviderActivationVaultReference,
  type FinalizeDurableOAuthProviderActivation,
  type StageOAuthProviderActivation,
} from "../server/ai-media-studio/oauth/provider-connection-contracts";

const TEMP_PREFIX = "ams-pr21-pg-", DATABASE = "ams_pr21_test", OWNER = "owner-pr16b", WORKSPACE = "workspace-pr16b";
const migration = (name: string) => readFileSync(new URL(`../migrations/ai-media-studio/${name}`, import.meta.url), "utf8");
const fixture = readFileSync(new URL("./fixtures/ai-media-studio-pr16-prerequisite.sql", import.meta.url), "utf8");
const forwards = ["20260721_pr8_publishing_accounts_forward.sql", "20260721_pr9_oauth_foundation_forward.sql",
  "20260721_pr11_oauth_policy_forward.sql", "20260721_pr12_oauth_callback_saga_forward.sql",
  "20260721_pr14_oauth_vault_operations_forward.sql", "20260721_pr15_provider_connection_stages_forward.sql",
  "20260721_pr16_provider_activation_integrity_forward.sql", "20260721_pr16b_durable_activation_forward.sql"].map(migration);
const rollback = migration("20260721_pr16b_durable_activation_rollback.sql");

function ownedUrl(): string {
  const raw = process.env.TEST_DATABASE_URL?.trim();
  if (!raw || process.env.DATABASE_URL?.trim()) throw new Error("PR16B requires only the owned TEST_DATABASE_URL");
  const parsed = new URL(raw); assert.equal(parsed.protocol, "postgresql:"); assert.equal(parsed.hostname, "localhost");
  assert.equal(parsed.username, "postgres"); assert.equal(parsed.password, ""); assert.equal(parsed.pathname, `/${DATABASE}`);
  assert.equal(parsed.searchParams.get("port"), "55432"); const socket = parsed.searchParams.get("host"); assert.ok(socket);
  const resolvedSocket = realpathSync(socket), resolvedRoot = realpathSync(dirname(resolvedSocket));
  assert.equal(dirname(resolvedRoot), realpathSync(process.platform === "darwin" ? "/private/tmp" : tmpdir()));
  assert.ok(basename(resolvedRoot).startsWith(TEMP_PREFIX)); assert.equal(basename(resolvedSocket), "socket"); return raw;
}

const enabled = Boolean(process.env.TEST_DATABASE_URL?.trim()), integrationTest = enabled ? test : test.skip;
const pool = new Pool({ connectionString: enabled ? ownedUrl() : "postgresql://postgres@localhost/ams_pr16b_disabled", max: 10, allowExitOnIdle: true });
const dialect = new PgDialect();
const uuid = (group: number, item: number) => `16b00000-${String(group).padStart(4, "0")}-4000-8000-${String(item).padStart(12, "0")}`;
const digest = (character: string) => character.repeat(64);

function repository() {
  const db: OAuthProviderConnectionTransactionalDatabase = {
    async execute(query: SQL) { const rendered = dialect.sqlToQuery(query); return pool.query(rendered.sql, rendered.params); },
    async transaction<T>(callback: (tx: OAuthProviderConnectionDatabase) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try { await client.query("BEGIN"); const result = await callback({ execute: async (query: SQL) => {
        const rendered = dialect.sqlToQuery(query); return client.query(rendered.sql, rendered.params);
      } }); await client.query("COMMIT"); return result;
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    },
  };
  return new DrizzleOAuthProviderActivationRepository(db);
}

type Seed = Awaited<ReturnType<typeof seedActivation>>;
async function seedActivation(client: PoolClient, group: number, leaseMs = 120_000) {
  const account = uuid(group, 1), session = uuid(group, 2), attempt = uuid(group, 3), candidate = uuid(group, 4);
  const tokenBinding = uuid(group, 5), leaseToken = uuid(group, 6);
  const now = Date.now(), sessionExpiresAt = new Date(now + 10 * 60_000).toISOString();
  const expiresAt = new Date(now + 30 * 60_000).toISOString(), leaseExpiresAt = new Date(now + leaseMs).toISOString();
  const accessLifetime = { kind: "expires_at" as const, expiresAt: new Date(now + 30 * 24 * 60 * 60_000).toISOString(),
    revalidateAt: new Date(now + 10 * 24 * 60 * 60_000).toISOString() };
  const refreshLifetime = { kind: "expires_at" as const, expiresAt: new Date(now + 300 * 24 * 60 * 60_000).toISOString(),
    revalidateAt: new Date(now + 20 * 24 * 60 * 60_000).toISOString() };
  await client.query(`INSERT INTO ai_media_provider_accounts(id,owner_user_id,workspace_id,provider_key,status)
    VALUES($1,$2,$3,'tiktok','disconnected')`, [account, OWNER, WORKSPACE]);
  await client.query(`INSERT INTO ai_media_oauth_sessions(id,owner_user_id,workspace_id,actor_user_id,provider_account_id,
    platform,state_digest,redirect_uri,requested_scopes,code_challenge,code_challenge_method,pkce_verifier_ref,pkce_mode,
    status,outcome,expires_at,consumed_at,exchange_status,lease_fencing,authorization_code_digest,
    authorization_code_ref,expected_credential_version,target_credential_version,token_binding_id,created_at,updated_at)
    VALUES($1,$2,$3,'actor-pr16b',$4,'tiktok',$5,'https://example.com/oauth/callback',$6,NULL,NULL,NULL,'none',
      'consumed','authorized',$7,clock_timestamp(),'succeeded',0,$8,$9,0,1,$10,clock_timestamp(),clock_timestamp())`,
  [session, OWNER, WORKSPACE, account, digest(String(group)), JSON.stringify(["user.info.basic", "video.publish"]), sessionExpiresAt,
    digest(String(group + 2)), `vault://ai-media-studio/oauth-code/v1/${session}`, tokenBinding]);
  await client.query(`INSERT INTO ai_media_oauth_connection_attempts(id,owner_user_id,workspace_id,actor_user_id,
    provider_account_id,platform,oauth_session_id,stage,stage_version,grant_family,manifest_revision,required_scopes,
    allowed_scopes,actual_scopes,token_artifacts,token_binding_id,expected_credential_version,target_credential_version,
    lease_token,lease_owner,lease_expires_at,lease_fencing,expires_at,created_at,updated_at)
    VALUES($1,$2,$3,'actor-pr16b',$4,'tiktok',$5,'awaiting_target',7,'tiktok_user','tiktok-v2',$6,$7,$7,$8,
      $9,0,1,NULL,NULL,NULL,3,$10,clock_timestamp(),clock_timestamp())`,
  [attempt, OWNER, WORKSPACE, account, session, JSON.stringify(["video.publish"]),
    JSON.stringify(["user.info.basic", "video.publish"]), JSON.stringify([{ role: "operational_access", lifetime: accessLifetime },
      { role: "refresh", lifetime: refreshLifetime }]), tokenBinding, expiresAt]);
  await client.query(`INSERT INTO ai_media_oauth_target_candidates(candidate_id,owner_user_id,workspace_id,actor_user_id,
    provider_account_id,platform,oauth_session_id,attempt_id,target_kind,target_external_id,safe_label,eligibility_digest,
    verified_tasks,capabilities,manifest_revision,discovered_at) VALUES($1,$2,$3,'actor-pr16b',$4,'tiktok',$5,$6,
      'tiktok_user',$7,'PR16B target',$8,'["video.publish"]','["publish_video"]','tiktok-v2',clock_timestamp())`,
  [candidate, OWNER, WORKSPACE, account, session, attempt, `target-pr16b-${group}`, digest("e")]);
  await assert.rejects(client.query(`INSERT INTO ai_media_oauth_target_selections(owner_user_id,workspace_id,actor_user_id,
    provider_account_id,platform,oauth_session_id,attempt_id,candidate_id,target_kind,target_external_id,
    selected_actor_user_id,selected_at,selection_digest,selection_version,selected_stage_version)
    VALUES($1,$2,'actor-pr16b',$3,'tiktok',$4,$5,$6,'tiktok_user',$7,'hostile-actor','2000-01-01',$8,1,999)`,
  [OWNER, WORKSPACE, account, session, attempt, candidate, `target-pr16b-${group}`, digest("f")]));
  const selected = await client.query<{ selected_at: Date; selection_digest: string }>(`INSERT INTO ai_media_oauth_target_selections(
    owner_user_id,workspace_id,actor_user_id,provider_account_id,platform,oauth_session_id,attempt_id,candidate_id,
    target_kind,target_external_id,selected_actor_user_id,selected_at,selection_digest,selection_version,selected_stage_version)
    VALUES($1,$2,'actor-pr16b',$3,'tiktok',$4,$5,$6,'tiktok_user',$7,'actor-pr16b','2000-01-01',$8,1,7)
    RETURNING selected_at,selection_digest`, [OWNER, WORKSPACE, account, session, attempt, candidate, `target-pr16b-${group}`, digest("f")]);
  const selection = selected.rows[0]!;
  const expectedDigest = deriveOAuthProviderSelectionDigest({ attemptId: attempt, scope: { ownerUserId: OWNER, workspaceId: WORKSPACE },
    actorUserId: "actor-pr16b", providerAccountId: account, oauthSessionId: session, platform: "tiktok", grantFamily: "tiktok_user",
    candidateId: candidate, targetId: `target-pr16b-${group}`, targetKind: "tiktok_user", eligibilityDigest: digest("e"),
    selectedStageVersion: 7, selectedAt: selection.selected_at.toISOString(), manifestRevision: "tiktok-v2", tokenBindingId: tokenBinding,
    expectedCredentialVersion: 0, targetCredentialVersion: 1, actualScopes: ["user.info.basic", "video.publish"], capabilities: ["publish_video"] });
  assert.equal(selection.selection_digest, expectedDigest);
  await client.query(`UPDATE ai_media_oauth_connection_attempts SET stage='activation_pending',stage_version=8,
    updated_at=clock_timestamp()+interval '1 millisecond' WHERE id=$1`, [attempt]);
  await client.query(`UPDATE ai_media_oauth_connection_attempts SET stage='activation_in_progress',stage_version=9,
    lease_token=$2,lease_owner='worker-pr16b',lease_expires_at=$3,lease_fencing=4,
    updated_at=clock_timestamp()+interval '2 milliseconds' WHERE id=$1`, [attempt, leaseToken, leaseExpiresAt]);
  return { account, session, attempt, candidate, tokenBinding, leaseToken, leaseExpiresAt, accessLifetime, refreshLifetime,
    targetId: `target-pr16b-${group}`, selectionDigest: selection.selection_digest };
}

function stageCommand(seed: Seed, group: number): StageOAuthProviderActivation {
  const artifactBindingId = uuid(group, 7);
  return { attemptId: seed.attempt, scope: { ownerUserId: OWNER, workspaceId: WORKSPACE }, leaseToken: seed.leaseToken,
    leaseFencing: 4, now: "2000-01-01T00:00:00.000Z", credentialBindingId: uuid(group, 8), actorUserId: "actor-pr16b",
    activationStageVersion: 9, selectedCandidateId: seed.candidate, selectedTargetId: seed.targetId,
    selectedTargetKind: "tiktok_user", selectedEligibilityDigest: digest("e"), selectedStageVersion: 7,
    selectionDigest: seed.selectionDigest, tokenBindingId: seed.tokenBinding, artifactBindingId,
    artifacts: [{ artifactId: uuid(group, 9), cleanupOperationId: uuid(group, 11), role: "operational_access",
      artifactBindingId, vaultReference: oauthProviderActivationVaultReference(artifactBindingId, "operational_access"),
      manifestRevision: "tiktok-v2", lifetime: seed.accessLifetime },
    { artifactId: uuid(group, 10), cleanupOperationId: uuid(group, 12), role: "refresh", artifactBindingId,
      vaultReference: oauthProviderActivationVaultReference(artifactBindingId, "refresh"), manifestRevision: "tiktok-v2",
      lifetime: seed.refreshLifetime }], actualScopes: ["user.info.basic", "video.publish"], capabilities: ["publish_video"],
    manifestRevision: "tiktok-v2", expectedCredentialVersion: 0, targetCredentialVersion: 1 };
}

before(async () => { if (!enabled) return; await pool.query(fixture); for (const forward of forwards) await pool.query(forward); });
after(async () => { await pool.end(); });

integrationTest("PR16B stages, replays, rejects cross-tenant/stale fences, and atomically authorizes once", async () => {
  const client = await pool.connect(); let seed: Seed;
  try { seed = await seedActivation(client, 1); } finally { client.release(); }
  const repo = repository(), stage = stageCommand(seed, 1);
  const graph = await repo.stageActivation(stage); assert.equal(graph?.state, "staged");
  assert.equal(graph?.state === "staged" ? graph.credentialBindingId : undefined, stage.credentialBindingId);
  assert.deepEqual(await repo.stageActivation(stage), graph);
  assert.equal(await repo.stageActivation({ ...stage, scope: { ownerUserId: "other", workspaceId: WORKSPACE } }), undefined);
  await assert.rejects(pool.query(`UPDATE ai_media_oauth_vault_operations_v2 SET state='dead_letter',
    dead_lettered_at=clock_timestamp(),last_error_code='invalid_obligation',updated_at=clock_timestamp()
    WHERE credential_binding_id=$1`, [stage.credentialBindingId]));
  const finalize: FinalizeDurableOAuthProviderActivation = { ...stage, artifacts: stage.artifacts.map(({ artifactId: _a,
    cleanupOperationId: _o, ...artifact }) => artifact) };
  const results = await Promise.all([repo.finalizeStagedActivation(finalize), repo.finalizeStagedActivation(finalize)]);
  assert.deepEqual(results.map((result) => result?.state).sort(), ["activated", "replayed"]);
  assert.ok(results.every((result) => result?.result.attempt.stage === "authorized"));
  const postCommitStageReplay = await repo.stageActivation(stage);
  assert.equal(postCommitStageReplay?.state, "authorized");
  await assert.rejects(repo.finalizeStagedActivation({ ...finalize, selectedTargetId: "different-target" }), OAuthProviderConnectionError);
  const state = await pool.query(`SELECT attempt.stage,attempt.stage_version,binding.state binding_state,
    (SELECT count(*)::int FROM ai_media_oauth_credential_artifacts WHERE credential_binding_id=binding.id AND state='active') active,
    (SELECT count(*)::int FROM ai_media_oauth_vault_operations_v2 WHERE credential_binding_id=binding.id AND state='retained') retained
    FROM ai_media_oauth_connection_attempts attempt JOIN ai_media_provider_account_credential_bindings binding
      ON binding.attempt_id=attempt.id WHERE attempt.id=$1`, [seed.attempt]);
  assert.deepEqual(state.rows, [{ stage: "authorized", stage_version: 10, binding_state: "authorized", active: 2, retained: 2 }]);
});

integrationTest("PR16B crash recovery atomically abandons an expired staged graph and never re-fences it", async () => {
  const client = await pool.connect(); let seed: Seed;
  try { seed = await seedActivation(client, 2, 1_500); } finally { client.release(); }
  const repo = repository(), stage = stageCommand(seed, 2); assert.ok(await repo.stageActivation(stage));
  await new Promise((resolve) => setTimeout(resolve, 1_700));
  assert.equal(await repo.stageActivation(stage), undefined);
  assert.equal(await repo.claim({ attemptId: seed.attempt, scope: stage.scope, stage: "activation_pending",
    leaseToken: uuid(2, 20), leaseOwner: "new-worker", leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(), now: new Date().toISOString() }), undefined);
  const recovered = await repo.recoverExpiredStagedActivation({ attemptId: seed.attempt, scope: stage.scope });
  assert.equal(recovered?.stage, "activation_indeterminate");
  const state = await pool.query(`SELECT attempt.stage,binding.state binding_state,
    (SELECT count(*)::int FROM ai_media_oauth_vault_operations_v2 WHERE credential_binding_id=binding.id AND state='cleanup_pending') cleanup
    FROM ai_media_oauth_connection_attempts attempt JOIN ai_media_provider_account_credential_bindings binding
      ON binding.attempt_id=attempt.id WHERE attempt.id=$1`, [seed.attempt]);
  assert.deepEqual(state.rows, [{ stage: "activation_indeterminate", binding_state: "abandoned", cleanup: 2 }]);
});

integrationTest("PR16B forward and evidence-preserving rollback execute", async () => {
  await pool.query(rollback);
  const objects = await pool.query(`SELECT to_regprocedure('public.ai_media_oauth_pr16b_cleanup_gate()') gate,
    to_regclass('public.ai_media_provider_account_credential_bindings') bindings`);
  assert.equal(objects.rows[0].gate, null); assert.equal(objects.rows[0].bindings, "ai_media_provider_account_credential_bindings");
});
