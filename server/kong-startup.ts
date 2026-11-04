import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { assetSchema } from "./kong-autopilot-core";
import { intakeOwnerFootage } from "./kong-online-sources";
import { wrapRenderText } from "./kong-cloud-renderer";
import type { KongRuntimeOptions } from "./kong-cloud-autopilot";
import type { PublishedCreative } from "./kong-metricool-learning";
import type { createProductionAdapters } from "./kong-production-pipeline";

const absolute = z.string().min(1).refine(p => path.isAbsolute(p) && !/[\x00\r\n]/.test(p));
const origin = z.string().url().refine(p => { const u = new URL(p); return u.protocol === "https:" && u.origin === p && !u.username && !u.password; });
const configSchema = z.object({ version: z.literal(1),
  soundtrack: z.object({ path: absolute, rightsEvidence: z.string().min(1) }).strict(),
  logo: z.object({ path: absolute, approvedSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  fontPath: absolute, folderId: z.string().regex(/^[A-Za-z0-9_-]{10,160}$/), userId: z.string().trim().min(1),
  sourceOrigins: z.array(origin).min(1).max(20), sourcesPath: absolute, tasksPath: absolute, reviewsPath: absolute, publicationsPath:absolute.optional(),
}).strict();
const taskSchema = assetSchema.pick({ id:true, plannedDay:true, creativeTest:true, hook:true, title:true, caption:true,
  family:true, durationSeconds:true, footageRights:true, musicRights:true, facts:true }).extend({
  durationSeconds:z.number().min(3).max(30),
  sourceIds:z.array(z.string().min(1).max(200)).min(1).max(6), layout:z.enum(["pov","reveal","montage"]),
  reveal:z.string().min(1).max(180).optional(), authorizedForPublicDistribution:z.literal(true),
}).strict();
const tasksSchema = z.array(taskSchema).max(100);
const reviewsSchema = z.array(assetSchema.shape.qa.extend({reviewedBy:z.string().trim().min(1)})).max(2000);
export type KongStartupResult = { options: KongRuntimeOptions; blockers: string[] };
type AdapterFactory = typeof createProductionAdapters;

async function regularFile(filename:string, limit:number) {
  const info = await lstat(filename);
  if (!info.isFile() || info.size < 1 || info.size > limit) throw Error("invalid_operator_file");
}
async function jsonFile(filename:string) {
  await regularFile(filename, 2_000_000);
  return JSON.parse(await readFile(filename,"utf8")) as unknown;
}

/** Explicit operator-owned manifests only. No canned planner, credential mutations,
 * provider writes, or synthetic QA approval occur while building startup options. */
export async function loadKongStartup(env:Record<string,string|undefined>, deps:{
  adapterFactory?:AdapterFactory; now?:()=>Date;
} = {}):Promise<KongStartupResult> {
  const configPath = env.KONG_PRODUCTION_CONFIG_PATH;
  if (!configPath) return {options:{},blockers:["production_config_not_configured"]};
  if (!absolute.safeParse(configPath).success) return {options:{},blockers:["production_config_invalid"]};
  try {
    const config = configSchema.parse(await jsonFile(configPath));
    if (!env.KONG_OWNER_USER_ID || config.userId !== env.KONG_OWNER_USER_ID) throw Error("owner_mismatch");
    const approvedPublicOrigins = (env.KONG_MEDIA_ORIGINS || "").split(",").map(s=>s.trim()).filter(Boolean);
    if (!approvedPublicOrigins.length || approvedPublicOrigins.some(s=>!origin.safeParse(s).success)) throw Error("invalid_origins");
    await Promise.all([regularFile(config.soundtrack.path,100_000_000), regularFile(config.logo.path,10_000_000),regularFile(config.fontPath,20_000_000)]);
    const now=deps.now || (()=>new Date());
    const readSources=async()=>intakeOwnerFootage(await jsonFile(config.sourcesPath),config.sourceOrigins,now());
    const readTasks=async()=> {
      const tasks=tasksSchema.parse(await jsonFile(config.tasksPath));
      if(new Set(tasks.map(t=>t.id)).size !== tasks.length) throw Error("duplicate_task_id");
      for (const task of tasks) {
        if (new Set(task.sourceIds).size !== task.sourceIds.length
          || (task.layout === "montage" ? task.sourceIds.length < 3 || task.sourceIds.length > 6 : task.sourceIds.length !== 1)) throw Error("invalid_source_count");
        wrapRenderText(task.hook);
        if (task.layout === "reveal") wrapRenderText(task.reveal || "");
        const copy = `${task.title} ${task.hook} ${task.reveal || ""} ${task.caption}`;
        if (/\bfree\b|\bgratis\b/i.test(copy) || !task.caption.includes("https://kongnightlife.com")) throw Error("invalid_editorial_copy");
        if ((["lineup", "app", "tables", "guestlist", "yacht", "car"].includes(task.family)
          || /guestlist|complimentary|lineup|rent|table|yacht|car rental/i.test(copy)) && !task.facts) throw Error("missing_claim_evidence");
        if (!config.soundtrack.rightsEvidence.includes(task.musicRights.evidenceUrl)) throw Error("soundtrack_evidence_mismatch");
      }
      return tasks;
    };
    const readReviews=async()=> {
      const reviews=reviewsSchema.parse(await jsonFile(config.reviewsPath));
      if(new Set(reviews.map(r=>r.renderedSha256)).size !== reviews.length) throw Error("duplicate_review_hash");
      return reviews;
    };
    await Promise.all([readSources(),readTasks(),readReviews()]);
    const factory=deps.adapterFactory || (await import("./kong-production-pipeline")).createProductionAdapters;
    const adapters=factory({...config,approvedPublicOrigins,save:async()=>{throw Error("runtime_save_not_injected");},
      review:async job=> {
        if(!job.artifact || !job.receipt || job.artifact.sha256 !== job.receipt.sha256) return null;
        const review=(await readReviews()).find(r=>r.renderedSha256===job.artifact!.sha256);
        return review && Date.parse(review.reviewedAt)<=+now() ? review : null;
      }});
    const {save: _save,...dependencies}=adapters;
    // Operator sources are revalidated on each discovery pass. The pipeline
    // preserves provenance and checks source rights/fact freshness before use.
    dependencies.discover=async(cursor,seen)=>({candidates:(await readSources()).filter(s=>!seen.includes(s.id)),nextCursor:cursor});
    return {options:{production:{dependencies,tasks:async()=>readTasks()},
      ...(config.publicationsPath ? {publishedRegistry:async()=>jsonFile(config.publicationsPath!) as Promise<PublishedCreative[]>} : {})},blockers:[]};
  } catch {
    // Never leak config contents, filesystem paths, tokens, or provider errors.
    return {options:{},blockers:["production_config_invalid_or_unavailable"]};
  }
}
