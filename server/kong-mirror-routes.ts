import type { Express, Request } from "express";
import { createKongMirrorLab, createMirrorSummarizer, MirrorError, KONG_MIRROR_ACTION_TYPE, type MirrorCards, type MirrorGithub, type MirrorStore, type MirrorCard } from "./kong-mirror-lab";
import { getAuthenticatedCurrentUserId, getSystemUserId } from "./user-context";
import { officeSameOrigin } from "./office-routes";
import { effectiveCommitStatusesPass } from "./kong-repair-proof";

type Lab = ReturnType<typeof createKongMirrorLab>;
export const KONG_MIRROR_REPORT_PATH = "/api/integrations/kong/mirror-reports";

/** Trust Center rows for this kind. Writes go through storage + pending_action_events + audit log, like the generic routes. */
export function createStorageMirrorCards(userId: string): MirrorCards {
  const deps = async () => ({ storage: (await import("./storage")).storage, trust: await import("./trust-policy") });
  const event = async (id: string, actorId: string, eventType: "approved" | "executed" | "failed" | "rejected" | "edited", previousStatus: string, nextStatus: string, note: string | null, metadata: Record<string, unknown> | null) => {
    const { storage } = await deps();
    await storage.createPendingActionEvent({ pendingActionId: id, userId, actorType: actorId === "system" ? "system" : "user", actorId,
      eventType, previousStatus: previousStatus as never, nextStatus: nextStatus as never, note, metadata });
  };
  const audit = async (id: string, actorId: string, actionType: string, status: "succeeded" | "failed" | "blocked", metadata: Record<string, unknown>) => {
    const { trust } = await deps();
    await trust.writeAuditLog({ userId, actorType: "user", actorId, origin: "web", actionType, resourceType: "pending_action", resourceId: id, pendingActionId: id,
      metadata, status, executionMode: "user_requested" });
  };
  return {
    async create(card: MirrorCard) {
      const { trust } = await deps();
      const action = await trust.createPendingActionForApproval({ userId, actorType: "webhook", actorId: "kong-mirror-lab", origin: "github", executionMode: "webhook",
        actionType: KONG_MIRROR_ACTION_TYPE, resourceType: "kong_mirror_report", resourceId: card.key, scope: "github",
        title: `${card.approvable ? (card.warn ? "Mejora KONG (con avisos)" : "Mejora KONG") : "KONG: mejora que falló"} · ${card.title}`.slice(0, 240),
        description: card.approvable
          ? `El equipo de pruebas del Mirror Lab revisó el PR #${card.prNumber}. ${card.whyDoIt.narrative}`.slice(0, 900)
          : `Informativo: el PR #${card.prNumber} falló en el Mirror Lab. ${card.failReasons.join(" ")}`.slice(0, 900),
        input: { reportKey: card.key, card }, proposedChanges: { merge: card.approvable, repo: card.repo, prNumber: card.prNumber, headSha: card.headSha },
        metadata: { reportKey: card.key, overall: card.overall } });
      return { id: action.id };
    },
    async findByKey(key) {
      const { storage } = await deps();
      const found = (await storage.getPendingActions(userId)).find(action => action.actionType === KONG_MIRROR_ACTION_TYPE && action.resourceId === key);
      return found ? { id: found.id, status: found.status } : null;
    },
    async get(id) {
      const { storage } = await deps();
      const found = await storage.getPendingAction(id);
      return found && found.userId === userId && found.actionType === KONG_MIRROR_ACTION_TYPE ? { id: found.id, status: found.status } : null;
    },
    async note(id, note, metadata) {
      const { storage } = await deps();
      const current = await storage.getPendingAction(id);
      if (current) await event(id, "system", "edited", current.status, current.status, note, metadata || null);
    },
    async approved(id, actorId) {
      const { storage } = await deps();
      const current = await storage.getPendingAction(id);
      await storage.updatePendingAction(id, { status: "approved", approvedBy: actorId, approvedAt: new Date(), approvalReason: "Aprobado por Robert tras verificar SHA y checks" });
      await event(id, actorId, "approved", current?.status || "pending", "approved", "SHA y checks verificados", null);
      await audit(id, actorId, "pending_action.approve", "succeeded", { kind: KONG_MIRROR_ACTION_TYPE });
    },
    async executed(id, actorId, result) {
      const { storage } = await deps();
      await storage.updatePendingAction(id, { status: "executed", executionResult: result as never, executedAt: new Date() });
      await event(id, actorId, "executed", "approved", "executed", String(result.message || "Merge hecho"), result);
      await audit(id, actorId, KONG_MIRROR_ACTION_TYPE, "succeeded", result);
    },
    async reopen(id, actorId, note) {
      const { storage } = await deps();
      await storage.updatePendingAction(id, { status: "pending", approvedBy: null, approvedAt: null });
      await event(id, actorId, "failed", "approved", "pending", note, null);
      await audit(id, actorId, KONG_MIRROR_ACTION_TYPE, "failed", { note });
    },
    async rejected(id, actorId, note) {
      const { storage } = await deps();
      const current = await storage.getPendingAction(id);
      await storage.updatePendingAction(id, { status: "rejected", rejectionReason: note });
      await event(id, actorId, "rejected", current?.status || "pending", "rejected", note, null);
      await audit(id, actorId, "pending_action.reject", "succeeded", { kind: KONG_MIRROR_ACTION_TYPE, note });
    },
  };
}

