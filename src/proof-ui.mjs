import {materializeReferences} from './references.mjs';
import {documentDiagnostics} from './integrity.mjs';

export function setupProofUI({getDoc,change,status}) {
  const actions=document.querySelector('.file-actions');
  const button=(text,fn)=>{const el=document.createElement('button');el.textContent=text;el.onclick=fn;return el;};
  const dialog=document.createElement('dialog');dialog.className='workspace-dialog';document.body.append(dialog);
  let pdfURL=null,generation=0,loadingTask=null;
  const cleanup=()=>{if(pdfURL)URL.revokeObjectURL(pdfURL);pdfURL=null;loadingTask?.destroy().catch(()=>{});loadingTask=null;};
  dialog.addEventListener('close',()=>{generation++;cleanup();});
  const start=title=>{generation++;cleanup();dialog.style.width=dialog.style.maxWidth='min(1000px, 92vw)';dialog.replaceChildren();const h=document.createElement('h2');h.textContent=title;dialog.append(h);};
  const paragraph=text=>{const p=document.createElement('p');p.textContent=text;dialog.append(p);return p;};
  const close=()=>dialog.append(button('关闭',()=>dialog.close()));
  actions.append(button('导入核对',()=>{
    start('导入记录与内容核对');
    paragraph('保存工程后仍保留此记录。请保留原 DOCX，并按 SHA-256 核对来源；未转换的对象须回到原稿处理。');
    for(const r of getDoc().importReports||[])paragraph(`DOCX SHA-256：${r.sourceSha256}；公式 ${r.counts.importedMath}/${r.counts.sourceMath}；图片 ${r.counts.importedImages}/${r.counts.sourceImages}`);
    const diagnostics=documentDiagnostics(getDoc());
    if(!diagnostics.length)paragraph('此工程没有 DOCX 导入诊断记录；不表示内容已验收。');
    for(const d of diagnostics)paragraph(`${d.severity==='error'?'阻断':'待核对'}：${d.message}`);
    close();dialog.showModal();
  }));
  const exportButton=button('最终 PDF 校样',async()=>{
    start('最终 PDF 校样');
    paragraph('以下预览和下载使用同一份 PDF。编辑区的浏览器分页仅供编辑参考；PDF 校样仍需内容、视觉及印前验收。');
    const label=document.createElement('label');label.textContent='PDF 字体方案 ';
    const font=document.createElement('select');
    for(const [value,text] of [['','服务端配置（默认 Windows）'],['windows','Windows：宋体 / 黑体 / 楷体'],['mac','macOS：宋体 / 黑体 / 楷体'],['fandol','Fandol（TeX 自带）'],['source-han','思源宋体/黑体（需安装）']]){const option=document.createElement('option');option.value=value;option.textContent=text;font.append(option);}
    font.value=getDoc().layout.fontSet||'';
    font.onchange=()=>change(()=>{if(font.value)getDoc().layout.fontSet=font.value;else delete getDoc().layout.fontSet;});
    label.append(font);dialog.append(label);
    const result=paragraph('选择字体方案后生成校样。方案会保存在工程内；未安装的字体会报错。');
    const output=document.createElement('div');dialog.append(output);
    const generate=button('生成 PDF 校样',async()=>{
      generate.disabled=true;font.disabled=true;output.replaceChildren();cleanup();
      const token=++generation,snapshot=JSON.stringify(getDoc()),title=getDoc().title;
      result.textContent='正在排版并检查实际 PDF…';
      try {
        const response=await fetch('/api/render-proof',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({doc:materializeReferences(JSON.parse(snapshot))})});
        const data=await response.json();if(!response.ok)throw Error(data.error||'校样生成失败');
        if(token!==generation)return;
        if(JSON.stringify(getDoc())!==snapshot)throw Error('排版期间工程已变化，请为当前版本重新生成校样。');
        const bytes=Uint8Array.from(atob(data.pdf),c=>c.charCodeAt(0));
        const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
        if(digest!==data.report.pdfSha256)throw Error('校样字节与预检报告不匹配。');
        pdfURL=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
        result.textContent=`${data.report.outputPages} 页 · ${data.report.quality.status==='BLOCKED'?'存在阻断问题':'验收尚未完成'} · SHA-256 ${digest}`;
        output.append(button('下载此校样 PDF',()=>{
          if(JSON.stringify(getDoc())!==snapshot){status('工程已修改，请重新生成校样。',true);return;}
          const a=document.createElement('a');a.href=pdfURL;a.download=(title||'文稿').replace(/[<>:"/\\|?*]/g,'_')+'_校样.pdf';a.click();
        }));
        const details=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('pre');summary.textContent='预检结果与未完成项目';
        pre.textContent=JSON.stringify({quality:data.report.quality,layoutWarnings:data.report.layoutWarnings,fonts:data.report.fonts,images:data.report.images,renderer:data.report.renderer,geometryStatus:data.report.geometry.status},null,2);
        details.append(summary,pre);output.append(details);details.open=data.report.quality.status==='BLOCKED';
        // Native PDF iframes are blank in some embedded browsers. Render the
        // verified bytes locally; never paginate the document again for preview.
        const pdfjs=await import('/node_modules/pdfjs-dist/build/pdf.mjs');
        pdfjs.GlobalWorkerOptions.workerSrc='/node_modules/pdfjs-dist/build/pdf.worker.mjs';
        if(token!==generation)return;
        loadingTask=pdfjs.getDocument({data:bytes.slice(),isEvalSupported:false,
          cMapUrl:'/node_modules/pdfjs-dist/cmaps/',cMapPacked:true,
          standardFontDataUrl:'/node_modules/pdfjs-dist/standard_fonts/',wasmUrl:'/node_modules/pdfjs-dist/wasm/'});
        const pdf=await loadingTask.promise;
        if(token!==generation)return;
        const nav=document.createElement('div'),pageLabel=document.createElement('span'),canvas=document.createElement('canvas');
        canvas.id='proofCanvas';canvas.style.cssText='display:block;width:100%;height:auto;margin:12px auto;border:1px solid #ccc';
        let pageNumber=1;
        const previous=button('上一页',()=>showPage(pageNumber-1)),next=button('下一页',()=>showPage(pageNumber+1));
        nav.append(previous,pageLabel,next);output.append(nav,canvas);
        async function showPage(number){
          previous.disabled=next.disabled=true;
          try{
            const page=await pdf.getPage(number);if(token!==generation)return false;
            const base=page.getViewport({scale:1}),viewport=page.getViewport({scale:Math.min(2,1800/Math.max(base.width,base.height))});
            canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
            await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
            pageNumber=number;pageLabel.textContent=` 第 ${number} / ${pdf.numPages} 页 `;canvas.setAttribute('aria-label',`PDF 校样第 ${number} 页`);
            return true;
          }catch(error){if(token===generation)result.textContent='PDF 显示失败：'+error.message;return false;}
          finally{previous.disabled=pageNumber<=1;next.disabled=pageNumber>=pdf.numPages;}
        }
        if(await showPage(1))status('PDF 校样已生成；下载与预览字节一致');
      }catch(error){if(token===generation){result.textContent=error.message;status(error.message,true);}}finally{generate.disabled=false;font.disabled=false;}
    });
    generate.id='generateProof';dialog.append(generate);close();dialog.showModal();
  });
  exportButton.id='exportPdf';exportButton.className='primary';actions.append(exportButton);
}
