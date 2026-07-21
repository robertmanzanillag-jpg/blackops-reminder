import type { GenerationRequest, MediaGenerationJob, ProviderWebhookEvent } from "../domain";
import { InMemoryMediaJobRepository } from "../in-memory";
import type { MediaJobRepository } from "../ports";

export type MediaStudioPersistenceMode = "drizzle" | "memory" | "injected" | "unavailable";

export interface MediaStudioPersistenceStatus {
  mode: MediaStudioPersistenceMode;
  available: boolean;
  durable: boolean;
  reason: string;
}

export interface SelectMediaJobRepositoryOptions {
  repository?: MediaJobRepository;
  runtimeEnvironment?: string;
  databaseUrl?: string;
  createDurableRepository?: () => MediaJobRepository;
}

export interface MediaJobRepositorySelection {
  repository: MediaJobRepository;
  status: MediaStudioPersistenceStatus;
}

export class MediaStudioPersistenceUnavailableError extends Error {
  readonly statusCode = 503;

  constructor(message = "AI Media Studio durable persistence is unavailable") {
    super(message);
    this.name = "MediaStudioPersistenceUnavailableError";
  }
}

class LazyMediaJobRepository implements MediaJobRepository {
  private repositoryPromise: Promise<MediaJobRepository> | undefined;

  constructor(private readonly load: () => Promise<MediaJobRepository>) {}

  private repository(): Promise<MediaJobRepository> {
    this.repositoryPromise ??= this.load();
    return this.repositoryPromise;
  }

  async create(ownerUserId: string, request: GenerationRequest): Promise<MediaGenerationJob> { return (await this.repository()).create(ownerUserId, request); }
  async list(ownerUserId: string): Promise<MediaGenerationJob[]> { return (await this.repository()).list(ownerUserId); }
  async get(ownerUserId: string, jobId: string): Promise<MediaGenerationJob | undefined> { return (await this.repository()).get(ownerUserId, jobId); }
  async getByIdempotencyKey(ownerUserId: string, idempotencyKey: string): Promise<MediaGenerationJob | undefined> { return (await this.repository()).getByIdempotencyKey(ownerUserId, idempotencyKey); }
  async getByProviderJob(providerKey: string, providerAccountId: string, providerJobId: string): Promise<MediaGenerationJob | undefined> { return (await this.repository()).getByProviderJob(providerKey, providerAccountId, providerJobId); }
  async update(job: MediaGenerationJob): Promise<MediaGenerationJob> { return (await this.repository()).update(job); }
  async recordWebhook(event: ProviderWebhookEvent): Promise<boolean> { return (await this.repository()).recordWebhook(event); }
  async parkWebhook(event: ProviderWebhookEvent): Promise<void> { return (await this.repository()).parkWebhook(event); }
  async takeParkedWebhooks(providerKey: string, providerAccountId: string, providerJobId: string): Promise<ProviderWebhookEvent[]> { return (await this.repository()).takeParkedWebhooks(providerKey, providerAccountId, providerJobId); }
}

/** Avoids opening a PostgreSQL pool merely by importing the HTTP composition root. */
export function createDefaultDurableRepository(): MediaJobRepository {
  return new LazyMediaJobRepository(async () => {
    const [{ db }, { DrizzleMediaJobRepository }] = await Promise.all([
      import("../../db"),
      import("./drizzle-media-job-repository"),
    ]);
    return new DrizzleMediaJobRepository(db);
  });
}

class UnavailableMediaJobRepository implements MediaJobRepository {
  constructor(private readonly reason: string) {}

  private fail(): never {
    throw new MediaStudioPersistenceUnavailableError(this.reason);
  }

  async create(_ownerUserId: string, _request: GenerationRequest): Promise<MediaGenerationJob> { return this.fail(); }
  async list(_ownerUserId: string): Promise<MediaGenerationJob[]> { return this.fail(); }
  async get(_ownerUserId: string, _jobId: string): Promise<MediaGenerationJob | undefined> { return this.fail(); }
  async getByIdempotencyKey(_ownerUserId: string, _idempotencyKey: string): Promise<MediaGenerationJob | undefined> { return this.fail(); }
  async getByProviderJob(_providerKey: string, _providerAccountId: string, _providerJobId: string): Promise<MediaGenerationJob | undefined> { return this.fail(); }
  async update(_job: MediaGenerationJob): Promise<MediaGenerationJob> { return this.fail(); }
  async recordWebhook(_event: ProviderWebhookEvent): Promise<boolean> { return this.fail(); }
  async parkWebhook(_event: ProviderWebhookEvent): Promise<void> { return this.fail(); }
  async takeParkedWebhooks(_providerKey: string, _providerAccountId: string, _providerJobId: string): Promise<ProviderWebhookEvent[]> { return this.fail(); }
}

function hasConfiguredDatabase(databaseUrl: string | undefined): boolean {
  const value = databaseUrl?.trim();
  if (!value) return false;
  return !/^(change[-_ ]?me|replace[-_ ]?me|your[-_ ]|example|placeholder)/i.test(value);
}

/**
 * Composition policy for media-job persistence.
 *
 * Production never falls back to process memory. Development and tests may use
 * memory deliberately when no database is configured; the returned status is
 * surfaced by the HTTP runtime so operators can see that the mode is ephemeral.
 */
export function selectMediaJobRepository(options: SelectMediaJobRepositoryOptions): MediaJobRepositorySelection {
  if (options.repository) {
    return {
      repository: options.repository,
      status: { mode: "injected", available: true, durable: false, reason: "Repository supplied by the composition caller" },
    };
  }

  if (hasConfiguredDatabase(options.databaseUrl)) {
    if (!options.createDurableRepository) {
      const reason = "DATABASE_URL is configured but no durable repository factory is available";
      return { repository: new UnavailableMediaJobRepository(reason), status: { mode: "unavailable", available: false, durable: false, reason } };
    }
    try {
      return {
        repository: options.createDurableRepository(),
        status: { mode: "drizzle", available: true, durable: true, reason: "PostgreSQL/Drizzle persistence selected" },
      };
    } catch (error) {
      const reason = `Durable repository initialization failed: ${error instanceof Error ? error.message : "unknown error"}`;
      return { repository: new UnavailableMediaJobRepository(reason), status: { mode: "unavailable", available: false, durable: false, reason } };
    }
  }

  const environment = options.runtimeEnvironment?.trim().toLowerCase();
  if (environment === "development" || environment === "test") {
    return {
      repository: new InMemoryMediaJobRepository(),
      status: { mode: "memory", available: true, durable: false, reason: `Ephemeral fallback allowed for ${environment}` },
    };
  }

  const reason = "DATABASE_URL is required outside development/test; in-memory persistence is disabled";
  return { repository: new UnavailableMediaJobRepository(reason), status: { mode: "unavailable", available: false, durable: false, reason } };
}
