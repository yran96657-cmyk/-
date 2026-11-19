import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDocument} from '../public/editor/src/model.mjs';
import {documentSchema} from '../lib/schema.mjs';
import {applyOperations} from '../lib/operations.mjs';
const sample=()=>({format:'open-typesetter',version:4,layout:{fontSet:'founder-sample'},journal:{template:'cn-academic',normalizeTypography:true,headerFontSize:8.85,headerLeading:12,roleStyles:{'abstract-zh':{fontFamily:'fangsong',leftIndentMm:7.4,rightIndentMm:1,firstLineIndentPt:18},'authors-zh':{fontFamily:'kai'}},excludedParagraphs:[{blockId:'residue',sourceText:'ob25 mg·L-1',reason:'作者确认模板残留'}]},blocks:[{id:'residue',type:'paragraph',text:'ob25 mg·L-1'},{id:'body',type:'paragraph',text:'原始正文保留'}]});
test('sample font roles, measured insets and exclusions survive validation without deleting text',()=>{
 const raw=sample(),d=validateDocument(documentSchema.parse(raw));
 assert.deepEqual(d.journal,raw.journal);assert.equal(d.layout.fontSet,'founder-sample');
 assert.equal(d.blocks[0].text,raw.blocks[0].text);
 const restored=applyOperations(d,[{op:'set_journal',journal:{...d.journal,excludedParagraphs:[]}}]).document;
 assert.deepEqual(restored.blocks,d.blocks);
});
test('exclusions cannot hide changed text, footnotes, equations, captions or anchor targets',()=>{
 for(const change of [d=>d.blocks[0].text+='changed',d=>d.blocks[0].role='abstract-zh',d=>d.journal.excludedParagraphs[0].reason='',d=>d.journal.excludedParagraphs.push(d.journal.excludedParagraphs[0]),d=>{d.blocks[0].text='[^n]';d.journal.excludedParagraphs[0].sourceText='[^n]';d.notes=[{id:'n',text:'注'}];},d=>d.blocks.push({id:'img',type:'image',src:'data:image/png;base64,AA==',captionIds:['residue']})]){
  const d=sample();change(d);assert.throws(()=>validateDocument(d));
 }
});
test('excluded decorative rules permit contiguous text joins but preserve the source objects',()=>{
 const src='data:image/png;base64,AA==',d=sample();d.journal.excludedParagraphs=[];
 d.blocks=[{id:'a',type:'paragraph',text:'作者提'},{id:'rule',type:'image',src},{id:'b',type:'paragraph',text:'出了定理。'}];
 d.journal.excludedImages=[{blockId:'rule',sourceSrc:src,reason:'作者确认模板横线'}];d.journal.paragraphJoins=[{blockIds:['a','b'],separator:''}];
 const clean=validateDocument(documentSchema.parse(d));assert.deepEqual(clean.journal.paragraphJoins,d.journal.paragraphJoins);assert.equal(clean.blocks[1].src,src);
 for(const change of [d=>d.blocks[1].src+='changed',d=>d.journal.paragraphJoins[0].blockIds.reverse(),d=>d.blocks[2].role='title-zh']){const copy=structuredClone(d);change(copy);assert.throws(()=>validateDocument(copy));}
});
