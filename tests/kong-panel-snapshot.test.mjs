import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeSnapshot} from '../script/kong-panel-snapshot.mjs';
const fixture=()=>({projectCount:10,collectiveCount:4,radioCount:4,labelCount:3,otherProjectCount:1,extraTypeAssignments:2,candidateCount:6,corroboratedCount:0,djs:{total:25,email:'private@example.test'},lastActivityAt:'2026-09-30T00:00:00Z',privateData:'secret',agents:[{url:'private'}]});
test('export reconciles overlapping categories and excludes contacts and internals',()=>{const result=sanitizeSnapshot(fixture());assert.equal(result.counts.projectCount,10);assert.equal(result.counts.djCount,25);assert.equal(result.mode,'snapshot');assert.equal(JSON.stringify(result).includes('private'),false);assert.equal(JSON.stringify(result).includes('secret'),false);});
test('rejects inconsistent totals instead of publishing misleading counts',()=>{assert.throws(()=>sanitizeSnapshot({...fixture(),projectCount:11}));});
test('rejects malformed count, corroboration and dates',()=>{for(const patch of [{candidateCount:-1},{radioCount:NaN},{corroboratedCount:11},{djs:{total:'25'}},{lastActivityAt:'invalid'}])assert.throws(()=>sanitizeSnapshot({...fixture(),...patch}));});
