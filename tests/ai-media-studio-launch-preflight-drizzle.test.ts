import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DrizzleLaunchPreflightRepository,
  launchPreflightWindowIsCurrent,
} from "../server/ai-media-studio/planning/drizzle-launch-preflight-repository";

function text(query: unknown): string {
  const candidate = query as { queryChunks?: unknown[] };
  return (candidate.queryChunks ?? []).map((chunk: any) => typeof chunk === "string" ? chunk
    : typeof chunk?.value?.[0] === "string" ? chunk.value[0] : "?").join("");
}

test("repository uses a repeatable-read read-only snapshot and tenant-scoped SELECTs only", async () => {
  const queries: string[] = []; let config: unknown;
  const repository = new DrizzleLaunchPreflightRepository({
    transaction: async (callback, value) => { config = value; return callback({ execute: async (query) => {
      queries.push(text(query));
      return queries.length === 1 ? { rows: [{ observed_at: new Date("2026-07-22T00:00:00Z") }] } : { rows: [] };
    } }); },
    execute: async () => ({ rows: [] }),
  });
  assert.equal(await repository.observe({ ownerUserId: "owner-a", workspaceId: "workspace-a" }, `plan_${"a".repeat(24)}`), undefined);
  assert.deepEqual(config, { isolationLevel: "repeatable read", accessMode: "read only" });
  assert.ok(queries.every((query) => /^\s*SELECT/iu.test(query)));
  assert.ok(queries.every((query) => !/\b(?:INSERT|UPDATE|DELETE|FOR\s+UPDATE|LOCK|MERGE|CALL)\b/iu.test(query)));
  assert.match(queries[1], /owner_user_id=.*workspace_id=.*public_plan_key/isu);
});

test("repository source has no authority write, reservation, adapter, network, provider or secret surface", () => {
  const source = readFileSync(new URL("../server/ai-media-studio/planning/drizzle-launch-preflight-repository.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /reserveAndAdmit|createAuthoritySnapshot|recordContentApproval|fetch\s*\(|axios|secretRef|externalResourceId|FOR UPDATE/iu);
  assert.match(source, /ORDER BY evidence\.revision DESC LIMIT 1/iu);
  assert.match(source, /credential_status='active'/u);
  assert.match(source, /snapshot_current/u);
  assert.match(source, /content\.valid_from AS content_valid_from/iu);
  assert.match(source, /snapshot\.valid_from AS snapshot_valid_from/iu);
  assert.match(source, /active\.state='committed'\s+OR \(active\.state='reserved' AND active\.expires_at>transaction_timestamp\(\)\)/iu);
  assert.match(source, /WHERE active\.provider_key=\$\{String\(value\(plan/iu);
});

test("future-dated and boundary-expired evidence/snapshots fail the DB-clock temporal window", () => {
  const now = new Date("2026-07-22T12:00:00.000Z");
  assert.equal(launchPreflightWindowIsCurrent("2026-07-22T11:59:59.999Z", "2026-07-22T12:00:00.001Z", now), true);
  assert.equal(launchPreflightWindowIsCurrent("2026-07-22T12:00:00.001Z", "2026-07-22T13:00:00.000Z", now), false);
  assert.equal(launchPreflightWindowIsCurrent("2026-07-22T11:00:00.000Z", "2026-07-22T12:00:00.000Z", now), false);
  assert.equal(launchPreflightWindowIsCurrent("2026-07-22T11:00:00.000Z", null, now), false);
  assert.equal(launchPreflightWindowIsCurrent("2026-07-22T11:00:00.000Z", null, now, true), true);
});
