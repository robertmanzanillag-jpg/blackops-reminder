import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  SECURE_HEYGEN_SETUP_SECRET_REF,
  SecureHeyGenSetupError,
  prepareSecureHeyGenSetup,
  type PreparedSecureHeyGenSetup,
  type SecureHeyGenSetupRecord,
  type SecureHeyGenSetupRepository,
} from "../server/ai-media-studio/provider-credentials/secure-heygen-setup-contracts";
import { SecureHeyGenSetupService } from "../server/ai-media-studio/provider-credentials/secure-heygen-setup-service";

const input = () => ({
  scope: { ownerUserId: "owner-robert", workspaceId: "workspace-kong" },
  actorUserId: "owner-robert",
  idempotencyKey: "heygen-setup-20260722",
});

class RecordingRepository implements SecureHeyGenSetupRepository {
  calls: PreparedSecureHeyGenSetup[] = [];
  constructor(private readonly outcome: "created" | "replayed" = "created") {}
  async setup(prepared: PreparedSecureHeyGenSetup): Promise<SecureHeyGenSetupRecord> {
    this.calls.push(prepared);
    return {
      outcome: this.outcome,
      providerAccountId: prepared.accountIdCandidate,
      bindingId: prepared.bindingId,
      credentialVersion: 1,
      verificationState: "unverified",
    };
  }
}

test("secure setup deterministically derives internal identities and fixes the deployment reference", () => {
  const first = prepareSecureHeyGenSetup(input());
  const second = prepareSecureHeyGenSetup(input());
  assert.deepEqual(first, second);
  assert.equal(first.secretRef, "env://AI_MEDIA_STUDIO_SECRET_HEYGEN_API_KEY");
  assert.match(first.accountIdCandidate, /^[0-9a-f-]{36}$/u);
  assert.match(first.bindingId, /^[0-9a-f-]{36}$/u);
  assert.notEqual(first.accountIdCandidate, first.bindingId);
  assert.notEqual(prepareSecureHeyGenSetup({ ...input(), idempotencyKey: "heygen-setup-20260723" }).bindingId, first.bindingId);
  assert.equal(prepareSecureHeyGenSetup({ ...input(), idempotencyKey: "heygen-setup-20260723" }).accountIdCandidate, first.accountIdCandidate);
});

test("service maps setup to the exact minimal public credential-reference contract", async () => {
  const repository = new RecordingRepository();
  const receipt = await new SecureHeyGenSetupService(repository).setup(input());
  assert.equal(repository.calls.length, 1);
  assert.equal(repository.calls[0]?.secretRef, SECURE_HEYGEN_SETUP_SECRET_REF);
  assert.deepEqual(receipt, {
    outcome: "created",
    credentialReference: {
      providerKey: "heygen",
      state: "registered",
      credentialVersion: 1,
    },
  });
  assert.doesNotMatch(JSON.stringify(receipt), /env:\/\/|API_KEY|providerAccountId|bindingId|accountKey|bindingKey/u);
});

test("input is exact and cannot smuggle a key, secret reference, or provider account identity", async () => {
  const service = new SecureHeyGenSetupService(new RecordingRepository());
  for (const extra of [
    { apiKey: "do-not-accept" },
    { secretRef: SECURE_HEYGEN_SETUP_SECRET_REF },
    { providerAccountId: "11111111-1111-4111-8111-111111111111" },
  ]) {
    await assert.rejects(
      service.setup({ ...input(), ...extra } as never),
      (error: unknown) => error instanceof SecureHeyGenSetupError && error.code === "INVALID_REQUEST",
    );
  }
});

test("same setup request is stable under concurrent service calls", async () => {
  const repository = new RecordingRepository("replayed");
  const service = new SecureHeyGenSetupService(repository);
  const [left, right] = await Promise.all([service.setup(input()), service.setup(input())]);
  assert.deepEqual(left, right);
  assert.deepEqual(repository.calls[0], repository.calls[1]);
});

test("repository failures and malformed records fail closed with generic errors", async () => {
  const unavailable: SecureHeyGenSetupRepository = { async setup() { throw new Error("database detail"); } };
  await assert.rejects(
    new SecureHeyGenSetupService(unavailable).setup(input()),
    (error: unknown) => error instanceof SecureHeyGenSetupError
      && error.code === "UNAVAILABLE" && error.message === "Secure HeyGen setup is unavailable",
  );
  const malformed: SecureHeyGenSetupRepository = {
    async setup(prepared) {
      return { outcome: "created", providerAccountId: prepared.accountIdCandidate, bindingId: prepared.bindingId,
        credentialVersion: 0, verificationState: "unverified" };
    },
  };
  await assert.rejects(new SecureHeyGenSetupService(malformed).setup(input()), SecureHeyGenSetupError);
});

test("Drizzle setup is one serializable tenant lock with no secret resolution or provider transport", () => {
  const source = readFileSync(new URL(
    "../server/ai-media-studio/provider-credentials/drizzle-secure-heygen-setup-repository.ts",
    import.meta.url,
  ), "utf8");
  assert.match(source, /isolationLevel:\s*"serializable"/u);
  assert.match(source, /pg_advisory_xact_lock/u);
  assert.match(source, /LIMIT 2 FOR UPDATE/gu);
  assert.match(source, /SECURE_HEYGEN_SETUP_SECRET_REF/u);
  assert.match(source, /ON CONFLICT/u);
  assert.doesNotMatch(source, /process\.env|resolveForExplicitVerification|fetch\s*\(|axios|\.submit\s*\(/u);
});

test("HTTP route source keeps the setup action authenticated, strict and redacted", () => {
  const source = readFileSync(new URL("../server/ai-media-studio/routes.ts", import.meta.url), "utf8");
  const route = source.match(/router\.post\(`\$\{AI_MEDIA_STUDIO_API_BASE\}\/provider-configurations\/heygen\/static-credential-reference`[\s\S]*?\n\s*\}\)\);/u)?.[0] ?? "";
  assert.match(route, /getCurrentUserId\(req\)/u);
  assert.match(route, /requireSameOriginJsonAiMediaStudioMutation/u);
  assert.match(route, /Cache-Control[\s\S]*private, no-store/u);
  assert.match(route, /registerHeyGenCredentialReferenceRequestSchema\.safeParse\(req\.body\)/u);
  assert.match(route, /Object\.keys\(req\.query\)\.length !== 0/u);
  assert.match(route, /scope:\s*\{ ownerUserId, workspaceId: core\.workspaceId \}/u);
  assert.match(route, /registerHeyGenCredentialReferenceResponseSchema\.parse\(receipt\)/u);
  assert.doesNotMatch(route, /apiKey|secretRef|providerAccountId|process\.env|fetch\s*\(/u);
});
