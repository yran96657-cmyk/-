import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createAgentTasks} from '../standalone/agent-tasks.mjs';
import {createLayoutAssistant} from '../standalone/layout-assistant.mjs';
import {openStorage} from '../standalone/storage.mjs';
import {CloudStore} from '../lib/cloud-store.mjs';
import {callTool,toolList} from '../lib/cloud-tools.mjs';
import {documentFingerprint} from '../public/editor/src/project-sync.mjs';
import {taskCanWrite} from '../public/editor/src/agent-task-ui.mjs';
import {makeTemplate} from '../public/editor/src/templates.mjs';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const hash=v=>createHash('sha256').update(documentFingerprint(v)).digest('hex');
async function fixture(t,options={}){
 const dir=await mkdtemp(join(tmpdir(),'shuye-agent-')),storage=await openStorage(join(dir,'data'));
 const model=createServer(async(req,res)=>{
  if(req.url==='/api/tags'){res.end(JSON.stringify({models:[{name:'test',digest:'a'.repeat(64)}]}));return;}
  let body='';for await(const chunk of req)body+=chunk;
  const context=JSON.parse(JSON.parse(body).messages.at(-1).content);
  await options.planGate?.();
  if(!res.destroyed)res.end(JSON.stringify({model:'test',done:true,message:{content:JSON.stringify({kind:options.unsupported?'unsupported':'proposal',summary:'请明确要求',patch:{...context.layout,...(options.unchanged?{}:{inner:20,outer:20})}})}}));
 });
 await new Promise(r=>model.listen(0,'127.0.0.1',r));
 const assistant=await createLayoutAssistant({directory:join(dir,'plans'),url:'http://127.0.0.1:'+model.address().port,model:'test'});
 const proofs=new Map(),events=[];let proofCount=0;
 const runtime={capabilities:{enabled:true},
  async start(owner,record){
   proofCount++;const proofId='proof-'+randomUUID(),proof={proofId,projectId:record.projectId,revision:record.revision,sourceDocumentSha256:hash(record.document),status:options.holdProof?'running':'complete',pages:1,pdfSha256:'b'.repeat(64),reportSha256:'c'.repeat(64)};
   proofs.set(proofId,{owner,proof});return proof;
  },
  async status(owner,id){const p=proofs.get(id);if(p?.owner!==owner)throw Error('PROOF_NOT_FOUND');return p.proof;},
  async report(){return {quality:{status:options.blocked?'BLOCKED':'INCOMPLETE',productionReady:false,diagnostics:options.blocked?[{severity:'error',message:'字体未嵌入'}]:[]},formulaCoverage:{total:1},geometry:{status:'COMPLETE',characters:100,outside:[]},semanticLayout:{status:'COMPLETE',mapped:27,objects:{}}};}
 };
 const invoke=async(store,name,args)=>{events.push(name);if(name==='start_journal_proof'&&options.busyProof>0){options.busyProof--;throw Error('JOURNAL_WORKER_BUSY_RETRY');}return callTool(store,name,args);};
 const config={directory:join(dir,'tasks'),invoke,pollMs:5};let agent=await createAgentTasks(config);
 const make=owner=>Object.assign(new CloudStore(storage.DB,storage.BUCKET,owner),{layoutAssistant:assistant,journalRuntime:runtime,agentTasks:agent});
 const alice=make('alice'),bob=make('bob');await alice.create('paper',makeTemplate('journal','测试文稿'));
 const args={projectId:'paper',expectedRevision:1,requestId:randomUUID(),goal:'内外边距改为20毫米',mode:'layout'};
 const read=task=>callTool(alice,'get_agent_task',{projectId:'paper',taskId:task.taskId});
 const terminal=async task=>{for(let i=0;i<500;i++){const p=await read(task);if(p.status!=='running')return p;await wait(5);}throw Error('test timeout');};
 const until=async predicate=>{for(let i=0;i<500;i++){if(await predicate())return;await wait(5);}throw Error('test timeout');};
 t.after(async()=>{await agent.close();await assistant.close();model.closeAllConnections();await new Promise(r=>model.close(r));storage.close();await rm(dir,{recursive:true,force:true});});
 return {dir,alice,bob,args,read,terminal,until,events,proofs,get proofCount(){return proofCount;},start:()=>callTool(alice,'start_agent_task',args),async restart(){await agent.close();agent=await createAgentTasks(config);alice.agentTasks=bob.agentTasks=agent;}};
}

