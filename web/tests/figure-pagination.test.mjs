import test from 'node:test';
import assert from 'node:assert/strict';
import {paginate} from '../public/editor/src/pagination.mjs';

// Deterministic measured geometry exercises pagination decisions. Actual image
// decoding, font metrics and visual layout are checked in the browser as well.
class Element {
  constructor(tag){this.tag=tag;this.children=[];this.style={setProperty(){}};this.dataset={};this.value='';}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=nodes;}
  get firstChild(){return this.children[0];}
  set textContent(value){this.value=value;this.children=[];}
  get textContent(){return this.value+this.children.map(c=>c.textContent).join('');}
  getBoundingClientRect(){return {height:this.tag==='figure'?80:Math.max(20,Math.ceil(this.textContent.length/20)*20)};}
}
const paragraph=(id,text)=>({id,type:'paragraph',text});
const image={id:'img',type:'image',text:'',src:'data:image/png;base64,AAAA',captionIds:['zh','en']};
const layout={width:100,height:64,top:5,bottom:5,inner:5,outer:5,gap:5,columns:1,fontSize:10,lineHeight:1.5,pageStart:1};
function render(t,blocks,notes=[]){
  const previous=globalThis.document;
  globalThis.document={createElement:tag=>new Element(tag)};
  t.after(()=>{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;});
  return paginate({layout,blocks,notes},new Element('div'));
}
test('a figure and bilingual captions move together when the current page cannot fit them',t=>{
  const result=render(t,[paragraph('intro','x'.repeat(80)),image,paragraph('zh','图1 '+ 'x'.repeat(40)),paragraph('en','Fig.1 Test')]);
  assert.deepEqual(result.pages.map(p=>p.flat().map(part=>part.block.id)),[['intro'],['img','zh','en']]);
});
test('moving a figure after its caption neither duplicates nor drops its captions and footnotes',t=>{
  const result=render(t,[paragraph('intro','x'.repeat(80)),paragraph('zh','图1 Test [^n]'),image,paragraph('en','Fig.1 Test')],[{id:'n',text:'Source note'}]);
  assert.deepEqual(result.pages.map(p=>p.flat().map(part=>part.block.id)),[['intro'],['img','zh','en']]);
  assert.deepEqual(result.pageNotes,[[],['n']]);
});
test('an oversized figure group warns and preserves every caption character',t=>{
  const text='x'.repeat(600),result=render(t,[image,paragraph('zh',text),paragraph('en','Fig.1 Test')]);
  const parts=result.pages.flat(2);
  assert.equal(parts.filter(p=>p.block.id==='img').length,1);
  assert.equal(parts.filter(p=>p.block.id==='zh').map(p=>p.text).join(''),text);
  assert.equal(parts.filter(p=>p.block.id==='en').map(p=>p.text).join(''),'Fig.1 Test');
  assert.ok(result.warnings.some(w=>w.includes('图体和题注合计超过版心')));
});
