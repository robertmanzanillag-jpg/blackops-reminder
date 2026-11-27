import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { withFactoryApiParent } from "../server/factory-api-context";
import { createFactoryOpenAiCountTransport, routeFactoryOpenAiRequests, consumeFactoryOpenAiInputCount } from "../server/software-factory-openai-count";
const COUNT="https://api.openai.com/v1/responses/input_tokens", GENERATE="https://api.openai.com/v1/responses";
const key="sk-"+"synthetic".repeat(8);
const parent=()=>({id:randomUUID(),fence:randomUUID(),ownerKey:"a".repeat(64),status:"running"}) as any;
const prompt=(input="synthetic")=>({model:"synthetic-model",instructions:"bounded work",input,reasoning:{effort:"low"},text:{format:{type:"json_schema",name:"answer",strict:true,schema:{type:"object",properties:{x:{type:"string"}},required:["x"],additionalProperties:false}}}});
const generation=(body:Record<string,unknown>=prompt())=>({...body,max_output_tokens:32,store:false,tools:[],stream:false,service_tier:"default"});
const init=(body:unknown,signal=new AbortController().signal):RequestInit=>({method:"POST",body:JSON.stringify(body),signal});
function fixture(inputTokens=10){
  let at=1_000_000, counts=0, generations=0, countResponse=()=>Response.json({object:"response.input_tokens",input_tokens:inputTokens});
  const proofs:Array<ReturnType<typeof consumeFactoryOpenAiInputCount>>=[];
  const count=createFactoryOpenAiCountTransport(key,(async(url,options)=>{
    counts++;assert.equal(String(url),COUNT);assert.equal(options?.redirect,"error");assert.equal(options?.credentials,"omit");
    assert.equal(new Headers(options?.headers).get("Authorization"),`Bearer ${key}`);return countResponse();
  }) as typeof fetch,{now:()=>at});
  const gated=async(_url:string,options:RequestInit)=>{generations++;proofs.push(consumeFactoryOpenAiInputCount(JSON.parse(String(options.body))));return Response.json({ok:true});};
  const route=routeFactoryOpenAiRequests(gated,count,{now:()=>at});
  return {route,count,proofs,counts:()=>counts,generations:()=>generations,setTime:(time:number)=>{at=time;},response:(factory:()=>Response)=>{countResponse=factory;}};
}

test("real scoped free count mints one exact parent-bound proof; returned count body remains readable",async()=>{
  const f=fixture(),job=parent();
  await withFactoryApiParent(job,async()=>{
    const response=await f.route(COUNT,init(prompt()));assert.equal((await response.json()).input_tokens,10);
    await f.route(GENERATE,init(generation()));
    await f.route(GENERATE,init(generation()));
  });
  assert.deepEqual(f.proofs.map(Boolean),[true,false]);assert.equal(f.proofs[0]?.inputTokens,10);
  assert.match(f.proofs[0]!.evidenceSha256,/^[a-f0-9]{64}$/);assert.equal(f.counts(),1);
  assert.equal(consumeFactoryOpenAiInputCount(generation()),undefined);
});

test("generic or fabricated count responses cannot mint private receipts",async()=>{
  const proofs:any[]=[],job=parent();
  const route=routeFactoryOpenAiRequests(async(_u,options)=>{proofs.push(consumeFactoryOpenAiInputCount(JSON.parse(String(options.body))));return Response.json({});},async()=>Response.json({object:"response.input_tokens",input_tokens:0}));
  await withFactoryApiParent(job,async()=>{await route(COUNT,init(prompt()));await route(GENERATE,init(generation()));});
  assert.deepEqual(proofs,[undefined]);
});

