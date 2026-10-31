import test from 'node:test';
import assert from 'node:assert/strict';
import {journalPlan} from '../lib/journal-plan.mjs';
import {applyOperations,checkDocument,outline} from '../lib/operations.mjs';
import {toolList} from '../lib/cloud-tools.mjs';
test('journal plan preserves content and creates navigable real headings',()=>{
 const texts=['标题','张三','（甲大学）','摘要：测试','关键词：测试','English title','ZHANG San','(School of Test University)','Abstract: Test','Keywords: Test','1 引言','正文','参考文献','[1] Test'];
 const doc=checkDocument({format:'open-typesetter',version:4,blocks:texts.map((text,i)=>({id:'b'+i,type:'paragraph',text})),notes:[]});
 const plan=journalPlan(doc);assert.deepEqual(plan.diagnostics,[]);
 const result=applyOperations(doc,plan.operations).document;
 assert.deepEqual(result.blocks.map(b=>b.text),texts);assert.equal(outline(result)[0].title,'1 引言');
 assert.equal(result.blocks[13].role,'reference');assert.equal(result.blocks[8].role,'abstract-en');
 assert.deepEqual(doc.blocks.map(b=>b.type),texts.map(()=> 'paragraph'));
});
test('missing metadata stays unresolved; explicit role overrides are checked',()=>{
 const doc=checkDocument({format:'open-typesetter',version:4,blocks:[{id:'p',type:'paragraph',text:'body'}]});
 assert.ok(journalPlan(doc).diagnostics.some(d=>d.code==='ROLE_UNRESOLVED'));
 assert.throws(()=>journalPlan(doc,{roles:{missing:'title-zh'}}),/NOT_FOUND/);
 const changed=applyOperations(doc,[{op:'set_text_block_type',blockId:'p',type:'heading',level:2}]).document;
 assert.equal(changed.blocks[0].id,'p');assert.equal(outline(changed)[0].level,2);
 assert.equal(applyOperations(changed,[{op:'set_text_block_type',blockId:'p',type:'paragraph'}]).document.blocks[0].type,'paragraph');
});
test('MCP exposes explicit revision policy, planning and semantic promotion',()=>{
 const tools=toolList();for(const name of ['plan_journal_layout','set_text_block_type'])assert.ok(tools.some(t=>t.name===name));
 assert.ok(tools.find(t=>t.name==='import_journal_docx').inputSchema.properties.revisionPolicy.enum.includes('accept'));
});

test('consecutive subfigures retain assets and share a bounded grid/caption',()=>{
 const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==';
 const doc=checkDocument({format:'open-typesetter',version:4,blocks:[{id:'a',type:'image',src:png},{id:'b',type:'image',src:png},{id:'c',type:'paragraph',text:'图1 子图'},{id:'d',type:'paragraph',text:'Fig. 1 Subfigures'}]});
 const result=applyOperations(doc,journalPlan(doc).operations).document;
 const grid=result.blocks[0];assert.equal(grid.type,'table');assert.deepEqual(grid.cellImages.map(c=>c.imageId),['a','b']);assert.deepEqual(grid.captionIds,['c','d']);assert.equal(result.blocks.filter(b=>b.type==='image').length,2);assert.equal(result.blocks[1].src,png);
});

test('Word image tables own captions after their separately stored image assets',()=>{
 const doc=checkDocument({format:'open-typesetter',version:4,blocks:[{id:'grid',type:'table',rows:[['']],cellImages:[{row:0,col:0,imageId:'img'}]},{id:'img',type:'image',src:'data:image/png;base64,AAAA'},{id:'cap',type:'paragraph',text:'图1 图组'}]});
 const plan=journalPlan(doc),result=applyOperations(doc,plan.operations).document;
 assert.deepEqual(result.blocks[0].captionIds,['cap']);assert.equal(result.blocks[0].captionPosition,'below');assert.ok(!plan.diagnostics.some(d=>d.code==='FIGURE_ASSET_UNASSIGNED'));
});

test('figure notes stay with captions; prose references are not missing figures',()=>{
 const doc=checkDocument({format:'open-typesetter',version:4,blocks:[{id:'p',type:'paragraph',text:'图2展示了实验结果。'},{id:'img',type:'image',src:'data:image/png;base64,AAAA'},{id:'note',type:'paragraph',text:'注：不同字母表示显著差异。'},{id:'cap',type:'paragraph',text:'图2实验结果'},{id:'en',type:'paragraph',text:'Fig.2 Experimental results'}]});
 const plan=journalPlan(doc),result=applyOperations(doc,plan.operations).document;
 assert.deepEqual(result.blocks[1].captionIds,['note','cap','en']);assert.ok(!plan.diagnostics.some(d=>d.code==='FIGURE_ASSET_UNASSIGNED'));
});

