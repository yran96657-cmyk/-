import {resetChangedAnnotationSizes} from './journal-style.mjs';
import {journalRoles} from './journal.mjs';
const names=['中文题名','中文作者','中文单位','中文摘要','中文关键词','分类号/文章编号','英文题名','英文作者','英文单位','英文摘要','英文关键词','引文行','收稿/基金/作者信息','参考文献条目','参考文献标题'];
export function setupJournal({getDoc,change,status,makeButton}){
  makeButton('期刊模板',()=>{
    const dialog=document.createElement('dialog');dialog.style.maxWidth='620px';
    const title=document.createElement('h2');title.textContent='中文学术期刊';dialog.append(title);
    const hint=document.createElement('p');hint.textContent='首面通栏；正文使用页面设置的栏数，按参考刊式选择单栏或双栏。为原文段落指定角色，保留原文及上下标；最终效果以 PDF 校样为准。';dialog.append(hint);
    const inputs={};for(const [key,label]of [['name','中文刊名'],['nameEn','英文刊名'],['volume','卷'],['issue','期'],['year','年'],['date','出版日期（中文）'],['dateEn','出版日期（英文）'],['shortTitle','续页短标题']]){
      const row=document.createElement('label');row.textContent=label;const input=document.createElement('input');input.value=getDoc().journal?.[key]||'';input.maxLength=200;row.append(input);dialog.append(row);inputs[key]=input;
    }
    const fontRow=document.createElement('label');fontRow.textContent='西文字体（需服务器已安装）';const latin=document.createElement('select');for(const [value,text] of [['tex-default','TeX 默认'],['times','Times New Roman']]){const option=document.createElement('option');option.value=value;option.textContent=text;latin.append(option);}latin.value=getDoc().journal?.latinFont||'tex-default';fontRow.append(latin);dialog.append(fontRow);
    const mathRow=document.createElement('label');mathRow.textContent='数学字体（需服务器已安装）';const math=document.createElement('select');for(const [value,text] of [['tex-default','TeX 默认数学字体'],['stix-two','STIX Two Math（参考刊式）']]){const option=document.createElement('option');option.value=value;option.textContent=text;math.append(option);}math.value=getDoc().journal?.mathFont||'tex-default';mathRow.append(math);dialog.append(mathRow);
    const cjkRow=document.createElement('label');cjkRow.textContent='PDF 中文字体';const cjk=document.createElement('select');
    for(const [value,text] of [['founder-sample','原样本：方正书宋 / 黑体 / 楷体 / 仿宋（需安装）'],['fandol','Fandol（TeX 配套）'],['source-han','思源宋体 / 黑体（需安装）'],['windows','Windows 系统字体（需安装）'],['mac','macOS 系统字体（需安装）']]){const option=document.createElement('option');option.value=value;option.textContent=text;cjk.append(option);}
    cjk.value=getDoc().layout.fontSet||'fandol';cjkRow.append(cjk);dialog.append(cjkRow);
    const weightRow=document.createElement('label');weightRow.textContent='正文字重';const weight=document.createElement('select');for(const [value,text] of [['regular','常规'],['light','轻字重（仅思源宋体，需安装 Light）']]){const option=document.createElement('option');option.value=value;option.textContent=text;weight.append(option);}weight.value=getDoc().journal?.bodyWeight||'regular';weightRow.append(weight);dialog.append(weightRow);
    const annotationPanel=document.createElement('details'),annotationTitle=document.createElement('summary');annotationTitle.textContent='注释与参考文献';annotationPanel.append(annotationTitle);dialog.append(annotationPanel);
    const current=getDoc().journal||{},annotationInputs={};
    for(const [key,labelText,options,fallback] of [
      ['fontSet','注释引用字体',[['inherit','沿用正文'],['founder-sample','原样本：方正书宋 / 黑体、宋体、Times（需安装）']],'inherit'],
      ['referenceColumns','参考文献栏数',[['','沿用正文'],['1','单栏'],['2','双栏'],['3','三栏'],['4','四栏']],''],
      ['referenceLabelStyle','文献编号括号',[['source','保留原文'],['fullwidth','样本全角括号']],'source'],
      ['noteMarker','首面出版说明编号',[['hidden','不显示编号'],['source','显示原编号']],'source']
    ]){const row=document.createElement('label');row.textContent=labelText;const control=document.createElement('select');for(const [value,text] of options){const o=document.createElement('option');o.value=value;o.textContent=text;control.append(o);}control.value=String(current.annotations?.[key]??fallback);row.append(control);annotationPanel.append(row);annotationInputs[key]=control;}
    for(const [key,labelText,lo,hi,fallback] of [['noteIndentMm','脚注左缩进（mm）',0,20,0],['noteLabelWidthMm','脚注标签宽度（mm）',0,30,13.38],['referenceIndentMm','文献悬挂缩进（mm）',0,20,7],['referenceGapMm','参考文献栏距（mm）',3,20,6]]){const row=document.createElement('label');row.textContent=labelText;const control=document.createElement('input');control.type='number';control.min=lo;control.max=hi;control.step='any';control.value=current.annotations?.[key]??fallback;row.append(control);annotationPanel.append(row);annotationInputs[key]=control;}
    const roleInputs={};for(const [role,titleText,defaults] of [['article-note','首面脚注',[6.9,8]],['reference','参考文献',[6.94,8.5]]]){roleInputs[role]={};for(const [i,key] of ['fontSize','leading'].entries()){const row=document.createElement('label');row.textContent=titleText+(key==='fontSize'?'字号（pt）':'行距（pt）');const control=document.createElement('input');control.type='number';control.min=key==='fontSize'?6:7;control.max=key==='fontSize'?24:36;control.step='any';control.value=current.roleStyles?.[role]?.[key]??defaults[i];row.append(control);annotationPanel.append(row);roleInputs[role][key]=control;}}
    const save=document.createElement('button');save.textContent='应用期刊模板';save.onclick=()=>{
      try{if(weight.value==='light'&&cjk.value!=='source-han')throw Error('轻字重只适用于思源宋体；请选择常规字重，或恢复思源字体方案。');const annotations={...current.annotations};for(const [key,input] of Object.entries(annotationInputs)){if(input.value===''){delete annotations[key];continue;}const numeric=input.type==='number'||key==='referenceColumns';const value=numeric?Number(input.value):input.value;if(numeric&&(!Number.isFinite(value)||input.type==='number'&&(value<Number(input.min)||value>Number(input.max))))throw Error('注释引用参数超出范围');annotations[key]=value;}
      const roleStyles={...current.roleStyles};for(const [role,controls] of Object.entries(roleInputs)){const style={...roleStyles[role]};for(const [key,input] of Object.entries(controls)){const value=Number(input.value);if(!input.value||!Number.isFinite(value)||value<Number(input.min)||value>Number(input.max))throw Error('注释引用字号或行距超出范围');style[key]=value;}roleStyles[role]=style;}
      change(()=>{const doc=getDoc();doc.journal={...doc.journal,template:'cn-academic',annotations,roleStyles,latinFont:latin.value,mathFont:math.value,bodyWeight:weight.value,normalizeTypography:true,...Object.fromEntries(Object.entries(inputs).map(([k,v])=>[k,v.value]))};doc.layout.fontSet=cjk.value;resetChangedAnnotationSizes(doc,current,roleStyles);if(!doc.blocks.some(b=>b.role)){Object.assign(doc.layout,{width:170,height:240,inner:13,outer:13,top:16,bottom:16,columns:2,gap:6,fontSize:8.2,lineHeight:1.55});}});dialog.close();}catch(e){status(e.message,true);}
    };
    const cancel=document.createElement('button');cancel.textContent='关闭';cancel.onclick=()=>dialog.close();dialog.append(save,cancel);dialog.onclose=()=>dialog.remove();document.body.append(dialog);dialog.showModal();
  });
}
export function journalFields({panel,b,doc,mutate,label}){
  function select(items,value,apply){const el=document.createElement('select');for(const [v,t]of items){const o=document.createElement('option');o.value=v;o.textContent=t;el.append(o);}el.value=value;el.onchange=()=>apply(el.value);return el;}
  if(doc.journal&&['paragraph','heading'].includes(b.type))panel.append(label('期刊角色',select([['','正文'],...journalRoles.map((r,i)=>[r,names[i]])],b.role||'',v=>mutate(block=>{if(v)block.role=v;else delete block.role;}))));
  if(['image','table','equation'].includes(b.type)){
    if(b.type!=='table')panel.append(label('PDF 栏位',select([['auto','自动'],['column','栏内'],['full-width','通栏']],b.placement||'auto',v=>mutate(block=>block.placement=v))));
    const targets=doc.blocks.filter(x=>['paragraph','heading'].includes(x.type)&&!x.role&&!doc.blocks.some(y=>y.captionIds?.includes(x.id)));
    panel.append(label('锚定正文',select([['','保持文稿顺序'],...targets.map(x=>[x.id,x.text.slice(0,45)])],b.anchor?.targetId||'',v=>mutate(block=>{if(v)block.anchor={targetId:v,position:'after',maxPageDistance:1};else delete block.anchor;}))));
    if(b.anchor){panel.append(label('相对位置',select([['after','在该段之后'],['before','在该段之前']],b.anchor.position,v=>mutate(block=>block.anchor.position=v))));const distance=document.createElement('input');distance.type='number';distance.min=0;distance.max=3;distance.value=b.anchor.maxPageDistance;distance.onchange=()=>mutate(block=>block.anchor.maxPageDistance=Number(distance.value));panel.append(label('允许相隔页数',distance));}
    if(['image','table'].includes(b.type)){
      const choices=document.createElement('select');choices.multiple=true;choices.size=5;
      for(const x of doc.blocks.filter(x=>['paragraph','heading'].includes(x.type)&&!x.role)){const o=document.createElement('option');o.value=x.id;o.textContent=x.text.slice(0,50);o.selected=b.captionIds?.includes(x.id)||false;choices.append(o);}
      choices.onchange=()=>mutate(block=>block.captionIds=[...choices.selectedOptions].map(o=>o.value));panel.append(label('绑定题注（可多选，最多 8 段）',choices));
    }
  }
  if(b.type==='image'&&doc.journal){
    const choices=document.createElement('select');choices.multiple=true;choices.size=5;
    for(const x of doc.blocks.filter(x=>['paragraph','equation'].includes(x.type)&&!x.role&&!doc.blocks.some(y=>y.captionIds?.includes(x.id)))){const o=document.createElement('option');o.value=x.id;o.textContent=x.text.slice(0,50);o.selected=b.sideTextIds?.includes(x.id)||false;choices.append(o);}
    panel.append(label('PDF 图文并排范围（连续正文/公式）',choices));
    const apply=document.createElement('button');apply.textContent='应用并排范围';apply.onclick=()=>mutate(block=>{
      const ids=[...choices.selectedOptions].map(o=>o.value);
      if(!ids.length){delete block.sideTextIds;block.wrap='none';return;}
      const target=doc.blocks.find(x=>ids.includes(x.id)&&x.type==='paragraph');
      if(!target)throw Error('并排范围须含至少一段正文作为锚点。');
      block.sideTextIds=ids;block.wrap=block.wrap==='left'?'left':'right';block.width=Math.min(60,Math.max(15,block.width||40));
      block.anchor={targetId:ids.includes(block.anchor?.targetId)?block.anchor.targetId:target.id,position:'after',maxPageDistance:0};
    });panel.append(apply);
    const note=document.createElement('p');note.textContent='并排组同页输出，保留正文顺序；不跨标题或其他图表。过高或公式越界会报错，需调整范围后重新生成 PDF。';panel.append(note);
  }
  if(b.type==='equation'){const number=document.createElement('input');number.value=b.equationNumber||'';number.maxLength=80;number.onchange=()=>mutate(block=>block.equationNumber=number.value);panel.append(label('公式编号',number));}
}