/** Uses the same GitHub client as the KONG repair bridge (GITHUB_TOKEN / GH_TOKEN, else the Replit GitHub connector). */
export function createOctokitMirrorGithub(): MirrorGithub {
  const client = async () => (await import("./github-client")).getGitHubClient();
  const split = (repo: string) => { const [owner, name] = repo.split("/"); return { owner, repo: name }; };
  return {
    async readPull(repo, prNumber) {
      const github = await client();
      const pr = (await github.pulls.get({ ...split(repo), pull_number: prNumber })).data;
      return { state: pr.state, merged: !!pr.merged, headSha: pr.head.sha, baseRepo: pr.base.repo?.full_name || "", baseRef: pr.base.ref, mergeable: pr.mergeable ?? null };
    },
    async readChecks(repo, sha) {
      const github = await client();
      const [checks, statuses] = await Promise.all([
        github.paginate(github.checks.listForRef, { ...split(repo), ref: sha, filter: "latest", per_page: 100 }),
        github.paginate(github.repos.listCommitStatusesForRef, { ...split(repo), ref: sha, per_page: 100 }),
      ]);
      const ok = new Set(["success", "neutral", "skipped"]);
      const bad = checks.filter(check => check.head_sha !== sha || check.status !== "completed" || !ok.has(check.conclusion || ""));
      const statusesOk = statuses.length === 0 || effectiveCommitStatusesPass(statuses);
      const passed = checks.length > 0 && bad.length === 0 && statusesOk;
      const summary = checks.length === 0 ? "sin checks registrados" : bad.length ? `${bad.length} check(s) sin éxito: ${bad.slice(0, 3).map(check => check.name).join(", ")}` : statusesOk ? "todo en verde" : "un estado de commit no está en verde";
      return { passed, summary };
    },
    async merge(repo, prNumber, sha, title) {
      const github = await client();
      const method = ["merge", "squash", "rebase"].includes(process.env.KONG_MIRROR_MERGE_METHOD || "") ? process.env.KONG_MIRROR_MERGE_METHOD as "merge" | "squash" | "rebase" : "squash";
      // `sha` makes GitHub refuse the merge if the head moved after our checks.
      const result = (await github.pulls.merge({ ...split(repo), pull_number: prNumber, sha, merge_method: method, commit_title: `${title} (#${prNumber})`.slice(0, 250) })).data;
      return { merged: !!result.merged, sha: result.sha || null, message: result.message };
    },
    async comment(repo, prNumber, body) {
      const github = await client();
      await github.issues.createComment({ ...split(repo), issue_number: prNumber, body });
    },
  };
}

async function recordSpend(usd: number, meta: Record<string, unknown>) {
  const { recordAiApiCostEvent } = await import("./ai-cost-notifications");
  const { getGeminiChatModel } = await import("./gemini-client");
  await recordAiApiCostEvent({ userId: getSystemUserId(), provider: "gemini", model: getGeminiChatModel({ hasImage: false }), operation: "resumen Mirror Lab KONG", estimatedCostUsd: usd, metadata: meta });
}

export async function createMirrorSummarizerRuntime(store: MirrorStore) {
  const { estimateTokenApiCostUsd } = await import("./ai-cost-notifications");
  const { getGeminiChatModel } = await import("./gemini-client");
  const model = getGeminiChatModel({ hasImage: false });
  return createMirrorSummarizer({ owner: getSystemUserId(), store, now: Date.now, onSpend: recordSpend,
    estimateUsd: (inputTokens, outputTokens) => estimateTokenApiCostUsd({ provider: "gemini", model, inputTokens, outputTokens }),
    generate: async prompt => {
      const { getGeminiClient } = await import("./gemini-client");
      const client = await getGeminiClient();
      const result = await client.models.generateContent({ model, contents: [{ role: "user", parts: [{ text: prompt }] }], config: { maxOutputTokens: 350, temperature: 0.3 } });
      const usage = (result as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }).usageMetadata || {};
      return { text: result.text || "", inputTokens: usage.promptTokenCount, outputTokens: usage.candidatesTokenCount };
    } });
}

