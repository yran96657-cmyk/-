import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rename,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {atomicJson} from '../standalone/atomic-json.mjs';
test('temporary Windows replacement denial retries the identical record atomically',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'shuye-atomic-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=join(dir,'state.json');
 await atomicJson(file,{revision:1});let tries=0;const delays=[];
 await atomicJson(file,{revision:2},{delay:async ms=>delays.push(ms),replace:async(a,b)=>{assert.equal(JSON.parse(await readFile(b,'utf8')).revision,1);if(++tries<3)throw Object.assign(Error('busy'),{code:'EPERM'});await rename(a,b);}});
 assert.equal(tries,3);assert.deepEqual(delays,[20,40]);assert.equal(JSON.parse(await readFile(file,'utf8')).revision,2);assert.deepEqual(await readdir(dir),['state.json']);
});
test('permanent replacement failure preserves old checkpoint and surfaces the failure',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'shuye-atomic-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=join(dir,'state.json');await atomicJson(file,{revision:1});
 let tries=0;await assert.rejects(()=>atomicJson(file,{revision:2},{delay:async()=>{},replace:async()=>{tries++;throw Object.assign(Error('disk'),{code:'ENOSPC'});}}),/disk/);
 assert.equal(tries,1);assert.equal(JSON.parse(await readFile(file,'utf8')).revision,1);assert.deepEqual(await readdir(dir),['state.json']);
});
