// Explicit final-only runner. Never calls raw discovery, download, render, speech or LLM work.
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {cloudPublishConfig,createGithubReleaseStager} from './clippers-streamer-cloud-worker.mjs';
import {createPortfolioMetricool} from './clippers-portfolio-metricool.mjs';
import {STREAMER_STATE_NAMESPACE,parseStreamerStateStrict} from './clippers-streamer-discovery.mjs';

const real=value=>typeof value==='string'&&value.trim().length>0&&!/^(replace|paste|your-|<|changeme)/i.test(value.trim());
const safeReason=error=>/^(?:derivative|hour_window)_[a-z_]+$/.test(error?.message??'')?error.message:'hour_window_dependency_unavailable';
const loadStore=async()=> (await import('../server/agent-council-store.ts')).getCouncilStore();
const loadDue=async(state,options)=> (await import('../shared/clippers-reviewed-dispatch.mjs')).reviewedHourWindowDueRecords(state,options);
const worker=async options=> (await import('./clippers-reviewed-derivative-worker.mjs')).runReviewedDerivatives(options);
function unavailable(env,config){
 if(env.CLIPPERS_STREAMERS_CLOUD_ENABLED==='false'||env.CLIPPERS_REVIEWED_HOUR_WINDOW_ENABLED!=='true'||!config.enabled||config.killSwitch||config.dryRun)return 'hour_window_disabled';
 if(!real(env.DATABASE_URL)||!real(env.DEFAULT_USER_ID)||config.missing.length||!real(env.GITHUB_TOKEN)||!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.GITHUB_REPOSITORY??''))return 'hour_window_identity_unavailable';
 return null;
}
function maintenanceCount(state,owner){
 return Object.values(state.reviewedDerivatives?.records??{}).slice(0,500).filter(r=>{
  if(r?.proposedBy!==owner||!['approved','revoked'].includes(r.status))return false;
  const d=r.delivery;if(!d)return false;
  const known=!!(d.writeStartedAt&&/^[0-9]+$/.test(String(d.metricoolId??''))&&/^[A-Za-z0-9_-]{1,100}$/.test(d.metricoolUuid??''));
  if(known&&!d.copyVerifiedAt)return true;
  if(known&&d.copyVerifiedAt&&d.asset&&['scheduled','held_nonpublishing_draft'].includes(d.status))return true;
  return !d.writeStartedAt&&!!(d.asset||d.stageIntent||['pending_stage','cleanup_fenced'].includes(d.status));
 }).length;
}
// Owner-review backlog for the stall diagnosis: proposals by this owner still waiting for approval (count only).
function pendingReviewCount(state,owner){
 return Object.values(state.reviewedDerivatives?.records??{}).slice(0,500).filter(r=>r?.proposedBy===owner&&r.status==='proposed').length;
}
/** Read-only content check: existing council read performs SELECT, with no schema creation or provider clients. */
export async function reviewedHourWindowReadiness({env=process.env,store,getStore=loadStore,clock=Date.now,dueRecords=loadDue}={}){
 const config=cloudPublishConfig(env),reason=unavailable(env,config);
 if(reason)return {status:'held',dueCount:0,reason};
 try{
  const backend=store??await getStore(),raw=await backend.read(STREAMER_STATE_NAMESPACE(env.DEFAULT_USER_ID.trim())),state=raw?parseStreamerStateStrict(raw):null;
  if(!state)return {status:'held',dueCount:0,reason:'derivative_state_invalid'};
  const due=await dueRecords(state,{now:clock()});
  if(!Array.isArray(due)||due.length>500||due.some(id=>typeof id!=='string'||id.length>160))throw Error('hour_window_due_state_invalid');
  const maintenance=maintenanceCount(state,env.DEFAULT_USER_ID.trim());
  if(due.length||maintenance)return {status:due.length?'due':'maintenance',dueCount:due.length,maintenanceCount:maintenance};
  // Idle means this final-only lane publishes nothing (the raw publisher is replaced while the opt-in is on).
  const pending=pendingReviewCount(state,env.DEFAULT_USER_ID.trim());
  return {status:'idle',dueCount:0,maintenanceCount:0,pendingReviewCount:pending,stallReason:pending?'awaiting_owner_review':'no_reviewed_finals'};
 }catch(error){return {status:'held',dueCount:0,reason:safeReason(error)};}
}
/** Dependencies are injected in tests. Only the worker owns rights/slot/write fences. */
export async function runReviewedHourWindowCloud({env=process.env,store,getStore=loadStore,clock=Date.now,dueRecords=loadDue,createMetricool=createPortfolioMetricool,createStager=createGithubReleaseStager,runWorker=worker}={}){
 const config=cloudPublishConfig(env),reason=unavailable(env,config);
 if(reason)return {status:'held',dueCount:0,scheduled:0,reason};
 const backend=store??await getStore();
 const ready=await reviewedHourWindowReadiness({env,store:backend,clock,dueRecords});
 if(!['due','maintenance'].includes(ready.status))return {...ready,scheduled:0};
 const metricool=createMetricool({token:env.METRICOOL_USER_TOKEN.trim(),userId:env.METRICOOL_USER_ID.trim()});
 const stager=createStager({token:env.GITHUB_TOKEN,repo:env.GITHUB_REPOSITORY});
 const report=await runWorker({owner:env.DEFAULT_USER_ID.trim(),store:backend,metricool,stager,config,clock,dispatchMode:'owner_hour_window'});
 // Only counts/codes: public workflow logs never contain captions, media or private references.
 return {status:report.status,dueCount:ready.dueCount,maintenanceCount:ready.maintenanceCount,scheduled:report.scheduled??0,verificationPending:report.verificationPending??0,held:[...new Set((report.held??[]).map(reason=>safeReason({message:reason})))].slice(0,50)};
}
export async function reviewedHourWindowMain(args=process.argv.slice(2),options={}){
 if(args.length>1||args.some(arg=>arg!=='--due-check'))throw Error('hour_window_arguments_invalid');
 return args.includes('--due-check')?reviewedHourWindowReadiness(options):runReviewedHourWindowCloud(options);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 reviewedHourWindowMain().then(result=>{console.log(JSON.stringify(result));process.exit(0);}).catch(error=>{console.log(JSON.stringify({status:'held',dueCount:0,reason:safeReason(error)}));process.exit(1);});
}
