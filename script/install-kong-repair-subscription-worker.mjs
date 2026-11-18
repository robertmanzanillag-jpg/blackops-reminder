#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {runProcess,cleanEnvironment} from './kong-repair-subscription-worker.mjs';

const LABEL='com.blackops.kong-repair-subscription-worker';
const SHA=/^[a-f0-9]{40}$/;
const xml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export function installPlan(home=os.homedir()) {
  const root=path.join(home,'.local/share/blackops/kong-repair-runtime');
  const node=path.join(home,'.nvm/versions/node/v22.23.0/bin/node');
  const script=path.join(root,'kong-repair-subscription-worker.mjs');
  const plist=path.join(home,'Library/LaunchAgents',`${LABEL}.plist`);
  const content=`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>${LABEL}</string>\n<key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(script)}</string><string>--once</string></array>\n<key>WorkingDirectory</key><string>${xml(root)}</string>\n<key>StartInterval</key><integer>1800</integer>\n<key>RunAtLoad</key><false/>\n<key>ProcessType</key><string>Background</string>\n<key>EnvironmentVariables</key><dict><key>HOME</key><string>${xml(home)}</string><key>PATH</key><string>${xml(path.dirname(node))}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string><key>KONG_REPAIR_LOCAL_WORKER_ENABLED</key><string>true</string></dict>\n<key>StandardOutPath</key><string>${xml(path.join(root,'worker.stdout.log'))}</string>\n<key>StandardErrorPath</key><string>${xml(path.join(root,'worker.stderr.log'))}</string>\n</dict></plist>\n`;
  return {label:LABEL,root,node,script,plist,content,startIntervalSeconds:1800,runAtLoad:false,maxModelReservationsPerNewYorkDay:3};
}
async function main() {
  const args=process.argv.slice(2);const plan=installPlan();
  if(args.length===1&&args[0]==='--plan'){console.log(JSON.stringify({...plan,content:undefined}));return;}
  if(args.length!==3||args[0]!=='--install'||args[1]!=='--reviewed-sha'||!SHA.test(args[2]))throw Error('Use --plan or --install --reviewed-sha <exact-reviewed-commit>.');
  const sourceRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const git=await runProcess('/usr/bin/git',['rev-parse','HEAD'],{cwd:sourceRoot,env:cleanEnvironment()});
  const status=await runProcess('/usr/bin/git',['status','--porcelain'],{cwd:sourceRoot,env:cleanEnvironment()});
  if(git.exitCode!==0||git.output.trim()!==args[2]||status.exitCode!==0||status.output.trim())throw Error('Exact reviewed commit and clean worktree required.');
  await fs.access(plan.node);const bytes=await fs.readFile(path.join(sourceRoot,'script/kong-repair-subscription-worker.mjs'));
  const identity={reviewedSha:args[2],workerSha256:createHash('sha256').update(bytes).digest('hex'),installedAt:new Date().toISOString(),paidApiSpendUsd:0};
  // An existing installation is deliberately not replaced or reset, nor are its journals/immutable claims removed.
  for(const destination of [plan.script,plan.plist])try{await fs.lstat(destination);throw Error('Existing installation: stop and review an explicit upgrade.');}catch(error){if(error.code!=='ENOENT')throw error;}
  await fs.mkdir(plan.root,{recursive:true,mode:0o700});await fs.mkdir(path.dirname(plan.plist),{recursive:true});
  await fs.writeFile(plan.script,bytes,{mode:0o600,flag:'wx'});await fs.writeFile(path.join(plan.root,'installation.json'),JSON.stringify(identity,null,2),{mode:0o600,flag:'wx'});
  await fs.writeFile(plan.plist,plan.content,{mode:0o600,flag:'wx'});
  const lint=await runProcess('/usr/bin/plutil',['-lint',plan.plist],{env:cleanEnvironment()});if(lint.exitCode!==0)throw Error('LaunchAgent validation failed; not loaded.');
  const loaded=await runProcess('/bin/launchctl',['bootstrap',`gui/${process.getuid()}`,plan.plist],{env:cleanEnvironment()});if(loaded.exitCode!==0)throw Error('LaunchAgent load unconfirmed; inspect before retry.');
  console.log(JSON.stringify({...identity,label:LABEL,loaded:true,firstModelRunVerified:false,cadenceSeconds:1800,maxModelReservationsPerNewYorkDay:3}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error(JSON.stringify({state:'installation_blocked',loadedVerified:false}));process.exitCode=1;});
