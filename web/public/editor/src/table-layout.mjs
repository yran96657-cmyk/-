// SPDX-License-Identifier: MIT
// Table geometry is independent of the browser. Covered cells retain their text.
export function validateTable(table) {
  if (!Array.isArray(table.rows) || !table.rows.length || table.rows.length > 5000) throw Error('表格需要 1–5,000 行。');
  if (table.rows.some(row => !Array.isArray(row))) throw Error('表格行必须为数组。');
  const cols = Math.max(...table.rows.map(row => row.length));
  if (!cols || cols > 50 || cols * table.rows.length > 100000) throw Error('表格最多 50 列、100,000 个单元格。');
  const rows = table.rows.map(row => Array.from({ length: cols }, (_,c) => String(row[c] ?? '')));
  if (rows.some(row => row.some(text => text.length > 10000))) throw Error('单元格文字最多 10,000 个 UTF-16 单元。');
  if (table.merges !== undefined && !Array.isArray(table.merges)) throw Error('合并单元格信息必须为数组。');
  const merges = [], occupied = new Set();
  if ((table.merges || []).length > 100000) throw Error('合并单元格数量过多。');
  for (const raw of table.merges || []) {
    if (!raw || !['row','col','rowspan','colspan'].every(k => Number.isInteger(raw[k]))) throw Error('合并单元格坐标和跨度必须为整数。');
    const { row, col, rowspan, colspan } = raw;
    if (row < 0 || col < 0 || rowspan < 1 || colspan < 1 || row + rowspan > rows.length || col + colspan > cols) throw Error('合并单元格越界或跨度无效。');
    for (let r = row; r < row + rowspan; r++) for (let c = col; c < col + colspan; c++) {
      const key = r * cols + c;
      if (occupied.has(key)) throw Error('合并单元格区域不能重叠。');
      occupied.add(key);
    }
    if (rowspan > 1 || colspan > 1) merges.push({ row, col, rowspan, colspan });
  }
  let widths = table.columnWidths ?? Array(cols).fill(1);
  if (!Array.isArray(widths) || widths.length !== cols || widths.some(n => !Number.isFinite(n) || n <= 0)) throw Error('列宽必须逐列提供正数。');
  const total = widths.reduce((sum,n) => sum + n,0);
  if (!Number.isFinite(total)) throw Error('列宽总和无效。');
  // Revalidating a saved percentage grid must be byte-stable. Tiny floating
  // point drift otherwise marks an untouched project dirty and stales proofs.
  return { rows, merges, columnWidths: Math.abs(total-100)<1e-9?[...widths]:widths.map(n => n / total * 100) };
}

export function cellMerge(table, row, col) {
  return (table.merges || []).find(m => row >= m.row && row < m.row + m.rowspan && col >= m.col && col < m.col + m.colspan);
}
export function validateCellImages(blocks){
  const byId=new Map(blocks.map(b=>[b.id,b])),owned=new Set();
  for(const table of blocks){
    if(table.cellImages===undefined)continue;
    if(table.type!=='table'||!Array.isArray(table.cellImages)||table.cellImages.length>10000)throw Error('单元格图片列表无效。');
    for(const cell of table.cellImages){
      if(!cell||!Number.isInteger(cell.row)||!Number.isInteger(cell.col)||cell.row<0||cell.col<0||table.rows[cell.row]?.[cell.col]===undefined)throw Error('单元格图片位置无效。');
      const image=byId.get(cell.imageId),merge=cellMerge(table,cell.row,cell.col);
      if(!image||image.type!=='image'||owned.has(image.id)||image.anchor||image.captionIds?.length||image.sideTextIds?.length||image.text||(image.wrap&&image.wrap!=='none')||(image.placement&&image.placement!=='auto'))throw Error('单元格图片不存在、重复归属或含独立定位/题注。');
      if(merge&&(merge.rowspan!==1||merge.row!==cell.row||merge.col!==cell.col))throw Error('单元格图片只支持普通格或横向合并起点。');
      owned.add(image.id);
    }
  }
  return owned;
}
export function cellDisplayText(table, row, col) {
  const merge = cellMerge(table,row,col);
  if (!merge) return table.rows[row]?.[col] ?? '';
  const text = [];
  for (let r=merge.row;r<merge.row+merge.rowspan;r++) for(let c=merge.col;c<merge.col+merge.colspan;c++) {
    if (table.rows[r][c] !== '') text.push(table.rows[r][c]);
  }
  return text.join('\n');
}

export function cellDisplayMarks(table,row,col){
  const merge=cellMerge(table,row,col)||{row,col,rowspan:1,colspan:1};const marks=[];let offset=0;
  for(let r=merge.row;r<merge.row+merge.rowspan;r++)for(let c=merge.col;c<merge.col+merge.colspan;c++){
    const text=table.rows[r][c];if(!text)continue;
    for(const m of table.cellMarks?.find(x=>x.row===r&&x.col===c)?.marks||[])marks.push({...m,start:m.start+offset,end:m.end+offset});offset+=text.length+1;
  }
  return marks;
}

/** Half-open row groups. No legal page boundary cuts a vertical merge. */
export function tableRowGroups(table) {
  const clean = validateTable(table), joined = new Set();
  for (const m of clean.merges) for(let boundary=m.row+1;boundary<m.row+m.rowspan;boundary++)joined.add(boundary);
  const groups=[];let start=0;
  for(let end=1;end<=clean.rows.length;end++)if(!joined.has(end)){groups.push({start,end});start=end;}
  return groups;
}

