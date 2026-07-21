import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { DrizzleOAuthRoleTokenCleanupRepository } from "../server/ai-media-studio/oauth/drizzle-role-token-cleanup-repository";
import type { OAuthDatabase } from "../server/ai-media-studio/oauth/drizzle-repository";

const dialect = new PgDialect();

test("role-token cleanup claim is DB-clock bounded, SKIP LOCKED, exactly abandoned, and fail-closed for live graph references", async () => {
  const calls: ReturnType<PgDialect["sqlToQuery"]>[] = [];
  const db: OAuthDatabase = { async execute(query) { calls.push(dialect.sqlToQuery(query)); return { rows: [] }; } };
  const repository = new DrizzleOAuthRoleTokenCleanupRepository(db);
  await repository.claimDue({ limit: 100, lease: {
    leaseToken: "11111111-1111-4111-8111-111111111111",
    leaseOwner: "role-cleanup-1",
    leaseExpiresAt: "2026-07-21T12:02:00.000Z",
  } });
  const sql = calls[0].sql.replace(/\s+/gu, " ");
  for (const pattern of [
    /state in \('cleanup_pending','retry_wait','verify_wait'\)/iu,
    /available_at<=clock_timestamp\(\).*quiescent_until<=clock_timestamp\(\)/iu,
    /attempt<operation\.max_attempts/iu,
    /binding\.state='abandoned'/iu,
    /connection_attempt\.stage in \('activation_indeterminate','failed'\)/iu,
    /credential_source='oauth_role_v2'.*account\.status='active'.*credential_status='active'/iu,
    /authorized_binding.*state='authorized'/iu,
    /active_artifact.*state='active'/iu,
    /retained_operation.*state='retained'/iu,
    /for update of operation,artifact,binding,account_record skip locked/iu,
    /limit \$\d+/iu,
    /lease_fencing=operation\.lease_fencing\+1/iu,
    /set state='cleanup_leased'/iu,
  ]) assert.match(sql, pattern);
  assert.doesNotMatch(sql, /current_timestamp/iu);
  await assert.rejects(repository.claimDue({ limit: 101, lease: {
    leaseToken: "x", leaseOwner: "x", leaseExpiresAt: "x",
  } }), /Invalid role token cleanup claim/u);
});

test("role-token cleanup CAS updates operation and artifact together for settle, completion, retry, and dead letter", async () => {
  const calls: ReturnType<PgDialect["sqlToQuery"]>[] = [];
  const db: OAuthDatabase = { async execute(query) { calls.push(dialect.sqlToQuery(query)); return { rows: [] }; } };
  const repository = new DrizzleOAuthRoleTokenCleanupRepository(db);
  await repository.acknowledgeDelete({ id: "1", leaseToken: "2", leaseFencing: 3 });
  await repository.recordFailure({ id: "1", leaseToken: "2", leaseFencing: 3, errorCode: "vault_rejected" });
  const acknowledge = calls[0].sql.replace(/\s+/gu, " ");
  assert.match(acknowledge, /for update of operation,artifact,binding,account_record/iu);
  assert.match(acknowledge, /binding\.state='abandoned'.*connection_attempt\.stage in \('activation_indeterminate','failed'\)/iu);
  assert.match(acknowledge, /active_account\.credential_source='oauth_role_v2'.*active_account\.status='active'/iu);
  assert.match(acknowledge, /lease_token=.*lease_fencing=.*lease_expires_at>clock_timestamp\(\)/iu);
  assert.match(acknowledge, /delete_pass=operation\.delete_pass\+1/iu);
  assert.match(acknowledge, /'verify_wait'.*'completed'/iu);
  assert.match(acknowledge, /interval '60 seconds'/iu);
  assert.match(acknowledge, /'cleanup_verify'.*'deleted'/iu);
  const failure = calls[1].sql.replace(/\s+/gu, " ");
  assert.match(failure, /for update of operation,artifact,binding,account_record/iu);
  assert.match(failure, /binding\.state='abandoned'.*connection_attempt\.stage in \('activation_indeterminate','failed'\)/iu);
  assert.match(failure, /'dead_letter'.*'retry_wait'/iu);
  assert.match(failure, /'cleanup_dead_letter'.*'cleanup_retry'/iu);
  assert.match(failure, /least\(interval '1 hour'/iu);
});
