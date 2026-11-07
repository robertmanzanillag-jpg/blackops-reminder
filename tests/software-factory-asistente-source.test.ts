import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createAsistenteReviewSourceLoader} from "../server/software-factory-asistente-source";
import type {FactoryPilotGitHubClient} from "../server/software-factory-github-client";
import type {FactoryCandidate} from "../server/software-factory";
const hash=(s:string)=>createHash("sha1").update(`blob ${Buffer.byteLength(s)}\0`).update(s).digest("hex");
function fixture(withBom=false){
 const oldText=(withBom?"\uFEFF":"")+"old\n",newText="new\n";
 const base="a".repeat(40),head="b".repeat(40),oldTree="c".repeat(40),newTree="d".repeat(40),file="server/agent-summary.ts";
 let tamper=false,extra=false,ancestor=false,blobs=0;
 const content=new Map([[hash(oldText),oldText],[hash(newText),newText]]);
 const client={git:{getCommit:async({commit_sha}:any)=>({data:{sha:commit_sha,tree:{sha:commit_sha===base?oldTree:newTree},parents:commit_sha===base?[]:[{sha:ancestor?"e".repeat(40):base}]}}),
  getTree:async({tree_sha}:any)=>({data:{sha:tree_sha,truncated:false,tree:[{path:file,type:"blob",mode:"100644",sha:hash(tree_sha===oldTree?oldText:newText)},...(extra&&tree_sha===newTree?[{path:"server/elsewhere.ts",type:"blob",mode:"100644",sha:hash("new\n")}]:[])]}}),
  getBlob:async({file_sha}:any)=>{blobs++;const text=tamper?"bad\n":content.get(file_sha)!;return {data:{sha:file_sha,encoding:"base64",size:Buffer.byteLength(text),content:Buffer.from(text).toString("base64")}};},
 }} as unknown as FactoryPilotGitHubClient;
 const load=createAsistenteReviewSourceLoader(client,[file]);
 const candidate={baseSha:base,headSha:head,changedFiles:[file]} as FactoryCandidate;
 return {load,candidate,signal:new AbortController().signal,blobs:()=>blobs,tamper:()=>{tamper=true;},extra:()=>{extra=true;},ancestor:()=>{ancestor=true;},client};
}
test("review source verifies immutable lineage, complete changed-file set and both Git blob hashes",async()=>{
 const f=fixture(),source=await f.load(f.candidate,f.signal);
 assert.deepEqual(source.files,[{path:"server/agent-summary.ts",baseline:"old\n",candidate:"new\n"}]);
 assert.equal(source.repository,"robertmanzanillag-jpg/blackops-reminder");assert.equal(f.blobs(),2);
});
test("hidden extra changes and wrong ancestry fail before source bodies are fetched",async()=>{
 for(const kind of ["extra","ancestor"] as const){const f=fixture();f[kind]();await assert.rejects(f.load(f.candidate,f.signal));assert.equal(f.blobs(),0);}
});
test("tampered blob and protected source paths cannot reach review input",async()=>{
 const f=fixture();f.tamper();await assert.rejects(f.load(f.candidate,f.signal),/BLOB_INVALID/);
 for(const path of ["server/kong.ts","server/secrets/private.ts","server/../private.ts","server/office-shared-credits.ts"]){assert.throws(()=>createAsistenteReviewSourceLoader(f.client,[path]));}
});

test("verified UTF-8 BOM reaches the reviewer unchanged",async()=>{const f=fixture(true);const source=await f.load(f.candidate,f.signal);assert.equal(source.files[0].baseline,"\uFEFFold\n");});
