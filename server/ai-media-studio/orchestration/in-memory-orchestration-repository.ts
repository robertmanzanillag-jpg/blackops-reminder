import type { TenantScope } from "../core/resource-domain";
import { OrchestrationConflictError, type OrchestrationEmission, type OrchestrationRepository, type OrchestrationRun, type OrchestrationState } from "./contracts";

function key(scope: TenantScope, id: string): string {
  return `${scope.ownerUserId}\u0000${scope.workspaceId}\u0000${id}`;
}

function sourceKey(scope: TenantScope, sourceItemId: string): string {
  return `${scope.ownerUserId}\u0000${scope.workspaceId}\u0000${sourceItemId}`;
}

function clone(run: OrchestrationRun): OrchestrationRun {
  return structuredClone(run);
}

export class InMemoryOrchestrationRepository implements OrchestrationRepository {
  private readonly runs = new Map<string, OrchestrationRun>();
  private readonly runIdsBySource = new Map<string, string>();
  private readonly runIdsByInitializationKey = new Map<string, string>();
  private readonly emissions = new Map<string, OrchestrationEmission[]>();
  private failBeforeCommit = false;

  simulateCrashBeforeNextCommit(): void {
    this.failBeforeCommit = true;
  }

  async create(scope: TenantScope, run: OrchestrationRun, outbox: OrchestrationEmission): Promise<OrchestrationRun> {
    const storageKey = key(scope, run.id);
    const canonicalSourceKey = sourceKey(scope, run.sourceItemId);
    const initializationKey = run.appliedTransitionKeys[0];
    if (!initializationKey) throw new Error("Orchestration initialization idempotency key is required");
    const initializationStorageKey = key(scope, initializationKey);
    const idempotentRunId = this.runIdsByInitializationKey.get(initializationStorageKey);
    if (idempotentRunId) {
      const idempotentRun = this.runs.get(key(scope, idempotentRunId));
      if (!idempotentRun) throw new Error("Orchestration idempotency index is inconsistent");
      if (idempotentRun.sourceItemId === run.sourceItemId) return clone(idempotentRun);
      throw new OrchestrationConflictError("Initialization idempotency key belongs to another source");
    }
    const canonicalRunId = this.runIdsBySource.get(canonicalSourceKey);
    if (canonicalRunId) {
      const canonical = this.runs.get(key(scope, canonicalRunId));
      if (!canonical) throw new Error("Orchestration source index is inconsistent");
      if (canonical.appliedTransitionKeys.includes(initializationKey)) return clone(canonical);
      throw new OrchestrationConflictError("Source already has an orchestration run");
    }
    if (this.runs.has(storageKey)) throw new OrchestrationConflictError("Orchestration run already exists");
    this.commitOrCrash(storageKey, run, [outbox]);
    this.runIdsBySource.set(canonicalSourceKey, run.id);
    this.runIdsByInitializationKey.set(initializationStorageKey, run.id);
    return clone(run);
  }

  async get(scope: TenantScope, runId: string): Promise<OrchestrationRun | undefined> {
    const run = this.runs.get(key(scope, runId));
    return run ? clone(run) : undefined;
  }

  async getBySourceItem(scope: TenantScope, sourceItemId: string): Promise<OrchestrationRun | undefined> {
    const runId = this.runIdsBySource.get(sourceKey(scope, sourceItemId));
    const run = runId ? this.runs.get(key(scope, runId)) : undefined;
    return run ? clone(run) : undefined;
  }

  async save(
    scope: TenantScope,
    expected: { state: OrchestrationState; version: number },
    run: OrchestrationRun,
    outbox: readonly OrchestrationEmission[],
  ): Promise<OrchestrationRun> {
    const storageKey = key(scope, run.id);
    const current = this.runs.get(storageKey);
    if (!current || current.state !== expected.state || current.version !== expected.version) {
      throw new OrchestrationConflictError();
    }
    this.commitOrCrash(storageKey, run, outbox);
    return clone(run);
  }

  async listEmissions(scope: TenantScope, runId: string): Promise<OrchestrationEmission[]> {
    return structuredClone(this.emissions.get(key(scope, runId)) ?? []);
  }

  private commitOrCrash(storageKey: string, run: OrchestrationRun, outbox: readonly OrchestrationEmission[]): void {
    if (this.failBeforeCommit) {
      this.failBeforeCommit = false;
      throw new Error("simulated transaction crash");
    }
    const existing = this.emissions.get(storageKey) ?? [];
    const seen = new Set(existing.map((item) => item.idempotencyKey));
    const appended = outbox.filter((item) => !seen.has(item.idempotencyKey)).map((item) => structuredClone(item));
    this.runs.set(storageKey, clone(run));
    this.emissions.set(storageKey, [...existing, ...appended]);
  }
}
