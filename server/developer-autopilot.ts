import type { AppQaScanResult, AppQaStatus } from "./app-qa-agent";
import { createIssue, createIssueComment, listRepositories } from "./github-client";
import { storage } from "./storage";
import type { AppProject } from "@shared/schema";

export type DeveloperFixKind = "bug" | "security" | "threat" | "incident" | "qa";
export type SubscriptionHandoffKind = "marketing" | "design" | "strategy" | "analysis" | "business_ops";
export type DeveloperAutopilotSource = "web_chat" | "telegram" | "app_qa" | "cybersecurity" | "health_monitor" | "manual";

export type DeveloperAutopilotRequest = {
  source: DeveloperAutopilotSource;
  repoFullName?: string | null;
  pullRequestNumber?: number | null;
  appName?: string | null;
  kind: DeveloperFixKind;
  title: string;
  description: string;
  severity?: "critical" | "high" | "medium" | "low";
  evidence?: string[];
  productionUrl?: string | null;
  replitRequested?: boolean;
};

export type DeveloperAutopilotHandoffStatus = "created" | "codex_dispatched" | "subscription_brief" | "needs_repo" | "github_unavailable" | "invalid_request";

export type SubscriptionHandoffRequest = {
  source: DeveloperAutopilotSource;
  kind: SubscriptionHandoffKind;
  title: string;
  description: string;
  reason: string;
};

export type DeveloperAutopilotHandoff = {
  status: DeveloperAutopilotHandoffStatus;
  request: DeveloperAutopilotRequest | null;
  subscriptionRequest?: SubscriptionHandoffRequest;
  repoFullName?: string;
  issueUrl?: string;
  issueNumber?: number;
  codexDispatchCommentUrl?: string;
  codexDispatchPrNumber?: number;
  codexDispatchError?: string;
  codexBrief?: string;
  subscriptionBrief?: string;
  handoffType?: "developer_pr" | "subscription_work";
  message: string;
};

export type DeveloperReleaseGate = {
  status: "pass" | "blocked";
  canSendForApproval: boolean;
  canDeployToReplit: false;
  requiresHumanReplitApproval: true;
  secondReviewRequired: true;
  requiredReviewers: readonly ["codex", "claude", "app_qa"];
  prUrl?: string | null;
  reasons: string[];
  qaSummary: string;
};

export const DEVELOPER_AUTOPILOT_POLICY = {
  codexBillingMode: "chatgpt_subscription",
  claudeBillingMode: "signed_in_claude_subscription_or_claude_code",
  repoScope: "all_registered_github_projects",
  changeStrategy: "pull_request_first",
  secondReview: "claude_independent_review_before_app_qa",
  qaGate: "app_qa_all_subagents_pass",
  replitDeployment: "explicit_human_approval_required",
  securityDisclosure: "private_or_sanitized",
  subscriptionHandoff: "prefer_chatgpt_codex_pro_for_heavy_manual_work",
} as const;

type MinimalRepo = {
  full_name: string;
  name: string;
  private?: boolean;
  html_url?: string;
  homepage?: string | null;
};

type DeveloperAutopilotDeps = {
  getAppProjects(userId: string): Promise<Array<Pick<AppProject, "name" | "description" | "githubRepo" | "publicUrl" | "healthUrl">>>;
  listRepositories(): Promise<MinimalRepo[]>;
  createIssue(owner: string, repo: string, title: string, body: string): Promise<{ number: number; html_url: string }>;
  createIssueComment(owner: string, repo: string, issueNumber: number, body: string): Promise<{ html_url: string }>;
};

const defaultDeveloperAutopilotDeps: DeveloperAutopilotDeps = {
  getAppProjects: (userId) => storage.getAppProjects(userId),
  listRepositories,
  createIssue,
  createIssueComment,
};

const SENSITIVE_TEXT_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9_]{12,}\b/g,
  /\b(xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  /\b(?:password|passwd|secret|token|api[_-]?key|client[_-]?secret|private[_-]?key)\s*[:=]\s*[^\s,;]+/gi,
];

function normalizeEvidence(evidence: string[] | undefined): string[] {
  return (evidence || [])
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 10);
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function redactSensitiveText(value: string): string {
  return SENSITIVE_TEXT_PATTERNS.reduce((text, pattern) => text.replace(pattern, "[redacted]"), value);
}

function removeUrls(value: string): string {
  return value.replace(/\bhttps?:\/\/\S+/gi, " ");
}

