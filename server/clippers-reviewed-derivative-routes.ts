import type { Express, Request } from 'express';
import { randomBytes } from 'node:crypto';
import { getAuthenticatedCurrentUserId, getSystemUserId } from './user-context';
import { officeSameOrigin } from './office-routes';
import { STREAMER_STATE_NAMESPACE, parseStreamerStateStrict } from '../script/clippers-streamer-discovery.mjs';
import { validateReviewedDerivativeManifest, reviewedDerivativeDigest, approveReviewedDerivative, approvedNativeMediaUrl } from '../shared/clippers-reviewed-derivative.mjs';
import { validateDerivativeBaseline } from '../shared/clippers-derivative-baseline.mjs';
import { assertPrivateFinalReady, inspectPrivateFinalForApproval } from '../script/clippers-private-final-store.mjs';
import { registerPrivateFinalRoutes } from './clippers-private-final-routes';
import { reviewedDerivativeReviewHtml } from './clippers-reviewed-derivative-ui';

type Store = { read(key:string):Promise<string|null>; transact(key:string, fn:(raw:string|null)=>Promise<string>):Promise<string> };
export function registerReviewedDerivativeRoutes(app:Pick<Express,'get'|'post'>, deps:{store?:()=>Promise<Store>; principal?:(req:Request)=>string|null; owner?:()=>string; now?:()=>number; reconcile?:(record:any,post:any)=>Promise<any>; inspectPrivate?:(input:any)=>Promise<any>}={}) {
  const store=deps.store??(async()=> (await import('./agent-council-store')).getCouncilStore()), principal=deps.principal??getAuthenticatedCurrentUserId, owner=deps.owner??getSystemUserId, now=deps.now??Date.now;
  const privateInspections=new Set<string>();
  registerPrivateFinalRoutes(app,{store,principal,owner,now});
  function guard(req:Request,res:any,write=false) {
    res.set('Cache-Control','private, no-store, max-age=0');
    let actor:string|null;let configured:string;try{actor=principal(req);configured=owner();}catch{res.status(503).json({error:'DERIVATIVE_OWNER_UNAVAILABLE'});return null;} if(!actor){res.status(401).json({error:'DERIVATIVE_LOGIN_REQUIRED'});return null;}
    if(actor!==configured){res.status(403).json({error:'DERIVATIVE_OWNER_REQUIRED'});return null;}
    if(write&&!officeSameOrigin(req)){res.status(403).json({error:'DERIVATIVE_SAME_ORIGIN_REQUIRED'});return null;}
    return actor;
  }
  async function change(fn:(records:Record<string,any>,state:any)=>any){let result:any;
    await (await store()).transact(STREAMER_STATE_NAMESPACE(owner()),async raw=>{
      const s:any=parseStreamerStateStrict(raw);if(!s)throw Error('DERIVATIVE_STATE_INVALID');
      const control=s.reviewedDerivatives??{version:1,records:{}};
      if(control.version!==1||!control.records||typeof control.records!=='object'||Array.isArray(control.records))throw Error('DERIVATIVE_STATE_INVALID');
      result=fn(control.records,s);s.reviewedDerivatives=control;const saved=JSON.stringify(s);if(Buffer.byteLength(saved)>5*1024*1024)throw Error('derivative_registry_full');return saved;
    });return result;
  }
  app.get('/api/clippers/reviewed-derivatives/review',(req,res)=>{
    if(!guard(req,res))return;const nonce=randomBytes(20).toString('base64');res.set('Referrer-Policy','same-origin');
    res.set('Content-Security-Policy',`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; media-src 'self' blob: https://static.metricool.com; img-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`);
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
      const b=req.body??{};if(Object.keys(b).some(k=>!['id','expectedDigest','operatorLabel','attestRights','attestExternalQa','attestSourceBaseline','attestMembership'].includes(k))||b.attestRights!==true||b.attestExternalQa!==true||b.attestSourceBaseline!==true||b.attestMembership!==true)throw Error('derivative_owner_approval_required');
      const backend=await store();const state:any=parseStreamerStateStrict(await backend.read(STREAMER_STATE_NAMESPACE(actor)));
      const proposed=state?.reviewedDerivatives?.records&&Object.hasOwn(state.reviewedDerivatives.records,b.id)?state.reviewedDerivatives.records[b.id]:null;
      if(!proposed||proposed.manifestSha256!==b.expectedDigest)throw Error('derivative_proposal_missing');
      if(proposed.status!=='proposed')throw Error('derivative_owner_approval_required');
      let privateInspection:any;
      if(proposed.manifest?.media?.storageKind==='private_council_v1'){
        await assertPrivateFinalReady({store:backend,owner:actor,record:proposed});
        if(privateInspections.has(actor)){res.set('Retry-After','1');res.status(429).json({error:'derivative_private_inspection_busy'});return;}
        privateInspections.add(actor);
        try{
          privateInspection=await(deps.inspectPrivate??inspectPrivateFinalForApproval)({store:backend,owner:actor,record:proposed,now:now()});
          if(privateInspection?.origin!=='private_final_owner_technical_inspection'||privateInspection.manifestSha256!==proposed.manifestSha256||privateInspection.sha256!==proposed.manifest.media.sha256||privateInspection.byteLength!==proposed.manifest.media.byteLength||privateInspection.audioProfile!==proposed.manifest.media.audio||!Number.isFinite(Date.parse(privateInspection.checkedAt))||Date.parse(privateInspection.checkedAt)>now())throw Error('derivative_private_inspection_unverified');
        }finally{privateInspections.delete(actor);}
      }
      const record=await change(records=>{if(!Object.hasOwn(records,b.id))throw Error('derivative_proposal_missing');const r=records[b.id];validateDerivativeBaseline(r.manifest.baseline,r.manifest);
        const approved:any=approveReviewedDerivative(r,{principal:actor,operatorLabel:b.operatorLabel,now:now(),expectedDigest:b.expectedDigest,attestRights:b.attestRights,attestExternalQa:b.attestExternalQa});
        if(privateInspection)approved.privateFinalInspection=privateInspection;return records[b.id]=approved;});
      res.json(record);
    }catch(e){res.status(409).json({error:e instanceof Error&&/^(derivative_|private_final_)[a-z0-9_]+$/.test(e.message)?e.message:'derivative_approval_unavailable'});}
  });
  app.post('/api/clippers/reviewed-derivatives/reconcile',async(req,res)=>{
    const actor=guard(req,res,true);if(!actor)return;
    try{
      const b=req.body??{};if(Object.keys(b).some(k=>!['id','expectedDigest'].includes(k)))throw Error();
      const s:any=parseStreamerStateStrict(await(await store()).read(STREAMER_STATE_NAMESPACE(owner()))),r=s?.reviewedDerivatives?.records?.[b.id];
      if(!r||r.manifestSha256!==b.expectedDigest||!r.delivery?.writeStartedAt||!r.delivery.metricoolId||!r.delivery.metricoolUuid)throw Error();
      const p=s.cloudPublish?.posts?.find((p:any)=>p.id===r.delivery.id);if(!p)throw Error();
      const proof=deps.reconcile?await deps.reconcile(r,p):await(async()=>{const {createPortfolioMetricool}=await import('../script/clippers-portfolio-metricool.mjs');const adapter=createPortfolioMetricool({token:process.env.METRICOOL_USER_TOKEN??'',userId:process.env.METRICOOL_USER_ID??''});return adapter.reconcileReviewedDerivative(r.manifest.destination,{...p,requireUuid:true,metricoolId:r.delivery.metricoolId,metricoolUuid:r.delivery.metricoolUuid,thirdPartyCommercial:r.manifest.thirdPartyCommercial});})();
      if(!proof||!approvedNativeMediaUrl(proof.mediaUrl)||proof.id!==r.delivery.metricoolId||proof.uuid!==r.delivery.metricoolUuid||!['scheduled','nonpublishing_draft'].includes(proof.status)||(proof.status==='scheduled'&&r.manifest.thirdPartyCommercial===true&&proof.commercialDisclosureVerified!==true)||(proof.status==='nonpublishing_draft'&&proof.confirmedNonPublishingDraft!==true))throw Error();
      const updated=await change((records,state)=>{const current=records[b.id];if(current?.manifestSha256!==b.expectedDigest||current.delivery?.id!==r.delivery.id||current.delivery.metricoolUuid!==proof.uuid)throw Error();current.delivery={...current.delivery,status:proof.status==='scheduled'?'scheduled':'held_nonpublishing_draft',disclosureReconciledAt:new Date(now()).toISOString(),disclosureReconciledBy:actor,reason:null,confirmedMediaUrl:proof.mediaUrl,confirmedMediaSha256:current.manifest.media.sha256,confirmedByteLength:current.manifest.media.byteLength,copyVerifiedAt:new Date(now()).toISOString()};const post=state.cloudPublish?.posts?.find((p:any)=>p.id===r.delivery.id);if(!post)throw Error();Object.assign(post,{status:'scheduled',draft:proof.status==='nonpublishing_draft',confirmedMediaUrl:proof.mediaUrl,commercialDisclosureVerified:proof.commercialDisclosureVerified});current.reconciliationRequired=current.status==='revoked'&&proof.status==='scheduled';return current;});
      // The owner registry is the durable authority for no replay. Shared quota/source reservations stay conservative.
      res.json(updated);
    }catch{res.status(409).json({error:'derivative_provider_reconciliation_unverified'});}
  });
  app.post('/api/clippers/reviewed-derivatives/revoke',async(req,res)=>{
    const actor=guard(req,res,true);if(!actor)return;
    try{const b=req.body??{};if(Object.keys(b).some(k=>!['id','expectedDigest'].includes(k)))throw Error();
      const record=await change(records=>{const r=Object.hasOwn(records,b.id)?records[b.id]:null;if(!r||r.manifestSha256!==b.expectedDigest)throw Error();return records[b.id]={...r,status:'revoked',revokedAt:new Date(now()).toISOString(),revokedBy:actor,reconciliationRequired:!!r.delivery?.writeStartedAt,cancellationMonitorInstalled:false};});res.json(record);
    }catch{res.status(409).json({error:'derivative_revocation_conflict'});}
  });
}
