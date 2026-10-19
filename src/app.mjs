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
import {setupMcpProjects} from './mcp-ui.mjs';
const $ = (id) => document.getElementById(id),
  storageKey = "open-typesetter-v1",
  history = new History();
let doc = sampleDocument(),
  selected = null,
  zoom = 0.8,
  paginationTimer,
  editingSnapshot = null,
  renderVersion = 0,
  lastPages = [];
let advancedUI, selectionRange=null;
let startupWarning = "",
  protectAutosave = false;
try {
  const saved = localStorage.getItem(storageKey);
  if (saved) doc = validateDocument(JSON.parse(saved));
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
  if (protectAutosave) {
    $("saveState").textContent = "原自动保存已保留，请另存工程";
    return;
  }
  try {
    localStorage.setItem(storageKey, JSON.stringify(doc));
    $("saveState").textContent = "已自动保存到此浏览器";
  } catch {
    $("saveState").textContent = "自动保存失败，请保存工程";
    status("浏览器存储空间不足或已禁用，请点击“保存工程”备份。", true);
  }
}
function checkpoint() {
  history.push(doc);
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
    label.textContent =
      b.type === "pageBreak"
        ? "另起一页"
        : b.text || (b.type === "image" ? "未命名插图" : "空白段落");
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
  $("blockCount").textContent = `${doc.blocks.length} 段`;
}
async function render() {
  const version = ++renderVersion;
  await document.fonts.ready;
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
  await document.fonts.load('16px KaTeX_Main').catch(()=>{});
  await document.fonts.load('16px KaTeX_Math').catch(()=>{});
  if (version !== renderVersion || document.activeElement?.matches('.block[contenteditable]')) return;
  const viewDoc=materializeReferences(doc),result = paginate(viewDoc, $("measure"));
  let diagnostic=document.getElementById('layoutWarnings');
  if(!diagnostic){diagnostic=document.createElement('details');diagnostic.id='layoutWarnings';diagnostic.className='layout-warnings';$('pages').before(diagnostic);}
  diagnostic.replaceChildren();diagnostic.hidden=!result.warnings.length;
  if(result.warnings.length){const summary=document.createElement('summary');summary.textContent=`排版提示（${result.warnings.length} 项）`;diagnostic.append(summary);for(const message of result.warnings){const p=document.createElement('p');p.textContent=message;diagnostic.append(p);}}
  lastPages = result.pages;
  const fragment = document.createDocumentFragment(),
    l = {...doc.layout,_notes:viewDoc.notes||[]};
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
    header.textContent = (index+l.pageStart)%2===0?l.headerEven??l.header:l.header;
    header.style.left = `${left}mm`;
    header.style.right = `${l.width - left - (l.width - l.inner - l.outer)}mm`;
    header.style.top = `${Math.max(3, l.top - 9)}mm`;
    const body = document.createElement("div");
    body.className = "paper-body";
    Object.assign(body.style, {
      left: `${left}mm`,
      top: `${l.top}mm`,
      width: `${l.width - l.inner - l.outer}mm`,
      height: `${(l.height-l.top-l.bottom)*mm-(result.noteHeights[index]||0)}px`,
    });
    body.style.setProperty("--gap", `${l.gap}mm`);
    body.style.flexDirection=l.writingMode==='vertical-rl'?'row-reverse':'row';
    columns.forEach((parts) => {
      const col = document.createElement("div");
      col.className = "paper-column";
      applyFlowColumn(col,l,result.width,(l.height-l.top-l.bottom)*mm-(result.noteHeights[index]||0));
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
              history.push(JSON.parse(editingSnapshot));
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
        col.append(el);
      }
      body.append(col);
    });
    const footer = document.createElement("div");
    footer.className = "paper-footer";
    footer.textContent = ((index+l.pageStart)%2===0?l.footerEven:l.footer).replaceAll('{page}',String(index+l.pageStart));
    page.append(header, body, footer);
    if(result.pageNotes[index]?.length){const notes=notesElement(result.pageNotes[index],l);Object.assign(notes.style,{left:`${left}mm`,bottom:`${l.bottom}mm`,width:`${l.width-l.inner-l.outer}mm`});page.append(notes);}
    wrap.append(page);
    fragment.append(wrap);
  });
  $("pages").replaceChildren(fragment);
  $("paperMeta").textContent =
    `${l.width} × ${l.height} mm　${l.columns} 栏　${result.pages.length} 页${doc.journal ? '（结构编辑预览）' : ''}`;
  $("paperMeta").nextElementSibling.textContent = doc.journal ? '期刊首面、锚点与分页请查看「最终 PDF 校样」' : '单击纸面即可编辑';
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
  const previous=structuredClone(doc);
  try{fn();doc=validateDocument(doc);}catch(e){doc=previous;fillLayout();fillBlock();status(e.message,true);return Promise.resolve(false);}
  history.push(previous);
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
$("undo").onclick = () => {
  const prev = history.undo(doc);
  if (prev) {
    doc = prev;
    selected = doc.blocks.some((b) => b.id === selected)
      ? selected
      : doc.blocks[0]?.id;
    refresh();
  }
};
$("redo").onclick = () => {
  const next = history.redo(doc);
  if (next) {
    doc = next;
    selected = doc.blocks.some((b) => b.id === selected)
      ? selected
      : doc.blocks[0]?.id;
    refresh();
  }
};
$("zoom").onchange = () => {
  zoom = Number($("zoom").value);
  render();
};
$("guides").onchange = () =>
  $("pages").classList.toggle("hide-guides", !$("guides").checked);
