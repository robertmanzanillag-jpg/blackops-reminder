import type { AiInfluencer, InfluencerRepository } from "./influencer-domain";
import type {
  CanonicalMediaResource,
  CanonicalResourceRepository,
  CanonicalResourceType,
  TenantScope,
} from "./resource-domain";
import { CoreDomainNotFoundError } from "./resource-domain";
import { InfluencerSlugConflictError } from "./influencer-domain";

function tenantKey(scope: TenantScope): string {
  return `${scope.ownerUserId}\u0000${scope.workspaceId}`;
}

function influencerKey(scope: TenantScope, id: string): string {
  return `${tenantKey(scope)}\u0000${id}`;
}

function slugKey(scope: TenantScope, slug: string): string {
  return `${tenantKey(scope)}\u0000${slug}`;
}

function resourceKey(scope: TenantScope, id: string): string {
  return `${tenantKey(scope)}\u0000${id}`;
}

function cloneInfluencer(value: AiInfluencer): AiInfluencer {
  return {
    ...value,
    ageRange: { ...value.ageRange },
    personality: [...value.personality],
    tone: [...value.tone],
    categories: [...value.categories],
    facialExpressions: [...value.facialExpressions],
    brandColors: [...value.brandColors],
  };
}

function cloneResource(value: CanonicalMediaResource): CanonicalMediaResource {
  return { ...value };
}

export class InMemoryInfluencerRepository implements InfluencerRepository {
  private readonly values = new Map<string, AiInfluencer>();
  private readonly slugs = new Map<string, string>();

  async create(scope: TenantScope, input: Omit<AiInfluencer, "ownerUserId" | "workspaceId">): Promise<AiInfluencer> {
    const indexedSlug = slugKey(scope, input.slug);
    if (this.slugs.has(indexedSlug)) throw new InfluencerSlugConflictError(`Influencer slug already exists: ${input.slug}`);
    const value: AiInfluencer = { ...input, ownerUserId: scope.ownerUserId, workspaceId: scope.workspaceId };
    this.values.set(influencerKey(scope, value.id), cloneInfluencer(value));
    this.slugs.set(indexedSlug, value.id);
    return cloneInfluencer(value);
  }

  async get(scope: TenantScope, influencerId: string): Promise<AiInfluencer | undefined> {
    const value = this.values.get(influencerKey(scope, influencerId));
    return value ? cloneInfluencer(value) : undefined;
  }

  async getBySlug(scope: TenantScope, slug: string): Promise<AiInfluencer | undefined> {
    const id = this.slugs.get(slugKey(scope, slug));
    return id ? this.get(scope, id) : undefined;
  }

  async list(scope: TenantScope, filter: { includeArchived?: boolean } = {}): Promise<AiInfluencer[]> {
    return [...this.values.values()]
      .filter((item) => item.ownerUserId === scope.ownerUserId && item.workspaceId === scope.workspaceId)
      .filter((item) => filter.includeArchived || item.status !== "archived")
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
      .map(cloneInfluencer);
  }

  async update(scope: TenantScope, input: AiInfluencer): Promise<AiInfluencer> {
    const key = influencerKey(scope, input.id);
    const current = this.values.get(key);
    if (!current) throw new CoreDomainNotFoundError("AI influencer not found");
    const oldSlugKey = slugKey(scope, current.slug);
    const newSlugKey = slugKey(scope, input.slug);
    const owner = this.slugs.get(newSlugKey);
    if (owner && owner !== input.id) throw new InfluencerSlugConflictError(`Influencer slug already exists: ${input.slug}`);
    if (oldSlugKey !== newSlugKey) this.slugs.delete(oldSlugKey);
    this.slugs.set(newSlugKey, input.id);
    const value = cloneInfluencer({ ...input, ownerUserId: scope.ownerUserId, workspaceId: scope.workspaceId });
    this.values.set(key, value);
    return cloneInfluencer(value);
  }
}

export class InMemoryCanonicalResourceRepository implements CanonicalResourceRepository {
  private readonly values = new Map<string, CanonicalMediaResource>();

  async create(scope: TenantScope, input: Omit<CanonicalMediaResource, "ownerUserId" | "workspaceId">): Promise<CanonicalMediaResource> {
    const value: CanonicalMediaResource = { ...input, ownerUserId: scope.ownerUserId, workspaceId: scope.workspaceId };
    this.values.set(resourceKey(scope, value.id), cloneResource(value));
    return cloneResource(value);
  }

  async get(scope: TenantScope, resourceId: string): Promise<CanonicalMediaResource | undefined> {
    const value = this.values.get(resourceKey(scope, resourceId));
    return value ? cloneResource(value) : undefined;
  }

  async getMany(scope: TenantScope, resourceIds: readonly string[]): Promise<CanonicalMediaResource[]> {
    const uniqueIds = [...new Set(resourceIds)];
    return uniqueIds.flatMap((resourceId) => {
      const value = this.values.get(resourceKey(scope, resourceId));
      return value ? [cloneResource(value)] : [];
    });
  }

  async list(
    scope: TenantScope,
    filter: { kind?: CanonicalResourceType; includeArchived?: boolean } = {},
  ): Promise<CanonicalMediaResource[]> {
    return [...this.values.values()]
      .filter((item) => item.ownerUserId === scope.ownerUserId && item.workspaceId === scope.workspaceId)
      .filter((item) => filter.kind === undefined || item.kind === filter.kind)
      .filter((item) => filter.includeArchived || item.status !== "archived")
      .sort((left, right) => (left.synchronizedAt ?? "").localeCompare(right.synchronizedAt ?? "") || left.id.localeCompare(right.id))
      .map(cloneResource);
  }

  async update(scope: TenantScope, input: CanonicalMediaResource): Promise<CanonicalMediaResource> {
    const key = resourceKey(scope, input.id);
    if (!this.values.has(key)) throw new CoreDomainNotFoundError("Canonical media resource not found");
    const value = cloneResource({ ...input, ownerUserId: scope.ownerUserId, workspaceId: scope.workspaceId });
    this.values.set(key, value);
    return cloneResource(value);
  }
}
