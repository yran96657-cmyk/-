const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const button=(text,fn,cls)=>{const b=el('button',text,cls);b.type='button';b.onclick=fn;return b;};
const fields={width:'页面宽',height:'页面高',top:'上边距',bottom:'下边距',inner:'内边距',outer:'外边距',fontSize:'字号',lineHeight:'行距',columns:'栏数',gap:'栏距'};
const value=(field,v)=>String(v)+({fontSize:' pt',lineHeight:' 倍',columns:' 栏'}[field]??' mm');
const prepareGoal='按 170×240 毫米双栏期刊规范整理首面、章节、图表和参考文献，生成全文 PDF 校样。';
const names={running:'Agent 正在排版',review:'校样已就绪',needs_attention:'需要你处理',cancelled:'已停止',undone:'已撤销',accepted:'本轮已审阅'};
const phaseOrder=['inspect','plan','validate','committing','applied','proof','check','review'];
const errors={AGENT_BUSY_RETRY:'另一个任务正在执行，请稍后再试。',AGENT_RUNTIME_UNAVAILABLE:'当前服务尚未启用 Agent 任务。',REVISION_CONFLICT:'文稿已更新，请重新读取后下达任务。',TASK_NOT_UNDOABLE:'文稿已有后续修改，不能整次撤销。请查看历史版本。',TASK_NOT_RESUMABLE:'这项任务不能直接继续，请查看提示后新建任务。',LOCAL_CHANGED_DURING_OPEN:'读取期间有新输入，已保留你的修改。'};
export const taskCanWrite=(task,connection)=>!!task&&!connection.dirty&&!connection.writing&&task.projectId===connection.projectId&&task.currentRevision===connection.revision&&!task.stale;