test('one authorized task applies layout, creates proof, records evidence, and undoes the whole change',async t=>{
 const f=await fixture(t),before=await f.alice.get('paper'),started=await f.start(),done=await f.terminal(started);
 assert.equal(done.status,'review');assert.equal(done.appliedRevision,2);assert.equal(done.proof.revision,2);assert.equal(done.proof.quality.productionReady,false);assert.equal(done.actions.review,true);assert.equal(done.actions.undo,true);
 assert.equal(done.events.at(-1).step,'review');assert.equal(done.sourceSha256,hash(before.document));assert.equal(done.resultSha256,hash((await f.alice.get('paper')).document));assert.deepEqual((await f.alice.get('paper')).document.blocks,before.document.blocks);
 assert.equal(f.events.filter(x=>x==='apply_layout_plan').length,1);
 const duplicate=await f.start();assert.equal(duplicate.taskId,done.taskId);assert.equal(f.proofCount,1);
 const undone=await callTool(f.alice,'undo_agent_task',{projectId:'paper',taskId:done.taskId,expectedRevision:2});assert.equal(undone.status,'undone');assert.equal(undone.actions.review,false);assert.equal(undone.actions.undo,false);assert.equal(documentFingerprint((await f.alice.get('paper')).document),documentFingerprint(before.document));
});
test('identity, request collisions, strict input, and project-scoped discovery',async t=>{
 const f=await fixture(t),done=await f.terminal(await f.start());await f.bob.create('paper',makeTemplate('journal','other'));
 for(const name of ['get_agent_task','cancel_agent_task','resume_agent_task','undo_agent_task','review_agent_task'])await assert.rejects(()=>callTool(f.bob,name,{projectId:'paper',taskId:done.taskId,...(['resume_agent_task','undo_agent_task','review_agent_task'].includes(name)?{expectedRevision:1}:{}),...(name==='review_agent_task'?{pdfSha256:'b'.repeat(64)}:{})}),/NOT_FOUND/);
 assert.equal((await callTool(f.bob,'list_agent_tasks',{})).tasks.length,0);
 assert.equal((await callTool(f.alice,'list_agent_tasks',{})).tasks.length,1);
 await assert.rejects(()=>callTool(f.alice,'start_agent_task',{...f.args,goal:'other'}),/IDEMPOTENCY_CONFLICT/);
 await assert.rejects(()=>callTool(f.alice,'start_agent_task',{...f.args,operations:[{op:'set_title',title:'injected'}]}));
 await assert.rejects(()=>callTool(f.alice,'start_agent_task',{...f.args,requestId:randomUUID()}),/REVISION_CONFLICT/);
 assert.equal(toolList().find(x=>x.name==='get_agent_task').annotations.readOnlyHint,true);
});
test('stop before commit keeps source intact and continue reuses the same authorized task',async t=>{
 let release;const gate=new Promise(r=>release=r);const f=await fixture(t,{planGate:()=>gate});const started=await f.start();
 await f.until(async()=>!!(await f.read(started)).planId);
 const cancelled=await callTool(f.alice,'cancel_agent_task',{projectId:'paper',taskId:started.taskId});release();
 assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.actions.resume,true);assert.equal((await f.alice.get('paper')).revision,1);
 const continued=await callTool(f.alice,'resume_agent_task',{projectId:'paper',taskId:started.taskId,expectedRevision:1});assert.equal(continued.taskId,started.taskId);
 const done=await f.terminal(continued);assert.equal(done.status,'review');assert.equal(done.attempt,2);assert.equal((await f.alice.get('paper')).revision,2);
});
test('stop after application preserves changes; resume and restart do not apply them twice',async t=>{
 const f=await fixture(t,{holdProof:true}),started=await f.start();await f.until(async()=>!!(await f.read(started)).proofId);
 const cancelled=await callTool(f.alice,'cancel_agent_task',{projectId:'paper',taskId:started.taskId});assert.equal(cancelled.appliedRevision,2);assert.equal(cancelled.actions.undo,true);
 await f.restart();const old=await f.read(started);assert.equal(old.status,'cancelled');
 for(const {proof} of f.proofs.values())proof.status='complete';
 const resumed=await callTool(f.alice,'resume_agent_task',{projectId:'paper',taskId:started.taskId,expectedRevision:2});const done=await f.terminal(resumed);assert.equal(done.status,'review');assert.equal(f.proofCount,1);assert.equal(f.events.filter(x=>x==='apply_layout_plan').length,1);
});
test('manual changes during planning are never overwritten; later edits invalidate rollback',async t=>{
 let release;const gate=new Promise(r=>release=r);const f=await fixture(t,{planGate:()=>gate}),started=await f.start();await f.until(async()=>!!(await f.read(started)).planId);
 await f.alice.edit('paper',1,[{op:'set_title',title:'人工保留'}]);release();const done=await f.terminal(started);assert.equal(done.status,'needs_attention');assert.equal(done.stale,true);assert.equal(done.actions.resume,false);assert.equal((await f.alice.get('paper')).document.title,'人工保留');
 const next=await callTool(f.alice,'start_agent_task',{...f.args,requestId:randomUUID(),expectedRevision:2});const applied=await f.terminal(next);assert.equal(applied.status,'review');await f.alice.edit('paper',3,[{op:'set_title',title:'更新标题'}]);
 await assert.rejects(()=>callTool(f.alice,'undo_agent_task',{projectId:'paper',taskId:next.taskId,expectedRevision:4}),/NOT_UNDOABLE/);assert.equal((await f.alice.get('paper')).document.title,'更新标题');
});
test('quality failure requires attention, while a valid no-change plan still produces a proof',async t=>{
 await t.test('blocked proof',async st=>{const f=await fixture(st,{blocked:true}),done=await f.terminal(await f.start());assert.equal(done.status,'needs_attention');assert.equal(done.issue.code,'QUALITY_BLOCKED');assert.equal(done.actions.review,true);assert.equal(done.actions.resume,false);assert.equal(done.actions.undo,true);});
 await t.test('no change',async st=>{const f=await fixture(st,{unchanged:true}),done=await f.terminal(await f.start());assert.equal(done.status,'review');assert.equal(done.appliedRevision,undefined);assert.equal(done.actions.undo,false);assert.equal(f.proofCount,1);assert.equal((await f.alice.get('paper')).revision,1);});
 await t.test('ambiguous goal',async st=>{const f=await fixture(st,{unsupported:true}),done=await f.terminal(await f.start());assert.equal(done.status,'needs_attention');assert.equal(done.issue.code,'GOAL_NEEDS_CLARIFICATION');assert.equal(f.proofCount,0);assert.equal((await f.alice.get('paper')).revision,1);});
});
test('proof-only tasks skip the model and protect current revision',async t=>{
 const f=await fixture(t),started=await callTool(f.alice,'start_agent_task',{...f.args,mode:'proof'}),done=await f.terminal(started);assert.equal(done.status,'review');assert.equal(f.events.includes('start_layout_plan'),false);assert.equal((await f.alice.get('paper')).revision,1);
});

