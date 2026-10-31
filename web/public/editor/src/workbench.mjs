import {setupAgentTasks} from './agent-task-ui.mjs';
import {blockLabel} from './block-actions.mjs';
import {figureGroups} from './figure-audit.mjs';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const button=(text,fn,cls)=>{const b=el('button',text,cls);b.type='button';b.onclick=fn;return b;};
const messages={LAYOUT_ASSISTANT_UNAVAILABLE:'当前服务器尚未配置排版助手。',ASSISTANT_BUSY_RETRY:'另一项建议正在生成，请稍后重试。',ASSISTANT_COMPOSITION_NOT_SUPPORTED:'自由版面请使用精确排版工具；当前助手支持流式与期刊版式。',REVISION_CONFLICT:'文稿版本已变化，请重新生成建议。',PLAN_NOT_REVIEWABLE:'这份建议已处理，不能重复应用。',PLAN_NOT_APPLIED:'当前没有可撤销的助手修改。',MODEL_INCOMPLETE_RESPONSE:'模型没有完整返回建议，请重试。',ASSISTANT_MODEL_NOT_INSTALLED:'排版模型尚未准备好，请联系部署管理员。'};
export function commandGroup(name){
 if(/批注|笔迹/.test(name))return '批改';
 if(/PDF|打印|校样/.test(name))return '校样';
 if(/PDML|自由版面|工程库|版本比较/.test(name))return '高级';
 if(/打开|导入|保存|另存|备份|版本|恢复|新建/.test(name))return '文稿';
 if(/插入|＋|目录|索引|注释|文献|符号|书签|^表格$|^公式$/.test(name))return '插入';
 return '版式';
}

const SVG='http://www.w3.org/2000/svg';
const paths={
 back:'M11.5 5 6.5 10l5 5',
 outline:'M7.5 5.5h9M7.5 10h9M7.5 14.5h6M3.75 5.5h.5M3.75 10h.5M3.75 14.5h.5',
 panel:'M3.5 4.5h13v11h-13zM12.5 4.5v11',
 undo:'M7.5 4.5 4 8l3.5 3.5M4.5 8H12a4 4 0 0 1 0 8H9.5',
 redo:'M12.5 4.5 16 8l-3.5 3.5M15.5 8H8a4 4 0 0 0 0 8h2.5',
 plus:'M10 4.5v11M4.5 10h11',
 minus:'M4.5 10h11',
 search:'M8.75 14.25a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM12.75 12.75 16.5 16.5',
 pen:'M3.5 16.5l1-4L13 4l3 3-8.5 8.5-4 1zM11 6l3 3',
 up:'M5.5 12.5 10 8l4.5 4.5',
 down:'M5.5 7.5 10 12l4.5-4.5',
 close:'M5.5 5.5l9 9M14.5 5.5l-9 9',
 grid:'M4 4h4.5v4.5H4zM11.5 4H16v4.5h-4.5zM4 11.5h4.5V16H4zM11.5 11.5H16V16h-4.5z',
 caret:'M7 8.5l3 3 3-3',
 text:'M4 5h12M10 5v11M7.5 16h5',
 heading:'M4 4v12M16 4v12M4 10h12',
 image:'M3.5 4.5h13v11h-13zM5 13l3.2-3.2 2.4 2.2 2-2 2.9 3M13 7h.1',
 table:'M3.5 4.5h13v11h-13zM3.5 8.2h13M3.5 11.8h13M8 4.5v11M12.2 4.5v11',
 formula:'M13.5 4.5H7l3.5 5L7 15h6.5'
};
const svgEl=(tag,attrs={})=>{const n=document.createElementNS(SVG,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));return n;};
const icon=name=>{const s=svgEl('svg',{viewBox:'0 0 20 20','aria-hidden':'true',focusable:'false',class:'wb-icon'});s.append(svgEl('path',{d:paths[name]}));return s;};
const iconButton=(name,text,fn,cls)=>{const b=button('',fn,cls);b.append(icon(name),el('span',text,'wb-label'));return b;};
const mac=/Mac|iPhone|iPad/i.test(navigator.userAgentData?.platform||navigator.platform||'');
const keys=combo=>mac?combo.replace('Mod+','⌘').replace('Shift+','⇧').replace('Alt+','⌥'):combo.replace('Mod+','Ctrl+');
const ariaKeys=combo=>combo.replace('Mod+',mac?'Meta+':'Control+');
const modKey=e=>mac?e.metaKey:e.ctrlKey;

// 按真实毫米比例绘制的对页（或单页）示意：开本、边距、栏、按“字号 × 行距”计算的行密度。
function spread(layout,{single=false,changed=null,scale=0}={}){
 const n=(k,d)=>{const v=Number(layout[k]);return Number.isFinite(v)&&v>0?v:d;};
 const w=n('width',185),h=n('height',260),top=Math.min(n('top',20),h/2-1),bottom=Math.min(n('bottom',20),h/2-1),inner=Math.min(n('inner',20),w/2-1),outer=Math.min(n('outer',20),w/2-1);
 const columns=Math.max(1,Math.min(4,Math.round(n('columns',1)))),gap=Math.max(0,Number(layout.gap)||0),size=n('fontSize',10.5)*25.4/72,pitch=size*n('lineHeight',1.5),vertical=layout.writingMode==='vertical-rl';
 const pages=single?1:2,svg=svgEl('svg',{viewBox:`0 0 ${w*pages} ${h}`,class:'wb-spread','aria-hidden':'true',focusable:'false'});
 if(scale){svg.setAttribute('width',(w*pages*scale).toFixed(1));svg.setAttribute('height',(h*scale).toFixed(1));}
 const add=(tag,attrs,field)=>{const node=svgEl(tag,attrs);if(field){node.dataset.field=field;if(changed&&field.split(' ').some(f=>changed.has(f)))node.classList.add('is-changed');}svg.append(node);return node;};
 for(let p=0;p<pages;p++){
  const recto=single||p===1,x=p*w,left=recto?inner:outer,right=recto?outer:inner,bw=Math.max(1,w-left-right),bh=Math.max(1,h-top-bottom),cw=Math.max(.5,(bw-gap*(columns-1))/columns);
  add('rect',{x,y:0,width:w,height:h,class:'sheet'},'width height');
  add('rect',{x,y:0,width:w,height:top,class:'band'},'top');
  add('rect',{x,y:h-bottom,width:w,height:bottom,class:'band'},'bottom');
  add('rect',{x,y:top,width:left,height:bh,class:'band'},recto?'inner':'outer');
  add('rect',{x:x+w-right,y:top,width:right,height:bh,class:'band'},recto?'outer':'inner');
  let d='';
  for(let c=0;c<columns;c++){
   const cx=x+left+c*(cw+gap),count=Math.min(240,Math.floor((vertical?cw:bh)/pitch));
   if(c)add('rect',{x:cx-gap,y:top,width:gap||.4,height:bh,class:'gutter'},'gap columns');
   for(let i=0;i<count;i++){const ratio=i%7===6?.46:i%11===10?.7:1;d+=vertical?`M${(cx+cw-(i+.5)*pitch).toFixed(2)} ${top.toFixed(2)}v${(bh*ratio).toFixed(2)}`:`M${cx.toFixed(2)} ${(top+(i+.5)*pitch).toFixed(2)}h${(cw*ratio).toFixed(2)}`;}
  }
  add('rect',{x:x+left,y:top,width:bw,height:bh,class:'textblock'},'columns');
  if(d)add('path',{d,class:'lines','stroke-width':(size*.56).toFixed(2)},'fontSize lineHeight');
  add('circle',{cx:x+w/2,cy:h-bottom/2,r:Math.max(.8,Math.min(1.6,bottom/6)),class:'folio'},'pageStart');
 }
 if(!single)add('line',{x1:w,y1:0,x2:w,y2:h,class:'spine'});
 return svg;
}

