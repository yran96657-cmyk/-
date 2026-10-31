import {documentFingerprint} from './project-sync.mjs';
import {showJournalReport} from './journal-report-ui.mjs';
import {ProofSession} from './proof-session.mjs';
import {figureDiagnostics} from './figure-audit.mjs';
import {journalFileArguments} from './journal-file.mjs';

export function setupJournalCloud({api,connection,getDoc,button,status}){
 const saveFile=(name,data,type)=>{const url=URL.createObjectURL(new Blob([data],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);};
 const key=(id=connection.projectId)=>`shuye-proof-${id}`;
 const proofs=new ProofSession({api,connection,readId:id=>{try{return localStorage.getItem(key(id));}catch{return null;}},writeId:(id,value)=>{try{localStorage.setItem(key(id),value);}catch{}},onChange:()=>document.dispatchEvent?.(new Event('shuye:proof-changed'))});
 let trackedProject=connection.projectId;
 document.addEventListener?.('shuye:connection-changed',()=>{if(trackedProject!==connection.projectId){trackedProject=connection.projectId;proofs.refresh().catch(()=>{});}});
 proofs.refresh().catch(()=>{});
 const picker=document.createElement('input');picker.type='file';picker.accept='.doc,.docx';picker.hidden=true;document.body.append(picker);
 const importButton=button('导入期刊 Word',()=>picker.click());
 const revisionPolicy=document.createElement('select');revisionPolicy.ariaLabel='Word 修订导入策略';
 revisionPolicy.innerHTML='<option value="require-clean">有未确认修订时停止</option><option value="accept">接受全部修订，保留最终版本</option>';
 revisionPolicy.value='require-clean';importButton?.after(revisionPolicy);
 let importing=false;
 picker.onchange=async()=>{
  const file=picker.files[0];picker.value='';if(!file||importing)return;
  importing=true;const before=documentFingerprint(getDoc()),previousProject=connection.projectId;
  try{
   status('正在导入完整期刊稿件并核对公式、表格与编号…');
   const args=await journalFileArguments(file,revisionPolicy.value||'require-clean');
   const projectId='journal-'+crypto.randomUUID(),r=await api('import_journal_docx',{projectId,...args});
   if(connection.projectId!==previousProject||documentFingerprint(getDoc())!==before){status('期刊工程已保存到项目库。导入期间的新输入仍保留，请从项目库打开新工程。');return;}
   if(await connection.open(projectId)===false){status('期刊工程已保存到项目库。当前打开操作已被其他工程操作取代，请从项目库打开新工程。');return;}
   history.replaceState(null,'','?project='+projectId);
   const report=r.document.importReports[0],counts=report.counts;
   const errors=report.diagnostics?.filter(d=>d.severity==='error').length||0;
   const missing=figureDiagnostics({...r.document,blocks:r.document.blocks||[]}).filter(d=>d.severity==='error').length;
   const legacy=counts.sourceLegacyMath?`（含 ${counts.sourceLegacyMath} 个旧式公式）`:'';
   const message=`已导入 ${counts.importedMath}/${counts.sourceMath} 个数学区${legacy}、${counts.importedImages}/${counts.sourceImages??'未知'} 张图。`+(missing?`缺少 ${missing} 张图体，请在纸面上方逐一补图。`:'可交给 Agent 整理为学术期刊。')+(errors?`另有 ${errors} 项导入阻断，请查看预检报告。`:'');
   status(message,!!(errors||missing));
   document.dispatchEvent(new CustomEvent('shuye:notice',{detail:{message,tone:errors?'error':'info'}}));
  }catch(e){status(e.message,true);}finally{importing=false;}
 };
 button('自动排版期刊',async()=>{
  if(!connection.projectId)throw Error('请先保存到云端');
  if(connection.dirty)await connection.save();if(connection.dirty)throw Error('保存期间有新输入，请再次保存后排版');
  const projectId=connection.projectId,revision=connection.revision;
  const plan=await api('plan_journal_layout',{projectId});
  if(plan.expectedRevision!==revision)throw Error('REVISION_CONFLICT');
  const unresolved=plan.diagnostics.filter(d=>d.severity==='error');if(unresolved.length)throw Error(unresolved.map(d=>d.message).join('；'));
  await api('apply_changes',{projectId,expectedRevision:revision,operations:plan.operations,dryRun:true});
  if(connection.dirty||connection.projectId!==projectId)throw Error('排版期间有新修改，已保留当前文稿，请保存后重试');
  await api('apply_changes',{projectId,expectedRevision:revision,operations:plan.operations});
  if(connection.dirty||connection.projectId!==projectId){status('自动排版已保存到云端；当前新输入仍保留，请先备份后打开云端版本。');return;}
  await connection.open(projectId);status('已应用期刊排版方案。请生成全文 PDF 检查实际页面和预检结果。');
 });
 async function finish(proofId,projectId){
  let result=await api('get_journal_proof',{proofId});
  while(result.status==='running'){
   status('全文 PDF 正在排版；可继续编辑，完成后会检查校样是否过期。');
   await new Promise(resolve=>setTimeout(resolve,2000));result=await api('get_journal_proof',{proofId});
  }
  proofs.remember(result);
  if(result.status==='failed')throw Error(result.error);
  if(result.projectId!==projectId||connection.projectId!==projectId)throw Error('已切换工程，校样保留在原工程中，请返回原工程取回。');
  if(result.stale||connection.dirty||connection.revision!==result.revision)throw Error('稿件已有新修改，本次校样已保留。请保存并重新生成，避免交付旧版。');
  const pdf=await api('download_journal_pdf',{proofId});
  if(connection.dirty||connection.projectId!==projectId||connection.revision!==pdf.revision)throw Error('下载期间文稿或工程已变化；校样已保留，请返回原工程保存后生成。');
  const bytes=Uint8Array.from(atob(pdf.base64),c=>c.charCodeAt(0)),title=getDoc().title;
  const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
  const errors=result.report.quality.diagnostics.filter(d=>d.severity==='error');
  status(`${result.pages} 页 PDF 已生成；${result.report.formulaCoverage.total} 个数学区。${errors.length?`预检有 ${errors.length} 项阻断，请按报告修复。`:'请打开校样核对实际版面。'}`,!!errors.length);
  const checkCurrent=async()=>{
   const local=()=>{if(connection.dirty||connection.writing||connection.projectId!==projectId||connection.revision!==result.revision)throw Error('文稿已变化，请关闭报告并重新生成校样。');};
   local();const latest=await api('get_journal_proof',{proofId});local();
   if(latest.stale||latest.status!=='complete'||latest.projectId!==projectId||latest.revision!==result.revision||latest.pdfSha256!==result.pdfSha256)throw Error('校样已过期，请关闭报告并重新生成校样。');
  };
  const dialog=showJournalReport(result,{
   openPdf:async()=>{
    // Reserve the browsing context during the click, before asynchronous checks.
    const tab=window.open('about:blank','_blank');if(tab)tab.opener=null;
    try{await checkCurrent();if(tab)tab.location.replace(url);else saveFile(`${title}-全文校样.pdf`,bytes,'application/pdf');}catch(e){tab?.close();throw e;}
   },
   downloadPdf:async()=>{await checkCurrent();saveFile(`${title}-全文校样.pdf`,bytes,'application/pdf');},
   downloadReport:async()=>{await checkCurrent();saveFile(`${title}-校样报告.json`,JSON.stringify(result,null,2),'application/json');},
   editJournal:()=>document.dispatchEvent(new Event('shuye:edit-journal')),
   locateBlock:blockId=>document.dispatchEvent(new CustomEvent('shuye:locate-block',{detail:{blockId}}))
  });
  dialog.addEventListener('close',()=>setTimeout(()=>URL.revokeObjectURL(url),60000),{once:true});
  return result;

 }
 const prepareProof=async()=>{
  if(!connection.projectId)throw Error('请先保存到云端');
  if(connection.dirty)await connection.save();if(connection.dirty)throw Error('保存期间有新输入，请再次保存后生成校样');
  const projectId=connection.projectId;
  await proofs.refresh();
  if(projectId!==connection.projectId||connection.dirty)throw Error('文稿已变化，请保存后重新生成校样');
  if(['ready','running'].includes(proofs.state))return finish(proofs.proof.proofId,projectId);
  const proof=await api('start_journal_proof',{projectId,expectedRevision:connection.revision});
  proofs.remember(proof);
  return finish(proof.proofId,projectId);
 };
 let proofRequest;
 const generateProof=()=>{if(!proofRequest)proofRequest=prepareProof().finally(()=>{proofRequest=null;});return proofRequest;};
 button('全文期刊 PDF',generateProof);
 button('取回期刊校样',async()=>{const projectId=connection.projectId,proofId=localStorage.getItem(key());if(!proofId)throw Error('当前工程没有已记录的校样任务');await finish(proofId,projectId);});
 return {generateProof,proofState:()=>proofs.state,rememberProof:proof=>proofs.remember(proof),reviewProof:finish};
}
