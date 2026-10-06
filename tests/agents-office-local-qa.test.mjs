import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import express from 'express';
import { chromium } from 'playwright';
import { mkdtemp, rm, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// This fixture never replaces the production DatabaseStorage or connects external apps.
test('office local QA: actual sessions, owner isolation and native scouts with fixture storage', async () => {
 const temp=await mkdtemp(path.join(process.cwd(),'.local-office-qa-'));
 const envKeys=['NODE_ENV','ALLOW_DEV_USER_FALLBACK','DEFAULT_USER_ID','APP_QA_BASE_URL','APP_QA_VISUAL_MODE'];
 const previous=new Map(envKeys.map(k=>[k,process.env[k]]));
 process.env.NODE_ENV='test';process.env.ALLOW_DEV_USER_FALLBACK='false';process.env.DEFAULT_USER_ID='fixture-owner';process.env.APP_QA_VISUAL_MODE='off';
 let browser,server;const users=new Map();const requests=[];
 globalThis.__officeLocalStorage={
  getUser:async id=>users.get(id),getUserByUsername:async name=>[...users.values()].find(u=>u.username===name),
  checkPersistentRateLimit:async()=>({allowed:true,remaining:19,resetAt:Date.now()+900000}),
  getAppProjects:async()=>[{id:'local-office',name:'Agents Office · LOCAL FIXTURE',environment:'development',priority:'low',status:'healthy',tags:[],publicUrl:globalThis.__officeLocalBase+'/agents-office',healthUrl:globalThis.__officeLocalBase+'/health',testCommand:'node --test tests/agents-office-local-qa.test.mjs',buildCommand:'npm run build'}],
  getAppHealthChecks:async()=>[],getAppIncidentsForProject:async()=>[],getAppErrorEvents:async()=>[],
  getTelegramConfig:async()=>{throw new Error('Passive local QA must not read external delivery settings');}
 };
 const modules={
  './storage':'export const storage=globalThis.__officeLocalStorage;',
  './github-client':'export const isGitHubConnected=async()=>true;export const listRepositories=async()=>[];',
  './telegram':'export const escapeTelegramHtml=v=>String(v);export const sendTelegramMessage=async()=>{throw new Error("No external delivery allowed");};export const sendTelegramPhoto=sendTelegramMessage;',
  './automation-registry':'export const recordScheduledAutomationRun=async()=>{throw new Error("No history writes allowed");};',
  './developer-autopilot':'export const createDeveloperAutopilotHandoff=async()=>{throw new Error("No remote handoff allowed");};'
 };
 try {
  await build({stdin:{contents:`export {registerLocalAuthRoutes,hashPassword} from './server/local-auth';export {createSessionMiddleware} from './server/session-config';export {resolveCurrentUserId} from './server/user-context';export {isConfiguredSingleUserOwner} from './server/single-user-owner';export {runAppQaScan,runVisualClickScout,__appQaAgentInternals} from './server/app-qa-agent';`,resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',packages:'external',outfile:path.join(temp,'runtime.mjs'),plugins:[{name:'local-storage-only',setup(builder){builder.onResolve({filter:/^\.\/(storage|github-client|telegram|automation-registry|developer-autopilot)$/},args=>({path:args.path,namespace:'fixture'}));builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:modules[args.path],loader:'js'}));}}]});
  const runtime=await import(pathToFileURL(path.join(temp,'runtime.mjs')).href);
  const fixturePassword='local-fixture-password';
  for(const id of ['fixture-owner','fixture-member'])users.set(id,{id,username:id,password:await runtime.hashPassword(fixturePassword)});
  const app=express();app.use(express.json());app.use(runtime.createSessionMiddleware({enabled:true,secret:'isolated-fixture-session-key',storeKind:'memory',production:false,secureCookie:false}));
  runtime.registerLocalAuthRoutes(app);
  app.get('/health',(_req,res)=>res.json({status:'ok',scope:'fixture-memory-only'}));
  app.use('/api',async(req,res,next)=>{requests.push({method:req.method,path:req.path});const id=runtime.resolveCurrentUserId(req);if(!id)return res.status(401).json({error:'Authentication required'});req.fixtureUserId=id;next();});
  app.get('/api/fixture-owner-boundary',async(req,res)=>{if(!await runtime.isConfiguredSingleUserOwner(req.fixtureUserId))return res.status(403).json({error:'Owner only'});res.json({scope:'fixture owner'});});
  app.get('/api/monthly-goals',(req,res)=>res.json([{id:req.fixtureUserId+'-goal',title:'Meta LOCAL · '+req.fixtureUserId,completed:false}]));
  app.get('/api/projects',(_req,res)=>res.json([]));app.get('/api/legal-compliance/reports',(_req,res)=>res.json({reports:[],summary:{critico:0,revisar:0,info:0}}));
  app.use('/api',(req,res)=>req.method==='GET'?res.json([]):res.status(403).json({error:'Mutation outside local QA scope'}));
  // Serve the actual production build, not a dev proxy with HMR noise.
  await access(path.resolve('dist/public/index.html'));
  app.use(express.static(path.resolve('dist/public')));
  app.use((req,res,next)=>['GET','HEAD'].includes(req.method)?res.sendFile(path.resolve('dist/public/index.html')):next());
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const base='http://127.0.0.1:'+server.address().port;globalThis.__officeLocalBase=base;process.env.APP_QA_BASE_URL=base;
  assert.equal((await fetch(base+'/api/monthly-goals',{headers:{'x-user-id':'fixture-owner'}})).status,401);
  const login=async username=>{const response=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password:fixturePassword})});assert.equal(response.status,200);return response.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');};
  const ownerCookie=await login('fixture-owner');const memberCookie=await login('fixture-member');
  assert.equal((await fetch(base+'/api/fixture-owner-boundary',{headers:{cookie:ownerCookie}})).status,200);
  assert.equal((await fetch(base+'/api/fixture-owner-boundary',{headers:{cookie:memberCookie}})).status,403);
  const memberGoals=await (await fetch(base+'/api/monthly-goals',{headers:{cookie:memberCookie}})).json();assert.equal(memberGoals[0].id,'fixture-member-goal');
  assert.equal((await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'fixture-owner',password:'wrong-password'})})).status,401);
  assert.equal((await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json',origin:'https://wrong-origin.invalid'},body:JSON.stringify({username:'fixture-owner',password:fixturePassword})})).status,403);
  browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:1440,height:1080},reducedMotion:'reduce'});await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.fulfill({status:200,contentType:'text/css',body:''}));const page=await context.newPage();page.setDefaultTimeout(8000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('blackops-local-auth-user',JSON.stringify({id:'fixture-owner',username:'fixture-owner'})));
  await page.goto(base+'/agents-office');await page.getByLabel('Usuario',{exact:true}).waitFor();assert.equal(await page.locator('.company-office').count(),0);
  await page.getByLabel('Usuario',{exact:true}).fill('fixture-member');await page.getByLabel('Password',{exact:true}).fill(fixturePassword);await page.getByRole('button',{name:'Entrar',exact:true}).last().click();
  await page.getByRole('heading',{name:'Tu empresa, en movimiento.'}).waitFor();await page.getByText(/Meta LOCAL · fixture-member/).waitFor();
  await page.getByRole('navigation',{name:'Departamentos'}).getByRole('button',{name:/Ingeniería/}).click();await page.getByRole('button',{name:'App QA',exact:true}).click();
  await page.screenshot({path:'/workspace/office-evidence/integrated-session-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'/workspace/office-evidence/integrated-session-mobile.png',fullPage:true});
  await page.route('**/api/auth/logout',route=>route.fulfill({status:503,json:{error:'Fixture logout unavailable'}}));await page.getByRole('button',{name:'Salir',exact:true}).click();await page.getByRole('alert').filter({hasText:/No se pudo cerrar/}).waitFor();assert.equal(await page.locator('.company-office').count(),1);await page.unroute('**/api/auth/logout');
  await page.getByRole('button',{name:'Salir',exact:true}).click();await page.getByLabel('Usuario',{exact:true}).waitFor();assert.equal(await page.locator('.company-office').count(),0);assert.equal((await context.request.get(base+'/api/monthly-goals')).status(),401);assert.deepEqual(errors,[]);
  await context.close();await browser.close();browser=null;
  const passive=await runtime.runAppQaScan('fixture-owner',false,false,false);assert.equal(passive.failCount,0);assert.equal(passive.telegramSent,false);assert.equal(passive.dailyDigestSent,false);
  for(const id of ['route-scout','link-click-scout','api-scout','error-scout'])assert.equal(passive.subAgents.find(s=>s.id===id).status,'pass');
  // Native visual scout gets an actual logged-in session via its existing dependency seam.
  const nativePlaywright={chromium:{launch:async options=>{const real=await chromium.launch({...options,executablePath:'/usr/bin/chromium'});const original=real.newContext.bind(real);real.newContext=async settings=>{const ctx=await original(settings);await ctx.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.fulfill({status:200,contentType:'text/css',body:''}));const response=await ctx.request.post(base+'/api/auth/login',{data:{username:'fixture-member',password:fixturePassword}});assert.equal(response.status(),200);return ctx;};return real;}}};
  const officeRoute=runtime.__appQaAgentInternals.LOCAL_ROUTE_MAP.filter(r=>r.path==='/agents-office');
  const visual=await runtime.runVisualClickScout(officeRoute,{loadPlaywright:async()=>nativePlaywright});
  await writeFile('/workspace/office-evidence/integrated-app-qa-local.json',JSON.stringify({scope:'LOCAL memory fixtures; no production DB, GitHub or telemetry certified',passive,visual,requests},null,2));
  assert.equal(visual.status,'pass',JSON.stringify(visual.findings));assert.deepEqual(visual.visualScans.flatMap(s=>s.consoleErrors),[]);
 } finally {
  if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));for(const [k,v]of previous){if(v===undefined)delete process.env[k];else process.env[k]=v;}delete globalThis.__officeLocalStorage;delete globalThis.__officeLocalBase;await rm(temp,{recursive:true,force:true});
 }
});
