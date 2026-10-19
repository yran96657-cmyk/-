import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {validateDocument} from '../public/editor/src/model.mjs';
import {applyOperations,checkDocument} from '../lib/operations.mjs';
import {safeFlowCut,minimumFlowUnit} from '../public/editor/src/flow-layout.mjs';
import {assembleBook,runTextOperations} from '../public/editor/src/workspace-tools.mjs';
import {findMatches,replaceAll} from '../public/editor/src/editor-tools.mjs';

const report=()=>({kind:'docx',sourceSha256:'a'.repeat(64),sourceBytes:123,counts:{sourceMath:1,importedMath:1,sourceImages:1,importedImages:0},diagnostics:[{code:'DOCX_CONTENT_REVIEW',severity:'error',message:'未转换的原稿图片'}]});
const source=()=>({format:'open-typesetter',version:3,title:'期刊测试',layout:{fontSet:'fandol',width:170,height:240,columns:2},importReports:[report()],blocks:[{id:'p',type:'paragraph',text:'若[[math:m]]成立。',inlineMath:[{id:'m',text:'x>0'}]},{id:'table',type:'table',rows:[['[[math:a]]','1']],inlineMath:[{id:'a',text:'a^2'}]}]});
test('persistent import evidence retains source locations and validates asset hashes',()=>{
 const doc=source(),diagnostic=doc.importReports[0].diagnostics[0];
 Object.assign(diagnostic,{sourcePart:'word/document.xml',sourcePath:'/document[1]/body[1]/p[7]/r[2]/object[1]',sourceAsset:'word/embeddings/equation.bin',assetSha256:'b'.repeat(64)});
 assert.deepEqual(checkDocument(doc).importReports[0].diagnostics[0],diagnostic);
 diagnostic.assetSha256='invalid';assert.throws(()=>validateDocument(doc),/资产指纹/);
 diagnostic.assetSha256='b'.repeat(64);diagnostic.sourcePath='x'.repeat(2001);assert.throws(()=>validateDocument(doc),/来源位置/);
});
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
