import type {EventEmitter} from 'node:events';

type ClientEmitter = Pick<EventEmitter,'on'>;
type PoolEmitter = Pick<EventEmitter,'on'>;
type LossHandler = (client:ClientEmitter)=>void;
type Observation = {active:WeakSet<object>; clients:WeakSet<object>; handlers:Set<LossHandler>};
const observations=new WeakMap<object,Observation>();
const disconnected=new WeakSet<object>();
export type PostgresPoolDiagnostic={code:'POSTGRES_IDLE_CONNECTION_LOST'|'POSTGRES_CHECKED_OUT_CONNECTION_LOST'|'POSTGRES_LOSS_HANDLER_FAILED';role:string};
/** Read-only evidence for owners of a dedicated session. Never reconnect that
 * session and assume its advisory lock survived. */
export const postgresClientDisconnected=(client:object)=>disconnected.has(client);

/** pg removes failed idle clients itself and lazily replaces them. Catch the
 * documented Pool event without intercepting query promises or retrying work.
 * Checked-out clients need their own listener: pg-pool removes its idle listener
 * during checkout. The driver still rejects active/subsequent queries normally. */
export function observePostgresPool<T extends PoolEmitter>(pool:T,options:{
 role:string; onCheckedOutError?:LossHandler;
 report?:(diagnostic:PostgresPoolDiagnostic)=>void;
}):T{
 const existing=observations.get(pool);
 if(existing){if(options.onCheckedOutError)existing.handlers.add(options.onCheckedOutError);return pool;}
 const state:Observation={active:new WeakSet(),clients:new WeakSet(),handlers:new Set(options.onCheckedOutError?[options.onCheckedOutError]:[])};
 observations.set(pool,state);
 const role=/^[a-z][a-z0-9-]{0,39}$/.test(options.role)?options.role:'database';
 const emit=(code:PostgresPoolDiagnostic['code'])=>{
  // No error object, free-text message, stack, client or connection settings.
  try{(options.report??(item=>console.error(JSON.stringify(item))))({code,role});}catch{/* Logging must not crash the service. */}
 };
 pool.on('error',()=>emit('POSTGRES_IDLE_CONNECTION_LOST'));
 pool.on('acquire',(client:object)=>state.active.add(client));
 pool.on('release',(_error:unknown,client:object)=>state.active.delete(client));
 pool.on('connect',(client:ClientEmitter)=>{
  if(state.clients.has(client))return;state.clients.add(client);
  client.on('error',()=>{
   disconnected.add(client);
   if(!state.active.has(client))return;
   emit('POSTGRES_CHECKED_OUT_CONNECTION_LOST');
   for(const handler of state.handlers){try{handler(client);}catch{emit('POSTGRES_LOSS_HANDLER_FAILED');}}
  });
 });
 return pool;
}
