import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import pg from 'pg';
import {observePostgresPool,postgresClientDisconnected,type PostgresPoolDiagnostic} from '../server/postgres-pool-safety';
import {syntheticPostgres,until} from './helpers/synthetic-postgres';
import {createFactoryApiInvocation} from '../server/factory-api-invocation';
import {emptyFactoryApiState,checkpointFactoryApiMonth,reserveFactoryApi,unknownFactoryApi,factoryApiExecutionWindow,factoryApiBudgetStatus} from '../server/software-factory-api-budget';
async function harness(onCheckedOutError?:(client:any)=>void){
 const server=await syntheticPostgres(),diagnostics:PostgresPoolDiagnostic[]=[];
 const pool=observePostgresPool(new pg.Pool({host:'127.0.0.1',port:server.port,user:'synthetic',database:'synthetic',ssl:false,max:1,connectionTimeoutMillis:1000,idleTimeoutMillis:0}),{role:'test',report:d=>diagnostics.push(d),onCheckedOutError});
 const acquired=new Set<pg.PoolClient>();pool.on('acquire',c=>acquired.add(c));pool.on('release',(_e,c)=>acquired.delete(c));
 return {pool,server,diagnostics,async close(){for(const client of acquired){try{client.release(true);}catch{}}await pool.end();await server.close();}};
}
test('real pg idle disconnect is contained and the next normal query connects anew without replay',async()=>{
 const h=await harness();try{
  assert.equal((await h.pool.query('SELECT 1')).rows[0].value,1);
  h.server.sockets[0].destroy();await until(()=>h.diagnostics.some(d=>d.code==='POSTGRES_IDLE_CONNECTION_LOST'));
  assert.equal((await h.pool.query('SELECT 1')).rows[0].value,1);
  assert.equal(h.server.sockets.length,2);assert.equal(h.server.commands.filter(sql=>sql==='SELECT 1').length,2);
 }finally{await h.close();}
});
test('checked-out session loss remains failed, not a recovered advisory-lock session or committed transaction',async()=>{
 let stopped=0;const shutdown=new AbortController(),h=await harness(()=>{stopped++;shutdown.abort();});let client:pg.PoolClient|undefined;
 try{
  client=await h.pool.connect();await client.query('BEGIN');h.server.sockets[0].destroy();
  await until(()=>postgresClientDisconnected(client!));assert.equal(shutdown.signal.aborted,true);assert.equal(stopped,1);
  await assert.rejects(client.query('COMMIT'),/not queryable|connection error/i);
  client.release();client=undefined;
  assert.equal(h.server.commands.includes('COMMIT'),false);
  assert.equal((await h.pool.query('SELECT 1')).rows[0].value,1);assert.equal(h.server.sockets.length,2);
 }finally{if(client)client.release(true);await h.close();}
});
test('a pending real-driver query still rejects; pool observation never converts it to success',async()=>{
 const h=await harness();try{
  const pending=h.pool.query('WAIT');await until(()=>h.server.commands.includes('WAIT'));
  h.server.sockets[0].destroy();await assert.rejects(pending,/Connection terminated unexpectedly/);
  assert.equal(h.server.commands.filter(sql=>sql==='WAIT').length,1);
  assert.equal((await h.pool.query('SELECT 1')).rows[0].value,1);
 }finally{await h.close();}
});
test('disconnect during an invocation preserves unknown financial escrow and cannot replay',async()=>{
 const h=await harness(),now='2026-11-22T12:00:00.000Z',state=emptyFactoryApiState();
 const exposure={configured:true,fixedCents:0,spentCents:0,reservedCents:0,unknown:false,parents:[]};let calls=0,settled=0;
 checkpointFactoryApiMonth(state,exposure,{month:'2026-11',reconciledAt:now,externalSpentMicroUsd:0,externalReservedMicroUsd:0,externalUnknownReservations:0,complete:true,evidenceSha256:'a'.repeat(64)},now);
 const invoke=createFactoryApiInvocation({owner:()=> 'synthetic',now:()=>new Date(now),store:{
  async apiBudgetStatus(){return factoryApiBudgetStatus(state,exposure,now);},async reserveApi(_o,input){return reserveFactoryApi(state,exposure,input,now);},
  async executionWindowApi(_o,key){return factoryApiExecutionWindow(state,exposure,key,now);},
  async unknownApi(_o,key){unknownFactoryApi(state,key);},async settleApi(){settled++;throw Error('must not settle');},
 }});
 const call=()=>invoke({consumer:'other',executionId:'synthetic-fixed',requestSha256:'b'.repeat(64),price:{model:'synthetic',inputNanoUsdPerToken:1000,outputNanoUsdPerToken:1000,validUntil:'2027-01-01T00:00:00.000Z',evidenceSha256:'c'.repeat(64)},promptBytes:100,maxOutputTokens:32,
  call:async()=>{calls++;await h.pool.query('WAIT');return {};},usage:()=>{throw Error('must not read usage');}});
 try{const pending=call();await until(()=>h.server.commands.includes('WAIT'));h.server.sockets[0].destroy();await assert.rejects(pending,/EXECUTION_UNCONFIRMED/);
  assert.equal(state.reservations[0].status,'unknown');assert.equal(state.reservations[0].actualMicroUsd,undefined);assert.ok(state.reservations[0].maximumMicroUsd>0);
  await assert.rejects(call(),/DISPATCH_ALREADY_RESERVED/);assert.equal(calls,1);assert.equal(settled,0);
 }finally{await h.close();}
});
test('diagnostics never inspect driver error objects or throw because a reporter fails',()=>{
 const pool=new EventEmitter(),client=new EventEmitter();let reads=0,reports=0;
 observePostgresPool(pool,{role:'unsafe role',report:()=>{reports++;throw Error('log failure');}});
 observePostgresPool(pool,{role:'duplicate',report:()=>{throw Error('must not be installed');}});
 const error=Object.defineProperty({},'message',{get(){reads++;throw Error('private');}});
 pool.emit('connect',client);pool.emit('acquire',client);assert.doesNotThrow(()=>client.emit('error',error));
 pool.emit('release',undefined,client);assert.doesNotThrow(()=>pool.emit('error',error,client));
 assert.equal(pool.listenerCount('error'),1);assert.equal(reads,0);assert.equal(reports,2);
});
