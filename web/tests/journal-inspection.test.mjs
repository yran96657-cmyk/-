import test from 'node:test';
import assert from 'node:assert/strict';
import {callTool} from '../lib/cloud-tools.mjs';

test('DOCX inspection returns unsupported-object evidence without creating a project',async()=>{
 const result={importable:false,importReports:[{counts:{sourceMath:378,importedMath:0},diagnostics:[{code:'DOCX_LEGACY_MATH',severity:'error',message:'旧式公式未导入',sourcePath:'/document[1]/body[1]/p[1]/object[1]'}]}]};
 let calls=0;const store={journalRuntime:{inspectDocx:async b=>{assert.equal(b,'AA==');calls++;return result;}},create(){assert.fail('Inspection must not create a project');}};
 assert.deepEqual(await callTool(store,'inspect_journal_docx',{base64:'AA=='}),result);assert.equal(calls,1);
 await assert.rejects(()=>callTool(store,'inspect_journal_docx',{base64:'not-base64'}));assert.equal(calls,1);
});
