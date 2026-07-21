import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { basename, dirname } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";
import test, { after, before } from "node:test";
import { Pool, type PoolClient } from "pg";
import { deriveOAuthProviderAuthorizedDigest, type OAuthProviderActivationArtifactEvidence } from
  "../server/ai-media-studio/oauth/provider-connection-contracts";

const TEMP_PREFIX = "ams-pr21-pg-", DATABASE = "ams_pr21_test", OWNER = "owner-pr16a", WORKSPACE = "workspace-pr16a";
const migration = (name: string) => readFileSync(new URL(`../migrations/ai-media-studio/${name}`, import.meta.url), "utf8");
const fixture = readFileSync(new URL("./fixtures/ai-media-studio-pr16-prerequisite.sql", import.meta.url), "utf8");
const forwards = ["20260721_pr8_publishing_accounts_forward.sql", "20260721_pr9_oauth_foundation_forward.sql",
  "20260721_pr11_oauth_policy_forward.sql", "20260721_pr12_oauth_callback_saga_forward.sql",
  "20260721_pr14_oauth_vault_operations_forward.sql", "20260721_pr15_provider_connection_stages_forward.sql",
  "20260721_pr16_provider_activation_integrity_forward.sql"].map(migration);
const rollback = migration("20260721_pr16_provider_activation_integrity_rollback.sql");

function ownedUrl(): string {
  const value = process.env.TEST_DATABASE_URL?.trim();
  if (!value || process.env.DATABASE_URL?.trim()) throw new Error("PR16A requires only the owned TEST_DATABASE_URL");
  const parsed = new URL(value); assert.equal(parsed.protocol, "postgresql:"); assert.equal(parsed.hostname, "localhost");
  assert.equal(parsed.username, "postgres"); assert.equal(parsed.password, ""); assert.equal(parsed.pathname, `/${DATABASE}`);
  assert.equal(parsed.searchParams.get("port"), "55432"); const socket = parsed.searchParams.get("host"); assert.ok(socket);
  const resolvedSocket = realpathSync(socket), resolvedRoot = realpathSync(dirname(resolvedSocket));
  assert.equal(dirname(resolvedRoot), realpathSync(process.platform === "darwin" ? "/private/tmp" : tmpdir()));
  assert.ok(basename(resolvedRoot).startsWith(TEMP_PREFIX)); assert.equal(basename(resolvedSocket), "socket"); return value;
}

const enabled = Boolean(process.env.TEST_DATABASE_URL?.trim()), integrationTest = enabled ? test : test.skip;
const pool = new Pool({ connectionString: enabled ? ownedUrl() : "postgresql://postgres@localhost/ams_pr16a_disabled", allowExitOnIdle: true });
const uuid = (group: number, item: number) => `16000000-${String(group).padStart(4, "0")}-4000-8000-${String(item).padStart(12, "0")}`;
const digest = (character: string) => character.repeat(64);
const vaultReference = (binding: string, role: string) => `vault://ai-media-studio/oauth-role-token/v2/${createHash("sha256")
  .update(JSON.stringify([binding, role]), "utf8").digest("hex")}`;

before(async () => { if (!enabled) return; await pool.query(fixture); for (const forward of forwards) await pool.query(forward); });
after(async () => { await pool.end(); });

