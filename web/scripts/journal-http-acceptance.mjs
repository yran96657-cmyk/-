// Public synthetic acceptance through the built server's authenticated MCP API.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {startServer} from '../.sites-runtime/standalone/server.mjs';
import {journalProfile} from '../tests/fixtures/journal-profile.mjs';
const dir=await mkdtemp(join(tmpdir(),'shuye-journal-http-'));
const origin='http://127.0.0.1:18818',password='synthetic-acceptance-only-2026';let app;
try{
 app=await startServer({directory:dir,publicDirectory:fileURLToPath(new URL('../.sites-runtime/standalone/public',import.meta.url)),origin,port:18818,bootstrapPassword:password,journal:{python:process.env.SHUYE_PYTHON||'python3'}});
 const login=await fetch(origin+'/shuye/login',{method:'POST',redirect:'manual',headers:{Origin:origin},body:new URLSearchParams({password})});assert.equal(login.status,303);
 const cookie=login.headers.get('set-cookie').split(';')[0];let id=0;
 async function call(name,args={}){
  const response=await fetch(origin+'/shuye/mcp',{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method:'tools/call',params:{name,arguments:args}})}),data=await response.json();
  assert.equal(response.status,200);if(data.error||data.result.isError)throw Error(JSON.stringify(data));return data.result.structuredContent;
 }
 const caps=await call('get_journal_capabilities');assert.equal(caps.enabled,true,JSON.stringify(caps));
 assert.equal(caps.environment.fonts.resolver,'XeLaTeX/fontspec');
 assert.equal(caps.environment.fonts.defaultCjkFontSet,process.env.SHUYE_FONTSET||'windows');
 assert.equal(caps.environment.fonts.profiles.cjk.fandol.available,true);
 const inspectBytes=(await readFile(new URL('../tests/fixtures/journal-complex.docx',import.meta.url))).toString('base64');
 const inspected=await call('inspect_journal_docx',{base64:inspectBytes});assert.equal(inspected.importable,true);assert.equal(inspected.importReports[0].counts.sourceMath,6);assert.equal((await call('list_projects')).projects.length,0);
 const imported=await call('import_journal_docx',{projectId:'synthetic',title:'期刊验收',base64:(await readFile(new URL('../tests/fixtures/journal-complex.docx',import.meta.url))).toString('base64')});
 assert.equal(imported.document.importReports[0].counts.sourceMath,6);assert.equal(imported.document.importReports[0].counts.importedMath,6);
 const saved=await call('replace_project',{projectId:'synthetic',expectedRevision:1,document:journalProfile(imported.document)});
 let proof=await call('start_journal_proof',{projectId:'synthetic',expectedRevision:saved.revision});const deadline=Date.now()+300000;
 while(proof.status==='running'&&Date.now()<deadline){await new Promise(r=>setTimeout(r,500));proof=await call('get_journal_proof',{proofId:proof.proofId});}
 assert.equal(proof.status,'complete',JSON.stringify(proof));
 assert.equal(proof.report.formulaCoverage.total,6);assert.equal(proof.report.formulaCoverage.sourceDisplayMathContainers,2);
 assert.deepEqual(proof.report.semanticLayout.sourceObjectCoverage.missing,[]);assert.equal(proof.report.semanticLayout.relations.length,2);assert.ok(proof.report.semanticLayout.relations.every(r=>r.status==='PASS'));
 assert.deepEqual(proof.report.compileMessages,[]);assert.deepEqual(proof.report.geometry.outside,[]);assert.ok(proof.report.fonts.every(f=>f.embedded));
 assert.deepEqual(proof.report.quality.diagnostics.filter(d=>d.severity==='error'),[]);
 const pdf=await call('download_journal_pdf',{proofId:proof.proofId});assert.equal(createHash('sha256').update(Buffer.from(pdf.base64,'base64')).digest('hex'),proof.pdfSha256);
 const page=await call('get_journal_proof_page',{proofId:proof.proofId,page:1});assert.ok(page.totalObjects>0);assert.ok(page.lines.length>0);
 await call('set_title',{projectId:'synthetic',expectedRevision:2,title:'修订后'});
 await assert.rejects(()=>call('download_journal_pdf',{proofId:proof.proofId}),/STALE_PROOF/);
 console.log(JSON.stringify({passed:true,pages:proof.pages,math:6,anchors:2,sourceObjects:proof.report.semanticLayout.sourceObjectCoverage.mapped,fontsEmbedded:true,staleRejected:true}));
}finally{if(app)await app.close();await rm(dir,{recursive:true,force:true});}
