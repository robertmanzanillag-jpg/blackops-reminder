import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createAsistenteFactoryBuild } from "../server/software-factory-asistente-build";
import { createSharedOpenAiCreditLedger, type SharedCreditState } from "../server/shared-openai-credit-ledger";
import type { FactoryProject } from "../server/software-factory";
import type { FactoryPipelineState } from "../server/software-factory-pipeline";

test("Asistente composition reserves shared credit before model calls and accounts known incomplete usage", async () => {
 let clock='2026-11-06T12:00:00Z', expireAfterCounting=false;
 const now=()=>new Date(clock), repo='robertmanzanillag-jpg/blackops-reminder', base='a'.repeat(40), tree='b'.repeat(40);
 const source=Buffer.from('export const count = 1;\n'), workflow=Buffer.from('trusted workflow fixture');
 const blob=createHash('sha1').update(`blob ${source.length}\0`).update(source).digest('hex');
 const workflowPath='.github/workflows/factory-candidate-checks.yml';
 let state:SharedCreditState={version:1,grant:null,lastObservedAt:null,reservations:[]}, apiCalls=0, mutations=0;
 const ledger=createSharedOpenAiCreditLedger({grant:{id:'g',accountScope:'org',availableMicroUsd:20000,observedAt:now().toISOString(),expiresAt:'2026-11-20T00:00:00Z',verificationEvidenceId:'verified'},now,maximumGrantObservationAgeMs:1000,
  transact:async mutate=>{const copy=structuredClone(state);const value=mutate(copy);state=copy;return value;}});
 const build=createAsistenteFactoryBuild({ledger,baseBranch:'codex/office-integrated-repair-20261106',sourcePaths:['server/agent-search.ts'],maxOutputTokens:100,now,
  checks:{workflowId:1,workflowPath,workflowSha256:createHash('sha256').update(workflow).digest('hex'),jobName:'checks',testStep:'Tests',buildStep:'Build',browserStep:'Browser'},
  githubRequest:async(url,init)=>{
   if(init.method!=='GET'){mutations++;throw Error('unexpected publication');}
   const json=(data:unknown)=>new Response(JSON.stringify(data),{status:200});
   if(url.endsWith(repo))return json({full_name:repo,private:false,archived:false,disabled:false,default_branch:'main'});
   if(url.includes('/contents/'))return json({type:'file',path:workflowPath,sha:createHash('sha1').update(`blob ${workflow.length}\0`).update(workflow).digest('hex'),encoding:'base64',size:workflow.length,content:workflow.toString('base64')});
   if(url.includes('/git/commits/'))return json({sha:base,tree:{sha:tree},parents:[],message:'base'});
   if(url.includes('/git/trees/'))return json({sha:tree,truncated:false,tree:[{path:'server',type:'tree',mode:'040000',sha:'d'.repeat(40)},{path:'server/agent-search.ts',type:'blob',mode:'100644',sha:blob,size:source.length}]});
   assert.ok(url.endsWith(blob));return json({sha:blob,encoding:'base64',size:source.length,content:source.toString('base64')});
  },
  model:{model:'gpt-4.1-mini-2025-04-14',inputNanoUsdPerToken:400,outputNanoUsdPerToken:1600,maxInputTokens:12000,pricingValidUntil:'2026-12-20T00:00:00Z',now,
   request:async(url)=>{apiCalls++;if(expireAfterCounting && url.endsWith('/input_tokens')) clock='2026-11-20T00:00:00Z';assert.equal(state.reservations.at(-1)?.status,'reserved');return new Response(JSON.stringify(url.endsWith('/input_tokens')?{object:'response.input_tokens',input_tokens:10}:{object:'response',model:'gpt-4.1-mini-2025-04-14',status:'incomplete',incomplete_details:{reason:'max_output_tokens'},usage:{input_tokens:10,output_tokens:100,total_tokens:110}}),{status:200});}},
 });
 const project={id:'asistente',repo} as FactoryProject;
 const input={version:1,projectId:'asistente',rootJobId:'order-root',repairAttempts:0,finding:{baseSha:base,request:'Improve agent search'}} as FactoryPipelineState;
 const context={signal:new AbortController().signal,maxCostCents:2};
 const denied=await build(project,input,context);
 assert.equal('status' in denied && denied.status,'unknown',JSON.stringify(denied));assert.equal(apiCalls,0);assert.equal(mutations,0);
 await ledger.initialize();
 const attempted=await build(project,input,context);
 assert.equal('status' in attempted && attempted.status,'failed');assert.equal(apiCalls,2);assert.equal(mutations,0);
 assert.equal((await ledger.status()).spentMicroUsd,10000);
 await build(project,input,context);assert.equal(apiCalls,2);
 const foreign=await build({...project,repo:'owner/kong'},input,context);
 assert.equal('status' in foreign && foreign.status,'blocked');assert.equal(apiCalls,2);
 expireAfterCounting=true;
 const expired=await build(project,{...input,repairAttempts:1},{...context,maxCostCents:1});
 assert.equal('status' in expired && expired.status,'unknown');
 assert.equal(apiCalls,3,'credit expiry after counting must prevent generation despite current model pricing');
 assert.equal((await ledger.status()).reservedMicroUsd,10000);
});



