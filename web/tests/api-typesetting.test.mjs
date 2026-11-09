import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {openStorage} from '../standalone/storage.mjs';
import {CloudStore} from '../lib/cloud-store.mjs';
import {callTool,toolList} from '../lib/cloud-tools.mjs';
import {makeTemplate} from '../public/editor/src/templates.mjs';
import {journalPreviewStyle} from '../public/editor/src/journal-preview.mjs';
import {createModelBroker,requestChat} from '../standalone/api-model.mjs';
import {createAgentTasks} from '../standalone/agent-tasks.mjs';
import {documentFingerprint} from '../public/editor/src/project-sync.mjs';
import {createHash} from 'node:crypto';
import {imageFit} from '../lib/image-fit.mjs';
import {compactQuality,runApiAgent} from '../standalone/api-agent.mjs';
const hash=d=>createHash('sha256').update(documentFingerprint(d)).digest('hex');
test('one page inspection includes real footer coordinates without repeated model pagination',async()=>{
 let round=0;const offsets=[],t={projectId:'paper',revision:1,proofId:'proof',goal:'test',apiModel:'deepseek'};
 const store={owner:'alice',apiModels:{request:async(_,__,body)=>{
  if(round++===0)return {choices:[{message:{tool_calls:[{id:'page',function:{name:'get_journal_proof_page',arguments:JSON.stringify({proofId:'proof',page:1})}}]}}]};
  const result=JSON.parse(body.messages.find(m=>m.role==='tool').content);assert.deepEqual(result.footerLines,[{text:'1',bboxPt:[90,750,100,760]}]);return {choices:[{message:{content:'已检查'}}]};
 }}};
 await runApiAgent({store,t,invoke:async(_,name,a)=>{if(name==='get_typesetting_context')return {};assert.equal(name,'get_journal_proof_page');offsets.push(a.offset||0);return {page:1,heightPt:800,widthPt:600,totalLines:40,lines:a.offset?[{text:'1',bboxPt:[90,750,100,760]}]:[{text:'Title',bboxPt:[50,50,100,70]}]};},tools:toolList(),event:async(t,stage)=>{t.stage=stage;},checkpoint(){},verify:async()=>{}});
 assert.deepEqual(offsets,[0,30]);
});
test('malformed model arguments are returned for correction before any commit intent',async()=>{
 let round=0;const events=[],t={projectId:'paper',revision:1,goal:'test',apiModel:'deepseek'};
 const store={owner:'alice',apiModels:{request:async()=>({choices:[{message:round++===0?{tool_calls:[{id:'bad',function:{name:'apply_typesetting',arguments:JSON.stringify({projectId:'paper',expectedRevision:1,previewHash:'invalid'})}}]}:{content:'参数需要更正'}}]})}};
 await runApiAgent({store,t,invoke:async(_,name)=>{assert.equal(name,'get_typesetting_context');return {};},tools:toolList(),event:async(t,stage)=>{t.stage=stage;events.push(stage);},checkpoint(){},verify:async()=>{}});
 assert.ok(!events.includes('committing'));assert.match(t.apiCalls[0].errors[0].error,/INVALID_TOOL_ARGUMENTS/);
});
test('uncertain writes are recoverable only when revision and entire source digest are unchanged',async()=>{
 for(const changed of [false,true]){
  const document=makeTemplate('journal','Source'),t={projectId:'paper',revision:1,sourceSha256:hash(document),goal:'test',apiModel:'deepseek'};let round=0;
  const store={owner:'alice',get:async()=>({revision:changed?2:1,document}),apiModels:{request:async()=>({choices:[{message:round++===0?{tool_calls:[{id:'write',function:{name:'apply_typesetting',arguments:JSON.stringify({projectId:'paper',expectedRevision:1,previewHash:'a'.repeat(64),layout:{inner:20}})}}]}:{content:'保存失败，待处理'}}]})}};
  const job=runApiAgent({store,t,invoke:async(_,name)=>{if(name==='get_typesetting_context')return {};throw Error('SIMULATED_IO_FAILURE');},tools:toolList(),event:async(t,stage)=>{t.stage=stage;},checkpoint(){},verify:async()=>{}});
  if(changed)await assert.rejects(()=>job,/COMMIT_OUTCOME_UNKNOWN/);else{await job;assert.match(t.apiCalls[0].errors[0].error,/SIMULATED_IO_FAILURE/);}
 }
});
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'shuye-api-')),storage=await openStorage(join(dir,'data')),store=new CloudStore(storage.DB,storage.BUCKET,'alice');await store.create('paper',makeTemplate('journal','Title'));t.after(async()=>{storage.close();await rm(dir,{recursive:true,force:true});});return {dir,store,storage};}
test('batch preview binds entire source/revision and preserves content; JSON property order is irrelevant',async t=>{
 const {store}=await fixture(t),initial=await store.get('paper');
 const args={projectId:'paper',expectedRevision:1,layout:{header:'Agent',footer:'{page}'},styles:[{role:'title-zh',patch:{fontSize:18,bold:true,align:'center'}},{type:'heading',patch:{fontSize:12}}]};
 await assert.rejects(()=>callTool(store,'apply_typesetting',args),/PREVIEW_REQUIRED/);
 const preview=await callTool(store,'apply_typesetting',{...args,dryRun:true});assert.equal((await store.status('paper')).revision,1);
 const reordered={...args,layout:{footer:'{page}',header:'Agent'},previewHash:preview.previewHash};
 const saved=await callTool(store,'apply_typesetting',reordered);assert.equal(saved.revision,2);
 const title=saved.document.blocks.find(b=>b.role==='title-zh');assert.equal(journalPreviewStyle(title,saved.document.journal).fontSize,'18pt');
 assert.deepEqual(saved.document.blocks.map(b=>[b.id,b.text,b.rows,b.sourceOmml]),initial.document.blocks.map(b=>[b.id,b.text,b.rows,b.sourceOmml]));
 assert.deepEqual(saved.document.notes,initial.document.notes);
 await assert.rejects(()=>callTool(store,'apply_typesetting',{...args,expectedRevision:2,previewHash:preview.previewHash}),/PREVIEW_REQUIRED/);
 await assert.rejects(()=>callTool(store,'apply_typesetting',{...args,previewHash:preview.previewHash}),/REVISION_CONFLICT/);
 await assert.rejects(()=>callTool(store,'apply_typesetting',{...args,expectedRevision:2,dryRun:true,styles:[{type:'paragraph',patch:{text:'overwrite'}}]}));
});
test('compact context excludes binary/source maths and nested journal merge retains existing metadata',async t=>{
 const {store}=await fixture(t);const a={projectId:'paper',expectedRevision:1,journal:{roleStyles:{'title-zh':{fontSize:18}}}};
 const p=await callTool(store,'apply_typesetting',{...a,dryRun:true});const result=await callTool(store,'apply_typesetting',{...a,previewHash:p.previewHash});
 assert.equal(result.document.journal.name,'书页学术示例');assert.equal(result.document.journal.template,'cn-academic');
 const context=await callTool(store,'get_typesetting_context',{projectId:'paper'});assert.ok(JSON.stringify(context).length<15000);assert.equal(context.journal.roleStyles['title-zh'].fontSize,18);
 assert.ok(!JSON.stringify(context).includes('base64,'));
});
test('a model may echo the existing article note and set role alignment but cannot rewire notes',async t=>{
 const {store}=await fixture(t);const initial=await store.get('paper');
 initial.document.notes.push({id:'note-a',text:'Original note'},{id:'note-b',text:'Other note'});initial.document.journal.articleNoteId='note-a';
 await store.create('notes',initial.document);
 const args={projectId:'notes',expectedRevision:1,journal:{articleNoteId:'note-a',roleStyles:{'title-zh':{align:'right'}}}};
 const preview=await callTool(store,'apply_typesetting',{...args,dryRun:true});
 const saved=await callTool(store,'apply_typesetting',{...args,previewHash:preview.previewHash});
 assert.equal(saved.document.journal.articleNoteId,'note-a');assert.equal(journalPreviewStyle(saved.document.blocks.find(b=>b.role==='title-zh'),saved.document.journal).textAlign,'right');
 assert.deepEqual(saved.document.notes,initial.document.notes);
 await assert.rejects(()=>callTool(store,'apply_typesetting',{...args,expectedRevision:2,dryRun:true,journal:{articleNoteId:'note-b'}}),/PRESERVES_NOTE_BINDINGS/);
});
test('connector queue scopes owners/workers, rejects stale completions, and repeats completion safely',async()=>{
 const broker=createModelBroker({models:[{id:'deepseek',model:'remote/deepseek'}],timeoutMs:80}),w=randomUUID(),other=randomUUID();
 try{
  await assert.rejects(()=>broker.request('alice','deepseek',{}),/OFFLINE/);
  await broker.poll('alice',{workerId:w,models:['remote/deepseek']});
  const promise=broker.request('alice','deepseek',{messages:[]});const {request}=await broker.poll('alice',{workerId:w,models:['remote/deepseek']});assert.ok(request);
  assert.equal((await broker.poll('bob',{workerId:other,models:['remote/deepseek']})).request,null);
  assert.throws(()=>broker.complete('bob',{workerId:other,requestId:request.requestId,response:{}}),/NOT_FOUND/);
  const response={choices:[{message:{content:'ok'}}]};broker.complete('alice',{workerId:w,requestId:request.requestId,response});assert.deepEqual(await promise,response);
  assert.equal(broker.complete('alice',{workerId:w,requestId:request.requestId,response}).duplicate,true);
  const pending=broker.request('alice','deepseek',{});await assert.rejects(pending,/TIMEOUT/);
 }finally{broker.close();}
});
test('direct provider blocks credential URLs/private HTTP, redirects and oversized responses',async()=>{
 for(const url of ['http://remote.example/v1','https://secret@remote.example/v1','https://remote.example/v1?key=x'])await assert.rejects(()=>requestChat({url},{},undefined),/ENDPOINT/);
 await assert.rejects(()=>requestChat({url:'http://127.0.0.1:1234/v1'},{},undefined,async()=>new Response('secret error',{status:401})),/MODEL_HTTP_401/);
 await assert.rejects(()=>requestChat({url:'http://127.0.0.1:1234/v1'},{},undefined,async()=>new Response('x'.repeat(2*1024*1024+1))),/RESPONSE_LIMIT/);
 await assert.rejects(()=>requestChat({url:'http://127.0.0.1:1234/v1'},{},undefined,async()=>new Response('private invalid response')),e=>e.message==='MODEL_INVALID_JSON');
 await assert.rejects(()=>requestChat({url:'http://127.0.0.1:1234/v1'},{},undefined,async()=>{throw new DOMException('timeout','TimeoutError');}),e=>e.message==='MODEL_TIMEOUT');
});