async function seedStagedGraph(
  client: PoolClient, group: number, complete = true, tamperScopes = false,
  platform: "tiktok" | "facebook" = "tiktok",
) {
  const isMeta = platform === "facebook";
  const account = uuid(group, 1), session = uuid(group, 2), attempt = uuid(group, 3), candidate = uuid(group, 4);
  const binding = uuid(group, 5), artifactBinding = uuid(group, 6), tokenBinding = uuid(group, 7);
  const artifacts = [uuid(group, 8), uuid(group, 9)], selectionDigest = digest("a"), eligibilityDigest = digest("b");
  const actualScopes = isMeta ? ["pages_manage_posts"] : ["user.info.basic", "video.publish"];
  const requiredScopes = isMeta ? ["pages_manage_posts"] : ["video.publish"];
  const manifestRevision = isMeta ? "meta-v2" : "tiktok-v2";
  const grantFamily = isMeta ? "meta_facebook_login" : "tiktok_user";
  const targetKind = isMeta ? "facebook_page" : "tiktok_user";
  const authorizationCodeReference = `vault://ai-media-studio/oauth-code/v1/${session}`;
  const tokenArtifacts = isMeta
    ? [{ role: "grant_user_access", lifetime: { kind: "expires_at", expiresAt: "2027-07-21T00:00:00.000Z", revalidateAt: "2026-08-21T00:00:00.000Z" } }]
    : [{ role: "operational_access", lifetime: { kind: "expires_at", expiresAt: "2027-07-21T00:00:00.000Z", revalidateAt: "2026-08-21T00:00:00.000Z" } },
      { role: "refresh", lifetime: { kind: "expires_at", expiresAt: "2027-07-21T00:00:00.000Z", revalidateAt: "2026-09-21T00:00:00.000Z" } }];
  await client.query(`INSERT INTO ai_media_provider_accounts(id,owner_user_id,workspace_id,provider_key,status)
    VALUES($1,$2,$3,$4,'disconnected')`, [account, OWNER, WORKSPACE, platform]);
  await client.query(`INSERT INTO ai_media_oauth_sessions(id,owner_user_id,workspace_id,actor_user_id,provider_account_id,
    platform,state_digest,redirect_uri,requested_scopes,code_challenge,code_challenge_method,pkce_verifier_ref,pkce_mode,
    status,outcome,expires_at,consumed_at,exchange_status,lease_fencing,authorization_code_digest,
    authorization_code_ref,expected_credential_version,target_credential_version,token_binding_id,created_at,updated_at)
    VALUES($1,$2,$3,'actor-pr16a',$4,$9,$5,'https://example.com/oauth/callback',$6,NULL,NULL,NULL,'none',
      'consumed','authorized',clock_timestamp()+interval '10 minutes',clock_timestamp(),'succeeded',0,$7,
      $10,0,1,$8,clock_timestamp(),clock_timestamp())`,
    [session, OWNER, WORKSPACE, account, digest(String(group % 10)), JSON.stringify(actualScopes), digest("c"), tokenBinding,
      platform, authorizationCodeReference]);
  await client.query(`INSERT INTO ai_media_oauth_connection_attempts(id,owner_user_id,workspace_id,actor_user_id,
    provider_account_id,platform,oauth_session_id,stage,stage_version,grant_family,manifest_revision,required_scopes,
    allowed_scopes,actual_scopes,token_artifacts,token_binding_id,expected_credential_version,target_credential_version,
    lease_token,lease_owner,lease_expires_at,lease_fencing,expires_at,created_at,updated_at)
    VALUES($1,$2,$3,'actor-pr16a',$4,$10,$5,'activation_in_progress',8,$11,$12,
      $13,$6,$6,$7,$8,0,1,$9,'activation-worker',clock_timestamp()+interval '2 minutes',3,
      clock_timestamp()+interval '30 minutes',clock_timestamp(),clock_timestamp())`,
    [attempt, OWNER, WORKSPACE, account, session, JSON.stringify(actualScopes), JSON.stringify(tokenArtifacts), tokenBinding,
      uuid(group, 10), platform, grantFamily, manifestRevision, JSON.stringify(requiredScopes)]);
  await client.query(`INSERT INTO ai_media_oauth_target_candidates(candidate_id,owner_user_id,workspace_id,actor_user_id,
    provider_account_id,platform,oauth_session_id,attempt_id,target_kind,target_external_id,safe_label,eligibility_digest,
    verified_tasks,capabilities,manifest_revision,discovered_at)
    VALUES($1,$2,$3,'actor-pr16a',$4,$9,$5,$6,$10,$7,'PR16A target',$8,
      $11,'["publish_video"]',$12,clock_timestamp())`,
    [candidate, OWNER, WORKSPACE, account, session, attempt, `target-pr16a-${group}`, eligibilityDigest,
      platform, targetKind, JSON.stringify(requiredScopes), manifestRevision]);
  await client.query(`INSERT INTO ai_media_oauth_target_selections(owner_user_id,workspace_id,actor_user_id,
    provider_account_id,platform,oauth_session_id,attempt_id,candidate_id,target_kind,target_external_id,
    selected_actor_user_id,selected_at,selection_digest,selection_version,selected_stage_version)
    VALUES($1,$2,'actor-pr16a',$3,$9,$4,$5,$6,$10,$7,'actor-pr16a',clock_timestamp(),$8,1,7)`,
    [OWNER, WORKSPACE, account, session, attempt, candidate, `target-pr16a-${group}`, selectionDigest, platform, targetKind]);
  await client.query(`INSERT INTO ai_media_provider_account_credential_bindings(id,owner_user_id,workspace_id,
    actor_user_id,provider_account_id,platform,oauth_session_id,attempt_id,candidate_id,target_kind,target_external_id,
    selection_digest,selected_stage_version,activation_stage_version,selected_eligibility_digest,token_binding_id,
    artifact_binding_id,expected_credential_version,target_credential_version,actual_scopes,capabilities,manifest_revision)
    VALUES($1,$2,$3,'actor-pr16a',$4,$14,$5,$6,$7,$15,$8,$9,7,8,$10,$11,$12,0,1,$13,
      '["publish_video"]',$16)`,
    [binding, OWNER, WORKSPACE, account, session, attempt, candidate, `target-pr16a-${group}`, selectionDigest,
      eligibilityDigest, tokenBinding, artifactBinding, JSON.stringify(tamperScopes ? [requiredScopes[0]!] : actualScopes),
      platform, targetKind, manifestRevision]);
  const activationRoles = isMeta ? ["operational_access"] : complete ? ["operational_access", "refresh"] : ["operational_access"];
  for (const [index, role] of activationRoles.entries()) {
    const artifact = artifacts[index]!, reference = vaultReference(artifactBinding, role);
    const lifetime = isMeta
      ? { kind: "provider_non_expiring" as const, revalidateAt: "2026-08-21T00:00:00.000Z" }
      : tokenArtifacts[index]!.lifetime;
    await client.query(`INSERT INTO ai_media_oauth_credential_artifacts(id,owner_user_id,workspace_id,actor_user_id,
      provider_account_id,platform,oauth_session_id,attempt_id,credential_binding_id,candidate_id,target_kind,
      target_external_id,token_binding_id,artifact_binding_id,role,vault_reference,lifetime_kind,expires_at,revalidate_at,
      manifest_revision,expected_credential_version,target_credential_version,selection_digest,selected_stage_version,
      selected_eligibility_digest,state,created_at,updated_at)
      VALUES($1,$2,$3,'actor-pr16a',$4,$18,$5,$6,$7,$8,$19,$9,$10,$11,$12,$13,$20,
        $16,$17,$21,0,1,$14,7,$15,
        'candidate',clock_timestamp(),clock_timestamp())`,
      [artifact, OWNER, WORKSPACE, account, session, attempt, binding, candidate, `target-pr16a-${group}`,
        tokenBinding, artifactBinding, role, reference, selectionDigest, eligibilityDigest,
        lifetime.kind === "expires_at" ? lifetime.expiresAt : null, lifetime.revalidateAt,
        platform, targetKind, lifetime.kind, manifestRevision]);
    await client.query(`INSERT INTO ai_media_oauth_vault_operations_v2(owner_user_id,workspace_id,actor_user_id,
      provider_account_id,platform,oauth_session_id,attempt_id,credential_binding_id,artifact_id,artifact_binding_id,
      role,vault_reference,target_credential_version,state,available_at,quiescent_until,created_at,updated_at)
      VALUES($1,$2,'actor-pr16a',$3,$11,$4,$5,$6,$7,$8,$9,$10,1,'cleanup_pending',
        clock_timestamp()+interval '1 second',clock_timestamp()+interval '60 seconds',clock_timestamp(),clock_timestamp())`,
      [OWNER, WORKSPACE, account, session, attempt, binding, artifact, artifactBinding, role, reference, platform]);
  }
  return { account, session, attempt, candidate, binding, tokenBinding, artifactBinding, actualScopes,
    capabilities: ["publish_video"] as const, targetExternalId: `target-pr16a-${group}`,
    selectionDigest, eligibilityDigest, targetKind, manifestRevision, platform };
}

