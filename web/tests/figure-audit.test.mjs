import test from 'node:test';
import assert from 'node:assert/strict';
import {figureGroups,figureDiagnostics} from '../public/editor/src/figure-audit.mjs';
import {documentDiagnostics} from '../public/editor/src/integrity.mjs';
import {addJournalTools} from '../lib/journal-tools.mjs';
const p=(id,text)=>({id,type:'paragraph',text});
test('bilingual captions without figure assets produce one actionable error per figure',()=>{
 const document={blocks:[p('body','图2展示实验结果。'),...Array.from({length:6},(_,i)=>[p('zh'+i,`图${i+1} 实验图`),p('en'+i,`Fig.${i+1} Experiment`)]).flat()]};
 assert.equal(figureGroups(document).length,6);
 const issues=documentDiagnostics(document);assert.equal(issues.length,6);assert.ok(issues.every(d=>d.severity==='error'&&d.code==='FIGURE_ASSET_MISSING'&&d.blockId));
});
test('adding image and caption ownership clears live missing-asset errors without rewriting import evidence',()=>{
 const document={blocks:[p('note','注：实验条件'),p('zh','图1实验图'),p('en','Fig.1 Experiment')],importReports:[{diagnostics:[{severity:'warning',code:'DOCX_FIGURE_CONTENT_MISSING',message:'No images at import'}]}]};
 assert.deepEqual(figureGroups(document)[0].captionIds,['note','zh','en']);
 document.blocks.unshift({id:'img',type:'image',captionIds:['note','zh','en']});
 assert.deepEqual(figureDiagnostics(document),[]);assert.equal(documentDiagnostics(document).filter(d=>d.severity==='error').length,0);
 assert.equal(documentDiagnostics(document).find(d=>d.code==='DOCX_FIGURE_CONTENT_MISSING').severity,'info');
 assert.equal(document.importReports[0].diagnostics[0].severity,'warning');
 document.blocks.push(p('missing','图2 未提供图件'));
 assert.equal(documentDiagnostics(document).find(d=>d.code==='DOCX_FIGURE_CONTENT_MISSING').severity,'warning');
});

test('unresolved editorial comments remain actionable until explicitly resolved',()=>{
 const document={blocks:[p('body','text')],comments:[{id:'c',blockId:'body',text:'Check source',resolved:false}]};
 assert.deepEqual(documentDiagnostics(document),[{code:'EDITORIAL_COMMENT_UNRESOLVED',severity:'warning',message:'Check source',blockId:'body',commentId:'c'}]);
 document.comments[0].resolved=true;assert.deepEqual(documentDiagnostics(document),[]);
});
test('adjacent unlinked images are distinguished from absent images',()=>{
 const document={blocks:[{id:'img',type:'image'},p('c','图1 测试')]};
 assert.equal(figureDiagnostics(document)[0].severity,'warning');
 document.blocks[0].captionIds=['c'];assert.deepEqual(figureDiagnostics(document),[]);
});
test('explicit anchors disambiguate body references; cell-image grids own bilingual captions',()=>{
 const document={blocks:[p('body','图 1 展示测试结果。'),{id:'grid',type:'table',anchor:{targetId:'body'},cellImages:[{imageId:'img'}],captionIds:['zh','en']},{id:'img',type:'image'},p('zh','图1 测试'),p('en','Fig.1 Test')]};
 assert.deepEqual(figureDiagnostics(document),[]);
});
test('spaced prose references in Chinese or English are not missing-figure captions',()=>{
 assert.deepEqual(figureDiagnostics({blocks:[p('zh','图 2 展示了变化趋势。'),p('en','Figure 2 shows the experiment.'),p('f','Fig. 3 illustrates another result.')]}),[]);
});
test('the actual proof endpoint rejects caption-only figures and accepts the repaired document',async()=>{
 const roles=['title-zh','authors-zh','affiliation-zh','abstract-zh','keywords-zh','title-en','authors-en','affiliation-en','abstract-en','keywords-en'];
 const record={projectId:'test',revision:1,document:{journal:{template:'cn-academic'},blocks:[...roles.map(role=>({...p(role,'Synthetic '+role),role})),p('caption','图1 实验图')]}};
 let starts=0;const handlers=new Map();
 addJournalTools((name,_description,_schema,handler)=>handlers.set(name,handler),{get:async()=>record,journalRuntime:{start:async()=>{starts++;return {status:'running'};}}});
 const start=handlers.get('start_journal_proof');
 await assert.rejects(start({projectId:'test',expectedRevision:1}),/JOURNAL_PREFLIGHT.*图1只有题注/);assert.equal(starts,0);
 record.document.blocks.unshift({id:'img',type:'image',src:'data:image/png;base64,AAAA',captionIds:['caption']});
 assert.equal((await start({projectId:'test',expectedRevision:1})).status,'running');assert.equal(starts,1);
});