test('image fitting accounts for columns, full-width cells and new margins without modifying pixels',()=>{
 const bytes=Buffer.alloc(24);bytes[0]=137;bytes[1]=80;bytes.writeUInt32BE(1000,16);bytes.writeUInt32BE(500,20);
 const src='data:image/png;base64,'+bytes.toString('base64');
 const doc={layout:{width:210,inner:20,outer:20,columns:2,gap:10},journal:{tableWidthPercent:90},blocks:[{id:'a',type:'image',src,width:100},{id:'b',type:'image',src,width:100,placement:'full-width'},{id:'c',type:'image',src,width:100},{id:'t',type:'table',placement:'full-width',rows:[['','','']],columnWidths:[1,1,2],merges:[{row:0,col:0,colspan:2,rowspan:1}],cellImages:[{row:0,col:0,imageId:'c'}]}]};
 const before=structuredClone(doc),fit=imageFit(doc);
 assert.equal(fit[0].width,100);assert.ok(fit[1].width<50);assert.equal(fit[2].measureMm,76.5);
 assert.ok(fit.every(i=>i.estimatedDpi>=300));assert.deepEqual(doc,before);
});

test('unavailable font selection fails in preview before any revision is created',async t=>{
 const {store}=await fixture(t);store.journalRuntime={capabilities:{environment:{fonts:{profiles:{cjk:{fandol:{available:true}},latin:{'tex-default':{available:true}},math:{'tex-default':{available:true}},bodyWeight:{regular:{available:true}}}}}}};
 await assert.rejects(()=>callTool(store,'apply_typesetting',{projectId:'paper',expectedRevision:1,dryRun:true,layout:{fontSet:'source-han'}}),/JOURNAL_FONTS_UNAVAILABLE/);
 assert.equal((await store.status('paper')).revision,1);
});