test("count requires exact scoped request, authentication and nonaborted signals before HTTP",async()=>{
  const f=fixture(),job=parent();
  await assert.rejects(f.count(COUNT,init(prompt())),/PARENT_CONTEXT_UNAVAILABLE/);
  await withFactoryApiParent(job,async()=>{
    for(const body of [{...prompt(),tools:[]},{...prompt(),input:[{type:"input_file",file_id:"remote"}]},{...prompt(),instructions:{}},{...prompt(),max_output_tokens:32}]) await assert.rejects(f.count(COUNT,init(body)),/COUNT_SCOPE_INVALID/);
    await assert.rejects(f.count(GENERATE,init(prompt())),/COUNT_SCOPE_INVALID/);
    await assert.rejects(f.count(COUNT,{...init(prompt()),method:"GET"}),/COUNT_SCOPE_INVALID/);
    await assert.rejects(f.count(COUNT,init(prompt(),AbortSignal.abort())),/COUNT_CANCELLED/);
  });
  await assert.rejects(withFactoryApiParent(job,()=>f.count(COUNT,init(prompt())),AbortSignal.abort()),/COUNT_CANCELLED/);
  assert.equal(f.counts(),0);assert.throws(()=>createFactoryOpenAiCountTransport("bad"),/CREDENTIAL_REQUIRED/);
});

test("malformed, missing, negative, oversized and noninteger count responses mint no receipt",async()=>{
  const invalid: Array<()=>Response>=[
    ()=>Response.json({input_tokens:10}),()=>Response.json({object:"response.input_tokens",input_tokens:-1}),
    ()=>Response.json({object:"response.input_tokens",input_tokens:1.5}),()=>Response.json({object:"response.input_tokens",input_tokens:1_049_601}),
    ()=>Response.json({object:"response.input_tokens",input_tokens:"10"}),()=>new Response("{bad"),
    ()=>new Response("x".repeat(4097)),()=>Response.json({}, {status:500}),
  ];
  for(const response of invalid){const f=fixture();f.response(response);await assert.rejects(withFactoryApiParent(parent(),()=>f.route(COUNT,init(prompt()))),/TRANSPORT_UNCONFIRMED/);assert.equal(f.generations(),0);}
  for(const value of [0,1_049_600]){const f=fixture(value);await withFactoryApiParent(parent(),async()=>{await f.route(COUNT,init(prompt()));await f.route(GENERATE,init(generation()));});assert.equal(f.proofs[0]?.inputTokens,value);}
});

test("changed prompt, model, schema or reasoning receives no proof; exact prompt remains available",async()=>{
  for(const change of [{input:"changed"},{model:"other"},{instructions:"other"},{reasoning:{effort:"high"}},{text:{format:{type:"text"}}}]){
    const f=fixture();await withFactoryApiParent(parent(),async()=>{await f.route(COUNT,init(prompt()));await f.route(GENERATE,init(generation({...prompt(),...change})));await f.route(GENERATE,init(generation()));});
    assert.deepEqual(f.proofs.map(Boolean),[false,true]);
  }
});

test("generation proof requires all fixed stateless bounded fields",async()=>{
  for(const change of [{store:true},{stream:true},{tools:[{type:"web_search"}]},{service_tier:"priority"},{max_output_tokens:0},{max_output_tokens:128001},{previous_response_id:"remote"},{prompt_cache_key:"Has Spaces"},{prompt_cache_key:7}]){
    const f=fixture();await withFactoryApiParent(parent(),async()=>{await f.route(COUNT,init(prompt()));await f.route(GENERATE,init({...generation(),...change}));});assert.equal(f.proofs[0],undefined);
  }
});

test("owner, job and fence changes cannot consume another parent receipt",async()=>{
  for(const change of [{ownerKey:"b".repeat(64)},{id:randomUUID()},{fence:randomUUID()}]){
    const f=fixture(),job=parent();await withFactoryApiParent(job,()=>f.route(COUNT,init(prompt())));
    await withFactoryApiParent({...job,...change},()=>f.route(GENERATE,init(generation())));
    await withFactoryApiParent(job,()=>f.route(GENERATE,init(generation())));
    assert.deepEqual(f.proofs.map(Boolean),[false,true]);
  }
});

test("receipt expires after 120 seconds and a backward or invalid clock cannot grant proof",async()=>{
  for(const at of [1_120_000,1_120_001,999_999,NaN]){const f=fixture(),job=parent();await withFactoryApiParent(job,async()=>{await f.route(COUNT,init(prompt()));f.setTime(at);await f.route(GENERATE,init(generation()));});assert.equal(f.proofs[0],undefined);}
  const f=fixture();await withFactoryApiParent(parent(),async()=>{await f.route(COUNT,init(prompt()));f.setTime(1_119_999);await f.route(GENERATE,init(generation()));});assert.ok(f.proofs[0]);
});

