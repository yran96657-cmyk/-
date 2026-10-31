import test from 'node:test';
import assert from 'node:assert/strict';
import {createDraftStore} from '../public/editor/src/draft-store.mjs';
const memory=()=>{const data=new Map();return {get:id=>data.get(id),put:(id,value)=>data.set(id,structuredClone(value)),delete:id=>data.delete(id)};};
const legacy=()=>{const data=new Map();return {getItem:id=>data.get(id),setItem:(id,value)=>data.set(id,value),removeItem:id=>data.delete(id)};};

test('image drafts bypass small localStorage quotas and snapshot at scheduling time',async()=>{
 const storage={getItem:()=>null,setItem:()=>{throw Error('QuotaExceededError');},removeItem:()=>{}};
 const drafts=createDraftStore({backend:memory(),storage});
 const document={src:'data:image/png;base64,'+'A'.repeat(6*1024*1024),text:'before'};
 const saving=drafts.write('paper',{baseRevision:3,document});document.text='after';await saving;
 assert.equal((await drafts.read('paper')).document.text,'before');
 assert.equal((await drafts.read('paper')).document.src.length,document.src.length);
});

test('legacy migration is durable before removing the old cache',async()=>{
 const storage=legacy(),value={baseRevision:2,document:{text:'unsaved'}};storage.setItem('shuye-draft-paper',JSON.stringify(value));
 let fail=true;const backend=memory(),put=backend.put;backend.put=(...args)=>{if(fail)throw Error('disk full');return put(...args);};
 const drafts=createDraftStore({backend,storage});await assert.rejects(drafts.read('paper'),/disk full/);
 assert.ok(storage.getItem('shuye-draft-paper'));fail=false;
 assert.deepEqual(await drafts.read('paper'),value);assert.equal(storage.getItem('shuye-draft-paper'),undefined);
});

test('cleanup never removes a newer queued edit or another project',async()=>{
 const drafts=createDraftStore({backend:memory(),storage:legacy()});
 await drafts.write('paper',{document:{text:'saved'}});await drafts.write('other',{document:{text:'independent'}});
 const writing=drafts.write('paper',{document:{text:'new typing'}});
 const cleaning=drafts.removeIf('paper',d=>d.document.text==='saved');await Promise.all([writing,cleaning]);
 assert.equal((await drafts.read('paper')).document.text,'new typing');
 assert.equal((await drafts.read('other')).document.text,'independent');
 await drafts.removeIf('paper',d=>d.document.text==='new typing');assert.equal(await drafts.read('paper'),undefined);
});

test('blocked legacy storage does not fail an IndexedDB-backed draft',async()=>{
 const storage={getItem:()=>{throw Error('SecurityError');},removeItem:()=>{throw Error('SecurityError');}};
 const drafts=createDraftStore({backend:memory(),storage});assert.equal(await drafts.read('paper'),undefined);
 await drafts.write('paper',{document:{text:'kept'}});assert.equal((await drafts.read('paper')).document.text,'kept');
});
