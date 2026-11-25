import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {withFactoryApiParent} from '../server/factory-api-context';
import {createFactoryApiInvocation,configuredFactoryApiPrice} from '../server/factory-api-invocation';
import {createFactoryOpenAiTransport} from '../server/software-factory-openai-transport';
import {createFactoryOpenAiCountTransport,routeFactoryOpenAiRequests} from '../server/software-factory-openai-count';
import {createOpenAiFactoryTextProvider} from '../server/software-factory-openai';
import {createOpenAiFactoryPatchGenerator} from '../server/software-factory-openai-builder';
import {factoryPatchDiagnostics} from '../server/software-factory-builder';
import {emptyFactoryApiState,checkpointFactoryApiMonth,reserveFactoryApi,settleFactoryApi,unknownFactoryApi,factoryApiExecutionWindow,factoryApiBudgetStatus} from '../server/software-factory-api-budget';

// Exact production runtime of the 2026-11-25T05:11Z build: operator catalog
// FACTORY_API_PRICING_CONFIG, shared-credit pricing gpt-6.1-sol $2/$10 valid
// until 2026-12-31, build reservation 100 cents, maxOutputTokens 16000.
const now='2026-11-25T05:11:42.000Z',owner='synthetic-owner',model='gpt-6.1-sol',key='sk-proj-'+'x'.repeat(50);
const catalog=JSON.stringify({version:1,prices:[{provider:'openai',model,inputNanoUsdPerToken:2000,outputNanoUsdPerToken:10000,cachedInputNanoUsdPerToken:100,
 cacheWrite30mNanoUsdPerToken:2500,cacheWrite12hNanoUsdPerToken:5000,maxInputTokens:272000,validUntil:'2026-12-31T23:59:59.000Z',evidenceSha256:'1'.repeat(64)}]});
const shared={model,inputNanoUsdPerToken:2000,outputNanoUsdPerToken:10000,validUntil:'2026-12-31T23:59:59.000Z'};

function runtime(checkpoint:boolean){
 const job={id:randomUUID(),fence:randomUUID(),status:'running',ownerKey:createHash('sha256').update(owner).digest('hex')} as any;
 // Production status: Factory month row exists (spent 66 cents), the build escrow is running.
 const state=emptyFactoryApiState(),exposure={configured:true,fixedCents:0,spentCents:66,reservedCents:100,unknown:false,
  parents:[{jobId:job.id,fence:job.fence,status:'running',maximumCents:100,leaseExpiresAt:'2026-11-25T05:21:42.000Z'}]};
 if(checkpoint)checkpointFactoryApiMonth(state,exposure,{month:'2026-11',reconciledAt:now,externalSpentMicroUsd:0,externalReservedMicroUsd:0,externalUnknownReservations:0,complete:true,evidenceSha256:'b'.repeat(64)},now);
 const invoke=createFactoryApiInvocation({owner:()=>owner,now:()=>new Date(now),store:{
  async apiBudgetStatus(){return factoryApiBudgetStatus(state,exposure,now);},
  async reserveApi(_o,input){return reserveFactoryApi(state,exposure,input,now);},
  async settleApi(_o,id,input){return settleFactoryApi(state,id,input,now);},
  async unknownApi(_o,id){unknownFactoryApi(state,id);},
  async executionWindowApi(_o,id){return factoryApiExecutionWindow(state,exposure,id,now);},
 }});
 const calls={counted:0,paid:0};
 const raw=(async(url:string,init:RequestInit)=>{
  if(String(url).endsWith('/input_tokens')){calls.counted++;return Response.json({object:'response.input_tokens',input_tokens:40000});}
  calls.paid++;const body=JSON.parse(String(init.body));
  return Response.json({object:'response',id:'resp_x',model,status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'{"edits":[]}'}]}],
   usage:{input_tokens:40000,output_tokens:10,total_tokens:40010,input_tokens_details:{cached_tokens:0,cache_write_tokens:0}},_max:body.max_output_tokens});
 }) as typeof fetch;
 // Same composition as software-factory-asistente-operator.ts (catalog configured).
 const price=configuredFactoryApiPrice('openai',shared.model,catalog);
 const request=routeFactoryOpenAiRequests(createFactoryOpenAiTransport(key,raw,{price,invoke}),createFactoryOpenAiCountTransport(key,raw));
 const generateText=createOpenAiFactoryTextProvider({request,apiPrice:price,model:shared.model,inputNanoUsdPerToken:shared.inputNanoUsdPerToken,
  outputNanoUsdPerToken:shared.outputNanoUsdPerToken,pricingValidUntil:shared.validUntil,now:()=>new Date(now),maxInputTokens:100000});
 return {job,state,calls,generateText};
}
async function build(r:ReturnType<typeof runtime>){
 const workspace=await mkdtemp(path.join(tmpdir(),'fbr-'));await mkdir(path.join(workspace,'tests'));
 await writeFile(path.join(workspace,'tests/a.test.ts'),'export {};\n');
 const generate=createOpenAiFactoryPatchGenerator({generateText:r.generateText,sourcePaths:{'o/r':['tests/a.test.ts']},maxOutputTokens:16000,patchMode:'exactSourceEdits'});
 return withFactoryApiParent(r.job,()=>generate({repository:'o/r',baseSha:'a'.repeat(40),request:'fix'} as any,{workspace,maxCostCents:100,signal:new AbortController().signal}));
}

test('this exact pricing config is accepted: with a Factory API month checkpoint the build dispatches',async()=>{
 const r=runtime(true),out=await build(r);
 assert.deepEqual(r.calls,{counted:1,paid:1});
 assert.ok(!String(out.diagnostic).startsWith('PROVIDER_'));
});
test('without the 2026-11 Factory API checkpoint the build is held pre-dispatch with its exact code',async()=>{
 const r=runtime(false),out=await build(r);
 assert.deepEqual(r.calls,{counted:1,paid:0});assert.equal(r.state.reservations.length,0);
 assert.deepEqual(out,{patch:'',costCents:0,diagnostic:'PROVIDER_ADMISSION_UNAVAILABLE',cause:'FACTORY_API_RECONCILIATION_REQUIRED'});
 assert.ok((factoryPatchDiagnostics as readonly string[]).includes(out.diagnostic!));
});