type StagedGraph = Awaited<ReturnType<typeof seedStagedGraph>>;

async function authorizeGraph(client: PoolClient, graph: StagedGraph, forcedDigest?: string): Promise<void> {
  const derived = await client.query<{ digest: string }>(
    "SELECT ai_media_oauth_pr16_authorized_digest($1) digest", [graph.binding],
  );
  const artifactRows = await client.query<{
    role: "operational_access" | "refresh"; artifact_binding_id: string; vault_reference: string;
    manifest_revision: string; lifetime_kind: "expires_at" | "provider_non_expiring"; expires_at: Date | null; revalidate_at: Date;
  }>(`SELECT role,artifact_binding_id,vault_reference,manifest_revision,lifetime_kind,expires_at,revalidate_at
    FROM ai_media_oauth_credential_artifacts WHERE credential_binding_id=$1
    ORDER BY CASE role WHEN 'operational_access' THEN 1 WHEN 'refresh' THEN 2 ELSE 3 END`, [graph.binding]);
  const artifacts: readonly OAuthProviderActivationArtifactEvidence[] = artifactRows.rows.map((artifact) => ({
    role: artifact.role, artifactBindingId: artifact.artifact_binding_id, vaultReference: artifact.vault_reference,
    manifestRevision: artifact.manifest_revision,
    lifetime: artifact.lifetime_kind === "expires_at"
      ? { kind: "expires_at", expiresAt: artifact.expires_at!.toISOString(), revalidateAt: artifact.revalidate_at.toISOString() }
      : { kind: "provider_non_expiring", revalidateAt: artifact.revalidate_at.toISOString() },
  }));
  const contractDigest = deriveOAuthProviderAuthorizedDigest({
    scope: { ownerUserId: OWNER, workspaceId: WORKSPACE }, actorUserId: "actor-pr16a",
    attemptId: graph.attempt, activationStageVersion: 8, selectedCandidateId: graph.candidate,
    selectedTargetId: graph.targetExternalId, selectedTargetKind: graph.targetKind,
    selectedEligibilityDigest: graph.eligibilityDigest, selectedStageVersion: 7,
    selectionDigest: graph.selectionDigest, tokenBindingId: graph.tokenBinding,
    artifactBindingId: graph.artifactBinding, artifacts, actualScopes: graph.actualScopes,
    capabilities: graph.capabilities, manifestRevision: graph.manifestRevision,
    expectedCredentialVersion: 0, targetCredentialVersion: 1, leaseToken: uuid(5, 10), leaseFencing: 3,
    now: "2026-07-21T12:00:00.000Z",
  });
  assert.equal(derived.rows[0]!.digest, contractDigest);
  const authorizedDigest = forcedDigest ?? derived.rows[0]!.digest;
  await client.query(`UPDATE ai_media_oauth_connection_attempts SET stage='authorized',stage_version=stage_version+1,
    lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,failure_code=NULL,terminal_outcome='authorized',
    terminal_evidence_digest=$2,terminal_at=clock_timestamp(),updated_at=clock_timestamp()+interval '1 millisecond'
    WHERE id=$1`, [graph.attempt, authorizedDigest]);
  await client.query(`UPDATE ai_media_provider_account_credential_bindings SET state='authorized',authorized_digest=$2,
    authorized_at=clock_timestamp(),updated_at=clock_timestamp()+interval '1 millisecond' WHERE id=$1`,
  [graph.binding, authorizedDigest]);
  await client.query(`UPDATE ai_media_oauth_credential_artifacts SET state='active',activated_at=clock_timestamp(),
    updated_at=clock_timestamp()+interval '1 millisecond' WHERE credential_binding_id=$1`, [graph.binding]);
  await client.query(`UPDATE ai_media_oauth_vault_operations_v2 SET state='retained',available_at='infinity',
    quiescent_until='infinity',updated_at=clock_timestamp()+interval '1 millisecond' WHERE credential_binding_id=$1`,
  [graph.binding]);
  await client.query(`UPDATE ai_media_provider_accounts SET status='active',external_account_id=$2,
    capabilities='["publish_video"]',granted_scopes=$3,credential_status='active',credential_version=1,
    credential_source='oauth_role_v2',credential_actor_user_id='actor-pr16a',credential_source_session_id=$4,
    token_binding_id=$5,credential_binding_id=$6,token_kind='role_v2',token_manifest_revision=$7,
    updated_at=clock_timestamp()+interval '1 millisecond' WHERE id=$1`,
  [graph.account, graph.targetExternalId, JSON.stringify(graph.actualScopes), graph.session, graph.tokenBinding, graph.binding,
    graph.manifestRevision]);
}

