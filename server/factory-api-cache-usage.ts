import {createHash} from 'node:crypto';
import {FactoryTokenCostError} from './factory-api-token-cost';
const count=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
const invalid=():never=>{throw new FactoryTokenCostError('FACTORY_API_USAGE_UNVERIFIED');};
/** Explicit provider counters only. A measured total of zero proves zero writes;
 * missing counters never imply zero. Unknown TTL/dimension fields fail closed. */
export function readOpenAiCacheUsage(raw:unknown){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return invalid();
 const details=raw as Record<string,unknown>;
 const allowed=new Set(['cached_tokens','cache_write_tokens','cache_write_tokens_details','audio_tokens','image_tokens']);
 if(Object.keys(details).some(key=>!allowed.has(key))||!count(details.cached_tokens)||!count(details.cache_write_tokens))return invalid();
 for(const dimension of ['audio_tokens','image_tokens'])if(details[dimension]!==undefined&&details[dimension]!==0)return invalid();
 let short=0,long=0;
 const split=details.cache_write_tokens_details;
 if(split!==undefined){
  if(!split||typeof split!=='object'||Array.isArray(split))return invalid();
  const value=split as Record<string,unknown>;
  if(Object.keys(value).some(key=>!['ttl_30m_tokens','ttl_12h_tokens'].includes(key))||!count(value.ttl_30m_tokens)||!count(value.ttl_12h_tokens))return invalid();
  short=value.ttl_30m_tokens;long=value.ttl_12h_tokens;
 }else{
  // OpenAI documents cache_write_tokens without a TTL split (prompt-caching guide).
  // Unsplit writes are priced at the 12h (most expensive) rate: never under-count.
  long=details.cache_write_tokens;
 }
 if(BigInt(short)+BigInt(long)!==BigInt(details.cache_write_tokens))return invalid();
 const canonical={cached_tokens:details.cached_tokens,cache_write_tokens:details.cache_write_tokens,
  cache_write_tokens_details:split===undefined?null:{ttl_30m_tokens:short,ttl_12h_tokens:long},
  audio_tokens:details.audio_tokens??null,image_tokens:details.image_tokens??null};
 return {cachedInputTokens:details.cached_tokens,cacheWriteTokens:details.cache_write_tokens,
  cacheWrite30mTokens:short,cacheWrite12hTokens:long,
  inputTokenDetailsSha256:createHash('sha256').update(JSON.stringify(canonical)).digest('hex')};
}

/** Reasoning tokens are already included in text output. Any unsupported
 * positive output dimension or unknown detail cannot be priced as ordinary text. */
export function validateTextOutputTokenDetails(raw:unknown,outputTokens:unknown):void{
 if(raw===undefined)return;
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||!count(outputTokens))return invalid();
 const value=raw as Record<string,unknown>;
 const allowed=new Set(['reasoning_tokens','audio_tokens','image_tokens','accepted_prediction_tokens','rejected_prediction_tokens']);
 if(Object.keys(value).some(key=>!allowed.has(key)))return invalid();
 if(value.reasoning_tokens!==undefined&&(!count(value.reasoning_tokens)||value.reasoning_tokens>outputTokens))return invalid();
 for(const key of ['audio_tokens','image_tokens','accepted_prediction_tokens','rejected_prediction_tokens'])if(value[key]!==undefined&&value[key]!==0)return invalid();
}

/** OpenAI may echo a dated snapshot of the requested alias (e.g. gpt-6.1-sol ->
 * gpt-6.1-sol-2026-09-29). Only that exact alias plus a "-YYYY-MM-DD" suffix is
 * accepted; any other returned model stays unconfirmed (never re-priced). */
export function factoryResponseModelMatches(configured:unknown,returned:unknown):boolean{
 if(typeof configured!=='string'||typeof returned!=='string'||!configured||returned.length>200)return false;
 if(returned===configured)return true;
 if(/-\d{4}-\d{2}-\d{2}$/.test(configured)||!returned.startsWith(configured+'-'))return false;
 const suffix=returned.slice(configured.length+1);
 return /^\d{4}-\d{2}-\d{2}$/.test(suffix)&&Number.isFinite(Date.parse(suffix+'T00:00:00Z'))&&new Date(suffix+'T00:00:00Z').toISOString().slice(0,10)===suffix;
}
/** Safe, code-owned sub-causes for post-dispatch unconfirmed outcomes. */
export const factoryUnconfirmedSubCauses=['MODEL_MISMATCH','USAGE_INVALID','USAGE_BOUNDS','SERVICE_TIER_UNPRICED','STATUS_ACTIVE','OUTPUT_UNPARSEABLE','RESPONSE_ID_INVALID','HTTP_ERROR','BODY_UNPARSEABLE','RESPONSE_TOO_LARGE','TRANSPORT','CANCELLED','PRICING_EXPIRED','COST_INVALID','SETTLE_FAILED','UNKNOWN'] as const;
export type FactoryUnconfirmedSubCause=typeof factoryUnconfirmedSubCauses[number];
export const factoryUnconfirmedSubCause=(value:unknown):FactoryUnconfirmedSubCause|undefined=>{
 try{const m=value instanceof Error?Object.getOwnPropertyDescriptor(value,'message')?.value:value;return typeof m==='string'&&(factoryUnconfirmedSubCauses as readonly string[]).includes(m)?m as FactoryUnconfirmedSubCause:undefined;}catch{return undefined;}
};

