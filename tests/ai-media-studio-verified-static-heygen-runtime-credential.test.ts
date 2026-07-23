import assert from "node:assert/strict";
import test from "node:test";
import type { SQL } from "drizzle-orm";
import {
  DrizzleVerifiedStaticHeyGenRuntimeCredentialLoader,
  VerifiedStaticHeyGenRuntimeCredentialMaterializer,
} from "../server/ai-media-studio/provider-credentials/verified-static-heygen-runtime-credential";
import type {
  StaticHeyGenApiKey,
  StaticHeyGenSecretResolver,
} from "../server/ai-media-studio/provider-credentials/static-heygen-secret-resolver";

const accountId = "123e4567-e89b-42d3-a456-426614174000";
const bindingId = "123e4567-e89b-42d3-a456-426614174001";
const verificationId = "123e4567-e89b-42d3-a456-426614174002";
const digest = `sha256:${"a".repeat(64)}`;
const requestDigest = `sha256:${"b".repeat(64)}`;
const secretRef = "env://AI_MEDIA_STUDIO_SECRET_HEYGEN_API_KEY_RUNTIME";
const verifiedAt = "2026-07-22T20:00:00.000Z";
const expiresAt = "2026-07-23T20:00:00.000Z";
const identity = {
  scope: { ownerUserId: "owner-1", workspaceId: "workspace-1" },
  providerAccountId: accountId,
  providerKey: "heygen",
  providerCredentialVersion: 7,
} as const;

function exactRow() {
  return {
    provider_account_id: accountId,
    provider_key: "heygen",
    credential_version: 7,
    secret_ref: secretRef,
    static_credential_verification_id: verificationId,
    static_credential_verification_digest: digest,
    binding_id: bindingId,
    target_credential_version: 7,
    binding_request_digest: requestDigest,
    binding_secret_ref: secretRef,
    binding_lifecycle_state: "pending",
    binding_verification_state: "unverified",
    verification_id: verificationId,
    verification_credential_version: 7,
    credential_binding_request_digest: requestDigest,
    verification_evidence_digest: digest,
    header_verification_state: "verified",
    verification_observed_at: verifiedAt,
    verification_expires_at: expiresAt,
  };
}

test("construction performs no database or secret I/O; materialization preserves admission order", async () => {
  const events: string[] = [];
  const db = {
    async execute(_query: SQL) {
      events.push("database");
      return { rows: [exactRow()] };
    },
  };
  const resolver: StaticHeyGenSecretResolver = {
    async resolve(ref) {
      events.push(`secret:${ref}`);
      return "runtime-key" as StaticHeyGenApiKey;
    },
  };
  const loader = new DrizzleVerifiedStaticHeyGenRuntimeCredentialLoader(db);
  const materializer = new VerifiedStaticHeyGenRuntimeCredentialMaterializer(loader, resolver);
  assert.deepEqual(events, []);

  const result = await materializer.materialize(identity);
  assert.deepEqual(events, ["database", `secret:${secretRef}`]);
  assert.equal(result?.apiKey, "runtime-key");
  assert.equal(result?.providerAccountId, accountId);
  assert.equal(result?.providerCredentialVersion, 7);
  assert.equal(result?.credentialExpiresAt, expiresAt);
  assert.equal(typeof result?.assertCredentialCurrent, "function");
});

test("no exact verified row returns undefined without resolving a secret", async () => {
  let resolutions = 0;
  const loader = new DrizzleVerifiedStaticHeyGenRuntimeCredentialLoader({
    async execute() { return { rows: [] }; },
  });
  const materializer = new VerifiedStaticHeyGenRuntimeCredentialMaterializer(loader, {
    async resolve() {
      resolutions += 1;
      return "must-not-resolve" as StaticHeyGenApiKey;
    },
  });
  assert.equal(await materializer.materialize(identity), undefined);
  assert.equal(resolutions, 0);
});

test("ambiguous exact rows fail closed without resolving a secret", async () => {
  let resolutions = 0;
  const loader = new DrizzleVerifiedStaticHeyGenRuntimeCredentialLoader({
    async execute() { return { rows: [exactRow(), exactRow()] }; },
  });
  const materializer = new VerifiedStaticHeyGenRuntimeCredentialMaterializer(loader, {
    async resolve() {
      resolutions += 1;
      return "must-not-resolve" as StaticHeyGenApiKey;
    },
  });
  assert.equal(await materializer.materialize(identity), undefined);
  assert.equal(resolutions, 0);
});

test("missing secret fails generically without reference, key, or legacy fallback leakage", async () => {
  const attemptedRefs: string[] = [];
  const loader = new DrizzleVerifiedStaticHeyGenRuntimeCredentialLoader({
    async execute() { return { rows: [exactRow()] }; },
  });
  const materializer = new VerifiedStaticHeyGenRuntimeCredentialMaterializer(loader, {
    async resolve(ref) {
      attemptedRefs.push(ref);
      return undefined;
    },
  });
  await assert.rejects(
    materializer.materialize(identity),
    (error: unknown) => {
      assert(error instanceof Error);
      assert.equal(error.message, "Verified static HeyGen runtime credential unavailable");
      assert.doesNotMatch(error.message, /AI_MEDIA|runtime-key|secret|legacy/iu);
      return true;
    },
  );
  assert.deepEqual(attemptedRefs, [secretRef]);
});

