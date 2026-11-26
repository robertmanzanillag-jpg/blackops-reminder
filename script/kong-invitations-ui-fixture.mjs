// Explicitly synthetic localhost-only QA. No real accounts, data, mail or production transport.
import { build } from 'esbuild';
import express from 'express';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { emptyCouncilState } from '../shared/agent-council.ts';
import { applyKongInvitationReceipt } from '../server/kong-invitation-receipts.ts';
const root=process.cwd(),out=path.join(root,'.cache/kong-invitations');
await mkdir(out,{recursive:true});
await build({stdin:{resolveDir:root,loader:'tsx',contents:`
import React from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {KongInvitationsPanel} from './client/src/components/kong-invitations-panel';
const client=new QueryClient({defaultOptions:{queries:{queryFn:async({queryKey})=>{const r=await fetch(queryKey[0],{credentials:'include'});if(!r.ok)throw Error('fixture HTTP '+r.status);return r.json()},retry:false}}});
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><main style={{padding:24,color:'white',background:'#070b16',minHeight:'100vh'}}><h1>Fixture sintética local · Invitaciones KONG</h1><p>Sin cuentas, Gmail, producción ni envíos reales.</p><button onClick={()=>fetch('/fixture/mismatch',{method:'POST'})}>Fixture: fallar siguiente relectura</button><KongInvitationsPanel/></main></QueryClientProvider>);`},bundle:true,jsx:'automatic',platform:'browser',format:'esm',outfile:path.join(out,'fixture.js'),define:{'process.env.NODE_ENV':'"production"'},logLevel:'error'});
let state=emptyCouncilState(),mismatch=false;
const app=express();app.use(express.json({limit:'32kb'}));
app.get('/api/agents-office/kong-invitations',(_req,res)=>{const receipt=state.kongInvitations??null;if(mismatch&&receipt){mismatch=false;return res.json({receipt:{...receipt,sha256:'0'.repeat(64)}})}res.set('Cache-Control','no-store').json({receipt})});
app.post('/api/agents-office/kong-invitations',(req,res)=>{try{state=applyKongInvitationReceipt(state,req.body,Date.now());res.json({receipt:state.kongInvitations,recorded:true})}catch{res.status(409).json({error:'Synthetic fixture rejected receipt'})}});
app.post('/fixture/mismatch',(_req,res)=>{mismatch=true;res.json({fixture:true})});
app.get('/api/agent-council/state',(_req,res)=>res.json({...state,fixture:true}));
app.get('/fixture.js',(_req,res)=>res.sendFile(path.join(out,'fixture.js')));
app.use('/assets',express.static(path.join(root,'dist/public/assets')));
const css=(await readdir(path.join(root,'dist/public/assets'))).find(n=>n.startsWith('index-')&&n.endsWith('.css'));
app.get('/',(_req,res)=>res.type('html').send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic KONG invitation QA</title><link rel="stylesheet" href="/assets/${css}"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`));
const server=app.listen(Number(process.env.KONG_INVITATION_FIXTURE_PORT || 0),'127.0.0.1',async()=>{
 const at=new Date().toISOString();
 const receipt={version:1,ownerId:'01a122a5-871c-7a23-b2ef-b47f34f29663',scopeId:'kong-dj-invitations',scriptId:'1sPDzL7uZvToeNr9phm8xD5YrZ5x1EBZMp5Bn-jG4igwY8F01cVKd0_kh',senderAccount:'kongnightlifeapp@gmail.com',sequence:1,previousReceiptSha256:null,runId:'synthetic-ui-fixture-1',observedAt:at,startedAt:at,completedAt:at,provenance:'manual',sourceSha256:'23c2b33e18227f49bb70aeadc93d1d250241e101af112b2eb2169abdb1fa340c',installedCodeSha256:'a'.repeat(64),evidenceSha256:'b'.repeat(64),reviewed:10,pending:10,excluded:0,admitted:0,sent:0,gmailReceiptSha256s:[],senderExecution:'none',senderPaused:true,cursor:50,fence:7,revision:4,scheduler:'active',blocker:'validation-pending'};
 const url=`http://127.0.0.1:${server.address().port}/`;
 await writeFile(path.join(out,'fixture-receipt.json'),JSON.stringify(receipt,null,2));
 await writeFile(path.join(out,'fixture-url.txt'),url);
 console.log(url);
});