let runtime: Promise<{ lab: Lab; summarizer: Awaited<ReturnType<typeof createMirrorSummarizerRuntime>> }> | undefined;
function getRuntime() {
  return runtime ||= (async () => {
    const store = await (await import("./agent-council-store")).getCouncilStore();
    const summarizer = await createMirrorSummarizerRuntime(store);
    const lab = createKongMirrorLab({ owner: getSystemUserId(), store, now: Date.now, cards: createStorageMirrorCards(getSystemUserId()),
      github: createOctokitMirrorGithub(), summarize: report => summarizer.summarize(report) });
    return { lab, summarizer };
  })().catch(error => { runtime = undefined; throw error; });
}

/** Month-to-date spend of the Mirror Lab summary for /api/ai-spend/monthly. */
export async function readKongMirrorSummarySpend() {
  const spend = await (await getRuntime()).summarizer.monthSpend();
  return { id: "kong_mirror_summary", label: `Resumen Mirror Lab KONG (tope $${spend.capUsd})`, amountUsd: spend.spentUsd, count: spend.calls, kind: "estimated" as const };
}

export function registerKongMirrorRoutes(app: Express, options: { resolve?: () => Promise<Lab>; owner?: (req: Request) => boolean; secret?: () => string | undefined; sameOrigin?: (req: Request) => boolean } = {}) {
  const resolve = options.resolve || (async () => (await getRuntime()).lab);
  const owner = options.owner || ((req: Request) => { const id = getAuthenticatedCurrentUserId(req); return !!id && id === getSystemUserId(); });
  const secret = options.secret || (() => process.env.KONG_MIRROR_REPORT_HMAC_SECRET);
  const sameOrigin = options.sameOrigin || officeSameOrigin;
  const actor = (req: Request) => getAuthenticatedCurrentUserId(req) || "owner";

  app.post(KONG_MIRROR_REPORT_PATH, async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const raw = Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.isBuffer(req.body) ? req.body : undefined;
      const lab = await resolve();
      const result = await lab.receive(raw, req.get("x-kong-mirror-signature"), req.get("x-kong-mirror-timestamp"), secret());
      return res.status(result.duplicate ? 200 : 202).json(result);
    } catch (error) {
      if (error instanceof MirrorError) return res.status(error.status).json({ accepted: false, code: error.code, ...(error.code === "MIRROR_REPLAY" ? { alreadyRecorded: true } : {}) });
      return res.status(503).json({ accepted: false, code: "MIRROR_UNAVAILABLE" });
    }
  });

  app.get("/api/kong-mirror/reports", async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!owner(req)) return res.status(403).json({ code: "MIRROR_OWNER_REQUIRED" });
    try {
      const reports = await (await resolve()).list();
      return res.json({ reports, pendingCount: reports.filter(report => report.status === "carded" && ["pending", "edited", "snoozed"].includes(report.pendingStatus || "")).length });
    } catch { return res.status(503).json({ code: "MIRROR_UNAVAILABLE" }); }
  });

  app.get("/api/kong-mirror/images/:imageKey", async (req, res) => {
    if (!owner(req)) return res.status(403).end();
    try {
      const image = await (await resolve()).image(String(req.params.imageKey || ""));
      if (!image) return res.status(404).end();
      res.set({ "Content-Type": image.mime, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'" });
      return res.end(image.bytes);
    } catch { return res.status(503).end(); }
  });

  app.post("/api/kong-mirror/:key/:decision", async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!owner(req) || !sameOrigin(req)) return res.status(403).json({ code: "MIRROR_OWNER_REQUIRED", message: "Solo Robert puede decidir sobre esta mejora." });
    const key = String(req.params.key || "");
    if (!/^kong-mirror:[a-f0-9]{64}$/.test(key)) return res.status(404).json({ code: "MIRROR_NOT_FOUND" });
    try {
      const lab = await resolve();
      if (req.params.decision === "approve") {
        if (req.body?.confirm !== true) return res.status(400).json({ code: "MIRROR_CONFIRM_REQUIRED", message: "Confirma el merge con un segundo clic." });
        const result = await lab.approve(key, { actorId: actor(req), headSha: req.body?.headSha });
        return result.ok ? res.json(result) : res.status(result.status).json(result);
      }
      if (req.params.decision === "reject") {
        const result = await lab.reject(key, { actorId: actor(req), note: req.body?.note });
        return result.ok ? res.json(result) : res.status(result.status).json(result);
      }
      return res.status(404).json({ code: "MIRROR_NOT_FOUND" });
    } catch { return res.status(503).json({ code: "MIRROR_UNAVAILABLE", message: "No se pudo completar. No se fusionó nada." }); }
  });
}
