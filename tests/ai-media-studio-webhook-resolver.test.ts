import assert from "node:assert/strict";
import test from "node:test";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { createDrizzleProviderWebhookAccountResolver } from "../server/ai-media-studio/provider-webhooks";

function fakeSelectDatabase(rows: Array<Record<string, unknown>>): Pick<NodePgDatabase, "select"> {
  return {
    select: (() => ({
      from: () => ({
        where: () => ({
          limit: async () => rows,
        }),
      }),
    })) as NodePgDatabase["select"],
  };
}

test("Drizzle resolver materializes active and valid previous secret without returning references", async () => {
  const lookedUp: string[] = [];
  const resolver = createDrizzleProviderWebhookAccountResolver({
    db: fakeSelectDatabase([{
      id: "00000000-0000-4000-8000-0000000000a1",
      ownerUserId: "owner-a",
      workspaceId: "personal",
      providerKey: "heygen",
      endpointKey: "endpoint-0123456789012345",
      status: "connected",
      secretRef: "vault://active",
      previousSecretRef: "vault://previous",
      previousSecretExpiresAt: new Date("2026-07-20T15:05:00.000Z"),
    }]),
    workspaceId: "personal",
    now: () => new Date("2026-07-20T15:00:00.000Z"),
    resolveSecretRef: async (reference) => {
      lookedUp.push(reference);
      return reference.endsWith("active") ? "active-value" : "previous-value";
    },
  });
  const resolved = await resolver({ providerKey: "heygen", endpointKey: "endpoint-0123456789012345" });
  assert.deepEqual(lookedUp, ["vault://active", "vault://previous"]);
  assert.deepEqual(resolved?.secrets, [
    { value: "active-value", state: "active" },
    { value: "previous-value", state: "previous", expiresAt: "2026-07-20T15:05:00.000Z" },
  ]);
  assert.doesNotMatch(JSON.stringify(resolved), /vault:\/\//);
});

test("Drizzle resolver fails closed for ambiguity, missing active secret, and expired previous secret", async () => {
  const base = {
    id: "00000000-0000-4000-8000-0000000000a1",
    ownerUserId: "owner-a",
    workspaceId: "personal",
    providerKey: "heygen",
    endpointKey: "endpoint-0123456789012345",
    status: "connected",
    secretRef: "vault://active",
    previousSecretRef: "vault://expired",
    previousSecretExpiresAt: new Date("2026-07-20T14:59:00.000Z"),
  };
  const ambiguous = createDrizzleProviderWebhookAccountResolver({
    db: fakeSelectDatabase([base, { ...base, id: "account-b" }]), workspaceId: "personal", resolveSecretRef: async () => "value",
  });
  assert.equal(await ambiguous({ providerKey: "heygen", endpointKey: base.endpointKey }), undefined);

  const missing = createDrizzleProviderWebhookAccountResolver({
    db: fakeSelectDatabase([base]), workspaceId: "personal", resolveSecretRef: async () => undefined,
  });
  assert.equal(await missing({ providerKey: "heygen", endpointKey: base.endpointKey }), undefined);

  const expiredLookups: string[] = [];
  const expired = createDrizzleProviderWebhookAccountResolver({
    db: fakeSelectDatabase([base]), workspaceId: "personal", now: () => new Date("2026-07-20T15:00:00.000Z"),
    resolveSecretRef: async (reference) => { expiredLookups.push(reference); return "active-value"; },
  });
  assert.deepEqual((await expired({ providerKey: "heygen", endpointKey: base.endpointKey }))?.secrets, [{ value: "active-value", state: "active" }]);
  assert.deepEqual(expiredLookups, ["vault://active"]);
});
