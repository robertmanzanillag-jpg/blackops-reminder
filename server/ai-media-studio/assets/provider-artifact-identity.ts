import { createHash } from "node:crypto";
import type { TenantScope } from "../core/resource-domain";

export interface DurableProviderArtifactIdentity {
  scope: TenantScope;
  renderJobId: string;
  providerAccountId: string;
  providerKey: string;
  providerJobId: string;
}

/** Stable identity for one provider output; mutable URLs and evidence never enter it. */
export function durableProviderArtifactRef(identity: DurableProviderArtifactIdentity): string {
  return `provider-artifact://ai-media-studio/render-terminal/v1/${createHash("sha256").update(JSON.stringify({
    version: 1,
    ownerUserId: identity.scope.ownerUserId,
    workspaceId: identity.scope.workspaceId,
    renderJobId: identity.renderJobId,
    providerAccountId: identity.providerAccountId,
    providerKey: identity.providerKey,
    providerJobId: identity.providerJobId,
  })).digest("hex")}`;
}
