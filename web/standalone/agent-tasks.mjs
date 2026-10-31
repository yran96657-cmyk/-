// Persistent, bounded orchestration. All edits use the same revision-checked tools
// as external MCP clients. The model never receives executable tool names.
import {mkdir,readdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {documentDiagnostics} from '../public/editor/src/integrity.mjs';
import {journalFontProblems} from '../public/editor/src/journal-fonts.mjs';
import {documentFingerprint} from '../public/editor/src/project-sync.mjs';
const hash=value=>createHash('sha256').update(typeof value==='string'?value:documentFingerprint(value)).digest('hex');
const now=()=>new Date().toISOString();
const sleep=(ms,signal)=>new Promise(resolve=>{const finish=()=>{clearTimeout(timer);signal?.removeEventListener('abort',finish);resolve();};const timer=setTimeout(finish,ms);signal?.addEventListener('abort',finish,{once:true});if(signal?.aborted)finish();});
const recoverable=new Set(['INTERRUPTED','CANCELLED','ASSISTANT_BUSY_RETRY','JOURNAL_WORKER_BUSY_RETRY','MODEL_SERVICE_ERROR','MODEL_SERVICE_UNAVAILABLE','WORKER_INTERRUPTED_RETRY','MODEL_INCOMPLETE_RESPONSE','MODEL_TIMEOUT','PROOF_FAILED','TASK_TIMEOUT']);
const currentRevision=t=>t.undoneRevision||t.appliedRevision||t.revision;
const fields=['taskId','projectId','requestId','goal','mode','revision','status','stage','createdAt','updatedAt','finishedAt','attempt','events','planId','changes','model','preparation','appliedRevision','undoneRevision','proofId','proof','context','issue','sourceSha256','resultSha256','review'];
function issue(code,message,details){return {code,message,...(details?{details}:{}),retryable:recoverable.has(code)};}
function taskError(code,message,details){return Object.assign(Error(message||code),{taskIssue:issue(code,message||code,details)});}

export async function createAgentTasks({directory,invoke,pollMs=400,timeoutMs=480000,maxTasks=1000}){
 await mkdir(directory,{recursive:true,mode:0o700});
 const index=new Map(),active=new Map(),locks=new Set();let closing=false,starting=false;
 const path=id=>{if(!/^[a-f0-9-]{36}$/.test(id))throw Error('TASK_NOT_FOUND');return join(directory,id+'.json');};
 async function save(t){t.updatedAt=now();const file=path(t.taskId),tmp=file+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(t),{mode:0o600,flag:'wx'});await rename(tmp,file);index.set(t.taskId,structuredClone(t));}
 for(const file of await readdir(directory))if(/^[a-f0-9-]{36}\.json$/.test(file)){
  const t=JSON.parse(await readFile(join(directory,file),'utf8'));index.set(t.taskId,t);
  if(t.status==='running'){t.status='needs_attention';t.issue=issue(t.stage==='committing'?'COMMIT_OUTCOME_UNKNOWN':'INTERRUPTED',t.stage==='committing'?'服务在提交时中断，请核对当前版本后新建任务。':'服务已重启，可从保留的步骤继续。');await save(t);}
 }
 async function load(store,{projectId,taskId}){
  const stored=index.get(taskId);if(!stored||stored.ownerHash!==hash(store.owner)||stored.projectId!==projectId)throw Error('TASK_NOT_FOUND');
  return {t:structuredClone(stored),current:await store.status(projectId)};
 }
 function publicTask(t,current){
  const stale=current.revision!==currentRevision(t),running=active.has(t.taskId)||t.status==='running';
  return {...Object.fromEntries(fields.filter(k=>t[k]!==undefined).map(k=>[k,t[k]])),currentRevision:current.revision,stale,
   actions:{cancel:running,resume:!running&&!stale&&['cancelled','needs_attention'].includes(t.status)&&!!t.issue?.retryable,undo:!running&&!stale&&!!t.appliedRevision&&!!t.resultSha256&&!t.undoneRevision,review:!stale&&t.proof?.status==='complete'&&t.proof.revision===current.revision,accept:!running&&!stale&&t.status==='review'&&t.proof?.revision===current.revision},
   nextAction:stale?'inspect_current_version':running?'poll_task':t.status==='review'?'review_proof':t.issue?.retryable?'resume_or_undo':['undone','accepted'].includes(t.status)?'start_new_task':'resolve_issue'};
 }
 async function event(t,step,label,detail){t.stage=step;t.events.push({sequence:t.events.length+1,step,label,at:now(),...(detail?{detail}:{})});await save(t);}
 async function verify(store,t){const c=await store.get(t.projectId);if(c.revision!==currentRevision(t)||hash(c.document)!==(t.appliedRevision?t.resultSha256:t.sourceSha256))throw taskError('REVISION_CONFLICT','文稿已由人或其他 Agent 修改，本任务停止。请查看当前版本后重新下达任务。');return c;}
 function launch(store,t){
  const controller=new AbortController(),slot={controller,done:null};active.set(t.taskId,slot);
  slot.done=execute(store,t,controller.signal).finally(()=>active.delete(t.taskId));slot.done.catch(()=>{});
 }
 async function execute(store,t,signal){
  const deadline=Date.now()+timeoutMs;
  const checkpoint=()=>{if(signal.aborted)throw taskError(closing?'INTERRUPTED':'CANCELLED',closing?'服务已停止，可继续保留的任务。':'已停止后续步骤；已保存的修改和校样仍保留。');if(Date.now()>deadline)throw taskError('TASK_TIMEOUT','任务超过运行时限，可继续保留的步骤。');};
  const args=()=>({projectId:t.projectId,planId:t.planId});
  const checkRevision=async()=>{if((await store.status(t.projectId)).revision!==currentRevision(t))throw taskError('REVISION_CONFLICT','文稿已由人或其他 Agent 修改，本任务停止。请查看当前版本后重新下达任务。');};
  // Resource-busy responses are emitted before a producer creates a job, so
  // retrying them is safe. Ambiguous transport/write errors are never replayed.
  const available=async(name,args,step)=>{let announced=false;for(;;){checkpoint();try{return await invoke(store,name,args);}catch(e){if(!['ASSISTANT_BUSY_RETRY','JOURNAL_WORKER_BUSY_RETRY'].includes(e.message))throw e;if(!announced){await event(t,step,'等待本机排版资源');announced=true;}await sleep(Math.max(250,pollMs),signal);}}};
  try{
   checkpoint();const source=await verify(store,t);
   if(!t.context){
    await event(t,'inspect','读取文稿与检查结构');
    const context=await invoke(store,'get_project_context',{projectId:t.projectId});
    await invoke(store,'validate_project',{projectId:t.projectId});
    t.context={route:context.route,counts:context.counts,checks:context.checks};
    if(source.document.composition)throw taskError('COMPOSITION_NOT_SUPPORTED','请将自由画布内容整理为文章后生成期刊校样。');
    if(context.route!=='journal'&&t.mode!=='prepare')throw taskError('JOURNAL_TEMPLATE_REQUIRED','选择“整理为学术期刊”，让 Agent 识别文章结构并生成校样。');
    if(!store.journalRuntime?.capabilities?.enabled)throw taskError('JOURNAL_RUNTIME_UNAVAILABLE','当前服务无法生成期刊 PDF，请检查运行环境。');
    const blockers=t.mode==='prepare'?[]:[...documentDiagnostics(source.document).filter(d=>d.severity==='error'),...journalFontProblems(source.document,store.journalRuntime.capabilities.environment?.fonts)];
    if(blockers.length)throw taskError('SOURCE_PREFLIGHT',`文稿预检发现 ${blockers.length} 项问题：${blockers.slice(0,3).map(d=>d.message).join('；')}`,blockers.slice(0,20));
    await save(t);
   }
   checkpoint();
   if(t.mode==='prepare'&&!t.appliedRevision){
    await event(t,'plan','识别首面、章节与图表关系');checkpoint();
    const plan=await invoke(store,'plan_journal_layout',{projectId:t.projectId,profile:'compact-academic'});
    if(plan.expectedRevision!==t.revision)throw taskError('REVISION_CONFLICT','文稿已更新，请重新下达任务。');
    const plannedErrors=plan.diagnostics.filter(d=>d.severity==='error');
    if(plannedErrors.length)throw taskError('SOURCE_PREFLIGHT','文章首面尚不完整，请补充标记的字段后重新执行。',plannedErrors);
    const dry=await invoke(store,'apply_changes',{projectId:t.projectId,expectedRevision:t.revision,operations:plan.operations,dryRun:true});
    const blockers=[...documentDiagnostics(dry.document).filter(d=>d.severity==='error'),...journalFontProblems(dry.document,store.journalRuntime.capabilities.environment?.fonts)];
    if(blockers.length)throw taskError('SOURCE_PREFLIGHT',`文稿预检发现 ${blockers.length} 项问题：${blockers.slice(0,3).map(d=>d.message).join('；')}`,blockers.slice(0,20));
    t.preparation={profile:'compact-academic',engine:'deterministic-rules',roles:plan.roles,diagnostics:plan.diagnostics,operations:plan.operations.length};
    const patch=plan.operations.find(o=>o.op==='set_layout').patch;
    t.changes=Object.entries(patch).filter(([k,v])=>typeof v==='number'&&source.document.layout[k]!==v).map(([field,after])=>({field,before:source.document.layout[field],after}));
    await event(t,'validate','结构与版面预检通过',`${Object.keys(plan.roles).length} 项首面字段 · ${plan.operations.length} 项整理`);
    checkpoint();await verify(store,t);await event(t,'committing','应用期刊规范并保存版本');checkpoint();
    const applied=await invoke(store,'apply_changes',{projectId:t.projectId,expectedRevision:t.revision,operations:plan.operations});
    t.appliedRevision=applied.revision;const after=await store.get(t.projectId);
    if(after.revision!==t.appliedRevision)throw taskError('REVISION_CONFLICT','保存后文稿又发生变化，请检查当前版本。');
    t.resultSha256=hash(after.document);await event(t,'applied','期刊结构已保存',`r${t.revision} → r${t.appliedRevision}`);
   }
   checkpoint();
   if(t.mode==='layout'&&!t.appliedRevision&&!t.noChanges){
    let plan=t.planId?await invoke(store,'get_layout_plan',args()):null;
    if(!plan||['failed','cancelled'].includes(plan.status)){
     await event(t,'plan','拟定版式方案');checkpoint();
     plan=await available('start_layout_plan',{projectId:t.projectId,expectedRevision:t.revision,instruction:t.goal},'plan');t.planId=plan.planId;await save(t);
    }
    while(plan.status==='running'){checkpoint();await sleep(pollMs,signal);checkpoint();await checkRevision();plan=await invoke(store,'get_layout_plan',args());}
    checkpoint();await verify(store,t);t.model=plan.model;t.changes=plan.changes||[];
    if(plan.status==='unchanged'){t.noChanges=true;await event(t,'validate','当前参数已符合要求，保留现有版式');}
    else{
     if(plan.status!=='review')throw taskError(plan.status==='unsupported'?'GOAL_NEEDS_CLARIFICATION':/超时/.test(plan.error||'')?'MODEL_TIMEOUT':plan.error||'MODEL_INCOMPLETE_RESPONSE',plan.status==='unsupported'?plan.summary:plan.error||'版式方案未生成，请重试。');
     await event(t,'validate','参数与几何预检通过',`${t.changes.length} 项版式调整`);
     // The plan already has a dry run and source hash. Persist commit intent
     // before the write; an ambiguous restart never replays a commit.
     checkpoint();await verify(store,t);await event(t,'committing','应用版式并保存版本');checkpoint();
     const applied=await invoke(store,'apply_layout_plan',{...args(),expectedRevision:t.revision});
     t.appliedRevision=applied.appliedRevision;
     const after=await store.get(t.projectId);
     if(after.revision!==t.appliedRevision)throw taskError('REVISION_CONFLICT','保存后文稿又发生变化，请检查当前版本。');
     t.resultSha256=hash(after.document);await event(t,'applied','版式已保存',`r${t.revision} → r${t.appliedRevision}`);
    }
   }
   checkpoint();await verify(store,t);
   let proof=t.proofId?await invoke(store,'get_journal_proof',{proofId:t.proofId}):null;
   if(!proof||proof.status==='failed'){
    await event(t,'proof','生成全文 PDF 校样');checkpoint();
    proof=await available('start_journal_proof',{projectId:t.projectId,expectedRevision:currentRevision(t)},'proof');t.proofId=proof.proofId;await save(t);
   }
   while(proof.status==='running'){checkpoint();await sleep(pollMs,signal);checkpoint();await checkRevision();proof=await invoke(store,'get_journal_proof',{proofId:t.proofId});}
   checkpoint();await verify(store,t);
   if(proof.status==='complete'&&!proof.report)proof=await invoke(store,'get_journal_proof',{proofId:t.proofId});
   if(proof.stale||proof.projectId!==t.projectId||proof.revision!==currentRevision(t))throw taskError('REVISION_CONFLICT','本次校样对应旧版文稿，请检查当前版本。');
   if(proof.status!=='complete')throw taskError('PROOF_FAILED','校样生成未完成，可重试校样步骤。',proof.error);
   await event(t,'check','检查实际 PDF 与源文稿绑定');
   const report=proof.report,diagnostics=report?.quality?.diagnostics||[];
   t.proof={projectId:t.projectId,proofId:proof.proofId,status:proof.status,revision:proof.revision,pages:proof.pages,pdfSha256:proof.pdfSha256,reportSha256:proof.reportSha256,sourceDocumentSha256:proof.sourceDocumentSha256,quality:report?.quality,formulaCoverage:report?.formulaCoverage,fonts:report?.fonts,semanticLayout:report?.semanticLayout,geometry:report?.geometry};
   if(!report?.quality||!proof.pdfSha256||proof.sourceDocumentSha256!==(t.resultSha256||t.sourceSha256))throw taskError('PROOF_EVIDENCE_MISSING','校样缺少完整的质量或版本证据，请查看报告。');
   if(report.quality.status==='BLOCKED'||diagnostics.some(d=>d.severity==='error'))throw taskError('QUALITY_BLOCKED','校样存在质量阻断，请查看报告并处理标记的问题。',diagnostics.filter(d=>d.severity==='error').slice(0,20));
   checkpoint();await verify(store,t);
   t.status='review';delete t.issue;t.finishedAt=now();await event(t,'review','校样已就绪，等待审阅',`${proof.pages} 页 · r${proof.revision}`);
  }catch(e){
   if(t.planId&&!t.appliedRevision){try{await invoke(store,'cancel_layout_plan',args());}catch{}}
   t.issue=e.taskIssue||issue(t.stage==='committing'?'COMMIT_OUTCOME_UNKNOWN':e.message,e.message);
   t.status=signal.aborted&&!closing?'cancelled':'needs_attention';t.finishedAt=now();
   await event(t,t.status,t.status==='cancelled'?'任务已停止':'需要处理',t.issue.message);
  }
 }
 const api={
  capabilities:{enabled:true,workflow:'inspect → plan → validate → apply → proof → check → review',scope:'journal-layout-and-proof',layoutFields:['width','height','top','bottom','inner','outer','fontSize','lineHeight','columns','gap'],preservesContent:true,automaticApply:true,persistent:true,idempotentStart:true,resumable:true,revisionGuard:true,concurrency:1,automaticVisualApproval:false},
  async start(store,a){
   if(closing)throw Error('AGENT_CLOSING');if(starting)throw Error('AGENT_BUSY_RETRY');starting=true;
   try{
    const ownerHash=hash(store.owner),requestHash=hash(a),old=[...index.values()].find(t=>t.ownerHash===ownerHash&&t.requestId===a.requestId);
    if(old){if(old.requestHash!==requestHash)throw Error('IDEMPOTENCY_CONFLICT');return api.get(store,{projectId:old.projectId,taskId:old.taskId});}
    const current=await store.get(a.projectId);if(current.revision!==a.expectedRevision)throw Error('REVISION_CONFLICT');
    if(a.mode==='layout'&&!store.layoutAssistant)throw Error('LAYOUT_ASSISTANT_UNAVAILABLE');
    if(active.size||locks.size)throw Error('AGENT_BUSY_RETRY');if(index.size>=maxTasks)throw Error('AGENT_TASK_LIMIT');
    const t={taskId:randomUUID(),ownerHash,requestHash,...a,revision:a.expectedRevision,sourceSha256:hash(current.document),status:'running',stage:'inspect',createdAt:now(),attempt:1,events:[]};delete t.expectedRevision;
    await save(t);launch(store,t);return publicTask(t,current);
   }finally{starting=false;}
  },
  async get(store,a){const {t,current}=await load(store,a);return publicTask(t,current);},
  async list(store,{projectId,limit=10}){
   const current=projectId?await store.status(projectId):null,ownerHash=hash(store.owner);
   const projects=projectId?null:new Map((await store.list()).filter(p=>!p.archived).map(p=>[p.projectId,p]));
   const tasks=[...index.values()].filter(t=>t.ownerHash===ownerHash&&(projectId?t.projectId===projectId:projects.has(t.projectId))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,limit);
   return {projectId:projectId||null,tasks:tasks.map(t=>publicTask(t,current||projects.get(t.projectId)))};
  },
  async cancel(store,a){await load(store,a);const slot=active.get(a.taskId);if(slot){slot.controller.abort();await slot.done;}return api.get(store,a);},
  async resume(store,a){
   if(closing)throw Error('AGENT_CLOSING');if(starting||active.size||locks.size)throw Error('AGENT_BUSY_RETRY');locks.add(a.taskId);
   try{
    const {t,current}=await load(store,a);if(current.revision!==a.expectedRevision)throw Error('REVISION_CONFLICT');
    if(!publicTask(t,current).actions.resume)throw Error('TASK_NOT_RESUMABLE');await verify(store,t);
    if(t.attempt>=5)throw Error('TASK_RETRY_LIMIT');t.attempt++;t.status='running';delete t.issue;delete t.finishedAt;
    await event(t,'resume','继续未完成的步骤',`第 ${t.attempt} 次执行`);launch(store,t);return publicTask(t,current);
   }finally{locks.delete(a.taskId);}
  },
  async review(store,a){
   if(active.has(a.taskId)||locks.has(a.taskId))throw Error('TASK_BUSY');locks.add(a.taskId);
   try{
    const {t,current}=await load(store,a);if(current.revision!==a.expectedRevision)throw Error('REVISION_CONFLICT');
    if(!publicTask(t,current).actions.accept||a.pdfSha256!==t.proof.pdfSha256)throw Error('TASK_NOT_REVIEWABLE');await verify(store,t);
    t.review={at:now(),revision:current.revision,pdfSha256:a.pdfSha256,scope:'editorial-review',productionApproval:false};t.status='accepted';await event(t,'accepted','本轮审阅已完成',`r${current.revision}`);return publicTask(t,current);
   }finally{locks.delete(a.taskId);}
  },
  async undo(store,a){
   if(active.has(a.taskId)||locks.has(a.taskId))throw Error('TASK_BUSY');locks.add(a.taskId);
   try{
    const {t,current}=await load(store,a);if(current.revision!==a.expectedRevision)throw Error('REVISION_CONFLICT');
    if(!publicTask(t,current).actions.undo)throw Error('TASK_NOT_UNDOABLE');await verify(store,t);
    const undone=t.mode==='prepare'?await invoke(store,'restore_version',{projectId:t.projectId,expectedRevision:t.appliedRevision,revision:t.revision}):await invoke(store,'undo_layout_plan',{projectId:t.projectId,planId:t.planId,expectedRevision:t.appliedRevision});
    t.undoneRevision=undone.undoneRevision||undone.revision;t.status='undone';delete t.issue;await event(t,'undone','已恢复任务前的版式',`当前 r${t.undoneRevision}`);return publicTask(t,await store.get(a.projectId));
   }finally{locks.delete(a.taskId);}
  },
  async close(){closing=true;for(const slot of active.values())slot.controller.abort();await Promise.allSettled([...active.values()].map(s=>s.done));}
 };
 return api;
}
