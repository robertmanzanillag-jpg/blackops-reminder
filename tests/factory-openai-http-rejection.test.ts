import test from "node:test";
import assert from "node:assert/strict";
import {createOpenAiFactoryTextProvider} from "../server/software-factory-openai";
import {createFactoryApiInvocation} from "../server/factory-api-invocation";
import {emptyFactoryApiState,checkpointFactoryApiMonth,reserveFactoryApi,settleFactoryApi,unknownFactoryApi,factoryApiExecutionWindow,factoryApiBudgetStatus} from "../server/software-factory-api-budget";
import {factoryOpenAiHttpErrorSummary,FactoryOpenAiRequestRejectedError,FACTORY_OPENAI_REQUEST_REJECTED_PATTERN} from "../server/factory-api-cache-usage";
import {factoryPatchDiagnostics} from "../server/software-factory-builder";
// Error bodies follow developers.openai.com error-codes guide: {error:{message,type,param,code}}.
const model="gpt-6.1-sol";
const apiPrice={model,inputNanoUsdPerToken:1000,outputNanoUsdPerToken:4000,cachedInputNanoUsdPerToken:100,cacheWrite30mNanoUsdPerToken:1250,cacheWrite12hNanoUsdPerToken:2000,maxInputTokens:1_049_600,validUntil:"2026-12-01T00:00:00Z",evidenceSha256:"a".repeat(64)};
const config={model,apiPrice,inputNanoUsdPerToken:1000,outputNanoUsdPerToken:4000,pricingValidUntil:"2026-12-01T00:00:00Z",now:()=>new Date("2026-11-25T10:53:14Z"),maxInputTokens:10000};
const input=()=>({instructions:"SECRET-INSTRUCTIONS",text:"SECRET-SOURCE",maxOutputTokens:16000,maxCostCents:100,signal:new AbortController().signal});
const count=()=>new Response(JSON.stringify({object:"response.input_tokens",input_tokens:100}));
const errorBody=(status:number,error:Record<string,unknown>)=>new Response(JSON.stringify({error:{message:"PRIVATE provider message sk-SYNTHETIC",...error}}),{status});
async function capture<T>(run:()=>Promise<T>){const lines:string[]=[];const warn=console.warn;console.warn=(...a:unknown[])=>{lines.push(a.map(String).join(" "));};try{return {value:await run(),lines};}finally{console.warn=warn;}}
const provider=(paid:Response)=>{let calls=0;return createOpenAiFactoryTextProvider({...config,request:async()=>++calls===1?count():paid});};

test("400 invalid_request_error is rejected at $0 with a specific code and ONE safe log line",async()=>{
 const {value,lines}=await capture(()=>provider(errorBody(400,{type:"invalid_request_error",code:"invalid_value",param:"service_tier"}))(input()));
 assert.deepEqual(value,{status:"blocked",reason:"FACTORY_OPENAI_REQUEST_REJECTED",costCents:0,cause:"FACTORY_OPENAI_REQUEST_REJECTED:400:invalid_value"});
 const logged=lines.filter(l=>l.startsWith("[factory-openai-http-error] "));assert.equal(logged.length,1);
 assert.deepEqual(JSON.parse(logged[0].slice(28)),{stage:"openai-provider",status:400,type:"invalid_request_error",code:"invalid_value",param:"service_tier",model,
  request_keys:["input","instructions","max_output_tokens","model","service_tier","store","stream","tools"]});
 assert.doesNotMatch(lines.join("\n"),/SECRET|PRIVATE|sk-/);
});
test("401/403/404/422 and 429 quota or rate limits are not billed; code falls back to type",async()=>{
 for(const [status,error,code] of [[401,{type:"invalid_request_error",code:"invalid_api_key"},"invalid_api_key"],[403,{type:"invalid_request_error",code:"unsupported_country_region_territory"},"unsupported_country_region_territory"],
  [404,{type:"invalid_request_error",code:"model_not_found",param:"model"},"model_not_found"],[422,{type:"invalid_request_error",code:null},"invalid_request_error"],
  [429,{type:"insufficient_quota",code:"insufficient_quota"},"insufficient_quota"],[429,{type:"requests",code:"rate_limit_exceeded"},"rate_limit_exceeded"]] as const){
  const {value}=await capture(()=>provider(errorBody(status,error))(input()));
  assert.equal(value.status,"blocked");assert.equal(value.costCents,0);assert.equal((value as any).cause,`FACTORY_OPENAI_REQUEST_REJECTED:${status}:${code}`);
  assert.match((value as any).cause,FACTORY_OPENAI_REQUEST_REJECTED_PATTERN);
 }
});
test("5xx after send stays unknown HTTP_ERROR (still logs the safe line)",async()=>{
 for(const status of [500,502,503]){const {value,lines}=await capture(()=>provider(errorBody(status,{type:"server_error",code:"server_is_overloaded"}))(input()));
  assert.deepEqual(value,{status:"unknown",reason:"FACTORY_OPENAI_EXECUTION_UNCONFIRMED:HTTP_ERROR",costCents:0});
  assert.equal(lines.filter(l=>l.startsWith("[factory-openai-http-error] ")).length,1);}
});
test("summary strips non enum characters, truncates to 80 and ignores message/content",()=>{
 const s=factoryOpenAiHttpErrorSummary(400,{error:{type:"invalid request<script>",code:"x".repeat(200),param:"text.format.schema\n\"evil\"",message:"leak"}},{model:"gpt-6.1-sol",input:"leak",instructions:"leak","Bad Key":1});
 assert.deepEqual(s,{status:400,type:"invalidrequestscript",code:"x".repeat(80),param:"text.format.schemaevil",model:"gpt-6.1-sol",request_keys:["input","instructions","model"]});
 assert.deepEqual(factoryOpenAiHttpErrorSummary(400,"not json",undefined),{status:400,type:null,code:null,param:null,model:null,request_keys:null});
 assert.ok(factoryPatchDiagnostics.includes("PROVIDER_REQUEST_REJECTED" as any));
});