export function headerRowCount(table) {
  let count=Math.max(0,Math.min(table.rows.length,Number.isInteger(table.headerRows)?table.headerRows:1));
  const original=count;
  for(const group of tableRowGroups(table))if(group.start<count&&group.end>count)count=group.end;
  return {count,warnings:count!==original?[`合并单元格跨越表头边界，重复表头已扩展为 ${count} 行。`]:[]};
}

/** Each callback receives the complete visible merged text, never HTML. */
export function buildTableElement(table, {rowIndexes,renderCell}={}) {
  const clean=validateTable(table), el=document.createElement('table');
  el.className=table.borderStyle||'grid';el.style.tableLayout='fixed';el.style.width='100%';
  const cols=document.createElement('colgroup');
  for(const width of clean.columnWidths){const col=document.createElement('col');col.style.width=`${width}%`;cols.append(col);}el.append(cols);
  const indexes=rowIndexes??clean.rows.map((_,i)=>i), visible=new Set(indexes), heads=headerRowCount({...table,...clean}).count;
  if(visible.size!==indexes.length||indexes.some((r,i)=>!Number.isInteger(r)||r<0||r>=clean.rows.length||(i>0&&r<=indexes[i-1])))throw Error('表格片段行索引无效。');
  for(const m of clean.merges){let n=0;for(let r=m.row;r<m.row+m.rowspan;r++)if(visible.has(r))n++;if(n&&n!==m.rowspan)throw Error('表格片段不能切断纵向合并组；超页合并组需要人工拆分。');}
  const body=document.createElement('tbody');
  for(const row of indexes){const tr=document.createElement('tr');tr.dataset.row=String(row);
    for(let col=0;col<clean.rows[row].length;col++){
      const merge=cellMerge(clean,row,col);if(merge&&(merge.row!==row||merge.col!==col))continue;
      const td=document.createElement(row<heads?'th':'td');td.dataset.row=String(row);td.dataset.col=String(col);
      if(merge){td.rowSpan=merge.rowspan;td.colSpan=merge.colspan;}
      const text=cellDisplayText(clean,row,col);if(renderCell)renderCell(td,text,{row,col});else td.textContent=text;
      tr.append(td);
    }body.append(tr);
  }el.append(body);return el;
}

export function mergeCells(table, {row,col,rowspan,colspan}) {
  const clean=validateTable(table), candidate={row,col,rowspan,colspan};
  // Existing merges may be wholly absorbed, but never partially cut.
  const merges=clean.merges.filter(m=>{
    const overlaps=row<m.row+m.rowspan&&row+rowspan>m.row&&col<m.col+m.colspan&&col+colspan>m.col;
    if(!overlaps)return true;
    if(row<=m.row&&col<=m.col&&row+rowspan>=m.row+m.rowspan&&col+colspan>=m.col+m.colspan)return false;
    throw Error('选区切开了已有合并格，请扩大选区或先拆分。');
  });
  return {...table,...validateTable({...clean,merges:[...merges,candidate]})};
}
export function splitCell(table,row,col) {
  const clean=validateTable(table), target=cellMerge(clean,row,col);
  return {...table,...clean,merges:clean.merges.filter(m=>m!==target)};
}

/** Insert/delete one row or column. Deletion is explicit and may remove its text. */
export function resizeTable(table,axis,index,remove=false) {
  const clean=validateTable(table), rows=clean.rows, isRow=axis==='row';
  if(!isRow&&axis!=='col')throw Error('操作方向无效。');
  const length=isRow?rows.length:rows[0].length;
  if(!Number.isInteger(index)||index<0||index>(remove?length-1:length))throw Error('行列位置越界。');
  if(remove&&length===1)throw Error('表格必须至少保留一行一列。');
  if(remove&&table.cellImages?.some(c=>c[axis]===index))throw Error('该行列含单元格图片，请先显式解除归属或移走图片。');
  if(isRow){if(remove)rows.splice(index,1);else rows.splice(index,0,Array(rows[0].length).fill(''));}
  else for(const row of rows){if(remove)row.splice(index,1);else row.splice(index,0,'');}
  const pos=isRow?'row':'col',span=isRow?'rowspan':'colspan';
  const merges=clean.merges.map(m=>{const next={...m};if(remove){if(index<m[pos])next[pos]--;else if(index<m[pos]+m[span])next[span]--;}else {if(index<=m[pos])next[pos]++;else if(index<m[pos]+m[span])next[span]++;}return next;}).filter(m=>m.rowspan>0&&m.colspan>0&&(m.rowspan>1||m.colspan>1));
  const columnWidths=[...clean.columnWidths];if(!isRow){if(remove)columnWidths.splice(index,1);else columnWidths.splice(index,0,100/length);}
  let headerRows=table.headerRows??1;if(isRow&&index<headerRows)headerRows+=remove?-1:1;
  const cellMarks=(table.cellMarks||[]).filter(c=>!remove||c[pos]!==index).map(c=>({...c,[pos]:c[pos]+(remove?(c[pos]>index?-1:0):(c[pos]>=index?1:0))}));
  const cellImages=(table.cellImages||[]).map(c=>({...c,[pos]:c[pos]+(remove?(c[pos]>index?-1:0):(c[pos]>=index?1:0))}));
  return {...table,...validateTable({rows,merges,columnWidths}),...(table.cellMarks?{cellMarks}:{}),...(table.cellImages?{cellImages}:{}),headerRows:Math.min(rows.length,headerRows)};
}
