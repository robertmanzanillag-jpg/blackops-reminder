import {requireFactoryCacheWritePrice} from './factory-api-token-cost';
import {readOpenAiCacheUsage,validateTextOutputTokenDetails} from './factory-api-cache-usage';
import {currentFactoryApiParent} from "./factory-api-context";
import {FactoryApiBudgetError,factoryApiPriceSchema,apiEvidenceHash,configuredFactoryApiPrice,defaultFactoryApiInvocation,type createFactoryApiInvocation,type FactoryApiUsage} from './factory-api-invocation';
type Invocation=ReturnType<typeof createFactoryApiInvocation>;
type Env=Readonly<Record<string,string|undefined>>;
const ALLOWED=new Set(['chat.completions.create','responses.create']);
const commonFields=["model","temperature","top_p","store","metadata","user","safety_identifier","service_tier","tools","stream"];
const chatFields=new Set([...commonFields,"messages","max_completion_tokens","max_tokens","n","stop","seed","frequency_penalty","presence_penalty","reasoning_effort","response_format","verbosity","thinking","modalities"]);
const responseFields=new Set([...commonFields,"input","instructions","max_output_tokens","reasoning","text"]);
function snapshotBody(value:unknown):any{
 try{
  const encoded=JSON.stringify(value);if(!encoded||Buffer.byteLength(encoded)>1_048_576)throw Error("size");
  const snapshot=JSON.parse(encoded);
  const freeze=(item:any,depth=0):any=>{if(depth>64)throw Error("depth");if(item&&typeof item==="object"){for(const child of Object.values(item))freeze(child,depth+1);Object.freeze(item);}return item;};
  return freeze(snapshot);
 }catch{throw new FactoryApiBudgetError("FACTORY_API_REQUEST_UNBOUNDED");}
}
/** Snapshot the provider JSON before asynchronous settlement so SDK-owned
 * aliases cannot change the usage returned to the caller after it was charged. */
function snapshotProviderResult(value:any):any{
 const encoded=JSON.stringify(value);if(!encoded||Buffer.byteLength(encoded)>2_097_152)throw Error('provider result unverified');
 const result=JSON.parse(encoded);
 const requestId=value&&typeof value==='object'?Object.getOwnPropertyDescriptor(value,'_request_id'):undefined;
 if(requestId&&'value' in requestId&&typeof requestId.value==='string'&&requestId.value.length<=300&&result&&typeof result==='object')Object.defineProperty(result,'_request_id',{value:requestId.value,enumerable:requestId.enumerable});
 return result;
}
export function snapshotFactoryApiRequestOptions(value:unknown):Readonly<{signal?:AbortSignal;timeout?:number}>{
 try{
  if(value===undefined)return Object.freeze({});
  if(!value||typeof value!=="object"||![null,Object.prototype].includes(Object.getPrototypeOf(value)))throw Error("shape");
  const descriptors=Object.getOwnPropertyDescriptors(value),result:{signal?:AbortSignal;timeout?:number}={};
  for(const key of Reflect.ownKeys(descriptors)){
   if(typeof key!=="string"||!["signal","timeout"].includes(key))throw Error("override");
   const descriptor=descriptors[key];if(!("value" in descriptor))throw Error("getter");
   const field=descriptor.value;
   if(key==="signal"){if(field!==undefined&&!(field instanceof AbortSignal))throw Error("signal");result.signal=field;}
   else{if(field!==undefined&&(!Number.isSafeInteger(field)||field<=0))throw Error("timeout");result.timeout=field;}
  }
  return Object.freeze(result);
 }catch{throw new FactoryApiBudgetError("FACTORY_API_REQUEST_OPTIONS_UNSUPPORTED");}
}
function snapshotPrice(value:unknown){try{return Object.freeze(factoryApiPriceSchema.parse(value));}catch{throw new FactoryApiBudgetError("FACTORY_API_PRICING_UNVERIFIED");}}
/** A complete explicit profile stays pinned. A legacy partial profile can migrate
 * only to one whole operator-configured profile, never guessed or mixed rates. */
