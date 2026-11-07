import test from "node:test";
import assert from "node:assert/strict";
import {createAsistenteGitHubTransport} from "../server/software-factory-github-transport";
test("dedicated transport cannot send its credential outside Asistente or use unapproved write endpoints",async()=>{
 let calls=0;
 const token="github_pat_"+"a".repeat(60), root="https://api.github.com/repos/robertmanzanillag-jpg/blackops-reminder";
 const request=createAsistenteGitHubTransport(token,(async(url,init)=>{
  calls++; assert.equal(String(url),root); assert.equal(new Headers(init?.headers).get("Authorization"),"Bearer "+token);
  assert.equal(init?.redirect,"error");assert.equal(init?.credentials,"omit");
  assert.equal(new Headers(init?.headers).get("X-GitHub-Api-Version"),"2026-03-10");
  if(calls===2)assert.equal(new Headers(init?.headers).get("Accept"),"application/vnd.github.object+json");
  return Response.json({});
 }) as typeof fetch);
 const signal=new AbortController().signal;
 await request(root,{signal});assert.equal(calls,1);
 for(const url of [root.replace("blackops-reminder","kong-nightlife"),root+"-other",root.replace("api.github.com","example.com"),root+"/issues"]){
  await assert.rejects(request(url,{signal}));
 }
 for(const suffix of ["/merges","/actions/workflows/1/dispatches","/pulls/1/merge","/git/refs/heads/main"]){
  await assert.rejects(request(root+suffix,{method:"POST",signal}));
 }
 await assert.rejects(request(root,{method:"PATCH",signal}));
 await assert.rejects(request(root,{}));assert.equal(calls,1);
 await request(root,{signal,headers:{Accept:"application/vnd.github.object+json"}});assert.equal(calls,2);
 await assert.rejects(request(root,{signal,headers:{Accept:"application/vnd.github.raw+json"}}));assert.equal(calls,2);
});
test("uncertain transport never retries or exposes provider errors",async()=>{
 let calls=0;
 const request=createAsistenteGitHubTransport("github_pat_"+"b".repeat(60),(async()=>{calls++;throw Error("private secret detail");}) as typeof fetch);
 await assert.rejects(request("https://api.github.com/repos/robertmanzanillag-jpg/blackops-reminder",{signal:new AbortController().signal}),/^Error: FACTORY_GITHUB_TRANSPORT_UNCONFIRMED$/);
 assert.equal(calls,1);
});