async function expectRejected(work: (client: PoolClient) => Promise<void>): Promise<void> {
  const client = await pool.connect(); try { await client.query("BEGIN"); await work(client);
    await assert.rejects(client.query("SET CONSTRAINTS ALL IMMEDIATE"));
  } finally { await client.query("ROLLBACK").catch(() => undefined); client.release(); }
}

integrationTest("PR16A installs exact validated controls without PUBLIC mutation grants", async () => {
  const catalog = await pool.query<{ relation_count: string; unvalidated: string; unsafe_acl: string }>(`SELECT
    (SELECT count(*) FROM pg_class WHERE oid IN ('public.ai_media_provider_account_credential_bindings'::regclass,
      'public.ai_media_oauth_credential_artifacts'::regclass,'public.ai_media_oauth_vault_operations_v2'::regclass)) relation_count,
    (SELECT count(*) FROM pg_constraint WHERE conrelid IN ('public.ai_media_provider_account_credential_bindings'::regclass,
      'public.ai_media_oauth_credential_artifacts'::regclass,'public.ai_media_oauth_vault_operations_v2'::regclass)
      AND NOT convalidated) unvalidated,
    (SELECT count(*) FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(relation.relacl,acldefault('r',relation.relowner))) privilege
      WHERE namespace.nspname='public' AND relation.relname LIKE 'ai_media_%' AND privilege.grantee=0
        AND privilege.privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER')) unsafe_acl`);
  assert.deepEqual(catalog.rows, [{ relation_count: "3", unvalidated: "0", unsafe_acl: "0" }]);
  const controls = await pool.query<{ stage: boolean; graph: boolean; account_fk: boolean }>(`SELECT
    pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname='ai_media_oauth_connection_attempts_stage_ck')) LIKE '%activation_indeterminate%' stage,
    to_regprocedure('public.ai_media_oauth_assert_pr16_binding(uuid)') IS NOT NULL graph,
    (SELECT condeferrable AND condeferred AND convalidated FROM pg_constraint
      WHERE conname='ai_media_provider_accounts_oauth_role_v2_binding_fk') account_fk`);
  assert.deepEqual(controls.rows, [{ stage: true, graph: true, account_fk: true }]);
});

