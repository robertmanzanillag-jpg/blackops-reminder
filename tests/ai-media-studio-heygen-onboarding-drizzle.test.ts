import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DrizzleHeyGenOnboardingReadinessRepository } from "../server/ai-media-studio/providers/heygen-onboarding-readiness";

function queryText(query: unknown): string {
  const candidate = query as { queryChunks?: unknown[] };
  return (candidate.queryChunks ?? []).map((chunk: any) => typeof chunk === "string" ? chunk
    : typeof chunk?.value?.[0] === "string" ? chunk.value[0] : "?").join("");
}

test("onboarding repository uses one read-only snapshot and selects no secret or native resource values", async () => {
  const queries: string[] = [];
  let transactionConfig: unknown;
  const repository = new DrizzleHeyGenOnboardingReadinessRepository({
    execute: async () => ({ rows: [] }),
    transaction: async (callback, config) => {
      transactionConfig = config;
      return callback({ execute: async (query) => {
        queries.push(queryText(query));
        if (queries.length === 1) return { rows: [{ observed_at: new Date("2026-07-22T12:00:00.000Z") }] };
        if (queries.length === 2) return { rows: [{
          id: "10000000-0000-4000-8000-000000000001", status: "active",
          credential_status: "active", credential_version: 3, credential_source: "static_api_key",
        }] };
        return { rows: [{
          provider_account_id: "10000000-0000-4000-8000-000000000001",
          provider_credential_version: 3, status: "blocked", planned_slot_count: 50,
          slot_count: 50, member_count: 5,
        }] };
      } });
    },
  });
  const observed = await repository.observe({ ownerUserId: "owner-a", workspaceId: "personal" });
  assert.equal(observed.accounts.length, 1);
  assert.equal(observed.plans[0]?.memberCount, 5);
  assert.deepEqual(transactionConfig, { isolationLevel: "repeatable read", accessMode: "read only" });
  assert.equal(queries.length, 3);
  assert.ok(queries.every((query) => /^\s*SELECT/iu.test(query)));
  assert.ok(queries.every((query) => !/\b(?:INSERT|UPDATE|DELETE|FOR\s+UPDATE|LOCK|MERGE|CALL)\b/iu.test(query)));
  assert.doesNotMatch(queries.join("\n"), /secret_ref|configuration|external_resource_id/iu);
  assert.match(queries[1]!, /owner_user_id=.*workspace_id=.*provider_key='heygen'/isu);
  assert.match(queries[2]!, /owner_user_id=.*workspace_id=.*provider_key='heygen'/isu);
});

test("onboarding repository source has no provider network, secret dereference, or mutation surface", () => {
  const source = readFileSync(new URL("../server/ai-media-studio/providers/heygen-onboarding-readiness.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /fetch\s*\(|axios|secretRef|externalResourceId|FOR UPDATE|reserveAndAdmit|createAuthoritySnapshot/iu);
  assert.match(source, /isolationLevel: "repeatable read", accessMode: "read only"/u);
});
