import test from 'node:test';
import assert from 'node:assert/strict';
import {setupReview} from '../public/editor/src/review-ui.mjs';

test('multiline comments use an accessible in-page composer and retain their original target',t=>{
 const old=globalThis.document;t.after(()=>{if(old)globalThis.document=old;else delete globalThis.document;});
 const nodes=[];
 const element=tag=>{const n={tag,children:[],textContent:'',value:'',attributes:{},append(...x){this.children.push(...x);},replaceChildren(...x){this.children=x;},setAttribute(k,v){this.attributes[k]=v;},focus(){},showModal(){},close(){this.onclose?.();},remove(){}};nodes.push(n);return n;};
 const toolbar=element('div');globalThis.document={createElement:element,querySelector:()=>toolbar,body:element('body')};
 const doc={blocks:[{id:'fig',text:''},{id:'body',text:'原文'}],comments:[],bibliography:[]};let selected='fig';
 setupReview({getDoc:()=>doc,getSelected:()=>selected,change:fn=>fn(),status:()=>{}});
 nodes.find(n=>n.textContent==='审阅批注').onclick();nodes.find(n=>n.textContent==='为当前组件添加批注').onclick();
 const form=nodes.find(n=>n.tag==='form'),draft=nodes.find(n=>n.attributes['aria-label']==='新增批注内容'),event={preventDefault(){}};
 draft.value=' ';form.onsubmit(event);assert.equal(doc.comments.length,0);
 selected='body';draft.value='源图需复核\n<img src=x onerror=alert(1)>';form.onsubmit(event);
 assert.equal(doc.comments.length,1);assert.equal(doc.comments[0].blockId,'fig');assert.equal(doc.comments[0].resolved,false);assert.equal(doc.comments[0].text,'源图需复核\n<img src=x onerror=alert(1)>');assert.equal(form.hidden,true);
});