test('a deployment without a model still supports proof tasks and rejects layout before creating a task',async t=>{
 const f=await fixture(t);f.alice.layoutAssistant=undefined;
 const cap=await callTool(f.alice,'get_agent_capabilities',{});
 assert.equal(cap.enabled,true);assert.deepEqual(cap.modes,['prepare','proof']);assert.equal(cap.layoutModelConfigured,false);
 await assert.rejects(f.start,/LAYOUT_ASSISTANT_UNAVAILABLE/);
 assert.equal((await callTool(f.alice,'list_agent_tasks',{})).tasks.length,0);
 const done=await f.terminal(await callTool(f.alice,'start_agent_task',{...f.args,mode:'proof'}));
 assert.equal(done.status,'review');assert.equal((await f.alice.get('paper')).revision,1);
 assert.equal(f.events.includes('start_layout_plan'),false);
});
test('restart during an ambiguous commit is observable and never replays that write',async t=>{
 const f=await fixture(t),done=await f.terminal(await f.start());await f.restart();const file=join(f.dir,'tasks',done.taskId+'.json'),saved=JSON.parse(await readFile(file,'utf8'));
 await writeFile(file,JSON.stringify({...saved,status:'running',stage:'committing',appliedRevision:undefined,resultSha256:undefined}));await f.restart();const recovered=await f.read(done);
 assert.equal(recovered.status,'needs_attention');assert.equal(recovered.issue.code,'COMMIT_OUTCOME_UNKNOWN');assert.equal(recovered.actions.resume,false);assert.equal((await f.alice.get('paper')).revision,2);
});
test('client controls require matching project/revision and never discard local changes',()=>{
 const task={projectId:'p',currentRevision:2,stale:false},connection={projectId:'p',revision:2,dirty:false,writing:false};assert.equal(taskCanWrite(task,connection),true);
 for(const patch of [{dirty:true},{writing:true},{projectId:'q'},{revision:1}])assert.equal(taskCanWrite(task,{...connection,...patch}),false);assert.equal(taskCanWrite({...task,stale:true},connection),false);
});