const NOW="2026-11-25T10:53:14.000Z",sha="a".repeat(64);
function ledger(){
 const state=emptyFactoryApiState(),base={configured:true,fixedCents:0,spentCents:0,reservedCents:0,unknown:false,parents:[] as any[]};
 checkpointFactoryApiMonth(state,{...base},{month:"2026-11",evidenceSha256:sha,reconciledAt:NOW,externalSpentMicroUsd:0,externalReservedMicroUsd:0,externalUnknownReservations:0,complete:true},NOW);
 const invoke=createFactoryApiInvocation({owner:()=>"synthetic-owner",now:()=>new Date(NOW),store:{
  async apiBudgetStatus(){return factoryApiBudgetStatus(state,base,NOW);},
  async reserveApi(_o,i){return reserveFactoryApi(state,base,i,NOW);},
  async settleApi(_o,k,i){return settleFactoryApi(state,k,i,NOW);},
  async unknownApi(_o,k){unknownFactoryApi(state,k);},
  async executionWindowApi(_o,k){return factoryApiExecutionWindow(state,base,k,NOW);}}});
 const run=(call:()=>Promise<unknown>,id:string)=>invoke({consumer:"office",executionId:id,requestSha256:sha,price:{model,inputNanoUsdPerToken:400,outputNanoUsdPerToken:1600,validUntil:"2027-01-01T00:00:00.000Z",evidenceSha256:sha},promptBytes:100,maxOutputTokens:32,call,usage:()=>{throw Error("unreachable");}});
 return {state,base,run};
}
test("monetary gate settles a rejected request hold at $0 instead of unknown; 5xx stays unknown",async()=>{
 const f=ledger();
 await assert.rejects(f.run(async()=>{throw new FactoryOpenAiRequestRejectedError(400,"invalid_value");},"rejected"),(e:any)=>e.message==="FACTORY_OPENAI_REQUEST_REJECTED:400:invalid_value"&&e.dispatched===true);
 assert.equal(f.state.reservations[0].status,"settled");assert.equal(f.state.reservations[0].actualMicroUsd,0);
 assert.notEqual(factoryApiBudgetStatus(f.state,f.base,NOW).reason,"FACTORY_API_UNKNOWN_HOLD");
 await assert.rejects(f.run(async()=>{throw Error("HTTP_ERROR");},"server"),(e:any)=>e.message==="FACTORY_API_EXECUTION_UNCONFIRMED"&&e.subCause==="HTTP_ERROR");
 assert.equal(f.state.reservations[1].status,"unknown");
});
