import test from 'node:test';
import assert from 'node:assert/strict';
import {createFactoryApiInvocation} from '../server/factory-api-invocation';
import {guardFactoryOpenAiClient,guardFactoryOpenAiFetch} from '../server/factory-api-sdk';
import {readOpenAiCacheUsage} from '../server/factory-api-cache-usage';
import {emptyFactoryApiState,checkpointFactoryApiMonth,reserveFactoryApi,settleFactoryApi,unknownFactoryApi,factoryApiExecutionWindow,factoryApiBudgetStatus} from '../server/software-factory-api-budget';
const now='2026-11-22T12:00:00.000Z',owner='synthetic-owner',model='gpt-6.1-sol';
const price={model,maxInputTokens:1_049_600,inputNanoUsdPerToken:2000,outputNanoUsdPerToken:10000,cachedInputNanoUsdPerToken:100,
 cacheWrite30mNanoUsdPerToken:2500,cacheWrite12hNanoUsdPerToken:5000,validUntil:'2027-01-01T00:00:00.000Z',evidenceSha256:'a'.repeat(64)};
const body=()=>({model,input:'synthetic text',max_output_tokens:32});
const details=(cached=0,short=0,long=0)=>({cached_tokens:cached,cache_write_tokens:short+long,
 ...(short+long?{cache_write_tokens_details:{ttl_30m_tokens:short,ttl_12h_tokens:long}}:{})});
const response=(inputDetails:any=details())=>({id:'resp_synthetic',model,status:'completed',output:[],
 usage:{input_tokens:100,output_tokens:10,total_tokens:110,input_tokens_details:inputDetails}});
function fixture(complete=true,beforeSettle?:()=>void){
 const state=emptyFactoryApiState(),exposure={configured:true,fixedCents:0,spentCents:0,reservedCents:0,unknown:false,parents:[]};
 if(complete)checkpointFactoryApiMonth(state,exposure,{month:'2026-11',reconciledAt:now,externalSpentMicroUsd:0,externalReservedMicroUsd:0,externalUnknownReservations:0,complete:true,evidenceSha256:'b'.repeat(64)},now);
 const reserved:any[]=[],settled:any[]=[];
 const invoke=createFactoryApiInvocation({owner:()=>owner,now:()=>new Date(now),store:{
  async apiBudgetStatus(){return factoryApiBudgetStatus(state,exposure,now);},
  async reserveApi(_owner,input){reserved.push(structuredClone(input));return reserveFactoryApi(state,exposure,input,now);},
  async executionWindowApi(_owner,key){return factoryApiExecutionWindow(state,exposure,key,now);},
  async settleApi(_owner,key,input){settled.push(structuredClone(input));beforeSettle?.();return settleFactoryApi(state,key,input,now);},
  async unknownApi(_owner,key){unknownFactoryApi(state,key);},
 }});
 return {state,exposure,reserved,settled,invoke};
}
function client(f:ReturnType<typeof fixture>,result:any,profile:any=price,env:any={}){
 let calls=0,received:any;
 const guarded=guardFactoryOpenAiClient({responses:{async create(value:any){calls++;received=value;return result;}}},{provider:'openai',consumer:'other',invoke:f.invoke,price:()=>profile,env});
 return {create:()=>guarded.responses.create(body()),calls:()=>calls,received:()=>received};
}

test('zero, cached reads, 30m, 12h and mixed inputs settle every bucket once in exact microUSD',async()=>{
 for(const [cache,expected] of [[details(),300],[details(40),224],[details(0,50),325],[details(0,0,50),450],[details(20,40,20),342]] as const){
  const f=fixture(),c=client(f,response(cache));await c.create();
  assert.equal(c.calls(),1);assert.equal(c.received().service_tier,'default');
  assert.equal(f.settled[0].actualMicroUsd,expected);assert.equal(f.state.reservations[0].status,'settled');
  const encoded=JSON.stringify(c.received()),maximum=(BigInt(Buffer.byteLength(encoded)+1024)*5000n+32n*10000n+999n)/1000n;
  assert.equal(f.reserved[0].maximumMicroUsd,Number(maximum));
 }
});

