import test from 'node:test';
import assert from 'node:assert/strict';
import {journalFileArguments} from '../public/editor/src/journal-file.mjs';
test('Word import preserves bytes across chunks and defaults to clean revisions',async()=>{
 const bytes=Uint8Array.from({length:17005},(_,i)=>i%256),file={name:'论文.DOC',size:bytes.length,arrayBuffer:async()=>bytes.buffer};
 const result=await journalFileArguments(file);assert.equal(result.title,'论文');assert.equal(result.revisionPolicy,'require-clean');assert.deepEqual(Buffer.from(result.base64,'base64'),Buffer.from(bytes));
 assert.equal((await journalFileArguments(file,'accept')).revisionPolicy,'accept');
});
test('unsupported, empty and oversized imports fail before reading bytes',async()=>{
 const file={name:'a.docx',size:1,arrayBuffer:()=>{throw Error('must not read');}};
 for(const patch of [{name:'a.pdf'},{size:0},{size:20*1024*1024+1}])await assert.rejects(journalFileArguments({...file,...patch}),/请选择|为空|20 MB/);
});