test('hundreds of MathType ledger entries do not consume the model context or hide quality errors',()=>{
 const diagnostics=Array.from({length:378},()=>({severity:'info',code:'MATHTYPE_CONVERTED',message:'source digest '.repeat(30)}));
 diagnostics.push({severity:'warning',code:'REVIEW',message:'Review figures'},{severity:'error',code:'LOW_DPI',message:'Figure too large',blockId:'img'});
 const full={status:'BLOCKED',productionReady:false,diagnostics},short=compactQuality(full);
 assert.equal(short.counts['info:MATHTYPE_CONVERTED'],378);assert.equal(short.diagnostics[0].code,'LOW_DPI');assert.equal(short.diagnostics[0].blockId,'img');assert.ok(JSON.stringify(short).length<1000);assert.equal(full.diagnostics.length,380);
});
test('API task runs real tool registry with usage, one batch, proof, persistence and whole-task undo',async t=>{
 const {dir,store}=await fixture(t);let round=0,preview;
 const command={projectId:'paper',expectedRevision:1,layout:{columns:2,gap:7},styles:[{role:'title-zh',patch:{fontSize:18}}]};
 store.apiModels={status:()=>({models:[{id:'deepseek',ready:true}]}),async request(owner,model,payload){
  assert.equal(owner,'alice');assert.equal(model,'deepseek');assert.ok(payload.tools.some(t=>t.function.name==='apply_typesetting'));
  const last=payload.messages.filter(m=>m.role==='tool').at(-1);if(last)preview=JSON.parse(last.content).previewHash||preview;
  const calls=round===0?[{name:'apply_typesetting',args:{...command,dryRun:true}}]:round===1?[{name:'apply_typesetting',args:{...command,previewHash:preview}}]:[];round++;
  return {model:'DeepSeek-test',usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120},choices:[{finish_reason:'stop',message:{role:'assistant',content:'完成',...(calls.length?{tool_calls:calls.map((c,i)=>({id:'c'+round+i,type:'function',function:{name:c.name,arguments:JSON.stringify(c.args)}}))}:{})}}]};
 }};
 let proof;store.journalRuntime={capabilities:{enabled:true},start:async(owner,r)=>(proof={projectId:r.projectId,proofId:'proof-'+randomUUID(),revision:r.revision,sourceDocumentSha256:hash(r.document),pdfSha256:'a'.repeat(64),reportSha256:'b'.repeat(64),status:'complete',pages:1}),status:async()=>proof,report:async()=>({quality:{status:'REVIEW',diagnostics:[]},geometry:{status:'COMPLETE',outside:[]},semanticLayout:{objects:{}}})};
 const options={directory:join(dir,'tasks'),invoke:callTool,tools:toolList(),pollMs:1};let agent=await createAgentTasks(options);store.agentTasks=agent;t.after(()=>agent.close());
 const args={projectId:'paper',expectedRevision:1,mode:'api',apiModel:'deepseek',requestId:randomUUID(),goal:'双栏7毫米，标题18磅'};
 const started=await callTool(store,'start_agent_task',args);let done;
 for(let n=0;n<200;n++){done=await callTool(store,'get_agent_task',{projectId:'paper',taskId:started.taskId});if(done.status!=='running')break;await new Promise(r=>setTimeout(r,10));}
 assert.equal(done.status,'review',JSON.stringify(done.issue));assert.equal(done.appliedRevision,2);assert.equal(done.usage.totalTokens,360);assert.equal(done.actions.undo,true);
 await agent.close();agent=await createAgentTasks(options);store.agentTasks=agent;
 const replay=await callTool(store,'start_agent_task',args);assert.equal(replay.taskId,started.taskId);
 const undone=await callTool(store,'undo_agent_task',{projectId:'paper',taskId:started.taskId,expectedRevision:2});assert.equal(undone.status,'undone');assert.equal((await store.get('paper')).document.blocks.find(b=>b.role==='title-zh').journalStyle,undefined);
});
