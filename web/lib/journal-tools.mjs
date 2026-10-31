import {z} from 'zod/v4';
import {id} from './schema.mjs';
import {documentDiagnostics} from '../public/editor/src/integrity.mjs';
import {journalPlan} from './journal-plan.mjs';
import {journal as journalSchema} from './schema.mjs';
import {journalRoles} from '../public/editor/src/journal.mjs';
const obj=s=>z.object(s).strict();
export function addJournalTools(add,store){
 const runtime=()=>{if(!store?.journalRuntime)throw Error('JOURNAL_RUNTIME_UNAVAILABLE: 请为独立服务器配置 Python 和 XeLaTeX');return store.journalRuntime;};
 const proofArgs={proofId:id};
 async function refreshProof(m){const current=await store.get(m.projectId);return {...m,stale:current.revision!==m.revision};}
 async function getProof(a){return refreshProof(await runtime().status(store.owner,a.proofId));}
 add('get_journal_capabilities','查询当前部署是否启用真实 OMML 导入和全文期刊 PDF。',obj({}),()=>store?.journalRuntime?.capabilities||{enabled:false,reason:'需配置独立服务器的 journal 运行时；Workers 不支持本地 TeX。'},true);
 add('inspect_journal_docx','只读检查 DOCX 是否能完整导入。返回公式/图表数量、每个未支持对象的原稿 XML 位置和资产指纹；不创建工程，不执行 OLE，不表示可发印。',obj({revisionPolicy:z.enum(['require-clean','accept']).default('require-clean'),base64:z.string().max(28000000).regex(/^[A-Za-z0-9+/]+={0,2}$/)}),a=>runtime().inspectDocx(a.base64,a.revisionPolicy),true);
 add('plan_journal_layout','生成可审查的期刊自动排版操作：首面角色、真实章节、图表与原始像素 DPI 约束。不改动原文；返回源修订，使用 apply_changes dryRun 后原子提交。未识别角色由 roles 明确覆盖。',obj({projectId:id,profile:z.enum(['compact-academic']).optional(),width:z.number().min(100).max(320).optional(),height:z.number().min(140).max(450).optional(),columns:z.number().int().min(1).max(4).optional(),minDpi:z.number().min(150).max(1200).default(300),roles:z.record(id,z.enum(journalRoles)).default({}),journal:journalSchema.optional()}),async a=>{const r=await store.get(a.projectId);return {projectId:r.projectId,expectedRevision:r.revision,...journalPlan(r.document,a)};},true);
 add('import_journal_docx','从 Word 新建完整期刊工程；保存每个公式的 OMML 和摘要，未支持内容拒绝写入。revisionPolicy=accept 明确接受全部修订；默认遇到修订拒绝导入。不会覆盖现有工程。',obj({projectId:id,title:z.string().max(120),base64:z.string().max(28000000).regex(/^[A-Za-z0-9+/]+={0,2}$/),revisionPolicy:z.enum(['require-clean','accept']).default('require-clean')}),async a=>{
  const parsed=await runtime().importDocx(a.base64,a.revisionPolicy);
  return store.create(a.projectId,{format:'open-typesetter',version:4,title:a.title,blocks:parsed.blocks,notes:parsed.notes,importReports:parsed.importReports});
 });
 add('start_journal_proof','为指定修订启动全文 PDF 校样。异步执行；通过 get_journal_proof 查询，支持恢复连接。首面、公式、表格和锚点使用同一源工程；自由版面混排拒绝遗漏。',obj({projectId:id,expectedRevision:z.number().int().positive()}),async a=>{
  const record=await store.get(a.projectId);if(record.revision!==a.expectedRevision)throw Error('REVISION_CONFLICT');
  if(!record.document.journal)throw Error('JOURNAL_TEMPLATE_REQUIRED');
  if(record.document.composition)throw Error('JOURNAL_PDF_COMPOSITION_NOT_SUPPORTED');
  const errors=documentDiagnostics(record.document).filter(d=>d.severity==='error');if(errors.length)throw Error('JOURNAL_PREFLIGHT: '+errors.map(d=>d.message).join('; '));
  return runtime().start(store.owner,record);
 });
 add('get_journal_proof','查询校样状态、源修订和 PDF 摘要；已完成时返回预检报告，不返回大段页面坐标。stale=true 表示文稿已有新修订。',obj(proofArgs),async a=>{
  const m=await getProof(a);if(m.status!=='complete')return m;
  const report=await runtime().report(store.owner,a.proofId);const {geometry,semanticLayout,...summary}=report;
  return {...await refreshProof(m),report:{...summary,geometry:{status:geometry.status,characters:geometry.characters,outside:geometry.outside},semanticLayout:{...semanticLayout,objects:undefined}}};
 },true);
 add('get_journal_proof_page','读取实际 PDF 页的公式/图表/正文对象坐标和文字边界；页码是物理页，稳定 ID 对应源工程。',obj({...proofArgs,page:z.number().int().min(1).max(2000),offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(200).default(100)}),async a=>{
  const m=await getProof(a),report=await runtime().report(store.owner,a.proofId),page=report.geometry.pages[a.page-1];if(!page)throw Error('PROOF_PAGE_NOT_FOUND');
  const objects=Object.entries(report.semanticLayout.objects).filter(([,v])=>v.start?.page<=a.page&&v.end?.page>=a.page).map(([id,value])=>({id,...value}));
  return {...await refreshProof(m),page:a.page,widthPt:page.widthPt,heightPt:page.heightPt,totalLines:page.lines.length,totalObjects:objects.length,lines:page.lines.slice(a.offset,a.offset+a.limit),objects:objects.slice(a.offset,a.offset+a.limit)};
 },true);
 add('download_journal_pdf','下载已完成的校样及其绑定摘要。默认拒绝过期校样；允许旧版须明确 acknowledgeStale。质量阻断仍可下载审校，不表示发印通过。',obj({...proofArgs,acknowledgeStale:z.boolean().default(false)}),async a=>{
  const m=await getProof(a);if(m.stale&&!a.acknowledgeStale)throw Error('STALE_PROOF');
  const base64=await runtime().pdf(store.owner,a.proofId);
  // Artifact I/O can overlap an agent/browser save. Check after the last read.
  const current=await refreshProof(m);if(current.stale&&!a.acknowledgeStale)throw Error('STALE_PROOF');
  return {...current,mimeType:'application/pdf',base64};
 },true);
}