/** ONE safe shape line for a post-dispatch failure: key names, model, status,
 * incomplete reason, output item types and usage key names. Never content,
 * ids, text or numbers (beyond structure). */
export function factoryResponseShape(body:unknown){
 const keys=(v:unknown)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.keys(v).filter(k=>/^[a-z][a-z0-9_]{0,40}$/.test(k)).sort().slice(0,40):null;
 const token=(v:unknown,re:RegExp)=>typeof v==='string'&&re.test(v)?v:v===undefined?undefined:v===null?null:'invalid';
 const b=body&&typeof body==='object'&&!Array.isArray(body)?body as Record<string,any>:undefined;
 const usage=b?.usage&&typeof b.usage==='object'?b.usage:undefined;
 return {keys:keys(b),model:token(b?.model,/^[A-Za-z0-9._:-]{1,100}$/),status:token(b?.status,/^[a-z_]{1,30}$/),
  incomplete_reason:token(b?.incomplete_details?.reason,/^[a-z_]{1,40}$/),
  output_types:Array.isArray(b?.output)?b!.output.slice(0,20).map((i:any)=>token(i?.type,/^[a-z_]{1,40}$/)??'none'):null,
  content_types:Array.isArray(b?.output)?b!.output.slice(0,20).flatMap((i:any)=>Array.isArray(i?.content)?i.content.slice(0,10).map((c:any)=>token(c?.type,/^[a-z_]{1,40}$/)??'none'):[]):null,
  service_tier:token(b?.service_tier,/^[a-z_]{1,20}$/),
  usage_keys:keys(usage),input_details_keys:keys(usage?.input_tokens_details),output_details_keys:keys(usage?.output_tokens_details)};
}
export function logFactoryResponseShape(stage:string,subCause:string,body:unknown){
 try{console.warn(`[factory-openai-shape] ${JSON.stringify({stage,subCause,...factoryResponseShape(body)})}`);}catch{/* logging never changes the outcome */}
}

/** OpenAI HTTP statuses that reject a request before generation: validation
 * (400/404/422), authentication/permission (401/403) and 429 quota/rate limits.
 * They return an error object and no usage, so no tokens were generated or
 * billed; 5xx, timeouts and transport failures stay unconfirmed (unknown). */
export const factoryOpenAiRejectedStatuses=new Set([400,401,403,404,422,429]);
const enumLike=(v:unknown)=>typeof v==='string'?(v.replace(/[^A-Za-z0-9_.-]/g,'').slice(0,80)||null):null;
/** Error code: FACTORY_OPENAI_REQUEST_REJECTED:<status>:<code|type|none>. */
export const FACTORY_OPENAI_REQUEST_REJECTED_PATTERN=/^FACTORY_OPENAI_REQUEST_REJECTED:(?:400|401|403|404|422|429):[A-Za-z0-9_.-]{1,80}$/;
export class FactoryOpenAiRequestRejectedError extends Error{
 readonly notBilled=true as const;
 constructor(readonly status:number,readonly code:string){super(`FACTORY_OPENAI_REQUEST_REJECTED:${status}:${code}`);}
}
export const isFactoryOpenAiRequestRejected=(error:unknown):error is FactoryOpenAiRequestRejectedError=>{
 try{return error instanceof FactoryOpenAiRequestRejectedError&&FACTORY_OPENAI_REQUEST_REJECTED_PATTERN.test(error.message);}catch{return false;}
};
/** Safe summary of an OpenAI error body plus the request's model and top-level
 * keys. Only enum-like fields (type/code/param), never message or content. */
export function factoryOpenAiHttpErrorSummary(status:number,errorBody:unknown,request:unknown){
 const e=errorBody&&typeof errorBody==='object'&&!Array.isArray(errorBody)?(errorBody as any).error:undefined;
 const err=e&&typeof e==='object'&&!Array.isArray(e)?e:undefined;
 const r=request&&typeof request==='object'&&!Array.isArray(request)?request as Record<string,unknown>:undefined;
 return {status:Number.isSafeInteger(status)?status:0,type:enumLike(err?.type),code:enumLike(err?.code),param:enumLike(err?.param),
  model:enumLike(r?.model),request_keys:r?Object.keys(r).filter(k=>/^[a-z][a-z0-9_]{0,40}$/.test(k)).sort().slice(0,40):null};
}
/** Reads at most 16 KiB of the error body, logs ONE safe line, then throws:
 * FactoryOpenAiRequestRejectedError for not-billed rejections, else HTTP_ERROR. */
export async function failFactoryOpenAiHttpResponse(stage:string,response:Response,request:unknown):Promise<never>{
 let parsed:unknown;
 try{const reader=response.body?.getReader();const chunks:Uint8Array[]=[];let size=0;
  if(reader)for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;chunks.push(part.value);if(size>16384){await reader.cancel().catch(()=>undefined);break;}}
  parsed=size<=16384?JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))):undefined;}catch{parsed=undefined;}
 const summary=factoryOpenAiHttpErrorSummary(response.status,parsed,request);
 try{console.warn(`[factory-openai-http-error] ${JSON.stringify({stage,...summary})}`);}catch{/* logging never changes the outcome */}
 if(factoryOpenAiRejectedStatuses.has(response.status))throw new FactoryOpenAiRequestRejectedError(response.status,summary.code??summary.type??'none');
 throw Error('HTTP_ERROR');
}
