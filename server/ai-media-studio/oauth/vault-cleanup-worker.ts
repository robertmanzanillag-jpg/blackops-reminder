import { randomUUID } from "node:crypto";
import type { OAuthAuthorizationCodeVault, OAuthTokenVault, OAuthVault } from "./contracts";
import { OAUTH_VAULT_OPERATION_BUDGET_MS, type OAuthVaultCleanupErrorCode,
  type OAuthVaultCleanupItem, type OAuthVaultCleanupRepository } from "./vault-cleanup-contracts";

class VaultCleanupTimeout extends Error {}
class InvalidCleanupObligation extends Error {}

export type OAuthVaultCleanupRunResult=Readonly<{claimed:number;completed:number;verifyWait:number;failed:number;deadLettered:number;leaseLost:number}>;

export function createOAuthVaultCleanupWorker(dependencies:{repository:OAuthVaultCleanupRepository;pkceVault:OAuthVault;
  authorizationCodeVault:OAuthAuthorizationCodeVault;tokenVault:OAuthTokenVault;clock?:()=>Date;operationBudgetMs?:number}){
  const clock=dependencies.clock??(()=>new Date());
  const operationBudgetMs=dependencies.operationBudgetMs??OAUTH_VAULT_OPERATION_BUDGET_MS;
  if(!Number.isSafeInteger(operationBudgetMs)||operationBudgetMs<1||operationBudgetMs>OAUTH_VAULT_OPERATION_BUDGET_MS)throw new Error("Invalid cleanup worker");
  async function runOnce(input:{limit:number;leaseOwner:string;leaseMs?:number}):Promise<OAuthVaultCleanupRunResult>{
    if(!Number.isSafeInteger(input.limit)||input.limit<1||input.limit>100||!input.leaseOwner?.trim()||input.leaseOwner.length>255)throw new Error("Invalid cleanup run");
    const now=clock();const leaseMs=input.leaseMs??120_000;if(!Number.isFinite(now.getTime())||!Number.isSafeInteger(leaseMs)||leaseMs<30_000||leaseMs>300_000)throw new Error("Invalid cleanup run");
    const items=await dependencies.repository.claimDue({limit:input.limit,lease:{leaseToken:randomUUID(),leaseOwner:input.leaseOwner,leaseExpiresAt:new Date(now.getTime()+leaseMs).toISOString()}});
    const result={claimed:items.length,completed:0,verifyWait:0,failed:0,deadLettered:0,leaseLost:0};
    await Promise.all(items.map(async(item)=>{
      const cas={id:item.id,leaseToken:item.leaseToken,leaseFencing:item.leaseFencing};
      try{
        await deleteWithinBudget(item,dependencies,operationBudgetMs);
        const state=await dependencies.repository.acknowledgeDelete(cas);
        if(state==="completed")result.completed+=1;else if(state==="verify_wait")result.verifyWait+=1;else result.leaseLost+=1;
      }catch(error){
        const errorCode:OAuthVaultCleanupErrorCode=error instanceof VaultCleanupTimeout?"vault_timeout":
          error instanceof InvalidCleanupObligation?"invalid_obligation":"vault_rejected";
        const state=await dependencies.repository.recordFailure({...cas,errorCode});
        result.failed+=1;if(state==="dead_letter")result.deadLettered+=1;else if(state===undefined)result.leaseLost+=1;
      }
    }));
    return result;
  }
  return{runOnce};
}

async function deleteWithinBudget(item:OAuthVaultCleanupItem,deps:{pkceVault:OAuthVault;authorizationCodeVault:OAuthAuthorizationCodeVault;
  tokenVault:OAuthTokenVault},budgetMs:number):Promise<void>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  const timeout=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new VaultCleanupTimeout()),budgetMs);timer.unref?.();});
  try{await Promise.race([deleteExact(item,deps),timeout]);}finally{if(timer)clearTimeout(timer);}
}

async function deleteExact(item:OAuthVaultCleanupItem,deps:{pkceVault:OAuthVault;authorizationCodeVault:OAuthAuthorizationCodeVault;tokenVault:OAuthTokenVault}):Promise<void>{
  if(item.kind==="pkce_verifier"&&item.context.purpose==="ai_media_oauth_pkce")return deps.pkceVault.delete(item.reference,item.context);
  if(item.kind==="authorization_code"&&item.context.purpose==="ai_media_oauth_authorization_code")return deps.authorizationCodeVault.delete(item.reference,item.context);
  if(item.kind==="token_credential"&&item.context.purpose==="ai_media_oauth_token")return deps.tokenVault.delete(item.reference,item.context);
  throw new InvalidCleanupObligation();
}
