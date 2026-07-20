import type { MediaAsset, MediaAssetRepository } from "./asset-domain";
import { InMemoryMediaAssetRepository } from "./in-memory-asset-repository";
import {
  InMemoryCanonicalResourceRepository,
  InMemoryInfluencerRepository,
} from "./in-memory-core-repositories";
import { InfluencerService, type AiInfluencer, type InfluencerRepository } from "./influencer-domain";
import {
  CanonicalResourceService,
  type CanonicalMediaResource,
  type CanonicalResourceRepository,
  type TenantScope,
} from "./resource-domain";
import type { Influencer, MediaAsset as PublicMediaAsset } from "../../../shared/ai-media-studio-core";
import {
  MediaStudioPersistenceUnavailableError,
  type MediaStudioPersistenceStatus,
} from "../persistence/runtime";

export const DEFAULT_MEDIA_STUDIO_WORKSPACE_ID = "personal";

export interface CoreCatalogRepositories {
  influencers: InfluencerRepository;
  resources: CanonicalResourceRepository;
  assets: MediaAssetRepository;
}

export interface SelectCoreCatalogOptions {
  repositories?: CoreCatalogRepositories;
  runtimeEnvironment?: string;
  databaseUrl?: string;
  workspaceId?: string;
  createDurableRepositories?: () => CoreCatalogRepositories;
  seedDefaults?: boolean;
}

export interface CoreCatalogRuntime {
  repositories: CoreCatalogRepositories;
  influencers: InfluencerService;
  resources: CanonicalResourceService;
  workspaceId: string;
  status: MediaStudioPersistenceStatus;
  ensureDefaults(scope: TenantScope): Promise<void>;
}

function configuredDatabase(databaseUrl: string | undefined): boolean {
  const value = databaseUrl?.trim();
  if (!value) return false;
  return !/^(change[-_ ]?me|replace[-_ ]?me|your[-_ ]|example|placeholder)/i.test(value);
}

class LazyCoreCatalogRepositories implements CoreCatalogRepositories {
  private repositoriesPromise: Promise<CoreCatalogRepositories> | undefined;

  readonly influencers: InfluencerRepository = {
    create: async (scope, input) => (await this.repositories()).influencers.create(scope, input),
    get: async (scope, id) => (await this.repositories()).influencers.get(scope, id),
    getBySlug: async (scope, slug) => (await this.repositories()).influencers.getBySlug(scope, slug),
    list: async (scope, filter) => (await this.repositories()).influencers.list(scope, filter),
    update: async (scope, input) => (await this.repositories()).influencers.update(scope, input),
  };

  readonly resources: CanonicalResourceRepository = {
    create: async (scope, input) => (await this.repositories()).resources.create(scope, input),
    get: async (scope, id) => (await this.repositories()).resources.get(scope, id),
    getMany: async (scope, ids) => (await this.repositories()).resources.getMany(scope, ids),
    list: async (scope, filter) => (await this.repositories()).resources.list(scope, filter),
    update: async (scope, input) => (await this.repositories()).resources.update(scope, input),
  };

  readonly assets: MediaAssetRepository = {
    createOrGet: async (asset) => (await this.repositories()).assets.createOrGet(asset),
    findByChecksum: async (owner, type, checksum) => (await this.repositories()).assets.findByChecksum(owner, type, checksum),
    get: async (owner, id) => (await this.repositories()).assets.get(owner, id),
    list: async (owner, type) => (await this.repositories()).assets.list(owner, type),
  };

  constructor(private readonly load: () => Promise<CoreCatalogRepositories>) {}

  private repositories(): Promise<CoreCatalogRepositories> {
    this.repositoriesPromise ??= this.load();
    return this.repositoriesPromise;
  }
}

class UnavailableCoreCatalogRepositories implements CoreCatalogRepositories {
  readonly influencers: InfluencerRepository;
  readonly resources: CanonicalResourceRepository;
  readonly assets: MediaAssetRepository;

  constructor(private readonly reason: string) {
    const fail = (): never => { throw new MediaStudioPersistenceUnavailableError(this.reason); };
    this.influencers = {
      create: async () => fail(), get: async () => fail(), getBySlug: async () => fail(),
      list: async () => fail(), update: async () => fail(),
    };
    this.resources = {
      create: async () => fail(), get: async () => fail(), getMany: async () => fail(),
      list: async () => fail(), update: async () => fail(),
    };
    this.assets = {
      createOrGet: async () => fail(), findByChecksum: async () => fail(), get: async () => fail(), list: async () => fail(),
    };
  }
}

