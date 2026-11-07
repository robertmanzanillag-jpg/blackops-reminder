import {createHash} from "node:crypto";
import type {FactoryCandidate} from "./software-factory";
import type {FactoryPilotGitHubClient} from "./software-factory-github-client";
import {FACTORY_ASISTENTE_REPOSITORY} from "./software-factory-github-client";
import type {AsistenteReviewSource} from "./software-factory-asistente-review";

/** Exact immutable GitHub diff, without cloning, executing repository code,
 * fetching unchanged file bodies or giving source code access to credentials. */
export function createAsistenteReviewSourceLoader(client: FactoryPilotGitHubClient, paths: readonly string[]) {
 const allowed=new Set(paths),scope={owner:"robertmanzanillag-jpg",repo:"blackops-reminder"};
 const safe=(path:string)=>path.length<=1000&&/^(?:client\/src\/|server\/|shared\/|tests\/)/.test(path)&&
  !/[\\:\x00-\x20\x7f]/.test(path)&&!path.split("/").some(s=>!s||s==="."||s===".."||/[. ]$/.test(s)||/^\.(?:env|git|aws|ssh)/i.test(s)||/^(?:credentials|secrets|node_modules|id_rsa|id_ed25519)$/i.test(s))&&
  !/kong|software-factory|office-token-budget|credit|auth|permission|payment|migration|\.(?:pem|key|p12|pfx)$/i.test(path);
 if(!paths.length||paths.length>64||allowed.size!==paths.length||paths.some(p=>!safe(p)))throw Error("FACTORY_REVIEW_PATHS_INVALID");
 return async(rawCandidate:FactoryCandidate,signal:AbortSignal):Promise<AsistenteReviewSource>=>{
  const candidate=structuredClone(rawCandidate);
  signal.throwIfAborted();
  if(!/^[a-f0-9]{40}$/.test(candidate.baseSha)||!/^[a-f0-9]{40}$/.test(candidate.headSha)||candidate.baseSha===candidate.headSha||
    !candidate.changedFiles.length||candidate.changedFiles.length>64||new Set(candidate.changedFiles).size!==candidate.changedFiles.length||candidate.changedFiles.some(p=>!allowed.has(p)))throw Error("FACTORY_REVIEW_SCOPE_INVALID");
  const commits=await Promise.all([candidate.baseSha,candidate.headSha].map(commit_sha=>client.git.getCommit({...scope,commit_sha})));
  if(commits[0].data.sha!==candidate.baseSha||commits[1].data.sha!==candidate.headSha||commits[1].data.parents.length!==1||commits[1].data.parents[0].sha!==candidate.baseSha)throw Error("FACTORY_REVIEW_LINEAGE_INVALID");
  const trees=await Promise.all(commits.map(c=>client.git.getTree({...scope,tree_sha:c.data.tree.sha,recursive:"1"})));
  const maps=trees.map((t,i)=>{
   if(t.data.sha!==commits[i].data.tree.sha||t.data.truncated||t.data.tree.length>20000)throw Error("FACTORY_REVIEW_TREE_INVALID");
   const seen=new Set<string>(),map=new Map<string,{sha:string;mode:string;type:string}>();
   for(const row of t.data.tree){
    const normalized=row.path.normalize("NFC").toLowerCase();
    if(seen.has(normalized)||!row.path||row.path.includes("\\")||row.path.split("/").some(p=>!p||p==="."||p===".."))throw Error("FACTORY_REVIEW_TREE_INVALID");
    seen.add(normalized);
    if(row.type!=="tree")map.set(row.path,row);
   }
   return map;
  });
  const changed=[...new Set([...maps[0].keys(),...maps[1].keys()])].filter(p=>{
   const a=maps[0].get(p),b=maps[1].get(p);return !a||!b||a.sha!==b.sha||a.mode!==b.mode||a.type!==b.type;
  }).sort();
  if(JSON.stringify(changed)!==JSON.stringify([...candidate.changedFiles].sort()))throw Error("FACTORY_REVIEW_DIFF_MISMATCH");
  const files:AsistenteReviewSource["files"]=[];let total=0;
  for(const path of changed){
   const versions:string[]=[];
   for(const map of maps){
    signal.throwIfAborted();const row=map.get(path);
    if(!row||row.type!=="blob"||row.mode!=="100644")throw Error("FACTORY_REVIEW_FILE_MODE_INVALID");
    const blob=(await client.git.getBlob({...scope,file_sha:row.sha})).data;
    const bytes=Buffer.from(blob.content.replace(/\s/g,""),"base64");
    if(blob.sha!==row.sha||blob.encoding!=="base64"||blob.size!==bytes.length||bytes.length>100000||
      createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex")!==row.sha)throw Error("FACTORY_REVIEW_BLOB_INVALID");
    total+=bytes.length;if(total>180000)throw Error("FACTORY_REVIEW_SOURCE_TOO_LARGE");
    const text=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes);if(text.includes("\0"))throw Error("FACTORY_REVIEW_TEXT_INVALID");versions.push(text);
   }
   files.push({path,baseline:versions[0],candidate:versions[1]});
  }
  signal.throwIfAborted();
  return {repository:FACTORY_ASISTENTE_REPOSITORY,baseSha:candidate.baseSha,headSha:candidate.headSha,changedFiles:changed,files};
 };
}
