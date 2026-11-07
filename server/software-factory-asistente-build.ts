import { createHash } from "node:crypto";
import { createFactoryAsistenteGitHubClient, createFactoryAsistenteGitHubSourceExporter, FACTORY_ASISTENTE_REPOSITORY } from "./software-factory-github-client";
import { createGitHubActionsFactoryBuilder } from "./software-factory-remote-builder";
import { createOpenAiFactoryPatchGenerator } from "./software-factory-openai-builder";
import { createOpenAiFactoryTextProvider } from "./software-factory-openai";
import { executeWithinSharedCredits } from "./shared-openai-credit-execution";
import type { createSharedOpenAiCreditLedger } from "./shared-openai-credit-ledger";
import type { FactoryActionsProfile } from "./software-factory-actions";
import type { FactoryPipelineDependencies } from "./software-factory-pipeline";

/** Concrete build-to-PR adapter. Does not install itself, enable a scheduler,
 * deploy, or claim low risk. Credentials stay in the two trusted transports. */
export function createAsistenteFactoryBuild(options: {
  ledger: ReturnType<typeof createSharedOpenAiCreditLedger>;
  githubRequest: (url: string, init: RequestInit) => Promise<Response>;
  model: Parameters<typeof createOpenAiFactoryTextProvider>[0];
  baseBranch: "main" | "codex/office-integrated-repair-20261106";
  sourcePaths: readonly string[];
  checks: FactoryActionsProfile;
  maxOutputTokens: number;
  now: () => Date;
  maxPolls?: number;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}): NonNullable<FactoryPipelineDependencies["build"]> {
  const paths = [...options.sourcePaths];
  if (!paths.length) throw Error("FACTORY_ASISTENTE_SOURCE_REQUIRED");
  const repository = FACTORY_ASISTENTE_REPOSITORY;
  const client = createFactoryAsistenteGitHubClient({ request: options.githubRequest,
    baseBranch: options.baseBranch, writePaths: paths, allowDispatch: options.checks.trigger === "workflow_dispatch" });
  const model = { ...options.model };
  const ledger = options.ledger, maxOutputTokens = options.maxOutputTokens;
  const profile = { baseBranch: options.baseBranch, checks: { ...options.checks } };
  return async (project, state, context) => {
    if (project.repo !== repository || state.projectId !== project.id || !state.rootJobId || !Number.isSafeInteger(state.repairAttempts) || state.repairAttempts < 0) {
      return { status: "blocked", costCents: 0, reason: "FACTORY_ASISTENTE_SCOPE_INVALID" };
    }
    const key = `factory:${createHash("sha256").update(JSON.stringify([project.id, state.rootJobId, state.repairAttempts])).digest("hex")}`;
    const generate = createOpenAiFactoryTextProvider({ ...model, request: async (url, init) => {
      const remainingMs = await ledger.executionWindow(key);
      const deadline = AbortSignal.timeout(Math.floor(remainingMs));
      const signal = init.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
      signal.throwIfAborted();
      return model.request(url, { ...init, signal });
    } });
    const generatePatch = createOpenAiFactoryPatchGenerator({ sourcePaths: { [repository]: paths }, maxOutputTokens,
      generateText: async input => {
        const requestSha256 = createHash("sha256").update(JSON.stringify([model.model, input.instructions, input.text, input.maxOutputTokens])).digest("hex");
        return executeWithinSharedCredits(ledger, { key, consumer: "factory", requestSha256, maximumMicroUsd: input.maxCostCents * 10000 }, async () => {
          const result = await generate(input);
          if (result.status === "unknown") throw Error("FACTORY_MODEL_OUTCOME_UNKNOWN");
          return { value: result, actualMicroUsd: result.costCents * 10000, evidenceId: `factory-model:${requestSha256}:${createHash("sha256").update(key).digest("hex").slice(0, 16)}` };
        });
      },
    });
    const build = createGitHubActionsFactoryBuilder({ exportSource: createFactoryAsistenteGitHubSourceExporter(client),
      generatePatch, publisherClient: client, actionsClient: client,
      repositories: { [repository]: profile }, publicationCostCents: 0,
      now: options.now, maxPolls: options.maxPolls, wait: options.wait });
    return build(project, state, context);
  };
}
