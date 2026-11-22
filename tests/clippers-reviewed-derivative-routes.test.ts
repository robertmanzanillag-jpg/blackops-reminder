import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { registerReviewedDerivativeRoutes } from '../server/clippers-reviewed-derivative-routes';
import { derivativeFixture, DERIVATIVE_NOW as NOW } from './helpers/reviewed-derivative-fixture.mjs';
import { runReviewedDerivatives } from '../script/clippers-reviewed-derivative-worker.mjs';
import { emptyStreamerState } from '../script/clippers-streamer-discovery.mjs';
import playwright from 'playwright';
const {chromium}=playwright;

async function fixture(reconcile?:any){let raw=JSON.stringify(emptyStreamerState());let clock=NOW;const app=express();app.use(express.json({limit:'300kb'}));
 const memoryStore={read:async()=>raw,transact:async(_key:string,fn:(raw:string)=>Promise<string>)=>raw=await fn(raw)};
 registerReviewedDerivativeRoutes(app,{principal:req=>typeof req.headers['x-fixture-auth']==='string'?req.headers['x-fixture-auth']:null,owner:()=> 'fixture-owner',now:()=>clock,reconcile,store:async()=>memoryStore});
 app.get('/favicon.ico',(_req,res)=>res.status(204).end());
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const address=server.address() as any,origin=`http://127.0.0.1:${address.port}`,base=origin+'/api/clippers/reviewed-derivatives';
 const manifest:any=derivativeFixture().manifest;manifest.baseline={fromDay:'2026-11-20',throughDay:'2026-11-24',sourceOriginAt:'2026-11-21T10:00:00Z',originEvidenceReference:'fixture-only:vod-start',originEvidenceSha256:'a'.repeat(64),rows:[]};
 async function request(path='',body?:any,actor='fixture-owner',requestOrigin=origin){return fetch(base+path,{method:body?'POST':'GET',headers:{'x-fixture-auth':actor,'content-type':'application/json',origin:requestOrigin},...(body?{body:JSON.stringify(body)}:{})});}
 return{manifest,origin,base,request,store:memoryStore,raw:()=>raw,setClock:(n:number)=>clock=n,close:()=>new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()))};}
