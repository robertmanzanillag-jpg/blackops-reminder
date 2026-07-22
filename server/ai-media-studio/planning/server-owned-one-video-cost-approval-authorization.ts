import type { TenantScope } from "../core/resource-domain";
import type {
  LaunchAuthorityPrincipalAuthenticator,
  TrustedLaunchAuthorityPrincipal,
} from "./launch-authority-contracts";
import type { OneVideoCostApprovalAuthorizer } from "./one-video-cost-approval-contracts";

type SealedAuthorization = Readonly<{
  subjectId: string;
  ownerUserId: string;
  workspaceId: string;
}>;

/**
 * Bridges the authenticated HTTP request to Launch Authority without ever
 * treating the request object itself as trusted authority context.
 */
export function createServerOwnedOneVideoCostApprovalAuthorization(
  resolveCurrentUserId: (authorizationContext: object) => string,
): Readonly<{
  authorizer: OneVideoCostApprovalAuthorizer;
  authenticator: LaunchAuthorityPrincipalAuthenticator;
}> {
  const sealed = new WeakMap<object, SealedAuthorization>();

  const authorizer: OneVideoCostApprovalAuthorizer = {
    async authorize(input) {
      if (!input.authorizationContext || typeof input.authorizationContext !== "object") return undefined;
      let subjectId: string;
      try {
        subjectId = resolveCurrentUserId(input.authorizationContext);
      } catch {
        return undefined;
      }
      if (!validScope(input.scope) || subjectId !== input.scope.ownerUserId) return undefined;
      const context = Object.freeze({});
      sealed.set(context, Object.freeze({
        subjectId,
        ownerUserId: input.scope.ownerUserId,
        workspaceId: input.scope.workspaceId,
      }));
      return Object.freeze({ launchAuthorityContext: context });
    },
  };

  const authenticator: LaunchAuthorityPrincipalAuthenticator = {
    async authenticate(input) {
      if (!input.context || typeof input.context !== "object") return undefined;
      const authorization = sealed.get(input.context);
      if (!authorization || input.requiredCapability !== "human_launch:decide"
        || authorization.ownerUserId !== input.scope.ownerUserId
        || authorization.workspaceId !== input.scope.workspaceId) return undefined;
      return Object.freeze({
        subjectId: authorization.subjectId,
        kind: "user",
        capabilities: Object.freeze(["human_launch:decide"]),
      }) as TrustedLaunchAuthorityPrincipal;
    },
  };

  return Object.freeze({ authorizer, authenticator });
}

function validScope(scope: TenantScope): boolean {
  return Boolean(scope
    && typeof scope.ownerUserId === "string"
    && scope.ownerUserId === scope.ownerUserId.trim()
    && scope.ownerUserId.length >= 1
    && scope.ownerUserId.length <= 255
    && typeof scope.workspaceId === "string"
    && scope.workspaceId === scope.workspaceId.trim()
    && scope.workspaceId.length >= 1
    && scope.workspaceId.length <= 255);
}