export function selectFactoryApiTextPrice(provider:string,model:string,env:Env,supplied:unknown){
 if(provider==='integration')throw new FactoryApiBudgetError('FACTORY_API_INTEGRATION_PROTOCOL_UNVERIFIED');
 let price=snapshotPrice(supplied??configuredFactoryApiPrice(provider,model,env.FACTORY_API_PRICING_CONFIG));
 if(provider!=='deepseek'){
  try{requireFactoryCacheWritePrice(price);}catch{
   if(env.FACTORY_API_PRICING_CONFIG){
    const catalog=snapshotPrice(configuredFactoryApiPrice(provider,model,env.FACTORY_API_PRICING_CONFIG));
    if(supplied!==undefined&&(catalog.model!==price.model||catalog.inputNanoUsdPerToken!==price.inputNanoUsdPerToken||catalog.outputNanoUsdPerToken!==price.outputNanoUsdPerToken||(['cachedInputNanoUsdPerToken','cacheWrite30mNanoUsdPerToken','cacheWrite12hNanoUsdPerToken','maxInputTokens'] as const).some(key=>price[key]!==undefined&&price[key]!==catalog[key])))throw new FactoryApiBudgetError('FACTORY_API_PRICING_PROFILE_MISMATCH');
    price=catalog;
   }
   try{requireFactoryCacheWritePrice(price);}catch{throw new FactoryApiBudgetError('FACTORY_API_CACHE_WRITE_PRICING_UNVERIFIED');}
  }
 }
 if(price.model!==model||price.cachedInputNanoUsdPerToken!==undefined&&price.cachedInputNanoUsdPerToken>price.inputNanoUsdPerToken)throw new FactoryApiBudgetError('FACTORY_API_PRICING_UNVERIFIED');
 return price;
}
/** Only bounded text requests are currently priced. Missing evidence,
 * streaming/audio/images/hosted tools remain held before any SDK operation. */
function boundedRequest(path:string,body:any){
 if(!ALLOWED.has(path)||!body||typeof body!=='object'||Array.isArray(body)||(body.stream!==undefined&&body.stream!==false)||body.background||body.previous_response_id||body.conversation||(body.tools!==undefined&&(!Array.isArray(body.tools)||body.tools.length!==0))||body.web_search_options||(body.modalities!==undefined&&(!Array.isArray(body.modalities)||body.modalities.some((m:unknown)=>m!=='text')))||body.audio||(body.service_tier!==undefined&&body.service_tier!=="default"))throw new FactoryApiBudgetError('FACTORY_API_OPERATION_UNPRICED');
 const fields=path==="responses.create"?responseFields:chatFields;
 if(Object.keys(body).some(key=>!fields.has(key)))throw new FactoryApiBudgetError("FACTORY_API_OPERATION_UNPRICED");
 if(body.max_tokens!==undefined&&body.max_completion_tokens!==undefined)throw new FactoryApiBudgetError("FACTORY_API_REQUEST_UNBOUNDED");
 const containsMedia=(value:any):boolean=>{
  if(!value||typeof value!=='object')return false;
  if(Array.isArray(value))return value.some(containsMedia);
  if(value.type&& !['text','input_text','output_text','message'].includes(value.type))return true;
  return Object.entries(value).some(([key,value])=>['image_url','file_id','input_audio','file_data','attachments','id','call_id','tool_call_id','reference_id','cache_control','prompt_cache_options','prompt_cache_retention','cache_ttl'].includes(key)||containsMedia(value));
 };
 if(containsMedia(body.messages)||containsMedia(body.input))throw new FactoryApiBudgetError('FACTORY_API_OPERATION_UNPRICED');
 const count=body.n===undefined?1:body.n;if(count!==1)throw new FactoryApiBudgetError('FACTORY_API_REQUEST_UNBOUNDED');
 const maxOutputTokens=path==="responses.create"?body.max_output_tokens:(body.max_completion_tokens??body.max_tokens);
 const encoded=JSON.stringify(body);if(!encoded)throw new FactoryApiBudgetError('FACTORY_API_REQUEST_UNBOUNDED');
 return {model:String(body.model??''),promptBytes:Buffer.byteLength(encoded),maxOutputTokens};
}
export function snapshotFactoryApiRequest(path:string,value:unknown){
 if(!ALLOWED.has(path))throw new FactoryApiBudgetError("FACTORY_API_OPERATION_UNPRICED");
 const body=snapshotBody(value);return {body,bounds:boundedRequest(path,body)};
}
function usage(path:string,result:any,provider="openai"):FactoryApiUsage{
 if(provider!=="deepseek"&&result?.service_tier!==undefined&&result.service_tier!=="default")throw Error("unpriced returned service tier");
 if(path==="responses.create"){
  if(Array.isArray(result?.output)&&result.output.some((item:any)=>!["message","reasoning"].includes(item?.type)))throw Error("unpriced output operation");
  if(!["completed","incomplete","failed","cancelled"].includes(result?.status))throw Error("unconfirmed terminal response");
 }else if(!Array.isArray(result?.choices)||result.choices.length!==1||!["stop","length","content_filter","tool_calls","function_call"].includes(result.choices[0]?.finish_reason))throw Error("unconfirmed terminal completion");
 const values=path==='responses.create'?{input:result?.usage?.input_tokens,output:result?.usage?.output_tokens}:{input:result?.usage?.prompt_tokens,output:result?.usage?.completion_tokens};
 if(result?.usage?.total_tokens!==undefined&&(!Number.isSafeInteger(result.usage.total_tokens)||result.usage.total_tokens!==values.input+values.output))throw Error('inconsistent total usage');
 validateTextOutputTokenDetails(path==='responses.create'?result?.usage?.output_tokens_details:result?.usage?.completion_tokens_details,values.output);
 const details=path==='responses.create'?result?.usage?.input_tokens_details:result?.usage?.prompt_tokens_details;
 const cache=provider==='deepseek'?{cachedInputTokens:result?.usage?.prompt_cache_hit_tokens,
  ...(details?.cache_write_tokens!==undefined||details?.cache_write_tokens_details!==undefined?readOpenAiCacheUsage({...details,cached_tokens:result?.usage?.prompt_cache_hit_tokens}):{})}:readOpenAiCacheUsage(details);
 return {model:result?.model,responseId:result?.id,inputTokens:values.input,outputTokens:values.output,...cache};
}
/** Applied at SDK construction, including legacy and integration clients.
 * The actual SDK receives retries=0; tests inject this SAME authority boundary. */
