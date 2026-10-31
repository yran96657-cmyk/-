import {
  uid,
  defaults,
  validateDocument,
  plainDocument,
  sampleDocument,
  History,
  replaceBlockText,
} from "./model.mjs";
import { paginate, blockElement, notesElement } from "./pagination.mjs";
import {previewHeader} from './journal-preview.mjs';
import { parseFbd } from "./fbd.mjs";
import { setupAdvanced } from './advanced-ui.mjs';
import { setupEditorTools } from './editor-tools.mjs';
import { setupWorkspaceTools } from './workspace-tools.mjs';
import { setupProImport } from './pro-ui.mjs';
import { setupTableEditor } from './table-editor.mjs';
import { applyFlowColumn } from './flow-layout.mjs';
import { setupProduction } from './production-ui.mjs';
import { setupRubyEditor } from './ruby.mjs';
import {materializeReferences} from './references.mjs';
import {setupCloud} from './cloud-ui.mjs';
import {setupReview} from './review-ui.mjs';
import {setupProofmarkReview} from './proofmark-review-ui.mjs';
import {makeTemplate} from './templates.mjs';
import {importDocx} from './docx-web.mjs';
import {setupComposition} from './composition-ui.mjs';
import {setupPrintExport} from './print-ui.mjs';
import {setupNativeEditor} from './native-ui.mjs';
import {setupWorkbench} from './workbench.mjs';
import {blockDeletion,blockLabel,isBlockDeleteKey} from './block-actions.mjs';
import {figureGroups} from './figure-audit.mjs';
import {createDraftStore} from './draft-store.mjs';
import {confirmAction} from './dialogs.mjs';
const $ = (id) => document.getElementById(id),
  storageKey = "shuye-web-"+(new URLSearchParams(location.search).get("project")||"sample"),
  history = new History();
let doc = makeTemplate("book","文字的秩序"),
  selected = null,
  zoom = 0.8,
  paginationTimer,
  editingSnapshot = null,
  editingSelected = null,
  renderVersion = 0,
  lastPages = [];
let advancedUI, compositionUI, selectionRange=null;
const localDrafts=createDraftStore();
let localDraftTimer,localDraftSequence=0;
let startupWarning = "",
  protectAutosave = false;
try {
  if(!new URLSearchParams(location.search).has('project')){
    const current=await localDrafts.read('@anonymous');
    if(current?.document)doc=validateDocument(current.document);
    else {let saved;try{saved=localStorage.getItem(storageKey);}catch{}if(saved){doc=validateDocument(JSON.parse(saved));await localDrafts.write('@anonymous',{document:doc});try{localStorage.removeItem(storageKey);}catch{}}}
  }
} catch (e) {
  protectAutosave = true;
  startupWarning = "自动保存未能读取，已显示示例。" + e.message;
}
selected = doc.blocks[0]?.id;
function status(message, error = false) {
  $("status").textContent = message;
  $("status").classList.toggle("error", error);
}
function persist() {
  document.dispatchEvent(new Event('shuye:document-changed'));
  if(new URLSearchParams(location.search).has('project')){
    // ProjectConnection owns project-scoped IndexedDB drafts. Do not duplicate
    // image-heavy cloud documents into the small anonymous localStorage slot.
    return;
  }
  if (protectAutosave) {
    $("saveState").textContent = "原自动保存已保留，请另存工程";
    return;
  }
  clearTimeout(localDraftTimer);const sequence=++localDraftSequence;
  localDraftTimer=setTimeout(()=>saveAnonymousDraft(sequence),400);
}
async function saveAnonymousDraft(sequence=++localDraftSequence){
  if(protectAutosave||new URLSearchParams(location.search).has('project'))return;
  try{
    await localDrafts.write('@anonymous',{document:doc});
    if(sequence===localDraftSequence&&!new URLSearchParams(location.search).has('project'))$('saveState').textContent='已自动保存到此浏览器';
  }catch{
    if(sequence===localDraftSequence&&!new URLSearchParams(location.search).has('project')){$('saveState').textContent='自动保存失败，请下载备份';status('浏览器草稿保存失败，请使用“下载备份”保存工程。',true);}
  }
}
window.addEventListener('pagehide',()=>{clearTimeout(localDraftTimer);void saveAnonymousDraft();});

