import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {createFactoryOpenAiTransport} from '../server/software-factory-openai-transport';
import {withFactoryApiParent} from '../server/factory-api-context';
import {fixtureFactoryInvocation} from './fixtures/factory-api-budget';
const model='synthetic-model',price={model,inputNanoUsdPerToken:400,outputNanoUsdPerToken:1600,validUntil:'2027-01-01T00:00:00.000Z',evidenceSha256:'a'.repeat(64)};
const parent=()=>({id:randomUUID(),fence:randomUUID(),status:'running',ownerKey:createHash('sha256').update('synthetic-owner').digest('hex')}) as any;
const body=()=>JSON.stringify({model,input:'synthetic requirements',max_output_tokens:32});
const output=()=>({id:'resp_synthetic',model,status:'completed',usage:{input_tokens:10,output_tokens:5,input_tokens_details:{cached_tokens:0}}});
test('model credential reaches only approved bounded Responses operation inside Factory escrow',async()=>{
 const job=parent(),key='sk-proj-'+'a'.repeat(50),signal=new AbortController().signal,calls:{url:string;init:RequestInit}[]=[];
 const request=createFactoryOpenAiTransport(key,(async(url,init)=>{calls.push({url:String(url),init:init!});return Response.json(output());}) as typeof fetch,{price,invoke:fixtureFactoryInvocation(undefined,job)});
 await withFactoryApiParent(job,()=>request('https://api.openai.com/v1/responses',{method:'POST',body:body(),signal,redirect:'follow',credentials:'include',headers:{Authorization:'untrusted',Cookie:'private','OpenAI-Project':'other','OpenAI-Organization':'other'}}));
 assert.equal(calls.length,1);const headers=new Headers(calls[0].init.headers);assert.equal(headers.get('Authorization'),`Bearer ${key}`);assert.equal(headers.get('Cookie'),null);assert.equal(headers.get('OpenAI-Project'),null);assert.equal(headers.get('OpenAI-Organization'),null);assert.equal(calls[0].init.redirect,'error');assert.equal(calls[0].init.credentials,'omit');assert.equal(calls[0].init.signal?.aborted,false);
 await assert.rejects(withFactoryApiParent(job,()=>request('https://api.openai.com/v1/responses/input_tokens',{method:'POST',body:body(),signal})),/OPERATION_UNPRICED/);
 for(const url of ['https://example.com/v1/responses','http://api.openai.com/v1/responses','https://api.openai.com/v1/files','https://user@api.openai.com/v1/responses','https://api.openai.com/v1/responses?project=other','https://api.openai.com/v1/responses#secret','invalid'])await assert.rejects(request(url,{method:'POST',body:body(),signal}),/SCOPE_INVALID/);
 for(const init of [{method:'GET',body:body(),signal},{method:'POST',body:body()},{method:'POST',body:'x'.repeat(1048577),signal}])await assert.rejects(request('https://api.openai.com/v1/responses',init),/SCOPE_INVALID/);
 assert.equal(calls.length,1);
});
test('aborted or missing-parent calls make zero requests; dispatched error holds without retry/leak',async()=>{
 let calls=0;const job=parent(),request=createFactoryOpenAiTransport('sk-'+'b'.repeat(50),(async()=>{calls++;throw Error('sensitive provider detail');}) as typeof fetch,{price,invoke:fixtureFactoryInvocation(undefined,job)});
 await assert.rejects(request('https://api.openai.com/v1/responses',{method:'POST',body:body(),signal:AbortSignal.abort()}));assert.equal(calls,0);
 await assert.rejects(request('https://api.openai.com/v1/responses',{method:'POST',body:body(),signal:new AbortController().signal}),/PARENT_CONTEXT_UNAVAILABLE/);assert.equal(calls,0);
 await assert.rejects(withFactoryApiParent(job,()=>request('https://api.openai.com/v1/responses',{method:'POST',body:body(),signal:new AbortController().signal})),/^Error: FACTORY_API_EXECUTION_UNCONFIRMED$/);assert.equal(calls,1);
 await assert.rejects(withFactoryApiParent(job,()=>request('https://api.openai.com/v1/responses',{method:'POST',body:body(),signal:new AbortController().signal})),/UNKNOWN_HOLD/);assert.equal(calls,1);
});