test('editorial review binds exact proof and revision without claiming production approval',async t=>{
 const f=await fixture(t),done=await f.terminal(await f.start()),args={projectId:'paper',taskId:done.taskId,expectedRevision:2,pdfSha256:done.proof.pdfSha256};
 await assert.rejects(()=>callTool(f.alice,'review_agent_task',{...args,pdfSha256:'a'.repeat(64)}),/NOT_REVIEWABLE/);
 const reviewed=await callTool(f.alice,'review_agent_task',args);assert.equal(reviewed.status,'accepted');assert.equal(reviewed.review.productionApproval,false);assert.equal(reviewed.actions.accept,false);assert.equal((await f.alice.get('paper')).revision,2);
 await f.alice.edit('paper',2,[{op:'set_title',title:'next'}]);const stale=await f.read(done);assert.equal(stale.stale,true);assert.equal(stale.actions.review,false);
});

test('running task request replay is stable and a second task cannot occupy the worker',async t=>{
 let release;const gate=new Promise(r=>release=r);const f=await fixture(t,{planGate:()=>gate}),started=await f.start();
 const replay=await f.start();assert.equal(replay.taskId,started.taskId);
 await assert.rejects(()=>callTool(f.alice,'start_agent_task',{...f.args,requestId:randomUUID()}),/AGENT_BUSY_RETRY/);release();assert.equal((await f.terminal(started)).status,'review');
});
test('failed proof retries only compilation and preserves the single committed revision',async t=>{
 const f=await fixture(t,{holdProof:true}),started=await f.start();await f.until(async()=>!!(await f.read(started)).proofId);
 for(const {proof} of f.proofs.values()){proof.status='failed';proof.error='WORKER_INTERRUPTED_RETRY';}
 const stopped=await f.terminal(started);assert.equal(stopped.issue.code,'PROOF_FAILED');assert.equal(stopped.actions.resume,true);
 const resumed=await callTool(f.alice,'resume_agent_task',{projectId:'paper',taskId:started.taskId,expectedRevision:2});await f.until(()=>f.proofCount===2);
 for(const {proof} of f.proofs.values())if(proof.status==='running')proof.status='complete';
 assert.equal((await f.terminal(resumed)).status,'review');assert.equal((await f.alice.get('paper')).revision,2);assert.equal(f.events.filter(x=>x==='apply_layout_plan').length,1);
});
test('missing template and runtime fail before a model or write',async t=>{
 const f=await fixture(t);await f.alice.create('book',makeTemplate('book','book'));const started=await callTool(f.alice,'start_agent_task',{...f.args,projectId:'book'});
 await f.until(async()=>(await callTool(f.alice,'get_agent_task',{projectId:'book',taskId:started.taskId})).status!=='running');
 const task=await callTool(f.alice,'get_agent_task',{projectId:'book',taskId:started.taskId});assert.equal(task.issue.code,'JOURNAL_TEMPLATE_REQUIRED');assert.equal(f.events.includes('start_layout_plan'),false);assert.equal((await f.alice.get('book')).revision,1);
});

