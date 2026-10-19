"""Local PDF page selection, saddle-stitch imposition and preflight (MIT).
No PDF/X conversion, color conversion, or synthetic image bleed is claimed.
"""
from io import BytesIO
import math
import re
from pypdf import PdfReader, PdfWriter, Transformation
from pypdf.errors import PdfReadError
from pypdf.generic import ContentStream, DecodedStreamObject, NameObject, RectangleObject
MM=72/25.4

def _num(v,default,lo,hi):
    try: n=float(default if v is None else v)
    except (ValueError,TypeError): raise ValueError('印刷参数必须为数字。')
    if not math.isfinite(n) or not lo<=n<=hi: raise ValueError('印刷参数超出范围。')
    return n

def select_pages(spec,total):
    if not spec: return list(range(total))
    if not isinstance(spec,str) or len(spec)>10000: raise ValueError('页范围格式无效。')
    result=[]
    for token in spec.split(','):
        m=re.fullmatch(r'\s*(\d+)\s*(?:-\s*(\d+)\s*)?',token)
        if not m: raise ValueError('页范围格式示例：1-3,5。')
        a=int(m[1]); b=int(m[2] or a)
        if not 1<=a<=b<=total: raise ValueError('页范围超出原 PDF 页数。')
        for i in range(a-1,b):
            if i not in result: result.append(i)
    return result

def _resolve(x): return x.get_object() if hasattr(x,'get_object') else x

def preflight(reader,min_dpi=150):
    fonts={}; images=[]; pages=[]; warnings=[]
    def resources(res,seen):
        res=_resolve(res or {})
        for f in _resolve(res.get('/Font',{})).values():
            f=_resolve(f); name=str(f.get('/BaseFont','unknown')); descendants=_resolve(f.get('/DescendantFonts',[])); actual=_resolve(descendants[0]) if descendants else f
            descriptor=_resolve(actual.get('/FontDescriptor',{})); embedded=any(k in descriptor for k in ('/FontFile','/FontFile2','/FontFile3')) or str(f.get('/Subtype'))=='/Type3'
            fonts[name]={'name':name,'embedded':embedded and fonts.get(name,{}).get('embedded',True)}
        for ref in _resolve(res.get('/XObject',{})).values():
            obj=_resolve(ref); marker=id(obj)
            if marker not in seen and obj.get('/Subtype')=='/Form': seen.add(marker);resources(obj.get('/Resources'),seen)
    def mul(a,b):
        # New local transform a followed by existing transform b.
        return (a[0]*b[0]+a[1]*b[2],a[0]*b[1]+a[1]*b[3],a[2]*b[0]+a[3]*b[2],a[2]*b[1]+a[3]*b[3],a[4]*b[0]+a[5]*b[2]+b[4],a[4]*b[1]+a[5]*b[3]+b[5])
    def scan(stream,res,ctm,page,depth=0):
        if stream is None: return
        if depth>12: warnings.append('图像嵌套超过扫描深度，部分 DPI 未检查。');return
        res=_resolve(res or {}); stack=[]
        for operands,op in ContentStream(stream,reader).operations:
            if op==b'q': stack.append(ctm)
            elif op==b'Q':
                if stack: ctm=stack.pop()
            elif op==b'cm': ctm=mul(tuple(map(float,operands)),ctm)
            elif op==b'INLINE IMAGE': warnings.append('包含内联图像，当前预检未计算其 DPI。')
            elif op==b'Do':
                obj=_resolve(_resolve(res.get('/XObject',{})).get(operands[0]))
                if obj is None: continue
                if obj.get('/Subtype')=='/Image':
                    x=math.hypot(ctm[0],ctm[1]); y=math.hypot(ctm[2],ctm[3]); w=int(obj.get('/Width',0)); h=int(obj.get('/Height',0))
                    dx=round(w*72/x,1) if x else None; dy=round(h*72/y,1) if y else None
                    images.append({'page':page,'widthPx':w,'heightPx':h,'dpiX':dx,'dpiY':dy})
                    if dx is None or dy is None or min(dx,dy)<min_dpi: warnings.append('第 '+str(page)+' 页图像有效 DPI 低于 '+str(min_dpi)+' 或无法测量。')
                elif obj.get('/Subtype')=='/Form': scan(obj,obj.get('/Resources',res),mul(tuple(map(float,obj.get('/Matrix',[1,0,0,1,0,0]))),ctm),page,depth+1)
    for i,page in enumerate(reader.pages,1):
        box=page.mediabox;pages.append({'page':i,'widthMm':round(float(box.width)/MM,3),'heightMm':round(float(box.height)/MM,3)})
        resources(page.get('/Resources'),set())
        try: scan(page.get_contents(),page.get('/Resources'),(1,0,0,1,0,0),i)
        except (ValueError,TypeError,KeyError,RecursionError): warnings.append('第 '+str(i)+' 页部分图像变换无法预检。')
    for f in fonts.values():
        if not f['embedded']: warnings.append('字体未嵌入：'+f['name'])
    return {'pages':pages,'fonts':list(fonts.values()),'images':images,'warnings':list(dict.fromkeys(warnings))}

