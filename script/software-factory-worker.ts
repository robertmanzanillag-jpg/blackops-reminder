import "../server/env-loader";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stat } from "node:fs/promises";
import { createSoftwareFactoryWorker, type FactoryWorkerOptions } from "../server/software-factory-worker";
import { softwareFactoryStore } from "../server/software-factory-store";
import { validateFactoryWorkerOptions } from "../server/software-factory-runtime";

async function main() {
  if (process.env.SOFTWARE_FACTORY_ENABLED !== "true") throw new Error("SOFTWARE_FACTORY_ENABLED_REQUIRED");
  // Operator-installed module only: never accept module paths from web requests,
  // project metadata, model output, or the repository being built.
  const modulePath=process.env.SOFTWARE_FACTORY_ADAPTER_MODULE;
  if (!modulePath || !path.isAbsolute(modulePath) || !(await stat(modulePath)).isFile()) throw new Error("FACTORY_TRUSTED_ADAPTER_MODULE_REQUIRED");
  const module=await import(pathToFileURL(modulePath).href);
  if (typeof module.createFactoryWorkerOptions !== "function") throw new Error("FACTORY_ADAPTER_FACTORY_REQUIRED");
  const config:FactoryWorkerOptions=await module.createFactoryWorkerOptions();
  validateFactoryWorkerOptions(config);
  const owner=process.env.SOFTWARE_FACTORY_OWNER_ID;
  if (!owner) throw new Error("FACTORY_OWNER_REQUIRED");
  const state=await softwareFactoryStore.status(owner);
  if (!state.configured) throw new Error("FACTORY_FIXED_COST_RESERVATION_REQUIRED");
  const worker=createSoftwareFactoryWorker({...config,store:softwareFactoryStore,scheduleOwner:owner});
  let stopping=false;
  const stop=()=>{stopping=true;worker.stop();};
  process.once("SIGTERM",stop);process.once("SIGINT",stop);
  const maintenance=setInterval(()=>{void worker.maintain().catch(()=>console.error("Factory persistence unavailable"));},15000);
  try {
    await worker.maintain();
    while(!stopping) {
      try { await worker.schedule(); }
      catch { console.error("Factory discovery admission blocked; existing funded work will continue."); }
      try { await worker.tick(); }
      catch { console.error("Factory cycle blocked; inspect persisted diagnostics and budget."); }
      if(!stopping) await new Promise(resolve=>setTimeout(resolve,5000));
    }
  } finally {clearInterval(maintenance);worker.stop();}
}
void main().catch(()=>{console.error("Factory stopped: verify migration, fixed costs, owner and trusted adapter configuration.");process.exitCode=1;});
