// Node-only adapter. The browser/Workers bundle never imports child_process.
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,readdir,chmod} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {documentFingerprint} from '../public/editor/src/project-sync.mjs';
import {assertJournalFonts} from '../public/editor/src/journal-fonts.mjs';
import {createIssueStore} from './issue-store.mjs';
import {atomicJson as atomic} from './atomic-json.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const safeId=value=>{if(!/^[a-zA-Z0-9][\w-]{0,79}$/.test(value))throw Error('INVALID_PROOF_ID');return value;};

export async function createJournalRuntime({directory,python='python3',engineDirectory=fileURLToPath(new URL('../journal-engine/',import.meta.url)),env={},timeoutMs=300000,maxProofs=200}={}){
 const root=resolve(directory);await mkdir(root,{recursive:true,mode:0o700});await chmod(root,0o700);
 let busy=false,closing=false,active=null;const tasks=new Set();
 // Startup recovery is scoped to this runtime's private owner/job directories.
 for(const owner of await readdir(root,{withFileTypes:true}))if(owner.isDirectory()&&/^[a-f0-9]{64}$/.test(owner.name)){
  for(const id of await readdir(join(root,owner.name),{withFileTypes:true}))if(id.isDirectory()&&/^proof-[\w-]+$/.test(id.name)){
   const path=join(root,owner.name,id.name,'status.json');
   try{const m=JSON.parse(await readFile(path));if(m.status==='running')await atomic(path,{...m,status:'failed',error:'WORKER_INTERRUPTED_RETRY'});}catch(e){if(e.code!=='ENOENT')throw e;}
  }
 }
 const folder=(owner,id)=>join(root,sha(owner),safeId(id));
 function reserve(){if(closing||busy)throw Error('JOURNAL_WORKER_BUSY_RETRY');busy=true;}
 function track(task){tasks.add(task);task.finally(()=>{tasks.delete(task);busy=false;}).catch(()=>{});return task;}
 async function worker(request){
  if(closing)throw Error('JOURNAL_WORKER_CLOSED');
  try{return await new Promise((ok,fail)=>{
   const child=spawn(python,[join(resolve(engineDirectory),'worker.py')],{env:{...process.env,...env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'},stdio:['pipe','pipe','pipe'],detached:process.platform!=='win32'});
   let stdout=[],stderr=[],n=0,stderrSize=0,killed=false;
   const kill=()=>{killed=true;try{if(process.platform==='win32')child.kill('SIGKILL');else process.kill(-child.pid,'SIGKILL');}catch{}};
   active=kill;const timer=setTimeout(kill,request.method==='render_issue'?Math.max(timeoutMs,900000):timeoutMs);
   child.stdout.on('data',c=>{n+=c.length;if(n>30*1024*1024)kill();else stdout.push(c);});
   child.stderr.on('data',c=>{if(stderrSize<8000){stderr.push(c.subarray(0,8000-stderrSize));stderrSize+=c.length;}});
   child.on('error',e=>{clearTimeout(timer);fail(Error('JOURNAL_RUNTIME_UNAVAILABLE: '+e.message));});
   child.on('close',code=>{clearTimeout(timer);if(killed){fail(Error(closing?'WORKER_INTERRUPTED_RETRY':'JOURNAL_WORKER_TIMEOUT_OR_LIMIT'));return;}
    let result;try{result=JSON.parse(Buffer.concat(stdout).toString('utf8'));}catch{fail(Error('JOURNAL_WORKER_FAILED: '+Buffer.concat(stderr).toString('utf8').slice(-2000)));return;}
    if(code||result.error)fail(Error(result.error||'JOURNAL_WORKER_FAILED'));else ok(result);
   });
   child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(request));
  });}finally{active=null;}
 }
 async function status(owner,id){return JSON.parse(await readFile(join(folder(owner,id),'status.json')).catch(e=>{if(e.code==='ENOENT')throw Error('PROOF_NOT_FOUND');throw e;}));}
 const capabilities={enabled:false,engine:'XeLaTeX',asynchronousProof:true,scope:'complete-journal-document'};
 // Misconfigured native output is explicitly unavailable; the editor still opens.
 try{const environment=await worker({method:'probe'});Object.assign(capabilities,{environment,issue:environment.issue,enabled:true});}catch(e){capabilities.reason=e.message;}
 function ready(){if(!capabilities.enabled)throw Error('JOURNAL_RUNTIME_UNAVAILABLE: '+capabilities.reason);reserve();}
 return {
  capabilities,
  issues:createIssueStore(root),
  async importDocx(base64,revisionPolicy='require-clean'){ready();return track(worker({method:'import',base64,revisionPolicy}));},
  async inspectDocx(base64,revisionPolicy='require-clean'){ready();return track(worker({method:'inspect',base64,revisionPolicy}));},
  start(owner,record,kind='article'){
   for(const document of kind==='issue'?record.document.articles.map(a=>a.document):[record.document])assertJournalFonts(document,capabilities.environment?.fonts);
   if(kind==='issue'&&capabilities.issue?.enabled===false)throw Error(capabilities.issue.reason||'WORD_RUNTIME_UNAVAILABLE');
   // Reserve before any filesystem await: simultaneous requests cannot both start.
   ready();let resolveStart,rejectStart;
   const started=new Promise((resolve,reject)=>{resolveStart=resolve;rejectStart=reject;});
   track((async()=>{
    let meta,dir;
    try{
     const {projectId,revision,document}=structuredClone(record);
     if(Buffer.byteLength(JSON.stringify(document))>28*1024*1024)throw Error('ISSUE_SOURCE_LIMIT_28_MB');
     const sourceDocumentSha256=sha(documentFingerprint(document));
     const parent=join(root,sha(owner));await mkdir(parent,{recursive:true,mode:0o700});
     const ids=await readdir(parent);if(ids.length>=maxProofs)throw Error('JOURNAL_PROOF_STORAGE_LIMIT');
     const id='proof-'+randomUUID();dir=folder(owner,id);
     await mkdir(dir,{mode:0o700});
     meta={proofId:id,projectId,revision,sourceDocumentSha256,kind,...(kind==='issue'?{sourceArticles:document.articles.map(({projectId,revision,document})=>({projectId,revision,sha256:sha(documentFingerprint(document))}))}:{}),status:'running',createdAt:new Date().toISOString()};
     await writeFile(join(dir,'document.json'),JSON.stringify(document),{mode:0o600});await atomic(join(dir,'status.json'),meta);
     resolveStart(meta);
     const result=await worker({method:kind==='issue'?'render_issue':'render',document,directory:dir,revision,sourceDocumentSha256});
     await atomic(join(dir,'status.json'),{...meta,...result,status:'complete'});
    }catch(error){
     rejectStart(error);
     if(meta)await atomic(join(dir,'status.json'),{...meta,status:'failed',error:error.message});
    }
   })());
   return started;
  },
  status,
  async latestIssueProof(owner,issueId){
   const parent=join(root,sha(owner));let ids;try{ids=await readdir(parent);}catch(e){if(e.code==='ENOENT')return null;throw e;}
   let latest=null;for(const id of ids.filter(id=>/^proof-[\w-]+$/.test(id))){const m=await status(owner,id);if(m.kind==='issue'&&m.projectId===issueId&&(!latest||m.createdAt>latest.createdAt))latest=m;}
   return latest?.proofId||null;
  },
  async artifact(owner,id,artifactId,offset,limit){
   const m=await status(owner,id);if(m.status!=='complete')throw Error('PROOF_NOT_COMPLETE');
   const a=m.artifacts?.find(a=>a.id===artifactId);if(!a||!/^[\w.-]+$/.test(a.filename))throw Error('ARTIFACT_NOT_FOUND');
   const bytes=await readFile(join(folder(owner,id),a.filename));if(sha(bytes)!==a.sha256)throw Error('ARTIFACT_HASH_MISMATCH');
   if(offset>bytes.length)throw Error('INVALID_OFFSET');const end=Math.min(bytes.length,offset+limit);
   return {...a,totalBytes:bytes.length,offset,nextOffset:end,done:end===bytes.length,base64:bytes.subarray(offset,end).toString('base64')};
  },
  async report(owner,id){
   const m=await status(owner,id);if(m.status!=='complete')throw Error('PROOF_NOT_COMPLETE');
   const bytes=await readFile(join(folder(owner,id),'report.json'));
   if(!m.reportSha256||sha(bytes)!==m.reportSha256)throw Error('REPORT_HASH_MISMATCH');
   return JSON.parse(bytes);
  },
  async pdf(owner,id){
   const m=await status(owner,id);if(m.status!=='complete')throw Error('PROOF_NOT_COMPLETE');
   const bytes=await readFile(join(folder(owner,id),'proof.pdf'));
   if(sha(bytes)!==m.pdfSha256)throw Error('PROOF_HASH_MISMATCH');
   if(bytes.length>20*1024*1024)throw Error('PDF_RESPONSE_LIMIT_20_MB');return bytes.toString('base64');
  },
  async close(){closing=true;active?.();await Promise.allSettled([...tasks]);}
 };
}
