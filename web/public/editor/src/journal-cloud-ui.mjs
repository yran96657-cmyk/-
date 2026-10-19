import {documentFingerprint} from './project-sync.mjs';
import {showJournalReport} from './journal-report-ui.mjs';

export function setupJournalCloud({api,connection,getDoc,button,status}){
 const saveFile=(name,data,type)=>{const url=URL.createObjectURL(new Blob([data],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);};
 const key=(id=connection.projectId)=>`shuye-proof-${id}`;
 const picker=document.createElement('input');picker.type='file';picker.accept='.docx';picker.hidden=true;document.body.append(picker);
 button('导入期刊 Word',()=>picker.click());
 let importing=false;
 picker.onchange=async()=>{
  const file=picker.files[0];picker.value='';if(!file||importing)return;
  importing=true;const before=documentFingerprint(getDoc()),previousProject=connection.projectId;
  try{
   if(file.size>20*1024*1024)throw Error('DOCX 不得超过 20 MB');
   status('正在导入完整期刊稿件并核对公式、表格与编号…');
   const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
   const projectId='journal-'+crypto.randomUUID(),r=await api('import_journal_docx',{projectId,title:file.name.replace(/\.docx$/i,''),base64:btoa(binary)});
   if(connection.projectId!==previousProject||documentFingerprint(getDoc())!==before){status('期刊工程已保存到项目库。导入期间的新输入仍保留，请从项目库打开新工程。');return;}
   if(await connection.open(projectId)===false){status('期刊工程已保存到项目库。当前打开操作已被其他工程操作取代，请从项目库打开新工程。');return;}
   history.replaceState(null,'','?project='+projectId);
   const report=r.document.importReports[0],counts=report.counts;
   const errors=report.diagnostics?.filter(d=>d.severity==='error').length||0;
   const legacy=counts.sourceLegacyMath?`（含 ${counts.sourceLegacyMath} 个旧式公式）`:'';
   status(`已导入 ${counts.importedMath}/${counts.sourceMath} 个数学区${legacy}、${counts.importedImages}/${counts.sourceImages??'未知'} 张图。`+(errors?`有 ${errors} 项导入阻断，须修复后再交付；请查看预检报告。`:'请在“期刊模板”和右侧“期刊角色”指定首面字段。'),!!errors);
  }catch(e){status(e.message,true);}finally{importing=false;}
 };
 async function finish(proofId,projectId){
  let result=await api('get_journal_proof',{proofId});
  while(result.status==='running'){
   status('全文 PDF 正在排版；可继续编辑，完成后会检查校样是否过期。');
   await new Promise(resolve=>setTimeout(resolve,2000));result=await api('get_journal_proof',{proofId});
  }
  if(result.status==='failed')throw Error(result.error);
  if(result.projectId!==projectId||connection.projectId!==projectId)throw Error('已切换工程，校样保留在原工程中，请返回原工程取回。');
  if(result.stale||connection.dirty||connection.revision!==result.revision)throw Error('稿件已有新修改，本次校样已保留。请保存并重新生成，避免交付旧版。');
  const pdf=await api('download_journal_pdf',{proofId});
  if(connection.dirty||connection.projectId!==projectId||connection.revision!==pdf.revision)throw Error('下载期间文稿或工程已变化；校样已保留，请返回原工程保存后生成。');
  saveFile(`${getDoc().title}-全文校样.pdf`,Uint8Array.from(atob(pdf.base64),c=>c.charCodeAt(0)),'application/pdf');
  saveFile(`${getDoc().title}-校样报告.json`,JSON.stringify(result,null,2),'application/json');
  const errors=result.report.quality.diagnostics.filter(d=>d.severity==='error');
  status(`${result.pages} 页 PDF 和报告已下载；${result.report.formulaCoverage.total} 个数学区。${errors.length?`预检有 ${errors.length} 项阻断，请按报告修复。`:'请逐页核对公式和版面后交编辑验收。'}`,!!errors.length);
  showJournalReport(result);
 }
 button('全文期刊 PDF',async()=>{
  if(!connection.projectId)throw Error('请先保存到云端');
  await connection.save();if(connection.dirty)throw Error('保存期间有新输入，请再次保存后生成校样');
  const projectId=connection.projectId,proof=await api('start_journal_proof',{projectId,expectedRevision:connection.revision});
  try{localStorage.setItem(key(projectId),proof.proofId);}catch{}
  await finish(proof.proofId,projectId);
 });
 button('取回期刊校样',async()=>{const projectId=connection.projectId,proofId=localStorage.getItem(key());if(!proofId)throw Error('当前工程没有已记录的校样任务');await finish(proofId,projectId);});
}