def _marks(page,rects,bleed):
    commands=['q','0 G','0.25 w']; length=4*MM; gap=max(bleed,1*MM)
    for x,y,w,h in rects:
        for xx in (x,x+w):
            for yy,direction in ((y,-1),(y+h,1)):
                commands.append(f'{xx:.4f} {yy+direction*gap:.4f} m {xx:.4f} {yy+direction*(gap+length):.4f} l S')
        for yy in (y,y+h):
            for xx,direction in ((x,-1),(x+w,1)):
                # Internal gutter marks are omitted so no marks print on facing page content.
                if any(ox<=xx+direction*(gap+length)<=ox+ow and oy<=yy<=oy+oh for ox,oy,ow,oh in rects): continue
                commands.append(f'{xx+direction*gap:.4f} {yy:.4f} m {xx+direction*(gap+length):.4f} {yy:.4f} l S')
    commands.append('Q'); stream=DecodedStreamObject();stream.set_data(('\n'.join(commands)).encode('ascii'))
    from pypdf.generic import ArrayObject
    existing=page.get('/Contents'); arr=ArrayObject()
    if existing is not None:
        obj=_resolve(existing); arr.extend(obj if isinstance(obj,ArrayObject) else [existing])
    arr.append(stream);page[NameObject('/Contents')]=arr

