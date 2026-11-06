import {build} from 'esbuild';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
if(!process.env.AGENTS_WORLD_BROWSER) throw new Error('Use an existing Chromium executable; no downloads');
const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClientProvider} from '@tanstack/react-query';import {queryClient} from './client/src/lib/queryClient';import {OfficeConnectionsPanel} from './client/src/components/office-connections-panel';queryClient.setQueryData(['auth-me'],{authenticated:true,user:{id:'owner'}});window.changeOfficeOwner=()=>queryClient.setQueryData(['auth-me'],{authenticated:true,user:{id:'other'}});createRoot(document.getElementById('root')).render(<QueryClientProvider client={queryClient}><OfficeConnectionsPanel/></QueryClientProvider>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',alias:{'@':path.resolve('client/src'),'@shared':path.resolve('shared')},define:{'process.env.NODE_ENV':'"test"'}});
const browser=await chromium.launch({executablePath:process.env.AGENTS_WORLD_BROWSER,headless:true,args:['--disable-background-networking','--disable-sync']});
try{
 const page=await browser.newPage();let owner='owner',reads=0,legacy=false;const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());let data;
  if(url.pathname === '/')return route.fulfill({contentType:'text/html',body:'<div id="root"></div><script type="module" src="/bundle.js"></script>'});
  if(url.pathname === '/bundle.js')return route.fulfill({contentType:'text/javascript',body:bundle.outputFiles[0].text});
  if(url.pathname === '/api/auth/me')data={authenticated:true,user:{id:owner}};
  else if(url.pathname === '/api/agents-office/connections')data={workerEnabled:false,worker:{status:'blocked',reason:'Off',checkedAt:new Date().toISOString()}};
  else if(url.pathname === '/api/agents-office/runs'){reads++;if(owner!=='owner')return route.fulfill({status:403,body:'Forbidden'});data=[{id:'run318',kind:'claude_review',status:'completed',createdAt:new Date().toISOString(),text:'Persisted PR318 review'}];}
  else if(url.pathname === '/api/agent-council/internal-work'){if(owner!=='owner')return route.fulfill({status:403,body:'Forbidden'});data={jobs:[{id:'job',role:'ceo',status:'completed',startedAt:new Date().toISOString(),artifact:{text:'Private CEO saved brief'}}],academy:[{id:'training',agentId:'claude-reviewer',status:'completed',startedAt:new Date().toISOString(),benchmarkId:'heldout',assessment:{passed:false,quality:60,incumbentQuality:90,scope:'benchmark'}}]};}
  else return route.fulfill({status:503,body:'Unavailable fixture'});
  if(legacy && url.pathname === '/api/agent-council/internal-work')delete data.academy;
  return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('http://office-history.invalid/');await page.getByRole('button',{name:'Trabajo real',exact:true}).click();
 await page.getByText('Persisted PR318 review',{exact:true}).waitFor();assert.equal(reads,1);
 await page.getByText('CEO · Completada',{exact:false}).click();await page.getByText('Private CEO saved brief',{exact:true}).waitFor();
 await page.getByText('Evaluación de prueba: no superada',{exact:false}).waitFor();
 legacy=true;await page.reload();await page.getByRole('button',{name:'Trabajo real',exact:true}).click();await page.getByText('Persisted PR318 review',{exact:true}).waitFor();assert.ok(reads>=2);await page.getByText('Sin evaluaciones de academia ejecutadas.',{exact:true}).waitFor();
 owner='other';await page.evaluate(()=>window.changeOfficeOwner());await page.getByText('No se pudo leer el historial de ejecuciones.',{exact:true}).waitFor();
 assert.equal(await page.getByText('Persisted PR318 review',{exact:true}).count(),0);assert.equal(await page.getByText('Private CEO saved brief',{exact:true}).count(),0);assert.deepEqual(errors,[]);
 console.log('PASS persisted history while worker off, reload, internal/academy rendering, owner switch isolation');
}finally{await browser.close();}
