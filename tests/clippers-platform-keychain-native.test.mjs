import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';

const exec = promisify(execFile);
const source = new URL('../script/clippers-platform-keychain.swift', import.meta.url);

test('native Keychain source has one fixed read-only noninteractive lookup and no provisioning commands', async () => {
  const text = await readFile(source, 'utf8');
  assert.ok(text.includes('SecKeychainSetUserInteractionAllowed(false)'));
  assert.ok(text.includes('kSecUseAuthenticationUI: kSecUseAuthenticationUIFail'));
  assert.ok(text.includes('CommandLine.arguments.count != 1'));
  assert.ok(text.includes('guard outputSafe() else'));
  assert.ok(text.includes('fstat(STDOUT_FILENO'));
  assert.ok(text.includes('getsockname(STDOUT_FILENO'));
  assert.ok(text.includes('sa_family_t(AF_UNIX)'));
  assert.ok(text.includes('com.blackops.clippers-orchestra.replit-production'));
  assert.ok(text.includes('clippers-telemetry'));
  for (const forbidden of ['SecItemAdd(', 'SecItemUpdate(', 'SecItemDelete(', 'SecKeychainUnlock(', 'SecAccessCreate(', 'Process(', 'osascript']) assert.equal(text.includes(forbidden), false);
});

test('native macOS helper compiles and runs only its synthetic dependency-injected test binary', {skip:process.platform!=='darwin'}, async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'clippers-keychain-native-'));
  try {
    const output = path.join(temporary, 'synthetic-reader');
    await exec('/usr/bin/xcrun', ['swiftc', '-D', 'CLIPPERS_KEYCHAIN_TEST', '-framework', 'Security', source.pathname, '-o', output], {timeout:30_000, maxBuffer:1_000_000});
    const result = await exec(output, [], {timeout:3000, maxBuffer:8192, env:{PATH:'/usr/bin:/bin'}});
    assert.deepEqual(JSON.parse(result.stdout), {syntheticTestsPassed:16,realKeychainQueries:0});
    assert.equal(result.stderr, '');
  } finally {await rm(temporary,{recursive:true,force:true});}
});