def process_pdf(pdf_bytes,options=None):
    options=options or {}
    if not isinstance(options,dict): raise ValueError('印刷选项必须为对象。')
    if len(pdf_bytes)>100*1024*1024: raise ValueError('PDF 不得超过 100 MB。')
    try: reader=PdfReader(BytesIO(pdf_bytes),strict=False)
    except PdfReadError as exc: raise ValueError('PDF 文件无法读取或已损坏。') from exc
    if reader.is_encrypted: raise ValueError('不支持加密 PDF，请先提供未加密副本。')
    if not 0<len(reader.pages)<=5000: raise ValueError('PDF 页数超出 1–5,000 页限制。')
    selected=select_pages(options.get('pages'),len(reader.pages)); booklet=bool(options.get('booklet',False)); crop=bool(options.get('cropMarks',False)); bleed=_num(options.get('bleedMm'),0,0,20)*MM; margin=bleed+(5*MM if crop else 0)
    if options.get('pdfX') or options.get('cmyk'): raise ValueError('本工具不提供已验证的 PDF/X 或 CMYK 转换。')
    pages=[]
    for i in selected:
        p=reader.pages[i]
        if p.rotation: p.transfer_rotation_to_content()
        if float(p.get('/UserUnit',1))!=1: raise ValueError('暂不支持非标准 UserUnit 的 PDF。')
        pages.append(p)
    writer=PdfWriter(); imposition=[];warnings=[]; blank=0
    if bleed: warnings.append('出血参数仅扩展纸张与 BleedBox；不会凭空延伸原稿图文。请确认原稿已有足够出血。')
    def place(dest,source,x,y,side=None):
        box=source.trimbox;media=source.mediabox
        # Preserve available outer bleed from the original MediaBox, never synthesize pixels.
        left=0 if side=='right' else bleed;right=0 if side=='left' else bleed
        cropbox=[max(float(media.left),float(box.left)-left),max(float(media.bottom),float(box.bottom)-bleed),min(float(media.right),float(box.right)+right),min(float(media.top),float(box.top)+bleed)]
        if bleed and (cropbox[0]>float(box.left)-left+.01 or cropbox[1]>float(box.bottom)-bleed+.01 or cropbox[2]<float(box.right)+right-.01 or cropbox[3]<float(box.top)+bleed-.01): warnings.append('原稿 MediaBox 没有足够出血图文范围，扩展部分可能留白。')
        source.cropbox=RectangleObject(cropbox)
        dest.merge_transformed_page(source,Transformation().translate(x-float(box.left),y-float(box.bottom)),over=True,expand=False)
    if booklet:
        w=float(pages[0].trimbox.width);h=float(pages[0].trimbox.height)
        if any(abs(float(p.trimbox.width)-w)>.2 or abs(float(p.trimbox.height)-h)>.2 for p in pages): raise ValueError('骑马订拼版要求全部成品页尺寸相同。')
        sw=_num(options.get('sheetWidthMm'),(2*w+2*margin)/MM,20,2000)*MM; sh=_num(options.get('sheetHeightMm'),(h+2*margin)/MM,20,2000)*MM
        if sw+.01<2*w+2*margin or sh+.01<h+2*margin: raise ValueError('纸张尺寸不足以容纳两页及出血/裁切标记；不会自动缩放。')
        blank=(-len(pages))%4;padded=pages+[None]*blank;n=len(padded);ids=[i+1 for i in selected]+[None]*blank
        for sheet in range(n//4):
            for side,pair in [('front',(n-1-2*sheet,2*sheet)),('back',(2*sheet+1,n-2-2*sheet))]:
                out=writer.add_blank_page(sw,sh);x=(sw-2*w)/2;y=(sh-h)/2
                for at,px in zip(pair,(x,x+w)):
                    if padded[at] is not None: place(out,padded[at],px,y,'left' if px==x else 'right')
                rects=[(x,y,w,h),(x+w,y,w,h)];out.trimbox=RectangleObject([x,y,x+2*w,y+h]);out.bleedbox=RectangleObject([x-bleed,y-bleed,x+2*w+bleed,y+h+bleed])
                if crop:_marks(out,rects,bleed)
                imposition.append({'sheet':sheet+1,'side':side,'left':ids[pair[0]],'right':ids[pair[1]]})
        warnings.append('拼版为左装订骑马订正反面顺序；打印双面翻转方向需先用一张纸打样确认。不含爬移补偿。')
    else:
        for source in pages:
            w=float(source.trimbox.width);h=float(source.trimbox.height)
            sw=_num(options.get('sheetWidthMm'),(w+2*margin)/MM,20,2000)*MM;sh=_num(options.get('sheetHeightMm'),(h+2*margin)/MM,20,2000)*MM
            if sw+.01<w+2*margin or sh+.01<h+2*margin:raise ValueError('纸张尺寸不足以容纳成品及出血/裁切标记。')
            out=writer.add_blank_page(sw,sh);x=(sw-w)/2;y=(sh-h)/2;place(out,source,x,y)
            out.trimbox=RectangleObject([x,y,x+w,y+h]);out.bleedbox=RectangleObject([x-bleed,y-bleed,x+w+bleed,y+h+bleed])
            if crop:_marks(out,[(x,y,w,h)],bleed)
    stream=BytesIO();writer.write(stream);data=stream.getvalue();report=preflight(PdfReader(BytesIO(data)),_num(options.get('minDpi'),150,30,2400))
    report.update({'sourcePages':len(reader.pages),'selectedPages':[i+1 for i in selected],'outputPages':len(writer.pages),'blankPages':blank,'imposition':imposition,'minDpi':_num(options.get('minDpi'),150,30,2400),'standards':{'pdfX':False,'cmyk':False}})
    report['warnings']=list(dict.fromkeys(warnings+report['warnings']+['此报告不构成 PDF/X、CMYK 或印厂认证；透明度、叠印、专色、总墨量尚未预检。']))
    return {'pdf':data,'report':report}