test('figure anchors distinguish spaced body references from unbound captions',()=>{
 for(const kind of ['image','table']){
  const asset={id:'asset',type:kind,captionIds:['caption'],anchor:{targetId:'body',position:'after',maxPageDistance:1},...(kind==='image'?{src:'data:image/png;base64,AAAA'}:{rows:[['']],cellImages:[{row:0,col:0,imageId:'image'}]})};
  const blocks=[{id:'body',type:'paragraph',text:'图 1 展示合成数据。'},asset,...(kind==='table'?[{id:'image',type:'image',src:'data:image/png;base64,AAAA'}]:[]),{id:'caption',type:'paragraph',text:'图 1 合成示意图'}];
  const doc=checkDocument({format:'open-typesetter',version:4,blocks});
  const missing=d=>journalPlan(d).diagnostics.filter(d=>d.code==='FIGURE_ASSET_UNASSIGNED').map(d=>d.blockId);
  const before=structuredClone(doc);assert.deepEqual(missing(doc),[]);assert.deepEqual(doc,before);
  const unrelated=structuredClone(doc);unrelated.blocks[0].text='图 2 未提供的图件';assert.deepEqual(missing(unrelated),['body']);
  const ambiguous=structuredClone(doc);delete ambiguous.blocks[1].anchor;assert.deepEqual(missing(ambiguous),['body']);
 }
});


test('compact profile matches journal geometry and remains stable after repeated validation',()=>{
 const doc=checkDocument({format:'open-typesetter',version:4,blocks:[{id:'t',type:'table',rows:[['first','second','third'],['A','B','C']],columnWidths:[33.3333333333,33.3333333333,33.3333333334]}]});
 const plan=journalPlan(doc,{profile:'compact-academic'}),result=applyOperations(doc,plan.operations).document;
 assert.deepEqual([result.layout.width,result.layout.height,result.layout.columns,result.layout.fontSize],[170,240,2,8]);
 assert.deepEqual(checkDocument(result),result);
 assert.deepEqual(checkDocument(checkDocument(result)),result);
 assert.deepEqual(result.blocks[0].rows,doc.blocks[0].rows);
});

test('compact profile numbers only wholly unnumbered articles and locates uncertain metadata',()=>{
 const doc=checkDocument({format:'open-typesetter',version:4,blocks:[{id:'stray',type:'paragraph',text:'unclassified fragment'},{id:'cite',type:'paragraph',text:'Test[J]. XX(X): X-X.'},{id:'eq',type:'equation',text:'x=1'}]});
 const plan=journalPlan(doc,{profile:'compact-academic'}),result=applyOperations(doc,plan.operations).document;
 assert.equal(result.blocks[2].equationNumber,'1');assert.equal(result.blocks[2].text,'x=1');
 assert.ok(plan.diagnostics.some(d=>d.code==='UNCLASSIFIED_PREFIX'&&d.blockId==='stray'));
 assert.ok(plan.diagnostics.some(d=>d.code==='PUBLICATION_METADATA_PLACEHOLDER'&&d.blockId==='cite'));
 doc.blocks[2].equationNumber='A.1';assert.equal(applyOperations(doc,journalPlan(doc,{profile:'compact-academic'}).operations).document.blocks[2].equationNumber,'A.1');
});

test('full width figures are constrained against the full measure for 300 DPI',()=>{
 const png=Buffer.alloc(24);png[0]=137;png[1]=80;png.writeUInt32BE(900,16);png.writeUInt32BE(600,20);
 const doc=checkDocument({format:'open-typesetter',version:4,blocks:[{id:'img',type:'image',placement:'full-width',width:100,src:'data:image/png;base64,'+png.toString('base64')}]});
 const result=applyOperations(doc,journalPlan(doc,{profile:'compact-academic'}).operations).document;
 assert.ok(result.blocks[0].width<53);assert.ok(900/((144*result.blocks[0].width/100)/25.4)>=300);
});

test('caption-bound auto figures use full measure without overriding explicit human placement',()=>{
 const png=Buffer.alloc(24);png[0]=137;png[1]=80;png.writeUInt32BE(1000,16);png.writeUInt32BE(900,20);
 const source=checkDocument({format:'open-typesetter',version:4,blocks:[{id:'img',type:'image',width:80,src:'data:image/png;base64,'+png.toString('base64'),captionIds:['c']},{id:'c',type:'paragraph',text:'图1 实验'}]});
 const prepared=applyOperations(source,journalPlan(source,{profile:'compact-academic'}).operations).document;
 assert.equal(prepared.blocks[0].placement,'full-width');assert.ok(prepared.blocks[0].width*144/100<=1000/300*25.4);assert.equal(prepared.blocks[0].src,source.blocks[0].src);
 source.blocks[0].placement='column';const manual=applyOperations(source,journalPlan(source,{profile:'compact-academic'}).operations).document;assert.equal(manual.blocks[0].placement,'column');
});
