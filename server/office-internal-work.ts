import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { createAgentCouncil } from "./agent-council";
import { reserveRoleExecution, completeRoleExecution } from "../shared/office-role-lifecycle";
import { advanceCompany } from "../shared/agent-company";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const item = z.object({ id:z.string().min(1).max(200), title:z.string().max(500), scheduledAt:z.string().max(40).nullable(), priority:z.string().max(40), kind:z.string().max(80) }).strict();
const snapshotSchema = z.object({ ownerKey:z.string().regex(/^[a-f0-9]{64}$/), observedAt:z.string().datetime(), tasks:z.array(item).max(200), approvals:z.array(item).max(200), taskTotal:z.number().int().nonnegative(),approvalTotal:z.number().int().nonnegative() }).strict().refine(s=>Math.min(s.taskTotal,200)===s.tasks.length && Math.min(s.approvalTotal,200)===s.approvals.length);
export type InternalWorkSnapshot = z.infer<typeof snapshotSchema>;
const artifactSchema = z.object({ version:z.literal("internal-planning-v1"), role:z.enum(["ceo","assistant"]), snapshot:snapshotSchema,
  text:z.string().max(400000), sourceHash:z.string().regex(/^[a-f0-9]{64}$/), includedIds:z.array(z.string()).max(400),
  evaluation:z.object({ selectedRecordCoverage:z.literal(1), inventedItems:z.literal(0), mode:z.literal("deterministic-contract") }).strict() }).strict();
