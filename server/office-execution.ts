import {configuredFactoryApiPrice,defaultFactoryApiInvocation} from "./factory-api-invocation";
import {guardFactoryOpenAiFetch} from "./factory-api-sdk";
import { createHash } from "node:crypto";
import type { createAgentCouncil } from "./agent-council";
import { createOfficeOpenAI } from "./office-openai";
import { createOfficeTokenBudget } from "./office-token-budget";
import { createOfficeRuntime } from "./office-runtime";
import { probeOfficeClaude, runOfficeClaude } from "./office-claude";
import { reserveRoleExecution, completeRoleExecution, type RolePolicy } from "../shared/office-role-lifecycle";
import type { OfficeCloudRun, OfficeCloudCompletion } from "./office-cloud-store";
import { advanceCompany } from "../shared/agent-company";
import { createCreditLimitedOfficeRun } from "./office-shared-credits";
import { loadSharedCreditRuntime } from "./shared-openai-credit-runtime";
import type { OfficeOpenAIResult } from "./office-openai";
import type { OfficeAnthropicResult } from "./office-anthropic-credits";
import { markProviderCreditExhausted, clearProviderCooldown, readProviderCooldowns, providerCooldownMs } from "./ai-provider-credit-cooldown";

type CooldownStore = Parameters<typeof markProviderCreditExhausted>[0];
const codeOf = (error: unknown) => (error instanceof Error ? error.message : "");
/** OpenAI first; when OpenAI says "out of credit" (now or within the persisted
 * cooldown) the role job runs on the Claude API under its own office ledger.
 * Both out of credit, or Claude not configured: fail closed with a code. */
export async function runWithProviderFailover(input: { env: NodeJS.ProcessEnv; now: () => Date; store?: CooldownStore; assigned: string; prompt: string;
    openai: () => Promise<OfficeOpenAIResult>; claude?: (prompt: string, executionId: string) => Promise<OfficeAnthropicResult> }): Promise<OfficeOpenAIResult | OfficeAnthropicResult> {
  const { env, now } = input;
  const { officeAnthropicFallbackEnabled } = await import("./software-factory-anthropic-ledger");
  const claudeEnabled = !!input.claude || officeAnthropicFallbackEnabled(env);
  const store = input.store ?? (claudeEnabled && env.DATABASE_URL ? await (await import("./agent-council-store")).getCouncilStore().catch(() => undefined) : undefined);
  const active = store ? (await readProviderCooldowns(store, now())).active : {};
  const log = (provider: string, reason: string) => { try { console.error(`[ai-provider-credit-exhausted] ${JSON.stringify({ consumer: "office", provider, reason })}`); } catch { /* logging only */ } };
  if (!(claudeEnabled && active.openai)) {
    try {
      const result = await input.openai();
      if (store && active.openai) await clearProviderCooldown(store, "openai").catch(() => undefined);
      return result;
    } catch (error) {
      if (codeOf(error) !== "OFFICE_OPENAI_CREDIT_EXHAUSTED") throw error;
      log("openai", "OPENAI_INSUFFICIENT_QUOTA");
      if (store) await markProviderCreditExhausted(store, "openai", "OPENAI_INSUFFICIENT_QUOTA", now(), providerCooldownMs(env)).catch(() => undefined);
      if (!claudeEnabled) throw error;
    }
  }
  if (active.anthropic) throw Error("OFFICE_ALL_PROVIDERS_CREDIT_EXHAUSTED");
  const claude = input.claude ?? await (async () => {
    const [{ loadAnthropicOfficeRuntime }, { createCreditLimitedOfficeClaudeRun }] = await Promise.all([import("./software-factory-anthropic-ledger"), import("./office-anthropic-credits")]);
    const runtime = await loadAnthropicOfficeRuntime(env, now, store as any);
    return createCreditLimitedOfficeClaudeRun({ ...runtime, apiKey: env.ANTHROPIC_API_KEY?.trim() || "", now, maxOutputTokens: Number(env.OFFICE_OPENAI_MAX_OUTPUT_TOKENS) || 1024 });
  })();
  try {
    const result = await claude(input.prompt, input.assigned);
    if (store && active.anthropic) await clearProviderCooldown(store, "anthropic").catch(() => undefined);
    return result;
  } catch (error) {
    if (codeOf(error) === "OFFICE_ANTHROPIC_CREDIT_EXHAUSTED") {
      log("anthropic", "ANTHROPIC_CREDIT_EXHAUSTED");
      if (store) await markProviderCreditExhausted(store, "anthropic", "ANTHROPIC_CREDIT_EXHAUSTED", now(), providerCooldownMs(env)).catch(() => undefined);
      throw Error("OFFICE_ALL_PROVIDERS_CREDIT_EXHAUSTED");
    }
    throw error;
  }
}

