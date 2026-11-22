import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createHash, randomUUID } from 'node:crypto';
import http from 'node:http';
import {EventEmitter} from 'node:events';
import {waitForPrivatePreviewDrain} from '../server/clippers-private-final-routes';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import playwright from 'playwright';
import { registerReviewedDerivativeRoutes } from '../server/clippers-reviewed-derivative-routes';
import { derivativeFixture, DERIVATIVE_NOW as NOW } from './helpers/reviewed-derivative-fixture.mjs';
import { STREAMER_STATE_NAMESPACE, emptyStreamerState } from '../script/clippers-streamer-discovery.mjs';
const { chromium } = playwright;
const digest=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const exec=promisify(execFile);
const inspectionReceipt=({record,now}:any)=>({origin:'private_final_owner_technical_inspection',manifestSha256:record.manifestSha256,sha256:record.manifest.media.sha256,byteLength:record.manifest.media.byteLength,checkedAt:new Date(now).toISOString(),audioProfile:record.manifest.media.audio});
async function fixture(bytes=Buffer.alloc(1536,0x42),reconcile?:any,inspectPrivate:((input:any)=>Promise<any>)|'real'=async input=>inspectionReceipt(input)){
 const values=new Map<string,string>([[STREAMER_STATE_NAMESPACE('fixture-owner'),JSON.stringify(emptyStreamerState())]]),locks=new Map<string,Promise<any>>();
 const readKeys:string[]=[];
 const backend={read:async(key:string)=>{readKeys.push(key);return values.get(key)??null;},transact:async(key:string,fn:(raw:string|null)=>Promise<string>)=>{
  const next=(locks.get(key)??Promise.resolve()).catch(()=>undefined).then(async()=>{const value=await fn(values.get(key)??null);values.set(key,value);return value;});locks.set(key,next);return next;
 }};
 const app=express();app.use(express.json({limit:'300kb'}));registerReviewedDerivativeRoutes(app,{store:async()=>backend,owner:()=> 'fixture-owner',reconcile,...(inspectPrivate==='real'?{}:{inspectPrivate}),principal:req=>typeof req.headers['x-fixture-auth']==='string'?req.headers['x-fixture-auth']:null,now:()=>NOW});app.get('/favicon.ico',(_req,res)=>res.status(204).end());
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const address=server.address() as any,origin=`http://127.0.0.1:${address.port}`,base=origin+'/api/clippers/reviewed-derivatives';
 const manifest:any=derivativeFixture().manifest;delete manifest.media.url;Object.assign(manifest.media,{storageKind:'private_council_v1',privateFinalRef:'final-'+digest(bytes),sha256:digest(bytes),byteLength:bytes.length});manifest.qa.finalSha256=manifest.media.sha256;
 manifest.baseline={fromDay:'2026-11-20',throughDay:'2026-11-24',sourceOriginAt:'2026-11-21T10:00:00Z',originEvidenceReference:'fixture-only:vod-start',originEvidenceSha256:'a'.repeat(64),rows:[]};
 const call=(route:string,options:any={})=>fetch(base+route,{method:options.method??(options.body?'POST':'GET'),headers:{'x-fixture-auth':options.actor??'fixture-owner',origin:options.origin??origin,...(options.binary?{'content-type':'application/octet-stream'}:options.body?{'content-type':'application/json'}:{}),...options.headers},...(options.body?{body:options.binary?options.body:JSON.stringify(options.body)}:{})});
 const propose=async()=>{const response=await call('/propose',{body:{manifest}});assert.equal(response.status,201,JSON.stringify(await response.clone().json()));return response.json() as Promise<any>;};
 const prefix='/private-finals/'+manifest.id;
 const approval=(record:any)=>({id:manifest.id,expectedDigest:record.manifestSha256,operatorLabel:'Independent fixture owner operator',attestRights:true,attestExternalQa:true,attestSourceBaseline:true,attestMembership:true});
 async function upload(record:any){const body={expectedDigest:record.manifestSha256};const reserved=await call(prefix+'/reserve',{body});assert.equal(reserved.status,200);const info=await reserved.json() as any;
  for(let index=0,offset=0;offset<bytes.length;index++,offset+=info.chunkBytes){const part=bytes.subarray(offset,Math.min(bytes.length,offset+info.chunkBytes));const response=await call(prefix+'/chunks/'+index,{body:part,binary:true,headers:{'x-derivative-manifest-sha256':record.manifestSha256,'x-chunk-sha256':digest(part)}});assert.equal(response.status,200,JSON.stringify(await response.clone().json()));}
  const finished=await call(prefix+'/finalize',{body});assert.equal(finished.status,200,JSON.stringify(await finished.clone().json()));assert.equal((await finished.json() as any).ready,true);
 }
 return{server,values,readKeys,backend,manifest,bytes,origin,base,call,propose,prefix,approval,upload,close:()=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()))};
}
test('private final real HTTP refuses anonymous/cross-owner/CSRF, missing proposal, wrong digest/index/hash/type and oversized bodies',async()=>{
 const f=await fixture();try{
  for(const path of [f.prefix+'/status',f.prefix+'/preview']){
   assert.equal((await f.call(path,{actor:''})).status,401);assert.equal((await f.call(path,{actor:'different-owner'})).status,403);assert.equal((await f.call(path,{origin:'https://evil.example'})).status,403);
  }
  assert.equal((await f.call(f.prefix+'/reserve',{body:{expectedDigest:'a'.repeat(64)}})).status,409);
  const badRef=structuredClone(f.manifest);badRef.media.privateFinalRef='final-'+'a'.repeat(64);assert.equal((await f.call('/propose',{body:{manifest:badRef}})).status,400);
  const r=await f.propose(),body={expectedDigest:r.manifestSha256};
  assert.equal((await f.call(f.prefix+'/reserve',{body,origin:'https://evil.example'})).status,403);
  assert.equal((await f.call(f.prefix+'/reserve',{body:{expectedDigest:'a'.repeat(64)}})).status,409);
  assert.equal((await f.call(f.prefix+'/reserve',{body:{...body,privateFinalRef:'final-'+randomUUID()}})).status,409);
  assert.equal((await f.call('/approve',{body:f.approval(r)})).status,409,'private metadata alone cannot approve before byte verification');
  assert.equal((await f.call(f.prefix+'/reserve',{body})).status,200);
  const headers={'x-derivative-manifest-sha256':r.manifestSha256,'x-chunk-sha256':digest(f.bytes)};
  assert.equal((await f.call(f.prefix+'/chunks/0',{body:{},headers})).status,415);
  assert.equal((await f.call(f.prefix+'/chunks/-1',{body:f.bytes,binary:true,headers})).status,409);
  assert.equal((await f.call(f.prefix+'/chunks/1',{body:f.bytes,binary:true,headers})).status,409);
  assert.equal((await f.call(f.prefix+'/chunks/0',{body:f.bytes,binary:true,headers:{...headers,'x-chunk-sha256':'a'.repeat(64)}})).status,409);
  assert.equal((await f.call(f.prefix+'/chunks/0',{body:f.bytes,binary:true,headers,actor:'different-owner'})).status,403);
  assert.equal((await f.call(f.prefix+'/chunks/0',{body:f.bytes,binary:true,headers,origin:'https://evil.example'})).status,403);
  assert.equal((await f.call(f.prefix+'/chunks/0',{body:Buffer.alloc(2097153),binary:true,headers})).status,413);
  assert.equal((await f.call(f.prefix+'/finalize',{body})).status,409);
  const status=await(await f.call(f.prefix+'/status')).json() as any;assert.equal(status.ready,false);
 }finally{await f.close();}
});
test('private final upload/readback gives exact owner-only ranges and HEAD, then preserves explicit two-step approval',async()=>{
 const f=await fixture();try{
  const r=await f.propose();await f.upload(r);
  const status=await f.call(f.prefix+'/status');assert.match(status.headers.get('cache-control')??'',/private, no-store/);assert.equal((await status.json() as any).ready,true);
  const all=await f.call(f.prefix+'/preview');assert.equal(all.status,200);assert.deepEqual(Buffer.from(await all.arrayBuffer()),f.bytes);assert.equal(all.headers.get('cross-origin-resource-policy'),'same-origin');
  for(const [range,start,end]of [['bytes=3-21',3,21],['bytes=-10',f.bytes.length-10,f.bytes.length-1],['bytes=1500-',1500,f.bytes.length-1]] as const){const part=await f.call(f.prefix+'/preview',{headers:{range}});assert.equal(part.status,206);assert.equal(part.headers.get('content-range'),`bytes ${start}-${end}/${f.bytes.length}`);assert.deepEqual(Buffer.from(await part.arrayBuffer()),f.bytes.subarray(start,end+1));}
  for(const range of ['bytes=999999-','bytes=5-2','bytes=0-1,5-6','bytes=-0'])assert.equal((await f.call(f.prefix+'/preview',{headers:{range}})).status,416);
  f.readKeys.length=0;const head=await f.call(f.prefix+'/preview',{method:'HEAD',headers:{range:'bytes=2-9'}});assert.equal(head.status,206);assert.equal(head.headers.get('content-length'),'8');assert.equal((await head.arrayBuffer()).byteLength,0);assert.equal(f.readKeys.some(key=>key.includes(':chunk:')),false,'HEAD must not fetch private byte chunks');
  assert.equal((await f.call('/approve',{body:{...f.approval(r),attestExternalQa:false}})).status,409);
  const approved=await f.call('/approve',{body:f.approval(r)});assert.equal(approved.status,200);assert.equal((await approved.json() as any).approval.principal,'fixture-owner');
  assert.equal((await f.call(f.prefix+'/preview',{actor:'different-owner'})).status,403);
  const absentOrigin=await fetch(f.base+f.prefix+'/preview',{headers:{'x-fixture-auth':'fixture-owner'}});assert.equal(absentOrigin.status,403);
 }finally{await f.close();}
});
test('real owner browser uploads only the exact private MP4, previews it and then approves without public media or console errors',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'private-preview-browser-'));let browser:any,f:Awaited<ReturnType<typeof fixture>>|undefined;
 try{
  const file=path.join(directory,'preview.mp4');await exec('ffmpeg',['-nostdin','-v','error','-y','-f','lavfi','-i','color=c=black:s=1080x1920:r=1:d=20','-an','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-movflags','+faststart',file]);
  f=await fixture(await readFile(file),undefined,'real');browser=await chromium.launch({headless:true,...(process.platform==='darwin'?{channel:'chrome'}:{})});const context=await browser.newContext({extraHTTPHeaders:{'x-fixture-auth':'fixture-owner'}}),page=await context.newPage();page.setDefaultTimeout(15000);
  const errors:string[]=[],requests:string[]=[];page.on('pageerror',(error:any)=>errors.push(error.message));page.on('request',(request:any)=>requests.push(request.url()));
  await page.goto(f.base+'/review');await page.locator('#manifest').setInputFiles({name:'private-proposal.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(f.manifest))});await page.getByRole('button',{name:'Preparar para revisar'}).click();await page.locator('legend').filter({hasText:'proposed'}).waitFor();
  const approve=page.getByRole('button',{name:'Aprobar este archivo y horario'});assert.equal(await approve.isDisabled(),true);
  await page.getByLabel('Archivo final privado para '+f.manifest.id,{exact:true}).setInputFiles({name:'wrong.mp4',mimeType:'video/mp4',buffer:Buffer.alloc(f.bytes.length,0x99)});await page.getByRole('button',{name:'Cargar y verificar archivo privado'}).click();await page.getByText('El archivo seleccionado no coincide con la huella revisada.',{exact:true}).first().waitFor();assert.equal(requests.some(url=>url.endsWith('/reserve')),false);
  await page.getByLabel('Archivo final privado para '+f.manifest.id,{exact:true}).setInputFiles({name:'reviewed.mp4',mimeType:'video/mp4',buffer:f.bytes});await page.getByRole('button',{name:'Cargar y verificar archivo privado'}).click();await page.getByRole('button',{name:'Ver archivo privado',exact:true}).waitFor();assert.equal(requests.some(url=>url.endsWith('/preview')),false);await page.getByRole('button',{name:'Ver archivo privado',exact:true}).click();await page.getByText('Vista previa cargada del archivo privado verificado. Revisa el video antes de aprobar.',{exact:true}).waitFor();
  assert.equal(await approve.isDisabled(),false);assert.ok(requests.some(url=>url.endsWith('/preview')));assert.equal(requests.some(url=>url.includes('static.metricool.com')||url.includes('github.com')),false);
  await page.getByRole('textbox',{name:'Operador autorizado'}).fill('Owner private upload fixture');for(const check of await page.getByRole('checkbox').all())await check.check();await approve.click();await page.locator('legend').filter({hasText:'approved'}).waitFor();assert.deepEqual(errors,[]);
  const nativeUrl='https://static.metricool.com/fixture/verified-native-preview.mp4';
  await f.backend.transact(STREAMER_STATE_NAMESPACE('fixture-owner'),async raw=>{const state=JSON.parse(raw!);state.reviewedDerivatives.records[f!.manifest.id].delivery={id:'native-copy',status:'scheduled',writeStartedAt:new Date(NOW).toISOString(),copyVerifiedAt:new Date(0).toISOString(),confirmedMediaUrl:nativeUrl,confirmedMediaSha256:f!.manifest.media.sha256,confirmedByteLength:f!.bytes.length};return JSON.stringify(state);});
  const stored=JSON.parse(f.values.get(STREAMER_STATE_NAMESPACE('fixture-owner'))!).reviewedDerivatives.records[f.manifest.id];const reclaimed=await f.call(f.prefix+'/cleanup',{body:{expectedDigest:stored.manifestSha256}});assert.equal(reclaimed.status,200);assert.equal((await reclaimed.json() as any).bytesReclaimed,f.bytes.length);
  await page.route(nativeUrl,async(route:any)=>route.fulfill({status:200,contentType:'video/mp4',body:f!.bytes}));
  const previousPreviews=requests.filter(url=>url.endsWith('/preview')).length;await page.reload();await page.getByRole('button',{name:'Ver copia nativa verificada',exact:true}).click();await page.getByText('Vista previa cargada de la copia nativa verificada. El archivo privado ya se liberó.',{exact:true}).waitFor();assert.equal(await page.locator('video').getAttribute('src'),nativeUrl);assert.equal(requests.filter(url=>url.endsWith('/preview')).length,previousPreviews);
  await f.backend.transact(STREAMER_STATE_NAMESPACE('fixture-owner'),async raw=>{const state=JSON.parse(raw!);state.reviewedDerivatives.records[f!.manifest.id].delivery.confirmedMediaSha256='a'.repeat(64);return JSON.stringify(state);});await page.reload();assert.equal(await page.locator('video').getAttribute('src'),null,'a mismatched native-copy hash must never become a preview source');await page.getByText('Falta cargar y verificar el archivo final privado.',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Ver copia nativa verificada',exact:true}).count(),0);assert.deepEqual(errors,[]);
 }finally{await browser?.close();await f?.close();await rm(directory,{recursive:true,force:true});}
});


test('private final multi-chunk range readback spans exact stored chunks and repeated immutable upload is idempotent',async()=>{
 const bytes=Buffer.alloc(2097152+1536);for(let i=0;i<bytes.length;i++)bytes[i]=i%251;
 const f=await fixture(bytes);try{
  const record=await f.propose();await f.upload(record);
  const first=bytes.subarray(0,2097152),response=await f.call(f.prefix+'/chunks/0',{body:first,binary:true,headers:{'x-derivative-manifest-sha256':record.manifestSha256,'x-chunk-sha256':digest(first)}});
  assert.equal(response.status,200);assert.equal((await response.json() as any).receivedChunks,2);
  const range=await f.call(f.prefix+'/preview',{headers:{range:'bytes=2097148-2097163'}});assert.equal(range.status,206);assert.deepEqual(Buffer.from(await range.arrayBuffer()),bytes.subarray(2097148,2097164));
  const status=await(await f.call(f.prefix+'/status')).json() as any;assert.equal(status.ready,true);assert.equal(status.ownerUsageBytes,bytes.length);
 }finally{await f.close();}
});


test('owner cleanup is bound to the stored proposal and retains unknown sends; native reconciliation stamps exact copy identity before reclaim',async()=>{
 for(const scenario of ['revoked_unused','unknown_send','native_copy']){
  const proof={id:'777',uuid:'private-copy-uuid',status:'scheduled',mediaUrl:'https://static.metricool.com/fixture/native-copy.mp4',commercialDisclosureVerified:true};
  const f=await fixture(undefined,async()=>proof);try{
   const r=await f.propose();await f.upload(r);assert.equal((await f.call('/approve',{body:f.approval(r)})).status,200);
   if(scenario!=='revoked_unused')await f.backend.transact(STREAMER_STATE_NAMESPACE('fixture-owner'),async raw=>{const state=JSON.parse(raw!);state.reviewedDerivatives.records[f.manifest.id].delivery={id:'copy-write',status:'verification_pending',writeStartedAt:new Date(NOW).toISOString(),metricoolId:'777',metricoolUuid:'private-copy-uuid'};state.cloudPublish={version:1,clips:{},posts:[{id:'copy-write',status:'verification_pending'}],holds:{},heldQueue:[]};return JSON.stringify(state);});
   if(scenario==='native_copy'){
    const reconciled=await f.call('/reconcile',{body:{id:f.manifest.id,expectedDigest:r.manifestSha256}});assert.equal(reconciled.status,200);const record=await reconciled.json() as any;
    assert.equal(record.delivery.confirmedMediaSha256,f.manifest.media.sha256);assert.equal(record.delivery.confirmedByteLength,f.bytes.length);assert.equal(record.delivery.copyVerifiedAt,new Date(NOW).toISOString());
   }else assert.equal((await f.call('/revoke',{body:{id:f.manifest.id,expectedDigest:r.manifestSha256}})).status,200);
   const body={expectedDigest:r.manifestSha256};assert.equal((await f.call(f.prefix+'/cleanup',{body,actor:'different-owner'})).status,403);assert.equal((await f.call(f.prefix+'/cleanup',{body,origin:'https://evil.example'})).status,403);
   assert.equal((await f.call(f.prefix+'/cleanup',{body:{...body,refs:['arbitrary']}})).status,409);
   const response=await f.call(f.prefix+'/cleanup',{body});assert.equal(response.status,200);const result=await response.json() as any;
   assert.equal(result.bytesReclaimed,scenario==='unknown_send'?0:f.bytes.length);
   const status=await(await f.call(f.prefix+'/status')).json() as any;assert.equal(status.ready,scenario==='unknown_send');
  }finally{await f.close();}
 }
});


test('two unfinished owner uploads reserve admission before binary parsing; a third oversized upload gets429 and released slots recover',async()=>{
 const f=await fixture();const held:http.ClientRequest[]=[];try{
  const r=await f.propose();await f.upload(r);
  let started=0,admitted!:()=>void;const bothStarted=new Promise<void>(resolve=>{admitted=resolve;});
  const observer=(request:http.IncomingMessage)=>{if(request.url?.includes('/chunks/0')&&++started===2)admitted();};f.server.on('request',observer);
  const completion:Promise<number>[]=[];
  for(let i=0;i<2;i++)completion.push(new Promise<number>((resolve,reject)=>{
   const request=http.request(f.base+f.prefix+'/chunks/0',{method:'POST',headers:{'x-fixture-auth':'fixture-owner',origin:f.origin,'content-type':'application/octet-stream','content-length':f.bytes.length,'x-derivative-manifest-sha256':r.manifestSha256,'x-chunk-sha256':digest(f.bytes)}},response=>{response.resume();response.once('end',()=>resolve(response.statusCode!));});
   request.once('error',reject);held.push(request);request.write(f.bytes.subarray(0,1));
  }));
  await bothStarted;
  assert.equal((await f.call(f.prefix+'/preview')).status,429,'private GET previews share bounded transfer admission');
  f.readKeys.length=0;const head=await f.call(f.prefix+'/preview',{method:'HEAD'});assert.equal(head.status,200);assert.equal(f.readKeys.some(key=>key.includes(':chunk:')),false);
  const third=await f.call(f.prefix+'/chunks/0',{body:Buffer.alloc(2097153),binary:true,headers:{'x-derivative-manifest-sha256':r.manifestSha256,'x-chunk-sha256':digest(f.bytes)}});assert.equal(third.status,429);assert.equal((await third.json() as any).error,'derivative_private_transfer_busy');
  for(const request of held)request.end(f.bytes.subarray(1));assert.deepEqual(await Promise.all(completion),[200,200]);f.server.off('request',observer);
  const finalized=await f.call(f.prefix+'/finalize',{body:{expectedDigest:r.manifestSha256}});assert.equal(finalized.status,200);assert.equal((await finalized.json() as any).ready,true);
 }finally{for(const request of held)request.destroy();await f.close();}
});


test('hash-ready private bytes cannot be approved unless the real sealed MP4/audio inspection succeeds',async()=>{
 const invalid=await fixture(Buffer.alloc(1536,0x77),undefined,'real');try{const record=await invalid.propose();await invalid.upload(record);const response=await invalid.call('/approve',{body:invalid.approval(record)});assert.equal(response.status,409);assert.equal(JSON.parse(invalid.values.get(STREAMER_STATE_NAMESPACE('fixture-owner'))!).reviewedDerivatives.records[invalid.manifest.id].status,'proposed');}finally{await invalid.close();}
 const directory=await mkdtemp(path.join(tmpdir(),'private-audio-mismatch-'));let f:Awaited<ReturnType<typeof fixture>>|undefined;try{
  const file=path.join(directory,'unexpected-audio.mp4');await exec('ffmpeg',['-nostdin','-v','error','-y','-f','lavfi','-i','color=c=black:s=1080x1920:r=1:d=20','-f','lavfi','-i','sine=frequency=440:duration=20','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-t','20','-movflags','+faststart',file]);
  f=await fixture(await readFile(file),undefined,'real');const record=await f.propose();await f.upload(record);const response=await f.call('/approve',{body:f.approval(record)});assert.equal(response.status,409);assert.equal(JSON.parse(f.values.get(STREAMER_STATE_NAMESPACE('fixture-owner'))!).reviewedDerivatives.records[f.manifest.id].status,'proposed');
 }finally{await f?.close();await rm(directory,{recursive:true,force:true});}
});

test('one owner technical inspection remains bounded until its actual work settles, including client disconnect, and failed inspections release admission',async()=>{
 let entered!:()=>void,release!:()=>void,finished!:()=>void;const started=new Promise<void>(resolve=>entered=resolve),hold=new Promise<void>(resolve=>release=resolve),settled=new Promise<void>(resolve=>finished=resolve);let count=0;
 const f=await fixture(undefined,undefined,async input=>{count++;if(count===1){entered();try{await hold;throw Error('private_final_fixture_inspection_failed');}finally{finished();}}return inspectionReceipt(input);});
 try{
  const record=await f.propose();await f.upload(record);const body=f.approval(record),controller=new AbortController();
  const first=fetch(f.base+'/approve',{method:'POST',headers:{'x-fixture-auth':'fixture-owner',origin:f.origin,'content-type':'application/json'},body:JSON.stringify(body),signal:controller.signal}).catch(()=>null);
  await started;controller.abort();await first;
  const busy=await f.call('/approve',{body});assert.equal(busy.status,429);assert.equal((await busy.json() as any).error,'derivative_private_inspection_busy');assert.equal(count,1);
  release();await settled;
  const ready=await f.call('/approve',{body});assert.equal(ready.status,200);assert.equal(count,2);assert.equal((await ready.json() as any).privateFinalInspection.sha256,f.manifest.media.sha256);
 }finally{release?.();await f.close();}
});


test('configured PUBLIC_APP_URL is authoritative: a wrong configured origin rejects same-host preview and write requests rather than falling back',async()=>{
 const f=await fixture();const previous=process.env.PUBLIC_APP_URL;try{
  const record=await f.propose();await f.upload(record);process.env.PUBLIC_APP_URL='https://configured-office.invalid';
  assert.equal((await f.call(f.prefix+'/preview')).status,403);assert.equal((await f.call(f.prefix+'/status')).status,403);assert.equal((await f.call(f.prefix+'/reserve',{body:{expectedDigest:record.manifestSha256}})).status,403);
  assert.equal((await f.call(f.prefix+'/preview',{origin:'https://evil.example',headers:{referer:'https://configured-office.invalid/review'}})).status,403,'an explicit foreign Origin cannot be replaced by Referer');
 }finally{if(previous===undefined)delete process.env.PUBLIC_APP_URL;else process.env.PUBLIC_APP_URL=previous;await f.close();}
});

test('aborted finalize/preview sockets do not release admission until their actual pending chunk reads settle',async()=>{
 for(const kind of ['finalize','preview']){
  const f=await fixture();let release!:()=>void;const held=new Promise<void>(resolve=>release=resolve);let entered=0,both!:()=>void;const bothEntered=new Promise<void>(resolve=>both=resolve);const controllers=[new AbortController(),new AbortController()];
  try{
   const r=await f.propose(),body={expectedDigest:r.manifestSha256};
   if(kind==='preview')await f.upload(r);else{
    assert.equal((await f.call(f.prefix+'/reserve',{body})).status,200);assert.equal((await f.call(f.prefix+'/chunks/0',{body:f.bytes,binary:true,headers:{'x-derivative-manifest-sha256':r.manifestSha256,'x-chunk-sha256':digest(f.bytes)}})).status,200);
   }
   const original=f.backend.read;let block=true;f.backend.read=async key=>{if(block&&key.includes(':chunk:')){if(++entered===2)both();await held;}return original(key);};
   const route=f.base+f.prefix+'/'+kind,options=kind==='finalize'?{method:'POST',body:JSON.stringify(body),headers:{'x-fixture-auth':'fixture-owner',origin:f.origin,'content-type':'application/json'}}:{headers:{'x-fixture-auth':'fixture-owner',origin:f.origin}};
   const pending=controllers.map(controller=>fetch(route,{...options,signal:controller.signal}).catch(()=>null));await bothEntered;for(const controller of controllers)controller.abort();await Promise.all(pending);
   const denied=await f.call(f.prefix+'/'+kind,kind==='finalize'?{body}:{});assert.equal(denied.status,429,kind);
   if(kind==='preview')assert.equal((await f.call(f.prefix+'/preview',{method:'HEAD'})).status,200);
   block=false;release();await f.call(f.prefix+'/status');
   const recovered=await f.call(f.prefix+'/'+kind,kind==='finalize'?{body}:{});assert.equal(recovered.status,200,kind);await recovered.arrayBuffer();
  }finally{release?.();for(const controller of controllers)controller.abort();await f.close();}
 }
});

test('raw-body abort releases admission exactly once after the parser aborts, permitting later complete uploads',async()=>{
 const f=await fixture(),requests:http.ClientRequest[]=[];try{
  const record=await f.propose();assert.equal((await f.call(f.prefix+'/reserve',{body:{expectedDigest:record.manifestSha256}})).status,200);
  let arrived=0,arrive!:()=>void,aborted=0,allAborted!:()=>void;const ready=new Promise<void>(resolve=>arrive=resolve),gone=new Promise<void>(resolve=>allAborted=resolve);
  const observer=(request:http.IncomingMessage)=>{if(!request.url?.includes('/chunks/0'))return;if(++arrived===2)arrive();request.once('aborted',()=>{if(++aborted===2)allAborted();});};f.server.on('request',observer);
  for(let i=0;i<2;i++){const request=http.request(f.base+f.prefix+'/chunks/0',{method:'POST',headers:{'x-fixture-auth':'fixture-owner',origin:f.origin,'content-type':'application/octet-stream','content-length':f.bytes.length,'x-derivative-manifest-sha256':record.manifestSha256,'x-chunk-sha256':digest(f.bytes)}});request.on('error',()=>undefined);requests.push(request);request.write(f.bytes.subarray(0,1));}
  await ready;for(const request of requests)request.destroy();await gone;f.server.off('request',observer);
  const next=await f.call(f.prefix+'/chunks/0',{body:f.bytes,binary:true,headers:{'x-derivative-manifest-sha256':record.manifestSha256,'x-chunk-sha256':digest(f.bytes)}});assert.equal(next.status,200);
  const final=await f.call(f.prefix+'/finalize',{body:{expectedDigest:record.manifestSha256}});assert.equal(final.status,200);
 }finally{for(const request of requests)request.destroy();await f.close();}
});

test('five ready private proposals perform no automatic media fetch and only the explicitly selected preview stays loaded',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'private-preview-five-'));let browser:any,f:Awaited<ReturnType<typeof fixture>>|undefined;
 try{
  const file=path.join(directory,'preview.mp4');await exec('ffmpeg',['-nostdin','-v','error','-y','-f','lavfi','-i','color=c=black:s=1080x1920:r=1:d=20','-an','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-movflags','+faststart',file]);
  f=await fixture(await readFile(file));const original=await f.propose();await f.upload(original);
  for(let i=1;i<5;i++){const manifest=structuredClone(f.manifest);manifest.id='private-preview-'+i;const response=await f.call('/propose',{body:{manifest}});assert.equal(response.status,201);const record=await response.json() as any;const reserved=await f.call('/private-finals/'+manifest.id+'/reserve',{body:{expectedDigest:record.manifestSha256}});assert.equal(reserved.status,200);assert.equal((await reserved.json() as any).ready,true);}
  browser=await chromium.launch({headless:true,...(process.platform==='darwin'?{channel:'chrome'}:{})});const context=await browser.newContext({extraHTTPHeaders:{'x-fixture-auth':'fixture-owner'}}),page=await context.newPage();page.setDefaultTimeout(15000);
  const requests:string[]=[],errors:string[]=[];let busy=0;page.on('request',(request:any)=>requests.push(request.url()));page.on('response',(response:any)=>{if(response.status()===429)busy++;});page.on('pageerror',(error:any)=>errors.push(error.message));
  await page.goto(f.base+'/review');await page.locator('fieldset').nth(4).waitFor();assert.equal(await page.getByRole('button',{name:'Ver archivo privado',exact:true}).count(),5);assert.equal(requests.some(url=>url.endsWith('/preview')),false);assert.equal(await page.locator('video[src]').count(),0);
  const last=page.locator('fieldset').nth(4),first=page.locator('fieldset').nth(0);
  await last.getByRole('button',{name:'Ver archivo privado',exact:true}).click();await last.getByText('Vista previa cargada del archivo privado verificado. Revisa el video antes de aprobar.',{exact:true}).waitFor();assert.equal(await page.locator('video[src]').count(),1);
  await first.getByRole('button',{name:'Ver archivo privado',exact:true}).click();await first.getByText('Vista previa cargada del archivo privado verificado. Revisa el video antes de aprobar.',{exact:true}).waitFor();assert.equal(await last.locator('video').getAttribute('src'),null);assert.equal(await page.locator('video[src]').count(),1);assert.equal(busy,0);assert.deepEqual(errors,[]);
 }finally{await browser?.close();await f?.close();await rm(directory,{recursive:true,force:true});}
});

test('a stalled private preview drain is bounded and destroys its response; successful drains remove idle listeners',async()=>{
 class Response extends EventEmitter{destroyed=false;destroyCalls=0;destroy(){this.destroyed=true;this.destroyCalls++;this.emit('close');}}
 const stalled=new Response(),keepAlive=setTimeout(()=>undefined,500);
 try{await waitForPrivatePreviewDrain(stalled,10);assert.equal(stalled.destroyed,true);assert.equal(stalled.destroyCalls,1);assert.equal(stalled.listenerCount('drain'),0);assert.equal(stalled.listenerCount('close'),0);}finally{clearTimeout(keepAlive);}
 const flowing=new Response(),done=waitForPrivatePreviewDrain(flowing,100);flowing.emit('drain');await done;assert.equal(flowing.destroyed,false);assert.equal(flowing.listenerCount('drain'),0);assert.equal(flowing.listenerCount('close'),0);
});
