import test from 'node:test';
import assert from 'node:assert/strict';
import {validatedReferenceBreaks} from '../public/editor/src/reference-breaks.mjs';
import {applyOperations} from '../lib/operations.mjs';
import {makeTemplate} from '../public/editor/src/templates.mjs';
import {blockPatch} from '../lib/schema.mjs';
const text='[1] AUTHOR. A journal article. 2026, 8: 1-9.';
const hints={sourceText:text,breaks:[{offset:text.indexOf('journal')+4,hyphen:true}]};
const block={id:'r',type:'paragraph',role:'reference',text,referenceBreaks:hints};
test('reference break metadata survives validation without changing text',()=>{
 assert.deepEqual(validatedReferenceBreaks(block),hints);
 assert.deepEqual(blockPatch.parse({referenceBreaks:hints}).referenceBreaks,hints);
 assert.equal(validatedReferenceBreaks({...block,referenceBreaks:null}),undefined);
});
test('editing text invalidates stale line endings while retaining new source',()=>{
 const doc=makeTemplate('journal','Test');doc.blocks.push(block);
 const result=applyOperations(doc,[{op:'replace_text',blockId:'r',start:4,end:10,text:'CHANGED'}]).document;
 const changed=result.blocks.find(b=>b.id==='r');
 assert.equal(changed.text,text.replace('AUTHOR','CHANGED'));
 assert.equal(changed.referenceBreaks,undefined);
});
test('invalid offsets, surrogate splits and unsafe hyphens are rejected',()=>{
 for(const breaks of [[{offset:2,hyphen:true}],[{offset:9999,hyphen:false}],[{offset:20,hyphen:false},{offset:19,hyphen:false}],[{offset:11,hyphen:true}]])assert.throws(()=>validatedReferenceBreaks({...block,referenceBreaks:{sourceText:text,breaks}}));
 const astral='[1] A𠀀B';assert.throws(()=>validatedReferenceBreaks({...block,text:astral,referenceBreaks:{sourceText:astral,breaks:[{offset:6,hyphen:false}]}}));
 assert.throws(()=>validatedReferenceBreaks({...block,role:undefined}));
});
