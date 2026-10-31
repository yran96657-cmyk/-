"""Inspect the exact delivered PDF, without driving an editor or a browser.

Text boxes are PDF font metrics in points, NOT ink bounds or semantic block IDs.
An incomplete check never becomes a production approval.
"""
from io import BytesIO
import hashlib
import json
import base64
from journal import final_positions,relation_report
from figure_assets import missing_figures


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
    report['compileDiagnostics']=compilation.get('compileDiagnostics',[])
    objects=report.get('semanticLayout',{}).get('objects',{})
    for item in report['compileDiagnostics']:
        for location in item.get('sourceLocations',[]):
            bounds=objects.get(location.get('objectId'),{})
            if bounds.get('start') and bounds.get('end'):
                location['pages']=[bounds['start']['page'],bounds['end']['page']]
        item['candidateLocations']=[{'objectId':ident,**objects[ident]} for ident in item.get('candidateObjectIds',[]) if ident in objects]
    report['discardedLayoutTrials']=compilation.get('discardedLayoutTrials',[])
    report['renderer']={k:compilation[k] for k in ('engine','engineVersion','fontSet') if k in compilation}
    if document:
        canonical=json.dumps(document,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode('utf-8')
        report['renderedDocumentSha256']=hashlib.sha256(canonical).hexdigest()
    diagnostics=[dict(d,sourceSha256=r['sourceSha256']) for r in document.get('importReports',[]) for d in r['diagnostics']]
    diagnostics[:0]=[{'code':'EDITORIAL_COMMENT_UNRESOLVED','severity':'warning','message':c['text'],'blockId':c.get('blockId'),'commentId':c['id']} for c in document.get('comments',[]) if not c.get('resolved')]
    if not missing_figures(document) and any(b.get('type')=='image' for b in document.get('blocks',[])):
        diagnostics=[dict(d,severity='info',message='原稿未嵌入图体；当前图题已关联图件，请核对图件来源与清晰度。') if d['code']=='DOCX_FIGURE_CONTENT_MISSING' else d for d in diagnostics]
    diagnostics.extend(report['geometry']['outside'])
    diagnostics.extend(report.get('semanticLayout',{}).get('diagnostics',[]))
    diagnostics.extend(report['compileDiagnostics'])
    legacy={'formulas':0,'characters':0,'structures':0,'emptySourceObjects':0,'editedFormulas':0,'verifiedSources':0}
    vectors=[]
    for b in document.get('blocks',[]):
        for m in ([b] if b.get('type')=='equation' else b.get('inlineMath',[])):
            if 'sourceOmml' in m and hashlib.sha256(m['sourceOmml'].encode('utf-8')).hexdigest()!=m.get('sourceSha256'):
                diagnostics.append({'code':'OMML_SOURCE_HASH_MISMATCH','severity':'error','message':'原始公式来源摘要不一致','blockId':b.get('id'),'formulaId':m.get('id')})
            if m.get('legacySource'):
                from mtef import convert_ole
                import re
                source=m['legacySource'];legacy['formulas']+=1
                try:
                    raw=base64.b64decode(source['data'],validate=True);converted=convert_ole(raw)
                    if hashlib.sha256(raw).hexdigest()!=source['sha256'] or any(source[k]!=converted[k] for k in ('mtefSha256','characters','structures','empty')) or source['originalTex']!=converted['text']:raise ValueError('MTEF 来源或转换记录不一致')
                    if source.get('preview') and hashlib.sha256(base64.b64decode(source['preview']['data'],validate=True)).hexdigest()!=source['preview']['sha256']:raise ValueError('MTEF 原预览摘要不一致')
                    legacy['verifiedSources']+=1;legacy['characters']+=converted['characters'];legacy['structures']+=converted['structures'];legacy['emptySourceObjects']+=int(converted['empty'])
                    original=converted['text'];current=m.get('text','')
                    number=re.search(r'(?:\\ )+\(([0-9]+)\)\s*$',original)
                    if current!=original and not (number and m.get('equationNumber')==number[1] and current==original[:number.start()]):legacy['editedFormulas']+=1
                except (ValueError,ImportError,OSError,KeyError) as error:
                    diagnostics.append({'code':'MTEF_SOURCE_INVALID','severity':'error','message':str(error),'blockId':b.get('id'),'formulaId':m.get('id')})
        if b.get('vectorSource'):
            s=b['vectorSource'];vectors.append({'blockId':b['id'],'sourceAsset':s['sourceAsset'],'sourceSha256':s['sha256'],'pdfSha256':s['pdfSha256'],'sourceTextCharacters':len(s['text']),'compatibilityGlyphChanges':len(s['normalizations']),'outputKind':'vector PDF'})
    report['legacyMathCoverage']=legacy;report['vectorAssets']=vectors
    if legacy['editedFormulas']:diagnostics.append({'code':'MTEF_EDITED','severity':'warning','message':str(legacy['editedFormulas'])+' 处公式在原生转换后有内容编辑，须核对原稿。'})
    if document.get('journal'):
        required=['title-zh','authors-zh','affiliation-zh','abstract-zh','keywords-zh','title-en','authors-en','affiliation-en','abstract-en','keywords-en']
        diagnostics.extend({'code':'JOURNAL_FIELD_MISSING','severity':'error','message':'首面缺少字段：'+role} for role in required if not any(b.get('role')==role and str(b.get('text','')).strip() for b in document.get('blocks',[])))
        metadata_names={'name':'中文刊名','nameEn':'英文刊名','volume':'卷号','issue':'期号','year':'出版年','date':'中文出版日期','dateEn':'英文出版日期'}
        diagnostics.extend({'code':'JOURNAL_METADATA_REVIEW','severity':'warning','field':key,'message':'请补全'+label} for key,label in metadata_names.items() if not str(document['journal'].get(key,'')).strip())
        import re
        diagnostics.extend(dict(d,message='图题未关联图件；请补充原图或显式设置 captionIds，不能把有图题无图的稿件作为完整校样。') for d in missing_figures(document))
        blocks=document.get('blocks',[])
        first_front=next((i for i,b in enumerate(blocks) if b.get('role') in required+['citation','classification']),0)
        diagnostics.extend({'code':'UNCLASSIFIED_PREFIX','severity':'warning','blockId':b['id'],'message':'首面前有未归类文字，请核对是否属于文章正文。'} for b in blocks[:first_front] if str(b.get('text','')).strip())
        for b in blocks:
            if b.get('role') in ('citation','classification') and re.search(r'(?:X\s*[-—(（:]|[（(]X|X{2,})',b.get('text',''),re.I):
                diagnostics.append({'code':'PUBLICATION_METADATA_PLACEHOLDER','severity':'warning','blockId':b['id'],'message':'卷期、页码或文章编号仍有占位符，请按本期信息核对。'})
            if b.get('role')=='classification' and re.search(r'文章编号\s*[:：]\s*$',b.get('text','')):
                diagnostics.append({'code':'JOURNAL_METADATA_REVIEW','severity':'warning','message':'原稿文章编号为空，需编辑补全；系统未编造编号。','blockId':b['id']})
    for warning in report['layoutWarnings']:
        if report['compileDiagnostics'] and any(s in warning for s in ('缺字','字体形状替代','超出版心')):
            continue
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