const guardedClients=new WeakSet<object>();
export function guardFactoryOpenAiClient<T extends object>(client:T,options:{provider:'openai'|'deepseek'|'integration';consumer?:'router'|'clippers'|'other';env?:Env;invoke?:Invocation;price?:(model:string)=>import('./factory-api-invocation').FactoryApiPrice}):T{
 options={...options};
 if(guardedClients.has(client))return client;
 const configuredTimeout=Object.getOwnPropertyDescriptor(client,"timeout")?.value;
 const cache=new WeakMap<object,Map<string,object>>();
 const wrap=(target:any,path:string):any=>{
  if(!target||typeof target!=='object')return target;
  const entries=cache.get(target)??new Map();cache.set(target,entries);if(entries.has(path))return entries.get(path);
  const proxy=new Proxy(target,{get(object,key){const value=Reflect.get(object,key,object);if(typeof key!=='string')return value;const next=path?path+'.'+key:key;
   if(typeof value==='function')return async(body:any,requestOptions?:any)=>{
    let snapshot=snapshotFactoryApiRequest(next,body);
    if(options.provider!=='deepseek'&&snapshot.body.service_tier===undefined)snapshot=snapshotFactoryApiRequest(next,{...snapshot.body,service_tier:'default'});
    body=snapshot.body;requestOptions=snapshotFactoryApiRequestOptions(requestOptions);
    const bounded=snapshot.bounds,env=options.env??process.env;
    const price=selectFactoryApiTextPrice(options.provider,bounded.model,env,options.price?.(bounded.model));
    if(price.model!==bounded.model)throw new FactoryApiBudgetError("FACTORY_API_PRICING_UNVERIFIED");
    const coverage=options.provider!=='deepseek';if(coverage)try{requireFactoryCacheWritePrice(price);}catch{throw new FactoryApiBudgetError('FACTORY_API_CACHE_WRITE_PRICING_UNVERIFIED');}
    const invoke=options.invoke??await defaultFactoryApiInvocation();
    return invoke({consumer:options.consumer??'router',requestSha256:apiEvidenceHash([options.provider,next,body]),price,...bounded,cacheWriteCoverage:coverage,
     signal:requestOptions?.signal,call:async limits=>{
      const candidates=[limits.timeout,requestOptions?.timeout,configuredTimeout].filter((n):n is number=>typeof n==="number"&&Number.isFinite(n)&&n>0);
      const timeout=Math.max(1,Math.floor(Math.min(...candidates))),signal=timeout<limits.timeout?AbortSignal.any([limits.signal,AbortSignal.timeout(timeout)]):limits.signal;
      signal.throwIfAborted();const result=await Reflect.apply(value,object,[body,{...requestOptions,...limits,timeout,signal}]);signal.throwIfAborted();return snapshotProviderResult(result);
     },usage:result=>usage(next,result,options.provider)});
   };
   return wrap(value,next);
  }});entries.set(path,proxy);return proxy;
 };
 const guarded=wrap(client,'');guardedClients.add(guarded);return guarded;
}
/** Gemini currently has no verified bound for thoughts, modalities, grounding
 * and streams in the installed adapter. Hold every model operation before SDK
 * dispatch; a future adapter must price those exact dimensions before enabling. */
