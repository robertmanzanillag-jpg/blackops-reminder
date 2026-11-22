import type { Express, Request } from 'express';
import { randomBytes } from 'node:crypto';
import { getAuthenticatedCurrentUserId, getSystemUserId } from './user-context';
import { officeSameOrigin } from './office-routes';
import { STREAMER_STATE_NAMESPACE, parseStreamerStateStrict } from '../script/clippers-streamer-discovery.mjs';
import { validateReviewedDerivativeManifest, reviewedDerivativeDigest, approveReviewedDerivative } from '../shared/clippers-reviewed-derivative.mjs';
import { validateDerivativeBaseline } from '../shared/clippers-derivative-baseline.mjs';
import { reviewedDerivativeReviewHtml } from './clippers-reviewed-derivative-ui';

type Store = { read(key:string):Promise<string|null>; transact(key:string, fn:(raw:string|null)=>Promise<string>):Promise<string> };
export function registerReviewedDerivativeRoutes(app:Pick<Express,'get'|'post'>, deps:{store?:()=>Promise<Store>; principal?:(req:Request)=>string|null; owner?:()=>string; now?:()=>number}={}) {
  const store=deps.store??(async()=> (await import('./agent-council-store')).getCouncilStore()), principal=deps.principal??getAuthenticatedCurrentUserId, owner=deps.owner??getSystemUserId, now=deps.now??Date.now;
  function guard(req:Request,res:any,write=false) {
    res.set('Cache-Control','private, no-store, max-age=0');
    let actor:string|null;let configured:string;try{actor=principal(req);configured=owner();}catch{res.status(503).json({error:'DERIVATIVE_OWNER_UNAVAILABLE'});return null;} if(!actor){res.status(401).json({error:'DERIVATIVE_LOGIN_REQUIRED'});return null;}
    if(actor!==configured){res.status(403).json({error:'DERIVATIVE_OWNER_REQUIRED'});return null;}
    if(write&&!officeSameOrigin(req)){res.status(403).json({error:'DERIVATIVE_SAME_ORIGIN_REQUIRED'});return null;}
    return actor;
  }
  async function change(fn:(records:Record<string,any>)=>any){let result:any;
    await (await store()).transact(STREAMER_STATE_NAMESPACE(owner()),async raw=>{
      const s:any=parseStreamerStateStrict(raw);if(!s)throw Error('DERIVATIVE_STATE_INVALID');
      const control=s.reviewedDerivatives??{version:1,records:{}};
      if(control.version!==1||!control.records||typeof control.records!=='object'||Array.isArray(control.records))throw Error('DERIVATIVE_STATE_INVALID');
      result=fn(control.records);s.reviewedDerivatives=control;const saved=JSON.stringify(s);if(Buffer.byteLength(saved)>5*1024*1024)throw Error('derivative_registry_full');return saved;
    });return result;
  }
  app.get('/api/clippers/reviewed-derivatives/review',(req,res)=>{
    if(!guard(req,res))return;const nonce=randomBytes(20).toString('base64');
    res.set('Content-Security-Policy',`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; media-src https://static.metricool.com; img-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`);
    res.type('html').send(reviewedDerivativeReviewHtml(nonce));
  });
  app.get('/api/clippers/reviewed-derivatives',async(req,res)=>{
    if(!guard(req,res))return;
    try{const s:any=parseStreamerStateStrict(await(await store()).read(STREAMER_STATE_NAMESPACE(owner())));if(!s)throw Error();res.json({records:Object.values(s.reviewedDerivatives?.records??{}),publishingEnabled:process.env.CLIPPERS_STREAMER_CLOUD_PUBLISH_ENABLED==='true'});}
    catch{res.status(503).json({error:'DERIVATIVE_STATE_UNAVAILABLE'});}
  });
  app.post('/api/clippers/reviewed-derivatives/propose',async(req,res)=>{
    const actor=guard(req,res,true);if(!actor)return;
    try{
      if(!req.body||Object.keys(req.body).join(',')!=='manifest'||JSON.stringify(req.body).length>256000)throw Error('derivative_proposal_invalid');
      const m=req.body.manifest;validateReviewedDerivativeManifest(m,now());validateDerivativeBaseline(m.baseline,m);
      if(['__proto__','prototype','constructor'].includes(m.id))throw Error('derivative_proposal_invalid');
      const digest=reviewedDerivativeDigest(m);
      const record=await change(records=>{if(Object.hasOwn(records,m.id))throw Error('derivative_proposal_exists');if(Object.keys(records).length>=500)throw Error('derivative_registry_full');
        const r={status:'proposed',manifest:structuredClone(m),manifestSha256:digest,proposedAt:new Date(now()).toISOString(),proposedBy:actor};records[m.id]=r;return r;});
      res.status(201).json(record);
    }catch(e){res.status(400).json({error:e instanceof Error&&/^derivative_/.test(e.message)?e.message:'derivative_proposal_unavailable'});}
  });
  app.post('/api/clippers/reviewed-derivatives/approve',async(req,res)=>{
    const actor=guard(req,res,true);if(!actor)return;
    try{
      const b=req.body??{};if(Object.keys(b).some(k=>!['id','expectedDigest','operatorLabel','attestRights','attestExternalQa','attestSourceBaseline','attestMembership'].includes(k))||b.attestSourceBaseline!==true||b.attestMembership!==true)throw Error('derivative_owner_approval_required');
      const record=await change(records=>{if(!Object.hasOwn(records,b.id))throw Error('derivative_proposal_missing');const r=records[b.id];validateDerivativeBaseline(r.manifest.baseline,r.manifest);
        return records[b.id]=approveReviewedDerivative(r,{principal:actor,operatorLabel:b.operatorLabel,now:now(),expectedDigest:b.expectedDigest,attestRights:b.attestRights,attestExternalQa:b.attestExternalQa});});
      res.json(record);
    }catch(e){res.status(409).json({error:e instanceof Error&&/^derivative_/.test(e.message)?e.message:'derivative_approval_unavailable'});}
  });
  app.post('/api/clippers/reviewed-derivatives/revoke',async(req,res)=>{
    const actor=guard(req,res,true);if(!actor)return;
    try{const b=req.body??{};if(Object.keys(b).some(k=>!['id','expectedDigest'].includes(k)))throw Error();
      const record=await change(records=>{const r=Object.hasOwn(records,b.id)?records[b.id]:null;if(!r||r.manifestSha256!==b.expectedDigest)throw Error();return records[b.id]={...r,status:'revoked',revokedAt:new Date(now()).toISOString(),revokedBy:actor,reconciliationRequired:!!r.delivery?.writeStartedAt,cancellationMonitorInstalled:false};});res.json(record);
    }catch{res.status(409).json({error:'derivative_revocation_conflict'});}
  });
}
