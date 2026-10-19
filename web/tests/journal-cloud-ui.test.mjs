import test from 'node:test';
import assert from 'node:assert/strict';
import {setupJournalCloud} from '../public/editor/src/journal-cloud-ui.mjs';

test('incomplete imports show the legacy equation denominator and an error state',async t=>{
 const picker={files:[{name:'synthetic.docx',size:1,arrayBuffer:async()=>new Uint8Array([0]).buffer}]},messages=[];
 const descriptors=['document','history'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]);
 t.after(()=>{for(const [key,d] of descriptors){if(d)Object.defineProperty(globalThis,key,d);else delete globalThis[key];}});
 globalThis.document={createElement:()=>picker,body:{append(){}}};globalThis.history={replaceState(){}};
 const doc={title:'Current',blocks:[]},connection={projectId:'current',open:async()=>true};
 setupJournalCloud({connection,getDoc:()=>doc,button(){},status:(message,error)=>messages.push({message,error}),api:async()=>({document:{importReports:[{counts:{sourceMath:378,importedMath:0,sourceLegacyMath:378,sourceImages:18,importedImages:2},diagnostics:[{severity:'error',message:'公式缺失'}]}]}})});
 await picker.onchange();assert.match(messages.at(-1).message,/0\/378.*378 个旧式公式.*2\/18.*阻断/);assert.equal(messages.at(-1).error,true);
});

test('a superseded journal import open cannot change the active project URL',async t=>{
 const picker={files:[{name:'synthetic.docx',size:1,arrayBuffer:async()=>new Uint8Array([0]).buffer}]};
 const urls=[],messages=[];
 const originalDocument=Object.getOwnPropertyDescriptor(globalThis,'document'),originalHistory=Object.getOwnPropertyDescriptor(globalThis,'history');
 t.after(()=>{for(const [key,descriptor] of [['document',originalDocument],['history',originalHistory]]){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
 globalThis.document={createElement:()=>picker,body:{append(){}}};
 globalThis.history={replaceState:(_state,_unused,url)=>urls.push(url)};
 const doc={title:'Current manuscript',blocks:[]};
 const connection={projectId:'current',open:async()=>false};
 setupJournalCloud({connection,getDoc:()=>doc,button(){},status:message=>messages.push(message),api:async()=>({document:{importReports:[{counts:{sourceMath:0,importedMath:0,importedImages:0}}]}})});
 await picker.onchange();
 assert.deepEqual(urls,[]);
 assert.match(messages.at(-1),/项目库/);
 assert.doesNotMatch(messages.at(-1),/^已导入/);
});
