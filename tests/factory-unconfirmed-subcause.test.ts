import test from "node:test";
import assert from "node:assert/strict";
import {createOpenAiFactoryTextProvider} from "../server/software-factory-openai";
import {factoryResponseModelMatches} from "../server/factory-api-cache-usage";
// Realistic Responses bodies per developers.openai.com Responses API reference:
// a reasoning model returns a dated snapshot id, a reasoning item before the message,
// service_tier "default", and usage with total/cached/cache_write/reasoning tokens.
const model="gpt-6.1-sol";
const apiPrice={model,inputNanoUsdPerToken:1000,outputNanoUsdPerToken:4000,cachedInputNanoUsdPerToken:100,cacheWrite30mNanoUsdPerToken:1250,cacheWrite12hNanoUsdPerToken:2000,maxInputTokens:1_049_600,validUntil:"2026-12-01T00:00:00Z",evidenceSha256:"a".repeat(64)};
const config={model,apiPrice,inputNanoUsdPerToken:1000,outputNanoUsdPerToken:4000,pricingValidUntil:"2026-12-01T00:00:00Z",now:()=>new Date("2026-11-25T10:16:29Z"),maxInputTokens:10000};
const input=()=>({instructions:"Return a diff",text:"fixture",maxOutputTokens:100,maxCostCents:1,signal:new AbortController().signal});
const json=(value:unknown)=>new Response(JSON.stringify(value));
const count=()=>json({object:"response.input_tokens",input_tokens:100});
const documented=(over:Record<string,unknown>={})=>({id:"resp_686eef60d3e081a29283bdcbc4322fd90e34c516d176ff86",object:"response",created_at:1764065789,status:"completed",error:null,incomplete_details:null,
 model:"gpt-6.1-sol-2026-09-29",service_tier:"default",
 output:[{id:"rs_1",type:"reasoning",summary:[]},{id:"msg_1",type:"message",status:"completed",role:"assistant",content:[{type:"output_text",annotations:[],logprobs:[],text:"diff --git a/x b/x\n"}]}],
 usage:{input_tokens:100,input_tokens_details:{cached_tokens:0,cache_write_tokens:0},output_tokens:20,output_tokens_details:{reasoning_tokens:12},total_tokens:120},...over});
const run=async(body:unknown)=>{let calls=0;return createOpenAiFactoryTextProvider({...config,request:async()=>++calls===1?count():json(body)})(input());};

test("dated snapshot of the configured alias is accepted; other models are not",()=>{
 assert.equal(factoryResponseModelMatches("gpt-6.1-sol","gpt-6.1-sol"),true);
 assert.equal(factoryResponseModelMatches("gpt-6.1-sol","gpt-6.1-sol-2026-09-29"),true);
 for(const bad of ["gpt-6.1-sol-latest","gpt-6.1-sol-mini-2026-09-29","gpt-6.1-sol-2026-13-40","gpt-6.1-solar","gpt-6-astra",undefined,""])assert.equal(factoryResponseModelMatches("gpt-6.1-sol",bad),false,String(bad));
 assert.equal(factoryResponseModelMatches("x-2026-01-01","x-2026-01-01-2026-02-02"),false);
});
test("documented reasoning-model body with dated snapshot completes and prices reasoning as output",async()=>{
 assert.deepEqual(await run(documented()),{status:"completed",text:"diff --git a/x b/x\n",costCents:1,inputTokens:100,outputTokens:20});
});
test("incomplete max_output_tokens is a known failure with cost, not unconfirmed",async()=>{
 const out=await run(documented({status:"incomplete",incomplete_details:{reason:"max_output_tokens"}}));
 assert.equal(out.status,"failed");assert.equal(out.reason,"FACTORY_OPENAI_OUTPUT_LIMIT");assert.ok(out.costCents>0);
});
test("each post-dispatch rejection carries a safe sub-cause and stays unknown",async()=>{
 const cases:[unknown,string][]=[
  [documented({model:"gpt-6-astra"}),"MODEL_MISMATCH"],
  [documented({usage:{input_tokens:100,input_tokens_details:{cached_tokens:0,cache_write_tokens:0,unknown_cost:5},output_tokens:20,total_tokens:120}}),"USAGE_INVALID"],
  [documented({usage:{input_tokens:100,input_tokens_details:{cached_tokens:0,cache_write_tokens:0},output_tokens:20,total_tokens:999}}),"USAGE_INVALID"],
  [documented({usage:{input_tokens:100,input_tokens_details:{cached_tokens:0,cache_write_tokens:0},output_tokens:200,total_tokens:300}}),"USAGE_BOUNDS"],
  [documented({service_tier:"priority"}),"SERVICE_TIER_UNPRICED"],
  [documented({status:"in_progress"}),"STATUS_ACTIVE"],
  [documented({output:[{type:"function_call"}]}),"OUTPUT_UNPARSEABLE"],
 ];
 for(const [body,sub] of cases){const out=await run(body);assert.deepEqual(out,{status:"unknown",reason:`FACTORY_OPENAI_EXECUTION_UNCONFIRMED:${sub}`,costCents:0},sub);}
 let calls=0;const http=await createOpenAiFactoryTextProvider({...config,request:async()=>++calls===1?count():new Response("{}",{status:500})})(input());
 assert.equal(http.reason,"FACTORY_OPENAI_EXECUTION_UNCONFIRMED:HTTP_ERROR");
 calls=0;const garbled=await createOpenAiFactoryTextProvider({...config,request:async()=>++calls===1?count():new Response("{not json")})(input());
 assert.equal(garbled.reason,"FACTORY_OPENAI_EXECUTION_UNCONFIRMED:BODY_UNPARSEABLE");
});
