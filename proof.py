"""Inspect the exact delivered PDF, without driving an editor or a browser.

Text boxes are PDF font metrics in points, NOT ink bounds or semantic block IDs.
An incomplete check never becomes a production approval.
"""
from io import BytesIO
import hashlib
import json
from journal import final_positions,relation_report


def text_geometry(pdf_bytes, max_characters=2_000_000):
    try:
        from pdfminer.high_level import extract_pages
        from pdfminer.layout import LTChar, LTTextLine, LAParams
    except ImportError:
        return {'status':'NOT_CHECKED','reason':'Install pdfminer.six for text geometry.', 'pages':[], 'outside':[]}
    pages, outside = [], []
    characters = 0
    def walk(node):
        if isinstance(node, LTTextLine):
            yield node
        elif hasattr(node, '__iter__'):
            for child in node:
                yield from walk(child)
    try:
        for page_number, page in enumerate(extract_pages(BytesIO(pdf_bytes),laparams=LAParams(all_texts=True)), 1):
            page_data={'page':page_number,'widthPt':round(page.width,3),'heightPt':round(page.height,3),'lines':[]}
            pages.append(page_data)
            for line in walk(page):
                chars=[c for c in line if isinstance(c, LTChar) and c.get_text().strip()]
                characters+=len(chars)
                if characters>max_characters:
                    return {'status':'INCOMPLETE','reason':'Text geometry character limit exceeded.','pages':pages,'outside':outside}
                if not chars: continue
                bounds=[min(c.x0 for c in chars), min(c.y0 for c in chars), max(c.x1 for c in chars), max(c.y1 for c in chars)]
                # Convert PDF bottom-left origin to top-left for an AI client.
                box=[bounds[0],page.height-bounds[3],bounds[2],page.height-bounds[1]]
                item={'index':len(page_data['lines']),'text':line.get_text().rstrip('\n'),'bboxPt':[round(v,3) for v in box],
                      'fonts':sorted(set(c.fontname for c in chars)), 'fontSizesPt':sorted(set(round(c.size,2) for c in chars))}
                page_data['lines'].append(item)
                if box[0]<-.75 or box[1]<-.75 or box[2]>page.width+.75 or box[3]>page.height+.75:
                    outside.append({'code':'TEXT_OUTSIDE_PAGE','severity':'error','page':page_number,**item})
        return {'status':'COMPLETE','units':'pt','origin':'top-left','scope':'text font-metric boxes; no ink/overlap/semantic-anchor verification',
                'characters':characters,'pages':pages,'outside':outside}
    except Exception as error:
        # Malformed/unsupported PDFs remain inspectable, but never receive PASS.
        return {'status':'INCOMPLETE','reason':str(error)[:1000],'pages':pages,'outside':outside}


def inspect_output(output, document=None, compilation=None):
    """Attach evidence to the final bytes (after page selection/imposition)."""
    report=output['report']; document=document or {}; compilation=compilation or {}
    report['pdfSha256']=hashlib.sha256(output['pdf']).hexdigest()
    report['geometry']=text_geometry(output['pdf'])
    report['layoutWarnings']=compilation.get('warnings',[])
    report['compileMessages']=compilation.get('compileMessages',[])
    report['discardedLayoutTrials']=compilation.get('discardedLayoutTrials',[])
    report['renderer']={k:compilation[k] for k in ('engine','engineVersion','fontSet') if k in compilation}
    if document:
        canonical=json.dumps(document,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode('utf-8')
        report['renderedDocumentSha256']=hashlib.sha256(canonical).hexdigest()
    diagnostics=[dict(d,sourceSha256=r['sourceSha256']) for r in document.get('importReports',[]) for d in r['diagnostics']]
    diagnostics.extend(report['geometry']['outside'])
    diagnostics.extend(report.get('semanticLayout',{}).get('diagnostics',[]))
    for b in document.get('blocks',[]):
        for m in ([b] if b.get('type')=='equation' else b.get('inlineMath',[])):
            if 'sourceOmml' in m and hashlib.sha256(m['sourceOmml'].encode('utf-8')).hexdigest()!=m.get('sourceSha256'):
                diagnostics.append({'code':'OMML_SOURCE_HASH_MISMATCH','severity':'error','message':'原始公式来源摘要不一致','blockId':b.get('id'),'formulaId':m.get('id')})
    if document.get('journal'):
        required=['title-zh','authors-zh','affiliation-zh','abstract-zh','keywords-zh','title-en','authors-en','affiliation-en','abstract-en','keywords-en']
        diagnostics.extend({'code':'JOURNAL_FIELD_MISSING','severity':'error','message':'首面缺少字段：'+role} for role in required if not any(b.get('role')==role and str(b.get('text','')).strip() for b in document.get('blocks',[])))
    for warning in report['layoutWarnings']:
        if any(s in warning for s in ('缺字','字体形状替代','超出版心','超过一页','高于版心','缺少脚注')):
            diagnostics.append({'code':'TEX_LAYOUT_ERROR','severity':'error','message':warning})
    for font in report.get('fonts',[]):
        if not font['embedded']: diagnostics.append({'code':'FONT_NOT_EMBEDDED','severity':'error','message':font['name']})
    for image in report.get('images',[]):
        if image['dpiX'] is None or image['dpiY'] is None or min(image['dpiX'],image['dpiY'])<report.get('minDpi',150):
            diagnostics.append({'code':'IMAGE_DPI_LOW_OR_UNKNOWN','severity':'error','message':'图像有效 DPI 不足或无法测量','page':image['page']})
    report['quality']={'status':'BLOCKED' if any(d['severity']=='error' for d in diagnostics) else 'INCOMPLETE',
                       'productionReady':False,'diagnostics':diagnostics,
                       'notChecked':['稿件逐项内容及公式语义验收','图形墨迹边界、遮挡与正文首次引文对应关系','标题孤行、双栏/续表视觉验收',
                                     '字体使用许可与完整环境锁定','PDF/X、输出色彩配置、叠印、透明度、总墨量','指定印厂接收与编辑签字']}
    if report['geometry']['status']!='COMPLETE':report['quality']['notChecked'].append('完整 PDF 文字几何检查')
    return output


def render_proof(document, options=None, evidence_dir=None):
    from publishing import render_pdf
    from print_production import process_pdf
    compilation=render_pdf(document,evidence_dir=evidence_dir)
    output=process_pdf(compilation['pdf'],{'minDpi':300,**(options or {})})
    objects=final_positions(compilation.get('objectPositions',{}),compilation['pdf'],output['pdf'],output['report'])
    output['report']['semanticLayout']=relation_report(document,objects,compilation.get('objectPositions',{}))
    return inspect_output(output,document,compilation)
