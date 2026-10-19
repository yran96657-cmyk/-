import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDocument} from '../src/model.mjs';
import {documentDiagnostics} from '../src/integrity.mjs';
import {applyOperations} from '../mcp/operations.mjs';
import {operation,documentSchema} from '../mcp/schema.mjs';
import {assembleBook} from '../src/workspace-tools.mjs';

function doc(){return validateDocument({format:'open-typesetter',version:4,journal:{template:'cn-academic',name:'合成期刊'},blocks:[
{id:'title',type:'paragraph',text:'标题',role:'title-zh'},
{id:'p',type:'paragraph',text:'见图 1'},
{id:'img',type:'image',src:'data:image/png;base64,AA==',anchor:{targetId:'p',position:'after',maxPageDistance:1},captionIds:['cap']},
{id:'cap',type:'paragraph',text:'图 1'},
{id:'eq',type:'equation',text:'x^2',sourceOmml:'<source/>',sourceSha256:'a'.repeat(64),equationNumber:'2',placement:'full-width'},
{id:'tab',type:'table',rows:[['x2','12'],['body','34']],cellMarks:[{row:0,col:0,marks:[{start:1,end:2,superscript:true}]}]}
],notes:[{id:'n',text:'通信作者','marker':'*'}]});}

test('v4 schema and browser round-trip preserve roles, anchors, source and footnote symbols',()=>{
 const d=doc();assert.deepEqual(validateDocument(documentSchema.parse(d)),d);assert.equal(d.notes[0].marker,'*');
 const errors=documentDiagnostics(d);assert.ok(errors.some(e=>e.code==='JOURNAL_FIELD_MISSING'));
 const blank=structuredClone(d);blank.blocks[0].text=' ';assert.ok(documentDiagnostics(blank).some(e=>e.message.includes('title-zh')));
 assert.equal(operation.parse({op:'set_journal',journal:{template:'cn-academic',volume:'50'}}).op,'set_journal');
 assert.equal(applyOperations(d,[{op:'set_journal',journal:{template:'cn-academic',volume:'50'}}]).document.journal.volume,'50');
});
test('dangling/reused captions and anchor targets reject the entire edit',()=>{
 const d=doc();
 for(const operations of [
  [{op:'delete_blocks',blockIds:['p']}],
  [{op:'delete_blocks',blockIds:['cap']}],
  [{op:'update_block',blockId:'img',patch:{anchor:{targetId:'title',position:'after',maxPageDistance:1}}}],
  [{op:'update_block',blockId:'tab',patch:{captionIds:['cap']}}],
  [{op:'update_block',blockId:'img',patch:{anchor:{targetId:'cap',position:'after',maxPageDistance:1}}}],
 ])assert.throws(()=>applyOperations(d,operations));
 assert.equal(d.blocks.length,6);
 const changed=applyOperations(d,[{op:'update_block',blockId:'img',patch:{anchor:null,captionIds:[]}},{op:'delete_blocks',blockIds:['p','cap']}]);
 assert.equal(changed.document.blocks.length,4);
});
test('table superscripts track edits and row insertion',()=>{
 let d=applyOperations(doc(),[{op:'table_set_cell',blockId:'tab',row:0,col:0,text:'xx2'}]).document;
 assert.equal(d.blocks.at(-1).cellMarks[0].marks[0].end,3);
 d=applyOperations(d,[{op:'table_resize',blockId:'tab',axis:'row',index:0,remove:false}]).document;
 assert.equal(d.blocks.at(-1).cellMarks[0].row,1);
 const mixed=doc();Object.assign(mixed.blocks.at(-1),{rows:[['值[[math:m]]','2']],inlineMath:[{id:'m',text:'x^2'}],cellMarks:[{row:0,col:0,marks:[{start:0,end:1,bold:true}]}]});
 assert.equal(validateDocument(mixed).blocks.at(-1).cellMarks[0].marks[0].bold,true);
});
test('malformed source evidence and journal settings cannot silently normalize away',()=>{
 for(const mutate of [d=>delete d.journal,d=>d.journal.normalizeTypography='yes',d=>d.blocks[4].sourceSha256='bad',d=>delete d.blocks[4].sourceOmml,d=>d.notes[0].marker='']){
  const d=doc();mutate(d);assert.throws(()=>validateDocument(d));
 }
 assert.throws(()=>assembleBook(doc(),[doc()]),/期刊/);
});
