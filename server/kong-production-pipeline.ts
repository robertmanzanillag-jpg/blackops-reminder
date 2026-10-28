import { createHash } from "node:crypto";
import { mkdtemp, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { assetProblem, assetSchema, type Asset } from "./kong-autopilot-core";
import { discoverPexelsFootage, downloadFootage, type OnlineFootage } from "./kong-online-sources";
import { renderKongVideo, type RenderInput } from "./kong-cloud-renderer";
import { storeRenderedMedia } from "./kong-media-store";

type Rights = Asset["footageRights"];
export interface EditorialTask {
  plannedDay?: string;
  id: string; sourceIds: string[]; layout: RenderInput["layout"]; hook: string; reveal?: string;
  durationSeconds: number; title: string; caption: string; family: Asset["family"];
  footageRights: Rights; musicRights: Rights; facts?: Asset["facts"];
  authorizedForPublicDistribution: boolean;
}
export interface ProductionArtifact {
  outputPath: string; sha256: string; width: 1080; height: 1920; durationSeconds: number;
  sourceAudioDiscarded: true; logoSha256: string;
}
export interface ProductionReceipt { fileId: string; mediaUrl: string; sha256: string; verifiedAt: string; }
export interface ProductionJob {
  id: string; task: EditorialTask; sources: OnlineFootage[];
  stage: "queued" | "rendering" | "rendered" | "upload_intent" | "upload_uncertain" | "qa_pending" | "ready" | "blocked";
  artifact?: ProductionArtifact; receipt?: ProductionReceipt; error?: string; createdAt: string; updatedAt: string;
  renderAttempts?: number; nextRenderAttemptAt?: string;
}
export interface ProductionState {
  version: 1; sourceCursor: number; candidates: OnlineFootage[]; jobs: ProductionJob[]; assets: Asset[];
  errors: Array<{ at: string; jobId?: string; code: string }>;
}
export const emptyProductionState = (): ProductionState => ({ version: 1, sourceCursor: 0, candidates: [], jobs: [], assets: [], errors: [] });
export interface ProductionDependencies {
  save(state: ProductionState): Promise<void>;
  discover?(cursor: number, seenIds: string[]): Promise<{ candidates: OnlineFootage[]; nextCursor: number }>;
  render(job: ProductionJob): Promise<ProductionArtifact>;
  artifactExists?(artifact: ProductionArtifact): Promise<boolean>;
  upload(job: ProductionJob): Promise<ProductionReceipt>;
  /** Must look up existing hash/file receipt without creating or replacing remote objects.
   * null means unresolved, not proof that a timed-out write cannot still finish. */
  reconcileUpload?(job: ProductionJob): Promise<ProductionReceipt | null>;
  review?(job: ProductionJob): Promise<Asset["qa"] | null>;
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const https = (value: string) => { try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password; } catch { return false; } };
function rightsValid(rights: Rights, now: Date) {
  return rights && https(rights.evidenceUrl) && rights.confirmedBy?.trim() && Date.parse(rights.expiresAt) > +now;
}
function eligibility(job: ProductionJob, now: Date): string | undefined {
  const t = job.task;
  if (t.authorizedForPublicDistribution !== true) return "distribution_not_authorized";
  if (!rightsValid(t.footageRights, now) || !rightsValid(t.musicRights, now)) return "rights_missing_or_expired";
  if (!job.sources.length || job.sources.some(s => !s.rightsEvidence?.trim() || !https(s.sourceUrl)
    || !(Date.parse(s.rightsExpiresAt) > +now) || Date.parse(t.footageRights.expiresAt) > Date.parse(s.rightsExpiresAt))) return "source_evidence_missing_or_expired";
  if (new Set(t.sourceIds).size !== t.sourceIds.length || t.sourceIds.some(id => !job.sources.some(s => s.id === id))) return "invalid_source_selection";
  if (t.layout === "montage" ? job.sources.length < 3 || job.sources.length > 6 : job.sources.length !== 1) return "invalid_source_count";
  if (!Number.isFinite(t.durationSeconds) || t.durationSeconds < 3 || t.durationSeconds > 30) return "invalid_render_duration";
  const copy = `${t.title} ${t.hook} ${t.reveal || ""} ${t.caption}`;
  if (/\bfree\b|\bgratis\b/i.test(copy) || !t.caption.includes("https://kongnightlife.com")) return "invalid_editorial_copy";
  const needsFacts = ["lineup", "app", "tables", "guestlist", "yacht", "car"].includes(t.family)
    || /guestlist|complimentary|lineup|rent|table|yacht|car rental/i.test(copy);
  if (needsFacts && !t.facts) return "missing_claim_evidence";
  if (t.facts && (!https(t.facts.sourceUrl) || !(Date.parse(t.facts.validUntil) > +now)
    || !Number.isFinite(Date.parse(t.facts.verifiedAt)) || Date.parse(t.facts.verifiedAt) > +now
    || +now - Date.parse(t.facts.verifiedAt) > 86400_000)) return "stale_claim_evidence";
}
function validArtifact(a: ProductionArtifact) {
  return a && path.isAbsolute(a.outputPath) && /^[a-f0-9]{64}$/.test(a.sha256) && /^[a-f0-9]{64}$/.test(a.logoSha256)
    && a.width === 1080 && a.height === 1920 && a.sourceAudioDiscarded === true && a.durationSeconds >= 3 && a.durationSeconds <= 30.25;
}
function validReceipt(receipt: ProductionReceipt, job: ProductionJob) {
  return receipt?.fileId?.trim() && https(receipt.mediaUrl) && receipt.sha256 === job.artifact?.sha256 && Number.isFinite(Date.parse(receipt.verifiedAt));
}

/** Caller holds a durable exclusive lease for the whole cycle. The returned state is
 * committed incrementally: after any thrown save error reload durable state before retry.
 * No social-post mutation occurs here. Upload may make explicitly authorized media public
 * in storage; reviewed assets remain available when discovery fails. */
export async function runProductionCycle(initial: ProductionState, tasks: EditorialTask[], deps: ProductionDependencies,
  options: { now?: Date; maxJobs?: number; discover?: boolean } = {}): Promise<ProductionState> {
  const state = clone(initial), now = options.now || new Date();
  if (state.version !== 1 || !Array.isArray(state.jobs) || !Array.isArray(state.assets) || !Array.isArray(state.candidates)) throw Error("invalid_production_state");
  // This is only the discovery cache. Jobs keep immutable provenance snapshots.
  const cacheFresh = (source: OnlineFootage) => {
    const discovered = Date.parse(source.discoveredAt);
    return Number.isFinite(discovered) && discovered <= +now && +now - discovered <= 7 * 86400_000
      && Date.parse(source.rightsExpiresAt) > +now;
  };
  state.candidates = state.candidates.filter(cacheFresh);
  const budget = Math.min(5, Math.max(1, Math.floor(options.maxJobs || 2)));
  const save = () => deps.save(clone(state)); // Save errors intentionally abort before further provider calls.
  const error = (code: string, job?: ProductionJob) => {
    state.errors.push({ at: now.toISOString(), jobId: job?.id, code }); state.errors = state.errors.slice(-100);
    if (job) { job.error = code; job.updatedAt = now.toISOString(); }
  };
  if (deps.discover && options.discover !== false) {
    let found: Awaited<ReturnType<NonNullable<ProductionDependencies["discover"]>>> | undefined;
    const seenIds = [...new Set([...state.candidates.map(s => s.id), ...state.jobs.flatMap(j => j.sources.map(s => s.id))])];
    try { found = await deps.discover(state.sourceCursor, seenIds); }
    catch { error("source_discovery_failed"); }
    if (found) {
      if (!Number.isSafeInteger(found.nextCursor) || found.nextCursor < state.sourceCursor || !Array.isArray(found.candidates)) throw Error("invalid_discovery_result");
      for (const candidate of found.candidates) if (cacheFresh(candidate) && !state.candidates.some(s => s.id === candidate.id) && state.candidates.length < 500) state.candidates.push(clone(candidate));
      state.sourceCursor = found.nextCursor;
    }
    await save();
  }
  for (const task of tasks.slice(0, 100)) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(task.id)) { error("invalid_editorial_task_id"); continue; }
    const id = `production-${digest(task).slice(0, 40)}`;
    if (state.jobs.some(j => j.id === id)) continue;
    if (state.jobs.length >= 500) { error("production_archive_required"); break; }
    const sources = task.sourceIds.map(id => state.candidates.find(s => s.id === id)).filter(Boolean) as OnlineFootage[];
    const job: ProductionJob = { id, task: clone(task), sources: clone(sources), stage: "queued", createdAt: now.toISOString(), updatedAt: now.toISOString() };
    const reason = eligibility(job, now); if (reason) { job.stage = "blocked"; error(reason, job); }
    state.jobs.push(job);
  }
  await save();
  let count = 0;
  for (const job of [...state.jobs].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))) {
    if (["queued", "rendering", "rendered"].includes(job.stage) && job.nextRenderAttemptAt && Date.parse(job.nextRenderAttemptAt) > +now) continue;
    if (["ready", "blocked"].includes(job.stage) || (job.stage === "qa_pending" && !deps.review) || count++ >= budget) continue;
    job.updatedAt = now.toISOString();
    if (["upload_intent", "upload_uncertain"].includes(job.stage)) {
      let receipt: ProductionReceipt | null = null;
      try { receipt = await deps.reconcileUpload?.(clone(job)) || null; } catch { error("upload_reconciliation_failed", job); }
      if (receipt && validReceipt(receipt, job)) { job.receipt = receipt; job.stage = "qa_pending"; job.error = undefined; }
      else { job.stage = "upload_uncertain"; error("upload_outcome_unknown_no_retry", job); }
      await save();
      if (job.stage === "upload_uncertain") continue;
    }
    const reason = eligibility(job, now);
    if (reason) { job.stage = "blocked"; error(reason, job); await save(); continue; }
    if (["queued", "rendering", "rendered"].includes(job.stage)) {
      const exists = job.artifact && validArtifact(job.artifact) && await (deps.artifactExists || (async a => stat(a.outputPath).then(s => s.isFile(), () => false)))(job.artifact);
      if (!exists) {
        if ((job.renderAttempts || 0) >= 3) {
          job.stage = "blocked"; job.nextRenderAttemptAt = undefined; error("render_attempts_exhausted", job); await save(); continue;
        }
        job.renderAttempts = (job.renderAttempts || 0) + 1;
        job.stage = "rendering"; job.artifact = undefined; await save();
        let rendered: ProductionArtifact;
        try { rendered = await deps.render(clone(job)); if (!validArtifact(rendered) || Math.abs(rendered.durationSeconds - job.task.durationSeconds) > .25) throw Error("invalid_render_artifact"); }
        catch {
          const exhausted = job.renderAttempts >= 3;
          job.stage = exhausted ? "blocked" : "queued";
          job.nextRenderAttemptAt = exhausted ? undefined : new Date(+now + 15 * 60_000 * 2 ** (job.renderAttempts - 1)).toISOString();
          error(exhausted ? "render_attempts_exhausted" : "render_failed", job); await save(); continue;
        }
        job.artifact = rendered; job.stage = "rendered"; job.nextRenderAttemptAt = undefined; await save();
      }
      if (state.jobs.some(j => j.id !== job.id && j.artifact?.sha256 === job.artifact!.sha256 && ["upload_intent", "upload_uncertain", "qa_pending", "ready"].includes(j.stage))) {
        job.stage = "blocked"; error("duplicate_render_hash", job); await save(); continue;
      }
      job.stage = "upload_intent"; await save();
      let receipt: ProductionReceipt;
      try { receipt = await deps.upload(clone(job)); if (!validReceipt(receipt, job)) throw Error("invalid_upload_receipt"); }
      catch { job.stage = "upload_uncertain"; error("upload_outcome_unknown_no_retry", job); await save(); continue; }
      job.receipt = receipt; job.stage = "qa_pending"; job.error = undefined; await save();
    }
    if (job.stage === "qa_pending" && deps.review) {
      let qa: Asset["qa"] | null = null;
      try { qa = await deps.review(clone(job)); } catch { error("review_failed", job); }
      if (qa) {
        const candidate = { ...job.task, id: job.id, sourceUrl: job.sources[0].sourceUrl, mediaUrl: job.receipt!.mediaUrl,
          sha256: job.artifact!.sha256, width: 1080, height: 1920, qa };
        const parsed = assetSchema.safeParse(candidate);
        if (parsed.success && !assetProblem(parsed.data, now) && qa.renderedSha256 === job.receipt!.sha256) {
          if (!state.assets.some(a => a.sha256 === parsed.data.sha256)) state.assets.push(parsed.data);
          job.stage = "ready"; job.error = undefined;
        } else error("review_evidence_invalid", job);
      }
      await save();
    }
  }
  return state;
}

