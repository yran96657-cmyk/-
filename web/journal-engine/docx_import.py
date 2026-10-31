"""Bounded DOCX import. Independent MIT implementation, no Word automation."""
from io import BytesIO
from zipfile import ZipFile
import base64
import hashlib
import posixpath
import re
import uuid
import xml.etree.ElementTree as ET
from docx_numbering import Numbering,check_fields,format_number,val
from docx_evidence import SourceEvidence, O, R, legacy_math

NS = {'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main','m':'http://schemas.openxmlformats.org/officeDocument/2006/math','a':'http://schemas.openxmlformats.org/drawingml/2006/main','r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
W, M = '{'+NS['w']+'}', '{'+NS['m']+'}'
def local(e): return e.tag.rsplit('}',1)[-1]
def uid(): return str(uuid.uuid4())
def xml(data):
    if b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper(): raise ValueError('不支持 XML 实体声明。')
    return ET.fromstring(data)
def utf16(s): return len(s.encode('utf-16-le'))//2

def import_docx(data,revision_policy='require-clean'):
    if len(data)>20*1024*1024: raise ValueError('DOCX 不得超过 20 MB。')
    if data.startswith(bytes.fromhex('d0cf11e0a1b11ae1')):
        from word_compat import legacy_docx
        from legacy_text import repair_converted_docx
        converted,repairs=repair_converted_docx(data,legacy_docx(data))
        result=import_docx(converted,revision_policy)
        report=result['importReports'][0]
        converted_hash=report['sourceSha256'];report['sourceSha256']=hashlib.sha256(data).hexdigest();report['sourceBytes']=len(data)
        report['counts']['convertedLegacyDoc']=1
        report['counts']['recoveredCharacters']=sum(r['characters'] for r in repairs)
        if repairs:
            report['diagnostics'].append({'code':'LEGACY_TEXT_RECOVERED','severity':'warning','message':'独立核对 DOC 正文及表格文本，恢复转换遗漏的 '+str(len(repairs))+' 处字符；请核对校样。原稿未修改。'})
            for repair in repairs:
                report['diagnostics'].append({'code':'LEGACY_TEXT_RECOVERY_EVIDENCE','severity':'info','sourcePart':'WordDocument','sourcePath':'cp:'+str(repair['sourceCp']),'message':'恢复原稿字符：'+repair['text']})
        report['diagnostics'].append({'code':'LEGACY_DOC_CONVERTED','severity':'warning','message':'DOC 经隔离 LibreOffice 转为 DOCX；转换中间件 SHA-256：'+converted_hash+'。原稿摘要保持不变。'})
        return result
    warnings = ['Word 导入保留可支持的内容结构；原分页、字体替代、浮动定位和复杂表格需核对。']
    with ZipFile(BytesIO(data)) as z:
        if len(z.infolist())>5000 or sum(i.file_size for i in z.infolist())>80*1024*1024: raise ValueError('Word 解压体积或文件数量过大。')
        root=xml(z.read('word/document.xml')); body=root.find('w:body',NS)
        if body is None: raise ValueError('Word 文档没有正文。')
        # OOXML alternatives represent the same content, never two copies.
        from word_compat import accept_revisions,compose_groups,normalize_fence_extensions,transform_pictures,vector_png
        revisions=accept_revisions(root,revision_policy)
        alternates=0
        mc='{http://schemas.openxmlformats.org/markup-compatibility/2006}'
        def select_alternatives(parent):
            nonlocal alternates
            for child in list(parent):
                if child.tag==mc+'AlternateContent':
                    alternates+=1
                    choices=child.findall(mc+'Choice');selected=next((c for c in choices if set(c.get('Requires','').split())<= {'wps','wpg','w14','wp14','a14'}),None)
                    if selected is None:selected=child.find(mc+'Fallback')
                    if selected is None:raise ValueError('Word 兼容结构没有受支持的分支。')
                    index=list(parent).index(child);parent.remove(child)
                    for part in list(selected):parent.insert(index,part);index+=1
                else:select_alternatives(child)
            # A selected branch may itself contain an alternative.
            for child in list(parent):
                if child.tag!=mc+'AlternateContent':
                    if any(e.tag==mc+'AlternateContent' for e in child.iter()):select_alternatives(child)
        select_alternatives(root)
        rels={}
        if 'word/_rels/document.xml.rels' in z.namelist():
            for r in xml(z.read('word/_rels/document.xml.rels')):
                if r.get('TargetMode')!='External': rels[r.get('Id')]=posixpath.normpath('word/'+r.get('Target',''))
        fence_extensions=normalize_fence_extensions(root)
        # Preserve grouped source images as separate assets; never resample them.
        assets,groups,group_pictures=compose_groups(root,z.read,rels,preserve_pictures=True)
        transformed,picture_audit=transform_pictures(root,z.read,rels);assets.update(transformed)
        def read_asset(path):return assets[path] if path in assets else z.read(path)
        evidence=SourceEvidence(root,z,rels)
        legacy_counts=evidence.ole_objects(root)
        from emf import convert_emfs
        emf_paths={rels.get(e.get(R+'embed'),'') for e in root.iter() if local(e)=='blip'}
        emf_paths={p for p in emf_paths if p.lower().endswith('.emf') and p in z.namelist()}
        vector_assets={};vector_error=None
        try:vector_assets=convert_emfs({p:z.read(p) for p in sorted(emf_paths)})
        except (ValueError,ImportError,OSError,TimeoutError) as error:vector_error=str(error)
        styles=xml(z.read('word/styles.xml')) if 'word/styles.xml' in z.namelist() else None
        numbering=Numbering(xml(z.read('word/numbering.xml')) if 'word/numbering.xml' in z.namelist() else None,styles,warnings)
        character_styles={s.get(W+'styleId'):s for s in (styles if styles is not None else []) if s.get(W+'type')=='character'}
        def vertical_alignment(props):
            seen=set()
            while props is not None:
                va=props.find(W+'vertAlign')
                if va is not None:return va.get(W+'val') # Explicit baseline cancels inheritance.
                name=val(props,'rStyle','') if not seen else val(parent,'basedOn','')
                if not name:return None
                if name in seen:warnings.append('字符样式继承存在循环，须核对上下标。');return None
                seen.add(name);parent=character_styles.get(name)
                if parent is None:return None
                props=parent.find(W+'rPr')
                # A style without rPr may still inherit another character style.
                if props is None:props=ET.Element(W+'rPr')
        settings=xml(z.read('word/settings.xml')) if 'word/settings.xml' in z.namelist() else None
        notes=[];custom_markers={};group_tables=0
        for run in root.iter(W+'r'):
            children=list(run)
            for index,ref in enumerate(children):
                if ref.tag not in (W+'footnoteReference',W+'endnoteReference') or ref.get(W+'customMarkFollows') not in ('1','true','on'):continue
                following=children[index+1:index+2]
                key=('end-' if local(ref)=='endnoteReference' else '')+ref.get(W+'id','')
                if len(following)!=1 or following[0].tag!=W+'t' or not following[0].text:
                    warnings.append('自定义注释标记缺少紧随的文字，须核对原稿。');continue
                value=following[0].text[0]
                if key in custom_markers and custom_markers[key]!=value:warnings.append('同一注释有不同的自定义标记，须核对原稿。');continue
                custom_markers[key]=value;following[0].text=following[0].text[1:]
        for e in root.iter():
            if e.tag in {W+n for n in ('ins','del','moveFrom','moveTo')}:
                warnings.append('修订或域 '+local(e)+' 尚未执行接受/拒绝/更新策略，请先在原稿中确认。')
        field_stats={};field_count=check_fields(root,warnings,field_stats)
        if field_count:
            warnings.append('已冻结 Word 域的现有可见结果（'+str(field_count)+' 个）；未执行外部查询或重算编号，须核对引用与题注。')
        for part,kind in [('word/footnotes.xml','footnote'),('word/endnotes.xml','endnote')]:
            if part in z.namelist():
                props=settings.find(W+kind+'Pr') if settings is not None else None
                sections=[p for p in root.iter(W+kind+'Pr')]
                if sections:
                    if len({ET.tostring(p) for p in sections})>1:warnings.append('分节注释编号设置不一致，须核对原稿。')
                    props=sections[-1]
                fmt=val(props,'numFmt','decimal');start=int(val(props,'numStart','1'))
                if val(props,'numRestart','continuous')!='continuous':warnings.append('注释按页/节重启编号尚未还原，须核对原稿。')
                refs=list(dict.fromkeys(e.get(W+'id') for e in root.iter(W+kind+'Reference')))
                note_root=xml(z.read(part));revisions+=accept_revisions(note_root,revision_policy)
                for n in note_root:
                    ident=n.get(W+'id','')
                    if n.get(W+'type') in ('separator','continuationSeparator') or ident.startswith('-'): continue
                    if any(local(c) in ('oMath','drawing','pict','object','tbl') for c in n.iter()): warnings.append('注释 '+ident+' 含公式、图表或对象，当前只提取文字，须核对原稿。')
                    note={'id':('end-' if kind=='endnote' else '')+ident,'text':'\n'.join(''.join(t.text or '' for t in p.iter(W+'t')) for p in n.findall('w:p',NS))}
                    if ident in refs:
                        automatic=[r for r in refs if ('end-' if kind=='endnote' else '')+r not in custom_markers]
                        try:note['marker']=custom_markers.get(note['id']) or format_number(start+automatic.index(ident),fmt)
                        except ValueError as error:warnings.append('注释 '+ident+' '+str(error)+'，须核对原稿。')
                    notes.append(note)
                    if note['id'] in custom_markers:note['marker']=custom_markers[note['id']]
        from omml import to_tex
        def math(e): return to_tex(e,warnings)
        def math_source(e):
            source=ET.tostring(e,encoding='unicode')
            return {'sourceOmml':source,'sourceSha256':hashlib.sha256(source.encode()).hexdigest()}
        def paragraph(p, in_table=False):
            text=numbering.prefix(p); marks=[]; extras=[]; inline_math=[]
            def visit(e):
                nonlocal text,group_tables
                k=local(e)
                if k=='wgp':
                    pictures=[c for c in e if local(c)=='pic'];positions=[]
                    if not 2<=len(pictures)<=32 or any(local(c) not in ('pic','cNvPr','cNvGrpSpPr','grpSpPr') for c in e):
                        warnings.append('组合图不是受支持的单行/单列布局，须核对原稿。');return
                    for pic in pictures:
                        transform=pic.find('.//a:xfrm',NS);blips=pic.findall('.//a:blip',NS)
                        offset=transform.find('a:off',NS) if transform is not None else None
                        if offset is None or len(blips)!=1 or any(k in transform.attrib for k in ('rot','flipH','flipV')) or any(any(float(v)!=0 for v in c.attrib.values()) for c in pic.findall('.//a:srcRect',NS)):
                            warnings.append('组合图裁切/旋转或位置不受支持，须核对原稿。');return
                        positions.append((int(offset.get('x','0')),int(offset.get('y','0')),blips[0]))
                    horizontal=max(p[1] for p in positions)-min(p[1] for p in positions)<12700
                    vertical=max(p[0] for p in positions)-min(p[0] for p in positions)<12700
                    if horizontal==vertical:warnings.append('组合图不能确定横排或纵排，须核对原稿。');return
                    positions.sort(key=lambda p:p[0] if horizontal else p[1]);start=len(extras);images=[]
                    for _,_,blip in positions:
                        before=len(extras);visit(blip)
                        if len(extras)==before+1:images.append(extras[-1])
                    if len(images)!=len(pictures):return
                    for im in images:im['width']=100
                    table={'id':uid(),'type':'table','text':'','rows':[['']*len(images)] if horizontal else [[''] for _ in images],'headerRows':0,'borderStyle':'none','captionPosition':'below','placement':'full-width','cellImages':[{'row':0 if horizontal else i,'col':i if horizontal else 0,'imageId':im['id']} for i,im in enumerate(images)]}
                    extras.insert(start,table);group_tables+=1;return
                if e.tag==W+'object':
                    objects=list(e.iter(O+'OLEObject'))
                    if len(objects)==1 and evidence.is_legacy_math(objects[0]):
                        try:
                            from docx_legacy import equation
                            formula=equation(e,z,rels);ident=uid();inline_math.append({'id':ident,**formula});text+='[[math:'+ident+']]'
                            legacy_counts['importedLegacyMath']+=1
                            if formula['legacySource']['empty']:evidence.add('DOCX_EMPTY_SOURCE_MATH','原始公式对象为空，已保留空对象及来源，不猜测内容。',objects[0],formula['legacySource']['sourceAsset'],severity='info')
                        except (ValueError,ImportError,OSError) as error:
                            evidence.add('DOCX_LEGACY_MATH','旧式公式未导入：'+str(error),objects[0],rels.get(objects[0].get(R+'id')))
                    elif not objects:warnings.append('旧式对象缺少 OLE 内容，须核对原稿。')
                    return
                if e.tag in (M+'oMath',M+'oMathPara'):
                    # Keep the formula at its source position, including inside cells.
                    ident=uid();inline_math.append({'id':ident,'text':math(e),**math_source(e)});text+='[[math:'+ident+']]';return
                if e.tag==W+'r':
                    start=utf16(text); props=e.find('w:rPr',NS)
                    for c in e:
                        if c.tag!=W+'rPr': visit(c)
                    mark={'start':start,'end':utf16(text)}
                    if props is not None:
                        for key,tag in [('bold','b'),('italic','i'),('underline','u')]:
                            el=props.find('w:'+tag,NS)
                            if el is not None and el.get(W+'val') not in ('0','false','none'): mark[key]=True
                        va=vertical_alignment(props)
                        if va in ('superscript','subscript'): mark[va]=True
                        size=props.find('w:sz',NS)
                        if size is not None:
                            try: mark['fontSize']=max(5,min(72,float(size.get(W+'val'))/2))
                            except (TypeError,ValueError): pass
                        fonts=props.find('w:rFonts',NS)
                        if fonts is not None:
                            name=fonts.get(W+'eastAsia',fonts.get(W+'ascii','')).lower()
                            mark['fontFamily']='kai' if 'kai' in name or '楷' in name else 'sans' if any(x in name for x in ['hei','黑','arial']) else 'serif'
                    if len(mark)>2 and mark['end']>start: marks.append(mark)
                    return
                if e.tag==W+'t': text+=e.text or ''; return
                if e.tag==W+'sym':
                    # Adobe Symbol's multiplication slot (including the Word
                    # private-use encoding). Unknown mappings remain blocking.
                    if e.get(W+'font','').lower()=='symbol' and e.get(W+'char','').upper() in ('F0D7','00D7','D7'):text+='×'
                    else:warnings.append('Word 字体编码符号尚未转换：'+str(e.get(W+'font'))+'/'+str(e.get(W+'char')))
                    return
                if e.tag in (W+'tab',W+'br',W+'cr'): text+='\t' if k=='tab' else '\n'; return
                if e.tag in (W+'footnoteReference',W+'endnoteReference'):
                    text+='[^'+('end-' if k=='endnoteReference' else '')+e.get(W+'id','')+']'; return
                if k=='blip':
                    rid=e.get('{'+NS['r']+'}embed'); path=rels.get(rid,''); ext=path.rsplit('.',1)[-1].lower()
                    if ext=='emf':
                        if path in vector_assets:extras.append({'id':uid(),'type':'image','width':80,'text':'',**vector_assets[path]})
                        else:evidence.add('DOCX_IMAGE_UNSUPPORTED','EMF 未导入：'+path+'；'+(vector_error or '缺少内嵌图像'),e,path)
                        return
                    if (path in assets or path in z.namelist()) and ext in ('png','jpg','jpeg','webp','tif','tiff','wmf'):
                        image=read_asset(path)
                        if ext=='wmf':image=vector_png(image,ext);ext='png'
                        if ext in ('tif','tiff'):
                            try:
                                from PIL import Image
                                with Image.open(BytesIO(image)) as im:
                                    if im.width*im.height>125000000 or getattr(im,'n_frames',1)!=1: raise ValueError(str(im.width)+'×'+str(im.height)+' 像素、'+str(getattr(im,'n_frames',1))+' 帧；仅支持单帧且不超过 125 MP 的 TIFF')
                                    if im.mode not in ('1','L','LA','RGB','RGBA','P'): raise ValueError('TIFF 色彩/位深 '+im.mode+' 不能无损转换到 PNG')
                                    im.load();out=BytesIO();im.save(out,format='PNG');image=out.getvalue();ext='png'
                            except (ImportError,OSError,ValueError) as error:
                                evidence.add('DOCX_IMAGE_UNSUPPORTED','TIFF 未导入：'+path+'；'+str(error),e,path);return
                            except Image.DecompressionBombError:
                                evidence.add('DOCX_IMAGE_UNSUPPORTED','TIFF 像素数量超过安全限制，未导入：'+path,e,path);return
                        if len(image)<=5*1024*1024: extras.append({'id':uid(),'type':'image','src':'data:image/'+('jpeg' if ext=='jpg' else ext)+';base64,'+base64.b64encode(image).decode(),'width':80,'text':''})
                        else: evidence.add('DOCX_IMAGE_UNSUPPORTED','图片超过 5 MB，未导入：'+path,e,path)
                    else: evidence.add('DOCX_IMAGE_UNSUPPORTED','未支持或外链图片未导入：'+(path or '外链'),e,path)
                    return
                if k=='drawing' and not any(local(c)=='blip' for c in e.iter()): warnings.append('图片或绘图没有可读取的位图，未导入，请核对原稿。')
                if k in ('pict','object'): warnings.append('旧式绘图/OLE 对象无法转换，请核对原稿。')
                for c in e: visit(c)
            visit(p)
            blocks=[]
            if not in_table and len(inline_math)==1:
                remainder=text.replace('[[math:'+inline_math[0]['id']+']]','').strip()
                number_match=re.fullmatch(r'[（(]([0-9]+(?:[a-z])?)[）)]',remainder)
                percent_number=re.fullmatch(r'([%％])\s*[（(]([0-9]+(?:[a-z])?)[）)]',remainder) if text.lstrip().startswith('[[math:') else None
                if not remainder or number_match or percent_number or remainder in ('。','，','；','.',',',';'):
                    formula=inline_math[0]
                    return [{'id':uid(),'type':'equation','text':formula['text'],**{k:formula[k] for k in ('sourceOmml','sourceSha256','legacySource') if k in formula},'equationNumber':number_match[1] if number_match else percent_number[2] if percent_number else '', 'equationSuffix':percent_number[1] if percent_number else '' if number_match else remainder}]+extras
            if text.strip():
                style=p.find('w:pPr/w:pStyle',NS); name=style.get(W+'val','') if style is not None else ''
                match=re.search(r'(?:heading|标题)\s*([1-4])',name,re.I)
                b={'id':uid(),'type':'heading' if match else 'paragraph','text':text,'marks':marks}
                if inline_math: b['inlineMath']=inline_math
                if match: b['level']=int(match[1])
                align=p.find('w:pPr/w:jc',NS)
                if align is not None: b['align']={'both':'justify'}.get(align.get(W+'val'),align.get(W+'val'))
                if b.get('align') not in ('left','center','right','justify'): b.pop('align',None)
                blocks.append(b)
            if extras and text.strip(): warnings.append('段内图片已转为独立块，锚定位置需核对。')
            return blocks+extras
        blocks=[]
        def table_block(e):
            rows=[]; merges=[]; active={}; heads=0; in_header=True; extras=[]; inline_math=[]; cell_marks=[];cell_images=[]
            def number(parent,path,default=0):
                item=parent.find(path,NS)
                if item is None: return default
                try: value=int(item.get(W+'val',str(default)))
                except (TypeError,ValueError): raise ValueError('表格跨度或网格偏移不是整数。')
                if value<0 or value>50: raise ValueError('表格跨度或网格偏移超出 0–50 范围。')
                return value
            for row_index,row in enumerate(e.findall('w:tr',NS)):
                if row_index>=5000: raise ValueError('表格超过 5,000 行。')
                if in_header and row.find('w:trPr/w:tblHeader',NS) is not None: heads+=1
                else: in_header=False
                cells=['']*number(row,'w:trPr/w:gridBefore'); next_active={}
                for cell in row.findall('w:tc',NS):
                    span=number(cell,'w:tcPr/w:gridSpan',1)
                    if span<1: raise ValueError('表格列跨度必须大于零。')
                    col=len(cells)
                    if col+span>50: raise ValueError('表格超过 50 列。')
                    if cell.find('w:tbl',NS) is not None: warnings.append('嵌套表格已展平到所在单元格，文字保留，结构需重建。')
                    items=[b for p in cell.iter(W+'p') for b in paragraph(p,in_table=True)]
                    inline_math.extend(m for b in items for m in b.get('inlineMath',[]))
                    offset=0; marks=[]
                    for item in items:
                        if item['type']=='image':continue
                        marks.extend({**mark,'start':mark['start']+offset,'end':mark['end']+offset} for mark in item.get('marks',[]))
                        offset+=utf16(item.get('text',''))+1
                    if marks:cell_marks.append({'row':row_index,'col':col,'marks':marks})
                    cells.extend(['\n'.join(b.get('text','') for b in items if b['type']!='image')]+['']*(span-1))
                    text_seen=False
                    for item in items:
                        if item['type']=='image':
                            if text_seen:warnings.append('单元格图片与文字交错，当前只支持图片在文字之前；须按原稿重建。')
                            item['width']=100;extras.append(item)
                            cell_images.append({'row':row_index,'col':col,'imageId':item['id']})
                        elif item.get('text','').strip():text_seen=True
                    vm=cell.find('w:tcPr/w:vMerge',NS)
                    value=vm.get(W+'val','continue') if vm is not None else None
                    key=(col,span)
                    if value=='continue' and key in active:
                        merge=active[key]; merge['rowspan']+=1; next_active[key]=merge
                    else:
                        if value=='continue': warnings.append('纵向合并续格未找到同宽起点，已保留为普通单元格。')
                        elif value not in (None,'restart'): warnings.append('未知纵向合并参数，已保留为普通单元格。')
                        if span>1 or value=='restart':
                            merge={'row':row_index,'col':col,'rowspan':1,'colspan':span};merges.append(merge)
                            if value=='restart': next_active[key]=merge
                    if cell.find('w:tcPr/w:hMerge',NS) is not None: warnings.append('旧式 hMerge 合并暂未还原，各格文字已保留；请手动合并。')
                cells.extend(['']*number(row,'w:trPr/w:gridAfter'))
                if len(cells)>50: raise ValueError('表格超过 50 列。')
                rows.append(cells);active=next_active
            cols=max((len(row) for row in rows),default=0)
            if not cols: warnings.append('空表格已忽略。');return None,extras
            if len(rows)*cols>100000: raise ValueError('表格超过 100,000 个单元格。')
            rows=[row+['']*(cols-len(row)) for row in rows]
            result={'id':uid(),'type':'table','rows':rows,'headerRows':heads,'borderStyle':'grid','text':'','merges':[m for m in merges if m['rowspan']>1 or m['colspan']>1]}
            if cell_images:result['cellImages']=cell_images
            borders=e.find('w:tblPr/w:tblBorders',NS)
            if borders is not None and all(borders.find(W+side) is not None and borders.find(W+side).get(W+'val') in ('none','nil') for side in ('top','left','bottom','right','insideH','insideV')) and not any(x.get(W+'val') not in ('none','nil') for x in e.findall('.//w:tcBorders/*',NS)):
                result['borderStyle']='none'
            if inline_math: result['inlineMath']=inline_math
            if cell_marks:result['cellMarks']=cell_marks
            widths=[]
            for column in e.findall('w:tblGrid/w:gridCol',NS):
                try: width=float(column.get(W+'w','0'))
                except ValueError: width=0
                widths.append(width)
            if len(widths)==cols and all(0<w<10000000 for w in widths): result['columnWidths']=[w/sum(widths)*100 for w in widths]
            elif widths: warnings.append('表格网格列宽不完整，使用等宽列。')
            if any(any(text for text in rows[r][m['col']:m['col']+m['colspan']]) for m in result['merges'] for r in range(m['row']+1,m['row']+m['rowspan'])):
                warnings.append('纵向合并续格含文字：已保留原格，合并显示全部文字，拆分可恢复位置。')
            return result,extras
        def walk(container):
            for e in container:
                if e.tag==W+'p': blocks.extend(paragraph(e))
                elif e.tag==W+'tbl':
                    table,extras=table_block(e)
                    if table: blocks.append(table)
                    blocks.extend(extras)
                elif e.tag in (W+'sdt',W+'sdtContent',W+'customXml',W+'ins'): walk(e)
                elif e.tag not in {W+n for n in ('sectPr','bookmarkStart','bookmarkEnd','proofErr','commentRangeStart','commentRangeEnd')}:
                    fallback=''.join(t.text or '' for t in e.iter(W+'t'))
                    warnings.append('未支持结构 '+local(e)+' 已提取可读文字，请核对。')
                    if fallback: blocks.append({'id':uid(),'type':'paragraph','text':fallback})
        walk(body)
        if any(n.startswith('word/header') or n.startswith('word/footer') for n in z.namelist()): warnings.append('原 Word 页眉页脚未导入；请在版式设置中重建。')
        if revisions and revision_policy!='accept':warnings.append('WORD_REVISIONS_REQUIRE_POLICY: 需显式选择 revisionPolicy=accept 或提交已确认的稿件。')
        warnings=list(dict.fromkeys(warnings))
        source_omml_math=sum(1 for e in root.iter(M+'oMath'))
        source_math=source_omml_math+legacy_counts['sourceLegacyMath']
        output_math=sum(1 if b['type']=='equation' else len(b.get('inlineMath',[])) for b in blocks)
        source_images=sum(1 for e in root.iter() if local(e)=='blip')
        output_images=sum(b['type']=='image' for b in blocks)
        if source_math!=output_math: warnings.append('公式数量不一致：原稿 '+str(source_math)+'，导入 '+str(output_math)+'。')
        if source_images!=output_images: warnings.append('图片数量不一致：原稿 '+str(source_images)+'，导入 '+str(output_images)+'。')
        diagnostics=[]
        for i,message in enumerate(warnings):
            severity='warning' if i==0 or message.startswith(('原 Word 页眉页脚','表格网格列宽','已冻结 Word 域')) else 'error'
            diagnostics.append({'code':'DOCX_REVIEW' if severity=='warning' else 'DOCX_CONTENT_REVIEW','severity':severity,'message':message})
        report={'kind':'docx','sourceSha256':hashlib.sha256(data).hexdigest(),'sourceBytes':len(data),'counts':{'sourceMath':source_math,'sourceDisplayMath':sum(1 for e in root.iter(M+'oMathPara')),'sourceTables':sum(1 for e in root.iter(W+'tbl')),'importedTables':sum(b['type']=='table' for b in blocks),'importedMath':output_math,'sourceImages':source_images,'importedImages':output_images,'sourceNumberedParagraphs':numbering.source_count,'importedNumberedParagraphs':numbering.imported_count},'diagnostics':diagnostics}
        report['counts'].update(field_stats)
        report['counts'].update(legacy_counts,sourceOmmlMath=source_omml_math)
        # A 0/0 image count does not mean a complete manuscript: some legacy
        # files contain captions but no embedded figures. Keep source evidence
        # as a warning; the live document audit resolves after assets are added.
        figure_numbers=set()
        for i,b in enumerate(blocks):
            if b['type'] not in ('paragraph','heading'): continue
            text=b.get('text','').strip()
            match=re.match(r'^图\s*(\d+)(.*)$',text)
            next_text=blocks[i+1].get('text','').strip() if i+1<len(blocks) else ''
            pair=re.match(r'^Fig(?:ure)?\.?\s*(\d+)\b',next_text,re.I)
            if re.match(r'^(?:图\s*\d+\s*(?:展示|显示|表明|说明|所示|可见|给出|描绘|呈现)|Fig(?:ure)?\.?\s*\d+\s+(?:shows?|depicts?|illustrates?|presents?|demonstrates?|is|was)\b)',text,re.I): continue
            if match and (re.match(r'^(?:\s|[.:：])',match[2]) or pair and pair[1]==match[1]): figure_numbers.add(match[1])
            english=re.match(r'^Fig(?:ure)?\.?\s*(\d+)(?:\s|[.:：])',text,re.I)
            if english: figure_numbers.add(english[1])
        report['counts']['figureCaptions']=len(figure_numbers)
        if figure_numbers and not output_images:
            message='发现 '+str(len(figure_numbers))+' 处图题，但未导入任何图体；请补入对应原图。'
            report['diagnostics'].append({'code':'DOCX_FIGURE_CONTENT_MISSING','severity':'warning','message':message})
            warnings.append(message)
        report['counts'].update(sourceEmfImages=sum(1 for e in root.iter() if local(e)=='blip' and rels.get(e.get(R+'embed'),'').lower().endswith('.emf')),importedEmfImages=sum('vectorSource' in b for b in blocks))
        report['counts']['importedImageGroups']=group_tables
        report['diagnostics'].extend(evidence.diagnostics)
        warnings.extend(d['message'] for d in evidence.diagnostics)
        report['counts'].update(sourceRevisions=revisions,acceptedRevisions=revisions if revision_policy=='accept' else 0,alternateBranchesSelected=alternates,normalizedFenceExtensions=fence_extensions,transformedPictures=len(picture_audit))
        for entry in picture_audit:report['diagnostics'].append({'code':'WORD_PICTURE_TRANSFORM','severity':'info','message':__import__('json').dumps(entry,separators=(',',':'))})
        if fence_extensions:report['diagnostics'].append({'code':'WORD_FENCE_EXTENSIONS','severity':'warning','message':'已归并 '+str(fence_extensions)+' 个手工公式括号延伸片/空文本框，请核对公式校样。'})
        if revisions and revision_policy=='accept':report['diagnostics'].append({'code':'WORD_REVISIONS_ACCEPTED','severity':'warning','message':'按明确策略接受全部修订，保留最终显示版本；已处理 '+str(revisions)+' 处。'})
        return {'blocks':blocks,'notes':notes,'warnings':warnings,'importReports':[report]}
