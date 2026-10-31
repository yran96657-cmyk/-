// SPDX-License-Identifier: MIT
import {validateTable,cellMerge,cellDisplayText,buildTableElement,mergeCells,splitCell,resizeTable,headerRowCount} from './table-layout.mjs';

export function setupTableEditor({getDoc,getSelected,change,status}) {
  const make=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
  const dialog=make('dialog');dialog.className='table-editor-dialog';dialog.setAttribute('aria-label','可视化表格编辑');document.body.append(dialog);
  let editingId=null,anchor={row:0,col:0},focus={row:0,col:0};
  const current=()=>getDoc().blocks.find(b=>b.id===editingId&&b.type==='table');
  const range=()=>({row:Math.min(anchor.row,focus.row),col:Math.min(anchor.col,focus.col),rowspan:Math.abs(anchor.row-focus.row)+1,colspan:Math.abs(anchor.col-focus.col)+1});
  const button=(text,fn)=>{const b=make('button',text);b.type='button';b.onclick=fn;return b;};
  const error=err=>{status(err.message||String(err),true);const p=dialog.querySelector('.table-editor-message');if(p){p.textContent=err.message||String(err);p.setAttribute('role','alert');}};
  const commit=(next,redraw=true)=>{change(()=>{const block=current();if(!block)throw Error('表格已不存在，请关闭后重新选择。');Object.assign(block,next);});const b=current();anchor.row=Math.min(anchor.row,b.rows.length-1);anchor.col=Math.min(anchor.col,b.rows[0].length-1);if(redraw){focus={...anchor};render();}else for(const cell of dialog.querySelectorAll('.table-editor-grid [data-row][data-col]')){const row=Number(cell.dataset.row),col=Number(cell.dataset.col),m=cellMerge(b,row,col),text=cellDisplayText(b,row,col),pick=cell.querySelector('button');pick.textContent=text||'（空）';pick.setAttribute('aria-label',`第 ${row+1} 行第 ${col+1} 列${m?`，合并 ${m.rowspan} 行 ${m.colspan} 列`:''}：${text}`);}};
  const run=(fn,redraw=true)=>{try{commit(fn(current()),redraw);status('表格已更新，可撤销。');}catch(e){error(e);}};
  function render(){
    const b=current();if(!b){dialog.close();return;}
    dialog.replaceChildren();const top=make('div');top.className='table-editor-top';top.append(make('h2','可视化表格编辑'),button('完成',()=>dialog.close()));dialog.append(top);
    const hint=make('p','单击选择起点，Shift＋单击选择矩形终点。合并会显示所有原格文字；拆分恢复各格内容。纵向合并组整体分页，超过一页需人工拆分。');hint.className='table-editor-hint';dialog.append(hint);
    const message=make('p',headerRowCount(b).warnings.join(' '));message.className='table-editor-message';dialog.append(message);
    const actions=make('div');actions.className='table-editor-actions';
    actions.append(button('合并选区',()=>run(t=>mergeCells(t,range()))),button('拆分当前格',()=>run(t=>splitCell(t,anchor.row,anchor.col))));
    for(const [title,axis,after] of [['上方插行','row',false],['下方插行','row',true],['左侧插列','col',false],['右侧插列','col',true]])actions.append(button(title,()=>run(t=>resizeTable(t,axis,anchor[axis]+(after?1:0)))));
    for(const [title,axis] of [['删除当前行','row'],['删除当前列','col']])actions.append(button(title,()=>{if(confirm(`${title}会删除这一${axis==='row'?'行':'列'}的文字；可通过撤销恢复。继续？`))run(t=>resizeTable(t,axis,anchor[axis],true));}));
    dialog.append(actions);
    const settings=make('div');settings.className='table-editor-settings';
    const widthLabel=make('label','各列相对宽度（逗号分隔，自动归一为百分比）');const widths=make('input');widths.value=validateTable(b).columnWidths.map(w=>Number(w.toFixed(3))).join(', ');widths.setAttribute('aria-label','各列相对宽度');widthLabel.append(widths);
    settings.append(widthLabel,button('应用列宽',()=>run(t=>({...t,...validateTable({...t,columnWidths:widths.value.split(/[,，]/).map(s=>Number(s.trim()))})}))));
    const headerLabel=make('label','表头行数');const header=make('input');header.type='number';header.min=0;header.max=b.rows.length;header.value=b.headerRows??1;header.setAttribute('aria-label','表头行数');headerLabel.append(header);
    settings.append(headerLabel,button('应用表头',()=>run(t=>{const n=Number(header.value);if(!Number.isInteger(n)||n<0||n>t.rows.length)throw Error('表头行数必须在 0 与总行数之间。');return {...t,headerRows:n};})));dialog.append(settings);
    const grid=make('div');grid.className='table-editor-grid';const selection=range();
    grid.append(buildTableElement(b,{renderCell(td,text,{row,col}){
      const m=cellMerge(b,row,col),lastRow=row+(m?.rowspan||1)-1,lastCol=col+(m?.colspan||1)-1;
      if(row<selection.row+selection.rowspan&&lastRow>=selection.row&&col<selection.col+selection.colspan&&lastCol>=selection.col)td.classList.add('table-cell-selected');
      const pick=button(text||'（空）',event=>{if(event.shiftKey)focus={row:lastRow,col:lastCol};else {anchor={row,col};focus={row:lastRow,col:lastCol};}render();});
      for(const cell of (b.cellImages||[]).filter(c=>c.row===row&&c.col===col)){const source=getDoc().blocks.find(b=>b.id===cell.imageId);if(source){const img=make('img');img.src=source.src;img.alt='单元格插图';img.style.cssText='display:block;max-width:160px;max-height:100px';td.append(img);}}
      pick.setAttribute('aria-label',`第 ${row+1} 行第 ${col+1} 列${m?`，合并 ${m.rowspan} 行 ${m.colspan} 列`:''}：${text}`);td.append(pick);
    }}));dialog.append(grid);
    const editor=make('div');editor.className='table-cell-source';const m=cellMerge(b,anchor.row,anchor.col)||{...anchor,rowspan:1,colspan:1};
    editor.append(make('h3',`当前格原文 · ${m.row+1} 行 ${m.col+1} 列`));
    for(let row=m.row;row<m.row+m.rowspan;row++)for(let col=m.col;col<m.col+m.colspan;col++){
      const label=make('label',`${row+1} 行 ${col+1} 列${m.rowspan*m.colspan>1?'（保留拆分位置）':''}`),area=make('textarea');area.value=b.rows[row][col];area.rows=2;area.maxLength=10000;
      area.setAttribute('aria-label',`编辑第 ${row+1} 行第 ${col+1} 列原文`);
      area.onchange=()=>run(t=>{const clean=validateTable(t);clean.rows[row][col]=area.value;return {...t,...clean};},false);label.append(area);editor.append(label);
    }dialog.append(editor);
  }
  function open(id=getSelected?.()) {editingId=id;const b=current();if(!b){status('请先选择表格，再打开“编辑表格”。',true);return;}anchor={row:0,col:0};focus={...anchor};try{validateTable(b);render();if(!dialog.open)dialog.showModal();}catch(e){error(e);}}
  const launch=button('编辑表格',()=>open());document.querySelector('.toolbar')?.append(launch);
  return {open,destroy(){launch.remove();dialog.remove();}};
}
