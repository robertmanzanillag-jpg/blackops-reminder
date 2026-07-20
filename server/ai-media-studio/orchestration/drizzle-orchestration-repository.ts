import { and, asc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  aiMediaOrchestrationRuns,
  aiMediaOutbox,
  aiMediaSourceItems,
} from "../../../shared/models/ai-media-studio-db";
import type { TenantScope } from "../core/resource-domain";
import {
  OrchestrationConflictError,
  ORCHESTRATION_STATES,
  type OrchestrationEmission,
  type OrchestrationRepository,
  type OrchestrationRun,
  type OrchestrationState,
} from "./contracts";

type OrchestrationRow = typeof aiMediaOrchestrationRuns.$inferSelect;

function automationEvidence(run: OrchestrationRun): Record<string, unknown> {
  return {
    rights: structuredClone(run.rights),
    moderation: structuredClone(run.moderation),
    ...(run.contentApproval ? { contentApproval: structuredClone(run.contentApproval) } : {}),
    ...(run.budgetReservation ? { budgetReservation: structuredClone(run.budgetReservation) } : {}),
    ...(run.publishingApproval ? { publishingApproval: structuredClone(run.publishingApproval) } : {}),
  };
}

function policyEvidence(run: OrchestrationRun): Record<string, unknown> {
  return run.policyEvidence ? { ...run.policyEvidence } : {};
}