test('missing front matter and unavailable fonts are caught before applying any layout',async t=>{
 const f=await fixture(t);const doc=(await f.alice.get('paper')).document;doc.blocks.find(b=>b.role==='abstract-en').text='';await f.alice.create('incomplete',doc);
 const started=await callTool(f.alice,'start_agent_task',{...f.args,projectId:'incomplete'});await f.until(async()=>(await callTool(f.alice,'get_agent_task',{projectId:'incomplete',taskId:started.taskId})).status!=='running');
 const result=await callTool(f.alice,'get_agent_task',{projectId:'incomplete',taskId:started.taskId});assert.equal(result.issue.code,'SOURCE_PREFLIGHT');assert.equal(f.events.includes('start_layout_plan'),false);assert.equal((await f.alice.get('incomplete')).revision,1);
 f.alice.journalRuntime.capabilities.environment={fonts:{profiles:{}}};const noFonts=await callTool(f.alice,'start_agent_task',{...f.args,requestId:randomUUID()});const failed=await f.terminal(noFonts);assert.equal(failed.issue.code,'SOURCE_PREFLIGHT');assert.match(failed.issue.message,/cjk/);assert.equal((await f.alice.get('paper')).revision,1);
});

test('a temporarily occupied proof worker is retried without a second layout write',async t=>{
 const f=await fixture(t,{busyProof:2}),done=await f.terminal(await f.start());assert.equal(done.status,'review');assert.equal(done.events.some(e=>e.label==='等待本机排版资源'),true);assert.equal(f.proofCount,1);assert.equal(f.events.filter(x=>x==='apply_layout_plan').length,1);
});

test('archiving removes a project from the global task desk without deleting its history',async t=>{
 const f=await fixture(t),done=await f.terminal(await f.start());await f.alice.archive('paper',2,true);assert.equal((await callTool(f.alice,'list_agent_tasks',{})).tasks.length,0);assert.equal((await callTool(f.alice,'list_agent_tasks',{projectId:'paper'})).tasks.length,1);assert.equal((await f.read(done)).stale,true);
});


test('prepare handles an unclassified manuscript without a model and undo restores its exact source',async t=>{
 const f=await fixture(t);f.alice.layoutAssistant=undefined;
 const d=(await f.alice.get('paper')).document;delete d.journal;
 const texts=['中文题目','张三','（某大学）','摘要：测试','关键词：测试','English title','ZHANG San','(School of Test University)','Abstract: Test','Keywords: Test','1 引言','正文','参考文献','[1] Test'];
 d.blocks=texts.map((text,i)=>({id:'raw'+i,type:'paragraph',text}));await f.alice.create('raw',d);
 const before=(await f.alice.get('raw')).document;
 const started=await callTool(f.alice,'start_agent_task',{...f.args,projectId:'raw',mode:'prepare'});
 await f.until(async()=>(await callTool(f.alice,'get_agent_task',{projectId:'raw',taskId:started.taskId})).status!=='running');
 const done=await callTool(f.alice,'get_agent_task',{projectId:'raw',taskId:started.taskId});
 assert.equal(done.status,'review');assert.equal(done.appliedRevision,2);assert.equal(f.events.includes('start_layout_plan'),false);
 const after=(await f.alice.get('raw')).document;assert.equal(after.layout.columns,2);assert.equal(after.blocks[0].role,'title-zh');assert.deepEqual(after.blocks.map(b=>b.text),texts);
 await callTool(f.alice,'undo_agent_task',{projectId:'raw',taskId:done.taskId,expectedRevision:2});assert.deepEqual((await f.alice.get('raw')).document,before);
});
