import {journalRoles} from './journal.mjs';
const names=['中文题名','中文作者','中文单位','中文摘要','中文关键词','分类号/文章编号','英文题名','英文作者','英文单位','英文摘要','英文关键词','引文行','收稿/基金/作者信息','参考文献条目'];
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
    for(const [value,text] of [['fandol','Fandol（TeX 配套）'],['source-han','思源宋体 / 黑体（需安装）'],['windows','Windows 系统字体（需安装）'],['mac','macOS 系统字体（需安装）']]){const option=document.createElement('option');option.value=value;option.textContent=text;cjk.append(option);}
    cjk.value=getDoc().layout.fontSet||'fandol';cjkRow.append(cjk);dialog.append(cjkRow);
    const weightRow=document.createElement('label');weightRow.textContent='正文字重';const weight=document.createElement('select');for(const [value,text] of [['regular','常规'],['light','轻字重（仅思源宋体，需安装 Light）']]){const option=document.createElement('option');option.value=value;option.textContent=text;weight.append(option);}weight.value=getDoc().journal?.bodyWeight||'regular';weightRow.append(weight);dialog.append(weightRow);
    const save=document.createElement('button');save.textContent='应用期刊模板';save.onclick=()=>{
      try{if(weight.value==='light'&&cjk.value!=='source-han')throw Error('轻字重只适用于思源宋体；请选择常规字重，或恢复思源字体方案。');change(()=>{const doc=getDoc();doc.journal={...doc.journal,template:'cn-academic',latinFont:latin.value,mathFont:math.value,bodyWeight:weight.value,normalizeTypography:true,...Object.fromEntries(Object.entries(inputs).map(([k,v])=>[k,v.value]))};doc.layout.fontSet=cjk.value;if(!doc.blocks.some(b=>b.role)){Object.assign(doc.layout,{width:170,height:240,inner:13,outer:13,top:16,bottom:16,columns:2,gap:6,fontSize:8.2,lineHeight:1.55});}});dialog.close();}catch(e){status(e.message,true);}
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
