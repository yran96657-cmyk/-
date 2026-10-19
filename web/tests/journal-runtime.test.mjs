import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createJournalRuntime} from '../standalone/journal-runtime.mjs';
import {callTool} from '../lib/cloud-tools.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex');
const record=()=>({projectId:'p',revision:1,document:{format:'open-typesetter',version:4,title:'测试',blocks:[]}});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function completed(runtime,id){for(let i=0;i<200;i++){const result=await runtime.status('alice',id);if(result.status!=='running')return result;await wait(10);}throw Error('test timeout');}
async function fixture(options={}){
 const dir=await mkdtemp(join(tmpdir(),'shuye-journal-test-'));const engine=join(dir,'engine');await mkdir(engine);
 // Protocol stub tests process lifecycle, persistence and races, not TeX layout.
 await writeFile(join(engine,'worker.py'),`const fs=require('node:fs'),c=require('node:crypto');let s='';process.stdin.on('data',v=>s+=v);process.stdin.on('end',()=>{const r=JSON.parse(s);if(r.method==='probe'){console.log('{}');return;}if(r.method==='import'){console.log(JSON.stringify({blocks:[]}));return;}setTimeout(()=>{const pdf=Buffer.from('%PDF-test'),report=Buffer.from(JSON.stringify({geometry:{pages:[]},semanticLayout:{objects:{}},quality:{diagnostics:[]}}));fs.writeFileSync(r.directory+'/proof.pdf',pdf);fs.writeFileSync(r.directory+'/report.json',report);const h=v=>c.createHash('sha256').update(v).digest('hex');console.log(JSON.stringify({pages:1,pdfSha256:h(pdf),reportSha256:h(report)}));},r.document.title==='hang'?10000:100);});`);
 const opts={directory:join(dir,'proofs'),python:process.execPath,engineDirectory:engine,...options};
 const runtime=await createJournalRuntime(opts);
 return {dir,opts,runtime,cleanup:async()=>{await runtime.close();await rm(dir,{recursive:true,force:true});}};
}
test('journal worker reserves a single slot, preserves a snapshot and verifies private artifacts',async()=>{
 const f=await fixture();try{
  assert.equal(f.runtime.capabilities.enabled,true);const input=record();
  const start=f.runtime.start('alice',input);
  assert.throws(()=>f.runtime.start('alice',record()),/BUSY/);
  input.document.title='later';input.revision=2;
  const meta=await start;assert.equal(meta.revision,1);
  const done=await completed(f.runtime,meta.proofId);assert.equal(done.status,'complete');
  const dir=join(f.opts.directory,hash('alice'),meta.proofId);
  assert.equal(JSON.parse(await readFile(join(dir,'document.json'))).title,'测试');
  assert.equal(await f.runtime.pdf('alice',meta.proofId),Buffer.from('%PDF-test').toString('base64'));
  await f.runtime.report('alice',meta.proofId);
  await assert.rejects(()=>f.runtime.status('bob',meta.proofId),/NOT_FOUND/);
  await assert.rejects(()=>f.runtime.status('alice','../escape'),/INVALID_PROOF_ID/);
  await writeFile(join(dir,'proof.pdf'),'tampered');await assert.rejects(()=>f.runtime.pdf('alice',meta.proofId),/HASH_MISMATCH/);
  await writeFile(join(dir,'report.json'),'{}');await assert.rejects(()=>f.runtime.report('alice',meta.proofId),/HASH_MISMATCH/);
 }finally{await f.cleanup();}
});
test('journal timeout and graceful shutdown persist failure and allow recovery',async()=>{
 const f=await fixture({timeoutMs:1000});try{
  const input=record();input.document.title='hang';const m=await f.runtime.start('alice',input);
  assert.equal((await completed(f.runtime,m.proofId)).status,'failed');
  const second=await f.runtime.start('alice',input);await f.runtime.close();
  assert.equal((await f.runtime.status('alice',second.proofId)).status,'failed');
  const dir=join(f.opts.directory,hash('alice'),'proof-interrupted');await mkdir(dir);
  await writeFile(join(dir,'status.json'),JSON.stringify({status:'running'}));
  const restart=await createJournalRuntime(f.opts);try{assert.equal((await restart.status('alice','proof-interrupted')).error,'WORKER_INTERRUPTED_RETRY');assert.equal((await completed(restart,(await restart.start('alice',record())).proofId)).status,'complete');}finally{await restart.close();}
 }finally{await f.cleanup();}
});
test('missing runtime is disabled instead of advertising working OMML/PDF',async()=>{
 const f=await fixture({python:'/nonexistent/shuye-python'});try{
  assert.equal(f.runtime.capabilities.enabled,false);await assert.rejects(()=>f.runtime.importDocx('AA=='),/UNAVAILABLE/);
  const disabled=await callTool(null,'get_journal_capabilities',{});assert.equal(disabled.enabled,false);
  const caps=await callTool({journalRuntime:f.runtime},'get_capabilities',{});assert.equal(caps.docxImport.omml,false);
 }finally{await f.cleanup();}
});
test('MCP rejects stale proof by default and binds diagnostics and pages to its source revision',async()=>{
 const f=await fixture();try{
  const meta=await f.runtime.start('alice',record());await completed(f.runtime,meta.proofId);
  const store={owner:'alice',journalRuntime:f.runtime,get:async()=>({...record(),revision:2})};
  assert.equal((await callTool(store,'get_journal_proof',{proofId:meta.proofId})).stale,true);
  await assert.rejects(()=>callTool(store,'download_journal_pdf',{proofId:meta.proofId}),/STALE_PROOF/);
  assert.equal((await callTool(store,'download_journal_pdf',{proofId:meta.proofId,acknowledgeStale:true})).revision,1);
  await assert.rejects(()=>callTool(store,'get_journal_proof_page',{proofId:meta.proofId,page:1}),/PAGE_NOT_FOUND/);
 }finally{await f.cleanup();}
});

