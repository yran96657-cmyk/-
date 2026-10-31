"use client";
import {sitePath} from '../public/editor/src/site-path.mjs';
import {journalFileArguments} from '../public/editor/src/journal-file.mjs';
import {useState,useEffect,useRef} from 'react';
import type {CSSProperties} from 'react';
import {Plus,Search,ArrowUpRight,Archive,LoaderCircle,RotateCcw,Braces,HelpCircle,Upload} from 'lucide-react';

type Project={projectId:string,title:string,revision:number,updatedAt:string,blockCount:number,archived:boolean};
type Tab='projects'|'archive'|'templates'|'agent'|'guide';
type AgentTask={taskId:string,projectId:string,goal:string,status:string,stage:string,createdAt:string,appliedRevision?:number,revision:number,stale:boolean,proof?:{pages:number},issue?:{message:string}};
const TASK_NAMES:Record<string,string>={running:'执行中',review:'待审阅',needs_attention:'需要处理',cancelled:'已停止',undone:'已撤销',accepted:'已审阅'};
const TABS:Tab[]=['projects','archive','templates','agent','guide'];
async function api(tool:string,args:object={}){
  const r=await fetch(sitePath('/api/mcp-projects'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tool,arguments:args})});
  const data=await r.json();if(!r.ok)throw Error(data.error||'操作失败');return data;
}

// 模板缩样按真实毫米比例绘制；版式与 templates.mjs 一致（图书、A4 双栏、A5 竖排、空白）。
type Tpl={id:string,name:string,w:number,h:number,cols:number,vertical?:boolean,sample:string};
const TEMPLATES:Tpl[]=[
  {id:'journal',name:'学术期刊',w:170,h:240,cols:2,sample:'学术的秩序'},
  {id:'book',name:'通用图书',w:185,h:260,cols:1,sample:'文字的秩序'},
  {id:'academic',name:'A4 论文',w:210,h:297,cols:2,sample:'研究与发现'},
  {id:'poetry',name:'竖排诗集',w:148,h:210,cols:1,vertical:true,sample:'山川与诗'},
  {id:'blank',name:'空白文稿',w:185,h:260,cols:1,sample:''},
];
const FLOW:Record<string,(number|'h')[][]>={book:[[3,'h',4,3,'h',5,4,3,4]],academic:[[5,'h',6,4,'h',5,6],[4,6,'h',5,6,4]]};
const POEM=[.62,.46,.7,.4];
function Sheet({t,s,title,mini=false}:{t:Tpl,s:number,title:string,mini?:boolean}){
  const px=(mm:number)=>Math.round(mm*s*10)/10;
  const style={width:px(t.w),height:px(t.h),'--s':s,'--sheet-ratio':`${t.w}/${t.h}`} as CSSProperties;
  const block={top:px(20),bottom:px(24),left:px(18),right:px(18)};
  const cls='sheet'+(mini?' is-mini':'');
  if(t.id==='blank')return <div className={cls} style={style} aria-hidden="true"><div className="sheet-block is-guides" style={block}/></div>;
  if(t.vertical)return <div className={cls} style={style} aria-hidden="true"><div className="sheet-block is-vertical" style={block}><span className="sheet-title">{title}</span><div className="sheet-poem">{POEM.map((h,i)=><i key={i} style={{height:`${h*100}%`}}/>)}</div></div><i className="sheet-folio"/></div>;
  return <div className={cls} style={style} aria-hidden="true"><div className="sheet-block" style={block}><span className="sheet-title">{title}</span>{t.id==='journal'&&<div className="sheet-abstract"/>}<div className="sheet-cols">{(FLOW[t.id==='journal'?'academic':t.id]||FLOW.book).map((col,i)=><div key={i}>{col.map((n,j)=>n==='h'?<i key={j} className="sheet-h"/>:<i key={j} className="sheet-p" style={{height:`calc(var(--pitch) * ${n})`}}/>)}</div>)}</div></div><i className="sheet-folio"/></div>;
}

function when(iso:string){
  const d=new Date(iso);if(Number.isNaN(d.getTime()))return '';
  const now=new Date(),clock=d.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}),yesterday=new Date(now);yesterday.setDate(now.getDate()-1);
  if(d.toDateString()===now.toDateString())return '今天 '+clock;
  if(d.toDateString()===yesterday.toDateString())return '昨天 '+clock;
  if(d.getFullYear()===now.getFullYear())return `${d.getMonth()+1}月${d.getDate()}日`;
  return d.toLocaleDateString('zh-CN');
}
const titleSize=(t:string)=>t.length>28?' is-long':t.length>14?' is-mid':'';

