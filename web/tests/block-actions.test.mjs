import test from 'node:test';
import assert from 'node:assert/strict';
import {blockDeletion,isBlockDeleteKey} from '../public/editor/src/block-actions.mjs';
import {applyOperations,checkDocument} from '../lib/operations.mjs';
import {History} from '../public/editor/src/model.mjs';
const png='data:image/png;base64,AAAA';
const p=(id,text=id)=>({id,type:'paragraph',text});
const doc=blocks=>checkDocument({format:'open-typesetter',version:4,blocks});

test('all component types can be deleted, undone and redone, including the last component',()=>{
 for(const block of [p('p'),{id:'h',type:'heading',text:'Title'},{id:'i',type:'image',src:png},{id:'t',type:'table',rows:[['A']]},{id:'e',type:'equation',text:'x=1'},{id:'b',type:'pageBreak'}]){
  const before=doc([block]),history=new History();history.push(before);
  const after=blockDeletion(before,block.id).document;
  assert.equal(after.blocks.length,0);assert.equal(before.blocks.length,1);
  assert.deepEqual(history.undo(after),before);assert.deepEqual(history.redo(before),after);
 }
});
test('image deletion keeps captions by default, with explicit grouped deletion available',()=>{
 const before=doc([{id:'img',type:'image',src:png,captionIds:['zh','en']},p('zh','图1 实验'),p('en','Fig.1 Experiment')]);
 assert.deepEqual(blockDeletion(before,'img').document.blocks.map(b=>b.id),['zh','en']);
 assert.deepEqual(blockDeletion(before,'img',{includeCaptions:true}).document.blocks,[]);
 assert.deepEqual(blockDeletion(before,'zh').document.blocks[0].captionIds,['en']);
});
test('manual deletion detaches anchors without dropping images; Agent edits remain explicit',()=>{
 const before=doc([p('a'),p('b'),{id:'img',type:'image',src:png,width:40,wrap:'left',anchor:{targetId:'a',position:'before',maxPageDistance:1},sideTextIds:['a','b']}]);
 assert.throws(()=>applyOperations(before,[{op:'delete_blocks',blockIds:['a']}]));
 for(const after of [blockDeletion(before,'a').document]){
  const image=after.blocks.find(b=>b.id==='img');assert.equal(image.src,png);assert.equal(image.wrap,'none');assert.equal(image.anchor,undefined);assert.equal(image.sideTextIds,undefined);assert.ok(after.blocks.some(b=>b.id==='b'));
 }
});
test('cell image deletion unlinks only that image; deleting a table preserves image assets',()=>{
 const before=doc([{id:'grid',type:'table',rows:[['','']],cellImages:[{row:0,col:0,imageId:'a'},{row:0,col:1,imageId:'b'}],captionPosition:'below'},{id:'a',type:'image',src:png},{id:'b',type:'image',src:png}]);
 const one=blockDeletion(before,'a').document;assert.deepEqual(one.blocks[0].cellImages,[{row:0,col:1,imageId:'b'}]);
 const none=blockDeletion(one,'b').document;assert.equal(none.blocks[0].captionPosition,undefined);
 assert.deepEqual(blockDeletion(before,'grid').document.blocks.map(b=>b.id),['a','b']);
});
test('cross references in text, tables and notes block deletion atomically',()=>{
 for(const ref of [p('ref','See [[ref:target]]'),{id:'ref',type:'table',rows:[['[[ref:target]]']]}]){
  const before=doc([p('target'),ref]),copy=structuredClone(before);
  assert.throws(()=>blockDeletion(before,'target'),/仍引用此组件/);assert.deepEqual(before,copy);
 }
 const before=checkDocument({...doc([p('target')]),notes:[{id:'n',text:'[[ref:target]]'}]});
 assert.throws(()=>blockDeletion(before,'target'),/注释.*引用/);
});
test('deletion removes only associated comments/bookmarks; undo restores metadata',()=>{
 const before=checkDocument({...doc([p('a'),p('b')]),comments:[{id:'ca',blockId:'a',text:'review'}],bookmarks:[{blockId:'a',name:'A'}]});
 const after=blockDeletion(before,'a').document;assert.deepEqual(after.comments,[]);assert.deepEqual(after.bookmarks,[]);
 const history=new History();history.push(before);assert.deepEqual(history.undo(after),before);
});
test('held keys, composition and text-editing modifier combinations cannot repeat block deletion',()=>{
 assert.equal(isBlockDeleteKey({key:'Delete'}),true);
 for(const flag of ['repeat','isComposing','altKey','ctrlKey','metaKey','shiftKey'])assert.equal(isBlockDeleteKey({key:'Backspace',[flag]:true}),false);
});

test('undo restores the deleted component selection, redo restores the following selection',()=>{
 const before=doc([p('a'),p('b'),p('c')]),history=new History();history.push(before,'b');
 const removed=blockDeletion(before,'b');assert.equal(removed.selected,'c');
 assert.deepEqual(history.undo(removed.document,removed.selected),before);assert.equal(history.selection,'b');
 assert.deepEqual(history.redo(before,'b'),removed.document);assert.equal(history.selection,'c');
 // A second deletion after undo targets the restored block, never its neighbour.
 const restored=history.undo(removed.document,'c');
 assert.deepEqual(blockDeletion(restored,history.selection).document.blocks.map(b=>b.id),['a','c']);
});
test('selection history obeys limits and clears redo when a new edit is made',()=>{
 const history=new History(1),a=doc([p('a')]),b=doc([p('a'),p('b')]);history.push(a,'a');history.push(b,'b');
 assert.deepEqual(history.undo(a,'a'),b);assert.equal(history.selection,'b');assert.equal(history.undo(b,'b'),null);
 history.push(b,'b');assert.equal(history.redo(a,'a'),null);history.clear();assert.equal(history.selection,null);
});
