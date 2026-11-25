import test from "node:test";
import assert from "node:assert/strict";
import {createOpenAiFactoryTextProvider} from "../server/software-factory-openai";
import {factoryResponseShape} from "../server/factory-api-cache-usage";
import {factoryRemoteUnconfirmedSubCause} from "../server/software-factory-remote-builder";
const model="gpt-6.1-sol";
const apiPrice={model,inputNanoUsdPerToken:1000,outputNanoUsdPerToken:4000,cachedInputNanoUsdPerToken:100,cacheWrite30mNanoUsdPerToken:1250,cacheWrite12hNanoUsdPerToken:2000,maxInputTokens:1_049_600,validUntil:"2026-12-01T00:00:00Z",evidenceSha256:"a".repeat(64)};
const config={model,apiPrice,inputNanoUsdPerToken:1000,outputNanoUsdPerToken:4000,pricingValidUntil:"2026-12-01T00:00:00Z",now:()=>new Date("2026-11-25T10:37:47Z"),maxInputTokens:10000};
const input=()=>({instructions:"Return JSON",text:"fixture",maxOutputTokens:100,maxCostCents:1,signal:new AbortController().signal});
const body=(over:Record<string,unknown>={})=>({id:"resp_secret_id",object:"response",status:"completed",error:null,incomplete_details:null,model:"gpt-6.1-sol-2026-09-29",service_tier:"default",
 output:[{id:"rs_x",type:"reasoning",summary:[]},{id:"fc_x",type:"function_call",name:"secret_fn",arguments:"{}"}],
 usage:{input_tokens:100,input_tokens_details:{cached_tokens:0,cache_write_tokens:0},output_tokens:20,output_tokens_details:{reasoning_tokens:5},total_tokens:120},...over});

test("shape line carries only structure: no ids, text or argument content",()=>{
 const shape=factoryResponseShape({...body(),output:[{id:"msg_secret",type:"message",content:[{type:"output_text",text:"SECRET TEXT"}]}]});
 assert.deepEqual(shape.output_types,["message"]);assert.deepEqual(shape.content_types,["output_text"]);
 assert.equal(shape.model,"gpt-6.1-sol-2026-09-29");assert.equal(shape.status,"completed");
 assert.deepEqual(shape.usage_keys,["input_tokens","input_tokens_details","output_tokens","output_tokens_details","total_tokens"]);
 assert.doesNotMatch(JSON.stringify(shape),/SECRET|resp_secret|msg_secret/);
 assert.equal(factoryResponseShape({model:"bad model <x>"}).model,"invalid");
});
test("post-dispatch failure logs exactly one safe shape line",async()=>{
 const lines:string[]=[];const warn=console.warn;console.warn=(...a:unknown[])=>{lines.push(a.map(String).join(" "));};
 try{let n=0;const out=await createOpenAiFactoryTextProvider({...config,request:async()=>++n===1?Response.json({object:"response.input_tokens",input_tokens:100}):Response.json(body())})(input());
  assert.deepEqual(out,{status:"unknown",reason:"FACTORY_OPENAI_EXECUTION_UNCONFIRMED:OUTPUT_UNPARSEABLE",costCents:0});}
 finally{console.warn=warn;}
 const shape=lines.filter(l=>l.startsWith("[factory-openai-shape]"));assert.equal(shape.length,1);
 const parsed=JSON.parse(shape[0].slice("[factory-openai-shape] ".length));
 assert.equal(parsed.subCause,"OUTPUT_UNPARSEABLE");assert.deepEqual(parsed.output_types,["reasoning","function_call"]);
 assert.doesNotMatch(shape[0],/secret|resp_|fc_x|rs_x/);
});
test("remote MODEL step never falls back to a bare phase for code-shaped errors",()=>{
 const cases:[unknown,string][]=[
  [Error("FACTORY_MODEL_EXECUTION_UNCONFIRMED:USAGE_INVALID"),"USAGE_INVALID"],
  [Error("CREDIT_EXECUTION_UNCONFIRMED"),"MODEL_EXECUTION_UNCONFIRMED"],
  [Error("CREDIT_EXECUTION_NOT_DISPATCHED"),"MODEL_EXECUTION_NOT_DISPATCHED"],
  [Error("FACTORY_MODEL_PATCH_PARSE_FAILED"),"MODEL_PATCH_PARSE_FAILED"],
  [Error("FACTORY_MODEL_SOURCE_INVALID"),"MODEL_SOURCE_INVALID"],
  [Error("FACTORY_REMOTE_COST_UNCONFIRMED"),"MODEL_COST_UNCONFIRMED"],
  [new SyntaxError("Unexpected token"),"MODEL_THREW_SYNTAXERROR"],
  [Object.assign(Error("aborted"),{name:"AbortError"}),"MODEL_CANCELLED"],
 ];
 for(const [error,sub] of cases){const got=factoryRemoteUnconfirmedSubCause((error as Error).message,error,"MODEL");assert.equal(got,sub);assert.match(`FACTORY_REMOTE_EXECUTION_UNCONFIRMED:${got}`,/^FACTORY_[A-Z0-9_]{1,100}(:[A-Za-z0-9_]{1,100})?$/);}
 assert.equal(factoryRemoteUnconfirmedSubCause("free text with secrets",Error("x"),"MODEL"),"MODEL_THREW_ERROR");
});