export function setupAgentTasks({panel,connection,getDoc,notify,locate=()=>{},onState=()=>{}}){
 const api=(name,args={})=>connection.api(name,args);
 let task=null,tasks=[],enabled=false,modelReady=false,busy=false,epoch=0,timer=null,project=connection.projectId,mode='prepare',pending=null,observed='',editing=true,localNotice=false;
 const storageKey=id=>`shuye-agent-request-${id}`;
 function readPending(id){try{const p=JSON.parse(localStorage.getItem(storageKey(id)));return p?.projectId===id&&p.requestId?p:null;}catch{return null;}}
 function savePending(p){pending=p;try{if(p)localStorage.setItem(storageKey(p.projectId),JSON.stringify(p));else localStorage.removeItem(storageKey(project));}catch{}}
 const top=el('div',undefined,'agent-top'),heading=el('h2','Agent'),connectionState=el('span','连接中','agent-connection');top.append(heading,connectionState);
 const history=el('select',undefined,'agent-history');history.setAttribute('aria-label','任务记录');history.hidden=true;
 history.onchange=()=>{task=tasks.find(t=>t.taskId===history.value)||null;editing=false;render();schedule();};
 const form=el('form',undefined,'agent-composer'),intro=el('h3','这份稿件，交给 Agent。');
 const prompt=el('textarea');prompt.rows=4;prompt.maxLength=1200;prompt.placeholder='告诉 Agent 你的版式目标…\n例如：期刊双栏，正文 9 pt，栏距 6 mm';prompt.setAttribute('aria-label','Agent 排版目标');prompt.value=prepareGoal;
 const recipes=el('div',undefined,'agent-recipes');
 recipes.append(button('整理为学术期刊',()=>{mode='prepare';prompt.value=prepareGoal;sync();}),button('自定义版式',()=>{mode='layout';prompt.value='正文改为双栏，栏距设为6毫米，内外边距都设为15毫米，正文字号设为9pt，正文行距设为1.6倍。其他参数保持不变。';prompt.focus();sync();}),button('检查现有版式',()=>{mode='proof';prompt.value='保留现有版式，生成全文 PDF 校样并检查质量。';prompt.focus();sync();}));
 const submit=el('button','执行排版任务','primary agent-submit');submit.type='submit';
 const scope=el('p','自动应用版式、生成校样，可随时停止或撤销。','agent-scope');
 form.append(intro,prompt,recipes,submit,scope);
 const notice=el('p',undefined,'agent-notice');notice.setAttribute('role','status');notice.hidden=true;
 const recheck=button('保存并重新检查',()=>{mode=task.appliedRevision||task.proof?.status==='complete'?'proof':task.mode;prompt.value=mode==='proof'?'保留现有版式，生成全文 PDF 校样并检查质量。':task.goal;editing=true;render();if(!submit.disabled)form.requestSubmit();},'primary agent-submit');recheck.hidden=true;
 const taskCard=el('section',undefined,'agent-task');taskCard.setAttribute('aria-label','Agent 任务');
 const newTask=button('新任务',()=>{editing=true;mode='prepare';prompt.value=prepareGoal;render();prompt.focus();},'agent-new');newTask.hidden=true;
 const retry=button('重新连接',async()=>{await connect();await refresh();}, 'agent-reconnect');retry.hidden=true;
 panel.classList.add('agent-panel');panel.append(top,history,form,notice,recheck,taskCard,newTask,retry);
 const say=(text,error=false)=>{localNotice=false;notice.textContent=text;notice.hidden=!text;notice.classList.toggle('error',error);};
 function sync(){
  const supported=!getDoc().composition&&(mode==='prepare'||!!getDoc().journal),running=tasks.some(t=>t.status==='running');
  submit.disabled=busy||running||!enabled||!connection.projectId||!supported||(!pending&&!prompt.value.trim())||(!pending&&mode==='layout'&&!modelReady);
  submit.textContent=pending?'重新连接已提交的任务':busy?'正在提交…':connection.dirty?'保存并执行任务':mode==='proof'?'生成并检查校样':mode==='prepare'?'整理并生成校样':'执行排版任务';
  prompt.disabled=!!pending||busy||running;recipes.querySelectorAll('button').forEach(b=>b.disabled=prompt.disabled);
  scope.textContent=!supported?'请先选择“整理为学术期刊”，或切换到文章工程。':mode==='prepare'?'170 × 240 mm · 双栏 · 规范规则自动整理，可整次撤销。':mode==='proof'?'保持版式，生成并检查当前版本的校样。':'自动应用版式、生成校样，可随时停止或撤销。';
  form.hidden=!!task&&!editing&&!pending;
  taskCard.hidden=!task||editing;
  newTask.hidden=!task||editing||running||!!pending;
  for(const b of taskCard.querySelectorAll('[data-write]'))b.disabled=busy||!taskCanWrite(task,connection);
  const changed=!!task&&(connection.dirty||task.stale||connection.revision!==task.currentRevision);
  recheck.hidden=editing||!changed||running;recheck.disabled=busy||!enabled||connection.writing;
  recheck.textContent=connection.dirty?'保存并重新检查':'重新检查当前版本';
  if(connection.dirty&&task?.status==='running'){say('你有未保存的修改。可停止 Agent 后接管；新输入会保留在本地。');localNotice=true;}
  else if(changed&&!editing&&!running){say('文稿已有修改。下方是修改前的记录，请重新检查当前版本。');localNotice=true;}
  else if(localNotice)say('');
  onState(tasks.find(t=>t.status==='running')||task);
 }
 function render(){
  history.replaceChildren(...tasks.map(t=>{const o=el('option',`${names[t.status]||t.status} · ${new Date(t.createdAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}`);o.value=t.taskId;return o;}));history.hidden=!task||(!editing&&tasks.length<2);
  if(editing&&task){const draft=el('option','新任务');draft.value='';draft.disabled=true;history.prepend(draft);history.value='';}else if(task)history.value=task.taskId;
  taskCard.replaceChildren();taskCard.hidden=!task;if(!task){sync();return;}
  const status=el('div',undefined,'agent-status');status.dataset.state=task.status;
  status.append(el('span',undefined,'agent-status-dot'),el('h3',task.stale?'任务对应旧版本':names[task.status]||task.status),el('span',`r${task.undoneRevision||task.appliedRevision||task.revision}`,'agent-version'));taskCard.append(status,el('p',task.goal,'agent-goal'));
  const phases=[['inspect','读取与检查'],['plan','方案与预检'],['applied','应用与保存'],['proof','PDF 校样'],['check','质量检查']];
  const lastStep=[...(task.events||[])].reverse().find(e=>phaseOrder.includes(e.step))?.step||'inspect',at=phaseOrder.indexOf(lastStep);
  const timeline=el('ol',undefined,'agent-timeline');timeline.setAttribute('aria-label','执行步骤');
  for(const [step,label] of phases){if(task.mode==='proof'&&['plan','applied'].includes(step))continue;const i=phaseOrder.indexOf(step),done=task.status==='review'||i<at||(step==='applied'&&!!task.appliedRevision),current=!done&&i===at;const li=el('li');li.dataset.state=done?'done':current?'active':'pending';if(current&&task.status==='running')li.setAttribute('aria-current','step');li.append(el('span',done?'✓':String(timeline.children.length+1),'agent-step-mark'),el('span',label));timeline.append(li);}
  timeline.hidden=['review','undone','accepted'].includes(task.status);taskCard.append(timeline);
  if(task.changes?.length&&task.status!=='undone'){const details=el('details',undefined,'agent-changes');details.open=task.status!=='running';details.append(el('summary',`${task.changes.length} 项版式调整`));const table=el('table');for(const c of task.changes){const tr=el('tr');tr.append(el('th',fields[c.field]||c.field),el('td',value(c.field,c.before)),el('td','→'),el('td',value(c.field,c.after)));table.append(tr);}details.append(table);taskCard.append(details);}
  if(task.preparation?.diagnostics?.length&&task.status!=='undone'){
   const details=el('details',undefined,'agent-changes');details.open=true;details.append(el('summary',`${task.preparation.diagnostics.length} 项需核对`));
   for(const d of task.preparation.diagnostics){const row=el('p',d.message);if(d.blockId)row.append(button('定位',()=>locate(d.blockId)));details.append(row);}taskCard.append(details);
  }
  if(task.proof?.status==='complete'&&task.status!=='undone'){
   const proof=el('div',undefined,'agent-proof-summary');proof.append(el('strong',`${task.proof.pages} 页`),el('span',`PDF 校样 · r${task.proof.revision}`));taskCard.append(proof);
   const notes=task.proof.quality?.diagnostics||[],blocking=notes.filter(d=>d.severity==='error').length,warnings=notes.filter(d=>d.severity==='warning').length;
   taskCard.append(el('p',blocking?`${blocking} 项质量阻断，查看报告处理。`:task.status==='accepted'?'本轮审阅已记录，修改文稿后需重新出校样。':warnings?`${warnings} 项待核对，查看校样与报告。`:'机器检查已完成，最终版面由你审阅。','agent-quality'));
   for(const d of notes.filter(d=>d.code==='EDITORIAL_COMMENT_UNRESOLVED')){const row=el('p',d.message,'agent-issue');if(d.blockId)row.append(button('定位',()=>locate(d.blockId)));taskCard.append(row);}
  }
  if(task.issue){taskCard.append(el('p',task.issue.message,'agent-issue'));if(Array.isArray(task.issue.details)){const issues=el('ul',undefined,'agent-issue-list');for(const d of task.issue.details){const li=el('li',d.message||d.code);if(d.blockId){const jump=button('定位',()=>locate(d.blockId));li.append(jump);}issues.append(li);}taskCard.append(issues);}}
  if(task.stale)taskCard.append(el('p','文稿已有后续版本。此任务与旧版绑定，请新建任务。','agent-issue'));
  const controls=el('div',undefined,'agent-controls');
  if(task.actions.cancel)controls.append(button('停止并接管',()=>act('cancel_agent_task'),'agent-stop'));
  if(task.actions.resume){const b=button('继续任务',()=>act('resume_agent_task'),'primary');b.dataset.write='true';controls.append(b);}
  if(task.actions.review){const b=button('查看校样与报告',()=>review(),'primary');b.dataset.write='true';controls.append(b);}
  if(task.actions.accept){const b=button('完成本轮审阅',()=>act('review_agent_task'),'agent-secondary');b.dataset.write='true';controls.append(b);}
  if(task.actions.undo){const b=button('撤销本次任务',()=>act('undo_agent_task'),'agent-secondary');b.dataset.write='true';controls.append(b);}
  if(task.status==='needs_attention'&&task.issue?.code==='GOAL_NEEDS_CLARIFICATION'){controls.append(button('调整目标',()=>{editing=true;mode=task.mode;prompt.value=task.goal;sync();prompt.focus();}));}
  if(task.status==='undone')taskCard.append(el('p',`已恢复任务前的版式 · r${task.undoneRevision}`,'agent-quality'));
  taskCard.append(controls);
  const log=el('details',undefined,'agent-log');log.append(el('summary','执行记录'));const list=el('ol');for(const event of task.events||[]){const li=el('li');li.append(el('time',new Date(event.at).toLocaleTimeString('zh-CN')),el('span',event.label+(event.detail?' · '+event.detail:'')));list.append(li);}log.append(list);taskCard.append(log);sync();
 }
 function schedule(){clearTimeout(timer);if(tasks.some(t=>t.status==='running'))timer=setTimeout(()=>refresh(),1000);}
 async function refresh(){
  const id=connection.projectId,token=epoch;if(!id)return;
  try{
   const response=await api('list_agent_tasks',{projectId:id,limit:50});if(token!==epoch||id!==connection.projectId)return;
   const requested=!observed?new URLSearchParams(location.search).get('task'):null;
   tasks=response.tasks;task=tasks.find(t=>t.taskId===(requested||task?.taskId))||tasks[0]||null;
   if(pending&&tasks.some(t=>t.requestId===pending.requestId)){savePending(null);editing=false;}
   if(task){if(!observed)editing=false;observed=task.taskId;
    if(!connection.dirty&&!connection.writing&&connection.revision<task.currentRevision)await connection.poll();
    if(token!==epoch||id!==connection.projectId)return;
    if(task.actions.review&&task.proof?.revision===connection.revision)connection.journalUI?.rememberProof(task.proof);
   }
   retry.hidden=true;render();schedule();
  }catch(e){if(token!==epoch)return;say('连接中断，后台任务仍保留。重新连接即可查看进展。',true);retry.hidden=false;}
 }
 async function run(fn){if(busy)return;busy=true;say('');sync();try{await fn();}catch(e){say(errors[e.message]||e.message,true);}finally{busy=false;sync();}}
 form.onsubmit=e=>{e.preventDefault();run(async()=>{
  const id=connection.projectId,token=epoch;if(!id)throw Error('请先保存工程。');
  if(!pending){if(connection.dirty)await connection.save();if(token!==epoch||id!==connection.projectId)return;if(connection.dirty)throw Error('保存期间有新输入，请再次保存后执行。');savePending({projectId:id,expectedRevision:connection.revision,requestId:crypto.randomUUID(),goal:prompt.value.trim(),mode});}
  const request={...pending};let started;
  try{started=await api('start_agent_task',request);}catch(e){if(['AGENT_BUSY_RETRY','REVISION_CONFLICT','IDEMPOTENCY_CONFLICT','AGENT_RUNTIME_UNAVAILABLE','LAYOUT_ASSISTANT_UNAVAILABLE','AGENT_CLOSING','AGENT_TASK_LIMIT'].includes(e.message)&&token===epoch)savePending(null);throw e;}
  if(token!==epoch||id!==connection.projectId)return;savePending(null);task=started;observed=started.taskId;tasks=[started,...tasks.filter(t=>t.taskId!==started.taskId)];editing=false;render();schedule();
 });};
 async function act(tool){await run(async()=>{
  const id=connection.projectId,token=epoch,current=task;if(!current)return;
  if(tool!=='cancel_agent_task'&&!taskCanWrite(current,connection))throw Error('先处理本地修改，再继续或撤销任务。');
  const result=await api(tool,{projectId:id,taskId:current.taskId,...(tool==='cancel_agent_task'?{}:{expectedRevision:connection.revision}),...(tool==='review_agent_task'?{pdfSha256:current.proof.pdfSha256}:{})});
  if(token!==epoch||id!==connection.projectId)return;task=result;tasks=tasks.map(t=>t.taskId===result.taskId?result:t);
  if(!connection.dirty&&!connection.writing)await connection.poll();if(token!==epoch)return;render();schedule();
  if(tool==='cancel_agent_task')notify('已停止后续步骤，可以接管编辑。已提交的版式可整次撤销。');
 });}
 async function review(){await run(async()=>{const current=task;if(!taskCanWrite(current,connection))throw Error('文稿有新修改，请先处理当前版本。');await connection.journalUI.reviewProof(current.proofId,current.projectId);});}
 async function connect(){
  const token=epoch;try{const [cap,model]=await Promise.all([api('get_agent_capabilities'),api('get_layout_assistant')]);if(token!==epoch)return;enabled=!!cap.enabled;modelReady=!!model.ready;connectionState.textContent=enabled?(modelReady?'本机就绪':'规范排版就绪'):'未启用';connectionState.dataset.state=enabled?'ready':'off';}catch{enabled=false;connectionState.textContent='未连接';retry.hidden=false;}sync();
 }
 prompt.addEventListener('input',()=>{if((mode==='prepare'&&prompt.value!==prepareGoal)||(mode==='proof'&&prompt.value!=='保留现有版式，生成全文 PDF 校样并检查质量。'))mode='layout';sync();});
 prompt.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();if(!submit.disabled)form.requestSubmit();}});
 document.addEventListener('shuye:connection-changed',()=>{if(project!==connection.projectId){project=connection.projectId;epoch++;clearTimeout(timer);task=null;tasks=[];observed='';editing=true;pending=readPending(project);prompt.value=pending?.goal||prepareGoal;mode=pending?.mode||'prepare';say('');render();refresh();connect();}else {sync();if(task&&connection.revision!==task.currentRevision)refresh();}});
 document.addEventListener('shuye:document-changed',sync);
 pending=readPending(project);if(pending){prompt.value=pending.goal;mode=pending.mode;}
 render();connect();refresh();
 return {sync,refresh};
}
