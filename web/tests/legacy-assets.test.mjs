import test from 'node:test';
import assert from 'node:assert/strict';
import {checkDocument,applyOperations} from '../lib/operations.mjs';
const hash='a'.repeat(64);
const legacy=()=>({format:'mtef5',data:'AAAA',sha256:hash,mtefSha256:hash,sourceAsset:'word/embeddings/eq.bin',originalTex:'x',characters:1,structures:0,empty:false,preview:{data:'AAAA',sha256:hash,sourceAsset:'word/media/preview.wmf'}});
const vector=()=>({format:'emf',data:'AAAA',pdf:'AAAA',sha256:hash,pdfSha256:hash,previewSha256:hash,renderedEmfSha256:hash,sourceAsset:'word/media/figure.emf',text:'Chart',converter:'synthetic',fonts:['Example'],normalizations:[]});
const source=()=>({format:'open-typesetter',version:4,journal:{template:'cn-academic'},layout:{columns:2},blocks:[{id:'e',type:'equation',text:'x',legacySource:legacy()}, {id:'p',type:'paragraph',text:'若[[math:m]]成立',inlineMath:[{id:'m',text:'x',legacySource:legacy()}]}, {id:'i',type:'image',text:'',src:'data:image/png;base64,AAAA',vectorSource:vector(),placement:'full-width',floatPlacement:'top'}]});
test('native sources survive JSON, model validation and AI edits',()=>{
 const d=checkDocument(source()),again=checkDocument(JSON.parse(JSON.stringify(d)));assert.deepEqual(again,d);
 const changed=applyOperations(d,[{op:'update_block',blockId:'e',patch:{text:'x+1'}},{op:'update_block',blockId:'i',patch:{width:90}}]).document;
 assert.deepEqual(changed.blocks[0].legacySource,legacy());assert.equal(changed.blocks[2].vectorSource.pdf,'AAAA');assert.equal(changed.blocks[2].floatPlacement,'top');assert.deepEqual(changed.blocks[1].inlineMath[0].legacySource,legacy());
});
test('invalid source types, ledger values and floating placements are rejected',()=>{
 for(const mutate of [d=>d.blocks[0].legacySource.sha256='broken',d=>d.blocks[0].legacySource.structures=-1,d=>d.blocks[1].legacySource=legacy(),d=>d.blocks[0].vectorSource=vector(),d=>d.blocks[2].vectorSource.normalizations=[{offset:1,from:'x',to:'y'}],d=>d.blocks[2].placement='column',d=>d.blocks[2].floatPlacement='anything']){const d=source();mutate(d);assert.throws(()=>checkDocument(d));}
});
test('large vector payload validates without a recursive base64 regex overflow',()=>{
 const d=source();d.blocks[2].vectorSource.data='AAAA'.repeat(500000);assert.equal(checkDocument(d).blocks[2].vectorSource.data.length,2000000);
});
