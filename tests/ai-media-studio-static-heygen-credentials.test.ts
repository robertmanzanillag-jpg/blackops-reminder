import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_STATIC_HEYGEN_SECRET_REF,
  StaticHeyGenCredentialBindingError,
  deriveStaticHeyGenCredentialRequestDigest,
  type BindStaticHeyGenCredential,
  type StaticHeyGenCredentialBinding,
} from "../server/ai-media-studio/provider-credentials/static-heygen-contracts";
import {
  createStaticHeyGenSecretResolver,
  prepareStaticHeyGenCredentialBinding,
} from "../server/ai-media-studio/provider-credentials/static-heygen-secret-resolver";

const input: BindStaticHeyGenCredential = {
  bindingId: "11111111-1111-4111-8111-111111111111",
  scope: { ownerUserId: "owner-a", workspaceId: "personal" },
  actorUserId: "owner-a",
  providerAccountId: "22222222-2222-4222-8222-222222222222",
  expectedCredentialVersion: 0,
  secretRef: DEFAULT_STATIC_HEYGEN_SECRET_REF,
  idempotencyKey: "heygen-static-bind-0001",
};

function binding(): StaticHeyGenCredentialBinding {
  return {
    id: input.bindingId,
    scope: input.scope,
    actorUserId: input.actorUserId,
    providerAccountId: input.providerAccountId,
    providerKey: "heygen",
    expectedCredentialVersion: 0,
    credentialVersion: 1,
    secretRef: input.secretRef,
    idempotencyKey: input.idempotencyKey,
    requestDigest: deriveStaticHeyGenCredentialRequestDigest(input),
    lifecycleState: "pending",
    verificationState: "unverified",
    createdAt: "2026-07-22T12:00:00.000Z",
    updatedAt: "2026-07-22T12:00:00.000Z",
    supersededAt: null,
  };
}

test("static HeyGen binding digest is deterministic and contains no credential material", () => {
  const digest = deriveStaticHeyGenCredentialRequestDigest(input);
  assert.match(digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(digest, deriveStaticHeyGenCredentialRequestDigest({ ...input }));
  assert.doesNotMatch(JSON.stringify(input), /"apiKey"|"api_key"|"x-api-key"/iu);
});

test("only the dedicated HeyGen secret namespace can be resolved", async () => {
  const resolver = createStaticHeyGenSecretResolver({
    env: {
      AI_MEDIA_STUDIO_SECRET_HEYGEN_API_KEY: "  private-test-value  ",
      DATABASE_URL: "must-never-be-readable",
      AI_MEDIA_STUDIO_SECRET_OTHER: "must-never-be-readable",
    },
  });
  assert.equal(await resolver.resolve(DEFAULT_STATIC_HEYGEN_SECRET_REF), "private-test-value");
  assert.equal(await resolver.resolve("env://DATABASE_URL"), undefined);
  assert.equal(await resolver.resolve("env://AI_MEDIA_STUDIO_SECRET_OTHER"), undefined);
});

test("preparation is inert, unverified and resolves only after an explicit method call", async () => {
  let resolutions = 0;
  const prepared = prepareStaticHeyGenCredentialBinding(binding(), {
    async resolve() { resolutions += 1; return "private-test-value" as never; },
  });
  assert.equal(prepared.autostart, false);
  assert.equal(prepared.verificationState, "unverified");
  assert.equal(resolutions, 0);
  assert.doesNotMatch(JSON.stringify(prepared), /private-test-value|secretRef|apiKey/iu);
  assert.equal(await prepared.resolveForExplicitVerification(), "private-test-value");
  assert.equal(resolutions, 1);
});

test("invalid references, versions and prepared lifecycle states fail closed", () => {
  for (const candidate of [
    { ...input, secretRef: "env://DATABASE_URL" },
    { ...input, secretRef: "env://AI_MEDIA_STUDIO_SECRET_HEYGEN_API_KEY_BAD-NAME" },
    { ...input, expectedCredentialVersion: -1 },
  ]) {
    assert.throws(() => deriveStaticHeyGenCredentialRequestDigest(candidate), StaticHeyGenCredentialBindingError);
  }
  assert.throws(
    () => prepareStaticHeyGenCredentialBinding({ ...binding(), lifecycleState: "superseded" }, { async resolve() { return undefined; } }),
    /preparation is invalid/u,
  );
});