test('unavailable fonts reject before occupying a worker slot or creating a proof',async()=>{
 const f=await fixture({maxProofs:1});try{
  const profiles={cjk:{fandol:{available:true},'source-han':{available:false,missingFonts:['Source Han Serif SC']}},latin:{'tex-default':{available:true}},math:{'tex-default':{available:true}},bodyWeight:{regular:{available:true}}};
  f.runtime.capabilities.environment.fonts={profiles};
  const input=record();input.document.layout={fontSet:'source-han'};
  assert.throws(()=>f.runtime.start('alice',input),/JOURNAL_FONTS_UNAVAILABLE.*Source Han Serif SC/);
  assert.equal(input.document.layout.fontSet,'source-han');input.document.layout.fontSet='fandol';
  const started=await f.runtime.start('alice',input);assert.equal((await completed(f.runtime,started.proofId)).status,'complete');
 }finally{await f.cleanup();}
});

test('MCP rechecks the project after reading proof artifacts, including explicitly allowed old PDFs',async()=>{
 let revision=1;
 const meta={proofId:'proof-race',projectId:'p',revision:1,status:'complete'};
 const report={geometry:{status:'COMPLETE',characters:1,outside:[],pages:[{widthPt:100,heightPt:100,lines:[]}]},semanticLayout:{objects:{}}};
 const store={owner:'alice',get:async()=>({revision}),journalRuntime:{
  status:async()=>meta,
  report:async()=>{revision=2;return report;},
  pdf:async()=>{revision=2;return 'JVBERg==';}
 }};
 await assert.rejects(()=>callTool(store,'download_journal_pdf',{proofId:meta.proofId}),/STALE_PROOF/);
 revision=1;
 const allowed=await callTool(store,'download_journal_pdf',{proofId:meta.proofId,acknowledgeStale:true});
 assert.equal(allowed.stale,true);assert.equal(allowed.revision,1);
 revision=1;assert.equal((await callTool(store,'get_journal_proof',{proofId:meta.proofId})).stale,true);
 revision=1;assert.equal((await callTool(store,'get_journal_proof_page',{proofId:meta.proofId,page:1})).stale,true);
});