function inferFixKind(message: string): DeveloperFixKind | null {
  const text = normalizeText(message);
  const hasIssueTerm = /\b(bug|error|fallo|amenaza|vulnerabilidad|security|seguridad|hack|ataque|exploit|token|secreto|secret|qa|caido|caida|incidente|incident)\b/.test(text);
  const hasFixVerb = /\b(arregla|acomoda|corrige|fix|repara|resuelve|investiga|revisa)\b/.test(text);
  const hasDeveloperTarget = /\b(codigo|code|github|repo|repositorio|app|website|site|api|deploy|replit|pr|pull request)\b/.test(text) || Boolean(extractExplicitRepo(message));
  const mentionsWork = hasIssueTerm || (hasFixVerb && hasDeveloperTarget);
  if (!mentionsWork) return null;
  if (/\b(amenaza|vulnerabilidad|security|seguridad|hack|ataque|exploit|token|secreto|secret)\b/.test(text)) return "security";
  if (/\b(caido|caida|incidente|incident|produccion rota|production down)\b/.test(text)) return "incident";
  if (/\b(qa|patrulla|check|chequeo)\b/.test(text)) return "qa";
  return "bug";
}

function inferSubscriptionHandoffKind(message: string): SubscriptionHandoffKind | null {
  const text = normalizeText(message);
  const explicitSubscriptionIntent = /\b(membresia|membership|chatgpt pro|codex pro|codex|pro subscription|mi plan|plan de 200|200)\b/.test(text)
    && /\b(usa|usar|usalo|mandalo|envia|pasalo|prepara|handoff|brief|trabajo pesado|fuerte|sin api|no gastar api)\b/.test(text);
  const heavyManualWork = /\b(campana completa|estrategia completa|plan completo|analisis profundo|reporte profundo|disena.*flyers?|flyers?.*completo|marketing completo|dropshipping.*estrategia|clippers.*campana)\b/.test(text)
    && /\b(fuerte|pro|membresia|sin api|no gastar api|codex|chatgpt)\b/.test(text);
  const strictCostHeavyWork = /\b(campana completa|campanas completas|estrategia completa|plan completo|analisis profundo|reporte profundo|decision final|retorno de inversion|presupuesto de ads|budget de ads|marketing completo|dropshipping.*estrategia|clippers.*campana|multiples cuentas|muchos videos|10 cuentas|pack de flyers|flyers finales|flyer final|disena.*flyers?)\b/.test(text);

  if (!explicitSubscriptionIntent && !heavyManualWork && !strictCostHeavyWork) return null;
  if (/\b(diseno|disena|diseña|flyer|flyers|visual|brand|branding|canva|landing|ui|ux)\b/.test(text)) return "design";
  if (/\b(marketing|campana|campanas|ads|anuncios|metricool|caption|hooks|creativos|clippers)\b/.test(text)) return "marketing";
  if (/\b(analisis|analiza|reporte|metricas|retorno|roas|cac|data)\b/.test(text)) return "analysis";
  if (/\b(dropshipping|supplier|producto|productos|shopify|ventas|operacion)\b/.test(text)) return "business_ops";
  return "strategy";
}

