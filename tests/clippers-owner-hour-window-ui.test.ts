import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import playwright from 'playwright';
import {reviewedDerivativeReviewHtml} from '../server/clippers-reviewed-derivative-ui';
import {derivativeFixture} from './helpers/reviewed-derivative-fixture.mjs';
const {chromium}=playwright;

test('owner desk distinguishes proposed/authorized one-hour NY windows, selected actual slots and unchanged exact approvals without submitting grants',async()=>{
 const start='2026-11-22T15:00:00.000Z',end='2026-11-22T16:00:00.000Z',resolved='2026-11-22T15:17:00.000Z';
 const make=(id:string,status:string,window:boolean,delivery?:any)=>{const manifest:any=structuredClone(derivativeFixture().manifest);manifest.id=id;manifest.scheduledAt=start;if(window)manifest.dispatch={mode:'owner_hour_window',timezone:'America/New_York',startAt:start,endAt:end};return{status,manifest,manifestSha256:'a'.repeat(64),...(delivery?{delivery}:{})};};
 const records=[make('window-proposed','proposed',true),make('window-authorized-pending','approved',true),make('window-resolved','approved',true,{status:'pending_stage',resolvedScheduledAt:resolved}),make('window-revoked','revoked',true),make('exact-proposed','proposed',false),make('window-unused-attempt','approved',true,{status:'held_before_write',resolvedScheduledAt:resolved})];
 const before=JSON.stringify(records),writes:any[]=[];const app=express();app.use(express.json());app.use((req,res,next)=>{if(req.get('x-fixture-owner')!=='owner-fixture'){res.status(401).end();return;}next();});
 const base='/api/clippers/reviewed-derivatives';app.get(base+'/review',(_req,res)=>res.type('html').send(reviewedDerivativeReviewHtml('fixture-owner-ui')));app.get(base,(_req,res)=>res.json({records,publishingEnabled:false}));app.post(base+'/:action',(req,res)=>{writes.push({action:req.params.action,body:req.body});res.status(409).json({error:'fixture_no_grant_operation'});});app.get('/favicon.ico',(_req,res)=>res.status(204).end());
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const address=server.address() as any;let browser:any;
 try{
  browser=await chromium.launch({headless:true,...(process.platform==='darwin'?{channel:'chrome'}:{})});const context=await browser.newContext({extraHTTPHeaders:{'x-fixture-owner':'owner-fixture'},timezoneId:'Asia/Tokyo'}),page=await context.newPage();page.setDefaultTimeout(10000);const errors:string[]=[];page.on('pageerror',(error:any)=>errors.push(error.message));
  await page.route('https://static.metricool.com/**',async(route:any)=>route.abort());
  await page.goto(`http://127.0.0.1:${address.port}`+base+'/review');await page.locator('fieldset').nth(5).waitFor();
  const box=(id:string)=>page.locator('fieldset').filter({has:page.locator('legend').filter({hasText:id})});
  const proposed=box('window-proposed'),authorized=box('window-authorized-pending'),selected=box('window-resolved'),revoked=box('window-revoked'),exact=box('exact-proposed');
  assert.match(await proposed.textContent(),/Ventana propuesta de una hora/);assert.match(await proposed.textContent(),/10:00.*11:00/);assert.match(await proposed.textContent(),/America\/New_York/);assert.match(await proposed.textContent(),/fin excluido/);assert.match(await proposed.textContent(),/Límites UTC: 2026-11-22T15:00:00.000Z/);
  assert.match(await proposed.textContent(),/Horario de envío pendiente/);assert.doesNotMatch(await proposed.textContent(),/Programado en Metricool/);assert.equal(await proposed.getByRole('button',{name:'Aprobar este archivo para la hora propuesta',exact:true}).count(),1);
  assert.match(await authorized.textContent(),/Ventana autorizada de una hora/);assert.match(await authorized.textContent(),/Horario de envío pendiente/);assert.equal(await authorized.getByRole('button',{name:/Aprobar/}).count(),0);
  assert.match(await selected.textContent(),/Horario seleccionado para el envío:.*10:17/);assert.match(await selected.textContent(),/UTC: 2026-11-22T15:17:00.000Z/);assert.match(await selected.textContent(),/no confirman programación ni publicación/);assert.doesNotMatch(await selected.textContent(),/Programado en Metricool/);
  assert.match(await revoked.textContent(),/Ventana revocada de una hora/);assert.equal(await revoked.getByRole('button',{name:/Aprobar/}).count(),0);
  assert.equal(await exact.getByRole('button',{name:'Aprobar este archivo y horario',exact:true}).count(),1);assert.match(await exact.textContent(),/streamersus · tiktok · 2026-11-22T15:00:00.000Z/);assert.doesNotMatch(await exact.textContent(),/Ventana propuesta|Horario seleccionado/);
  assert.match(await box('window-unused-attempt').textContent(),/Horario de envío pendiente/);assert.doesNotMatch(await box('window-unused-attempt').textContent(),/Horario seleccionado para el envío/);
  assert.deepEqual(writes,[]);assert.equal(JSON.stringify(records),before);assert.deepEqual(errors,[]);
  await proposed.getByRole('textbox',{name:'Operador autorizado'}).fill('Explicit owner fixture');for(const check of await proposed.getByRole('checkbox').all())await check.check();await proposed.getByRole('button',{name:'Aprobar este archivo para la hora propuesta',exact:true}).click();await page.locator('#state').filter({hasText:'fixture_no_grant_operation'}).waitFor();
  assert.deepEqual(writes,[{action:'approve',body:{id:'window-proposed',expectedDigest:'a'.repeat(64),operatorLabel:'Explicit owner fixture',attestRights:true,attestExternalQa:true,attestSourceBaseline:true,attestMembership:true}}]);assert.equal(JSON.stringify(records),before,'the display and explicit click must not rewrite the approved window or invent an actual slot');assert.deepEqual(errors,[]);
 }finally{await browser?.close();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