export function holdUnpricedGeminiClient<T extends object>(client:T):T{
 const cache=new WeakMap<object,object>();
 const wrap=(target:any):any=>{if(!target||typeof target!=="object")return target;if(cache.has(target))return cache.get(target);
  const proxy=new Proxy(target,{get(object,key){const value=Reflect.get(object,key,object);if(typeof value==="function")return async()=>{throw new FactoryApiBudgetError("FACTORY_API_GEMINI_USAGE_UNPRICED");};return wrap(value);}});cache.set(target,proxy);return proxy;
 };return wrap(client);
}

/** Raw Office/Factory Responses transport shares the same gate. Counting,
 * polling and other endpoints are held until separately priced/authorized. */
const guardedFetches=new WeakSet<Function>();
export function guardFactoryOpenAiFetch(transport:typeof fetch,options:{price?:import('./factory-api-invocation').FactoryApiPrice;
 requireParent?:boolean;consumer?:'office'|'academy'|'other';executionId?:string;env?:Env;invoke?:Invocation}={}):typeof fetch{
 options={...options};
 if(guardedFetches.has(transport))return transport;
 const guarded=(async(url,init)=>{
  if(options.requireParent&&!currentFactoryApiParent())throw new FactoryApiBudgetError("FACTORY_API_PARENT_CONTEXT_UNAVAILABLE");
  let method:unknown,encoded:unknown,signal:AbortSignal|undefined,headers:Headers;
  try{method=init?.method;encoded=init?.body;signal=init?.signal??undefined;headers=new Headers(init?.headers);}catch{throw new FactoryApiBudgetError("FACTORY_API_REQUEST_UNBOUNDED");}
  if(url!=="https://api.openai.com/v1/responses"||method!=="POST"||typeof encoded!=="string"||Buffer.byteLength(encoded)>1_048_576)throw new FactoryApiBudgetError("FACTORY_API_OPERATION_UNPRICED");
  let body:any;try{body=snapshotBody(JSON.parse(encoded));if(body.service_tier===undefined)body=snapshotBody({...body,service_tier:'default'});}catch{throw new FactoryApiBudgetError("FACTORY_API_REQUEST_UNBOUNDED");}
  const request=Object.freeze({method:"POST",body:JSON.stringify(body),headers,credentials:"omit" as const});
  const bounded=boundedRequest('responses.create',body),env=options.env??process.env;
  const price=selectFactoryApiTextPrice('openai',bounded.model,env,options.price);
  if(price.model!==bounded.model)throw new FactoryApiBudgetError('FACTORY_API_PRICING_UNVERIFIED');
  try{requireFactoryCacheWritePrice(price);}catch{throw new FactoryApiBudgetError('FACTORY_API_CACHE_WRITE_PRICING_UNVERIFIED');}
  const invoke=options.invoke??await defaultFactoryApiInvocation();
  const output=await invoke({executionId:options.executionId,consumer:options.consumer??'office',requestSha256:apiEvidenceHash(body),price,...bounded,cacheWriteCoverage:true,signal,
   call:async limits=>{
    const response=await transport(url,{...request,redirect:'error',signal:limits.signal});
    if(!response.ok){await response.body?.cancel();throw Error('http');}
    const clone=response.clone(),reader=clone.body?.getReader();if(!reader)throw Error('empty');
    const chunks:Uint8Array[]=[];let bytes=0;
    for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>2_097_152){await reader.cancel();throw Error('size');}chunks.push(part.value);}
    return {response,body:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)))};
   },usage:result=>usage('responses.create',result.body)});
  return output.response;
 }) as typeof fetch;
 guardedFetches.add(guarded);return guarded;
}
