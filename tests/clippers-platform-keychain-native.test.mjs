import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';

const exec = promisify(execFile);
const source = new URL('../script/clippers-platform-keychain.swift', import.meta.url);

test('default native reader has one fixed noninteractive lookup and no update/delete/unlock path', async () => {
  const text = await readFile(source, 'utf8');
  assert.ok(text.includes('SecKeychainSetUserInteractionAllowed(false)'));
  assert.ok(text.includes('kSecUseAuthenticationUI: kSecUseAuthenticationUIFail'));
  assert.ok(text.includes('CommandLine.arguments.count == 1'));
  assert.ok(text.includes('guard outputSafe() else'));
  assert.ok(text.includes('fstat(STDOUT_FILENO'));
  assert.ok(text.includes('getsockname(STDOUT_FILENO'));
  assert.ok(text.includes('sa_family_t(AF_UNIX)'));
  assert.ok(text.includes('com.blackops.clippers-orchestra.replit-production'));
  assert.ok(text.includes('clippers-telemetry'));
  for (const forbidden of ['SecItemUpdate(', 'SecItemDelete(', 'SecKeychainUnlock(', 'Process(', 'osascript']) assert.equal(text.includes(forbidden), false);
});

test('native macOS helper compiles and runs only its synthetic dependency-injected test binary', {skip:process.platform!=='darwin'}, async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'clippers-keychain-native-'));
  try {
    const output = path.join(temporary, 'synthetic-reader');
    await exec('/usr/bin/xcrun', ['swiftc', '-D', 'CLIPPERS_KEYCHAIN_TEST', '-framework', 'Security', source.pathname, '-o', output], {timeout:30_000, maxBuffer:1_000_000});
    const result = await exec(output, [], {timeout:3000, maxBuffer:8192, env:{PATH:'/usr/bin:/bin'}});
    assert.deepEqual(JSON.parse(result.stdout), {syntheticTestsPassed:24,realKeychainQueries:0,realKeychainWrites:0});
    assert.equal(result.stderr, '');
  } finally {await rm(temporary,{recursive:true,force:true});}
});


test('setup is explicit user-only secure input with one exact-app ACL, add-only and no token output', async () => {
  const text=await readFile(source,'utf8');
  assert.ok(text.includes('CommandLine.arguments[1] == "--setup"'));
  assert.ok(text.includes('NSSecureTextField'));
  assert.ok(text.includes('SecTrustedApplicationCreateFromPath'));
  assert.ok(text.includes('[application] as CFArray'));
  assert.ok(text.includes('errSecDuplicateItem'));
  assert.ok(text.includes('current.1 == expected.1'));
  const setup=text.slice(text.indexOf('final class PlatformSetup'),text.indexOf('func userSetup()'));
  assert.equal(setup.includes('SecItemCopyMatching'),false);
  assert.equal(setup.includes('FileHandle.standardOutput'),false);
  assert.equal(setup.includes('print('),false);
  assert.ok(setup.includes('secure.stringValue = ""'));
});
