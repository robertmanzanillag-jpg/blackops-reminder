import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {refreshOrganicPeerScout} from '../script/organic-peer-scout.mjs';
test('bounded metadata only and daily cache, failures do not fabricate evidence',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'scout-test-'));let calls=0;
 try {const run=async(bin,args)=>{calls++;assert.ok(args.includes('--skip-download'));assert.ok(args.includes('--ignore-config'));throw new Error('blocked');};
 const r=await refreshOrganicPeerScout(dir,{run});assert.equal(calls,2);assert.equal(r.brands[0].status,'insufficient_evidence');
 await refreshOrganicPeerScout(dir,{run});assert.equal(calls,2);
 }finally{await rm(dir,{recursive:true,force:true});}
});