integrationTest("PR16A accepts a complete staged graph and rejects partial or altered evidence", async () => {
  const client = await pool.connect(); try { await client.query("BEGIN"); await seedStagedGraph(client, 1);
    await client.query("SET CONSTRAINTS ALL IMMEDIATE"); await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error;
  } finally { client.release(); }
  await expectRejected((db) => seedStagedGraph(db, 2, false).then(() => undefined));
  await expectRejected((db) => seedStagedGraph(db, 3, true, true).then(() => undefined));
});

integrationTest("PR16A terminalizes ambiguous activation and preserves abandoned cleanup", async () => {
  const client = await pool.connect(); let graph: { attempt: string; binding: string };
  try { await client.query("BEGIN"); graph = await seedStagedGraph(client, 4); await client.query("SET CONSTRAINTS ALL IMMEDIATE"); await client.query("COMMIT"); }
  catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
  const terminalClient = await pool.connect();
  try { await terminalClient.query("BEGIN");
    await terminalClient.query(`UPDATE ai_media_provider_account_credential_bindings SET state='abandoned',abandoned_at=clock_timestamp(),updated_at=clock_timestamp()+interval '1 millisecond' WHERE id=$1`, [graph.binding]);
    await terminalClient.query(`UPDATE ai_media_oauth_credential_artifacts SET state='cleanup_dead_letter',updated_at=clock_timestamp()+interval '1 millisecond' WHERE credential_binding_id=$1`, [graph.binding]);
    await terminalClient.query(`UPDATE ai_media_oauth_vault_operations_v2 SET state='dead_letter',dead_lettered_at=clock_timestamp(),last_error_code='invalid_obligation',updated_at=clock_timestamp()+interval '1 millisecond' WHERE credential_binding_id=$1`, [graph.binding]);
    await terminalClient.query(`UPDATE ai_media_oauth_connection_attempts SET stage='activation_indeterminate',stage_version=stage_version+1,
      lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,failure_code='activation_ambiguous',terminal_outcome='indeterminate',
      terminal_evidence_digest=$2,terminal_at=clock_timestamp(),updated_at=clock_timestamp()+interval '1 millisecond' WHERE id=$1`, [graph.attempt, digest("d")]);
    await terminalClient.query("SET CONSTRAINTS ALL IMMEDIATE"); await terminalClient.query("COMMIT");
  } catch (error) { await terminalClient.query("ROLLBACK").catch(() => undefined); throw error;
  } finally { terminalClient.release(); }
  const state = await pool.query<{ stage: string; binding_state: string; cleanup_count: string }>(`SELECT attempt.stage,binding.state binding_state,
    (SELECT count(*) FROM ai_media_oauth_vault_operations_v2 operation WHERE operation.credential_binding_id=binding.id AND operation.state='dead_letter') cleanup_count
    FROM ai_media_oauth_connection_attempts attempt JOIN ai_media_provider_account_credential_bindings binding ON binding.attempt_id=attempt.id WHERE attempt.id=$1`, [graph.attempt]);
  assert.deepEqual(state.rows, [{ stage: "activation_indeterminate", binding_state: "abandoned", cleanup_count: "2" }]);
  await assert.rejects(pool.query(`UPDATE ai_media_oauth_connection_attempts SET stage='activation_pending',stage_version=stage_version+1,updated_at=clock_timestamp()+interval '1 millisecond' WHERE id=$1`, [graph.attempt]));
});