function checkpoint() {
  history.push(doc,selected);
  updateHistory();
}
function updateHistory() {
  $("undo").disabled = !history.past.length;
  $("redo").disabled = !history.future.length;
}
function active() {
  return doc.blocks.find((b) => b.id === selected);
}
function showTab(name) {
  for (const tab of ["Layout", "Block"]) {
    $(`tab${tab}`).setAttribute("aria-selected", String(name === tab));
    $(`${tab.toLowerCase()}Panel`).hidden = name !== tab;
  }
}
function choose(id, tab = true) {
  selected = id;
  document
    .querySelectorAll(".outline button")
    .forEach((el) => el.classList.toggle("active", el.dataset.id === id));
  document
    .querySelectorAll(".block[data-id]")
    .forEach((el) => el.classList.toggle("selected", el.dataset.id === id));
  fillBlock();
  if (tab) showTab("Block");
}
function fillLayout() {
  $("title").value = doc.title;
  document
    .querySelectorAll("[data-layout]")
    .forEach((el) => (el.value = doc.layout[el.dataset.layout]));
  const l = doc.layout;
  $("preset").value =
    l.width === 185 && l.height === 260
      ? "book"
      : l.width === 210 && l.height === 297
        ? "a4"
        : l.width === 148 && l.height === 210
          ? "a5"
          : "custom";
}
function fillBlock() {
  const b = active();
  $('deleteBlock').disabled = !b;
  $('moveUp').disabled = !b || doc.blocks.indexOf(b) === 0;
  $('moveDown').disabled = !b || doc.blocks.indexOf(b) === doc.blocks.length - 1;
  $('deleteBlock').textContent = '删除' + blockLabel(b);
  document.dispatchEvent(new Event('shuye:selection-changed'));
  $("emptySelection").hidden = !!b;
  $("blockFields").hidden = !b;
  if (!b) return;
  $("blockType").value = b.type;
  $("blockType").disabled = ["image", "pageBreak"].includes(b.type);
  $("blockType").disabled = !['paragraph','heading'].includes(b.type);
  for (const opt of $("blockType").options)
    opt.disabled = !['paragraph','heading'].includes(opt.value);
  $("blockText").value = b.text;
  $("blockText").disabled = b.type === "pageBreak";
  $("textOptions").hidden = !['paragraph','heading','table'].includes(b.type);
  $("imageOptions").hidden = b.type !== "image";
  $("fontFamily").value = b.fontFamily || "serif";
  $("blockSize").value = b.fontSize ?? "";
  $("blockAlign").value = b.align || "justify";
  $("blockBold").checked = b.bold;
  $("imageWidth").value = b.width || 80;
  $("moveUp").disabled = doc.blocks.indexOf(b) === 0;
  $("moveDown").disabled = doc.blocks.indexOf(b) === doc.blocks.length - 1;
  advancedUI?.update();
}
function outline() {
  const frag = document.createDocumentFragment();
  const labelsById=new Map(doc.blocks.map(b=>[b.id,b.text]));
  for (const b of doc.blocks) {
    const el = document.createElement("button");
    el.dataset.id = b.id;
    el.className = `${b.type}${b.id === selected ? " active" : ""}`;
    const icon = document.createElement("span");
    icon.textContent = {
      heading: "题",
      paragraph: "文",
      pageBreak: "页",
      image: "图",
      table: '表', equation: '式', toc:'目', index:'索',
    }[b.type];
    const label = document.createElement("strong");
    const tableRows=b.rows||[];
    label.textContent =
      b.type === "pageBreak"
        ? "另起一页"
        : b.text || (b.captionIds?.map(id=>labelsById.get(id)).filter(Boolean).join(' · ')) || (b.type === 'table' ? `${tableRows.length} 行 × ${Math.max(0,...tableRows.map(row=>row.length))} 列` : b.type === "image" ? "未命名插图" : b.type === 'toc' ? '目录' : b.type === 'index' ? '索引' : "空白段落");
    el.append(icon, label);
    el.onclick = () => {
      choose(b.id);
      document
        .querySelector(`.block[data-id="${b.id}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    frag.append(el);
  }
  $("outline").replaceChildren(frag);
  $("blockCount").textContent = `${doc.blocks.length} 个组件`;
}
async function render() {
  const version = ++renderVersion;
  // FontFaceSet.ready can wait for document load while top-level module
  // initialization itself is awaiting this render. Never block cloud startup.
  const boundedFonts=promise=>Promise.race([promise.catch(()=>{}),new Promise(resolve=>setTimeout(resolve,2500))]);
  await boundedFonts(document.fonts.ready);
  if(compositionUI){const plan=compositionUI.render($('pages'),zoom);if(plan){$('paperMeta').textContent=`自由版面 · ${plan.pages.length} 页`;$('stats').textContent=`${doc.composition.stories.length} 个文字流`;$('layoutWarnings')?.remove();status(plan.warnings.length?plan.warnings.map(w=>w.message).join('；'):'自由版面已更新',!!plan.warnings.length);return;}}
  await Promise.all(
    doc.blocks
      .filter((b) => b.type === "image")
      .map(
        (b) =>
          new Promise((resolve) => {
            const i = new Image();
            i.onload = i.onerror = resolve;
            i.src = b.src;
          }),
      ),
  );
  if (
    version !== renderVersion ||
    document.activeElement?.matches(".block[contenteditable]")
  )
    return;
  await boundedFonts(Promise.all([document.fonts.load('16px KaTeX_Main'),document.fonts.load('16px KaTeX_Math')]));
  if (version !== renderVersion || document.activeElement?.matches('.block[contenteditable]')) return;
  const viewDoc=materializeReferences(doc),result = paginate(viewDoc, $("measure"));
  let diagnostic=document.getElementById('layoutWarnings');
  if(!diagnostic){diagnostic=document.createElement('details');diagnostic.id='layoutWarnings';diagnostic.className='layout-warnings';$('pages').before(diagnostic);}
  diagnostic.replaceChildren();diagnostic.hidden=!result.warnings.length;
  if(result.warnings.length){const summary=document.createElement('summary');summary.textContent=`排版提示（${result.warnings.length} 项）`;diagnostic.append(summary);for(const message of result.warnings){const p=document.createElement('p');p.textContent=message;diagnostic.append(p);}}
  lastPages = result.pages;
  const fragment = document.createDocumentFragment(),
    l = {...doc.layout,_journal:doc.journal,_notes:viewDoc.notes||[],_images:new Map(viewDoc.blocks.filter(b=>b.type==='image').map(b=>[b.id,b]))};
  const mm = 96 / 25.4;
  result.pages.forEach((columns, index) => {
    const wrap = document.createElement("div");
    wrap.className = "paper-wrap";
    wrap.style.width = `${l.width * mm * zoom}px`;
    wrap.style.height = `${l.height * mm * zoom}px`;
    const page = document.createElement("article");
    page.className = "paper";
    page.setAttribute("aria-label", `第 ${index + l.pageStart} 页`);
    page.style.width = `${l.width}mm`;
    page.style.height = `${l.height}mm`;
    page.style.transform = `scale(${zoom})`;
    const left = (index + l.pageStart) % 2 === 1 ? l.inner : l.outer;
    const header = document.createElement("div");
    header.className = "paper-header";
    header.textContent = previewHeader(l,doc.journal,index+l.pageStart);
    header.style.left = `${left}mm`;
    header.style.right = `${l.width - left - (l.width - l.inner - l.outer)}mm`;
    header.style.top = `${Math.max(3, l.top - 9)}mm`;
    const frontHeight=result.frontHeights?.[index]||0;
    const front=document.createElement('div');front.className='paper-frontmatter';
    Object.assign(front.style,{position:'absolute',left:`${left}mm`,top:`${l.top}mm`,width:`${l.width-l.inner-l.outer}mm`});
    const body = document.createElement("div");
    body.className = "paper-body";
    Object.assign(body.style, {
      left: `${left}mm`,
      top: `${l.top*mm+frontHeight}px`,
      width: `${l.width - l.inner - l.outer}mm`,
      height: `${(l.height-l.top-l.bottom)*mm-(result.noteHeights[index]||0)-frontHeight}px`,
    });
    body.style.setProperty("--gap", `${l.gap}mm`);
    body.style.flexDirection=l.writingMode==='vertical-rl'?'row-reverse':'row';
    columns.forEach((parts) => {
      const col = document.createElement("div");
      col.className = "paper-column";
      applyFlowColumn(col,l,result.width,(l.height-l.top-l.bottom)*mm-(result.noteHeights[index]||0)-frontHeight);
      for (const part of parts) {
        const el = blockElement(part.block, l, part.block.type==='table'?part.block.text:part.text, part.continued||part.start>0,part);
        el.dataset.id = part.block.id;
        el.dataset.start = part.start;
        el.dataset.end = part.end;
        if (part.block.id === selected) el.classList.add("selected");
        if (['paragraph','heading'].includes(part.block.type) && !part.readOnly && !part.block.ruby?.length && !part.block.inlineMath?.length) {
          el.contentEditable = "plaintext-only";
          el.spellcheck = false;
          el.setAttribute(
            "aria-label",
            `${part.block.type === "heading" ? "标题" : "正文"}：${part.text.slice(0, 24)}`,
          );
          let original = part.text;
          el.onfocus = () => {
            clearTimeout(paginationTimer);
            choose(part.block.id);
            editingSnapshot = JSON.stringify(doc);
            editingSelected = selected;
          };
          el.oninput = () => {
            const b = doc.blocks.find((b) => b.id === part.block.id);
            if (!b) return;
            const value = el.innerText.replace(/\r/g, "");
            if (b.text.length - original.length + value.length > 300000) {
              el.textContent = original;
              status("单段不能超过 300,000 字符，请拆成多个段落。", true);
              return;
            }
            const oldEnd = part.start + original.length,
              delta = value.length - original.length;
            replaceBlockText(b,b.text.slice(0,part.start)+value+b.text.slice(oldEnd));
            for (const page of lastPages)
              for (const col of page)
                for (const other of col) {
                  if (
                    other !== part &&
                    other.block.id === part.block.id &&
                    other.start >= oldEnd
                  ) {
                    other.start += delta;
                    other.end += delta;
                  }
                }
            part.end = part.start + value.length;
            part.text = value;
            original = value;
            const fragments=lastPages.flatMap(p=>p.flat()).filter(p=>p.block.id===b.id);
            document.querySelectorAll(`.paper .block[data-id="${b.id}"]`).forEach((node,i)=>{node.dataset.start=fragments[i].start;node.dataset.end=fragments[i].end;});
            $("blockText").value = b.text;
            persist();
            status("正在编辑；离开段落后自动重新分页");
          };
          el.onblur = () => {
            if (editingSnapshot && editingSnapshot !== JSON.stringify(doc)) {
              history.push(JSON.parse(editingSnapshot),editingSelected);
              updateHistory();
            }
            editingSnapshot = null;
            clearTimeout(paginationTimer);
            paginationTimer = setTimeout(() => {
              outline();
              render();
            }, 140);
          };
          el.onpaste = (e) => {
            e.preventDefault();
            const text = e.clipboardData.getData("text/plain");
            document.execCommand("insertText", false, text);
          };
        } else el.onclick = () => choose(part.block.id);
        (part.fullWidth?front:col).append(el);
      }
      body.append(col);
    });
    const footer = document.createElement("div");
    footer.className = "paper-footer";
    footer.textContent = ((index+l.pageStart)%2===0?l.footerEven:l.footer).replaceAll('{page}',String(index+l.pageStart));
    page.append(header, front, body, footer);
    if(result.pageNotes[index]?.length){const notes=notesElement(result.pageNotes[index],l);Object.assign(notes.style,{left:`${left}mm`,bottom:`${l.bottom}mm`,width:`${l.width-l.inner-l.outer}mm`});page.append(notes);}
    wrap.append(page);
    fragment.append(wrap);
  });
  $("pages").replaceChildren(fragment);
  $("paperMeta").textContent =
    `${l.width} × ${l.height} mm　${l.columns} 栏　${result.pages.length} 页${doc.journal ? "（结构编辑预览）" : ""}`;
  $("paperMeta").nextElementSibling.textContent = doc.journal ? "首面、锚点与最终分页请查看「全文期刊 PDF」" : "单击纸面即可编辑";
  $("stats").textContent =
    `${doc.blocks.reduce((n, b) => n + Array.from(b.text).length + (b.rows||[]).flat().reduce((s,t)=>s+Array.from(t).length,0), 0).toLocaleString()} 字符　/　${result.pages.length} 页`;
  let css = $("printStyle");
  if (!css) {
    css = document.createElement("style");
    css.id = "printStyle";
    document.head.append(css);
  }
  css.textContent = `@page {size:${l.width}mm ${l.height}mm;margin:0}`;
  if (result.warnings.length) status(result.warnings.join(" "), true);
  else status("排版已更新");
}
function refresh() {
  fillLayout();
  fillBlock();
  outline();
  updateHistory();
  persist();
  return render();
}
function change(fn) {
  const previous=structuredClone(doc),previousSelected=selected;
  try{fn();doc=validateDocument(doc);}catch(e){doc=previous;selected=previousSelected;fillLayout();fillBlock();status(e.message,true);return Promise.resolve(false);}
  history.push(previous,previousSelected);
  return refresh();
}
function insert(type, extra = {}) {
  if (doc.blocks.length >= 10000) {
    status("文稿已达 10,000 段，请分卷。", true);
    return;
  }
  if (
    extra.src &&
    new Blob([JSON.stringify(doc), extra.src]).size > 90 * 1024 * 1024
  ) {
    status("图片总量过大，请压缩图片或分卷。", true);
    return;
  }
  change(() => {
    const b = {
      id: uid(),
      type,
      text:
        type === "heading"
          ? "新的标题"
          : type === "paragraph"
            ? "请输入正文"
            : "",
      fontFamily: type === "heading" ? "sans" : "serif",
      align: type === "heading" ? "left" : "justify",
      ...extra,
    };
    const i = doc.blocks.findIndex((b) => b.id === selected);
    doc.blocks.splice(i < 0 ? doc.blocks.length : i + 1, 0, b);
    selected = b.id;
  });
  showTab("Block");
}
function validatedLayout(updates) {
  try {
    const next = validateDocument({
      ...doc,
      layout: { ...doc.layout, ...updates },
    });
    change(() => (doc = next));
  } catch (e) {
    status(e.message, true);
    fillLayout();
  }
}
document
  .querySelectorAll("[data-layout]")
  .forEach((el) =>
    el.addEventListener("change", () =>
      validatedLayout({
        [el.dataset.layout]:
          ['header','headerEven','footer','footerEven','notesMode','writingMode'].includes(el.dataset.layout) ? el.value : Number(el.value),
      }),
    ),
  );
$("preset").onchange = () => {
  const size = { book: [185, 260], a4: [210, 297], a5: [148, 210] }[
    $("preset").value
  ];
  if (size) validatedLayout({ width: size[0], height: size[1] });
};
$("title").onchange = () =>
  change(() => (doc.title = $("title").value.trim() || "未命名文稿"));
$("tabLayout").onclick = () => showTab("Layout");
$("tabBlock").onclick = () => showTab("Block");
$("addParagraph").onclick = () => insert("paragraph");
$("addHeading").onclick = () => insert("heading");
$("addBreak").onclick = () => insert("pageBreak");
$("newDoc").onclick = () => {
  if (!confirm("新建空白文稿？请先保存当前工程。")) return;
  change(() => {
    doc = plainDocument("", "未命名文稿");
    doc.blocks = [
      {
        id: uid(),
        type: "paragraph",
        text: "",
        align: "justify",
        fontFamily: "serif",
      },
    ];
    selected = doc.blocks[0].id;
  });
};
function restoreHistory(direction) {
  const next = history[direction](doc,selected);
  if (!next) return;
  doc = next;
  selected = doc.blocks.some(b=>b.id===history.selection) ? history.selection : doc.blocks[0]?.id;
  editingSnapshot=null;selectionRange=null;
  void refresh().then(()=>{
    if(selected)document.querySelector(`.paper .block[data-id="${CSS.escape(selected)}"]`)?.scrollIntoView({block:'nearest'});
    const message=direction==='undo'?'已撤销，已恢复原组件选择。':'已重做。';
    status(message);notice(message);
  });
}
$("undo").onclick = () => restoreHistory('undo');
$("redo").onclick = () => restoreHistory('redo');
function fitPage() {
  const canvas=document.querySelector('.canvas'),mm=96/25.4;
  if($('zoom').value!=='fit')return;
  const next=Math.max(.15,Math.min(1.2,(canvas.clientWidth-60)/(doc.layout.width*mm),(canvas.clientHeight-108)/(doc.layout.height*mm)));
  if(Math.abs(next-zoom)<.001)return;
  zoom=next;render();
}
$("zoom").onchange = () => {
  if($('zoom').value==='fit')fitPage();
  else {zoom=Number($('zoom').value);render();}
};
$("guides").onchange = () =>
  $("pages").classList.toggle("hide-guides", !$("guides").checked);
$("blockText").onfocus = () => {
  editingSnapshot = JSON.stringify(doc);
  editingSelected = selected;
};
$("blockText").oninput = () => {
  const b = active();
  if (b) {
    if ($("blockText").value.length > 300000) {
      $("blockText").value = b.text;
      status("单段不能超过 300,000 字符，请拆段。", true);
      return;
    }
    replaceBlockText(b,$('blockText').value);
    persist();
    clearTimeout(paginationTimer);
    paginationTimer = setTimeout(() => {
      outline();
      render();
    }, 350);
  }
};
$("blockText").onblur = () => {
  if (editingSnapshot && editingSnapshot !== JSON.stringify(doc)) {
    history.push(JSON.parse(editingSnapshot),editingSelected);
    updateHistory();
  }
  editingSnapshot = null;
};
for (const [id, key, convert] of [
  ["blockType", "type", (v) => v],
  ["fontFamily", "fontFamily", (v) => v],
  ["blockSize", "fontSize", (v) => (v === "" ? undefined : Number(v))],
  ["blockAlign", "align", (v) => v],
  ["blockBold", "bold", (_, el) => el.checked],
  ["imageWidth", "width", Number],
]) {
  $(id).onchange = () => {
    if (!active()) return;
    try {
      const copy = structuredClone(doc),
        b = copy.blocks.find((b) => b.id === selected);
      b[key] = convert($(id).value, $(id));
      const next = validateDocument(copy);
      change(() => (doc = next));
    } catch (e) {
      status(e.message, true);
      fillBlock();
    }
  };
}
const notice=(message,tone='info',undo=false)=>document.dispatchEvent(new CustomEvent('shuye:notice',{detail:{message,tone,undo}}));
async function deleteSelected(includeCaptions=false,id=selected) {
  const b=doc.blocks.find(b=>b.id===id);if(!b)return;
  try {
    const result=blockDeletion(doc,id,{includeCaptions});
    if(await change(()=>{doc=result.document;selected=result.selected;})===false)return;
    const message=`已删除${blockLabel(b)}${includeCaptions?'及关联题注':''}。可撤销恢复。`;
    status(message);notice(message,'info',true);
    document.querySelector('#wbDeleteBlock')?.focus();
  } catch(e) {status(e.message,true);notice(e.message,'error');}
}
$('deleteBlock').onclick=()=>{
  const b=active();if(!b)return;
  const anchored=doc.blocks.filter(a=>a.anchor?.targetId===b.id||a.sideTextIds?.includes(b.id));
  const cellImages=b.cellImages?.length||0;
  if(!b.captionIds?.length&&!anchored.length&&!cellImages){void deleteSelected();return;}
  const d=document.createElement('dialog');d.className='workspace-dialog wb-delete-dialog';
  const h=document.createElement('h2');h.id='deleteComponentTitle';h.textContent='删除'+blockLabel(b);d.setAttribute('aria-labelledby',h.id);
  const p=document.createElement('p');p.textContent=[b.captionIds?.length?'默认保留题注。':'',anchored.length?`${anchored.length} 个关联组件将保留在文稿中，解除位置绑定。`:'',cellImages?`${cellImages} 张单元格图片将保留为独立组件。`:''].join('');
  const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';label.append(check,'同时删除关联题注');label.hidden=!b.captionIds?.length;
  const actions=document.createElement('div');actions.className='wb-delete-actions';
  const cancel=document.createElement('button');cancel.textContent='取消';cancel.onclick=()=>d.close();
  const remove=document.createElement('button');remove.textContent='删除'+blockLabel(b);remove.className='danger';remove.onclick=()=>{const captions=check.checked;d.close();void deleteSelected(captions,b.id);};
  actions.append(cancel,remove);d.append(h,p,label,actions);d.onclose=()=>{d.remove();document.querySelector('#wbDeleteBlock')?.focus();};document.body.append(d);d.showModal();cancel.focus();
};
document.addEventListener('keydown',e=>{
  if(!isBlockDeleteKey(e)||e.defaultPrevented||document.querySelector('dialog[open]')||document.querySelector('.workspace.composition-mode'))return;
  if(e.target.closest?.('input,textarea,select,[contenteditable], [role="textbox"]'))return;
  if(!e.target.closest?.('.canvas,.outline,.wb-selection'))return;
  e.preventDefault();$('deleteBlock').click();
});
for (const [id, delta] of [
  ["moveUp", -1],
  ["moveDown", 1],
])
  $(id).onclick = () => {
    const i = doc.blocks.findIndex((b) => b.id === selected);
    if (i < 0 || i + delta < 0 || i + delta >= doc.blocks.length) return;
    change(() => {
      const [b] = doc.blocks.splice(i, 1);
      doc.blocks.splice(i + delta, 0, b);
    });
  };
function download() {
  const serialized = JSON.stringify(doc, null, 2);
  if (new Blob([serialized]).size > 100 * 1024 * 1024) {
    status("工程超过 100 MB，请减少图片或分卷保存。", true);
    return;
  }
  const blob = new Blob([JSON.stringify(doc, null, 2)], {
      type: "application/json",
    }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = `${doc.title.replace(/[<>:"/\\|?*]/g, "_")}.shuye.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  status("工程文件已交给浏览器保存");
}
$("save").onclick = download;
$("print").onclick = async () => {
  clearTimeout(paginationTimer);
  await render();
  window.print();
};
$("open").onclick = () => $("fileInput").click();
$("fileInput").onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  if (
    f.size >
    (f.name.toLowerCase().endsWith(".json") ? 100 : 20) * 1024 * 1024
  ) {
    status("文稿超过导入限制（工程 100 MB，其他 20 MB），请分卷处理。", true);
    return;
  }
  let replacementStarted=false;
  try {
    let imported,
      warnings = [];
    const ext = f.name.split(".").pop().toLowerCase();
    if(['ffx','ffxb','ftpx','fxpkg','pdml','xml'].includes(ext))throw Error('飞翔原生/PDML/XML 格式尚未完成兼容验收。请保留原文件；当前不能作为书页工程导入。');
    const title = f.name.replace(/\.[^.]+$/, "");
    if (ext === "json") {
      imported = validateDocument(JSON.parse(await f.text()));
    } else if (ext === "docx") {
      const result = await importDocx(await f.arrayBuffer());
      warnings = result.warnings;
      imported = validateDocument({
        format: "open-typesetter",
        version: 1,
        title,
        layout: defaults,
        blocks: result.blocks,
        notes: result.notes||[],
      });
    } else {
      const data = await f.arrayBuffer();
      let text;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(data);
      } catch {
        text = new TextDecoder("gb18030", { fatal: true }).decode(data);
      }
      if (ext === "fbd") {
        const parsed = parseFbd(text);
        warnings = parsed.warnings;
        imported = validateDocument({
          format: "open-typesetter",
          version: 1,
          title,
          layout: {...defaults,...parsed.layout},
          blocks: parsed.blocks,
        });
      } else if (ext === "txt") imported = plainDocument(text, title);
      else throw Error("请选择 JSON、TXT、FBD 或 DOCX。");
    }
    if (!await confirmAction(`打开“${f.name}”并替换当前文稿？当前文稿可通过撤销恢复。`))
      return;
    await change(() => {
      replacementStarted=true;
      doc = imported;
      selected = doc.blocks[0]?.id;
    });
    if (warnings.length) {
      status(`导入提示：${warnings.length} 项，已显示详情`, true);
      alert("导入提示（请核对原稿）：\n\n" + warnings.join("\n"));
    } else status("文稿已导入");
  } catch (err) {
    status(err.message, true);
    if (extnameIsDocx(f.name)) {
      const d=document.createElement('dialog');d.className='workspace-dialog';
      const h=document.createElement('h2');h.textContent=replacementStarted?'导入后显示失败 · 可撤销恢复原稿':'导入未完成 · 当前文稿未替换';
      const details=document.createElement('pre');details.style.whiteSpace='pre-wrap';details.textContent=err.message;
      const close=document.createElement('button');close.textContent=replacementStarted?'关闭并检查文稿':'保留原稿并关闭';close.onclick=()=>d.close();
      d.append(h,details,close);d.onclose=()=>d.remove();document.body.append(d);d.showModal();
    }
  }
};
function extnameIsDocx(name){return /\.docx$/i.test(name);}
let pendingFigure=null;
$("addImage").onclick = () => {pendingFigure=null;$("imageInput").click();};
document.addEventListener('shuye:attach-figure',e=>{pendingFigure={blockId:e.detail.blockId,snapshot:JSON.stringify(doc)};$('imageInput').click();});
$("imageInput").onchange = async (e) => {
  const f = e.target.files[0];
  const target=pendingFigure;pendingFigure=null;
  e.target.value = "";
  if (!f) return;
  if (f.size > 5 * 1024 * 1024) {
    status("图片应小于 5 MB。", true);
    return;
  }
  try {
    if (!["image/png", "image/jpeg", "image/webp"].includes(f.type))
      throw Error("请选择 PNG、JPEG 或 WebP 图片。");
    const data = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(f);
    });
    await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = resolve;
      i.onerror = () => reject(Error("图片无法解码"));
      i.src = data;
    });
    if(target){
      if(target.snapshot!==JSON.stringify(doc))throw Error('选择图片期间文稿已变化，请重新补图。');
      const group=figureGroups(doc).find(g=>g.blockId===target.blockId&&!g.ownerId&&!g.adjacentId);
      if(!group)throw Error('该图题已变化或已有图体，请重新检查。');
      if(doc.blocks.length>=10000||new Blob([JSON.stringify(doc),data]).size>90*1024*1024)throw Error('工程容量不足，请压缩图片或分卷。');
      await change(()=>{const id=uid();doc.blocks.splice(doc.blocks.findIndex(b=>b.id===group.beforeId),0,{id,type:'image',text:'',src:data,width:80,wrap:'none',captionIds:group.captionIds});selected=id;});
      status(`已补入图${group.number}并关联题注。`);return;
    }
    insert("image", {
      src: data,
      width: 80,
      text: f.name.replace(/\.[^.]+$/, ""),
    });
  } catch (e) {
    status(e.message, true);
  }
};
$("help").onclick = () => $("helpDialog").showModal();
$("closeHelp").onclick = () => $("helpDialog").close();
document.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  if (e.key.toLowerCase() === "s") {
    e.preventDefault();
    download();
  }
  if (
    e.key.toLowerCase() === "z" &&
    !e.target.closest("input,textarea,[contenteditable]")
  ) {
    e.preventDefault();
    $(e.shiftKey ? "redo" : "undo").click();
  }
});
document.addEventListener('selectionchange',()=>{
  const input=$('blockText');
  if(document.activeElement===input){selectionRange={id:selected,start:input.selectionStart,end:input.selectionEnd};return;}
  const sel=window.getSelection();if(!sel?.rangeCount)return;
  const element=n=>n?.nodeType===1?n:n?.parentElement;
  const a=element(sel.anchorNode)?.closest('.paper .block[contenteditable]'),f=element(sel.focusNode)?.closest('.paper .block[contenteditable]');
  if(!a||!f||a.dataset.id!==f.dataset.id)return;
  const offset=(el,node,pos)=>{const r=document.createRange();r.selectNodeContents(el);r.setEnd(node,pos);return Number(el.dataset.start)+r.toString().length;};
  const start=offset(a,sel.anchorNode,sel.anchorOffset),end=offset(f,sel.focusNode,sel.focusOffset);
  selectionRange={id:a.dataset.id,start:Math.min(start,end),end:Math.max(start,end)};
});
advancedUI=setupAdvanced({getDoc:()=>doc,getSelected:()=>selected,change,insert,select:choose,status,replaceBlockText,getSelectionRange:()=>selectionRange});
setupEditorTools({getDoc:()=>doc,getSelected:()=>selected,change,select:choose,status,replaceBlockText});
setupTableEditor({getDoc:()=>doc,getSelected:()=>selected,change,status});
setupWorkspaceTools({getDoc:()=>doc,getSelected:()=>selected,change,select:choose,status,getSelectionRange:()=>selectionRange,replaceDoc:next=>change(()=>{doc=next;selected=doc.blocks[0]?.id;})});
setupReview({getDoc:()=>doc,getSelected:()=>selected,change,status});
setupProofmarkReview({getDoc:()=>doc});
compositionUI=setupComposition({getDoc:()=>doc,change,refresh,status});
setupPrintExport({getDoc:()=>doc,status});
setupNativeEditor();

setupRubyEditor({getDoc:()=>doc,getSelected:()=>selected,getSelectionRange:()=>selectionRange,change,status});
document.fonts.addEventListener('loadingdone',()=>{clearTimeout(paginationTimer);paginationTimer=setTimeout(()=>render(),100);});
void refresh();
const connection=await setupCloud({getDoc:()=>doc,status,replaceDoc:(next,{resetHistory=false}={})=>{
  if(!resetHistory)return change(()=>{doc=next;selected=doc.blocks[0]?.id;});
  const validated=validateDocument(next);doc=validated;selected=doc.blocks[0]?.id;
  history.clear();editingSnapshot=null;selectionRange=null;return refresh();
}});
setupWorkbench({getDoc:()=>doc,getSelected:()=>selected,select:choose,connection,fit:fitPage});
if (startupWarning) status(startupWarning, true);