export function createDefaultDurableCoreRepositories(workspaceId = DEFAULT_MEDIA_STUDIO_WORKSPACE_ID): CoreCatalogRepositories {
  return new LazyCoreCatalogRepositories(async () => {
    const [{ db }, repositories] = await Promise.all([
      import("../../db"),
      import("../persistence/drizzle-core-repositories"),
    ]);
    return {
      influencers: new repositories.DrizzleInfluencerRepository(db),
      resources: new repositories.DrizzleCanonicalResourceRepository(db, () => {
        throw new Error("Canonical resources must be synchronized by a provider adapter");
      }),
      assets: new repositories.DrizzleMediaAssetRepository(db, { workspaceId }),
    };
  });
}

function selectCoreCatalog(options: SelectCoreCatalogOptions): {
  repositories: CoreCatalogRepositories;
  status: MediaStudioPersistenceStatus;
  seedDefaults: boolean;
} {
  if (options.repositories) {
    return {
      repositories: options.repositories,
      status: { mode: "injected", available: true, durable: false, reason: "Core catalog repositories supplied by the composition caller" },
      seedDefaults: options.seedDefaults === true,
    };
  }

  if (configuredDatabase(options.databaseUrl)) {
    try {
      return {
        repositories: (options.createDurableRepositories ?? (() => createDefaultDurableCoreRepositories(options.workspaceId)))(),
        status: { mode: "drizzle", available: true, durable: true, reason: "PostgreSQL/Drizzle core catalog selected" },
        seedDefaults: false,
      };
    } catch (error) {
      const reason = `Core catalog initialization failed: ${error instanceof Error ? error.message : "unknown error"}`;
      return {
        repositories: new UnavailableCoreCatalogRepositories(reason),
        status: { mode: "unavailable", available: false, durable: false, reason },
        seedDefaults: false,
      };
    }
  }

  const environment = options.runtimeEnvironment?.trim().toLowerCase();
  if (environment === "development" || environment === "test") {
    return {
      repositories: {
        influencers: new InMemoryInfluencerRepository(),
        resources: new InMemoryCanonicalResourceRepository(),
        assets: new InMemoryMediaAssetRepository(),
      },
      status: { mode: "memory", available: true, durable: false, reason: `Ephemeral core catalog allowed for ${environment}` },
      seedDefaults: options.seedDefaults !== false,
    };
  }

  const reason = "DATABASE_URL is required outside development/test; in-memory core catalog is disabled";
  return {
    repositories: new UnavailableCoreCatalogRepositories(reason),
    status: { mode: "unavailable", available: false, durable: false, reason },
    seedDefaults: false,
  };
}

const seedResources: Array<Omit<CanonicalMediaResource, "ownerUserId" | "workspaceId">> = [
  { id: "avatar-emily", kind: "avatar", name: "Emily — Natural Studio", status: "active", language: "en", accent: "American", gender: "female", previewUrl: null, thumbnailUrl: null, synchronizedAt: "2026-07-20T12:00:00.000Z" },
  { id: "voice-emily-en", kind: "voice", name: "Emily English", status: "active", language: "en", accent: "American", gender: "female", previewUrl: null, thumbnailUrl: null, synchronizedAt: "2026-07-20T12:00:00.000Z" },
  { id: "avatar-sofia", kind: "avatar", name: "Sofia — Travel Studio", status: "active", language: "es", accent: "Latino", gender: "female", previewUrl: null, thumbnailUrl: null, synchronizedAt: "2026-07-20T12:00:00.000Z" },
  { id: "voice-sofia-es", kind: "voice", name: "Sofia Español", status: "active", language: "es", accent: "Latino", gender: "female", previewUrl: null, thumbnailUrl: null, synchronizedAt: "2026-07-20T12:00:00.000Z" },
];

