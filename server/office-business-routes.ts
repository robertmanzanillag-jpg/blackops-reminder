import type {Express} from "express";
import {getAuthenticatedCurrentUserId,getSystemUserId} from "./user-context";
import type {BusinessWorkJob} from "./office-business-work";

type BusinessHistory={jobs:BusinessWorkJob[];capacity?:{reached:boolean;usedJobs:number;maxJobs:number}};
let pool: import("pg").Pool | undefined;
async function readHistory(owner:string):Promise<BusinessHistory>{
 const {readBusinessWork,businessWorkCapacity}=await import("./office-business-work");
 if(!pool){const {Pool}=await import("pg");const {resolveDatabaseConnectionString}=await import("./database-url");pool=new Pool({connectionString:resolveDatabaseConnectionString(),max:1,allowExitOnIdle:true,connectionTimeoutMillis:5000,statement_timeout:10000});}
 const history=await readBusinessWork(pool,owner);
 const {reached,usedJobs,maxJobs}=businessWorkCapacity(history);
 return {jobs:history.jobs,capacity:{reached,usedJobs,maxJobs}};
}
/** Authenticated history only. Opening the panel never starts work or alters records. */
export function registerOfficeBusinessRoutes(app:Pick<Express,"get">,deps:{read?:typeof readHistory;systemOwner?:()=>string;now?:()=>number}={}){
 app.get("/api/agents-office/business-work",async(req,res)=>{
  res.setHeader("Cache-Control","no-store");
  const owner=getAuthenticatedCurrentUserId(req);
  if(!owner)return res.status(401).json({error:"Inicia sesión para consultar los entregables."});
  try{
   if(owner!==(deps.systemOwner??getSystemUserId)())return res.status(403).json({error:"Los entregables pertenecen al propietario de esta oficina."});
   const history=await (deps.read??readHistory)(owner);
   const checkedAt=(deps.now??Date.now)();
   const jobs=history.jobs.map(({id,role,generation,status,startedAt,expiresAt,completedAt,reason,artifact})=>{
    const expired=status==="running"&&Date.parse(expiresAt)<=checkedAt;
    return {id,role,generation,status:expired?"unknown":status,startedAt,completedAt,reason:expired?"LEASE_EXPIRED":reason,...(artifact?{artifact:{text:artifact.text}}:{})};
   });
   return res.json({ownerId:owner,checkedAt:new Date(checkedAt).toISOString(),jobs,...(history.capacity?{capacity:history.capacity}:{})});
  }catch{return res.status(503).json({error:"No se pudo verificar el historial de entregables."});}
 });
}