export function setupWorkbench({getDoc,getSelected=()=>null,select=()=>{},connection,fit}){
 const $=id=>document.getElementById(id),body=document.body;
 body.classList.add('workbench');
 const canvas=document.querySelector('.canvas'),workspace=document.querySelector('.workspace'),structure=document.querySelector('.structure'),inspector=document.querySelector('.inspector');
 const reduced=matchMedia('(prefers-reduced-motion: reduce)'),motion=()=>reduced.matches?'auto':'smooth';
 const store=(()=>{try{return JSON.parse(localStorage.getItem('shuye-workbench-ui'))||{};}catch{return {};}})();
 const remember=patch=>{Object.assign(store,patch);try{localStorage.setItem('shuye-workbench-ui',JSON.stringify(store));}catch{}};
 const openDialog=()=>!!document.querySelector('dialog[open]');
 let compMode=workspace.classList.contains('composition-mode'),view='layout';

 const oldActions=[...document.querySelectorAll('.file-actions button,.toolbar button')];
 const cloudSave=oldActions.find(b=>b.textContent==='保存到云端');
 const commands=oldActions.filter(b=>!['undo','redo'].includes(b.id)&&b!==cloudSave);
 if($('newDoc'))commands.push($('newDoc'));
 commands.push($('deleteBlock'));
 const find=text=>commands.find(b=>b.textContent.trim()===text);
 const modeSwitch=commands.find(b=>/^(自由版面|返回正文)$/.test(b.textContent.trim()));
 // 代理按钮只转发到原按钮，并同步原按钮的禁用状态；原有检查全部保留在原按钮里。
 const proxy=(source,make)=>{if(!source)return null;const b=make();b.type='button';b.onclick=()=>{if(!source.disabled)source.click();};const mirror=()=>{b.disabled=source.disabled;};new MutationObserver(mirror).observe(source,{attributes:true,attributeFilter:['disabled']});mirror();return b;};

 // —— 全部工具（命令面板）
 const dialog=el('dialog',undefined,'command-dialog');dialog.setAttribute('aria-labelledby','commandTitle');
 const dialogHead=el('div',undefined,'command-heading'),title=el('h2','全部工具');title.id='commandTitle';
 const closeCommands=button('',()=>dialog.close(),'command-close');closeCommands.append(el('kbd','Esc'));closeCommands.setAttribute('aria-label','关闭');
 dialogHead.append(title,closeCommands);
 const searchBox=el('div',undefined,'command-search'),search=el('input');search.type='search';search.placeholder='搜索工具，如表格、公式、笔迹…';search.setAttribute('aria-label','搜索工具');search.setAttribute('aria-controls','commandBody');search.autocomplete='off';
 searchBox.append(icon('search'),search);
 const commandBody=el('div',undefined,'command-body');commandBody.id='commandBody';
 const empty=el('p','没有匹配工具。','command-empty');empty.hidden=true;
 const foot=el('div',undefined,'command-foot');foot.setAttribute('aria-hidden','true');
 for(const [k,t] of [['↑↓','选择'],['Enter','执行'],['Esc','关闭']]){const s=el('span');s.append(el('kbd',k),t);foot.append(s);}
 dialog.append(dialogHead,searchBox,commandBody,empty,foot);document.body.append(dialog);
 const viewCommands=[['文稿结构',()=>{if(!compMode)setDock('left',true,{focus:true});}],['版式设置',()=>showProps('layout',true)],['当前组件属性',()=>showProps('block',true)],['Agent 任务',()=>showProps('assistant',true)]].map(([text,fn])=>button(text,fn));
 const registry=[...commands.map(node=>({node,group:node.id==='help'?'帮助':commandGroup(node.textContent)})),...viewCommands.map(node=>({node,group:'视图'}))];
 for(const group of ['文稿','插入','版式','校样','批改','高级','视图','帮助']){
  const items=registry.filter(x=>x.group===group);if(!items.length&&group!=='文稿')continue;
  const section=el('section');section.setAttribute('aria-label',group);section.append(el('h3',group));const row=el('div',undefined,'command-items');
  for(const item of items){item.node.classList.remove('primary');item.node.classList.add('command-item');item.node.addEventListener('click',()=>dialog.close(),{capture:true});row.append(item.node);}
  if(group==='文稿'){
   const revisionPolicy=document.querySelector('select[aria-label="Word 修订导入策略"]');
   if(revisionPolicy){const label=el('label','导入 Word 时的修订处理');label.append(revisionPolicy);row.append(label);}
  }
  section.append(row);commandBody.append(section);
 }
 const visibleItems=()=>[...commandBody.querySelectorAll('.command-items>button')].filter(b=>!b.hidden&&!b.disabled&&!b.closest('section').hidden);
 const filter=()=>{
  const q=search.value.trim().toLowerCase();let visible=0;
  for(const item of registry){item.node.hidden=!!q&&!item.node.textContent.trim().toLowerCase().includes(q)&&!item.group.includes(q);if(!item.node.hidden)visible++;}
  for(const section of commandBody.children)section.hidden=![...section.querySelectorAll('button')].some(b=>!b.hidden);
  empty.hidden=!!visible;
  for(const b of commandBody.querySelectorAll('.is-first'))b.classList.remove('is-first');
  if(q)visibleItems()[0]?.classList.add('is-first');
 };
 search.oninput=filter;
 search.addEventListener('keydown',e=>{if(e.key==='ArrowDown'){e.preventDefault();visibleItems()[0]?.focus();}else if(e.key==='Enter'&&search.value.trim()){e.preventDefault();visibleItems()[0]?.click();}});
 commandBody.addEventListener('keydown',e=>{
  const items=visibleItems(),i=items.indexOf(document.activeElement);if(i<0)return;
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const next=i+(e.key==='ArrowDown'?1:-1);(next<0?search:items[Math.min(items.length-1,next)]).focus();}
  else if(e.key==='Home'||e.key==='End'){e.preventDefault();items[e.key==='Home'?0:items.length-1].focus();}
  else if(e.key.length===1&&e.key!==' '&&!e.ctrlKey&&!e.metaKey&&!e.altKey)search.focus();
 });
 const openCommands=(q,heading)=>{title.textContent=heading||'全部工具';search.value=q||'';filter();if(!dialog.open)dialog.showModal();search.focus();};
 document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();if(!dialog.open)openCommands('');}});

 // —— 提示卡
 const live=el('div',undefined,'wb-sr');live.setAttribute('aria-live','polite');
 const toast=el('div',undefined,'wb-toast'),toastText=el('p');toast.hidden=true;
 const toastClose=iconButton('close','关闭提示',()=>hideToast(),'wb-toast-close wb-icon-only');toast.append(toastText,toastClose);
 const toastUndo=button('撤销',()=>{$('undo').click();hideToast();},'wb-toast-undo');toastUndo.hidden=true;toast.append(toastUndo);
 let toastTimer;
 function hideToast(){clearTimeout(toastTimer);toast.hidden=true;}
 function notify(text,tone='info',sticky=false){clearTimeout(toastTimer);toastUndo.hidden=true;toastText.textContent=text;toast.dataset.tone=tone;toast.hidden=false;live.setAttribute('aria-live',tone==='error'?'assertive':'polite');live.textContent=text;if(!sticky&&tone!=='error')toastTimer=setTimeout(hideToast,9000);}
 document.addEventListener('shuye:notice',e=>{notify(e.detail.message,e.detail.tone);toastUndo.hidden=!e.detail.undo;});
 document.addEventListener('shuye:document-changed',()=>{toastUndo.hidden=true;});
 body.append(toast,live);

 // —— 顶栏：左侧是文稿身份，右侧是动作；撤销/重做和保存状态都放在对应动作旁边
 const header=el('header',undefined,'wb-header');
 const back=document.querySelector('.back-library');
 // index.html 写死了 "/"；改为相对编辑器目录的上一级，独立部署带前缀时也能回到项目库。
 if(back){
  back.classList.add('wb-back');back.href=new URL('../',location.href).href;back.title='返回项目库';back.setAttribute('aria-label','书页 · 返回项目库');
  const mark=svgEl('svg',{viewBox:'0 0 48 48',width:28,height:28,'aria-hidden':'true',focusable:'false',class:'wb-brand'});
  mark.append(svgEl('use',{href:new URL('../../brand/shuye-mark.svg#mark',import.meta.url).href}));
  back.replaceChildren(icon('back'),mark);
 }
 const name=$('title'),state=$('saveState');name.classList.add('wb-title');
 const route=el('span',undefined,'wb-route');
 const modeReturn=proxy(modeSwitch,()=>el('button','返回正文','wb-mode-return'));if(modeReturn)modeReturn.hidden=true;
 const stateBox=el('span',undefined,'wb-state'),stateDot=el('span',undefined,'wb-dot');stateDot.setAttribute('aria-hidden','true');stateBox.append(stateDot,state);
 const titleBlock=el('div',undefined,'wb-identity');titleBlock.append(...[name,route,modeReturn].filter(Boolean));
 const outlineToggle=iconButton('outline','结构',()=>toggleDock('left'),'wb-toggle');outlineToggle.title=`文稿结构 · ${keys('Alt+1')}`;outlineToggle.setAttribute('aria-keyshortcuts','Alt+1');
 const undo=$('undo'),redo=$('redo');
 for(const [node,iconName,text,combo] of [[undo,'undo','撤销','Mod+Z'],[redo,'redo','重做','Mod+Shift+Z']]){node.replaceChildren(icon(iconName),el('span',text,'wb-label'));node.classList.add('wb-icon-only');node.title=`${text} · ${keys(combo)}`;node.setAttribute('aria-keyshortcuts',ariaKeys(combo));}
 const historyGroup=el('div',undefined,'wb-history');historyGroup.setAttribute('role','group');historyGroup.setAttribute('aria-label','撤销与重做');historyGroup.append(undo,redo);
 const actions=el('div',undefined,'wb-actions');
 actions.append(historyGroup,el('span',undefined,'wb-bar-rule'),stateBox);
 if(cloudSave){cloudSave.textContent='保存';cloudSave.classList.remove('primary');cloudSave.classList.add('wb-save');cloudSave.title=`保存到云端 · ${keys('Mod+S')}`;cloudSave.setAttribute('aria-keyshortcuts',ariaKeys('Mod+S'));actions.append(cloudSave);}
 const proofButton=button('出校样',()=>runProof(),'primary wb-proof');
 const toolsButton=iconButton('grid','工具',()=>openCommands(''),'wb-tools');toolsButton.append(el('kbd',keys('Mod+K')));toolsButton.title=`全部工具 · ${keys('Mod+K')}`;toolsButton.setAttribute('aria-keyshortcuts',ariaKeys('Mod+K'));toolsButton.setAttribute('aria-haspopup','dialog');
 const panelToggle=iconButton('panel','属性',()=>toggleDock('right'),'wb-toggle');panelToggle.title='Agent 任务、版式与组件';
 const progress=el('div',undefined,'wb-progress');progress.setAttribute('aria-hidden','true');
 const assistantEntry=button('Agent 任务',()=>showProps('assistant',true),'wb-tools wb-assistant-entry');
 const importEntry=proxy(find('导入期刊 Word'),()=>button('导入 Word',undefined,'wb-tools'));
 if(importEntry)actions.append(importEntry);
 actions.append(assistantEntry,proofButton,toolsButton,panelToggle);
 header.append(...[back,titleBlock,actions,progress].filter(Boolean));
 body.prepend(header);

 // —— 左右抽屉与舞台
 const closeButton=(text,fn)=>{const b=iconButton('close',text,fn,'wb-dock-close wb-icon-only');b.title=text;return b;};
 const leftDock=el('div',undefined,'wb-dock wb-dock-left'),rightDock=el('div',undefined,'wb-dock wb-dock-right');leftDock.id='wbStructure';rightDock.id='wbProperties';
 outlineToggle.setAttribute('aria-controls',leftDock.id);panelToggle.setAttribute('aria-controls',rightDock.id);
 const stage=el('div',undefined,'wb-stage');canvas.before(stage);
 const rail=el('nav',undefined,'wb-toolrail');rail.setAttribute('aria-label','常用工具');
 structure.hidden=false;inspector.hidden=false;leftDock.append(structure);
 const outlineList=structure.querySelector('#outline'),outlineHead=structure.querySelector('.panel-heading');
 outlineHead?.append(closeButton('收起文稿结构',()=>setDock('left',false)));
 const filterBox=el('label',undefined,'wb-filter'),outlineFilter=el('input'),filterCount=el('span',undefined,'wb-filter-count');
 outlineFilter.type='search';outlineFilter.placeholder='筛选';outlineFilter.autocomplete='off';outlineFilter.setAttribute('aria-label','筛选文稿结构');outlineFilter.setAttribute('aria-controls','outline');filterCount.setAttribute('aria-live','polite');
 filterBox.append(icon('search'),outlineFilter,filterCount);
 if(outlineHead)outlineHead.after(filterBox);else structure.prepend(filterBox);

 const dockHead=el('div',undefined,'wb-dock-head'),tablist=el('div',undefined,'wb-tabs');tablist.setAttribute('role','tablist');tablist.setAttribute('aria-label','属性');
 const compView=el('div',undefined,'wb-view-composition');compView.id='wbComposition';
 const compPanel=document.querySelector('.composition-inspector');if(compPanel)compView.append(compPanel);
 const panel=el('section',undefined,'assistant-panel');panel.id='layoutAssistant';
 const tabs={};
 for(const [key,text,target,combo] of [['assistant','Agent',panel,'Alt+4'],['layout','版式',$('layoutPanel'),'Alt+2'],['block','组件',$('blockPanel'),'Alt+3'],['composition','页面',compView,'Alt+2']]){
  const tab=button(text,()=>{setView(key);if(!compMode)remember({view});},'wb-tab');tab.id='wbTab-'+key;tab.setAttribute('role','tab');tab.setAttribute('aria-controls',target.id);tab.title=`${text} · ${keys(combo)}`;
  target.setAttribute('role','tabpanel');target.setAttribute('aria-labelledby',tab.id);tabs[key]=tab;tablist.append(tab);
 }
 tablist.addEventListener('keydown',e=>{const list=[...tablist.querySelectorAll('[role=tab]:not([hidden])')],i=list.indexOf(document.activeElement);if(i<0)return;const next={ArrowRight:i+1,ArrowLeft:i-1,Home:0,End:list.length-1}[e.key];if(next===undefined)return;e.preventDefault();const tab=list[(next+list.length)%list.length];tab.focus();tab.click();});
 dockHead.append(tablist,closeButton('收起属性',()=>setDock('right',false)));
 rightDock.append(dockHead,inspector,compView,panel);
 workspace.prepend(rail,leftDock);workspace.append(rightDock);

 const docks={left:leftDock,right:rightDock},toggles={left:outlineToggle,right:panelToggle};
 const overlayQuery={left:matchMedia('(max-width: 1279px)'),right:matchMedia('(max-width: 899px)')};
 const isOverlay=side=>overlayQuery[side].matches;
 const wideLeft=()=>store.left??innerWidth>=1440;
 function setDock(side,open,{focus=false,persist=true}={}){
  if(side==='left'&&compMode)open=false;
  const dock=docks[side],other=side==='left'?'right':'left';
  if(open&&isOverlay(side)&&isOverlay(other)&&!docks[other].hidden)setDock(other,false,{persist:false});
  if(!open&&dock.contains(document.activeElement))toggles[side].focus();
  dock.hidden=!open;toggles[side].setAttribute('aria-expanded',String(open));
  body.classList.toggle('wb-overlay-open',['left','right'].some(s=>!docks[s].hidden&&isOverlay(s)));
  if(persist&&!isOverlay(side))remember({[side]:open});
  if(open){if(side==='left')revealActive();else drawSpread();if(focus)(side==='left'?outlineFilter:tabs[view]).focus();}
 }
 function toggleDock(side){setDock(side,docks[side].hidden,{focus:isOverlay(side)});}
 function showProps(key,focus=false){setView(key);setDock('right',true,{focus:focus||isOverlay('right')});if(!compMode)remember({view});}
 function paintTabs(){tabs.layout.hidden=tabs.block.hidden=compMode;tabs.composition.hidden=!compMode;for(const [key,tab] of Object.entries(tabs)){tab.setAttribute('aria-selected',String(key===view));tab.tabIndex=key===view?0:-1;}}
 function setView(key,focus=false){
  if(compMode&&(key==='layout'||key==='block'))key='composition';
  if(!compMode&&key==='composition')key='layout';
  view=key;
  inspector.hidden=!(key==='layout'||key==='block');compView.hidden=key!=='composition';panel.hidden=key!=='assistant';
  if(key==='layout')$('tabLayout').click();else if(key==='block')$('tabBlock').click();
  paintTabs();drawSpread();
  if(focus)tabs[key].focus();
 }
 // 在纸面点选段落时，app.mjs 会切换到“当前段落”；属性抽屉跟随，但不打断正在使用的助手。
 new MutationObserver(()=>{if(view!=='layout'&&view!=='block')return;const next=$('tabBlock').getAttribute('aria-selected')==='true'?'block':'layout';if(next!==view){view=next;paintTabs();drawSpread();}}).observe($('tabBlock'),{attributes:true,attributeFilter:['aria-selected']});
 for(const side of ['left','right'])overlayQuery[side].addEventListener?.('change',e=>{if(e.matches)setDock(side,false,{persist:false});else setDock(side,side==='left'?wideLeft():store.right??true,{persist:false});});
 const scrim=el('div',undefined,'wb-scrim');
 scrim.addEventListener('click',()=>{for(const side of ['left','right'])if(isOverlay(side)&&!docks[side].hidden)setDock(side,false,{persist:false});});

 // —— 文稿结构
 function applyFilter(){const q=outlineFilter.value.trim().toLowerCase();let count=0;for(const b of outlineList.children){const hit=!q||b.textContent.toLowerCase().includes(q);b.hidden=!hit;if(hit)count++;}filterCount.textContent=q?`${count} 项`:'';}
 function revealActive(){if(!leftDock.hidden)outlineList.querySelector('button.active:not([hidden])')?.scrollIntoView({block:'nearest'});}
 outlineFilter.addEventListener('input',applyFilter);
 outlineFilter.addEventListener('keydown',e=>{if(e.key==='ArrowDown'){e.preventDefault();outlineList.querySelector('button:not([hidden])')?.focus();}else if(e.key==='Escape'&&outlineFilter.value){e.preventDefault();outlineFilter.value='';applyFilter();}});
 outlineList.addEventListener('keydown',e=>{const items=[...outlineList.querySelectorAll('button:not([hidden])')],i=items.indexOf(document.activeElement);if(i<0)return;const next={ArrowDown:i+1,ArrowUp:i-1,Home:0,End:items.length-1}[e.key];if(next===undefined)return;e.preventDefault();if(next<0){outlineFilter.focus();return;}items[Math.min(items.length-1,next)].focus();});
 new MutationObserver(records=>{if(records.some(r=>r.type==='childList'))applyFilter();revealActive();}).observe(outlineList,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});

 // —— 工具栏、插入菜单与状态栏控件
 const group=(label,...nodes)=>{const g=el('div',undefined,'wb-group');g.setAttribute('role','group');g.setAttribute('aria-label',label);g.append(...nodes.filter(Boolean));return g;};
 const insertButton=iconButton('plus','插入',()=>menu.hidden?openMenu():closeMenu(),'wb-insert');insertButton.append(icon('caret'));
 const menu=el('div',undefined,'wb-menu');menu.id='wbInsertMenu';menu.setAttribute('role','menu');menu.setAttribute('aria-label','插入');menu.hidden=true;
 insertButton.setAttribute('aria-haspopup','menu');insertButton.setAttribute('aria-expanded','false');insertButton.setAttribute('aria-controls',menu.id);
 for(const [source,glyph,text] of [[$('addParagraph'),'文','正文'],[$('addHeading'),'题','标题'],[$('addImage'),'图','图片'],[find('表格'),'表','表格'],[find('公式'),'式','公式'],[$('addBreak'),'页','分页'],[find('目录'),'目','目录'],[find('索引'),'索','索引'],[find('注释'),'注','注释'],[find('文献 / 引用'),'引','文献'],[find('符号'),'Ω','符号'],[find('插入章节'),'章','章节']]){
  const item=proxy(source,()=>{const b=el('button',undefined,'wb-menu-item');b.append(el('span',glyph,'wb-glyph'),el('span',text));return b;});if(!item)continue;
  item.setAttribute('role','menuitem');item.tabIndex=-1;
  item.addEventListener('click',()=>{closeMenu(false);setTimeout(()=>{if(!openDialog()&&(!document.activeElement||document.activeElement===body))insertButton.focus();});});
  menu.append(item);
 }
 const menuItems=()=>[...menu.querySelectorAll('[role=menuitem]:not(:disabled)')];
 function openMenu(){menu.hidden=false;insertButton.setAttribute('aria-expanded','true');const s=workspace.getBoundingClientRect(),b=insertButton.getBoundingClientRect();menu.style.left=`${Math.max(8,Math.min(b.right-s.left+8,s.width-menu.offsetWidth-8))}px`;menu.style.top=`${Math.max(8,Math.min(b.top-s.top,s.height-menu.offsetHeight-8))}px`;menu.style.bottom='auto';menuItems()[0]?.focus();}
 function closeMenu(refocus=true){if(menu.hidden)return false;menu.hidden=true;insertButton.setAttribute('aria-expanded','false');if(refocus)insertButton.focus();return true;}
 menu.addEventListener('keydown',e=>{
  const items=menuItems(),i=items.indexOf(document.activeElement),step={ArrowRight:1,ArrowLeft:-1,ArrowDown:4,ArrowUp:-4}[e.key];
  if(step!==undefined){e.preventDefault();items[Math.max(0,Math.min(items.length-1,i+step))]?.focus();}
  else if(e.key==='Home'||e.key==='End'){e.preventDefault();items[e.key==='Home'?0:items.length-1]?.focus();}
  else if(e.key==='Escape'){e.preventDefault();closeMenu();}
  else if(e.key==='Tab')closeMenu(false);
 });
 document.addEventListener('pointerdown',e=>{if(!menu.hidden&&!menu.contains(e.target)&&!insertButton.contains(e.target))closeMenu(false);});
 const findButton=proxy(find('查找替换'),()=>iconButton('search','查找'));if(findButton)findButton.title='查找替换';
 const reviewButton=iconButton('pen','批改',()=>openCommands('批改','批改'));reviewButton.title='审阅批注与批改工具';
 const guides=$('guides'),guideLabel=guides.parentElement,zoomSelect=$('zoom'),zoomLabel=zoomSelect.parentElement;
 const wrapText=label=>{for(const node of [...label.childNodes])if(node.nodeType===3&&node.textContent.trim())node.replaceWith(el('span',node.textContent.trim(),'wb-label'));};
 guideLabel.classList.add('wb-switch');guideLabel.title='版心线';wrapText(guideLabel);
 zoomLabel.classList.add('wb-zoom');wrapText(zoomLabel);
 const zoomSteps=[...zoomSelect.options].map(o=>Number(o.value)).filter(Number.isFinite).sort((a,b)=>a-b);
 const currentZoom=()=>{const m=/scale\(([\d.]+)\)/.exec(canvas.querySelector('.paper')?.style.transform||'');return m?Number(m[1]):Number(zoomSelect.value)||1;};
 const zoomOut=iconButton('minus','缩小',()=>stepZoom(-1),'wb-icon-only'),zoomIn=iconButton('plus','放大',()=>stepZoom(1),'wb-icon-only');
 function stepZoom(dir){const z=currentZoom(),next=dir>0?zoomSteps.find(s=>s>z+.001):[...zoomSteps].reverse().find(s=>s<z-.001);if(next===undefined)return;zoomSelect.value=String(next);zoomSelect.dispatchEvent(new Event('change',{bubbles:true}));paintZoom();}
 function paintZoom(){const z=currentZoom(),fitOption=[...zoomSelect.options].find(o=>o.value==='fit');zoomOut.disabled=!zoomSteps.some(s=>s<z-.001);zoomIn.disabled=!zoomSteps.some(s=>s>z+.001);if(fitOption)fitOption.textContent=zoomSelect.value==='fit'?`适合 · ${Math.round(z*100)}%`:'适合页面';}
 zoomSelect.addEventListener('change',()=>queueMicrotask(paintZoom));
 const pagePrev=iconButton('up','上一页',()=>goTo(pageIndex-1),'wb-icon-only'),pageNext=iconButton('down','下一页',()=>goTo(pageIndex+1),'wb-icon-only');
 const pageInput=el('input',undefined,'wb-page-input'),pageTotal=el('span',undefined,'wb-page-total');
 pageInput.inputMode='numeric';pageInput.autocomplete='off';pageInput.title='输入页码，按 Enter 跳转';pageTotal.setAttribute('aria-hidden','true');
 let pageIndex=0,pageFrame=0;
 const pageWraps=()=>[...canvas.querySelectorAll('#pages > .paper-wrap')];
 const folio=(wrap,i)=>{const m=/第\s*(\d+)\s*页/.exec(wrap?.querySelector('.paper')?.getAttribute('aria-label')||'');return m?Number(m[1]):i+1;};
 function trackPage(){
  const list=pageWraps(),line=canvas.getBoundingClientRect().top+canvas.clientHeight*.4,has=list.length>0;
  pageIndex=0;list.forEach((w,i)=>{if(w.getBoundingClientRect().top<=line)pageIndex=i;});
  const last=has?folio(list.at(-1),list.length-1):0;
  if(document.activeElement!==pageInput)pageInput.value=has?String(folio(list[pageIndex],pageIndex)):'';
  pageTotal.textContent=has?`/ ${last}`:'';pageInput.setAttribute('aria-label',has?`页码，末页 ${last}`:'页码');
  pageInput.disabled=!has;pagePrev.disabled=!has||pageIndex===0;pageNext.disabled=!has||pageIndex>=list.length-1;
 }
 function goTo(index){const list=pageWraps(),w=list[Math.max(0,Math.min(list.length-1,index))];if(w)canvas.scrollTo({top:Math.max(0,w.offsetTop-16),behavior:motion()});}
 pageInput.addEventListener('keydown',e=>{
  if(e.key==='Enter'){e.preventDefault();const n=Number(pageInput.value.trim()),i=pageWraps().findIndex((w,k)=>folio(w,k)===n);pageInput.setAttribute('aria-invalid',String(i<0));if(i>=0){goTo(i);pageInput.blur();}}
  else if(e.key==='Escape'){e.preventDefault();pageInput.blur();}
 });
 pageInput.addEventListener('focus',()=>pageInput.select());
 pageInput.addEventListener('blur',()=>{pageInput.removeAttribute('aria-invalid');trackPage();});
 const divider=()=>el('span',undefined,'wb-rail-divider');
 const railButton=(source,name,text)=>{const b=proxy(source,()=>iconButton(name,text,undefined,'wb-icon-only wb-rail-insert'));if(b)b.title=text;return b;};
 const directInserts=[[$('addParagraph'),'text','插入正文'],[$('addHeading'),'heading','插入标题'],[$('addImage'),'image','插入图片'],[find('表格'),'table','插入表格'],[find('公式'),'formula','插入公式']].map(args=>railButton(...args)).filter(Boolean);
 outlineToggle.classList.add('wb-icon-only');insertButton.classList.add('wb-icon-only','wb-rail-insert');
 for(const b of [findButton,reviewButton])if(b)b.classList.add('wb-icon-only','wb-rail-review');
 rail.append(...[outlineToggle,divider(),...directInserts,insertButton,divider(),findButton,reviewButton].filter(Boolean));
 const selectionBar=el('div',undefined,'wb-selection');selectionBar.setAttribute('role','group');selectionBar.setAttribute('aria-label','当前组件');
 const selectionName=el('span',undefined,'wb-selection-name');
 const props=button('属性',()=>showProps('block',true));
 const deleteComponent=proxy($('deleteBlock'),()=>button('删除组件',undefined,'wb-delete'));deleteComponent.id='wbDeleteBlock';deleteComponent.title='删除选中的组件；非文字编辑状态可按 Delete / Backspace';
 const up=proxy($('moveUp'),()=>iconButton('up','上移组件',undefined,'wb-icon-only')),down=proxy($('moveDown'),()=>iconButton('down','下移组件',undefined,'wb-icon-only'));
 const editTable=proxy(find('编辑表格'),()=>button('编辑表格'));
 selectionBar.append(selectionName,...[editTable,props,up,down,deleteComponent].filter(Boolean));
 const assetNotice=el('div',undefined,'wb-asset-notice'),assetSummary=el('span'),assetLocate=button('定位',()=>{}),assetAttach=button('补入图片',()=>{});
 assetNotice.setAttribute('role','region');assetNotice.setAttribute('aria-label','缺失图片');assetNotice.append(assetSummary,assetLocate,assetAttach);assetNotice.hidden=true;
 function syncSelection(){
  selectionBar.hidden=compMode;
  const d=getDoc(),b=d.blocks.find(b=>b.id===getSelected()),byId=new Map(d.blocks.map(b=>[b.id,b]));
  const caption=(b?.captionIds||[]).map(id=>byId.get(id)?.text||'').find(t=>/^(图|Fig|表|Tab)/i.test(t.trim()));
  selectionName.textContent=b?`${blockLabel(b)} · ${(caption||b.text||'未命名').slice(0,48)}`:'选择纸面或结构中的组件';
  selectionName.title=b?(caption||b.text||blockLabel(b)):'';
  if(editTable)editTable.hidden=b?.type!=='table';
  deleteComponent.textContent='删除'+blockLabel(b);deleteComponent.disabled=props.disabled=!b;
  const missing=figureGroups(d).filter(g=>!g.ownerId&&!g.adjacentId);
  assetNotice.hidden=compMode||!missing.length;
  if(missing.length){
   const g=missing.find(g=>g.blockId===getSelected())||missing[0];
   assetSummary.textContent=`缺少 ${missing.length} 张图体`;
   assetLocate.textContent=`定位图${g.number}`;assetLocate.onclick=()=>{select(g.blockId);canvas.querySelector(`[data-id="${CSS.escape(g.blockId)}"]`)?.scrollIntoView({block:'center',behavior:motion()});};
   assetAttach.textContent=`补入图${g.number}`;assetAttach.onclick=()=>document.dispatchEvent(new CustomEvent('shuye:attach-figure',{detail:{blockId:g.blockId}}));
  }
 }
 document.addEventListener('shuye:selection-changed',syncSelection);
 document.addEventListener('shuye:edit-journal',()=>find('期刊模板')?.click());
 document.addEventListener('shuye:locate-block',e=>{const id=e.detail.blockId;if(!getDoc().blocks.some(b=>b.id===id))return;select(id);showProps('block',true);canvas.querySelector(`[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({block:'center',behavior:motion()});});
 document.addEventListener('shuye:document-changed',()=>queueMicrotask(syncSelection));
 stage.append(selectionBar,assetNotice,canvas,scrim);workspace.append(menu);
 new MutationObserver(()=>{trackPage();paintZoom();}).observe($('pages'),{childList:true});

 // 状态栏（InDesign 的位置）：缩放 · 页码 · 版心线 · 纸张信息 · 状态 · 字数。纸面上方不再叠加版面条与尺寸行。
 const footer=document.querySelector('body>footer')||body.appendChild(el('footer')),statusLine=$('status'),stats=$('stats'),canvasMeta=document.querySelector('.canvas-meta');
 footer.classList.add('wb-footer');
 const zoomGroup=group('缩放',zoomOut,zoomLabel,zoomIn),pageNav=group('页码',pagePrev,pageInput,pageTotal,pageNext),guideGroup=group('版心线',guideLabel);
 zoomGroup.classList.add('wb-zoom-group');pageNav.classList.add('wb-page-nav');guideGroup.classList.add('wb-guides');canvasMeta?.classList.add('wb-meta');
 footer.replaceChildren(...[zoomGroup,pageNav,guideGroup,canvasMeta,statusLine,stats].filter(Boolean));

 const paperMeta=$('paperMeta'),previewNote=paperMeta?.nextElementSibling,pdfChip=el('span','PDF 分页为准','wb-chip');pdfChip.hidden=true;paperMeta?.parentElement.append(pdfChip);

 // —— 选区浮动条：转发到当前段落面板里的字符样式按钮
 const bubble=el('div',undefined,'wb-bubble');bubble.setAttribute('role','toolbar');bubble.setAttribute('aria-label','字符样式');bubble.hidden=true;
 const editableOf=node=>(node?.nodeType===1?node:node?.parentElement)?.closest('.paper .block[contenteditable]')||null;
 const inlineButtons=()=>[...document.querySelectorAll('#advancedPanel .inline-format button')];
 const applyMark=label=>{const target=inlineButtons().find(b=>b.textContent===label);if(!target||target.disabled)return false;target.click();return true;};
 for(const [label,glyph,combo] of [['粗','B','Mod+B'],['斜','I','Mod+I'],['下划线','U','Mod+U'],['上标','x²'],['下标','x₂'],['清除字样','清除']]){
  const b=button(glyph,()=>{applyMark(label);hideBubble();},'wb-mark');b.dataset.mark=label;b.tabIndex=-1;b.setAttribute('aria-label',label);b.title=combo?`${label} · ${keys(combo)}`:label;
  b.addEventListener('mousedown',e=>e.preventDefault());bubble.append(b);
 }
 body.append(bubble);
 function hideBubble(){bubble.hidden=true;}
 function placeBubble(){
  const sel=getSelection();if(!sel?.rangeCount||sel.isCollapsed){hideBubble();return;}
  const block=editableOf(sel.anchorNode);if(!block||block!==editableOf(sel.focusNode)||!inlineButtons().length){hideBubble();return;}
  const r=sel.getRangeAt(0).getBoundingClientRect(),area=canvas.getBoundingClientRect();
  if((!r.width&&!r.height)||r.bottom<area.top||r.top>area.bottom){hideBubble();return;}
  bubble.hidden=false;const w=bubble.offsetWidth,h=bubble.offsetHeight;let top=r.top-h-8;if(top<area.top+4)top=r.bottom+8;
  const left=Math.max(area.left+8,Math.min(r.left+r.width/2-w/2,area.right-w-8));bubble.style.transform=`translate(${Math.round(left)}px,${Math.round(top)}px)`;
 }
 let bubbleFrame=0;
 document.addEventListener('selectionchange',()=>{if(!bubbleFrame)bubbleFrame=requestAnimationFrame(()=>{bubbleFrame=0;placeBubble();});});
 canvas.addEventListener('scroll',()=>{if(!pageFrame)pageFrame=requestAnimationFrame(()=>{pageFrame=0;trackPage();if(!bubble.hidden)placeBubble();});},{passive:true});
 document.addEventListener('keydown',e=>{if(!modKey(e)||e.altKey||e.shiftKey)return;const label={b:'粗',i:'斜',u:'下划线'}[e.key.toLowerCase()];if(!label||!editableOf(e.target)||getSelection()?.isCollapsed!==false)return;e.preventDefault();applyMark(label);});

 // —— 版式对页示意：与输入框双向关联
 const layoutPanel=$('layoutPanel'),spreadBox=el('div',undefined,'wb-spread-box');layoutPanel.prepend(spreadBox);
 const numeric=new Set(['width','height','top','bottom','inner','outer','fontSize','lineHeight','indent','columns','gap','widowLines','pageStart']);
 const drawn=['width','height','top','bottom','inner','outer','fontSize','lineHeight','columns','gap','writingMode'];
 const readLayout=()=>{const next={...getDoc().layout};for(const input of layoutPanel.querySelectorAll('[data-layout]')){const k=input.dataset.layout;next[k]=numeric.has(k)?Number(input.value):input.value;}return next;};
 function drawSpread(){
  if(rightDock.hidden||view!=='layout')return;
  const live=readLayout(),saved=getDoc().layout||{};
  spreadBox.classList.toggle('is-draft',drawn.some(k=>saved[k]!==undefined&&String(live[k])!==String(saved[k])));
  spreadBox.replaceChildren(spread(live));
 }
 const fieldOf=target=>{const t=target?.closest?.('[data-layout],#preset,label'),input=t?.matches('[data-layout],#preset')?t:t?.querySelector('[data-layout],#preset');return input?(input.id==='preset'?'width':input.dataset.layout):'';};
 const markField=k=>{if(k)spreadBox.dataset.focus=k;else delete spreadBox.dataset.focus;};
 const focusedField=()=>fieldOf(layoutPanel.contains(document.activeElement)?document.activeElement:null);
 layoutPanel.addEventListener('focusin',e=>markField(fieldOf(e.target)));
 layoutPanel.addEventListener('focusout',()=>setTimeout(()=>markField(focusedField())));
 layoutPanel.addEventListener('pointerover',e=>{const k=fieldOf(e.target);if(k)markField(k);});
 layoutPanel.addEventListener('pointerleave',()=>markField(focusedField()));
 layoutPanel.addEventListener('input',drawSpread);
 layoutPanel.addEventListener('change',()=>setTimeout(drawSpread));
 spreadBox.addEventListener('click',e=>{const k=e.target.closest?.('[data-field]')?.dataset.field.split(' ')[0],input=k&&layoutPanel.querySelector(`[data-layout="${k}"]`);if(input){input.focus();input.select?.();}});

 // —— Agent 连续任务：人下达目标、接管例外、审阅校样。
 let proofBusy=false,agentRunning=false;
 function sync(){
  syncSelection();
  const d=getDoc();route.textContent=compMode?'自由版面':d.journal?'期刊':'流式文稿';route.dataset.mode=compMode?'composition':d.journal?'journal':'flow';route.hidden=!compMode&&!d.journal;
  if(modeReturn)modeReturn.hidden=!compMode;
  const proofState=connection.journalUI?.proofState?.(),proofLabel=proofState==='ready'?'查看校样':proofState==='stale'?'更新校样':proofState==='running'?'取回校样':'生成校样';
  proofButton.textContent=proofBusy?'正在处理…':d.journal&&!d.composition?proofLabel:'校样 / 输出';
  proofButton.disabled=proofBusy||agentRunning;
  pdfChip.hidden=!d.journal||compMode;if(previewNote)pdfChip.title=previewNote.textContent;
  if(cloudSave){cloudSave.classList.toggle('is-dirty',!!connection.dirty);cloudSave.setAttribute('aria-label',connection.dirty?'保存，有未保存的修改':'保存');}
 }
 setupAgentTasks({panel,connection,getDoc,notify,locate:id=>{select(id);canvas.querySelector(`[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({block:"center",behavior:motion()});},onState:task=>{agentRunning=task?.status==='running';proofButton.disabled=proofBusy||agentRunning;tabs.assistant.dataset.state=task?.status||'';assistantEntry.textContent=task?.status==='running'?'Agent 执行中':'Agent 任务';}});
 async function runProof(){
  if(proofBusy)return;
  if(!getDoc().journal||getDoc().composition){openCommands('校样','校样与输出');return;}
  const say=(text,tone,sticky=false)=>notify(text,tone,sticky);
  proofBusy=true;proofButton.disabled=true;proofButton.setAttribute('aria-busy','true');body.classList.add('wb-proofing');sync();
  say(connection.journalUI.proofState?.()==='ready'?'正在取回当前修订的校样…':'正在准备当前版本的期刊校样…','progress',true);
  try{const proof=await connection.journalUI.generateProof(),blocked=proof.report?.quality?.status==='BLOCKED';say(`校样 r${proof.revision} · ${proof.pages} 页。${blocked?'存在质量阻断，请查看报告。':'请核对 PDF 实际页面。'}`,blocked?'warn':'ok',blocked);}
  catch(e){say(messages[e.message]||e.message,'error');}
  finally{proofBusy=false;proofButton.disabled=false;proofButton.removeAttribute('aria-busy');body.classList.remove('wb-proofing');sync();}
 }

 // —— 状态：保存状态、底栏、自由版面模式
 function paintState(){const t=state.textContent||'';stateBox.dataset.tone=/失败|中断|不可用|冲突|无法/.test(t)?'error':/未保存|有修改|新修改|尚未|另存|再次/.test(t)?'pending':/浏览器/.test(t)?'local':/已保存|已同步/.test(t)?'saved':'idle';stateBox.title=t;sync();}
 new MutationObserver(paintState).observe(state,{childList:true,characterData:true,subtree:true});
 if(statusLine){
  const paintStatus=()=>{const error=statusLine.classList.contains('error');footer.classList.toggle('is-error',error);statusLine.tabIndex=error?0:-1;statusLine.title=statusLine.textContent;};
  new MutationObserver(paintStatus).observe(statusLine,{attributes:true,attributeFilter:['class'],childList:true,characterData:true,subtree:true});paintStatus();
 }
 new MutationObserver(()=>{
  const next=workspace.classList.contains('composition-mode');if(next===compMode)return;
  compMode=next;body.classList.toggle('wb-composition',compMode);outlineToggle.hidden=compMode;
  if(compMode){setDock('left',false,{persist:false});setView(view==='assistant'?'assistant':'composition');if(!isOverlay('right'))setDock('right',true,{persist:false});}
  else{setView(view==='assistant'?'assistant':['layout','block'].includes(store.view)?store.view:'layout');setDock('left',!isOverlay('left')&&wideLeft(),{persist:false});}
  sync();
 }).observe(workspace,{attributes:true,attributeFilter:['class']});

 // —— 键盘
 document.addEventListener('keydown',e=>{
  if(!e.altKey||e.ctrlKey||e.metaKey||!/^Digit[1-4]$/.test(e.code)||openDialog())return;
  if(mac&&e.target.closest?.('input,textarea,select,[contenteditable]'))return;
  e.preventDefault();const n=Number(e.code.slice(-1));
  if(n===1){if(!compMode)toggleDock('left');return;}
  const key=compMode&&n<4?'composition':{2:'layout',3:'block',4:'assistant'}[n];
  if(!rightDock.hidden&&view===key)setDock('right',false);else showProps(key);
 });
 document.addEventListener('keydown',e=>{
  if(e.key!=='Escape'||e.defaultPrevented||openDialog())return;
  if(!menu.hidden){e.preventDefault();closeMenu();return;}
  hideBubble();
  for(const side of ['left','right'])if(!docks[side].hidden&&isOverlay(side)){e.preventDefault();setDock(side,false,{persist:false});toggles[side].focus();return;}
 });

 document.addEventListener('shuye:document-changed',()=>queueMicrotask(()=>{sync();fit();drawSpread();}));
 document.addEventListener('shuye:proof-changed',sync);
 document.addEventListener('shuye:connection-changed',()=>{sync();fit();});
 const observer=new ResizeObserver(()=>{if(zoomSelect.value==='fit')fit();});observer.observe(canvas);

 body.classList.toggle('wb-composition',compMode);outlineToggle.hidden=compMode;
 setView(compMode?'composition':getDoc().journal?'assistant':['layout','block'].includes(store.view)?store.view:'layout');
 setDock('left',!isOverlay('left')&&wideLeft(),{persist:false});
 setDock('right',!isOverlay('right')&&(store.right??true),{persist:false});
 sync();fit();paintState();paintZoom();trackPage();
 return {openCommands};
}