export function mapOrchestrationRow(row: OrchestrationRow): OrchestrationRun {
  if (!row.sourceItemId) throw new Error("Source orchestration row is missing its source item");
  if (!ORCHESTRATION_STATES.includes(row.status as OrchestrationState)) {
    throw new Error("Stored source orchestration state is invalid");
  }
  const payload = row.runPayload as Partial<OrchestrationRun>;
  if (!payload.rights || !payload.moderation || !Array.isArray(payload.appliedTransitionKeys)) {
    throw new Error("Stored source orchestration payload is incomplete");
  }
  return {
    ...structuredClone(payload),
    id: row.id,
    ownerUserId: row.ownerUserId,
    workspaceId: row.workspaceId,
    sourceItemId: row.sourceItemId,
    state: row.status as OrchestrationState,
    version: row.stateVersion,
    rights: structuredClone(payload.rights),
    moderation: structuredClone(payload.moderation),
    appliedTransitionKeys: [...payload.appliedTransitionKeys],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function insertEmissions(tx: NodePgDatabase, scope: TenantScope, emissions: readonly OrchestrationEmission[]): Promise<void> {
  for (const item of emissions) {
    await tx.insert(aiMediaOutbox).values({
      id: item.id,
      ownerUserId: scope.ownerUserId,
      workspaceId: scope.workspaceId,
      idempotencyKey: item.idempotencyKey,
      aggregateType: "source_orchestration",
      aggregateId: item.aggregateId,
      eventType: item.type,
      payload: { kind: item.kind, ...item.payload },
      createdAt: new Date(item.createdAt),
      updatedAt: new Date(item.createdAt),
    }).onConflictDoNothing({
      target: [aiMediaOutbox.ownerUserId, aiMediaOutbox.workspaceId, aiMediaOutbox.idempotencyKey],
    });
  }
}

export class DrizzleOrchestrationRepository implements OrchestrationRepository {
  constructor(private readonly db: NodePgDatabase) {}

  async create(scope: TenantScope, run: OrchestrationRun, emission: OrchestrationEmission): Promise<OrchestrationRun> {
    return this.db.transaction(async (tx) => {
      const [source] = await tx.select({ id: aiMediaSourceItems.id }).from(aiMediaSourceItems).where(and(
        eq(aiMediaSourceItems.id, run.sourceItemId),
        eq(aiMediaSourceItems.ownerUserId, scope.ownerUserId),
        eq(aiMediaSourceItems.workspaceId, scope.workspaceId),
      )).limit(1);
      if (!source) throw new Error("Source item not found");
      const initialKey = run.appliedTransitionKeys[0];
      if (!initialKey) throw new Error("Orchestration initialization idempotency key is required");
      const [created] = await tx.insert(aiMediaOrchestrationRuns).values({
        id: run.id,
        ownerUserId: scope.ownerUserId,
        workspaceId: scope.workspaceId,
        sourceItemId: run.sourceItemId,
        runType: "intake",
        mode: "manual",
        status: run.state,
        stateVersion: run.version,
        runPayload: structuredClone(run) as unknown as Record<string, unknown>,
        idempotencyKey: initialKey,
        policyEvidence: policyEvidence(run),
        automationEvidence: automationEvidence(run),
        createdAt: new Date(run.createdAt),
        updatedAt: new Date(run.updatedAt),
      }).onConflictDoNothing().returning();
      if (!created) {
        const [existing] = await tx.select().from(aiMediaOrchestrationRuns).where(and(
          eq(aiMediaOrchestrationRuns.ownerUserId, scope.ownerUserId),
          eq(aiMediaOrchestrationRuns.workspaceId, scope.workspaceId),
          eq(aiMediaOrchestrationRuns.sourceItemId, run.sourceItemId),
        )).limit(1);
        if (!existing) throw new OrchestrationConflictError("Initialization conflict could not be resolved");
        const canonical = mapOrchestrationRow(existing);
        if (canonical.appliedTransitionKeys.includes(initialKey)) return canonical;
        throw new OrchestrationConflictError("Source already has an orchestration run");
      }
      await insertEmissions(tx as NodePgDatabase, scope, [emission]);
      return mapOrchestrationRow(created);
    });
  }

  async get(scope: TenantScope, runId: string): Promise<OrchestrationRun | undefined> {
    const [row] = await this.db.select().from(aiMediaOrchestrationRuns).where(and(
      eq(aiMediaOrchestrationRuns.id, runId),
      eq(aiMediaOrchestrationRuns.ownerUserId, scope.ownerUserId),
      eq(aiMediaOrchestrationRuns.workspaceId, scope.workspaceId),
    )).limit(1);
    return row ? mapOrchestrationRow(row) : undefined;
  }

  async getBySourceItem(scope: TenantScope, sourceItemId: string): Promise<OrchestrationRun | undefined> {
    const [row] = await this.db.select().from(aiMediaOrchestrationRuns).where(and(
      eq(aiMediaOrchestrationRuns.sourceItemId, sourceItemId),
      eq(aiMediaOrchestrationRuns.ownerUserId, scope.ownerUserId),
      eq(aiMediaOrchestrationRuns.workspaceId, scope.workspaceId),
    )).limit(1);
    return row ? mapOrchestrationRow(row) : undefined;
  }

  async save(
    scope: TenantScope,
    expected: { state: OrchestrationState; version: number },
    run: OrchestrationRun,
    emissions: readonly OrchestrationEmission[],
  ): Promise<OrchestrationRun> {
    return this.db.transaction(async (tx) => {
      const [saved] = await tx.update(aiMediaOrchestrationRuns).set({
        status: run.state,
        stateVersion: run.version,
        runPayload: structuredClone(run) as unknown as Record<string, unknown>,
        policyEvidence: policyEvidence(run),
        automationEvidence: automationEvidence(run),
        updatedAt: new Date(run.updatedAt),
      }).where(and(
        eq(aiMediaOrchestrationRuns.id, run.id),
        eq(aiMediaOrchestrationRuns.ownerUserId, scope.ownerUserId),
        eq(aiMediaOrchestrationRuns.workspaceId, scope.workspaceId),
        eq(aiMediaOrchestrationRuns.status, expected.state),
        eq(aiMediaOrchestrationRuns.stateVersion, expected.version),
      )).returning();
      if (!saved) throw new OrchestrationConflictError();
      await insertEmissions(tx as NodePgDatabase, scope, emissions);
      return mapOrchestrationRow(saved);
    });
  }

  async listEmissions(scope: TenantScope, runId: string): Promise<OrchestrationEmission[]> {
    const rows = await this.db.select().from(aiMediaOutbox).where(and(
      eq(aiMediaOutbox.ownerUserId, scope.ownerUserId),
      eq(aiMediaOutbox.workspaceId, scope.workspaceId),
      eq(aiMediaOutbox.aggregateType, "source_orchestration"),
      eq(aiMediaOutbox.aggregateId, runId),
    )).orderBy(asc(aiMediaOutbox.createdAt), asc(aiMediaOutbox.id));
    return rows.map((row) => ({
      id: row.id,
      idempotencyKey: row.idempotencyKey,
      aggregateId: row.aggregateId,
      type: row.eventType as OrchestrationEmission["type"],
      kind: row.payload.kind as OrchestrationEmission["kind"],
      payload: Object.fromEntries(Object.entries(row.payload).filter(([key]) => key !== "kind")),
      createdAt: row.createdAt.toISOString(),
    }));
  }
}
