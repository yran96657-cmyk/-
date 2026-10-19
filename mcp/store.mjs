import {documentDiagnostics} from '../src/integrity.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {checkDocument,applyOperations,outline} from './operations.mjs';
import {id} from './schema.mjs';
const MAX=100*1024*1024;
export class ProjectStore {
  constructor(root){fs.mkdirSync(root,{recursive:true});this.root=fs.realpathSync(root);for(const name of ['projects','artifacts']){const p=path.join(this.root,name);fs.mkdirSync(p,{recursive:true});if(fs.lstatSync(p).isSymbolicLink())throw Error('SYMLINK_NOT_ALLOWED');}}
  file(projectId){id.parse(projectId);if(fs.lstatSync(path.join(this.root,'projects')).isSymbolicLink())throw Error('SYMLINK_NOT_ALLOWED');return path.join(this.root,'projects',projectId+'.json');}
  read(projectId){const file=this.file(projectId);if(!fs.existsSync(file))throw Error('PROJECT_NOT_FOUND');const stat=fs.lstatSync(file);if(stat.isSymbolicLink()||!stat.isFile()||stat.size>MAX)throw Error('INVALID_PROJECT_FILE');const record=JSON.parse(fs.readFileSync(file,'utf8'));if(record.id!==projectId||!Number.isInteger(record.revision)||record.revision<1)throw Error('INVALID_PROJECT_RECORD');return record;}
  get(projectId){const {history,...record}=this.read(projectId);return {...record,document:checkDocument(record.document)};}
  summary(record){return {projectId:record.id,revision:record.revision,title:record.document.title,blockCount:record.document.blocks.length,updatedAt:record.updatedAt};}
  list(){return fs.readdirSync(path.join(this.root,'projects')).filter(n=>n.endsWith('.json')).map(n=>this.summary(this.read(n.slice(0,-5))));}
  locked(projectId,fn){const file=this.file(projectId),lock=file+'.lock';let handle;try{handle=fs.openSync(lock,'wx');}catch(e){if(e.code==='EEXIST')throw Error('PROJECT_BUSY: another writer holds the lock');throw e;}try{return fn(file);}finally{fs.closeSync(handle);fs.unlinkSync(lock);}}
  write(file,record){const data=JSON.stringify(record,null,2);if(Buffer.byteLength(data)>MAX)throw Error('PROJECT_TOO_LARGE');const tmp=file+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(tmp,data,{flag:'wx'});fs.renameSync(tmp,file);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}}
  create(projectId,raw){return this.locked(projectId,file=>{if(fs.existsSync(file))throw Error('PROJECT_EXISTS');const document=checkDocument(raw||{format:'open-typesetter',version:2,title:projectId,blocks:[]});const record={id:projectId,revision:1,updatedAt:new Date().toISOString(),document,history:[]};this.write(file,record);return this.summary(record);});}
  change(projectId,expectedRevision,fn,{dryRun=false}={}){return this.locked(projectId,file=>{
    const old=this.read(projectId);if(old.revision!==expectedRevision)throw Error(`REVISION_CONFLICT: expected ${expectedRevision}, actual ${old.revision}. Read again before retrying.`);
    const {document,createdIds=[]}=fn(checkDocument(old.document));const clean=checkDocument(document);
    // A full replacement must not erase the evidence of an earlier lossy import.
    for(const report of old.document.importReports||[])if(!clean.importReports.some(r=>isDeepStrictEqual(r,report)))throw Error('IMPORT_REPORT_REMOVAL: retain original import reports');
    const next={...old,document:clean,revision:old.revision+1,updatedAt:new Date().toISOString(),history:[...(old.history||[]),old.document].slice(-10)};
    if(!dryRun)this.write(file,next);
    return {...this.summary(dryRun?old:next),dryRun,createdIds,outline:outline(clean),diagnostics:documentDiagnostics(clean),visualPaginationChecked:false,...(dryRun?{preview:clean}:{})};
  });}
  edit(projectId,expectedRevision,operations,options){return this.change(projectId,expectedRevision,doc=>applyOperations(doc,operations),options);}
  replace(projectId,expectedRevision,document){return this.change(projectId,expectedRevision,()=>({document}));}
  undo(projectId,expectedRevision){return this.locked(projectId,file=>{const old=this.read(projectId);if(old.revision!==expectedRevision)throw Error('REVISION_CONFLICT');if(!old.history?.length)throw Error('NOTHING_TO_UNDO');const next={...old,revision:old.revision+1,updatedAt:new Date().toISOString(),document:checkDocument(old.history.at(-1)),history:old.history.slice(0,-1)};this.write(file,next);return this.summary(next);});}
  readArtifact(name){
    if(!/^[\w-]+\.json$/.test(name))throw Error('INVALID_ARTIFACT_NAME');
    const dir=path.join(this.root,'artifacts');if(fs.lstatSync(dir).isSymbolicLink())throw Error('SYMLINK_NOT_ALLOWED');
    const file=path.join(dir,name),stat=fs.lstatSync(file);
    if(stat.isSymbolicLink()||!stat.isFile()||stat.size>MAX)throw Error('INVALID_ARTIFACT_FILE');
    return JSON.parse(fs.readFileSync(file,'utf8'));
  }
  artifact(name,bytes){if(!/^[\w-]+\.(json|pdf)$/.test(name))throw Error('INVALID_ARTIFACT_NAME');if(fs.lstatSync(path.join(this.root,'artifacts')).isSymbolicLink())throw Error('SYMLINK_NOT_ALLOWED');const file=path.join(this.root,'artifacts',name);fs.writeFileSync(file,bytes,{flag:'wx'});return file;}
}