test('missing cache prices, mismatched profile and missing checkpoint make zero provider calls',async()=>{
 for(const incomplete of [{...price,maxInputTokens:undefined},{...price,cacheWrite30mNanoUsdPerToken:undefined},{...price,cacheWrite12hNanoUsdPerToken:undefined},{...price,cachedInputNanoUsdPerToken:undefined}]){
  const f=fixture(),c=client(f,response(),incomplete);await assert.rejects(c.create(),/CACHE_WRITE_PRICING_UNVERIFIED/);assert.equal(c.calls(),0);assert.equal(f.reserved.length,0);
 }
 const mismatch=fixture(),c=client(mismatch,response(),{model,inputNanoUsdPerToken:2000,outputNanoUsdPerToken:10000,validUntil:price.validUntil,evidenceSha256:price.evidenceSha256},{FACTORY_API_PRICING_CONFIG:JSON.stringify({version:1,prices:[{provider:'openai',...price,inputNanoUsdPerToken:3000}]})});
 await assert.rejects(c.create(),/PRICING_PROFILE_MISMATCH/);assert.equal(c.calls(),0);
 const f=fixture(false),held=client(f,response());await assert.rejects(held.create(),/RECONCILIATION_REQUIRED/);assert.equal(held.calls(),0);
});

test('one whole approved catalog migrates a partial legacy profile without mixing rates or evidence',async()=>{
 const f=fixture(),legacy={model,inputNanoUsdPerToken:2000,outputNanoUsdPerToken:10000,validUntil:price.validUntil,evidenceSha256:'c'.repeat(64)};
 const c=client(f,response(details(20,40,20)),legacy,{FACTORY_API_PRICING_CONFIG:JSON.stringify({version:1,prices:[{provider:'openai',...price}]})});
 await c.create();assert.equal(f.settled[0].actualMicroUsd,342);assert.equal(c.calls(),1);
});

test('missing, inconsistent, unknown TTL or overlapping measured counters retain unknown full escrow',async()=>{
 const bad=[{cached_tokens:0},{cached_tokens:0,cache_write_tokens:10},
  {cached_tokens:0,cache_write_tokens:10,cache_write_tokens_details:{ttl_30m_tokens:5,ttl_12h_tokens:4}},
  {cached_tokens:80,cache_write_tokens:30,cache_write_tokens_details:{ttl_30m_tokens:30,ttl_12h_tokens:0}},
  {cached_tokens:0,cache_write_tokens:5,cache_write_tokens_details:{ttl_30m_tokens:0,ttl_12h_tokens:0,ttl_24h_tokens:5}},
  {...details(),audio_tokens:1}];
 for(const cache of bad){const f=fixture(),c=client(f,response(cache));await assert.rejects(c.create(),/EXECUTION_UNCONFIRMED/);
  assert.equal(f.state.reservations[0].status,'unknown');assert.equal(f.state.reservations[0].maximumMicroUsd,f.reserved[0].maximumMicroUsd);
  await assert.rejects(c.create(),/UNKNOWN_HOLD/);assert.equal(c.calls(),1);
 }
});

test('TTL split and exact raw details bind the receipt; pricing evidence binds the reservation',async()=>{
 const a=fixture(),b=fixture(),c=fixture();await client(a,response(details(20,40,20))).create();await client(b,response(details(20,20,40))).create();
 await client(c,response(details(20,40,20)),{...price,evidenceSha256:'d'.repeat(64)}).create();
 assert.notEqual(a.settled[0].evidenceSha256,b.settled[0].evidenceSha256);assert.notEqual(a.reserved[0].requestSha256,c.reserved[0].requestSha256);
 const raw=details(20,40,20),parsed=readOpenAiCacheUsage(raw);assert.match(parsed.inputTokenDetailsSha256,/^[a-f0-9]{64}$/);
 assert.notEqual(parsed.inputTokenDetailsSha256,readOpenAiCacheUsage(details(20,20,40)).inputTokenDetailsSha256);
});