test("malformed or mismatched metadata never reaches the resolver", async () => {
  let resolutions = 0;
  const loader = new DrizzleVerifiedStaticHeyGenRuntimeCredentialLoader({
    async execute() {
      return { rows: [{ ...exactRow(), binding_secret_ref: "env://LEGACY_HEYGEN_API_KEY" }] };
    },
  });
  const materializer = new VerifiedStaticHeyGenRuntimeCredentialMaterializer(loader, {
    async resolve() {
      resolutions += 1;
      return "legacy-key" as StaticHeyGenApiKey;
    },
  });
  assert.equal(await materializer.materialize(identity), undefined);
  assert.equal(resolutions, 0);
});

test("materializer revalidates metadata from an injected loader before secret access", async () => {
  let resolutions = 0;
  const materializer = new VerifiedStaticHeyGenRuntimeCredentialMaterializer({
    async load() {
      return {
        scope: { ...identity.scope, workspaceId: "different-workspace" },
        providerAccountId: identity.providerAccountId,
        providerKey: "heygen",
        providerCredentialVersion: identity.providerCredentialVersion,
        secretRef,
        verifiedAt,
        expiresAt,
      };
    },
  }, {
    async resolve() {
      resolutions += 1;
      return "must-not-resolve" as StaticHeyGenApiKey;
    },
  });
  assert.equal(await materializer.materialize(identity), undefined);
  assert.equal(resolutions, 0);
});

test("invalid verification windows never reach secret access", async () => {
  let resolutions = 0;
  const materializer = new VerifiedStaticHeyGenRuntimeCredentialMaterializer({
    async load() {
      return {
        scope: identity.scope,
        providerAccountId: identity.providerAccountId,
        providerKey: "heygen",
        providerCredentialVersion: identity.providerCredentialVersion,
        secretRef,
        verifiedAt: expiresAt,
        expiresAt: verifiedAt,
      };
    },
  }, {
    async resolve() {
      resolutions += 1;
      return "must-not-resolve" as StaticHeyGenApiKey;
    },
  });
  assert.equal(await materializer.materialize(identity), undefined);
  assert.equal(resolutions, 0);
});

test("a well-formed but stale verification window never reaches secret access", async () => {
  let resolutions = 0;
  const materializer = new VerifiedStaticHeyGenRuntimeCredentialMaterializer({
    async load() {
      return {
        scope: identity.scope,
        providerAccountId: identity.providerAccountId,
        providerKey: "heygen",
        providerCredentialVersion: identity.providerCredentialVersion,
        secretRef,
        verifiedAt: "2020-01-01T00:00:00.000Z",
        expiresAt: "2020-01-01T01:00:00.000Z",
      };
    },
  }, {
    async resolve() {
      resolutions += 1;
      return "must-not-resolve" as StaticHeyGenApiKey;
    },
  }, () => new Date("2026-07-22T20:00:00.000Z"));
  assert.equal(await materializer.materialize(identity), undefined);
  assert.equal(resolutions, 0);
});

test("pre-I/O guard reloads exact admission and blocks rotation without another secret read", async () => {
  let databaseCalls = 0;
  let secretCalls = 0;
  const loader = new DrizzleVerifiedStaticHeyGenRuntimeCredentialLoader({
    async execute() {
      databaseCalls += 1;
      return { rows: databaseCalls === 1 ? [exactRow()] : [] };
    },
  });
  const materializer = new VerifiedStaticHeyGenRuntimeCredentialMaterializer(loader, {
    async resolve() {
      secretCalls += 1;
      return "runtime-key" as StaticHeyGenApiKey;
    },
  });
  const result = await materializer.materialize(identity);
  assert(result?.assertCredentialCurrent);
  await assert.rejects(result.assertCredentialCurrent, /unavailable/u);
  assert.equal(databaseCalls, 2);
  assert.equal(secretCalls, 1);
});

test("pre-I/O guard blocks deployment-secret rotation even while the database binding is unchanged", async () => {
  let currentSecret = "runtime-key";
  const loader = new DrizzleVerifiedStaticHeyGenRuntimeCredentialLoader({
    async execute() { return { rows: [exactRow()] }; },
  });
  const materializer = new VerifiedStaticHeyGenRuntimeCredentialMaterializer(loader, {
    async resolve() { return currentSecret as StaticHeyGenApiKey; },
  });
  const result = await materializer.materialize(identity);
  assert(result?.assertCredentialCurrent);
  currentSecret = "rotated-without-verification";
  await assert.rejects(result.assertCredentialCurrent, /unavailable/u);
});
