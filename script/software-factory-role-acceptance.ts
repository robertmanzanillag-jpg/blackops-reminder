import {execFile,spawn} from "node:child_process";
import {promisify} from "node:util";
import {realpath,writeFile} from "node:fs/promises";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {createHash,randomUUID} from "node:crypto";
import {measureRoleWorkAcceptance,ROLE_WORK_ACCEPTANCE_ID,remoteAcceptanceRuntime,serveAcceptanceRuntime} from "../server/software-factory-role-acceptance";
const exec=promisify(execFile);
async function checkedRoot(root:string,sha:string){
 if(!path.isAbsolute(root)||!/^[a-f0-9]{40}$/.test(sha)||/[\r\n,]/.test(root))throw Error("QA_EXACT_CHECKOUT_REQUIRED");
 const resolved=await realpath(root);
 const git=async(args:string[])=>(await exec("git",["-C",resolved,...args],{timeout:10000,maxBuffer:1024*1024})).stdout.trim();
 if(await git(["rev-parse","HEAD"])!==sha || await git(["status","--porcelain","--untracked-files=normal"]))throw Error("QA_SOURCE_DIRTY_OR_WRONG_REVISION");
 return resolved;
}
async function revision(root:string,sha:string,controller:string,dependencies:string){
 const name=`factory-acceptance-${randomUUID()}`,image=process.env.FACTORY_IMAGE;
 if(!image||!/^docker\.io\/library\/node@sha256:[a-f0-9]{64}$/.test(image))throw Error("QA_PINNED_IMAGE_REQUIRED");
 const runId=process.env.GITHUB_RUN_ID;if(!runId||!/^\d+$/.test(runId))throw Error("QA_CI_RUN_REQUIRED");
 const args=["run","--interactive","--rm","--name",name,"--label",`office.factory.acceptance=${runId}`,"--network","none","--read-only","--cap-drop","ALL","--security-opt","no-new-privileges","--user",`${process.getuid!()}:${process.getgid!()}`,"--memory","1g","--cpus","1","--pids-limit","64","--tmpfs","/tmp:rw,nosuid,size=64m","--env","HOME=/tmp","--mount",`type=bind,src=${controller},dst=/controller,readonly`,"--mount",`type=bind,src=${root},dst=/candidate,readonly`,"--mount",`type=bind,src=${dependencies},dst=/node_modules,readonly`,"--workdir","/controller",image,"node","--import","tsx","script/software-factory-role-acceptance.ts","--guest"];
 // No /output or host socket mount; no credentials/environment passthrough.
 const child=spawn("docker",args,{stdio:["pipe","pipe","pipe"],windowsHide:true});
 const runtime=remoteAcceptanceRuntime(child.stdout,child.stdin);
 const timeout=setTimeout(()=>{runtime.close();child.kill();},60000);
 let stderr=0;child.stderr.on("data",b=>{stderr+=b.length;if(stderr>65536){runtime.close();child.kill();}});child.once("error",runtime.close);child.once("exit",runtime.close);
 try{return {headSha:sha,...await measureRoleWorkAcceptance(runtime)};}
 finally{clearTimeout(timeout);runtime.close();child.stdin.end();await exec("docker",["rm","-f",name],{timeout:15000,maxBuffer:65536});}
}
async function main(){
 if(process.argv[2]==="--guest"){
  // This path is invoked ONLY inside the credentialless separate container.
  const candidateModule=pathToFileURL("/candidate/server/office-role-work.ts").href;const runtime=await import(candidateModule);serveAcceptanceRuntime(process.stdin,process.stdout,runtime);return;
 }
 if(process.env.FACTORY_QA_ISOLATED!=="true"||process.platform!=="linux")throw Error("QA_ISOLATED_CI_REQUIRED");
 const args=process.argv.slice(2);if(args.length!==6)throw Error("QA_ARGUMENTS_REQUIRED");
 const [baseRoot,baseSha,headRoot,headSha,output,deps]=args;
 const baselineRoot=await checkedRoot(baseRoot,baseSha),candidateRoot=await checkedRoot(headRoot,headSha),dependencies=await realpath(deps);
 if(!path.isAbsolute(output)||baseSha===headSha||baselineRoot===candidateRoot||/[\r\n,]/.test(dependencies)||path.resolve(output).startsWith(baselineRoot+path.sep)||path.resolve(output).startsWith(candidateRoot+path.sep))throw Error("QA_DISTINCT_REVISIONS_REQUIRED");
 const baseline=await revision(baselineRoot,baseSha,baselineRoot,dependencies),candidate=await revision(candidateRoot,headSha,baselineRoot,dependencies);
 const report={version:1,repository:"robertmanzanillag-jpg/blackops-reminder",scenarioId:ROLE_WORK_ACCEPTANCE_ID,scope:"backend-acceptance-only",createdAt:new Date().toISOString(),baseline,candidate};
 const bytes=JSON.stringify(report);await writeFile(output,bytes,{flag:"wx",mode:0o600});
 process.stdout.write(JSON.stringify({artifactSha256:createHash("sha256").update(bytes).digest("hex"),baselinePassed:baseline.passed,candidatePassed:candidate.passed})+"\n");
 if(!candidate.passed)process.exitCode=1;
}
if(import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)void main().catch(()=>{console.error("Acceptance QA blocked: verify isolated exact clean checkouts and unique output path.");process.exitCode=1;});