type Council = Pick<ReturnType<typeof createAgentCouncil>, "updateOfficeExecution">;
/** Private worker wiring. No HTTP endpoint can submit a policy or grade. */
export function createOfficeExecution(council: Council, env: NodeJS.ProcessEnv = process.env, now = Date.now,
  deps: { fetch?: typeof fetch; loadPr?: NonNullable<Parameters<typeof createOfficeRuntime>[0]>["loadPr"];
    factoryInvocation?: ReturnType<typeof import("./factory-api-invocation").createFactoryApiInvocation>;
    sharedCredits?: Awaited<ReturnType<typeof loadSharedCreditRuntime>>;
    /** Tests: cooldown store and Claude API run injection. */
    cooldownStore?: CooldownStore; claudeRun?: (prompt: string, executionId: string) => Promise<OfficeAnthropicResult> } = {}) {
  const openai = env.OFFICE_REVIEW_PROVIDER === "openai";
  const budget = openai ? createOfficeTokenBudget({ limit: Number(env.OFFICE_OPENAI_MONTHLY_TOKEN_LIMIT),
    transact: async change => { await council.updateOfficeExecution(state => {
      const tokens = structuredClone(state.tokens); change(tokens); return { ...state, tokens };
    }); }, now: () => new Date(now()),
  }) : undefined;
  let activeExecutionId: string | undefined;
  const run = async (prompt: string, executionId?: string) => {
    if (!openai) return runOfficeClaude(prompt);
    if (deps.sharedCredits || env.OPENAI_SHARED_CREDIT_CONFIG || env.OPENAI_SHARED_CREDITS_REQUIRED === "true") {
      const assigned = executionId || activeExecutionId;
      if (!assigned) throw Error("OFFICE_CREDIT_ASSIGNMENT_REQUIRED");
      return runWithProviderFailover({ env, now: () => new Date(now()), store: deps.cooldownStore, assigned, prompt,
        claude: deps.claudeRun,
        openai: async () => {
          const shared = deps.sharedCredits || await loadSharedCreditRuntime(env, () => new Date(now()));
          return createCreditLimitedOfficeRun({ ...shared, factoryInvocation:deps.factoryInvocation, env, now: () => new Date(now()), fetch: deps.fetch,
            authorizeTokens: limits => budget!.reserve(limits), recordTokens: (id, metadata) => budget!.recordUsage(id, metadata), releaseTokens: id => budget!.release(id),
          })(prompt, assigned);
        } });
    }
    const factoryPrice=configuredFactoryApiPrice("openai",env.OFFICE_OPENAI_MODEL??"",env.FACTORY_API_PRICING_CONFIG);
    const monetary=deps.factoryInvocation??await defaultFactoryApiInvocation();
    await monetary.preflight();
    let reservation: string | undefined;
    const provider = createOfficeOpenAI({ env, fetch: guardFactoryOpenAiFetch(deps.fetch??fetch,{executionId:executionId||activeExecutionId,consumer:"office",env,price:factoryPrice,invoke:monetary}),
      authorize: async limits => { reservation = await budget!.reserve(limits); },
      recordUsage: async metadata => { if (!reservation) throw new Error("Missing budget reservation"); await budget!.recordUsage(reservation, metadata); },
    });
    return provider.runOfficeOpenAI(prompt);
  };
  let policy: RolePolicy | undefined;
  const runtime = createOfficeRuntime({ claude: run, loadPr: deps.loadPr, reviewGuidance: () => policy?.guidance || [], reviewProvider: openai ? "openai" : "claude" });
  const roleId = "claude-reviewer";
  const admission = {
    async ready() {
      const state = await council.updateOfficeExecution(s => s);
      const role = state.roles.roles[roleId];
      return !!role && ["active", "probation"].includes(role.status) && !role.leases.some(l => ["running", "unknown"].includes(l.status));
    },
    async begin(task: OfficeCloudRun) {
      if (task.kind !== "claude_review" || !task.fence || !task.leaseExpiresAt) return false;
      let admitted = false; policy = undefined; activeExecutionId = undefined;
      await council.updateOfficeExecution(state => {
        admitted = false; policy = undefined;
        const active = state.roles.roles[roleId]?.activePolicy;
        if (!active) return state;
        const result = reserveRoleExecution(state.roles, { roleId, policyVersion: active.version, executionId: task.id,
          fence: task.fence!, now: now(), ttlMs: Math.min(300000, Date.parse(task.leaseExpiresAt!) - now()) });
        admitted = !!result.lease; policy = admitted ? active : undefined;
        return { ...state, roles: result.state };
      });
      if (admitted) activeExecutionId = `review:${task.id}`;
      return admitted;
    },
    async finish(task: OfficeCloudRun, result: OfficeCloudCompletion) {
      if (!policy || !task.fence) throw new Error("Missing policy assignment");
      const artifactId = createHash("sha256").update(JSON.stringify({ taskId: task.id, result })).digest("hex");
      const version = policy.version;
      let accepted = false;
      await council.updateOfficeExecution((state, company) => {
        const completion = completeRoleExecution(state.roles, { roleId, executionId: task.id, fence: task.fence!,
          policyVersion: version, now: now(), artifactId, success: result.status === "completed" && !!result.review && !!result.sessionId });
        accepted = completion.accepted;
        if (accepted && (result.status === "completed" || ["INVALID_REVIEW", "INVALID_RESULT"].includes(result.error?.code || ""))) {
          const scored = advanceCompany(company, { now: now(), roles: { [roleId]: "Reviewer" }, statuses: {
            [roleId]: { state: result.status === "completed" ? "working" : "error", label: "Verified reviewer result", evidenceId: task.id },
          } });
          Object.assign(company, scored.state);
        }
        return { ...state, roles: completion.state };
      });
      policy = undefined;
      activeExecutionId = undefined;
      if (!accepted) throw new Error("Role completion was not confirmed; reconcile stored cloud result before another run");
    },
  };
  return { run, execute: runtime.executeForCloud, admission,
    probe: openai ? createOfficeOpenAI({ env, authorize: async () => {}, recordUsage: async () => {} }).probeOfficeOpenAI : probeOfficeClaude };
}
