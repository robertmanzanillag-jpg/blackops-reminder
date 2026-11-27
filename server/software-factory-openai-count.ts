import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { currentFactoryApiParent } from "./factory-api-context";
import { FactoryApiBudgetError } from "./factory-api-invocation";

const COUNT_URL = "https://api.openai.com/v1/responses/input_tokens";
const GENERATE_URL = "https://api.openai.com/v1/responses";
const COUNT_FIELDS = new Set(["model", "instructions", "input", "reasoning", "text"]);
const GENERATE_FIELDS = new Set([...COUNT_FIELDS,"max_output_tokens","store","tools","stream","service_tier","prompt_cache_key"]);
const MAX_COUNT = 1_049_600, RECEIPT_TTL = 120_000;
type Parent = { ownerKey: string; jobId: string; fence: string };
type CountReceipt = { parent: Parent; promptSha256: string; inputTokens: number; obtainedAt: number; evidenceSha256: string };
type CountBinding = { receipt: CountReceipt; now: () => number; signal?: AbortSignal; consumed: boolean };
const taggedResponses = new WeakMap<Response,CountReceipt>();
const bindings = new AsyncLocalStorage<CountBinding>();
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
function sameParent(a: Parent, b: Parent) { return a.ownerKey===b.ownerKey && a.jobId===b.jobId && a.fence===b.fence; }
function canonical(value: unknown): string {
  if (value===null || typeof value!=="object") {
    const encoded=JSON.stringify(value); if(encoded===undefined) throw Error(); return encoded;
  }
  if (Array.isArray(value)) return "["+value.map(canonical).join(",")+"]";
  return "{"+Object.keys(value).sort().map(key=>JSON.stringify(key)+":"+canonical((value as Record<string,unknown>)[key])).join(",")+"}";
}
function promptSha256(body: unknown, generation: boolean): string | undefined {
  try {
    if (!body || typeof body!=="object" || Array.isArray(body)) return;
    const value=body as Record<string,unknown>;
    if (Object.keys(value).some(key=>!(generation?GENERATE_FIELDS:COUNT_FIELDS).has(key)) ||
      typeof value.model!=="string" || !value.model || typeof value.input!=="string" ||
      (value.instructions!==undefined && typeof value.instructions!=="string")) return;
    if (generation && (!Number.isSafeInteger(value.max_output_tokens) || (value.max_output_tokens as number)<1 ||
      (value.max_output_tokens as number)>128000 || value.store!==false || value.stream!==false || value.service_tier!=="default" ||
      !Array.isArray(value.tools) || value.tools.length!==0 ||
      (value.prompt_cache_key!==undefined && (typeof value.prompt_cache_key!=="string" || !/^[a-z0-9-]{1,64}$/.test(value.prompt_cache_key))))) return;
    const prompt: Record<string,unknown>={};
    for (const key of COUNT_FIELDS) if(Object.hasOwn(value,key)) prompt[key]=value[key];
    return digest(JSON.stringify(prompt));
  } catch { return; }
}
function live(receipt: CountReceipt, now: number): boolean {
  const parent=currentFactoryApiParent();
  return !!parent && !parent.signal?.aborted && sameParent(parent,receipt.parent) &&
    Number.isFinite(now) && now>=receipt.obtainedAt && now-receipt.obtainedAt<=RECEIPT_TTL;
}
/** Only this scoped, bounded, successful free HTTP count can mint a receipt. */
export function createFactoryOpenAiCountTransport(key: string, transport: typeof fetch = fetch, options: {now?:()=>number} = {}) {
  if (!/^sk-[A-Za-z0-9_-]{20,300}$/.test(key)) throw Error("FACTORY_OPENAI_CREDENTIAL_REQUIRED");
  const now=options.now??Date.now;
  return async (url: string, init: RequestInit): Promise<Response> => {
    if (url!==COUNT_URL || init.method!=="POST" || !init.signal || typeof init.body!=="string" || !init.body || Buffer.byteLength(init.body)>1048576)
      throw Error("FACTORY_OPENAI_COUNT_SCOPE_INVALID");
    const current=currentFactoryApiParent();
    if(!current) throw Error("FACTORY_OPENAI_COUNT_PARENT_CONTEXT_UNAVAILABLE");
    if(init.signal.aborted || current.signal?.aborted) throw Error("FACTORY_OPENAI_COUNT_CANCELLED");
    const parent={ownerKey:current.ownerKey,jobId:current.jobId,fence:current.fence};
    let body: unknown;try{body=JSON.parse(init.body);}catch{throw Error("FACTORY_OPENAI_COUNT_SCOPE_INVALID");}
    const promptDigest=promptSha256(body,false);if(!promptDigest) throw Error("FACTORY_OPENAI_COUNT_SCOPE_INVALID");
    try {
      const response=await transport(COUNT_URL,{method:"POST",body:JSON.stringify(body),signal:init.signal,redirect:"error",credentials:"omit",
        headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json",Accept:"application/json"}});
      if(!response.ok){await response.body?.cancel();throw Error();}
      const reader=response.body?.getReader();if(!reader)throw Error();
      const chunks:Uint8Array[]=[];let size=0;
      for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>4096){await reader.cancel();throw Error();}chunks.push(part.value);}
      const bytes=Buffer.concat(chunks), counted=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
      if(counted?.object!=="response.input_tokens" || !Number.isSafeInteger(counted.input_tokens) || counted.input_tokens<0 || counted.input_tokens>MAX_COUNT)throw Error();
      const obtainedAt=now(), active=currentFactoryApiParent();
      if(init.signal.aborted || !active || active.signal?.aborted || !sameParent(active,parent) || !Number.isFinite(obtainedAt))throw Error();
      const receipt={parent,promptSha256:promptDigest,inputTokens:counted.input_tokens,obtainedAt,
        evidenceSha256:digest(canonical({version:1,nonce:randomUUID(),parent,promptSha256:promptDigest,responseSha256:digest(bytes),inputTokens:counted.input_tokens,obtainedAt}))};
      const result=new Response(bytes,{status:response.status,statusText:response.statusText,headers:response.headers});
      taggedResponses.set(result,receipt);return result;
    } catch { throw Error("FACTORY_OPENAI_COUNT_TRANSPORT_UNCONFIRMED"); }
  };
}
/** Private one-use proof: a caller-supplied request/count cannot mint this binding. */
export function consumeFactoryOpenAiInputCount(body: unknown): {inputTokens:number;evidenceSha256:string;remainingMs:number} | undefined {
  const binding=bindings.getStore();if(!binding || binding.consumed)return;
  binding.consumed=true;
  const consumedAt=binding.now();
  if(binding.signal?.aborted || !live(binding.receipt,consumedAt) || promptSha256(body,true)!==binding.receipt.promptSha256)return;
  const remainingMs=RECEIPT_TTL-(consumedAt-binding.receipt.obtainedAt);
  if(remainingMs<1)return;
  return {inputTokens:binding.receipt.inputTokens,evidenceSha256:binding.receipt.evidenceSha256,remainingMs};
}
/** Successful receipts stay private and bounded; remove a matching receipt before generation. */
export function routeFactoryOpenAiRequests(gated:(url:string,init:RequestInit)=>Promise<Response>,count:(url:string,init:RequestInit)=>Promise<Response>,options:{now?:()=>number}={}) {
  const now=options.now??Date.now, receipts:CountReceipt[]=[];
  return async (url:string,init:RequestInit):Promise<Response>=>{
    if(url===COUNT_URL){
      const response=await count(url,init), receipt=taggedResponses.get(response);
      if(receipt){taggedResponses.delete(response);if(live(receipt,now())){receipts.push(receipt);if(receipts.length>32)receipts.shift();}}
      return response;
    }
    if(url!==GENERATE_URL)return gated(url,init);
    // Pre-dispatch: typed so the caller releases its credit hold.
    if(init.signal?.aborted || currentFactoryApiParent()?.signal?.aborted)throw new FactoryApiBudgetError("FACTORY_OPENAI_COUNT_CANCELLED",false);
    let body:unknown;try{body=typeof init.body==="string"?JSON.parse(init.body):undefined;}catch{body=undefined;}
    const promptDigest=promptSha256(body,true), at=now();
    for(let index=receipts.length-1;index>=0;index--){const receipt=receipts[index];if(!Number.isFinite(at)||at<receipt.obtainedAt||at-receipt.obtainedAt>RECEIPT_TTL)receipts.splice(index,1);}
    const index=promptDigest?receipts.findIndex(receipt=>receipt.promptSha256===promptDigest && live(receipt,at)):-1;
    if(index<0)return gated(url,init);
    const [receipt]=receipts.splice(index,1), binding:CountBinding={receipt,now,signal:init.signal??undefined,consumed:false};
    return bindings.run(binding,async()=>{try{return await gated(url,init);}finally{binding.consumed=true;}});
  };
}