/** Actual cloud defaults: temp files are rebuildable intermediates; Drive and save
 * are durable. Callers must provision authorized soundtrack/font/official logo on server. */
export function createProductionAdapters(config: {
  apiKey?: string; soundtrack: RenderInput["soundtrack"]; logo: RenderInput["logo"]; fontPath: string;
  folderId: string; userId: string; approvedPublicOrigins: string[];
  save: ProductionDependencies["save"]; review?: ProductionDependencies["review"];
  reconcileUpload?: ProductionDependencies["reconcileUpload"];
}): ProductionDependencies {
  return { save: config.save, review: config.review, reconcileUpload: config.reconcileUpload,
    discover: (cursor, seenIds) => discoverPexelsFootage({ apiKey: config.apiKey, cursor, seenIds }),
    async render(job) {
      if (!config.soundtrack.rightsEvidence.includes(job.task.musicRights.evidenceUrl)) throw Error("soundtrack_evidence_mismatch");
      const dir = await mkdtemp(path.join(tmpdir(), "kong-production-"));
      const clips: RenderInput["clips"] = [];
      let complete = false;
      try {
      for (const [index, source] of job.sources.entries()) {
        const downloaded = await downloadFootage(source);
        const filename = path.join(dir, `source-${index}.mp4`); await writeFile(filename, downloaded.bytes, { flag: "wx", mode: 0o600 });
        clips.push({ path: filename, rightsEvidence: source.rightsEvidence, startSeconds: 0 });
      }
      const rendered = await renderKongVideo({ layout: job.task.layout, clips, soundtrack: config.soundtrack, logo: config.logo,
        fontPath: config.fontPath, hook: job.task.hook, reveal: job.task.reveal, durationSeconds: job.task.durationSeconds, outputPath: path.join(dir, "output.mp4") });
      complete = true;
      return { outputPath: rendered.outputPath, sha256: rendered.sha256, width: 1080, height: 1920,
        durationSeconds: rendered.technical.durationSeconds, logoSha256: rendered.logoSha256, sourceAudioDiscarded: rendered.sourceAudioDiscarded };
      } finally {
        if (!complete) await rm(dir, { recursive: true, force: true });
        else for (const clip of clips) await unlink(clip.path).catch(() => undefined);
      }
    },
    async upload(job) {
      if (!job.artifact || !validArtifact(job.artifact)) throw Error("missing_render_artifact");
      const receipt = await storeRenderedMedia({ filePath: job.artifact.outputPath, sha256: job.artifact.sha256, folderId: config.folderId,
        userId: config.userId, approvedPublicOrigins: config.approvedPublicOrigins, authorizedForPublicDistribution: job.task.authorizedForPublicDistribution });
      const directory = path.dirname(job.artifact.outputPath);
      if (path.dirname(directory) === tmpdir() && path.basename(directory).startsWith("kong-production-")) await rm(directory, { recursive: true, force: true });
      return receipt;
    },
  };
}
