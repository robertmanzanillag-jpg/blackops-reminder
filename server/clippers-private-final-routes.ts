import express, { type Express, type Request } from 'express';
import { getAuthenticatedCurrentUserId, getSystemUserId } from './user-context';
import { STREAMER_STATE_NAMESPACE, parseStreamerStateStrict } from '../script/clippers-streamer-discovery.mjs';
import { reservePrivateFinal, putPrivateFinalChunk, finalizePrivateFinal, privateFinalStatus, assertPrivateFinalReady, streamPrivateFinalRange, cleanupPrivateFinals, CHUNK_BYTES } from '../script/clippers-private-final-store.mjs';

type Store = { read(key:string):Promise<string|null>; transact(key:string, fn:(raw:string|null)=>Promise<string>):Promise<string> };
type Dependencies = { store?:()=>Promise<Store>; principal?:(req:Request)=>string|null; owner?:()=>string; now?:()=>number };
const SHA = /^[a-f0-9]{64}$/, ID = /^[A-Za-z0-9_.:-]{1,160}$/;
/** Exact browser origin check for binary and media requests; the JSON-only office helper is unsuitable here. */
function sameOrigin(req:Request) {
  try {
    const expected = new URL(process.env.PUBLIC_APP_URL || `${req.protocol}://${req.get('host')}`).origin;
    const origin = req.get('origin'), referer = req.get('referer');
    if (req.get('sec-fetch-site') === 'cross-site') return false;
    if (origin) return new URL(origin).origin === expected;
    return !!referer && new URL(referer).origin === expected;
  } catch { return false; }
}
/** Bound a stalled client without releasing work that is still awaiting an actual stream read. */
export function waitForPrivatePreviewDrain(res:any,timeoutMs=20000):Promise<void>{
  return new Promise(resolve=>{let timer:ReturnType<typeof setTimeout>|undefined;let settled=false;
    const done=()=>{if(settled)return;settled=true;if(timer)clearTimeout(timer);res.off('drain',done);res.off('close',done);resolve();};
    res.once('drain',done);res.once('close',done);if(res.destroyed){done();return;}
    timer=setTimeout(()=>{res.destroy();done();},timeoutMs);timer.unref?.();
  });
}
export function registerPrivateFinalRoutes(app:Pick<Express,'get'|'post'>, deps:Dependencies = {}) {
  const store = deps.store ?? (async()=> (await import('./agent-council-store')).getCouncilStore());
  const principal = deps.principal ?? getAuthenticatedCurrentUserId, owner = deps.owner ?? getSystemUserId, now = deps.now ?? Date.now;
  const base = '/api/clippers/reviewed-derivatives/private-finals/:id';
  const activeTransfers=new Map<string,number>(),binaryTransfers=new WeakMap<Request,()=>void>();
  function admitTransfer(actor:string,res:any){
    const active=activeTransfers.get(actor)??0;
    if(active>=2){res.set('Retry-After','1');res.status(429).json({error:'derivative_private_transfer_busy'});return null;}
    activeTransfers.set(actor,active+1);let released=false;
    // The caller releases only after its work settles. A closed socket does not cancel an active DB/hash read.
    return()=>{if(released)return;released=true;const remaining=(activeTransfers.get(actor)??1)-1;if(remaining>0)activeTransfers.set(actor,remaining);else activeTransfers.delete(actor);};
  }
  function releaseBinary(req:Request){binaryTransfers.get(req)?.();binaryTransfers.delete(req);}

  function guard(req:Request,res:any) {
    res.set({ 'Cache-Control':'private, no-store, max-age=0', 'Cross-Origin-Resource-Policy':'same-origin', 'X-Content-Type-Options':'nosniff', 'X-Frame-Options':'DENY', Vary:'Cookie, Authorization, Origin' });
    let actor:string|null, configured:string;
    try { actor=principal(req); configured=owner(); } catch { res.status(503).json({error:'derivative_private_owner_unavailable'}); return null; }
    if (!actor) { res.status(401).json({error:'derivative_private_login_required'}); return null; }
    if (!configured || actor!==configured) { res.status(403).json({error:'derivative_private_owner_required'}); return null; }
    if (!sameOrigin(req)) { res.status(403).json({error:'derivative_private_same_origin_required'}); return null; }
    return actor;
  }
  async function recordFor(req:Request, actor:string, expectedDigest?:unknown, write=false) {
    const id = String(req.params.id ?? '');
    if (!ID.test(id) || ['__proto__','constructor','prototype'].includes(id) || (write && !SHA.test(String(expectedDigest ?? '')))) throw Error('derivative_private_request_invalid');
    const backend = await store();
    const state:any = parseStreamerStateStrict(await backend.read(STREAMER_STATE_NAMESPACE(actor)));
    const records = state?.reviewedDerivatives?.records;
    const record = records && Object.hasOwn(records,id) ? records[id] : null;
    if (!record || record.manifest?.media?.storageKind!=='private_council_v1' || (write && record.manifestSha256!==expectedDigest) || (write && !['proposed','approved'].includes(record.status))) throw Error('derivative_private_proposal_unavailable');
    return { backend, record };
  }
  function failure(res:any,error:unknown) { const message=error instanceof Error ? error.message : ''; res.status(409).json({error:/^(derivative_|private_final_)[a-z0-9_]+$/.test(message)?message:'derivative_private_operation_unavailable'}); }
  function digestBody(req:Request) {
    if (!req.is('application/json') || !req.body || Array.isArray(req.body) || Object.keys(req.body).join(',')!=='expectedDigest') throw Error('derivative_private_request_invalid');
    return req.body.expectedDigest;
  }
  for (const [route,operation] of [['reserve',reservePrivateFinal],['finalize',finalizePrivateFinal]] as const) app.post(`${base}/${route}`,async(req,res)=>{
    const actor=guard(req,res); if(!actor)return;const release=route==='finalize'?admitTransfer(actor,res):null;if(route==='finalize'&&!release)return;
    try { const {backend,record}=await recordFor(req,actor,digestBody(req),true); res.json(await operation({store:backend,owner:actor,record,now:now()})); } catch(error) { failure(res,error); }finally{release?.();}
  });
  const binary = express.raw({ type:'application/octet-stream', limit:CHUNK_BYTES });
  app.post(`${base}/chunks/:index`,(req,res,next)=>{const actor=guard(req,res);if(!actor)return;const release=admitTransfer(actor,res);if(release){binaryTransfers.set(req,release);next();}},(req,res,next)=>{
    if(!req.is('application/octet-stream')){releaseBinary(req);res.status(415).json({error:'derivative_private_binary_required'});return;}
    binary(req,res,error=>{if(error||res.destroyed){releaseBinary(req);if(!res.destroyed)res.status(413).json({error:'derivative_private_chunk_too_large'});return;}next();});
  },async(req,res)=>{
    // Recheck ownership after the bounded parser; only the stored owner proposal supplies a reference.
    try {
      const actor=guard(req,res);if(!actor)return;
      const rawIndex=String(req.params.index??''),digest=req.get('x-derivative-manifest-sha256'),sha256=req.get('x-chunk-sha256');
      if(!/^(0|[1-9]\d{0,2})$/.test(rawIndex)||!SHA.test(sha256??'')||!Buffer.isBuffer(req.body)||req.body.length<1||req.body.length>CHUNK_BYTES)throw Error('derivative_private_chunk_invalid');
      const {backend,record}=await recordFor(req,actor,digest,true);
      res.json(await putPrivateFinalChunk({store:backend,owner:actor,record,index:Number(rawIndex),bytes:req.body,sha256:sha256!,now:now()}));
    }catch(error){failure(res,error);}finally{releaseBinary(req);}
  });
  app.post(`${base}/cleanup`,async(req,res)=>{
    const actor=guard(req,res);if(!actor)return;
    try{
      const expectedDigest=digestBody(req);if(!SHA.test(String(expectedDigest??'')))throw Error('derivative_private_request_invalid');
      const {backend,record}=await recordFor(req,actor);if(record.manifestSha256!==expectedDigest)throw Error('derivative_private_proposal_unavailable');
      res.json(await cleanupPrivateFinals({store:backend,owner:actor,refs:[record.manifest.media.privateFinalRef],now:now()}));
    }catch(error){failure(res,error);}
  });
  app.get(`${base}/status`,async(req,res)=>{
    const actor=guard(req,res);if(!actor)return;
    try {const {backend,record}=await recordFor(req,actor);res.json(await privateFinalStatus({store:backend,owner:actor,record}));}catch(error){failure(res,error);}
  });
  app.get(`${base}/preview`,async(req,res)=>{
    const actor=guard(req,res);if(!actor)return;const release=req.method==='HEAD'?null:admitTransfer(actor,res);if(req.method!=='HEAD'&&!release)return;
    try {
      const {backend,record}=await recordFor(req,actor),status=await assertPrivateFinalReady({store:backend,owner:actor,record});
      const size=status.byteLength; let start=0,end=size-1; const range=req.get('range');
      if(range){
        const match=/^bytes=(\d*)-(\d*)$/.exec(range);
        if(!match||(!match[1]&&!match[2])){res.set('Content-Range',`bytes */${size}`);res.status(416).end();return;}
        if(!match[1]){const suffix=Number(match[2]);if(!Number.isSafeInteger(suffix)||suffix<=0){res.set('Content-Range',`bytes */${size}`);res.status(416).end();return;}start=Math.max(0,size-suffix);}
        else{start=Number(match[1]);if(match[2])end=Math.min(size-1,Number(match[2]));}
        if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start){res.set('Content-Range',`bytes */${size}`);res.status(416).end();return;}
      }
      res.set({ 'Content-Type':'video/mp4','Accept-Ranges':'bytes','Content-Length':String(end-start+1),'Content-Disposition':'inline','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'; sandbox" });
      if(range)res.status(206).set('Content-Range',`bytes ${start}-${end}/${size}`);
      if(req.method==='HEAD'){res.end();return;}
      for await(const bytes of streamPrivateFinalRange({store:backend,owner:actor,record,start,end})){
        if(res.destroyed)return;
        if(!res.write(bytes))await waitForPrivatePreviewDrain(res);
        if(res.destroyed)return;
      }
      res.end();
    }catch(error){if(res.headersSent){res.destroy();return;}failure(res,error);}finally{release?.();}
  });
}
