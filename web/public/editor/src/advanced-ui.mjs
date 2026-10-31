import {setupJournal,journalFields} from './journal-ui.mjs';
export function setupAdvanced({getDoc,getSelected,change,insert,select,status,replaceBlockText,getSelectionRange}) {
  const byId=id=>document.getElementById(id),active=()=>getDoc().blocks.find(b=>b.id===getSelected());
  const toolbar=document.querySelector('.toolbar>div');
  const makeButton=(label,callback)=>{const b=document.createElement('button');b.textContent=label;b.onclick=callback;toolbar.append(b);return b;};
  setupJournal({getDoc,change,status,makeButton});
  makeButton('表格',()=>insert('table',{rows:[['项目','数值','说明'],['示例','100','']],headerRows:1,borderStyle:'three-line',text:'表 1'}));
  makeButton('公式',()=>insert('equation',{text:'E = mc^2',align:'center'}));
  makeButton('目录',()=>insert('toc',{text:'目录'}));
  makeButton('索引',()=>insert('index',{text:'索引'}));
  const panel=document.createElement('div');panel.id='advancedPanel';byId('blockFields').insertBefore(panel,byId('blockFields').querySelector('.block-actions'));
  const label=(title,input)=>{const l=document.createElement('label');l.append(document.createTextNode(title),input);return l;};
  const button=(title,callback)=>{const b=document.createElement('button');b.textContent=title;b.onclick=callback;return b;};
  function mutate(fn){try{change(()=>fn(active()));}catch(e){status(e.message,true);}}
  function update(){panel.replaceChildren();const b=active();if(!b)return;
    journalFields({panel,b,doc:getDoc(),mutate,label});
    if(['paragraph','heading'].includes(b.type)){
      const hint=document.createElement('p');hint.className='hint';hint.textContent=b.ruby?.length?'本段含注音，请在段落框编辑原文。修改基文会移除受影响的注音，请重新核对字音。':'在纸面或段落框中选择文字，再设置字符样式。';panel.append(hint);
      const tools=document.createElement('div');tools.className='inline-format';
      for(const [title,key] of [['粗','bold'],['斜','italic'],['下划线','underline'],['上标','superscript'],['下标','subscript']]){
        const btn=button(title,()=>{const range=getSelectionRange();if(!range||range.id!==b.id||range.end<=range.start){status('请先选择本段中的文字。',true);return;}document.activeElement?.blur();mutate(block=>{block.marks||=[];block.marks.push({start:range.start,end:range.end,[key]:true});});});btn.onmousedown=e=>e.preventDefault();tools.append(btn);
      }
      const clear=button('清除字样',()=>{const range=getSelectionRange();document.activeElement?.blur();mutate(block=>{if(!range||range.id!==b.id){block.marks=[];return;}block.marks=(block.marks||[]).flatMap(m=>{if(m.end<=range.start||m.start>=range.end)return [m];return [m.start<range.start?{...m,end:range.start}:null,m.end>range.end?{...m,start:range.end}:null].filter(Boolean);});});});clear.onmousedown=e=>e.preventDefault();tools.append(clear);panel.append(tools);
      const indent=document.createElement('input');indent.type='number';indent.min=0;indent.max=20;indent.step=.5;indent.value=b.indent??getDoc().layout.indent;indent.onchange=()=>mutate(block=>{block.indent=Number(indent.value);delete block.indentPt;});panel.append(label('本段首行缩进 / 字',indent));
      if(b.type==='heading'){const level=document.createElement('select');for(let i=1;i<=4;i++){const op=document.createElement('option');op.value=i;op.textContent=`${i} 级标题`;level.append(op);}level.value=b.level||1;level.onchange=()=>mutate(block=>block.level=Number(level.value));panel.append(label('目录层级',level));}
    }
    if(b.inlineMath?.length){
      const hint=document.createElement('p');hint.className='hint';hint.textContent='本段/单元格使用 [[math:ID]] 保留公式位置；在下方编辑公式，移动时请保留完整标记。';panel.append(hint);
      for(const formula of b.inlineMath){const input=document.createElement('textarea');input.rows=2;input.value=formula.text;input.onchange=()=>mutate(block=>block.inlineMath.find(m=>m.id===formula.id).text=input.value);panel.append(label('行内公式 '+formula.id,input));}
    }
    if(b.type==='image'){
      const wrap=document.createElement('select');for(const [v,t]of [['none','独占一段'],['left','图片居左，文字右侧绕排'],['right','图片居右，文字左侧绕排']]){const o=document.createElement('option');o.value=v;o.textContent=t;wrap.append(o);}wrap.value=b.wrap||'none';wrap.onchange=()=>mutate(block=>block.wrap=wrap.value);panel.append(label('图文关系',wrap));
    }
    if(b.type==='table'){
      const placement=document.createElement('select');for(const [v,t]of [['auto','自动：短表栏内，长表通栏'],['column','栏内整表（不可跨页）'],['full-width','通栏长表（可跨页）']]){const o=document.createElement('option');o.value=v;o.textContent=t;placement.append(o);}placement.value=b.placement||'auto';placement.onchange=()=>mutate(block=>block.placement=placement.value);panel.append(label('PDF 表格位置（编辑预览仅作参考）',placement));
      const hasCellBreaks=b.rows.some(row=>row.some(cell=>/[\t\r\n]/.test(cell)));
      const data=document.createElement('textarea');data.readOnly=hasCellBreaks;data.rows=10;data.value=b.rows.map(r=>r.join('\t')).join('\n');data.id='tableData';data.spellcheck=false;
      panel.append(label('表格数据（Tab 分列，换行分行）',data));
      const applyData=button('应用表格数据',()=>{if(hasCellBreaks){status('此表含单元格换行或制表符，请使用“编辑表格”逐格修改。',true);return;}const rows=data.value.replace(/\r/g,'').split('\n').map(r=>r.split('\t'));if(rows.length>5000||rows.some(r=>r.length>50)){status('表格最多 5,000 行、50 列。',true);return;}const width=Math.max(...rows.map(r=>r.length));mutate(block=>block.rows=rows.map(r=>Array.from({length:width},(_,i)=>r[i]||'')));});applyData.disabled=hasCellBreaks;panel.append(applyData);
      if(hasCellBreaks){const hint=document.createElement('p');hint.className='hint';hint.textContent='此表含单元格换行，请使用“编辑表格”。';panel.append(hint);}
      const header=document.createElement('input');header.type='number';header.min=0;header.max=b.rows.length;header.value=b.headerRows??1;header.onchange=()=>mutate(block=>block.headerRows=Math.max(0,Math.min(block.rows.length,Number(header.value)||0)));panel.append(label('重复表头行数',header));
      const style=document.createElement('select');for(const [v,t] of [['grid','网格表'],['three-line','三线表'],['none','无框线']]){const op=document.createElement('option');op.value=v;op.textContent=t;style.append(op);}style.value=b.borderStyle||'grid';style.onchange=()=>mutate(block=>block.borderStyle=style.value);panel.append(label('表格样式',style));
      panel.append(button('增加一行',()=>mutate(block=>block.rows.push(Array(block.rows[0].length).fill('')))));
    }
    if((b.type==='image'||b.type==='table')&&b.placement==='full-width'){
      const float=document.createElement('select');for(const [v,t]of [['in-flow','随正文排放'],['top','后续页顶，正文填补余白']]){const o=document.createElement('option');o.value=v;o.textContent=t;float.append(o);}float.value=b.floatPlacement||'in-flow';float.onchange=()=>mutate(block=>block.floatPlacement=float.value);panel.append(label('PDF 图表排放',float));
    }
    if(b.type==='equation'){const p=document.createElement('p');p.className='hint';p.textContent='上方填写 LaTeX 数学式，支持分数、根式、上下标、求和和矩阵等。禁止文件和宏命令。';panel.append(p);}
    if(b.type==='index'){const terms=document.createElement('textarea');terms.rows=8;terms.value=(getDoc().indexTerms||[]).join('\n');terms.onchange=()=>change(()=>getDoc().indexTerms=[...new Set(terms.value.split('\n').map(s=>s.trim()).filter(Boolean))]);panel.append(label('索引词（每行一项）',terms));}
    if(['toc','index'].includes(b.type)){const p=document.createElement('p');p.className='hint';p.textContent='页码按当前预览自动更新；独立 PDF 后端会重新计算自己的页码。';panel.append(p);}
  }
  const dialog=document.createElement('dialog');dialog.className='notes-dialog';document.body.append(dialog);
  function notesDialog(){dialog.replaceChildren();const title=document.createElement('h2');title.textContent='注释管理';dialog.append(title);
    const mode=document.createElement('select');for(const [v,t] of [['footnote','页下注'],['endnote','文末注']]){const o=document.createElement('option');o.value=v;o.textContent=t;mode.append(o);}mode.value=getDoc().layout.notesMode||'footnote';mode.onchange=()=>change(()=>getDoc().layout.notesMode=mode.value);dialog.append(label('注释位置',mode));
    for(const [i,n] of (getDoc().notes||[]).entries()){const area=document.createElement('textarea');area.rows=3;area.value=n.text;area.maxLength=30000;area.onchange=()=>change(()=>{getDoc().notes.find(x=>x.id===n.id).text=area.value;});dialog.append(label(`${n.marker??i+1}　引用标记 [^${n.id}]`,area));}
    dialog.append(button('在当前段落插入注释',()=>{const b=active();if(!b||!['paragraph','heading'].includes(b.type)){status('请先选择正文或标题段落。',true);return;}const text=prompt('注释内容');if(!text)return;const id='n'+crypto.randomUUID().replaceAll('-','').slice(0,12),range=getSelectionRange(),offset=range?.id===b.id?range.end:b.text.length;change(()=>{getDoc().notes||=[];getDoc().notes.push({id,text});replaceBlockText(b,b.text.slice(0,offset)+`[^${id}]`+b.text.slice(offset));});dialog.close();notesDialog();}),button('关闭',()=>dialog.close()));dialog.showModal();}
  makeButton('注释',notesDialog);
  return {update};
}