const seedInfluencers: Array<Omit<AiInfluencer, "ownerUserId" | "workspaceId">> = [
  {
    id: "emily-food", slug: "emily-food", name: "Emily", avatarResourceId: "avatar-emily", voiceResourceId: "voice-emily-en",
    accent: "American", language: "en", gender: "female", ageRange: { minimum: 25, maximum: 34 },
    personality: ["curious", "warm"], tone: ["friendly", "confident"], speakingStyle: "Natural, concise, and sensory.",
    categories: ["food", "restaurants"], intro: "Emily here with a place worth adding to your list.",
    outro: "Save this for later and follow for the next local find.", energyLevel: 7,
    facialExpressions: ["warm smile"], brandColors: ["#111827", "#F59E0B"], status: "active",
    createdAt: "2026-07-20T12:00:00.000Z", updatedAt: "2026-07-20T12:00:00.000Z",
  },
  {
    id: "sofia-travel", slug: "sofia-travel", name: "Sofia", avatarResourceId: "avatar-sofia", voiceResourceId: "voice-sofia-es",
    accent: "Latino", language: "es", gender: "female", ageRange: { minimum: 25, maximum: 34 },
    personality: ["adventurous", "welcoming"], tone: ["energetic", "helpful"], speakingStyle: "Conversational travel advice with practical details.",
    categories: ["travel", "hotels"], intro: "Sofia aquí con una parada que vale la pena descubrir.",
    outro: "Guarda esta recomendación para tu próximo viaje.", energyLevel: 8,
    facialExpressions: ["bright smile"], brandColors: ["#0F766E", "#F97316"], status: "active",
    createdAt: "2026-07-20T12:00:00.000Z", updatedAt: "2026-07-20T12:00:00.000Z",
  },
];

export function createCoreCatalogRuntime(options: SelectCoreCatalogOptions = {}): CoreCatalogRuntime {
  const workspaceId = options.workspaceId?.trim() || DEFAULT_MEDIA_STUDIO_WORKSPACE_ID;
  const selection = selectCoreCatalog({ ...options, workspaceId });
  const influencers = new InfluencerService(selection.repositories.influencers, selection.repositories.resources);
  const resources = new CanonicalResourceService(selection.repositories.resources);
  const seeds = new Map<string, Promise<void>>();

  const ensureDefaults = async (scope: TenantScope): Promise<void> => {
    if (!selection.seedDefaults) return;
    const key = `${scope.ownerUserId}\u0000${scope.workspaceId}`;
    let pending = seeds.get(key);
    if (!pending) {
      pending = (async () => {
        const existing = await selection.repositories.influencers.list(scope, { includeArchived: true });
        if (existing.length > 0) return;
        for (const resource of seedResources) {
          if (!(await selection.repositories.resources.get(scope, resource.id))) {
            await selection.repositories.resources.create(scope, resource);
          }
        }
        for (const influencer of seedInfluencers) {
          if (!(await selection.repositories.influencers.get(scope, influencer.id))) {
            await selection.repositories.influencers.create(scope, influencer);
          }
        }
      })().catch((error) => {
        seeds.delete(key);
        throw error;
      });
      seeds.set(key, pending);
    }
    await pending;
  };

  return { repositories: selection.repositories, influencers, resources, workspaceId, status: selection.status, ensureDefaults };
}

export function toPublicInfluencer(influencer: AiInfluencer): Influencer {
  return {
    id: influencer.id,
    name: influencer.name,
    avatarResourceId: influencer.avatarResourceId,
    voiceResourceId: influencer.voiceResourceId,
    accent: influencer.accent,
    language: influencer.language,
    gender: influencer.gender,
    ageRange: { ...influencer.ageRange },
    personality: [...influencer.personality],
    tone: [...influencer.tone],
    speakingStyle: influencer.speakingStyle,
    categories: [...influencer.categories],
    intro: influencer.intro,
    outro: influencer.outro,
    energyLevel: influencer.energyLevel,
    facialExpressions: [...influencer.facialExpressions],
    brandColors: [...influencer.brandColors],
    status: influencer.status,
    createdAt: influencer.createdAt,
    updatedAt: influencer.updatedAt,
  };
}

export function toPublicMediaAsset(asset: MediaAsset): PublicMediaAsset {
  return {
    id: asset.id,
    kind: asset.type,
    name: asset.name,
    status: asset.status,
    mimeType: asset.mimeType,
    byteSize: asset.sizeBytes,
    width: asset.metadata.width ?? null,
    height: asset.metadata.height ?? null,
    durationMs: asset.metadata.durationMs ?? null,
    checksum: asset.checksumSha256,
    // Delivery is always minted on demand by the authenticated delivery route.
    // Persisted/legacy bearer URLs are never returned in a library listing.
    deliveryUrl: null,
    // Thumbnails need the same owned-object signing boundary as full assets.
    // Until a dedicated thumbnail signer exists, fail closed instead of
    // exposing persisted provider or bearer URLs in catalog responses.
    thumbnailUrl: null,
    influencerId: asset.influencerId,
    projectId: asset.projectId,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  };
}
