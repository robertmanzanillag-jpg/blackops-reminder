import {readMarketingLearning} from "./marketing-learning-store";
import {withConnectionRetry} from "./office-source-pool";
import {auditWebRoleSource,readWebRoleSources,type SourcePool,type WebRoleSource,type WebSourceRole} from "./office-web-role-sources";
import {readStoredWebRoleSource} from "./office-web-role-store";

/** Roles with at least one canonical source that lives in the shared database
 * (marketing learning in revenue_engine_state, blackroom_remote_control). The
 * office worker can observe these itself, so it never needs the private,
 * autoscaled web host to be awake. marketing-cmo still needs the host's
 * social-metrics file: observed from the database alone it stays blocked with
 * SOURCE_MISSING, but its learning evidence is current and honest. */
export const DATABASE_WEB_SOURCE_ROLES=["blackroom-videos","marketing-cmo"] as const satisfies readonly WebSourceRole[];
/** A stored host export is preferred only while it can still pass the audit at
 * completion time (exports expire after five minutes; keep a lease margin). */
export const STORED_EXPORT_PREFERRED_MAX_AGE_MS=240000;

function preferStored(source:WebRoleSource|null,owner:string,at:number):source is WebRoleSource {
 if(!source)return false;
 try{auditWebRoleSource(source,owner,at);}catch{return false;}
 return at-Date.parse(source.observedAt)<=STORED_EXPORT_PREFERRED_MAX_AGE_MS;
}

/** Worker-side source for one web role. Order:
 * 1. a fresh export persisted by the web host (full file + database coverage);
 * 2. for database-backed roles, a database-only observation made now by this
 *    worker: same projection, provenance, digests and validation as the host,
 *    with file-backed parts explicitly missing; never persisted, so it cannot
 *    overwrite the host's richer export;
 * 3. otherwise the stored export unchanged (the audit then rejects it as stale)
 *    or null, exactly as before. */
export async function readWorkerWebRoleSource(options:{pool:SourcePool;owner:string;configuredOwner:string;role:WebSourceRole;now?:()=>number}):Promise<WebRoleSource|null> {
 const now=options.now ?? Date.now;
 let stored:WebRoleSource|null=null,storedError:unknown,storedFailed=false;
 try{stored=await readStoredWebRoleSource(options.pool,options.owner,options.configuredOwner,options.role);}catch(error){storedFailed=true;storedError=error;}
 if(!storedFailed && preferStored(stored,options.owner,now()))return stored;
 if((DATABASE_WEB_SOURCE_ROLES as readonly WebSourceRole[]).includes(options.role)){
  const pool=withConnectionRetry(options.pool);
  const sources=await readWebRoleSources({pool,owner:options.owner,configuredOwner:options.configuredOwner,root:"/",files:false,now:now(),marketingLearning:()=>readMarketingLearning(pool,options.owner)});
  const live=sources.find(source=>source.role===options.role);
  if(!live)throw new Error("Web source role missing");
  return live;
 }
 if(storedFailed)throw storedError;
 return stored;
}