const jobSchema = z.object({ id:z.string().uuid(), role:z.enum(["ceo","assistant"]), slot:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fence:z.string().uuid(), policyVersion:z.string().min(1), generation:z.number().int().positive(), startedAt:z.string().datetime(), expiresAt:z.string().datetime(),
  status:z.enum(["running","completed","blocked","unknown"]), completedAt:z.string().datetime().optional(), reason:z.string().max(100).optional(),
  artifact:artifactSchema.optional(), artifactId:z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict();
export type InternalWorkJob = z.infer<typeof jobSchema>;
export type InternalWorkState = { version:1; jobs:InternalWorkJob[] };
export function parseInternalWork(value:unknown):InternalWorkState {
  if(value === undefined) return {version:1,jobs:[]};
  const state=z.object({version:z.literal(1),jobs:z.array(jobSchema).max(100)}).strict().parse(value);
  for(const job of state.jobs) {
    if(Date.parse(job.expiresAt)<=Date.parse(job.startedAt) || (job.status === "completed" && (!job.artifact || job.artifactId !== digest(job.artifact)))) throw new Error("Invalid internal work evidence");
    if(job.artifact && (job.artifact.role !== job.role || digest(job.artifact) !== digest(prepareInternalArtifact(job.role,job.artifact.snapshot)))) throw new Error("Invalid internal work source");
  }
  if(new Set(state.jobs.map(j=>j.id)).size !== state.jobs.length || new Set(state.jobs.map(j=>`${j.role}:${j.slot}`)).size !== state.jobs.length) throw new Error("Duplicate internal work assignment");
  return state;
}

/** Exact saved records, without invented recurrence, live-sync, approval or sending claims. */
export function prepareInternalArtifact(role:"ceo"|"assistant", raw:InternalWorkSnapshot) {
  const snapshot=snapshotSchema.parse(raw);
  const records=role === "ceo" ? [...snapshot.tasks,...snapshot.approvals] : snapshot.tasks;
  const ids=records.map(row=>row.id);
  if(new Set(ids).size !== ids.length) throw new Error("Duplicate source record");
  const clean=(value:string)=>value.replace(/[\r\n\u0000-\u001f<>]/g," ");
  const text=[role === "ceo" ? "Resumen interno de tareas y aprobaciones pendientes" : "Agenda de tareas guardadas",
    "Fuente: registros guardados; no confirma sincronización actual. Fechas sin zona conservadas exactamente; no se expanden recurrencias.",
    "Aprobaciones: estados guardados, no autorización ni confirmación de vigencia; pueden estar aplazadas o vencidas.",
    `Selección acotada: ${snapshot.tasks.length}/${snapshot.taskTotal} tareas${role === "ceo" ? ` y ${snapshot.approvals.length}/${snapshot.approvalTotal} aprobaciones` : ""}. No representa todo el trabajo si faltan registros. Títulos limitados a 500 caracteres.`,
    ...records.map(row=>`[${clean(row.id)}] ${clean(row.title)} | ${row.scheduledAt || "sin fecha"} | ${clean(row.priority)} | ${clean(row.kind)}`),
    records.length ? "No se ha enviado, aprobado ni modificado ninguna acción." : "No hay registros pendientes en la consulta verificada."].join("\n");
  return artifactSchema.parse({version:"internal-planning-v1",role,snapshot,text,sourceHash:digest(snapshot),includedIds:ids,
    evaluation:{selectedRecordCoverage:1,inventedItems:0,mode:"deterministic-contract"}});
}

/** Dedicated SQL snapshot: no storage fallback, global user counts, profile secrets or network connectors. */
export async function readInternalWorkSnapshot(pool:{connect:()=>Promise<{query:(sql:string,args?:unknown[])=>Promise<{rows:any[]}>;release:()=>void}>}, owner:string):Promise<InternalWorkSnapshot> {
  if(!owner.trim()) throw new Error("Owner required");
  const client=await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout = '10000ms'");
    const identity=await client.query("SELECT id FROM users WHERE id=$1",[owner]);
    if(identity.rows.length !== 1 || identity.rows[0].id !== owner) throw new Error("Canonical owner absent");
    const tasks=await client.query(`SELECT id, left(title,500) AS title, to_char(date,'YYYY-MM-DD"T"HH24:MI:SS') AS "scheduledAt", left(priority,40) AS priority, left(type,80) AS kind, count(*) OVER() AS total FROM tasks WHERE user_id=$1 AND completed=false ORDER BY CASE WHEN priority='high' THEN 0 ELSE 1 END,date,id LIMIT 200`,[owner]);
    const approvals=await client.query(`SELECT id, left(title,500) AS title, NULL AS "scheduledAt", left(risk_level,40) AS priority, left(action_type,80) AS kind, count(*) OVER() AS total FROM pending_actions WHERE user_id=$1 AND status IN ('pending','draft','edited') ORDER BY created_at,id LIMIT 200`,[owner]);
    const clock=await client.query("SELECT clock_timestamp() AS observed");
    const project=(rows:any[])=>rows.map(({total,...row})=>row);
    const snapshot=snapshotSchema.parse({ownerKey:digest(owner),observedAt:new Date(clock.rows[0].observed).toISOString(),tasks:project(tasks.rows),approvals:project(approvals.rows),taskTotal:Number(tasks.rows[0]?.total ?? 0),approvalTotal:Number(approvals.rows[0]?.total ?? 0)});
    await client.query("COMMIT"); return snapshot;
  } catch(error) {await client.query("ROLLBACK").catch(()=>{});throw error;} finally {client.release();}
}

export function createInternalWorkRunner(options:{council:Pick<ReturnType<typeof createAgentCouncil>,"updateOfficeExecution">;owner:string;read:()=>Promise<InternalWorkSnapshot>;now?:()=>number;shouldStop?:()=>boolean}) {
  const now=options.now || Date.now;
  return { async tick() {
    for(const role of ["ceo","assistant"] as const) {
      if(options.shouldStop?.()) break;
      const start=now(),slot=new Date(start).toISOString().slice(0,10),id=randomUUID(),fence=randomUUID(); let assignment:InternalWorkJob|undefined;
      await options.council.updateOfficeExecution(state=>{
        assignment=undefined; const work=parseInternalWork(state.internalWork);
        const jobs=work.jobs.map(j=>j.status === "running" && Date.parse(j.expiresAt)<=start ? {...j,status:"unknown" as const,reason:"Interrupted; reconcile before retry"}:j);
        if(jobs.some(j=>j.role === role && (j.slot === slot || ["running","unknown"].includes(j.status)))) return {...state,internalWork:{version:1,jobs}};
        const active=state.roles.roles[role]?.activePolicy;
        if(!active || active.candidateId !== "baseline") return state; // No unimplemented trained policy may masquerade as this formatter.
        const reserved=reserveRoleExecution(state.roles,{roleId:role,policyVersion:active.version,executionId:id,fence,now:start,ttlMs:60000});
        if(!reserved.lease) return state;
        assignment={id,role,slot,fence,policyVersion:active.version,generation:active.generation,startedAt:new Date(start).toISOString(),expiresAt:new Date(start+60000).toISOString(),status:"running"};
        const retained=[...jobs.filter(j=>["running","unknown"].includes(j.status)),...jobs.filter(j=>!["running","unknown"].includes(j.status)).slice(-25)];
        return {...state,roles:reserved.state,internalWork:{version:1,jobs:[...retained,assignment]}};
      });
      if(!assignment) continue;
      const job:InternalWorkJob=assignment; let artifact:ReturnType<typeof prepareInternalArtifact>|undefined;
      try {
        const source=await options.read(); if(source.ownerKey !== digest(options.owner) || Date.parse(source.observedAt)<start-30000 || Date.parse(source.observedAt)>now()+30000) throw new Error("Source mismatch");
        artifact=prepareInternalArtifact(role,source);
      } catch { /* Source failure is not agent misconduct. Persist blocked evidence, never fabricated success. */ }
      await options.council.updateOfficeExecution((state,company)=>{
        const work=parseInternalWork(state.internalWork),stored=work.jobs.find(j=>j.id === job.id);
        if(!stored || stored.status !== "running" || stored.fence !== job.fence) throw new Error("Internal assignment lost");
        const end=now(),artifactId=artifact ? digest(artifact):digest({id:job.id,reason:"canonical_source_unavailable"});
        const result=completeRoleExecution(state.roles,{roleId:role,executionId:job.id,fence:job.fence,policyVersion:job.policyVersion,now:end,artifactId,success:!!artifact});
        const completed:InternalWorkJob=result.accepted ? {...job,status:artifact?"completed":"blocked",completedAt:new Date(end).toISOString(),...(artifact?{artifact,artifactId}:{reason:"canonical_source_unavailable"})} : {...job,status:"unknown",reason:"Lease or generation changed; reconcile"};
        if(result.accepted && artifact) Object.assign(company,advanceCompany(company,{now:end,roles:{[role]:role},statuses:{[role]:{state:"working",label:"Verified internal preparation",evidenceId:job.id}}}).state);
        return {...state,roles:result.state,internalWork:{version:1,jobs:work.jobs.map(j=>j.id === job.id?completed:j)}};
      });
    }
  }};
}
