import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {withFactoryApiParent} from '../server/factory-api-context';
import {createFactoryApiInvocation} from '../server/factory-api-invocation';
import {createFactoryOpenAiTransport} from '../server/software-factory-openai-transport';
import {createFactoryOpenAiCountTransport,routeFactoryOpenAiRequests} from '../server/software-factory-openai-count';
import {createOpenAiFactoryTextProvider} from '../server/software-factory-openai';
import {emptyFactoryApiState,checkpointFactoryApiMonth,reserveFactoryApi,settleFactoryApi,unknownFactoryApi,factoryApiExecutionWindow,factoryApiBudgetStatus} from '../server/software-factory-api-budget';
const now='2026-11-22T12:00:00.000Z',owner='synthetic-owner',model='gpt-6.1-sol',key='sk-proj-'+'x'.repeat(50);
const price={model,inputNanoUsdPerToken:2000,outputNanoUsdPerToken:10000,cachedInputNanoUsdPerToken:100,
 cacheWrite30mNanoUsdPerToken:2500,cacheWrite12hNanoUsdPerToken:5000,maxInputTokens:272000,
 validUntil:'2027-01-01T00:00:00.000Z',evidenceSha256:'a'.repeat(64)};
function fixture(delayAfterReserveMs=0){
 let clock=Date.parse(now);const current=()=>new Date(clock).toISOString();
 const job={id:randomUUID(),fence:randomUUID(),status:'running',ownerKey:createHash('sha256').update(owner).digest('hex')} as any;
 const state=emptyFactoryApiState(),exposure={configured:true,fixedCents:0,spentCents:0,reservedCents:10,unknown:false,
  parents:[{jobId:job.id,fence:job.fence,status:'running',maximumCents:10,leaseExpiresAt:'2026-11-22T12:05:00.000Z'}]};
 checkpointFactoryApiMonth(state,exposure,{month:'2026-11',reconciledAt:now,externalSpentMicroUsd:0,externalReservedMicroUsd:0,externalUnknownReservations:0,complete:true,evidenceSha256:'b'.repeat(64)},now);
 const invoke=createFactoryApiInvocation({owner:()=>owner,now:()=>new Date(clock),store:{
  async apiBudgetStatus(){return factoryApiBudgetStatus(state,exposure,now);},
  async reserveApi(_owner,input){const result=reserveFactoryApi(state,exposure,input,current());clock+=delayAfterReserveMs;return result;},
  async settleApi(_owner,id,input){return settleFactoryApi(state,id,input,now);},
  async unknownApi(_owner,id){unknownFactoryApi(state,id);},
  async executionWindowApi(_owner,id){return factoryApiExecutionWindow(state,exposure,id,current());},
 }});return {job,state,invoke};
}
const generation=(input=7000)=>({object:'response',id:'resp_synthetic',model,status:'completed',
 output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'bounded result'}]}],
 usage:{input_tokens:input,output_tokens:5,total_tokens:input+5,input_tokens_details:{cached_tokens:0,cache_write_tokens:0}}});
function provider(f:ReturnType<typeof fixture>,trusted=true,actual=7000){
 let counted=0,paid=0;
 const raw=(async(url)=>{if(String(url).endsWith('/input_tokens')){counted++;return Response.json({object:'response.input_tokens',input_tokens:7000});}paid++;return Response.json(generation(actual));}) as typeof fetch;
 const count=trusted?createFactoryOpenAiCountTransport(key,raw):async()=>{counted++;return Response.json({object:'response.input_tokens',input_tokens:7000});};
 const request=routeFactoryOpenAiRequests(createFactoryOpenAiTransport(key,raw,{price,invoke:f.invoke}),count);
 const generate=createOpenAiFactoryTextProvider({request,apiPrice:price,model,inputNanoUsdPerToken:2000,outputNanoUsdPerToken:10000,
  pricingValidUntil:price.validUntil,now:()=>new Date(now),maxInputTokens:272000});
 return {run:()=>withFactoryApiParent(f.job,()=>generate({instructions:'Select a bounded file set',text:'x'.repeat(28000),maxOutputTokens:1024,maxCostCents:10,signal:new AbortController().signal})),calls:()=>({counted,paid})};
}
test('trusted exact free count admits legitimate long text within unchanged 10-cent parent escrow',async()=>{
 const f=fixture(),p=provider(f);const result=await p.run();
 assert.equal(result.status,'completed');assert.deepEqual(p.calls(),{counted:1,paid:1});
 assert.equal(f.state.reservations.length,1);assert.equal(f.state.reservations[0].maximumMicroUsd,45240);
 assert.equal(f.state.reservations[0].actualMicroUsd,14050);assert.equal(f.state.reservations[0].status,'settled');
 assert.equal(result.costCents,2);
});
test('ordinary injected count response cannot mint proof or enlarge the existing parent escrow',async()=>{
 const f=fixture(),p=provider(f,false);const result=await p.run();
 assert.equal(result.status,'blocked');assert.deepEqual(p.calls(),{counted:1,paid:0});assert.equal(f.state.reservations.length,0);
});
test('paid usage differing from the exact count retains escrow and prevents paid replay',async()=>{
 const f=fixture(),p=provider(f,true,7001);const result=await p.run();
 assert.equal(result.status,'unknown');assert.deepEqual(p.calls(),{counted:1,paid:1});
 assert.equal(f.state.reservations[0].status,'unknown');assert.equal(f.state.reservations[0].actualMicroUsd,undefined);
 await p.run();assert.equal(p.calls().paid,1);
});


test('a receipt cannot outlive a slow monetary admission before paid dispatch',async()=>{
 const f=fixture(120001),p=provider(f);await p.run();
 assert.deepEqual(p.calls(),{counted:1,paid:0});
 assert.equal(f.state.reservations[0].status,'unknown');
});


test('counted admission cannot charge an explicit parent different from the current scope',async()=>{
 const f=fixture();await assert.rejects(withFactoryApiParent(f.job,()=>f.invoke({consumer:'other',
  requestSha256:'c'.repeat(64),price,promptBytes:28000,maxOutputTokens:1024,cacheWriteCoverage:true,
  countedInput:{inputTokens:7000,evidenceSha256:'d'.repeat(64),remainingMs:120000},
  parent:{jobId:randomUUID(),fence:randomUUID()},call:async()=>{throw Error('must not call');},
  usage:()=>{throw Error('must not read');}})),/PARENT_CONTEXT_MISMATCH/);
 assert.equal(f.state.reservations.length,0);
});
