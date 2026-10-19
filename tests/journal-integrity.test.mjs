import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {validateDocument} from '../src/model.mjs';
import {ProjectStore} from '../mcp/store.mjs';
import {createTools} from '../mcp/service.mjs';
import {applyOperations,checkDocument} from '../mcp/operations.mjs';
import {safeFlowCut,minimumFlowUnit} from '../src/flow-layout.mjs';
import {assembleBook,runTextOperations} from '../src/workspace-tools.mjs';
import {findMatches,replaceAll} from '../src/editor-tools.mjs';

const report=()=>({kind:'docx',sourceSha256:'a'.repeat(64),sourceBytes:123,counts:{sourceMath:1,importedMath:1,sourceImages:1,importedImages:0},diagnostics:[{code:'DOCX_CONTENT_REVIEW',severity:'error',message:'未转换的原稿图片'}]});
const source=()=>({format:'open-typesetter',version:3,title:'期刊测试',layout:{fontSet:'fandol',width:170,height:240,columns:2},importReports:[report()],blocks:[{id:'p',type:'paragraph',text:'若[[math:m]]成立。',inlineMath:[{id:'m',text:'x>0'}]},{id:'table',type:'table',rows:[['[[math:a]]','1']],inlineMath:[{id:'a',text:'a^2'}]}]});
function workspace(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'shuye-journal-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return new ProjectStore(root);}
function caller(store){const tools=createTools(store);return async(name,args)=>{const tool=tools.find(t=>t.name===name);return tool.run(tool.schema.parse(args));};}

test('v3 round-trip preserves formula positions and persistent import evidence',()=>{
  const doc=checkDocument(source());assert.equal(doc.version,3);assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(doc))),doc);
  assert.equal(doc.blocks[0].inlineMath[0].text,'x>0');assert.equal(doc.blocks[1].rows[0][0],'[[math:a]]');assert.deepEqual(doc.importReports,[report()]);
  assert.equal(validateDocument({...source(),version:2}).version,3);
});
test('missing, duplicate, unreferenced and malformed formula tokens fail closed',()=>{
  for(const text of ['若成立。','若[[math:missing]]成立。','若[[math:m]]及[[math:m]]成立。','若[[math:m]成立。']){
    const doc=source();doc.blocks[0].text=text;assert.throws(()=>checkDocument(doc),/公式/);
  }
  const doc=source();doc.blocks[0].ruby=[{start:1,end:3,text:'bad'}];assert.throws(()=>checkDocument(doc),/注音/);
});
test('AI edits cannot cut tokens or silently discard formulas in table resize',()=>{
  const doc=checkDocument(source());
  assert.throws(()=>applyOperations(doc,[{op:'replace_text',blockId:'p',start:3,end:4,text:'X'}]),/ATOMIC/);
  assert.throws(()=>applyOperations(doc,[{op:'table_resize',blockId:'table',axis:'col',index:0,remove:true}]),/公式/);
  const changed=applyOperations(doc,[{op:'update_block',blockId:'p',patch:{inlineMath:[{id:'m',text:'x<0'}]}},{op:'table_merge',blockId:'table',range:{row:0,col:0,rowspan:1,colspan:2}},{op:'table_split',blockId:'table',row:0,col:0}]).document;
  assert.equal(changed.blocks[0].inlineMath[0].text,'x<0');assert.deepEqual(changed.blocks[1].inlineMath,doc.blocks[1].inlineMath);
  assert.equal(applyOperations(doc,[{op:'update_block',blockId:'p',patch:{text:'替换整段',inlineMath:[]}}]).document.blocks[0].text,'替换整段');
});
test('pagination and batch text transforms keep formula markers atomic',()=>{
  const text='若[[math:matrix]]成立。',points=Array.from(text);
  for(let n=2;n<text.indexOf('成立');n++)assert.equal(safeFlowCut(points,0,n),1);
  assert.equal(minimumFlowUnit(points,1),'[[math:matrix]]'.length);
  const doc=runTextOperations(checkDocument(source()),['upper','fullwidth']).doc;assert.match(doc.blocks[0].text,/\[\[math:m\]\]/);assert.equal(doc.blocks[0].inlineMath[0].text,'x>0');
  assert.equal(findMatches(doc,'math').length,0);assert.equal(findMatches(doc,'m').length,0);
  assert.equal(replaceAll(doc,'math','broken').count,0);
});
test('loss evidence survives saves, process restart, dry run, undo and chapter assembly',async t=>{
  const store=workspace(t),run=caller(store);store.create('paper',source());
  const validation=await run('validate_project',{projectId:'paper'});assert.equal(validation.structureValid,true);assert.equal(validation.contentStatus,'BLOCKED');assert.equal(validation.productionReady,false);assert.match(validation.warnings.join(' '),/未转换/);
  const dry=store.edit('paper',1,[{op:'set_title',title:'候选'}],{dryRun:true});assert.equal(dry.diagnostics[0].severity,'error');assert.equal(dry.visualPaginationChecked,false);
  store.edit('paper',1,[{op:'set_title',title:'修改'}]);assert.deepEqual(new ProjectStore(store.root).get('paper').document.importReports,[report()]);
  const stripped={...source(),importReports:[]};assert.throws(()=>store.replace('paper',2,stripped),/IMPORT_REPORT_REMOVAL/);
  store.undo('paper',2);assert.deepEqual(store.get('paper').document.importReports,[report()]);
  const combined=assembleBook(checkDocument(source()),[source()]).doc;assert.equal(combined.importReports.length,2);checkDocument(combined);
});
test('proof reader rejects arbitrary paths and symlink artifacts',async t=>{
  const store=workspace(t),run=caller(store);await assert.rejects(run('get_proof_page',{proofId:'../../private',page:1}));
  if(process.platform!=='win32'){
    fs.writeFileSync(path.join(store.root,'private.json'),'{}');fs.symlinkSync(path.join(store.root,'private.json'),path.join(store.root,'artifacts','proof-linked.json'));
    assert.throws(()=>store.readArtifact('proof-linked.json'),/INVALID_ARTIFACT_FILE/);
  }
});
test('real candidate PDF, paged geometry, revision binding and commit without computer use',{skip:process.env.SHUYE_TEST_PDF!=='1'},async t=>{
  const store=workspace(t),run=caller(store),doc=source();doc.importReports=[];store.create('paper',doc);
  const operations=[{op:'insert_blocks',beforeId:'p',blocks:[{id:'heading',type:'heading',text:'学术期刊校样',fontSize:15}]},{op:'update_block',blockId:'p',patch:{inlineMath:[{id:'m',text:'x>1'}]}}];
  const candidate=await run('render_candidate',{projectId:'paper',expectedRevision:1,operations});
  assert.equal(store.get('paper').revision,1);assert.equal(candidate.candidate,true);assert.equal(candidate.report.quality.productionReady,false);
  assert.equal(candidate.report.pdfSha256,createHash('sha256').update(fs.readFileSync(candidate.path)).digest('hex'));
  assert.equal(candidate.report.geometry.status,'COMPLETE');assert.equal(candidate.report.geometry.outsideCount,0);
  const geometry=await run('get_proof_page',{proofId:candidate.proofId,page:1,limit:200});assert.equal(geometry.stale,false);assert.equal(geometry.candidate,true);assert.ok(geometry.lines.length);assert.match(geometry.lines.map(l=>l.text).join(''),/学术期刊校样/);
  store.edit('paper',1,operations);assert.equal((await run('get_proof_page',{proofId:candidate.proofId,page:1})).stale,true);
  const final=await run('export_pdf',{projectId:'paper',expectedRevision:2});assert.equal(final.report.sourceDocumentSha256,candidate.report.sourceDocumentSha256);assert.equal(final.revision,2);
  // A write while XeLaTeX is running must not return a proof as the current revision.
  const pending=run('export_pdf',{projectId:'paper',expectedRevision:2});store.edit('paper',2,[{op:'set_title',title:'Concurrent revision'}]);
  await assert.rejects(pending,/REVISION_CHANGED_DURING_RENDER/);
});
