/** Canonical, injective encoding of the persisted [workspaceId, ownerUserId] tenant key. */
export function storageTenantSegment(tenantId: string) {
  try {
    const parsed: unknown = JSON.parse(tenantId);
    if (!Array.isArray(parsed) || parsed.length !== 2 || parsed.some((part) => typeof part !== "string" || !part.trim())) {
      throw new Error("invalid structured tenant");
    }
    const canonicalTenantId = JSON.stringify(parsed as [string, string]);
    return Buffer.from(canonicalTenantId, "utf8").toString("base64url");
  } catch {
    throw new Error("asset storage tenantId must be a structured [workspaceId, ownerUserId] key");
  }
}