integrationTest("PR16A blocks account activation without the authorized graph and accepts the exact atomic transition", async () => {
  const client = await pool.connect(); let graph: StagedGraph;
  try { await client.query("BEGIN"); graph = await seedStagedGraph(client, 5);
    await client.query("SET CONSTRAINTS ALL IMMEDIATE"); await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error;
  } finally { client.release(); }
  await expectRejected(async (db) => {
    await db.query(`UPDATE ai_media_provider_accounts SET status='active',external_account_id=$2,
      capabilities='["publish_video"]',granted_scopes=$3,credential_status='active',credential_version=1,
      credential_source='oauth_role_v2',credential_actor_user_id='actor-pr16a',credential_source_session_id=$4,
      token_binding_id=$5,credential_binding_id=$6,token_kind='role_v2',token_manifest_revision='tiktok-v2',
      updated_at=clock_timestamp()+interval '1 millisecond' WHERE id=$1`,
    [graph.account, graph.targetExternalId, JSON.stringify(graph.actualScopes), graph.session, graph.tokenBinding, graph.binding]);
  });
  await expectRejected((db) => authorizeGraph(db, graph, digest("f")));
  const activationClient = await pool.connect();
  try { await activationClient.query("BEGIN"); await authorizeGraph(activationClient, graph);
    await activationClient.query("SET CONSTRAINTS ALL IMMEDIATE"); await activationClient.query("COMMIT");
  } catch (error) { await activationClient.query("ROLLBACK").catch(() => undefined); throw error;
  } finally { activationClient.release(); }
  const activated = await pool.query<{ account_status: string; source: string; binding_state: string; artifact_count: string; retained_count: string }>(`SELECT
    account.status account_status,account.credential_source source,binding.state binding_state,
    (SELECT count(*) FROM ai_media_oauth_credential_artifacts artifact WHERE artifact.credential_binding_id=binding.id AND artifact.state='active') artifact_count,
    (SELECT count(*) FROM ai_media_oauth_vault_operations_v2 operation WHERE operation.credential_binding_id=binding.id AND operation.state='retained') retained_count
    FROM ai_media_provider_accounts account JOIN ai_media_provider_account_credential_bindings binding ON binding.id=account.credential_binding_id
    WHERE account.id=$1`, [graph.account]);
  assert.deepEqual(activated.rows, [{ account_status: "active", source: "oauth_role_v2", binding_state: "authorized", artifact_count: "2", retained_count: "2" }]);
  await assert.rejects(pool.query(`UPDATE ai_media_provider_accounts
    SET granted_scopes='["video.publish"]',updated_at=clock_timestamp()+interval '1 millisecond' WHERE id=$1`,
  [graph.account]));
});

