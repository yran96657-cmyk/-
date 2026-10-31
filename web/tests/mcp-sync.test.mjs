import test from 'node:test';
import assert from 'node:assert/strict';
import {ProjectConnection,documentFingerprint} from '../public/editor/src/project-sync.mjs';
import {History} from '../public/editor/src/model.mjs';

test('opening another project resets undo history; same-project Agent edits remain undoable',async()=>{
 let doc={text:'sample'},remote={revision:1,document:{text:'paper A'}};
 const history=new History();
 const connection=new ProjectConnection({getDoc:()=>doc,api:async()=>remote,replaceDoc:async(next,{resetHistory=false}={})=>{if(resetHistory)history.clear();else history.push(doc);doc=next;}});
 await connection.open('a');assert.equal(history.undo(doc),null);
 remote={revision:2,document:{text:'agent edited A'}};await connection.poll();assert.deepEqual(history.undo(doc),{text:'paper A'});
 remote={revision:1,document:{text:'paper B'}};await connection.open('b');assert.equal(history.undo(doc),null);assert.equal(history.redo(doc),null);
 remote={revision:2,document:{text:'new B'}};await connection.open('b');assert.deepEqual(history.undo(doc),{text:'paper B'});
});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('server schema property ordering does not mark saved frames as dirty',async()=>{let doc;const remote={composition:{pages:[{id:'p1',objects:[{id:'f1',x:20,rotation:15,src:'data:image/png;base64,AAAA'}]}]}};const c=new ProjectConnection({api:async()=>({revision:1,document:remote}),getDoc:()=>doc,replaceDoc:async()=>{doc={composition:{pages:[{objects:[{src:'data:image/png;base64,AAAA',rotation:15,x:20,id:'f1'}],id:'p1'}]}};}});await c.open('book');assert.equal(c.dirty,false);assert.equal(documentFingerprint(doc),documentFingerprint(remote));doc.composition.pages[0].objects[0].x=21;assert.equal(c.dirty,true);assert.notEqual(documentFingerprint({pages:[1,2]}),documentFingerprint({pages:[2,1]}));});
test('browser follows agent revisions but stops when there are local edits',async()=>{
  let doc={text:'old'},remote={revision:1,document:{text:'saved'}};const c=new ProjectConnection({api:async()=>structuredClone(remote),getDoc:()=>doc,replaceDoc:async d=>{doc=d;}});
  await c.open('book');remote={revision:2,document:{text:'agent'}};assert.equal(await c.poll(),true);assert.equal(doc.text,'agent');doc.text='local';remote={revision:3,document:{text:'other'}};assert.equal(await c.poll(),false);assert.equal(doc.text,'local');
});
test('pending read cannot overwrite new typing or another connection',async()=>{
  let doc={text:'saved'},pending;const c=new ProjectConnection({api:async()=>pending?pending.promise:{revision:1,document:{text:'saved'}},getDoc:()=>doc,replaceDoc:async d=>{doc=d;}});await c.open('book');pending=deferred();const poll=c.poll();doc.text='typed while reading';pending.resolve({revision:2,document:{text:'remote'}});assert.equal(await poll,false);assert.equal(doc.text,'typed while reading');
  doc={text:'saved'};pending=deferred();const second=c.poll();c.disconnect();pending.resolve({revision:3,document:{text:'old response'}});assert.equal(await second,false);assert.equal(doc.text,'saved');
});
test('typing during save remains dirty and revision conflict leaves local work intact',async()=>{
  let doc={text:'saved'},pending;const c=new ProjectConnection({api:async(name)=>name==='get_project'?{revision:1,document:{text:'saved'}}:pending.promise,getDoc:()=>doc,replaceDoc:async d=>{doc=d;}});await c.open('book');doc.text='first edit';pending=deferred();const save=c.save();doc.text='second edit';pending.resolve({revision:2});await save;assert.equal(c.revision,2);assert.equal(c.dirty,true);assert.equal(doc.text,'second edit');
  c.api=async()=>{throw Error('REVISION_CONFLICT');};await assert.rejects(c.save(),/CONFLICT/);assert.equal(doc.text,'second edit');
});
test('first save and Save As never reload over typing that occurred during creation',async()=>{
  let doc={text:'snapshot'},pending=deferred(),replacements=0;
  const c=new ProjectConnection({getDoc:()=>doc,replaceDoc:async d=>{replacements++;doc=d;},api:()=>pending.promise});
  const create=c.create('new-book');doc.text='typed while saving';
  await assert.rejects(c.create('duplicate'),/SAVE_IN_PROGRESS/);
  pending.resolve({revision:1,document:{text:'snapshot'}});await create;
  assert.equal(replacements,0);assert.equal(doc.text,'typed while saving');assert.equal(c.dirty,true);assert.equal(c.projectId,'new-book');
});
test('open cannot replace input made during a delayed read or bind a rejected document',async()=>{
  let doc={text:'local'},pending=deferred();const c=new ProjectConnection({getDoc:()=>doc,replaceDoc:async d=>{doc=d;},api:()=>pending.promise});
  const opening=c.open('remote');doc.text='new input';pending.resolve({revision:1,document:{text:'remote'}});
  await assert.rejects(opening,/LOCAL_CHANGED_DURING_OPEN/);assert.equal(doc.text,'new input');assert.equal(c.projectId,null);
  c.api=async()=>({revision:1,document:{text:'invalid'}});c.replaceDoc=async()=>false;
  await assert.rejects(c.open('bad'),/DOCUMENT_REJECTED/);assert.equal(c.projectId,null);
});
test('a pending save prevents polling from moving the baseline backwards',async()=>{
  let doc={text:'snapshot'},pending=deferred();const c=new ProjectConnection({getDoc:()=>doc,replaceDoc:async d=>{doc=d;},api:async()=>({revision:1,document:doc})});await c.open('book');
  doc={text:'new edit'};c.api=()=>pending.promise;const saving=c.save();assert.equal(await c.poll(),false);await assert.rejects(c.save(),/SAVE_IN_PROGRESS/);pending.resolve({revision:2});await saving;assert.equal(c.revision,2);
});
test('saving an unchanged document keeps the reviewed revision and does not issue a write',async()=>{
 let doc,calls=0;const c=new ProjectConnection({getDoc:()=>doc,replaceDoc:async d=>{doc=d;},api:async()=>{calls++;return {revision:5,document:{text:'reviewed'}};}});
 await c.open('paper');const result=await c.save();assert.equal(result.unchanged,true);assert.equal(calls,1);assert.equal(c.revision,5);assert.equal(c.dirty,false);
});
test('typing while a version restore is pending is retained against the new revision',async()=>{
 let doc={text:'current'},pending=deferred();const c=new ProjectConnection({getDoc:()=>doc,replaceDoc:async d=>{doc=d;},api:async()=>({revision:2,document:doc})});await c.open('book');
 c.api=()=>pending.promise;const restoring=c.restore(1);doc.text='typed during restore';pending.resolve({revision:3,document:{text:'historic'}});await restoring;
 assert.equal(doc.text,'typed during restore');assert.equal(c.revision,3);assert.equal(c.dirty,true);
});
test('a read started before a save cannot roll back the completed save',async()=>{
 let doc={text:'original'};const c=new ProjectConnection({getDoc:()=>doc,replaceDoc:async d=>{doc=d;},api:async()=>({revision:1,document:{text:'original'}})});await c.open('book');
 const reading=deferred();c.api=async name=>name==='get_project'?reading.promise:{revision:3};
 const poll=c.poll();doc.text='saved edit';await c.save();
 reading.resolve({revision:2,document:{text:'stale remote'}});
 assert.equal(await poll,false);assert.equal(doc.text,'saved edit');assert.equal(c.revision,3);assert.equal(c.dirty,false);
});
test('unchanged revision polls transfer only metadata, then fetch once when the revision changes',async()=>{
 let doc,revision=1;const calls=[];
 const c=new ProjectConnection({getDoc:()=>doc,replaceDoc:async d=>{doc=d;},api:async name=>{calls.push(name);return name==='get_project_status'?{revision}:{revision,document:{text:'revision '+revision}};}});
 await c.open('paper');calls.length=0;
 for(let i=0;i<3;i++)assert.equal(await c.poll(),false);
 assert.deepEqual(calls,['get_project_status','get_project_status','get_project_status']);
 revision=2;assert.equal(await c.poll(),true);assert.deepEqual(calls.slice(-2),['get_project_status','get_project']);assert.equal(doc.text,'revision 2');
});
test('typing during the second-stage document fetch is never replaced',async()=>{
 let doc={text:'original'},pending=deferred();
 const c=new ProjectConnection({getDoc:()=>doc,replaceDoc:async d=>{doc=d;},api:async()=>({revision:1,document:doc})});await c.open('paper');
 c.api=async name=>name==='get_project_status'?{revision:2}:pending.promise;
 const poll=c.poll();await Promise.resolve();await Promise.resolve();doc.text='manual edit';
 pending.resolve({revision:2,document:{text:'agent edit'}});assert.equal(await poll,false);assert.equal(doc.text,'manual edit');assert.equal(c.revision,1);
});


test('durable draft checkpoint precedes save and retains the captured snapshot during new typing',async()=>{
 let doc,checkpoint=deferred(),captured,write;
 const c=new ProjectConnection({getDoc:()=>doc,replaceDoc:async d=>{doc=d;},beforeSave:async value=>{captured=value;await checkpoint.promise;},api:async(name,args)=>{if(name==='get_project')return {revision:1,document:{text:'old'}};write=args;return {revision:2};}});
 await c.open('paper');doc.text='saved snapshot';const saving=c.save();doc.text='new typing';
 assert.equal(write,undefined);assert.equal(captured.document.text,'saved snapshot');checkpoint.resolve();await saving;
 assert.equal(write.document.text,'saved snapshot');assert.equal(c.dirty,true);assert.equal(doc.text,'new typing');
 checkpoint=deferred();write=undefined;const cancelled=c.save();c.disconnect();checkpoint.resolve();assert.equal(await cancelled,false);assert.equal(write,undefined);
});