test('request-side cache TTL overrides remain refused before SDK or reservation',async()=>{
 const f=fixture();let calls=0;const sdk=guardFactoryOpenAiClient({responses:{async create(){calls++;return response();}}},{provider:'openai',invoke:f.invoke,price:()=>price});
 for(const value of [{...body(),prompt_cache_options:{ttl:'12h'}},{...body(),input:[{role:'user',content:[{type:'input_text',text:'x',cache_control:{ttl:'12h'}}]}]}])await assert.rejects(sdk.responses.create(value),/OPERATION_UNPRICED/);
 assert.equal(calls,0);assert.equal(f.reserved.length,0);
});

test('raw fetch uses the same worst-case reservation and measured cache settlement',async()=>{
 const f=fixture();let calls=0,received:any;const guarded=guardFactoryOpenAiFetch((async(_url,init)=>{calls++;received=JSON.parse(String(init?.body));return Response.json(response(details(20,40,20)));}) as typeof fetch,{price,invoke:f.invoke,consumer:'other'});
 const result=await guarded('https://api.openai.com/v1/responses',{method:'POST',body:JSON.stringify(body())});
 assert.equal(result.status,200);assert.equal(calls,1);assert.equal(received.service_tier,'default');assert.equal(f.settled[0].actualMicroUsd,342);
});


test('falsy tiers and malformed stream/tools cannot escape default-tier text pricing',async()=>{
 for(const service_tier of [null,false,0,'','auto','priority']){
  const f=fixture();let calls=0;
  const sdk=guardFactoryOpenAiClient({responses:{async create(){calls++;return response();}}},{provider:'openai',invoke:f.invoke,price:()=>price});
  await assert.rejects(sdk.responses.create({...body(),service_tier}),/OPERATION_UNPRICED/);
  const raw=guardFactoryOpenAiFetch((async()=>{calls++;return Response.json(response());}) as typeof fetch,{price,invoke:f.invoke});
  await assert.rejects(raw('https://api.openai.com/v1/responses',{method:'POST',body:JSON.stringify({...body(),service_tier})}),/OPERATION_UNPRICED/);
  assert.equal(calls,0);assert.equal(f.reserved.length,0);
 }
 const f=fixture();let calls=0;const sdk=guardFactoryOpenAiClient({responses:{async create(){calls++;return response();}}},{provider:'openai',invoke:f.invoke,price:()=>price});
 for(const extra of [{stream:null},{stream:0},{tools:{}},{tools:''},{modalities:{}}])await assert.rejects(sdk.responses.create({...body(),...extra}),/OPERATION_UNPRICED/);
 assert.equal(calls,0);
});

test('positive or unknown output dimensions remain unknown instead of settling as text',async()=>{
 for(const output_tokens_details of [{audio_tokens:1},{image_tokens:1},{reasoning_tokens:11},{rejected_prediction_tokens:1},{new_charge_tokens:0}]){
  const f=fixture(),value=response();(value.usage as any).output_tokens_details=output_tokens_details;
  const c=client(f,value);await assert.rejects(c.create(),/EXECUTION_UNCONFIRMED/);
  assert.equal(f.state.reservations[0].status,'unknown');assert.equal(f.settled.length,0);
 }
 const f=fixture(),value=response();(value.usage as any).output_tokens_details={reasoning_tokens:5,audio_tokens:0};
 await client(f,value).create();assert.equal(f.settled[0].actualMicroUsd,300);
});


test('provider JSON is detached before settlement and request ID metadata is preserved',async()=>{
 const value=response(details(20,40,20));Object.defineProperty(value,'_request_id',{value:'req_synthetic',enumerable:false});
 const f=fixture(true,()=>{value.usage.input_tokens_details=details(0,0,100);});
 const returned=await client(f,value).create();
 assert.deepEqual(returned.usage.input_tokens_details,details(20,40,20));
 assert.equal((returned as any)._request_id,'req_synthetic');assert.equal(f.settled[0].actualMicroUsd,342);
});