integrationTest("PR16A rejects inert cleanup deadlines, contradictory abandoned pairs, and null token lifetimes", async () => {
  const lifetimePolicy = await pool.query<{ null_safe: boolean; meta_nonexp_safe: boolean; google_revocation_safe: boolean; tiktok_revocation_safe: boolean }>(`SELECT ai_media_oauth_token_artifacts_are_safe(
    '[{"role":"operational_access","lifetime":{"kind":"expires_at","expiresAt":null,"revalidateAt":null}},{"role":"refresh","lifetime":{"kind":"expires_at","expiresAt":null,"revalidateAt":null}}]'::jsonb,
    'tiktok_user') null_safe,
    ai_media_oauth_token_artifacts_are_safe('[{"role":"grant_user_access","lifetime":{"kind":"provider_non_expiring","revalidateAt":"2026-08-21T00:00:00.000Z"}}]'::jsonb,'meta_facebook_login') meta_nonexp_safe,
    ai_media_oauth_token_artifacts_are_safe('[{"role":"operational_access","lifetime":{"kind":"expires_at","expiresAt":"2027-07-21T00:00:00.000Z","revalidateAt":"2026-08-21T00:00:00.000Z"}},{"role":"refresh","lifetime":{"kind":"revocation_bound","revalidateAt":"2026-09-21T00:00:00.000Z"}}]'::jsonb,'google_user') google_revocation_safe,
    ai_media_oauth_token_artifacts_are_safe('[{"role":"operational_access","lifetime":{"kind":"expires_at","expiresAt":"2027-07-21T00:00:00.000Z","revalidateAt":"2026-08-21T00:00:00.000Z"}},{"role":"refresh","lifetime":{"kind":"revocation_bound","revalidateAt":"2026-09-21T00:00:00.000Z"}}]'::jsonb,'tiktok_user') tiktok_revocation_safe`);
  assert.deepEqual(lifetimePolicy.rows, [{ null_safe: false, meta_nonexp_safe: false, google_revocation_safe: true, tiktok_revocation_safe: false }]);
  const client = await pool.connect();
  try { await client.query("BEGIN"); const graph = await seedStagedGraph(client, 7);
    await assert.rejects(client.query(`UPDATE ai_media_oauth_vault_operations_v2
      SET state='dead_letter',available_at='infinity',quiescent_until='infinity',dead_lettered_at=clock_timestamp(),
        last_error_code='invalid_obligation',updated_at=clock_timestamp()+interval '1 millisecond'
      WHERE credential_binding_id=$1`, [graph.binding]));
  } finally { await client.query("ROLLBACK").catch(() => undefined); client.release(); }
  const contradictoryClient = await pool.connect();
  try { await contradictoryClient.query("BEGIN"); const graph = await seedStagedGraph(contradictoryClient, 8);
    await contradictoryClient.query(`UPDATE ai_media_provider_account_credential_bindings
      SET state='abandoned',abandoned_at=clock_timestamp(),updated_at=clock_timestamp()+interval '1 millisecond' WHERE id=$1`, [graph.binding]);
    await contradictoryClient.query(`UPDATE ai_media_oauth_vault_operations_v2
      SET state='dead_letter',dead_lettered_at=clock_timestamp(),last_error_code='invalid_obligation',
        updated_at=clock_timestamp()+interval '1 millisecond'
      WHERE credential_binding_id=$1`, [graph.binding]);
    await contradictoryClient.query(`UPDATE ai_media_oauth_connection_attempts SET stage='failed',stage_version=stage_version+1,
      lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,failure_code='activation_rejected',terminal_outcome='failed',
      terminal_evidence_digest=$2,terminal_at=clock_timestamp(),updated_at=clock_timestamp()+interval '1 millisecond'
      WHERE id=$1`, [graph.attempt, digest("e")]);
    await assert.rejects(contradictoryClient.query("SET CONSTRAINTS ALL IMMEDIATE"));
  } finally { await contradictoryClient.query("ROLLBACK").catch(() => undefined); contradictoryClient.release(); }
});

