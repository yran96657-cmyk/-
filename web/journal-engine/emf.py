"""Bounded EMF -> vector PDF + browser preview, retaining the original bytes.

LibreOffice runs with a private profile and macro security set to very high.
The vector PDF is checked against EMF Unicode text before it can be published.
"""
import base64
from collections import Counter
import hashlib
from io import BytesIO
import os
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import unicodedata


def digest(data): return hashlib.sha256(data).hexdigest()


def read_emf(data):
    if not 88 <= len(data) <= 5*1024*1024: raise ValueError('EMF 文件大小超限或文件头不完整')
    if struct.unpack_from('<I',data)[0]!=1 or data[40:44]!=b' EMF': raise ValueError('无效的 EMF 文件头')
    if struct.unpack_from('<I',data,48)[0]!=len(data): raise ValueError('EMF 文件长度不一致')
    offset=0; count=0; text=[]; normalized=bytearray(data); changes=[]; fonts=set();plus=[];dual=False
    while offset<len(data):
        if offset+8>len(data): raise ValueError('EMF 记录截断')
        tag,size=struct.unpack_from('<II',data,offset);count+=1
        if size<8 or size%4 or offset+size>len(data) or count>100000: raise ValueError('EMF 记录边界无效')
        rec=data[offset:offset+size]
        if tag==70 and rec[12:16]==b'EMF+':
            plus.append((offset,size))
            if len(rec)>=28 and struct.unpack_from('<H',rec,16)[0]==0x4001:
                dual=bool(struct.unpack_from('<H',rec,18)[0]&1)
        if tag==82:
            if size<104: raise ValueError('EMF 字体记录截断')
            fonts.add(rec[40:104].decode('utf-16le').split('\0')[0])
        if tag==84:
            if size<76: raise ValueError('EMF 文字记录截断')
            n,start,flags=struct.unpack_from('<III',rec,44)
            if n>100000 or start<76 or start+2*n>size or flags&16: raise ValueError('EMF 字形索引或文字边界未支持')
            value=rec[start:start+2*n].decode('utf-16le')
            # Some office charts assign fullwidth parentheses to a Latin font
            # without these glyphs. Only compatibility punctuation is normalized;
            # coordinates/advances and the authoritative EMF remain unchanged.
            for i,c in enumerate(value):
                if c in '（）':
                    replacement='(' if c=='（' else ')'
                    at=offset+start+len(value[:i].encode('utf-16le'))
                    normalized[at:at+2]=replacement.encode('utf-16le')
                    changes.append({'offset':at,'from':c,'to':replacement})
            text.append(value.replace('（','(').replace('）',')'))
        elif tag in (83,96,97,108): raise ValueError('EMF 的此类文字记录尚未支持核验')
        offset+=size
    if tag!=14 or count!=struct.unpack_from('<I',data,52)[0]: raise ValueError('EMF 记录数或结束标记不一致')
    if changes and plus:
        # EMF+ Dual contains a complete standard-EMF playback stream. An EMF+
        # embedded image would bypass normalized text. Never discard a sole
        # EMF+ representation; the original bytes are always retained.
        if not dual:raise ValueError('含需修复字形的 EMF+ 文件没有完整 EMF 兼容流')
        chunks=[];start=0
        for at,size in plus:chunks.append(normalized[start:at]);start=at+size
        chunks.append(normalized[start:]);normalized=bytearray(b''.join(chunks))
        struct.pack_into('<II',normalized,48,len(normalized),count-len(plus))
    return bytes(normalized), ''.join(text), changes, sorted(fonts)


def validate_vector_pdf(data):
    from pypdf import PdfReader
    from pypdf.generic import ArrayObject,NullObject,NumberObject,FloatObject
    import math
    if len(data)>5*1024*1024: raise ValueError('矢量 PDF 超过 5 MB')
    pdf=PdfReader(BytesIO(data),strict=True)
    if pdf.is_encrypted or len(pdf.pages)!=1: raise ValueError('矢量资产必须为单页未加密 PDF')
    root=pdf.trailer['/Root'];page=pdf.pages[0]
    forbidden=[k for k in ('/AA','/Names','/AcroForm') if k in root]+[k for k in ('/Annots','/AA') if k in page]
    if forbidden:raise ValueError('矢量 PDF 不得含动作、附件、注释或表单：'+','.join(forbidden))
    # LibreOffice 24 emits an initial page-view destination on Linux. A PDF
    # destination array is not an executable action dictionary; accept only
    # this page and a standard view with numeric/null operands. PdfWriter's
    # page-only copy below does not carry the source catalog into the asset.
    if '/OpenAction' in root:
        view=root['/OpenAction'];valid=False
        if isinstance(view,ArrayObject) and len(view)>=2:
            target=view[0];ref=page.indirect_reference
            local=target==ref or isinstance(target,NumberObject) and target==0
            count={'/XYZ':3,'/Fit':0,'/FitH':1,'/FitV':1,'/FitR':4,'/FitB':0,'/FitBH':1,'/FitBV':1}.get(str(view[1]))
            valid=local and count is not None and len(view)==count+2 and all(isinstance(v,NullObject) or isinstance(v,(NumberObject,FloatObject)) and math.isfinite(float(v)) for v in view[2:])
        if not valid:raise ValueError('矢量 PDF 含非本页静态视图的 OpenAction')
    if not 0<float(page.mediabox.width)<=2000 or not 0<float(page.mediabox.height)<=2000: raise ValueError('矢量 PDF 尺寸无效')
    for font in page.get('/Resources',{}).get('/Font',{}).values():
        f=font.get_object();desc=f.get('/FontDescriptor')
        if not desc and f.get('/DescendantFonts'):desc=f['/DescendantFonts'][0].get_object().get('/FontDescriptor')
        if not desc or not any(k in desc.get_object() for k in ('/FontFile','/FontFile2','/FontFile3')): raise ValueError('矢量 PDF 字体未嵌入')
    return pdf