$("blockText").onfocus = () => {
  editingSnapshot = JSON.stringify(doc);
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
    history.push(JSON.parse(editingSnapshot));
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
$("deleteBlock").onclick = () => {
  if (!active()) return;
  change(() => {
    const index = doc.blocks.findIndex((b) => b.id === selected);
    doc.blocks.splice(index, 1);
    doc.comments=doc.comments.filter(c=>c.blockId!==selected);
    selected = doc.blocks[Math.min(index, doc.blocks.length - 1)]?.id;
  });
};
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
  try {
    let imported,
      warnings = [];
    const ext = f.name.split(".").pop().toLowerCase();
    const title = f.name.replace(/\.[^.]+$/, "");
    if (ext === "json") {
      imported = validateDocument(JSON.parse(await f.text()));
    } else if (ext === "docx") {
      const response = await fetch("/api/import-docx", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: f,
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || "Word 导入失败");
      warnings = result.warnings;
      imported = validateDocument({
        format: "open-typesetter",
        version: 1,
        title,
        layout: defaults,
        blocks: result.blocks,
        notes: result.notes||[],
        importReports: result.importReports||[],
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
    if (!confirm(`打开“${f.name}”并替换当前文稿？当前文稿可通过撤销恢复。`))
      return;
    await change(() => {
      doc = imported;
      selected = doc.blocks[0]?.id;
    });
    if (warnings.length) {
      status(`导入提示：${warnings.length} 项，已显示详情`, true);
      alert("导入提示（请核对原稿）：\n\n" + warnings.join("\n"));
    } else status("文稿已导入");
  } catch (err) {
    status(err.message, true);
  }
};
$("addImage").onclick = () => $("imageInput").click();
$("imageInput").onchange = async (e) => {
  const f = e.target.files[0];
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
    !e.target.matches("input,textarea,[contenteditable]")
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
setupProImport({getDoc:()=>doc,status,replaceDoc:next=>change(()=>{doc=next;})});
setupMcpProjects({getDoc:()=>doc,status,replaceDoc:next=>change(()=>{doc=next;selected=doc.blocks[0]?.id;})});
setupProduction({getDoc:()=>doc,status});
setupRubyEditor({getDoc:()=>doc,getSelected:()=>selected,getSelectionRange:()=>selectionRange,change,status});
await refresh();
if (startupWarning) status(startupWarning, true);