function extractExplicitRepo(message: string): string | null {
  const withoutUrls = removeUrls(message);
  const matches = withoutUrls.matchAll(/\b([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+)\b/g);
  for (const match of matches) {
    const owner = match[1];
    const repo = match[2];
    if (owner.includes(".") || owner.toLowerCase() === "http" || owner.toLowerCase() === "https") continue;
    return `${owner}/${repo}`;
  }
  return null;
}

function extractExplicitPullRequestNumber(message: string): number | null {
  const patterns = [
    /\bhttps?:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/(\d{1,7})\b/i,
    /\b(?:pr|pull request)\s*#?\s*(\d{1,7})\b/i,
  ];
  for (const pattern of patterns) {
    const match = message.match(pattern);
    const number = match ? Number(match[1]) : NaN;
    if (Number.isInteger(number) && number > 0) return number;
  }
  return null;
}

function scoreRepoMatch(message: string, repo: MinimalRepo, projects: Array<Pick<AppProject, "name" | "description" | "githubRepo">>): number {
  const text = normalizeText(message);
  const repoFullName = normalizeText(repo.full_name);
  const repoName = normalizeText(repo.name);
  let score = 0;
  if (text.includes(repoFullName)) score += 100;
  if (text.includes(repoName)) score += 40;

  for (const project of projects) {
    if (project.githubRepo?.toLowerCase() !== repo.full_name.toLowerCase()) continue;
    const projectName = normalizeText(project.name || "");
    if (projectName && text.includes(projectName)) score += 60;
    for (const word of projectName.split(" ").filter((part) => part.length >= 4)) {
      if (text.includes(word)) score += 10;
    }
  }

  return score;
}

function selectRepoForRequest(
  message: string,
  repos: MinimalRepo[],
  projects: Array<Pick<AppProject, "name" | "description" | "githubRepo">>,
): MinimalRepo | null {
  const explicitRepo = extractExplicitRepo(message);
  if (explicitRepo) {
    return repos.find((repo) => repo.full_name.toLowerCase() === explicitRepo.toLowerCase()) || {
      full_name: explicitRepo,
      name: explicitRepo.split("/")[1],
    };
  }

  const scored = repos
    .map((repo) => ({ repo, score: scoreRepoMatch(message, repo, projects) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return null;
  if (scored.length > 1 && scored[0].score === scored[1].score) return null;
  return scored[0].repo;
}

function titleFromMessage(message: string, kind: DeveloperFixKind): string {
  const cleaned = redactSensitiveText(message)
    .replace(/\s+/g, " ")
    .replace(/^.*?\b(?:arregla|acomoda|corrige|fix|repara|resuelve|investiga|revisa)\b[:\s-]*/i, "")
    .trim();
  const fallback = kind === "security" || kind === "threat" ? "Security fix request" : "Bug fix request";
  return (cleaned || fallback).slice(0, 120);
}

export function parseDeveloperAutopilotRequest(message: string, source: DeveloperAutopilotSource): DeveloperAutopilotRequest | null {
  const kind = inferFixKind(message);
  if (!kind) return null;
  const redactedMessage = redactSensitiveText(message).trim();
  return {
    source,
    repoFullName: extractExplicitRepo(message),
    pullRequestNumber: extractExplicitPullRequestNumber(message),
    kind,
    title: titleFromMessage(message, kind),
    description: redactedMessage,
    severity: kind === "security" || kind === "threat" ? "high" : kind === "incident" ? "critical" : "medium",
    evidence: [],
    replitRequested: /\b(replit|deploy|monta|montarlo|deployment)\b/i.test(message),
  };
}

export function parseSubscriptionHandoffRequest(message: string, source: DeveloperAutopilotSource): SubscriptionHandoffRequest | null {
  const kind = inferSubscriptionHandoffKind(message);
  if (!kind) return null;
  const description = redactSensitiveText(message).trim();
  const title = description
    .replace(/\s+/g, " ")
    .replace(/^.*?\b(?:usa|usar|usalo|prepara|mandalo|envia|pasalo)\b[:\s-]*/i, "")
    .trim()
    .slice(0, 120) || "Trabajo pesado para ChatGPT/Codex Pro";

  return {
    source,
    kind,
    title,
    description,
    reason: "Conviene usar la membresia ChatGPT/Codex Pro para trabajo pesado manual y reservar API para automatizaciones.",
  };
}

function safetyLines(kind: DeveloperFixKind): string[] {
  const lines = [
    "Use Codex via the signed-in ChatGPT/Codex subscription workflow, not OpenAI API spend.",
    "Use Claude as an independent signed-in reviewer when available; do not use Anthropic API spend unless Robert explicitly asks.",
    "Open a separate branch and pull request first; do not commit directly to main.",
    "After Codex opens the PR, run Claude's independent review before App QA and resolve any blocking findings.",
    "Run the repo checks and App QA multiagent gate before asking for deploy approval.",
    "Do not deploy to Replit. Deployment requires Robert's explicit approval after the PR/QA report.",
    "Do not edit .env, secrets, credentials, private keys, OAuth tokens, recovery codes, .git, credentials/, secrets/, or node_modules/.",
  ];

  if (kind === "security" || kind === "threat") {
    lines.push("Keep exploit details private or sanitized; do not publish secrets, tokens, private URLs, or customer data in public issue/PR text.");
  }

  return lines;
}

export function buildCodexPrFirstBrief(request: DeveloperAutopilotRequest): string {
  const repoLine = request.repoFullName?.trim()
    ? `Repository: ${request.repoFullName.trim()}`
    : "Repository: identify the affected registered GitHub project before changing code.";
  const evidence = normalizeEvidence(request.evidence);

  return [
    "Developer Autopilot request",
    "",
    repoLine,
    `App: ${request.appName || "unknown"}`,
    `Source: ${request.source}`,
    `Type: ${request.kind}`,
    `Severity: ${request.severity || "medium"}`,
    `Title: ${request.title}`,
    "",
    "Description:",
    request.description,
    "",
    request.productionUrl ? `Production URL: ${request.productionUrl}` : "Production URL: unknown",
    "",
    "Evidence:",
    evidence.length ? evidence.map((item) => `- ${item}`).join("\n") : "- No extra evidence provided.",
    "",
    "Required safety rules:",
    safetyLines(request.kind).map((line) => `- ${line}`).join("\n"),
    "",
    "Completion report must include PR URL, files changed, tests run, App QA status, residual risk, rollback plan, and whether Replit deploy is still waiting for approval.",
    "Double-check order: Codex PR -> Claude independent review -> App QA release gate -> Robert approval.",
  ].join("\n");
}

export function buildCodexDispatchComment(request: DeveloperAutopilotRequest): string {
  return [
    "@codex fix this issue PR-first.",
    "",
    "Use the signed-in Codex/GitHub integration. Do not use BlackOps OpenAI API spend.",
    "",
    "Task:",
    request.description,
    "",
    "Rules:",
    "- Work only on this PR branch/context.",
    "- Keep the change focused and small.",
    "- Follow AGENTS.md and repo-local instructions.",
    "- Do not edit secrets, .env, credentials, tokens, .git, node_modules, credentials/, or secrets/.",
    "- Run the relevant tests/checks and report what passed or failed.",
    "- Do not merge or deploy. Robert must approve merge/deploy after QA.",
    "",
    "When done, comment with files changed, tests run, risk, rollback note, and anything still blocked.",
  ].join("\n");
}

export function buildSubscriptionHandoffBrief(request: SubscriptionHandoffRequest): string {
  const skillHint = request.kind === "design"
    ? "Use design/creative guidance: visual hierarchy, brand fit, Canva/flyer variants, clear production checklist, and final assets list."
    : request.kind === "marketing"
      ? "Use marketing guidance: goal, audience, offer, hooks, creatives, channels, Metricool schedule, tracking, budget/risk, and next actions."
      : request.kind === "analysis"
        ? "Use analysis guidance: assumptions, data needed, findings, confidence, risks, recommended decisions, and follow-up measurements."
        : "Use business strategy guidance: objective, constraints, options, cost/risk, execution plan, and approval gates.";

  return [
    "BlackOps subscription handoff",
    "",
    "Use this in the signed-in ChatGPT/Codex Pro membership workflow. Do not spend OpenAI API tokens for this heavy manual work unless Robert explicitly asks.",
    "",
    `Source: ${request.source}`,
    `Type: ${request.kind}`,
    `Title: ${request.title}`,
    "",
    "Robert asked:",
    request.description,
    "",
    "Cost rule:",
    "- Keep BlackOps API usage cheap-first.",
    "- Use Gemini/Gemma or app automations for bulk drafts and repetitive work.",
    "- Use ChatGPT/Codex Pro membership for deep reasoning, campaign strategy, design review, code/PR work, and final judgment.",
    "- Do not approve paid ads, paid generative video at scale, external posting, supplier/customer outreach, or production changes without Robert approval.",
    "",
    "Work guidance:",
    skillHint,
    "",
    "Expected output:",
    "- Short executive answer first.",
    "- Practical plan with next 3-7 actions.",
    "- Any copy, hooks, briefs, prompts, or QA checklist needed to execute.",
    "- Cost/risk note and what requires Robert approval.",
    "- If this becomes code work, create a PR-first Codex brief instead of editing main.",
  ].join("\n");
}

export function buildCodexGitHubIssueTitle(request: DeveloperAutopilotRequest, repo?: MinimalRepo): string {
  const prefix = request.kind === "security" || request.kind === "threat"
    ? "[Codex PR-first][security]"
    : "[Codex PR-first]";
  const isPublicSecurity = (request.kind === "security" || request.kind === "threat") && repo?.private === false;
  const title = isPublicSecurity ? "Security-sensitive fix request" : request.title;
  return `${prefix} ${title}`.slice(0, 200);
}

export function buildCodexGitHubIssueBody(request: DeveloperAutopilotRequest, repo: MinimalRepo): string {
  const isPublicSecurity = (request.kind === "security" || request.kind === "threat") && repo.private === false;
  const safeRequest = isPublicSecurity
    ? {
        ...request,
        description: "Security-sensitive report received. Details are intentionally sanitized because this repository may be public. Use private context from Robert before publishing exploit details.",
        evidence: ["Security details withheld from public issue body."],
      }
    : {
        ...request,
        description: redactSensitiveText(request.description),
        evidence: normalizeEvidence(request.evidence).map(redactSensitiveText),
      };

  return [
    "## Codex PR-first handoff",
    "",
    "This issue is a handoff for Codex using the signed-in ChatGPT/Codex subscription workflow. Do not use OpenAI API spend for this repair.",
    "",
    "## Task brief",
    "",
    "```text",
    buildCodexPrFirstBrief({ ...safeRequest, repoFullName: repo.full_name }),
    "```",
    "",
    "## Required workflow",
    "",
    "- Create a separate branch.",
    "- Open a pull request before merging anything.",
    "- Add `@codex review` on the PR when ready for Codex review, or enable automatic Codex reviews for this repo.",
    "- Run Claude as an independent second reviewer before App QA; fix or document any Claude blockers.",
    "- Run project checks and App QA before deploy approval.",
    "- Do not deploy to Replit from this issue or PR. Robert must approve Replit deployment explicitly after the PR/QA summary.",
    "",
    "## Release gate",
    "",
    "- PR exists: required.",
    "- Claude independent review: required before App QA.",
    "- App QA Route Scout: pass required.",
    "- App QA Link + Click Scout: pass required.",
    "- App QA GitHub Scout: pass required.",
    "- App QA API Scout: pass required.",
    "- App QA Error Scout: pass required.",
    "- App QA Improvement Scout: pass required.",
    "- Replit deploy: blocked until explicit approval.",
  ].join("\n");
}

export async function createDeveloperAutopilotHandoff(
  userId: string,
  message: string,
  source: DeveloperAutopilotSource,
  deps: DeveloperAutopilotDeps = defaultDeveloperAutopilotDeps,
): Promise<DeveloperAutopilotHandoff> {
  const request = parseDeveloperAutopilotRequest(message, source);
  if (!request) {
    const subscriptionRequest = parseSubscriptionHandoffRequest(message, source);
    if (!subscriptionRequest) {
      return {
        status: "invalid_request",
        request: null,
        message: "No detecte un bug, amenaza, solicitud de fix o trabajo pesado para handoff de membresia.",
      };
    }

    const subscriptionBrief = buildSubscriptionHandoffBrief(subscriptionRequest);
    return {
      status: "subscription_brief",
      request: null,
      subscriptionRequest,
      subscriptionBrief,
      handoffType: "subscription_work",
      message: [
        "Listo. Prepare un brief para trabajarlo con tu membresia ChatGPT/Codex Pro, sin quemar API del app.",
        "",
        "Pegalo en Codex/ChatGPT Pro cuando quieras usar el cerebro fuerte:",
        "",
        "```text",
        subscriptionBrief,
        "```",
      ].join("\n"),
    };
  }

  try {
    const [projects, repos] = await Promise.all([
      deps.getAppProjects(userId),
      deps.listRepositories(),
    ]);
    const repo = selectRepoForRequest(message, repos, projects);
    if (!repo) {
      return {
        status: "needs_repo",
        request,
        codexBrief: buildCodexPrFirstBrief(request),
        message: "Necesito saber que repo de GitHub debo usar. Dime algo como: arregla este bug en owner/repo.",
      };
    }

    const [owner, repoName] = repo.full_name.split("/");
    if (!owner || !repoName) {
      return {
        status: "needs_repo",
        request,
        message: "El repo detectado no tiene formato owner/repo. Mandame el repo exacto de GitHub.",
      };
    }

    const requestWithRepo = { ...request, repoFullName: repo.full_name };
    const body = buildCodexGitHubIssueBody(requestWithRepo, repo);
    const issue = await deps.createIssue(owner, repoName, buildCodexGitHubIssueTitle(requestWithRepo, repo), body);
    let codexDispatchCommentUrl: string | undefined;
    let codexDispatchError: string | undefined;
    if (requestWithRepo.pullRequestNumber) {
      try {
        const comment = await deps.createIssueComment(
          owner,
          repoName,
          requestWithRepo.pullRequestNumber,
          buildCodexDispatchComment(requestWithRepo),
        );
        codexDispatchCommentUrl = comment.html_url;
      } catch (commentError: any) {
        codexDispatchError = commentError?.message || "No pude comentar en el PR";
      }
    }

    return {
      status: codexDispatchCommentUrl ? "codex_dispatched" : "created",
      request: requestWithRepo,
      handoffType: "developer_pr",
      repoFullName: repo.full_name,
      issueUrl: issue.html_url,
      issueNumber: issue.number,
      codexDispatchCommentUrl,
      codexDispatchPrNumber: requestWithRepo.pullRequestNumber || undefined,
      codexDispatchError,
      codexBrief: buildCodexPrFirstBrief(requestWithRepo),
      message: [
        codexDispatchCommentUrl
          ? "Listo. Cree el handoff PR-first y le mande el fix directo a Codex en el PR."
          : "Listo. Cree el handoff PR-first para Codex.",
        `Repo: ${repo.full_name}`,
        `Issue: ${issue.html_url}`,
        codexDispatchCommentUrl
          ? `Codex dispatch: ${codexDispatchCommentUrl}`
          : codexDispatchError
            ? `Codex dispatch pendiente: ${codexDispatchError}. Verifica el numero/link del PR y vuelve a pedir el dispatch.`
          : "Siguiente paso: cuando exista un PR, BlackOps puede comentar @codex fix para activar Codex Cloud sin API.",
        "No voy a montar en Replit hasta que apruebes explicitamente el deploy.",
      ].join("\n"),
    };
  } catch (error: any) {
    return {
      status: "github_unavailable",
      request,
      codexBrief: buildCodexPrFirstBrief(request),
      message: `No pude crear el handoff en GitHub: ${error?.message || "GitHub no disponible"}`,
    };
  }
}

export function evaluateDeveloperReleaseGate(
  scan: Pick<AppQaScanResult, "failCount" | "warnCount" | "summary" | "subAgents">,
  input: { prUrl?: string | null } = {},
): DeveloperReleaseGate {
  const failingAgents = scan.subAgents.filter((agent) => agent.status !== "pass");
  const prUrl = input.prUrl?.trim() || null;
  const reasons: string[] = [];

  if (!prUrl) {
    reasons.push("A pull request URL is required before sending the fix to Robert for approval.");
  }
  if (scan.failCount > 0) {
    reasons.push(`${scan.failCount} high/critical App QA finding(s) must be fixed before release.`);
  }
  if (scan.warnCount > 0) {
    reasons.push(`${scan.warnCount} App QA warning(s) must be resolved before Replit deployment.`);
  }
  if (failingAgents.length > 0) {
    reasons.push(`Subagents not passing: ${failingAgents.map((agent) => `${agent.name}=${agent.status}`).join(", ")}.`);
  }

  const passed = reasons.length === 0;
  return {
    status: passed ? "pass" : "blocked",
    canSendForApproval: passed,
    canDeployToReplit: false,
    requiresHumanReplitApproval: true,
    secondReviewRequired: true,
    requiredReviewers: ["codex", "claude", "app_qa"],
    prUrl,
    reasons: passed ? [`PR can be sent to Robert for approval: ${prUrl}. Replit deployment is still blocked until explicit approval.`] : reasons,
    qaSummary: scan.summary,
  };
}

export function buildReadyForApprovalMessage(input: {
  repoFullName: string;
  prUrl: string;
  qaGate: DeveloperReleaseGate;
  testsRun: string[];
  risks?: string[];
  rollback?: string;
}): string {
  const tests = input.testsRun.length ? input.testsRun.join(", ") : "No tests reported";
  const risks = input.risks?.length ? input.risks.join("; ") : "No residual risks reported";
  const deployLine = "No voy a montar en Replit hasta que Robert apruebe explicitamente el deploy.";

  return [
    "Ya tengo el PR listo para revisar.",
    "",
    `Repo: ${input.repoFullName}`,
    `PR: ${input.prUrl}`,
    `QA gate: ${input.qaGate.status}`,
    `QA summary: ${input.qaGate.qaSummary}`,
    `Tests: ${tests}`,
    `Riesgos: ${risks}`,
    `Rollback: ${input.rollback || "Revertir el PR o volver al deployment anterior."}`,
    "",
    deployLine,
  ].join("\n");
}

export const __developerAutopilotInternals = {
  safetyLines,
  extractExplicitRepo,
  extractExplicitPullRequestNumber,
  inferFixKind,
  inferSubscriptionHandoffKind,
  redactSensitiveText,
  selectRepoForRequest,
};