test("Asistente export failures and stage cancellation stop before any credit or model admission",async()=>{
 const repo="robertmanzanillag-jpg/blackops-reminder",base="a".repeat(40),tree="b".repeat(40),workflow="trusted",workflowPath=".github/workflows/factory-candidate-checks.yml",source="export const value=1;\n";
 const hash=(s:string)=>createHash("sha1").update(`blob ${Buffer.byteLength(s)}\0`).update(s).digest("hex");
 for(const mode of ["missing","unsafe","mismatch","abort"]){let credit=0,model=0,blobs=0;const controller=new AbortController();
  const build=createAsistenteFactoryBuild({ledger:{reserve:async()=>{credit++;throw Error("NOT_EXPECTED");}} as any,baseBranch:"main",sourcePaths:["server/role.ts"],maxOutputTokens:100,now:()=>new Date("2026-11-07T00:00:00Z"),checks:{workflowId:1,workflowPath,workflowSha256:createHash("sha256").update(workflow).digest("hex"),jobName:"checks",testStep:"test",buildStep:"build",browserStep:"browser"},
   model:{model:"gpt-6-astra",inputNanoUsdPerToken:1,outputNanoUsdPerToken:1,maxInputTokens:1000,pricingValidUntil:"2026-11-20T00:00:00Z",now:()=>new Date("2026-11-07T00:00:00Z"),request:async()=>{model++;throw Error("NOT_EXPECTED");}},
   githubRequest:async(url,init)=>{assert.ok(init.signal);const json=(v:unknown)=>Response.json(v);
    if(url.endsWith(repo))return json({full_name:repo,private:false,archived:false,disabled:false,default_branch:"main"});
    if(url.includes("/contents/"))return json({type:"file",path:workflowPath,sha:hash(workflow),encoding:"base64",size:workflow.length,content:Buffer.from(workflow).toString("base64")});
    if(url.includes("/commits/"))return json({sha:base,tree:{sha:tree},parents:[],message:"base"});
    if(url.includes("/trees/")){if(mode==="abort"){controller.abort();assert.equal(init.signal!.aborted,true);}return json({sha:tree,truncated:false,tree:[{path:"server",type:"tree",mode:"040000",sha:"c".repeat(40)},...(mode==="missing"?[]:[{path:mode==="unsafe"?"../escape":"server/role.ts",type:"blob",mode:"100644",sha:hash(source),size:source.length}])]});}
    blobs++;return json({sha:hash(source),encoding:"base64",size:source.length,content:Buffer.from("x".repeat(source.length)).toString("base64")});
   }});
  const result=await build({id:"asistente",repo} as FactoryProject,{version:1,projectId:"asistente",rootJobId:"root",repairAttempts:0,finding:{baseSha:base,request:"Fix role"}} as FactoryPipelineState,{signal:controller.signal,maxCostCents:1});
  assert.equal("status" in result&&result.status,"failed");assert.equal(credit,0);assert.equal(model,0);assert.equal(blobs,mode==="mismatch"?1:0);
 }
});