test("receipt cache retains at most the latest 32 successful counts",async()=>{
  const f=fixture();await withFactoryApiParent(parent(),async()=>{for(let i=0;i<33;i++)await f.route(COUNT,init(prompt(String(i))));await f.route(GENERATE,init(generation(prompt("0"))));await f.route(GENERATE,init(generation(prompt("1"))));await f.route(GENERATE,init(generation(prompt("32"))));});assert.deepEqual(f.proofs.map(Boolean),[false,true,true]);
});

test("concurrent parents preserve isolated one-use bindings without replay",async()=>{
  const f=fixture(),jobs=[parent(),parent()];
  await Promise.all(jobs.map((job,index)=>withFactoryApiParent(job,async()=>{await f.route(COUNT,init(prompt(String(index))));await Promise.resolve();await f.route(GENERATE,init(generation(prompt(String(index)))));await f.route(GENERATE,init(generation(prompt(String(index)))));} )));
  assert.equal(f.proofs.filter(Boolean).length,2);assert.equal(f.proofs.filter(value=>value===undefined).length,2);
});

test("consumption is exact, one-use and rechecks parent, expiry and cancellation inside gated scope",async()=>{
  for(const mode of ["replay","wrong-body","parent","expiry","signal"]){
    let at=1000;const job=parent(),controller=new AbortController(),proofs:any[]=[];
    const count=createFactoryOpenAiCountTransport(key,(async()=>Response.json({object:"response.input_tokens",input_tokens:10})) as typeof fetch,{now:()=>at});
    const route=routeFactoryOpenAiRequests(async(_url,options)=>{
      const body=JSON.parse(String(options.body));
      if(mode==="wrong-body")proofs.push(consumeFactoryOpenAiInputCount({...body,input:"changed"}));
      if(mode==="expiry")at+=120001;
      if(mode==="signal")controller.abort();
      if(mode==="parent")await withFactoryApiParent({...job,fence:randomUUID()},async()=>{proofs.push(consumeFactoryOpenAiInputCount(body));});
      proofs.push(consumeFactoryOpenAiInputCount(body));proofs.push(consumeFactoryOpenAiInputCount(body));return Response.json({});
    },count,{now:()=>at});
    await withFactoryApiParent(job,async()=>{await route(COUNT,init(prompt()));await route(GENERATE,init(generation(),controller.signal));});
    assert.equal(proofs.filter(Boolean).length,mode==="replay"?1:0);
  }
});

test("an aborted parent or generation signal cannot route a counted generation",async()=>{
  for(const side of ["parent","generation"]){const f=fixture(),controller=new AbortController();await withFactoryApiParent(parent(),async()=>{await f.route(COUNT,init(prompt()));controller.abort();await assert.rejects(f.route(GENERATE,init(generation(),side==="generation"?controller.signal:undefined)),/COUNT_CANCELLED/);},side==="parent"?controller.signal:undefined);assert.equal(f.generations(),0);}
});


test("nested schema key reordering cannot borrow an exact count receipt",async()=>{
  const f=fixture();
  await withFactoryApiParent(parent(),async()=>{
    await f.route(COUNT,init(prompt()));
    const changedOrder={...prompt(),text:{format:{schema:{additionalProperties:false,required:["x"],properties:{x:{type:"string"}},type:"object"},strict:true,name:"answer",type:"json_schema"}}};
    await f.route(GENERATE,init(generation(changedOrder)));
    await f.route(GENERATE,init(generation()));
  });
  assert.deepEqual(f.proofs.map(Boolean),[false,true]);
});

test("receipt binding closes when gated operation returns, including detached async resources",async()=>{
  let late!:Promise<unknown>;
  const count=createFactoryOpenAiCountTransport(key,(async()=>Response.json({object:"response.input_tokens",input_tokens:10})) as typeof fetch);
  const route=routeFactoryOpenAiRequests(async(_url,options)=>{
    const body=JSON.parse(String(options.body));
    late=new Promise(resolve=>setTimeout(()=>resolve(consumeFactoryOpenAiInputCount(body)),1));
    return Response.json({});
  },count);
  await withFactoryApiParent(parent(),async()=>{await route(COUNT,init(prompt()));await route(GENERATE,init(generation()));});
  assert.equal(await late,undefined);
});
