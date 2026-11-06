import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
test('Windows canonical account names resolve to the same SID and unknown names fail closed', {skip:process.platform !== 'win32'}, () => {
  const source=fs.readFileSync(new URL('../script/office-windows-install.ps1',import.meta.url),'utf8');
  const helper=source.match(/function Resolve-TaskIdentity\([\s\S]*?\r?\n}/)?.[0]; assert.ok(helper);
  const command=helper+`; $identity=[Security.Principal.WindowsIdentity]::GetCurrent(); $sid=$identity.User.Value; foreach($value in @($sid,$identity.Name,($identity.Name -split '\\\\')[-1])) { if((Resolve-TaskIdentity $value) -ne $sid){exit 2} }; try { Resolve-TaskIdentity 'NoSuchOfficeAccount_4762' | Out-Null; exit 3 } catch {}; Write-Output 'IDENTITIES_VERIFIED'`;
  const result=spawnSync(path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',windowsHide:true,shell:false,timeout:10000});
  assert.equal(result.status,0,result.stderr); assert.equal(result.stdout.trim(),'IDENTITIES_VERIFIED');
});
import { parseWorkerConfig, safeWorkerEnvironment, validateWorkerPaths, preflightDatabase, assertPrivateConfigAcl } from '../script/office-windows-worker.mjs';
const raw = 'DATABASE_URL=postgresql://test:test@localhost/office\nDEFAULT_USER_ID=owner-123\nOPENAI_API_KEY=sk-test_only_12345\nOFFICE_OPENAI_MODEL=test-model\nOFFICE_OPENAI_MONTHLY_TOKEN_LIMIT=100000\nOFFICE_EXPECTED_WEB_REVISION='+'a'.repeat(40);
test('missing owned task upgrade refuses creation while normal dry-run may continue', {skip:process.platform !== 'win32'}, () => {
  const source=fs.readFileSync(new URL('../script/office-windows-install.ps1',import.meta.url),'utf8');
  const guard=source.split(/\r?\n/).find(line=>line.includes("if ($UpgradeOwnedAction) { throw 'Owned legacy task missing"));
  assert.ok(guard);
  for (const enabled of [true,false]) {
    const result=spawnSync(path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-Command',`$ErrorActionPreference='Stop'; $UpgradeOwnedAction=$${enabled}; ${guard}; Write-Output 'SAFE_TO_CONTINUE'`],{encoding:'utf8',windowsHide:true,shell:false,timeout:10000});
    assert.equal(result.status === 0,!enabled);
    assert.equal(result.stdout.includes('SAFE_TO_CONTINUE'),!enabled);
  }
});
test('strict config requires budget/owner and refuses executable environment injection', () => {
  assert.equal(parseWorkerConfig(raw).OFFICE_OPENAI_MONTHLY_TOKEN_LIMIT,'100000');
  for (const extra of ['NODE_OPTIONS=--require malware.js','OFFICE_WORKER_REVIEW_ONLY=false','DATABASE_URL=postgresql://other/db','export SECRET=abc']) assert.throws(() => parseWorkerConfig(raw+'\n'+extra));
  assert.throws(() => parseWorkerConfig(raw.replace('100000','0')), /TOKEN_LIMIT/);
  assert.throws(() => parseWorkerConfig(raw.replace('owner-123','replace-with-user-id')), /OWNER/);
  assert.throws(() => parseWorkerConfig(raw.replace('postgresql://test:test@localhost/office','https://example.org')), /DATABASE/);
});
test('child environment excludes inherited secrets, node injection and alternate storage', () => {
  const env = safeWorkerEnvironment(parseWorkerConfig(raw), { PATH:'safe-path', NODE_OPTIONS:'--require evil', PGHOST:'wrong-db', STRIPE_SECRET_KEY:'not-forwarded', OFFICE_WORKER_REVIEW_ONLY:'false' });
  assert.equal(env.NODE_OPTIONS,undefined); assert.equal(env.PGHOST,undefined); assert.equal(env.STRIPE_SECRET_KEY,undefined);
  assert.equal(env.OFFICE_WORKER_RUN_ONCE,'false'); assert.equal(env.OFFICE_WORKER_FAIL_FAST,'true'); assert.equal(env.OFFICE_WORKER_REVIEW_ONLY,'true');
  assert.equal(env.OFFICE_ACADEMY_EXECUTION_ENABLED,'false'); assert.equal(env.PATH,'safe-path');
});
test('real paths reject inside-repository config and fallback env files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'office-windows-test-'));
  try {
    const repo = path.join(root,'repo with spaces'); fs.mkdirSync(path.join(repo,'script'),{recursive:true});
    fs.mkdirSync(path.join(repo,'node_modules','tsx'),{recursive:true});
    fs.writeFileSync(path.join(repo,'package.json'),' {"name":"rest-express"}'); fs.writeFileSync(path.join(repo,'script','office-worker.ts'),''); fs.writeFileSync(path.join(repo,'node_modules','tsx','package.json'),'{}');
    const config = path.join(root,'test-config'); fs.writeFileSync(config,'test fixture, not credentials');
    assert.equal(validateWorkerPaths(repo,config).repo,fs.realpathSync(repo));
    assert.throws(() => validateWorkerPaths(repo,path.join(repo,'package.json')), /OUTSIDE/);
    assert.throws(() => validateWorkerPaths('relative',config), /ABSOLUTE/);
    fs.writeFileSync(path.join(repo,'.env'),''); assert.throws(() => validateWorkerPaths(repo,config), /FALLBACK/);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
test('database preflight is read-only, parameterizes owner and closes rejected connections', async () => {
  let ended=0; const calls=[];
  class FakePool { async query(sql,parameters) { calls.push({sql,parameters}); return sql.includes('to_regclass') ? {rows:[{jobs:'jobs',workers:'workers',council:'council'}]} : {rows:[{valid:false}]}; } async end(){ended++;} }
  await assert.rejects(preflightDatabase(parseWorkerConfig(raw),FakePool,async()=>{}),/MISMATCH/);
  assert.equal(ended,1); assert.ok(calls.every(c=>c.sql.startsWith('SELECT')));
  assert.deepEqual(calls.at(-1).parameters,['owner-123']);
});
test('preflight requires real compatibility verifier and propagates rollback or revision rejection', async () => {
  let checked=0,ended=0;
  class FakePool { async query(sql) { return sql.includes('to_regclass') ? {rows:[{jobs:'jobs',workers:'workers',council:'council'}]} : {rows:[{valid:true}]}; } async end(){ended++;} }
  await assert.rejects(preflightDatabase(parseWorkerConfig(raw),FakePool),/PROTOCOL/);
  await assert.rejects(preflightDatabase(parseWorkerConfig(raw),FakePool,async (_pool,owner,revision)=>{checked++;assert.equal(owner,'owner-123');assert.equal(revision,'a'.repeat(40));throw new Error('INCOMPATIBLE_WEB');}),/INCOMPATIBLE/);
  assert.equal(checked,1);assert.equal(ended,1);
});
test('installer defaults to no registration and uses hidden current-user nonoverwriting task', () => {
  const source=fs.readFileSync(new URL('../script/office-windows-install.ps1',import.meta.url),'utf8');
  assert.ok(source.includes('if (-not $Apply)')); assert.ok(source.includes('-LogonType Interactive -RunLevel Limited'));
  assert.ok(source.includes('-MultipleInstances IgnoreNew')); assert.ok(source.includes('-WindowStyle Hidden'));
  assert.ok(source.includes('Arguments -ceq $arguments')); assert.ok(!/Register-ScheduledTask[^\n]*-Force/.test(source));
  assert.ok(source.indexOf('--preflight') < source.indexOf('Register-ScheduledTask'));
  assert.ok(source.includes('Principal.RunLevel -ne 0')); assert.ok(source.includes('Settings.MultipleInstances -ne 2'));
  assert.ok(source.includes("Repetition.Interval -ne 'PT5M'"));
  assert.ok(source.includes('office-windows-launch.vbs')); assert.ok(source.includes('if (-not $UpgradeOwnedAction'));
  assert.ok(source.includes('Local drive absolute paths required'));
  assert.ok(source.indexOf("if ($UpgradeOwnedAction) { throw 'Owned legacy task missing") < source.indexOf('  $action = New-ScheduledTaskAction'));
  assert.ok(source.includes('[int]$existing.State -ne 1')); assert.ok(source.includes('Set-ScheduledTask -TaskName $taskName'));
  for (const filename of ['office-windows-install.ps1','office-windows-launch.ps1']) {
    const entry=fs.readFileSync(new URL('../script/'+filename,import.meta.url),'utf8');
    assert.ok(entry.indexOf('Unsafe inherited Node environment') < entry.indexOf('& $'));
    assert.ok(entry.includes("'NODE_OPTIONS','NODE_PATH','NODE_TLS_REJECT_UNAUTHORIZED'"));
    assert.ok(entry.includes('Configuration ACL is not private'));
  }
});
test('runtime ACL verification is fixed read-only code with literal path passed outside the command', () => {
  const privatePath = 'C:\\Private\\$(not-a-command); config.txt'; let inspected=false;
  assertPrivateConfigAcl(privatePath,(executable,args,options)=>{
    inspected=true; assert.ok(executable.endsWith('powershell.exe'));
    assert.ok(!args.join(' ').includes(privatePath)); assert.ok(!args.join(' ').includes('ExecutionPolicy'));
    assert.equal(options.env.OFFICE_PRIVATE_CONFIG_PATH,privatePath);
    assert.equal(options.env.NODE_OPTIONS,undefined); assert.equal(options.windowsHide,true); assert.equal(options.shell,false);
    return {status:0,stdout:'PRIVATE_CONFIG_ACL_OK\r\n'};
  },{SystemRoot:'C:\\Windows',NODE_OPTIONS:'--require untrusted'});
  assert.equal(inspected,true);
  assert.throws(()=>assertPrivateConfigAcl(privatePath,()=>({status:1,stdout:'private secret error'}),{SystemRoot:'C:\\Windows'}),/ACL_NOT_VERIFIED/);
});
test('native GUI launcher uses hidden synchronous run with no shell or policy changes', () => {
  const source=fs.readFileSync(new URL('../script/office-windows-launch.vbs',import.meta.url),'utf8');
  assert.ok(source.includes('shell.Run(command, 0, True)'));
  assert.ok(source.includes('InStr(value, "%")')); assert.ok(source.includes('Chr(34)'));
  assert.ok(source.includes('WScript.Arguments.Count <> 3'));
  assert.ok(!/powershell|cmd\.exe|ExecutionPolicy|Bypass/i.test(source));
});