integrationTest("PR16A authorizes Meta's target operational artifact from its grant-user exchange evidence", async () => {
  const client = await pool.connect(); let graph: StagedGraph;
  try { await client.query("BEGIN"); graph = await seedStagedGraph(client, 9, true, false, "facebook");
    await authorizeGraph(client, graph); await client.query("SET CONSTRAINTS ALL IMMEDIATE"); await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error;
  } finally { client.release(); }
  const state = await pool.query<{ source: string; role: string; lifetime: string; artifacts: string }>(`SELECT
    account.credential_source source,min(artifact.role) role,min(artifact.lifetime_kind) lifetime,count(*) artifacts
    FROM ai_media_provider_accounts account JOIN ai_media_oauth_credential_artifacts artifact
      ON artifact.credential_binding_id=account.credential_binding_id WHERE account.id=$1
    GROUP BY account.credential_source`, [graph.account]);
  assert.deepEqual(state.rows, [{ source: "oauth_role_v2", role: "operational_access", lifetime: "provider_non_expiring", artifacts: "1" }]);
});

integrationTest("PR16A live rollback preserves every evidence row", async () => {
  await pool.query(rollback);
  const retained = await pool.query<{ bindings: string; artifacts: string; obligations: string }>(`SELECT
    (SELECT count(*) FROM ai_media_provider_account_credential_bindings) bindings,
    (SELECT count(*) FROM ai_media_oauth_credential_artifacts) artifacts,
    (SELECT count(*) FROM ai_media_oauth_vault_operations_v2) obligations`);
  assert.deepEqual(retained.rows, [{ bindings: "4", artifacts: "7", obligations: "7" }]);
});