export default function Dashboard({user}:{user:string|null}){
  const importRef=useRef<HTMLInputElement>(null),importingRef=useRef(false);
  const [importing,setImporting]=useState(false);
  async function importWord(file?:File){
    if(!file||importingRef.current)return;
    importingRef.current=true;setImporting(true);setError('');
    try{const args=await journalFileArguments(file),projectId='journal-'+crypto.randomUUID();await api('import_journal_docx',{projectId,...args});location.href=sitePath('/editor/index.html?project=')+projectId;}
    catch(e:any){setError(e.message);}
    finally{importingRef.current=false;setImporting(false);}
  }
  const [agentTasks,setAgentTasks]=useState<AgentTask[]>([]),[agentAvailable,setAgentAvailable]=useState<boolean|null>(null),[agentError,setAgentError]=useState('');
  const [projects,setProjects]=useState<Project[]>([]),[tab,setTabState]=useState<Tab>('projects'),[search,setSearch]=useState(''),[loading,setLoading]=useState(true),[error,setError]=useState(''),[creating,setCreating]=useState(false),[modal,setModal]=useState(false),[title,setTitle]=useState(''),[template,setTemplate]=useState('book'),[pending,setPending]=useState('');
  async function load(quiet=false){if(!quiet)setLoading(true);try{if(user)setProjects((await api('list_projects')).projects);}catch(e:any){setError(e.message);}finally{setLoading(false);}}
  useEffect(()=>{load();},[]);
  useEffect(()=>{
    if(!user||tab!=='agent')return;
    let cancelled=false,timer:ReturnType<typeof setTimeout>;
    async function refresh(){try{const cap=await api('get_agent_capabilities');if(cancelled)return;setAgentAvailable(!!cap.enabled);if(!cap.enabled)return;const r=await api('list_agent_tasks',{limit:30});if(cancelled)return;setAgentTasks(r.tasks);setAgentError('');}catch{if(!cancelled)setAgentError('任务连接中断，正在重新连接…');}finally{if(!cancelled)timer=setTimeout(refresh,3000);}}
    refresh();return()=>{cancelled=true;clearTimeout(timer);};
  },[user,tab]);
  useEffect(()=>{const t=location.hash.slice(1) as Tab;if(TABS.includes(t))setTabState(t);},[]);
  function setTab(t:Tab){setTabState(t);try{history.replaceState(null,'',t==='projects'?location.pathname+location.search:'#'+t);}catch{}}
  const dialogRef=useRef<HTMLFormElement>(null),openerRef=useRef<HTMLElement|null>(null),creatingRef=useRef(false),searchRef=useRef<HTMLInputElement>(null);creatingRef.current=creating;
  useEffect(()=>{
    if(!modal)return;
    const onKey=(e:KeyboardEvent)=>{
      if(e.key==='Escape'&&!creatingRef.current){e.preventDefault();setModal(false);return;}
      if(e.key!=='Tab')return;
      const items=[...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)')||[])];
      if(!items.length)return;
      if(e.shiftKey&&document.activeElement===items[0]){e.preventDefault();items[items.length-1].focus();}
      else if(!e.shiftKey&&document.activeElement===items[items.length-1]){e.preventDefault();items[0].focus();}
    };
    document.addEventListener('keydown',onKey);return()=>{document.removeEventListener('keydown',onKey);openerRef.current?.focus();};
  },[modal]);
  // “/” 聚焦搜索，与多数桌面工具一致；输入框内不拦截。
  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{
      if(e.key!=='/'||modal||e.ctrlKey||e.metaKey||e.altKey||(tab!=='projects'&&tab!=='archive'))return;
      if((e.target as Element|null)?.closest?.('input,textarea,select,[contenteditable]'))return;
      e.preventDefault();searchRef.current?.focus();
    };
    document.addEventListener('keydown',onKey);return()=>document.removeEventListener('keydown',onKey);
  },[modal,tab]);
  function openModal(){openerRef.current=document.activeElement instanceof HTMLElement?document.activeElement:null;setError('');setModal(true);}
  async function create(){if(!title.trim()){setError('请输入项目名称');return;}setCreating(true);setError('');try{const {makeTemplate}=await import('../public/editor/src/templates.mjs');const projectId='book-'+crypto.randomUUID();await api('create_project',{projectId,document:makeTemplate(template,title.trim())});location.href=sitePath('/editor/index.html?project=')+projectId;}catch(e:any){setError(e.message);setCreating(false);}}
  async function archive(p:Project){if(pending)return;setPending(p.projectId);try{await api('archive_project',{projectId:p.projectId,expectedRevision:p.revision,archived:!p.archived});await load(true);}catch(e:any){setError(e.message);}finally{setPending('');}}
  const signIn=()=>{location.href=sitePath('/signin-with-chatgpt?return_to=/');};
  function newProject(){if(!user)signIn();else {setTitle('');setTemplate('journal');openModal();}}
  function startFrom(id:string){if(!user){signIn();return;}setTemplate(id);setTitle('');openModal();}

  const active=projects.filter(p=>!p.archived),archived=projects.filter(p=>p.archived),q=search.trim().toLowerCase();
  const visible=(tab==='archive'?archived:active).filter(p=>p.title.toLowerCase().includes(q)).sort((a,b)=>(Date.parse(b.updatedAt)||0)-(Date.parse(a.updatedAt)||0));
  const isLibrary=tab==='projects'||tab==='archive',chosen=TEMPLATES.find(t=>t.id===template)||TEMPLATES[0];
  const notice=error&&!modal&&<div role="alert" className="notice"><span>{error}</span><button type="button" onClick={()=>setError('')} aria-label="关闭提示">×</button></div>;

  return <div className="shell">
    <header className="appbar">
      <a className="brand-home" href={sitePath('/')} aria-label="书页 · 项目库" title="书页"><svg viewBox="0 0 48 48" width="28" height="28" aria-hidden="true" focusable="false"><use href={sitePath('/brand/shuye-mark.svg#mark')}/></svg></a>
      <nav className="workspaces" aria-label="工作区">
        <button type="button" onClick={()=>setTab('projects')} aria-current={isLibrary?'page':undefined}>项目库</button>
        <button type="button" onClick={()=>setTab('agent')} aria-current={tab==='agent'?'page':undefined}>Agent 任务</button>
        <a href={sitePath('/issue.html')}>整期编排</a>
        <button type="button" onClick={()=>setTab('templates')} aria-current={tab==='templates'?'page':undefined}>模板</button>
      </nav>
      <div className="appbar-end">
        <button type="button" className="quiet" onClick={()=>setTab('agent')} aria-current={tab==='agent'?'page':undefined} title="Agent 任务与 MCP 连接"><Braces size={15}/>接入</button>
        <button type="button" className="quiet" onClick={()=>setTab('guide')} aria-current={tab==='guide'?'page':undefined} title="使用说明"><HelpCircle size={15}/>说明</button>
        <span className="bar-rule" aria-hidden="true"/>
        <div className="account"><span className="avatar" aria-hidden="true">{user?user.slice(0,1).toUpperCase():'访'}</span><span>{user||'访客'}</span>{user?<a href={sitePath('/signout-with-chatgpt?return_to=/')} target="_top">退出</a>:<a href={sitePath('/signin-with-chatgpt?return_to=/')} target="_top">登录</a>}</div>
      </div>
    </header>

    <main className="board">
      {isLibrary&&<section className={'library'+(tab==='archive'?' is-archive-view':'')} aria-labelledby="libHeading">
        <div className="library-heading"><h1 id="libHeading">{tab==='archive'?'归档':'项目库'}</h1><button type="button" className="text-link" onClick={()=>startFrom('journal')}>从学术期刊模板开始<ArrowUpRight size={14}/></button></div>
        <div className="lib-toolbar">
          <div className="segmented" role="group" aria-label="项目范围">
            <button type="button" aria-pressed={tab==='projects'} onClick={()=>setTab('projects')}>在用<b>{active.length}</b></button>
            <button type="button" aria-pressed={tab==='archive'} onClick={()=>setTab('archive')}>归档<b>{archived.length}</b></button>
          </div>
          <label className="search"><Search size={15} aria-hidden="true"/><input ref={searchRef} type="search" aria-label="搜索项目" placeholder="搜索" value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>{if(e.key==='Escape'&&search){e.preventDefault();setSearch('');}}}/>{!search&&<kbd aria-hidden="true">/</kbd>}</label>
          {tab==='projects'&&<><input ref={importRef} type="file" accept=".doc,.docx" hidden onChange={e=>{const file=e.target.files?.[0];e.target.value='';void importWord(file);}}/><button type="button" disabled={importing} aria-busy={importing||undefined} onClick={()=>user?importRef.current?.click():signIn()}>{importing?<LoaderCircle className="spin" size={15}/>:<Upload size={15}/>}导入 Word</button><button type="button" className="primary" disabled={importing} onClick={newProject}><Plus size={15}/>新建项目</button></>}
        </div>
        {notice}
        {importing&&<p role="status" className="notice">正在导入原稿并核对公式、图表与文字，请保留此页面。</p>}
        {loading?<div className="shelf" aria-hidden="true">{[0,1,2,3,4].map(i=><div className="volume" key={i}><div className="volume-ghost"/><div className="volume-meta"><span className="ghost-line"/></div></div>)}</div>
        :visible.length?<div className="shelf" role="list">{visible.map(p=><article className={'volume'+(p.archived?' is-archived':'')} role="listitem" key={p.projectId}>
            <a className="volume-cover" href={sitePath('/editor/index.html?project=')+p.projectId} aria-label={'打开 '+p.title}>
              <span className={'cover-title'+titleSize(p.title)}>{p.title}</span><i className="cover-rule" aria-hidden="true"/>
              {/* 印记与应用栏同用 <use>：颜色由 CSS 决定，强制颜色模式下随系统文字色，不依赖 SVG 图像的默认黑色。 */}
              <span className="cover-foot" aria-hidden="true"><svg className="cover-imprint" viewBox="0 0 48 48" width="16" height="16" focusable="false"><use href={sitePath('/brand/shuye-mark.svg#mark')}/></svg><span>{p.blockCount} 个组件 · r{p.revision}</span></span>
            </a>
            <div className="volume-meta">
              <time dateTime={p.updatedAt} title={new Date(p.updatedAt).toLocaleString('zh-CN')}>{when(p.updatedAt)}</time>
              <button type="button" className="volume-act" disabled={pending===p.projectId} aria-busy={pending===p.projectId||undefined} aria-label={(p.archived?'恢复 ':'归档 ')+p.title} title={p.archived?'恢复到在用':'归档'} onClick={()=>archive(p)}>{pending===p.projectId?<LoaderCircle className="spin" size={15}/>:p.archived?<RotateCcw size={15}/>:<Archive size={15}/>}</button>
            </div>
          </article>)}</div>
        :search?<p className="shelf-empty">没有与“{search.trim()}”匹配的项目</p>
        :tab==='archive'?<p className="shelf-empty">没有归档项目</p>
        :<div className="shelf">{user
          ?<div className="volume"><button type="button" className="volume-blank" onClick={newProject}><Plus size={22}/><span>新建项目</span></button></div>
          :<div className="volume"><button type="button" className="volume-blank" onClick={signIn}><Plus size={22}/><span>登录后新建</span></button><div className="volume-meta"><a className="text-link" href={sitePath('/editor/index.html')}>打开示例文稿<ArrowUpRight size={13}/></a></div></div>}</div>}
      </section>}

      {tab==='templates'&&<section className="tpl-stage" aria-labelledby="tplHeading">
        <h1 id="tplHeading" className="a11y-hidden">排版模板</h1>
        {notice}
        <div className="tpl-shelf">{TEMPLATES.map(t=><button type="button" className="tpl" key={t.id} onClick={()=>startFrom(t.id)} aria-label={`以${t.name}新建项目`}>
          <Sheet t={t} s={1} title={t.sample}/>
          <span className="tpl-caption"><strong>{t.name}</strong><small>{t.w} × {t.h}{t.cols>1?` · ${t.cols} 栏`:''}{t.vertical?' · 竖排':''}</small></span>
        </button>)}</div>
      </section>}

      {tab==='agent'&&<article className="agent-board">
        <div className="library-heading"><h1>Agent 任务</h1><button className="text-link" onClick={()=>setTab('projects')}>选择文稿，下达任务<ArrowUpRight size={14}/></button></div>
        {agentError&&<p role="status" className="notice">{agentError}</p>}
        {!user?<p className="agent-board-empty">登录后查看你的 Agent 任务。</p>:agentAvailable===false?<p className="agent-board-empty">当前服务未启用后台任务。外部 Agent 仍可通过 MCP 操作文稿。</p>:agentAvailable===null?<p className="agent-board-empty">正在连接任务…</p>:agentTasks.length===0?<div className="agent-board-empty"><h2>下达目标，回来审阅。</h2><p>在期刊文稿中发起任务，Agent 完成排版与校样。</p><button className="primary" onClick={()=>setTab('projects')}>选择文稿<ArrowUpRight size={14}/></button></div>:<>
          <div className="agent-board-counts">{['running','needs_attention','review','accepted'].map(status=><span key={status}><strong>{agentTasks.filter(t=>t.status===status&&!t.stale).length}</strong>{TASK_NAMES[status]}</span>)}</div>
          <div className="agent-task-list">{agentTasks.map(task=><a key={task.taskId} className="agent-task-row" href={sitePath('/editor/index.html?project=')+encodeURIComponent(task.projectId)+'&task='+encodeURIComponent(task.taskId)}>
            <span className="agent-task-state" data-state={task.stale?'stale':task.status}>{task.stale?'版本已更新':TASK_NAMES[task.status]||task.status}</span>
            <div><h2>{projects.find(p=>p.projectId===task.projectId)?.title||task.projectId}</h2><p>{task.issue?.message||task.goal}</p></div>
            <span className="agent-task-meta">{task.proof?`${task.proof.pages} 页校样`:`r${task.appliedRevision||task.revision}`}<small>{when(task.createdAt)}</small></span><ArrowUpRight size={16}/>
          </a>)}</div>
        </>}
        <details className="agent-connect"><summary>接入外部 Agent · MCP</summary><div className="agent-connect-body"><p>使用同一组工具读取文稿、下达任务、查询进度、继续与撤销。</p><code className="endpoint">POST {sitePath('/mcp')}</code><pre className="code">{`get_project_context → start_agent_task → get_agent_task
                                   ↳ resume_agent_task / undo_agent_task`}</pre><p>任务需要 requestId 与 expectedRevision；重试提交复用同一 requestId。底层组件操作仍支持 dryRun 和修订校验。</p>{globalThis.__SHUYE_BASE__&&<a className="text-link" href={sitePath('/account')}>账号与 MCP 令牌设置<ArrowUpRight size={13}/></a>}</div></details>
      </article>}

      {tab==='guide'&&<article className="doc">
        <h1>使用说明与功能范围</h1>
        <section><h2>完成一份期刊稿件</h2><div><ol><li>从“学术期刊”模板起稿，或在编辑器中导入期刊 Word。</li><li>检查中英文首面角色，补全刊名、卷期与出版信息。</li><li>向 Agent 下达版式目标。它会检查结构、制定方案并自动应用版式。</li><li>Agent 生成 PDF 校样并检查质量；你处理异常、审阅页面，必要时整次撤销。</li><li>逐页核对后交编辑验收；每次返修保留修订记录，可恢复历史版本。</li></ol></div></section>
        <section><h2>限制</h2><div><p>单工程最大 20 MB。排版建议使用桌面浏览器。字体来自访问设备，跨设备分页可能不同。</p></div></section>
        <section><h2>已实现与待完成</h2><div><p>支持流式排版、横竖排、分栏、结构化章节、图片绕排、合并表格、数学公式、注音、注释引用、云端版本与 MCP。</p><p>支持自由图文框串接、母版、跨页表格和长注、ICC 色彩转换、受限 PDF/X-4 输出与有限 PDML 编辑。完整飞翔原生双向兼容与完整 PDF/X 合规验证尚未完成。</p><a className="text-link" href="https://www.founderfx.cn/product/1012.jhtml" target="_blank" rel="noreferrer">功能参照：飞翔印刷版 9.0-1794<ArrowUpRight size={13}/></a></div></section>
        <footer className="doc-colophon">书页 0.7.0</footer>
      </article>}
    </main>

    {modal&&<div className="modal-backdrop" onClick={e=>{if(e.target===e.currentTarget&&!creating)setModal(false);}}>
      <form ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="createTitle" className="create-dialog" onSubmit={e=>{e.preventDefault();create();}}>
        <div className={'create-preview'+(title.trim()?'':' is-placeholder')}><Sheet t={chosen} s={1.08} title={title.trim()||'未命名'}/></div>
        <div className="create-form">
          <h2 id="createTitle">新建项目</h2>
          <label className="title-field"><span className="a11y-hidden">项目名称</span><input autoFocus maxLength={120} value={title} onChange={e=>setTitle(e.target.value)} placeholder="书名或项目名称" required/></label>
          <fieldset className="tpl-choices"><legend className="a11y-hidden">起始版式</legend>
            {TEMPLATES.map(t=><label key={t.id} className={'tpl-choice'+(template===t.id?' is-on':'')}><input type="radio" name="template" value={t.id} checked={template===t.id} onChange={()=>setTemplate(t.id)}/><Sheet t={t} s={.2} title="" mini/><span>{t.name}</span></label>)}
          </fieldset>
          {error&&<p role="alert" className="form-error">{error}</p>}
          <div className="dialog-actions"><button type="button" className="quiet" disabled={creating} onClick={()=>setModal(false)}>取消</button><button className="primary" disabled={creating} aria-busy={creating||undefined}>{creating?<><LoaderCircle className="spin" size={15}/>正在创建…</>:<>创建并打开<ArrowUpRight size={15}/></>}</button></div>
        </div>
      </form>
    </div>}
  </div>;
}