def validate_vector_source(source,pdf,original):
    """Recheck the ledger on export; JSON round trips are not trusted evidence."""
    from pdfminer.high_level import extract_text
    normalized,text,changes,fonts=read_emf(original)
    if source.get('renderedEmfSha256')!=digest(normalized) or source.get('text')!=text or source.get('normalizations')!=changes or source.get('fonts')!=fonts:
        raise ValueError('EMF 来源核验记录与原始文件不一致')
    validate_vector_pdf(pdf)
    def chars(s):return Counter(c for c in unicodedata.normalize('NFKC',s) if not c.isspace())
    if chars(text)!=chars(extract_text(BytesIO(pdf))):raise ValueError('矢量 PDF 与原始 EMF 的文字不一致')


def convert_emfs(assets):
    """Batch one invocation per import; dict keys are archive-relative asset names."""
    if not assets:return {}
    executable=os.environ.get('SHUYE_SOFFICE') or shutil.which('soffice')
    if not executable: raise ValueError('EMF 导入需要 LibreOffice Draw（soffice）')
    import pypdfium2 as pdfium
    from pypdf import PdfWriter
    from pypdf.generic import RectangleObject
    from PIL import Image, ImageChops
    from pdfminer.high_level import extract_text
    if len(assets)>100 or sum(map(len,assets.values()))>30*1024*1024:raise ValueError('EMF 批量转换超出限制')
    with tempfile.TemporaryDirectory(prefix='shuye-emf-') as tmp:
        folder=Path(tmp);profile=folder/'profile';(profile/'user').mkdir(parents=True)
        (profile/'user/registrymodifications.xcu').write_text('<oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item></oor:items>')
        prepared={}
        for index,(key,raw) in enumerate(assets.items()):
            normalized,text,changes,fonts=read_emf(raw);name='figure-'+str(index)
            (folder/(name+'.emf')).write_bytes(normalized);prepared[key]=(name,text,changes,fonts)
        command=[executable,'-env:UserInstallation='+profile.as_uri(),'--headless','--convert-to','pdf:draw_pdf_Export','--outdir',tmp]+[str(folder/(v[0]+'.emf')) for v in prepared.values()]
        result=subprocess.run(command,cwd=tmp,capture_output=True,timeout=120)
        if result.returncode:raise ValueError('LibreOffice EMF 转换失败')
        output={}
        for key,(name,expected,changes,fonts) in prepared.items():
            path=folder/(name+'.pdf')
            if not path.exists():raise ValueError('LibreOffice 没有生成矢量 PDF：'+key)
            raw_pdf=path.read_bytes();pdf=validate_vector_pdf(raw_pdf)
            extracted=extract_text(BytesIO(raw_pdf))
            def chars(s):return Counter(c for c in unicodedata.normalize('NFKC',s) if not c.isspace())
            if chars(expected)!=chars(extracted):raise ValueError('EMF 转换前后文字不一致：'+key)
            # Find every painted pixel; trim only the generated blank A4 margin.
            # Rasterization measures bounds and makes a preview, never the PDF.
            with pdfium.PdfDocument(raw_pdf) as rendered:
                page=rendered[0];im=page.render(scale=3).to_pil().convert('RGB')
                bbox=ImageChops.difference(im,Image.new('RGB',im.size,'white')).getbbox()
                if bbox is None:raise ValueError('EMF 转换结果为空白：'+key)
                l,t,r,b=bbox;l=max(0,l-6);t=max(0,t-6);r=min(im.width,r+6);b=min(im.height,b+6)
                height=float(pdf.pages[0].mediabox.height)
                rect=RectangleObject([l/3,height-b/3,r/3,height-t/3])
                pdf.pages[0].mediabox=rect;pdf.pages[0].cropbox=rect
                preview=BytesIO();im.crop((l,t,r,b)).save(preview,format='PNG')
            writer=PdfWriter();writer.add_page(pdf.pages[0]);buf=BytesIO();writer.write(buf);vector=buf.getvalue()
            validate_vector_pdf(vector)
            source={'format':'emf','data':base64.b64encode(assets[key]).decode(),'sha256':digest(assets[key]),
                    'pdf':base64.b64encode(vector).decode(),'pdfSha256':digest(vector),'previewSha256':digest(preview.getvalue()),
                    'sourceAsset':key,'text':expected,'normalizations':changes,'fonts':fonts,
                    'renderedEmfSha256':digest(read_emf(assets[key])[0]),
                    'converter':'LibreOffice Draw / vector PDF; Unicode text inventory checked; compatibility punctuation uses EMF Dual playback'}
            output[key]={'src':'data:image/png;base64,'+base64.b64encode(preview.getvalue()).decode(),'vectorSource':source}
        return output
