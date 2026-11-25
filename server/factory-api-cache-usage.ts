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
