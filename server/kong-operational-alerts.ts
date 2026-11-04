import { createHash } from "node:crypto";
import type { State } from "./kong-autopilot-core";
import { dayInNewYork, dayPlus } from "./kong-autopilot-core";

export interface OperationalIssue { code:string; count?:number; day?:string; network?:string; }
export interface OperationalNotice { id:string; at:string; kind:"problem"|"recovered"; issues:OperationalIssue[]; message:string; }
export interface OperationalState { activeFingerprint:string|null; notices:Array<OperationalNotice & {
  delivery:"pending"|"sending"|"sent"|"failed"; attemptedAt?:string; deliveredAt?:string;
}>; }
export function operationalIssues(input:{state:State; startupBlockers:string[]; blockers:string[]; now:Date}):OperationalIssue[] {
  const issues:OperationalIssue[]=[];
  if(input.startupBlockers.length || input.blockers.length) issues.push({code:"configuration",count:input.startupBlockers.length+input.blockers.length});
  if(input.state.productionError || input.state.catalogError) issues.push({code:"production"});
  if(input.state.learningError || input.state.publicationRegistryError) issues.push({code:"learning"});
  const uncertain=input.state.jobs.filter(j=>["submitting","uncertain"].includes(j.state)).length;
  if(uncertain) issues.push({code:"publishing_uncertain",count:uncertain});
  const audit=input.state.calendarAudit;
  if(!audit || !audit.complete || Date.parse(audit.checkedAt)>+input.now || +input.now-Date.parse(audit.checkedAt)>=3600_000) {
    issues.push({code:"calendar_unverified"});
  } else {
    // Today's elapsed slots/public posts are absent from a future scheduler.
    // Inspect the next seven full local dates, not a partial current day.
    for(let offset=1;offset<=7;offset++) {
      const date=dayPlus(dayInNewYork(input.now),offset),day=audit.days.find(d=>d.day===date);
      if(!day){issues.push({code:"calendar_unverified",day:date});continue;}
      for(const network of ["tiktok","facebook"] as const) {
      const missing=day.networks[network].missing;
      if(missing===null) issues.push({code:"calendar_unverified",day:day.day,network});
      else if(missing>0) issues.push({code:"coverage",day:day.day,network,count:missing});
      }
    }
  }
  return issues;
}

/** Persist before notifications, deduplicate unchanged incidents, and retain
 * failed delivery as a visible problem. No provider-post mutation occurs here. */
export async function recordOperationalNotice(previous:OperationalState|undefined, issues:OperationalIssue[], now:Date, deps:{
  save(state:OperationalState):Promise<void>;
  notify?:(notice:OperationalNotice)=>Promise<boolean>;
  notificationTimeoutMs?:number;
}):Promise<OperationalState> {
  const state:OperationalState=previous?structuredClone(previous):{activeFingerprint:null,notices:[]};
  const fingerprint=issues.length?createHash("sha256").update(JSON.stringify(issues)).digest("hex"):null;
  if(fingerprint!==state.activeFingerprint) {
    const kind=fingerprint?"problem":"recovered";
    if(fingerprint || state.activeFingerprint) {
      const missing=issues.filter(i=>i.code==="coverage").reduce((n,i)=>n+(i.count||0),0);
      const detail=issues.some(i=>i.code==="cycle_failed")?"falló la ejecución del agente":
        issues.some(i=>i.code==="calendar_unverified")?"la cobertura no se pudo verificar":
        missing>0?`${missing} videos faltantes en los próximos siete días completos`:"revisar configuración, producción o medición";
      state.notices.push({id:createHash("sha256").update(`${now.toISOString()}:${fingerprint||"recovered"}`).digest("hex"),at:now.toISOString(),kind,issues,
        message:kind==="recovered"?"KONG: se resolvieron las incidencias de configuración y cobertura revisadas.":`KONG necesita atención: ${detail}. Revisa la cola y el estado del agente.`,delivery:"pending"});
      state.notices=state.notices.slice(-100);
    }
    state.activeFingerprint=fingerprint;
    await deps.save(structuredClone(state));
  }
  const notice=state.notices.at(-1);
  if(!notice || !deps.notify || notice.delivery==="sent") return state;
  // A crash/lost response may have sent a notification; the same stable tag is
  // reused, and retries are bounded to once per six hours, never each cycle.
  if(notice.attemptedAt && +now-Date.parse(notice.attemptedAt)<6*3600_000) return state;
  notice.delivery="sending";notice.attemptedAt=now.toISOString();await deps.save(structuredClone(state));
  let sent=false,timer:ReturnType<typeof setTimeout>|undefined;
  try{sent=await Promise.race([deps.notify(notice),new Promise<boolean>(resolve=>{
    timer=setTimeout(()=>resolve(false),deps.notificationTimeoutMs??20_000);
  })]);}catch{ /* Persist sanitized failure only. */ }finally{if(timer)clearTimeout(timer);}
  notice.delivery=sent?"sent":"failed";
  if(sent) notice.deliveredAt=now.toISOString();
  await deps.save(structuredClone(state));
  return state;
}
