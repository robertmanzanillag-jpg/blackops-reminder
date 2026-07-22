import type { TenantScope } from "../core/resource-domain";
import {
  ONE_VIDEO_HELD_ADMISSION_OPERATION,
  type OneVideoHeldAdmissionAuthorizer,
  type OneVideoHeldAdmissionPrincipalAuthenticator,
  type OneVideoHeldAdmissionPublicCas,
  type TrustedOneVideoHeldAdmissionPrincipal,
} from "./one-video-held-admission-contracts";

type SealedAuthorization = Readonly<{
  operation: typeof ONE_VIDEO_HELD_ADMISSION_OPERATION;
  subjectId: string;
  scope: TenantScope;
  cas: Readonly<OneVideoHeldAdmissionPublicCas>;
}>;

const PUBLIC_KEYS = Object.freeze({
  publicPlanKey: /^plan_[a-f0-9]{24}$/u,
  publicSlotKey: /^slot_[a-f0-9]{24}$/u,
  expectedBatchId: /^batch_[a-f0-9]{24}$/u,
  expectedQuoteKey: /^quote_[a-f0-9]{24}$/u,
  expectedRenderSpecKey: /^render_spec_[a-f0-9]{24}$/u,
});
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u;

/**
 * Pairs one authenticated personal-tenant HTTP authorization with one exact
 * public CAS command. The empty authentication context is useful only to the
 * authenticator in this closure; request headers, body fields and lookalike
 * objects cannot mint or replay it.
 *
 * `resolveAuthenticatedSessionUserId` must read the server-authenticated
 * session principal. A route must not implement it from `x-user-id` or body
 * input.
 */
export function createServerOwnedOneVideoHeldAdmissionAuthorization(
  resolveAuthenticatedSessionUserId: (authorizationContext: object) => string,
): Readonly<{
  authorizer: OneVideoHeldAdmissionAuthorizer;
  authenticator: OneVideoHeldAdmissionPrincipalAuthenticator;
}> {
  const sealed = new WeakMap<object, SealedAuthorization>();

  const authorizer: OneVideoHeldAdmissionAuthorizer = {
    async authorize(input) {
      if (input.operation !== ONE_VIDEO_HELD_ADMISSION_OPERATION
        || !input.authorizationContext
        || typeof input.authorizationContext !== "object"
        || !validPersonalScope(input.scope)
        || !validCas(input.cas)) return undefined;

      let subjectId: string;
      try {
        subjectId = resolveAuthenticatedSessionUserId(input.authorizationContext);
      } catch {
        return undefined;
      }
      if (!validIdentity(subjectId) || subjectId !== input.scope.ownerUserId) return undefined;

      const context = Object.freeze({});
      sealed.set(context, Object.freeze({
        operation: ONE_VIDEO_HELD_ADMISSION_OPERATION,
        subjectId,
        scope: frozenScope(input.scope),
        cas: frozenCas(input.cas),
      }));
      return Object.freeze({ heldAdmissionAuthenticationContext: context });
    },
  };

  const authenticator: OneVideoHeldAdmissionPrincipalAuthenticator = {
    async authenticate(input) {
      if (input.operation !== ONE_VIDEO_HELD_ADMISSION_OPERATION
        || !input.context
        || typeof input.context !== "object") return undefined;
      const authorization = sealed.get(input.context);
      if (!authorization
        || authorization.operation !== input.operation
        || !sameScope(authorization.scope, input.scope)
        || !sameCas(authorization.cas, input.cas)) return undefined;

      return Object.freeze({
        operation: authorization.operation,
        subjectId: authorization.subjectId,
        scope: authorization.scope,
        cas: authorization.cas,
      }) as TrustedOneVideoHeldAdmissionPrincipal;
    },
  };

  return Object.freeze({ authorizer, authenticator });
}

function validPersonalScope(scope: TenantScope): boolean {
  return Boolean(scope
    && validIdentity(scope.ownerUserId)
    && scope.workspaceId === "personal");
}

function validIdentity(value: unknown): value is string {
  return typeof value === "string"
    && value === value.trim()
    && value.length >= 1
    && value.length <= 255;
}

function validCas(cas: Readonly<OneVideoHeldAdmissionPublicCas>): boolean {
  return Boolean(cas
    && PUBLIC_KEYS.publicPlanKey.test(cas.publicPlanKey)
    && PUBLIC_KEYS.publicSlotKey.test(cas.publicSlotKey)
    && PUBLIC_KEYS.expectedBatchId.test(cas.expectedBatchId)
    && PUBLIC_KEYS.expectedQuoteKey.test(cas.expectedQuoteKey)
    && PUBLIC_KEYS.expectedRenderSpecKey.test(cas.expectedRenderSpecKey)
    && Number.isInteger(cas.expectedSlotAttempt)
    && cas.expectedSlotAttempt >= 1
    && cas.expectedSlotAttempt <= 1_000_000
    && IDEMPOTENCY_KEY.test(cas.idempotencyKey));
}

function sameScope(left: TenantScope, right: TenantScope): boolean {
  return validPersonalScope(right)
    && left.ownerUserId === right.ownerUserId
    && left.workspaceId === right.workspaceId;
}

function sameCas(left: Readonly<OneVideoHeldAdmissionPublicCas>, right: Readonly<OneVideoHeldAdmissionPublicCas>): boolean {
  return validCas(right)
    && left.publicPlanKey === right.publicPlanKey
    && left.publicSlotKey === right.publicSlotKey
    && left.expectedBatchId === right.expectedBatchId
    && left.expectedQuoteKey === right.expectedQuoteKey
    && left.expectedRenderSpecKey === right.expectedRenderSpecKey
    && left.expectedSlotAttempt === right.expectedSlotAttempt
    && left.idempotencyKey === right.idempotencyKey;
}

function frozenScope(scope: TenantScope): TenantScope {
  return Object.freeze({ ownerUserId: scope.ownerUserId, workspaceId: scope.workspaceId });
}

function frozenCas(cas: Readonly<OneVideoHeldAdmissionPublicCas>): Readonly<OneVideoHeldAdmissionPublicCas> {
  return Object.freeze({
    publicPlanKey: cas.publicPlanKey,
    publicSlotKey: cas.publicSlotKey,
    expectedBatchId: cas.expectedBatchId,
    expectedQuoteKey: cas.expectedQuoteKey,
    expectedRenderSpecKey: cas.expectedRenderSpecKey,
    expectedSlotAttempt: cas.expectedSlotAttempt,
    idempotencyKey: cas.idempotencyKey,
  });
}
