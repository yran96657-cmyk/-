import {setupJournalCloud} from './journal-cloud-ui.mjs';
import {sitePath} from './site-path.mjs';
import {ProjectConnection,documentFingerprint} from './project-sync.mjs';
import {confirmAction} from './dialogs.mjs';
import {createDraftStore} from './draft-store.mjs';
export async function setupCloud({getDoc,replaceDoc,status}){
 const actions=document.querySelector('.file-actions'),state=document.getElementById('saveState');
 const api=async(tool,args={})=>{const r=await fetch(sitePath('/api/mcp-projects'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tool,arguments:args})});const data=await r.json();if(!r.ok)throw Error(data.error||'云端请求失败');return data;};
 const drafts=createDraftStore();
 const connection=new ProjectConnection({api,getDoc,replaceDoc,beforeSave:async({projectId,revision,document})=>{try{await drafts.write(projectId,{baseRevision:revision,document});}catch{status('浏览器草稿保存失败，正在保存到云端',true);}},onChange:()=>document.dispatchEvent(new Event('shuye:connection-changed'))});let pending=false,ready=false;
 const button=(text,fn,parent=actions)=>{const b=document.createElement('button');b.textContent=text;b.onclick=async()=>{if(pending){status('正在保存，请稍后重试');return;}document.activeElement?.blur();b.disabled=true;try{await fn();}catch(e){status(e.message==='REVISION_CONFLICT'?'云端已有更新。当前修改已保留，请下载备份后重新打开工程，或另存为新工程。':e.message==='LOCAL_CHANGED_DURING_OPEN'?'读取期间有新输入，已保留当前文稿，请重新打开或另存云端':e.message==='UNAUTHENTICATED'?'登录已失效，当前修改仍保留；请在项目库登录后重试保存':e.message,true);}finally{b.disabled=false;}};parent.append(b);return b;};
 const save=button('保存到云端',async()=>{if(pending)return;pending=true;try{if(!connection.projectId){const id='book-'+crypto.randomUUID();await connection.create(id);history.replaceState(null,'','?project='+id);ready=true;}else await connection.save();if(connection.dirty)await stashDraft();state.textContent=connection.dirty?'保存期间有新修改 · 请再次保存':'云端已保存 · r'+connection.revision;status(connection.dirty?'本次快照已保存；后续输入仍保留在浏览器，请再次保存':'工程已保存到云端，可在其他设备或 MCP 中读取');}finally{pending=false;}});save.className='primary';
 const historyButton=button('版本',async()=>{if(!connection.projectId)throw Error('请先保存到云端');const r=await api('list_versions',{projectId:connection.projectId});const d=document.createElement('dialog');d.className='workspace-dialog';const h=document.createElement('h2');h.textContent='历史版本';d.append(h);if(!r.versions.length){const p=document.createElement('p');p.textContent='尚无历史版本。下一次保存后可在这里恢复。';d.append(p);}for(const v of r.versions){button(`恢复 r${v.revision} · ${v.title} · ${new Date(v.updatedAt).toLocaleString()}`,async()=>{if(!await confirmAction('恢复该版本？当前云端版本仍会保留在历史中。本地未提交修改将被替换。'))return;pending=true;try{await connection.restore(v.revision);stashDraft();d.close();status(connection.dirty?'云端历史版本已恢复；恢复期间的新输入仍在浏览器，请另存备份或保存':'历史版本已恢复');}finally{pending=false;}},d);}button('关闭',()=>d.close(),d);d.onclose=()=>d.remove();document.body.append(d);d.showModal();});
 button('另存云端',async()=>{if(pending)return;pending=true;try{const id='book-'+crypto.randomUUID();await connection.create(id);history.replaceState(null,'','?project='+id);ready=true;stashDraft();status(connection.dirty?'副本已创建；保存期间的新修改仍在浏览器，请再次保存':'已创建独立副本');}finally{pending=false;}});
 document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();e.stopImmediatePropagation();save.click();}},true);
 const stashDraft=async()=>{if(connection.applying||!connection.projectId||!connection.dirty)return;const id=connection.projectId;try{await drafts.write(id,{baseRevision:connection.revision,document:getDoc()});}catch{status('浏览器草稿保存失败，请保存到云端或下载备份',true);}};
 // A successful save, including an Agent's save, retires only that exact draft.
 // A conflicting or newly typed draft must survive opening/syncing another revision.
 document.addEventListener('shuye:connection-changed',()=>{if(!connection.projectId)return;const base=connection.base;void drafts.removeIf(connection.projectId,d=>documentFingerprint(d.document)===base).catch(()=>{});});
 let draftTimer;
 document.addEventListener('shuye:document-changed',()=>{clearTimeout(draftTimer);draftTimer=setTimeout(stashDraft,400);});
 window.addEventListener('pagehide',()=>{clearTimeout(draftTimer);stashDraft();});
 window.addEventListener('beforeunload',e=>{stashDraft();if(connection.dirty){e.preventDefault();e.returnValue='';}});
 const projectId=new URLSearchParams(location.search).get('project');
 if(projectId){save.disabled=true;try{let local;try{local=await drafts.read(projectId);}catch{status('浏览器草稿缓存不可用，仍可打开云端工程',true);}await connection.open(projectId);ready=true;if(local){if(local.baseRevision===connection.revision&&documentFingerprint(local.document)!==connection.base&&await confirmAction('发现上次未提交的浏览器草稿，是否恢复？'))await replaceDoc(local.document);else if(local.baseRevision!==connection.revision&&documentFingerprint(local.document)!==connection.base)status('云端已有更新，上次草稿仍保留在此浏览器。请在“恢复草稿”中取回。',true);}}catch(e){status('无法打开云端工程：'+e.message,true);}finally{save.disabled=false;}}
 button('恢复草稿',async()=>{const local=await drafts.read(connection.projectId||projectId);if(!local)throw Error('没有可恢复的浏览器草稿');if(await confirmAction('恢复浏览器草稿？建议随后“另存云端”避免覆盖新版本。'))await replaceDoc(local.document);});
 setInterval(async()=>{if((!ready&&!connection.projectId)||pending)return;if(connection.dirty){state.textContent='有修改未保存到云端 · r'+connection.revision;stashDraft();return;}if(document.activeElement?.matches('input,textarea,[contenteditable=true]'))return;state.textContent='云端已保存 · r'+connection.revision;try{if(await connection.poll())status('已同步云端 / agent 更新 · r'+connection.revision);}catch(e){state.textContent='云端连接中断 · 修改仍在浏览器';}},3000);
 connection.journalUI=setupJournalCloud({api,connection,getDoc,button,status});
 if(!projectId)state.textContent='示例文稿 · 尚未保存到云端';
 return connection;
}