test('real HTTP authenticated owner propose/approve/revoke refuses anonymous, other user, CSRF, self-approval and replay',async()=>{
 const f=await fixture();try{
 assert.equal((await f.request('',undefined,'')).status,401);assert.equal((await f.request('',undefined,'other')).status,403);
 assert.equal((await f.request('/propose',{manifest:f.manifest},'fixture-owner','https://evil.example')).status,403);
 assert.equal((await f.request('/propose',{manifest:f.manifest,approval:{principal:'fixture-owner'}})).status,400);
 const proposed=await f.request('/propose',{manifest:f.manifest});assert.equal(proposed.status,201);const record=await proposed.json() as any;assert.equal(record.status,'proposed');assert.equal(record.approval,undefined);
 assert.equal((await f.request('/propose',{manifest:f.manifest})).status,400);
 const approval={id:f.manifest.id,expectedDigest:record.manifestSha256,operatorLabel:'Authorized test operator',attestRights:true,attestExternalQa:true,attestSourceBaseline:true,attestMembership:true};
 assert.equal((await f.request('/approve',{...approval,expectedDigest:'a'.repeat(64)})).status,409);
 assert.equal((await f.request('/approve',{...approval,attestExternalQa:false})).status,409);
 const approved=await f.request('/approve',approval);assert.equal(approved.status,200);const a=await approved.json() as any;assert.equal(a.approval.principal,'fixture-owner');assert.equal(a.approval.method,'authenticated_owner_authorized_operator');assert.equal(a.origin,'owner_authorized_external_review');
 assert.equal((await f.request('/approve',approval)).status,409);assert.equal((await f.request('/revoke',{id:f.manifest.id,expectedDigest:record.manifestSha256})).status,200);assert.equal((await f.request('/approve',approval)).status,409);
 assert.equal(JSON.parse(f.raw()).sourceAuthorizations,undefined);
 }finally{await f.close();}
});
test('owner review browser renders exact safe proposal, requires all checks and supports approval then revocation without console errors',async()=>{
 let providerProof:any=null;const f=await fixture(async()=>providerProof);let browser:any;try{
 browser=await chromium.launch({headless:true,...(process.platform==='darwin'?{channel:'chrome'}:{})});const context=await browser.newContext({extraHTTPHeaders:{'x-fixture-auth':'fixture-owner'}});const page=await context.newPage();page.setDefaultTimeout(10000);const errors:string[]=[];page.on('pageerror',(e:any)=>errors.push(e.message));
 await page.goto(f.base+'/review');await page.getByRole('heading',{name:'Revisión de clips autorizados'}).waitFor();await page.locator('#manifest').setInputFiles({name:'reviewed-proposal.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(f.manifest))});await page.getByRole('button',{name:'Preparar para revisar'}).click();await page.locator('legend').filter({hasText:'proposed'}).waitFor();
 await page.getByRole('button',{name:'Aprobar este archivo y horario'}).click();await page.locator('#state').filter({hasText:'derivative_owner_approval_required'}).waitFor();
 await page.getByRole('textbox',{name:'Operador autorizado'}).fill('Owner delegated fixture operator');for(const box of await page.getByRole('checkbox').all())await box.check();
 await page.getByRole('button',{name:'Aprobar este archivo y horario'}).click();await page.locator('legend').filter({hasText:'approved'}).waitFor();await page.getByRole('button',{name:'Revocar autorización'}).click();await page.locator('legend').filter({hasText:'revoked'}).waitFor();
 assert.equal(JSON.parse(f.raw()).reviewedDerivatives.records[f.manifest.id].status,'revoked');
 await f.store.transact('ignored',async raw=>{const s=JSON.parse(raw);s.reviewedDerivatives.records[f.manifest.id].delivery={id:'ui-existing-write',status:'verification_pending',writeStartedAt:new Date(NOW).toISOString(),metricoolId:'777',metricoolUuid:'ui-exact-uuid',reason:'derivative_commercial_disclosure_unverified'};s.cloudPublish={version:1,clips:{},posts:[{id:'ui-existing-write',status:'verification_pending',scheduledAt:f.manifest.scheduledAt}],holds:{},heldQueue:[]};return JSON.stringify(s);});
 await page.reload();await page.getByRole('button',{name:'Comprobar envío en Metricool'}).click();await page.locator('#state').filter({hasText:'derivative_provider_reconciliation_unverified'}).waitFor();
 providerProof={id:'777',uuid:'ui-exact-uuid',mediaUrl:f.manifest.media.url,status:'nonpublishing_draft',confirmedNonPublishingDraft:true,commercialDisclosureVerified:false};await page.getByRole('button',{name:'Comprobar envío en Metricool'}).click();await page.getByText('Borrador confirmado en Metricool; no se publicará ni se repetirá.').waitFor();assert.deepEqual(errors,[]);
 }finally{await browser?.close();await f.close();}
});

test('authenticated proposal/approval feeds actual runner state and a second HTTP revocation at final provider preflight blocks dispatch',async()=>{
 for(const revoke of [false,true]){const f=await fixture();try{
  const proposal=await(await f.request('/propose',{manifest:f.manifest})).json() as any;
  assert.equal((await f.request('/approve',{id:f.manifest.id,expectedDigest:proposal.manifestSha256,operatorLabel:'Delegated fixture operator',attestRights:true,attestExternalQa:true,attestSourceBaseline:true,attestMembership:true})).status,200);
  await f.store.transact('ignored',async raw=>{const s=JSON.parse(raw);s.creators[f.manifest.source.creatorKey]={policy:{source:'fixture_checked',status:'allowed_unless_prohibited'}};return JSON.stringify(s);});
  let writes=0,removed=0;
  const report=await runReviewedDerivatives({owner:'fixture-owner',store:f.store,config:{enabled:true,dryRun:false,killSwitch:false,destinations:[f.manifest.destination]},clock:()=>NOW,
   loadFinal:async()=>({file:'/fixture/sealed-final',cleanup:async()=>{}}),verifyFile:async()=>true,verifyReceipt:async()=>true,liveCheck:async()=>null,
   stager:{upload:async()=>({id:22,url:'https://github.com/fixture/staging/final.mp4'}),remove:async()=>{removed++;return true;}},
   metricool:{reviewedDerivativeCalendar:async()=>[],preflight:async()=>{},crossAccountPreflight:async()=>{},schedule:async(_d:any,item:any)=>{
    if(revoke)assert.equal((await f.request('/revoke',{id:f.manifest.id,expectedDigest:proposal.manifestSha256})).status,200);
    await item.beforeWrite();writes++;return{commercialDisclosureVerified:true,id:'777',uuid:'actual-fixture-777',mediaUrl:f.manifest.media.url};
   }}});
  assert.equal(writes,revoke?0:1);assert.equal(report.scheduled,revoke?0:1);assert.equal(removed,1);if(!revoke){const revoked=await(await f.request('/revoke',{id:f.manifest.id,expectedDigest:proposal.manifestSha256})).json() as any;assert.equal(revoked.reconciliationRequired,true);assert.equal(revoked.cancellationMonitorInstalled,false);}
 }finally{await f.close();}}
});

test('authenticated reconciliation cannot clear a paid pause by unchecked owner reset, wrong UUID or a provider field mismatch',async()=>{
 let proof:any=null;const f=await fixture(async()=>proof);try{
  const response=await f.request('/propose',{manifest:f.manifest});const record=await response.json() as any;
  await f.store.transact('ignored',async raw=>{const s=JSON.parse(raw);s.reviewedDerivatives.records[f.manifest.id].delivery={id:'existing-write',status:'verification_pending',writeStartedAt:new Date(NOW).toISOString(),metricoolId:'777',metricoolUuid:'exact-uuid',reason:'derivative_commercial_disclosure_unverified'};s.cloudPublish={version:1,clips:{},posts:[{id:'existing-write',status:'verification_pending',scheduledAt:f.manifest.scheduledAt}],holds:{},heldQueue:[],reviewedDerivativeClaims:[{claimId:'existing-write'}]};return JSON.stringify(s);});
  const body={id:f.manifest.id,expectedDigest:record.manifestSha256};assert.equal((await f.request('/reconcile',{...body,clear:true})).status,409);
  proof={id:'777',uuid:'wrong-uuid',mediaUrl:f.manifest.media.url,status:'scheduled',commercialDisclosureVerified:true};assert.equal((await f.request('/reconcile',body)).status,409);
  proof={...proof,uuid:'exact-uuid',commercialDisclosureVerified:false};assert.equal((await f.request('/reconcile',body)).status,409);
  proof={...proof,status:'nonpublishing_draft',confirmedNonPublishingDraft:true};assert.equal((await f.request('/reconcile',body)).status,200);const s=JSON.parse(f.raw());const d=s.reviewedDerivatives.records[f.manifest.id].delivery;assert.equal(d.status,'held_nonpublishing_draft');assert.equal(d.disclosureReconciledBy,'fixture-owner');assert.equal(s.cloudPublish.posts[0].draft,true);assert.equal(s.cloudPublish.reviewedDerivativeClaims.length,1);
 }finally{await f.close();}
});
