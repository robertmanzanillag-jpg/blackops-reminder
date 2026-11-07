import {ROLE_WORK_DEADLINE_ID} from "./software-factory-role-deadline";
import { createHash } from "node:crypto";
import { readFile, lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { CompanyOrder } from "../shared/agent-company";
import type { FactoryEvidence } from "./software-factory";
import type { FactoryJobInput } from "./software-factory-store";
import { configuredSoftwareFactoryStore } from "./software-factory-store-provider";
import { loadSharedCreditRuntime } from "./shared-openai-credit-runtime";
import { getCouncilStore } from "./agent-council-store";
import { companyOrderJob, createCompanyOrderDiscovery, ASISTENTE_REPOSITORY } from "./software-factory-company";
import { createFactoryCompanyOrderScheduler } from "./software-factory-company-scheduler";
import { createTrustedFactoryProposalWorkerOptions } from "./software-factory-runtime";
import { createAsistenteFactoryBuild } from "./software-factory-asistente-build";
import { createAsistenteIndependentReview } from "./software-factory-asistente-review";
import { createAsistenteReviewSourceLoader } from "./software-factory-asistente-source";
import { createFactoryAsistenteGitHubClient } from "./software-factory-github-client";
import { createAsistenteGitHubTransport } from "./software-factory-github-transport";
import { createFactoryOpenAiTransport } from "./software-factory-openai-transport";
import { createRoleAcceptanceArtifactReader } from "./software-factory-role-artifact";
import { createOfficeUiArtifactReader } from "./software-factory-office-ui-artifact";
import { ROLE_WORK_ACCEPTANCE_ID } from "./software-factory-role-acceptance";
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const sha = z.string().regex(/^[a-f0-9]{40}$/), digest = z.string().regex(/^[a-f0-9]{64}$/);
const cents = z.number().int().min(1).max(100);
const configSchema = z.object({ owner: z.string().min(1).max(200), projectId: z.literal("asistente"), baseBranch: z.enum(["main", "codex/office-integrated-repair-20261106"]),
    sourcePaths: z.array(z.enum(["server/office-role-work.ts", "tests/office-role-work.test.ts"])).min(1).max(2),
    checks: z.object({ trigger: z.literal("push"), workflowId: z.number().int().positive(), workflowPath: z.literal(".github/workflows/factory-candidate-checks.yml"), workflowSha256: digest, jobName: z.string().min(1), testStep: z.string().min(1), buildStep: z.string().min(1), browserStep: z.string().min(1) }).strict(),
    allowGitHubResultsAzureHosts: z.boolean().default(false),
    archiveHosts: z.array(z.string().regex(/^[-a-z0-9]+\.blob\.core\.windows\.net$/)).min(1).max(10),
    reservations: z.object({ discover: cents, build: cents, simulate: cents, review: cents }).strict(), maxOutputTokens: z.number().int().min(16).max(4096), maxInputTokens: z.number().int().min(1).max(100000),
    orders: z.array(z.object({ id: z.string().min(1).max(200), revision: digest, baseSha: sha, kind: z.enum(["bug", "improvement"]), scenarioId: z.enum([ROLE_WORK_ACCEPTANCE_ID,ROLE_WORK_DEADLINE_ID]) }).strict()).max(5),
    ui: z.object({ workflowSha256: digest, harnessSha256: digest, workflowId: z.number().int().positive() }).strict(),
}).strict();
export type AsistenteOperatorConfig = z.input<typeof configSchema>;
/** Strict noncredential operator configuration validation; no I/O or admission. */
export function validateAsistenteOperatorConfig(raw:unknown){return configSchema.parse(structuredClone(raw));}
export type OperatorUiReader = (input: {
    projectId: string;
    baseSha: string;
    headSha: string;
    runId: number;
    signal: AbortSignal;
}) => Promise<FactoryEvidence>;
type Store = typeof configuredSoftwareFactoryStore;
type Credits = Awaited<ReturnType<typeof loadSharedCreditRuntime>>;
/** Concrete PR-only composition. All external handles originate in the trusted
 * launcher. Admission is a no-provider hold, not a promise of whole-job funding. */
export function createAsistenteOperatorComposition(raw: AsistenteOperatorConfig, deps: {
    store: Store;
    credits: Credits;
    readOrders: (owner: string) => Promise<CompanyOrder[]>;
    githubRequest: (url: string, init: RequestInit) => Promise<Response>;
    modelRequest: (url: string, init: RequestInit) => Promise<Response>;
    download: typeof fetch;
    readUi: OperatorUiReader;
    recoveryPrevious?: import('./software-factory-pipeline').FactoryPipelineDependencies['recoveryPrevious'];
    now: () => Date;
}) {
    const config = validateAsistenteOperatorConfig(raw), { store, credits, now } = deps;
    if (new Set(config.sourcePaths).size !== config.sourcePaths.length || !config.sourcePaths.includes("server/office-role-work.ts") || !config.sourcePaths.includes("tests/office-role-work.test.ts") || config.ui.workflowId !== config.checks.workflowId || config.ui.workflowSha256 !== config.checks.workflowSha256 || new Set(config.orders.map(o => o.id)).size !== config.orders.length || typeof deps.readUi !== "function")
        throw Error("FACTORY_OPERATOR_CONFIGURATION_INVALID");
    const owner = config.owner, ownerKey = createHash("sha256").update(owner).digest("hex");
    const client = createFactoryAsistenteGitHubClient({ request: deps.githubRequest, baseBranch: config.baseBranch, writePaths: config.sourcePaths, allowDispatch: false });
    const project = async () => { const p = await store.projectByOwnerKey(ownerKey, config.projectId); if (!p || p.repo !== ASISTENTE_REPOSITORY || p.id !== config.projectId || p.automaticRelease || p.providerSupportsRelease || p.providerSupportsRollback || p.journeys.length !== 2 || !["office-session-login", "office-company-navigation"].every(j => p.journeys.includes(j)))
        throw Error("FACTORY_OPERATOR_PROJECT_INVALID"); return p; };
    const orders = async () => { const rows = structuredClone(await deps.readOrders(owner)); if (!Array.isArray(rows) || rows.length > 1000 || new Set(rows.map(o => o.id)).size !== rows.length)
        throw Error("FACTORY_OPERATOR_ORDERS_INVALID"); return rows; };
    const mapped = async (order: CompanyOrder) => { const p = await project(), input = companyOrderJob(order, p, config.reservations.discover), revision = (input.payload!.companyOrder as {
        revision: string;
    }).revision; const mapping = config.orders.find(m => m.id === order.id && m.revision === revision); if (!mapping)
        throw Error("FACTORY_OPERATOR_ORDER_NOT_MAPPED"); return { input, mapping }; };
    const readMainOrder = async (requestOwner: string, id: string) => { if (requestOwner !== owner)
        throw Error("FACTORY_OPERATOR_OWNER_MISMATCH"); return (await orders()).find(o => o.id === id); };
    const admitWithinCredits = async (requestOwner: string, input: FactoryJobInput) => {
        if (requestOwner !== owner)
            throw Error("FACTORY_OPERATOR_OWNER_MISMATCH");
        const source = input.payload?.companyOrder as {
            orderId?: string;
        } | undefined;
        const order = source?.orderId ? await readMainOrder(owner, source.orderId) : undefined;
        if (!order)
            throw Error("FACTORY_OPERATOR_ORDER_REQUIRED");
        const expected = (await mapped(order)).input;
        if (hash(input) !== hash(expected))
            throw Error("FACTORY_OPERATOR_ADMISSION_MISMATCH");
        const state = await store.status(owner);
        if (!state.configured || state.paused)
            throw Error("FACTORY_OPERATOR_PAUSED");
        const key = `factory-admission:${hash([owner, expected.key])}`, requestSha256 = hash(expected), maximumMicroUsd = (config.reservations.build + config.reservations.review) * 10000;
        const reservation = await credits.ledger.reserve({ key, consumer: "factory", requestSha256, maximumMicroUsd });
        if (!reservation.admitted) {
            if (reservation.reservation.status !== "settled")
                throw Error("FACTORY_OPERATOR_ADMISSION_UNCONFIRMED");
            const matches = (await store.list(owner)).filter(j => j.ownerKey === ownerKey && j.key === expected.key && j.projectId === config.projectId && j.kind === "discover");
            if (matches.length !== 1)
                throw Error("FACTORY_OPERATOR_ADMISSION_RECEIPT_UNAVAILABLE");
            return matches[0];
        }
        // If enqueue acknowledgement is lost, leave this exact hold untouched. No
        // automatic replay/reconciliation and no fabricated provider receipt.
        try {
            const job = await store.enqueue(owner, expected);
            if (job.ownerKey !== ownerKey || job.key !== expected.key || job.projectId !== config.projectId || job.kind !== "discover")
                throw Error("FACTORY_OPERATOR_ADMISSION_UNVERIFIED");
            await credits.ledger.settle({ key, actualMicroUsd: 0, evidenceId: `factory-admission-no-provider:${hash([owner, expected.key])}` });
            return job;
        } catch {
            // Unknown refers to queue/settlement acknowledgement, never a fabricated
            // provider call. A settled receipt cannot be overwritten by markUnknown.
            await credits.ledger.markUnknown(key, `factory-admission-no-provider-unconfirmed:${hash([owner, expected.key])}`).catch(() => undefined);
            throw Error("FACTORY_OPERATOR_ADMISSION_UNCONFIRMED");
        }
    };
    const readAcceptance = createRoleAcceptanceArtifactReader({ apiRequest: deps.githubRequest, download: deps.download, archiveHosts: config.archiveHosts, allowGitHubResultsAzureHosts: config.allowGitHubResultsAzureHosts, now: () => now().getTime() });
    const model = { request: deps.modelRequest, model: credits.pricing.model, inputNanoUsdPerToken: credits.pricing.inputNanoUsdPerToken, outputNanoUsdPerToken: credits.pricing.outputNanoUsdPerToken, pricingValidUntil: credits.pricing.validUntil, maxInputTokens: config.maxInputTokens, now };
    const build = createAsistenteFactoryBuild({ ledger: credits.ledger, githubRequest: deps.githubRequest, model, baseBranch: config.baseBranch, sourcePaths: config.sourcePaths, checks: config.checks, maxOutputTokens: config.maxOutputTokens, readAcceptance, now });
    const review = createAsistenteIndependentReview({ ledger: credits.ledger, model, load: createAsistenteReviewSourceLoader(client, config.sourcePaths), now, maxOutputTokens: config.maxOutputTokens });
    const discover = createCompanyOrderDiscovery({ readMainOrder: id => readMainOrder(owner, id), resolveHead: async (repo, signal) => { signal.throwIfAborted(); if (repo !== ASISTENTE_REPOSITORY)
            throw Error("FACTORY_OPERATOR_REPOSITORY_INVALID"); return (await client.git.getRef({ owner: "robertmanzanillag-jpg", repo: "blackops-reminder", ref: `heads/${config.baseBranch}` })).data.object.sha; }, inspectOrder: async (order, baseSha, signal) => { signal.throwIfAborted(); const { mapping } = await mapped(order); if (baseSha !== mapping.baseSha)
            throw Error("FACTORY_OPERATOR_ACCEPTANCE_BASE_CHANGED"); return { kind: mapping.kind, regressionScenarioId: mapping.scenarioId }; } });
    const schedule = createFactoryCompanyOrderScheduler({ owner, project, readOrders: async () => { const rows = await orders(); return rows.filter(o => config.orders.some(m => m.id === o.id)); }, ledger: credits.ledger, reservationCents: config.reservations.discover, admit: admitWithinCredits });
    return { owner, store, reservationCents: config.reservations.discover, readMainOrder, admitWithinCredits,
        async createFactoryWorkerOptions() { await project(); return createTrustedFactoryProposalWorkerOptions({ owner, store, now, recoveryPrevious:deps.recoveryPrevious, reservations: config.reservations, scheduleCompanyOrders: schedule, stages: { discover, build, review, simulate: async (p, state, context) => { if (!state.candidate || p.id !== config.projectId)
                    throw Error("FACTORY_OPERATOR_CANDIDATE_REQUIRED"); const tests = state.evidence.filter(e => e.kind === "tests" && e.passed && e.headSha === state.candidate!.headSha && e.baseSha === state.candidate!.baseSha); const urls = tests.flatMap(e => e.artifactIds).filter(id => /^https:\/\/github\.com\/robertmanzanillag-jpg\/blackops-reminder\/actions\/runs\/[1-9][0-9]*$/.test(id)); if (urls.length !== 1)
                    throw Error("FACTORY_OPERATOR_RUN_UNVERIFIED"); return { costCents: 0, evidence: await deps.readUi({ projectId: p.id, baseSha: state.candidate.baseSha, headSha: state.candidate.headSha, runId: Number(urls[0].split("/").pop()), signal: context.signal }) }; } } }); }
    };
}
async function privateFile(value: string | undefined, max: number) {
    if (!value || !path.isAbsolute(value))
        throw Error("FACTORY_OPERATOR_PRIVATE_PATH_REQUIRED");
    const resolved = await realpath(value), repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    if (resolved === repo || resolved.startsWith(repo + path.sep) || (await lstat(value)).isSymbolicLink())
        throw Error("FACTORY_OPERATOR_PRIVATE_PATH_INVALID");
    const stat = await lstat(resolved);
    if (!stat.isFile() || stat.size > max)
        throw Error("FACTORY_OPERATOR_PRIVATE_FILE_INVALID");
    const text = await readFile(resolved, "utf8");
    if (Buffer.byteLength(text) > max)
        throw Error("FACTORY_OPERATOR_PRIVATE_FILE_INVALID");
    return text;
}
async function installed(store: Store) {
    const env = { ...process.env }, now = () => new Date();
    const config = validateAsistenteOperatorConfig(JSON.parse(await privateFile(env.SOFTWARE_FACTORY_OPERATOR_CONFIG, 65536)));
    if (env.SOFTWARE_FACTORY_OWNER_ID !== config.owner || env.DEFAULT_USER_ID !== config.owner)
        throw Error("FACTORY_OPERATOR_OWNER_MISMATCH");
    const credits = await loadSharedCreditRuntime(env, now);
    const budget = await credits.ledger.status();
    if (budget.expired || budget.uncertain || budget.overrun || budget.availableMicroUsd < (config.reservations.build + config.reservations.review) * 10000 || Date.parse(credits.pricing.validUntil) <= now().getTime())
        throw Error("FACTORY_OPERATOR_CREDIT_UNAVAILABLE");
    const githubRequest = createAsistenteGitHubTransport(env.SOFTWARE_FACTORY_GITHUB_TOKEN || "");
    const modelRequest = createFactoryOpenAiTransport(env.OPENAI_API_KEY || "");
    const readUi = createOfficeUiArtifactReader({ apiRequest: githubRequest, download: fetch, archiveHosts: config.archiveHosts, allowGitHubResultsAzureHosts: config.allowGitHubResultsAzureHosts, ...config.ui, now });
    let recoveryPool: import('pg').Pool | undefined;
    const recoveryPrevious=async(ownerKey:string,failedId:string,jobId:string)=>{
      if(!recoveryPool){const [{Pool},{resolveDatabaseConnectionString}]=await Promise.all([import('pg'),import('./database-url')]);recoveryPool=new Pool({connectionString:resolveDatabaseConnectionString(),allowExitOnIdle:true,max:1,connectionTimeoutMillis:10000,statement_timeout:15000});}
      const {loadFailedBuildRecovery}=await import('./software-factory-build-recovery');
      return loadFailedBuildRecovery(recoveryPool,ownerKey,failedId,jobId);
    };
    return createAsistenteOperatorComposition(config, { store, credits, githubRequest, modelRequest, download: fetch, readUi, recoveryPrevious, now, readOrders: async (owner) => { const raw = await (await getCouncilStore()).read(owner); if (!raw)
            throw Error("FACTORY_OPERATOR_COUNCIL_MISSING"); const state = JSON.parse(raw); if (!Array.isArray(state.company?.orders))
            throw Error("FACTORY_OPERATOR_COUNCIL_INVALID"); return state.company.orders; } });
}
export async function createFactoryWorkerOptions({ store }: {
    store: Store;
}) { return (await installed(store)).createFactoryWorkerOptions(); }
export async function createFactoryOfficeAdmission({ owner, store }: {
    owner: string;
    store: Store;
}) { const composition = await installed(store); if (owner !== composition.owner)
    throw Error("FACTORY_OPERATOR_OWNER_MISMATCH"); return composition; }
/** Startup validation only: no order admission, provider call or configuration mutation. */
export async function preflightFactoryOperator({ store }: {
    store: Store;
}) { const composition = await installed(store); const options = await composition.createFactoryWorkerOptions(); return { owner: composition.owner, projectId: "asistente", releaseMode: options.releaseMode, discoveryMode: options.discoveryMode }; }
