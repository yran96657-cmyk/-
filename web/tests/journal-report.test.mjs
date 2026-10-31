import test from 'node:test';
import assert from 'node:assert/strict';
import {journalFontProblems,assertJournalFonts} from '../public/editor/src/journal-fonts.mjs';
import {showJournalReport} from '../public/editor/src/journal-report-ui.mjs';
import {setupJournal} from '../public/editor/src/journal-ui.mjs';

test('font preflight respects all explicit choices and never mutates the manuscript',()=>{
 const d={layout:{fontSet:'source-han'},journal:{bodyWeight:'light',latinFont:'times',mathFont:'stix-two'}};
 const before=structuredClone(d),inventory={profiles:{cjk:{'source-han':{available:true}},bodyWeight:{light:{available:false,missingFonts:['Source Han Serif SC Light']}},latin:{times:{available:false,missingFonts:['Times New Roman']}},math:{'stix-two':{available:false,missingFonts:['STIX Two Math']}}}};
 assert.equal(journalFontProblems(d,inventory).length,3);
 assert.throws(()=>assertJournalFonts(d,inventory),/Source Han Serif SC Light.*Times New Roman|Times New Roman.*Source Han Serif SC Light/);
 assert.deepEqual(d,before);
 d.layout.fontSet='fandol';assert.ok(journalFontProblems(d,inventory).some(p=>p.message.includes('轻字重正文须使用思源')));
 assert.doesNotThrow(()=>assertJournalFonts(d,undefined)); // Previous servers have no inventory.
});

test('omitted font choice uses the renderer environment default without persisting a replacement',()=>{
 const d={journal:{},blocks:[]},before=structuredClone(d);
 const available={available:true};
 const inventory={defaultCjkFontSet:'fandol',profiles:{cjk:{fandol:available,windows:{available:false}},latin:{'tex-default':available},math:{'tex-default':available},bodyWeight:{regular:available}}};
 assert.deepEqual(journalFontProblems(d,inventory),[]);assert.deepEqual(d,before);
 assert.ok(journalFontProblems({...d,layout:{fontSet:'windows'}},inventory).length);
});

function fakeDom(t){
 const previous=Object.getOwnPropertyDescriptor(globalThis,'document');
 t.after(()=>{if(previous)Object.defineProperty(globalThis,'document',previous);else delete globalThis.document;});
 const nodes=[];
 function element(tag){const n={tag,style:{},children:[],textContent:'',attributes:{},setAttribute(k,v){this.attributes[k]=v;},append(...items){this.children.push(...items);},showModal(){this.open=true;},close(){this.open=false;this.onclose?.();},remove(){this.removed=true;}};Object.defineProperty(n,'innerHTML',{set(){throw Error('untrusted HTML');}});nodes.push(n);return n;}
 globalThis.document={createElement:element,body:element('body')};
 return nodes;
}
test('report shows physical pages, candidates, revision and untrusted text as text',t=>{
 const nodes=fakeDom(t),payload='<img src=x onerror=alert(1)>';
 const dialog=showJournalReport({projectId:'qa',revision:7,pages:12,report:{formulaCoverage:{total:295},quality:{productionReady:false,diagnostics:[
  {severity:'error',code:'TEX_MISSING_GLYPH',message:'字体缺字：啟',compilerMessage:payload,sourceLocations:[{objectId:'ref',pages:[12,12],excerpt:payload}]},
  {severity:'warning',code:'JOURNAL_METADATA_REVIEW',message:'出版日期待确认'},
  {severity:'info',code:'SOURCE_EVIDENCE',message:'保留核验记录'}]}}});
 const text=nodes.map(n=>n.textContent).join('\n');
 assert.match(text,/1 项阻断/);assert.match(text,/r7/);assert.match(text,/PDF 第 12 页/);assert.match(text,/候选来源/);assert.match(text,/字体缺字：啟/);assert.ok(text.includes(payload));assert.match(text,/自动检查不等于可发印/);assert.equal(dialog.open,true);
 const evidence=nodes.find(n=>n.tag==='details'&&n.children.some(c=>c.textContent==='来源核验记录（1）'));
 assert.ok(evidence);assert.ok(!evidence.open);assert.match(text,/保留核验记录/);
 nodes.find(n=>n.tag==='button').onclick();assert.equal(dialog.removed,true);
});
test('proof metrics come from the report and PDF actions remain explicit',t=>{
 const nodes=fakeDom(t),called=[];
 const dialog=showJournalReport({revision:3,pages:2,report:{fonts:[{embedded:true},{embedded:false}],formulaCoverage:{total:6},semanticLayout:{sourceObjectCoverage:{mapped:28,expected:29}},quality:{diagnostics:[]}}},{openPdf:()=>called.push('open'),downloadPdf:()=>called.push('pdf'),downloadReport:()=>called.push('report')});
 assert.deepEqual(called,[]);assert.equal(dialog.attributes['aria-labelledby'],'proofTitle');
 const text=nodes.map(n=>n.textContent).join('\n');assert.match(text,/1 \/ 2/);assert.match(text,/28 \/ 29/);assert.match(text,/待人工验收/);
 nodes.find(n=>n.textContent==='打开 PDF 校样').onclick();assert.deepEqual(called,['open']);
});
test('changing a light-weight source-han profile requires an explicit compatible weight',t=>{
 const nodes=fakeDom(t),d={layout:{fontSet:'source-han'},journal:{bodyWeight:'light'},blocks:[{role:'title-zh'}]},before=structuredClone(d),messages=[];let open;
 setupJournal({getDoc:()=>d,change:fn=>fn(),status:m=>messages.push(m),makeButton:(_name,fn)=>open=fn});open();
 const selects=nodes.filter(n=>n.tag==='select');const cjk=selects.find(n=>n.children.some(c=>c.value==='fandol'));const weight=selects.find(n=>n.children.some(c=>c.value==='light'));
 cjk.value='fandol';const save=nodes.find(n=>n.textContent==='应用期刊模板');save.onclick();assert.deepEqual(d,before);assert.match(messages[0],/轻字重只适用于思源/);
 weight.value='regular';save.onclick();assert.equal(d.layout.fontSet,'fandol');assert.equal(d.journal.bodyWeight,'regular');
});

test('report links metadata and source warnings back to editable controls',t=>{
 const nodes=fakeDom(t),called=[];
 const dialog=showJournalReport({revision:2,pages:1,report:{quality:{diagnostics:[{code:'JOURNAL_METADATA_REVIEW',severity:'warning',message:'请补全中文刊名',field:'name'},{code:'PUBLICATION_METADATA_PLACEHOLDER',severity:'warning',message:'文章编号仍有占位符',blockId:'cite'}]}}},{editJournal:()=>called.push('journal'),locateBlock:id=>called.push(id)});
 nodes.find(n=>n.textContent==='补全刊物信息').onclick();assert.deepEqual(called,['journal']);assert.equal(dialog.removed,true);
 nodes.find(n=>n.textContent==='定位并编辑').onclick();assert.deepEqual(called,['journal','cite']);
});