test('explicit returned unsupported tier is unknown even when the request pinned default',async()=>{
 for(const service_tier of ['priority','auto',null,false]){
  const f=fixture(),value={...response(),service_tier};await assert.rejects(client(f,value).create(),/EXECUTION_UNCONFIRMED/);
  assert.equal(f.state.reservations[0].status,'unknown');assert.equal(f.settled.length,0);
 }
});

test('fractional microUSD buckets round once across the complete measured sum',async()=>{
 const f=fixture(),value=response(details(1,1,1));value.usage.input_tokens=4;value.usage.output_tokens=1;value.usage.total_tokens=5;
 await client(f,value,{...price,inputNanoUsdPerToken:1,outputNanoUsdPerToken:1,cachedInputNanoUsdPerToken:1,cacheWrite30mNanoUsdPerToken:1,cacheWrite12hNanoUsdPerToken:1}).create();
 assert.equal(f.settled[0].actualMicroUsd,1);
});


test('the full request input bound must fit the explicit priced tier before any paid dispatch',async()=>{
 const maximumInput=Buffer.byteLength(JSON.stringify({...body(),service_tier:'default'}))+1024;
 const f=fixture(),allowed=client(f,response(),{...price,maxInputTokens:maximumInput});await allowed.create();assert.equal(allowed.calls(),1);
 const tooSmall=fixture(),held=client(tooSmall,response(),{...price,maxInputTokens:maximumInput-1});
 await assert.rejects(held.create(),/INPUT_TIER_UNVERIFIED/);assert.equal(held.calls(),0);assert.equal(tooSmall.reserved.length,0);
 const invalid=fixture(),value=response();value.usage.input_tokens=maximumInput+1;value.usage.total_tokens=maximumInput+11;
 await assert.rejects(client(invalid,value,{...price,maxInputTokens:maximumInput}).create(),/EXECUTION_UNCONFIRMED/);
 assert.equal(invalid.state.reservations[0].status,'unknown');
});


test('usage outside the request envelope or inconsistent total remains unknown even if escrow could cover it',async()=>{
 for(const change of [{output_tokens:33,total_tokens:133},{input_tokens:2000,total_tokens:2010},{total_tokens:111}]){
  const f=fixture(),value=response();Object.assign(value.usage,change);
  await assert.rejects(client(f,value).create(),/EXECUTION_UNCONFIRMED/);
  assert.equal(f.state.reservations[0].status,'unknown');assert.equal(f.settled.length,0);
 }
});


test('unverified integration protocols hold before reservation or provider dispatch',async()=>{
 const f=fixture();let calls=0;
 const sdk=guardFactoryOpenAiClient({responses:{async create(){calls++;return response();}}},{provider:'integration',invoke:f.invoke,price:()=>price});
 await assert.rejects(sdk.responses.create(body()),/INTEGRATION_PROTOCOL_UNVERIFIED/);
 assert.equal(calls,0);assert.equal(f.reserved.length,0);
});

test('partial profile migration cannot replace an explicitly supplied cache rate or input tier',async()=>{
 for(const changed of [{cachedInputNanoUsdPerToken:99},{maxInputTokens:10000}]){
  const f=fixture(),legacy={model,inputNanoUsdPerToken:2000,outputNanoUsdPerToken:10000,validUntil:price.validUntil,evidenceSha256:price.evidenceSha256,...changed};
  const c=client(f,response(),legacy,{FACTORY_API_PRICING_CONFIG:JSON.stringify({version:1,prices:[{provider:'openai',...price}]})});
  await assert.rejects(c.create(),/PRICING_PROFILE_MISMATCH/);assert.equal(c.calls(),0);assert.equal(f.reserved.length,0);
 }
});
