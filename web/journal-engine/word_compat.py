"""Bounded Word compatibility transforms; no Office macros or field execution."""
from io import BytesIO
from pathlib import Path
import hashlib
import os
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
A='{http://schemas.openxmlformats.org/drawingml/2006/main}'
R='{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
MC='{http://schemas.openxmlformats.org/markup-compatibility/2006}'
O='{urn:schemas-microsoft-com:office:office}'
V='{urn:schemas-microsoft-com:vml}'
M='{http://schemas.openxmlformats.org/officeDocument/2006/math}'

def legacy_converter():
    return 'Microsoft Word' if os.name=='nt' else 'LibreOffice'

def check_legacy_converter(data,converter):
    # WPS-generated binary DOC can lose entire italic runs in Writer without
    # emitting any conversion error. Require the native reader in this case.
    import olefile
    with olefile.OleFileIO(BytesIO(data)) as compound:
        if compound.exists('WpsCustomData') and converter!='Microsoft Word':
            raise ValueError('WORD_DOC_NATIVE_REQUIRED: WPS binary DOC requires Microsoft Word conversion; save a DOCX with Word or import through the Windows engine. LibreOffice conversion can omit italic text.')

def legacy_docx(data):
    converter=legacy_converter();check_legacy_converter(data,converter)
    if converter=='Microsoft Word':
        exe=shutil.which('pwsh') or shutil.which('powershell')
        if not exe:raise ValueError('WORD_DOC_RUNTIME_UNAVAILABLE: Microsoft Word and PowerShell required')
        with tempfile.TemporaryDirectory(prefix='shuye-word-') as tmp:
            source=Path(tmp)/'source.doc';target=Path(tmp)/'source.docx';source.write_bytes(data)
            done=subprocess.run([exe,'-NoProfile','-NonInteractive','-File',str(Path(__file__).with_name('word_convert.ps1')),
                                 '-Source',str(source),'-Target',str(target)],capture_output=True,timeout=90)
            if done.returncode or not target.exists():raise ValueError('WORD_DOC_NATIVE_FAILED: Microsoft Word conversion failed; original document unchanged')
            if target.stat().st_size>20*1024*1024:raise ValueError('Converted DOCX exceeds 20 MB')
            return target.read_bytes()
    exe=shutil.which('soffice') or shutil.which('libreoffice')
    if not exe:raise ValueError('WORD_DOC_RUNTIME_UNAVAILABLE: install LibreOffice Writer')
    with tempfile.TemporaryDirectory(prefix='shuye-doc-') as tmp:
        directory=Path(tmp);profile=directory/'profile';(profile/'user').mkdir(parents=True)
        # Never run document macros or update linked external content. Each job
        # gets a fresh profile and output directory, with a bounded subprocess.
        (profile/'user/registrymodifications.xcu').write_text('''<?xml version="1.0"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry">
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>
<item oor:path="/org.openoffice.Office.Writer/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>2</value></prop></item>
</oor:items>''',encoding='utf-8')
        source=directory/'source.doc';source.write_bytes(data)
        env={**os.environ,'HOME':tmp,'XDG_CONFIG_HOME':tmp,'XDG_CACHE_HOME':tmp}
        done=subprocess.run([exe,'-env:UserInstallation='+profile.as_uri(),'--headless','--nologo','--nodefault','--norestore',
                             '--convert-to','docx:Office Open XML Text','--outdir',tmp,str(source)],
                            cwd=tmp,env=env,capture_output=True,timeout=90)
        target=directory/'source.docx'
        if done.returncode or not target.exists():raise ValueError('Legacy DOC conversion failed')
        if target.stat().st_size>20*1024*1024:raise ValueError('Converted DOCX exceeds 20 MB')
        return target.read_bytes()

def accept_revisions(root,policy):
    if policy not in ('require-clean','accept'):raise ValueError('Invalid revisionPolicy')
    revisions={W+n for n in ('ins','del','moveFrom','moveTo','rPrChange','pPrChange','tblPrChange','tblGridChange','trPrChange','tcPrChange','sectPrChange','numberingChange','cellIns','cellDel','cellMerge')}
    count=sum(e.tag in revisions for e in root.iter())
    if count and policy!='accept':return count
    # Structural deletion is not equivalent to deleting its empty marker:
    # paragraph marks join paragraphs and table-cell revisions alter the grid.
    # Refuse these until their final topology can be reconstructed losslessly.
    for parent in root.iter():
        for e in parent:
            if e.tag in {W+'cellIns',W+'cellDel',W+'cellMerge'} or (e.tag==W+'del' and parent.tag in {W+'rPr',W+'trPr'}):
                raise ValueError('WORD_STRUCTURAL_REVISION_UNSUPPORTED: '+e.tag.split('}')[-1])
    def walk(parent):
        for e in list(parent):
            if e.tag in (W+'del',W+'moveFrom',W+'tblGridChange') or (e.tag.startswith(W) and e.tag.endswith('PrChange')) or e.tag==W+'numberingChange':parent.remove(e)
            elif e.tag in (W+'ins',W+'moveTo'):
                walk(e);i=list(parent).index(e);parent.remove(e)
                for c in list(e):parent.insert(i,c);i+=1
            else:walk(e)
    if count:walk(root)
    return count

def choose_alternates(root):
    count=0
    for parent in list(root.iter()):
        for e in list(parent):
            if e.tag!=MC+'AlternateContent':continue
            # Only a picture/group DrawingML branch can be reconstructed here.
            choices=[c for c in e if c.tag==MC+'Choice' and any(x.tag==A+'blip' or x.tag.endswith('}wsp') for x in c.iter())]
            if not choices:raise ValueError('WORD_ALTERNATE_CONTENT_UNSUPPORTED')
            i=list(parent).index(e);parent.remove(e)
            for c in list(choices[0]):parent.insert(i,c);i+=1
            count+=1
    return count

def vector_png(data,extension,dpi=600):
    from PIL import Image
    if len(data)>20*1024*1024:raise ValueError('Vector image exceeds 20 MB')
    exe=shutil.which('inkscape')
    if not exe:raise ValueError('WORD_VECTOR_RUNTIME_UNAVAILABLE: install Inkscape')
    with tempfile.TemporaryDirectory(prefix='shuye-vector-') as tmp:
        source=Path(tmp)/('image.'+extension);target=Path(tmp)/'image.png';source.write_bytes(data)
        env={**os.environ,'HOME':tmp,'XDG_CONFIG_HOME':tmp,'XDG_CACHE_HOME':tmp}
        result=subprocess.run([exe,str(source),'--export-type=png','--export-area-page',
                               '--export-dpi='+str(dpi),'--export-filename='+str(target)],
                              cwd=tmp,env=env,capture_output=True,timeout=60)
        if result.returncode or not target.exists():raise ValueError('Vector conversion failed: '+result.stderr.decode(errors='replace')[-500:])
        if target.stat().st_size>5*1024*1024:raise ValueError('Converted vector exceeds 5 MB')
        output=target.read_bytes()
        with Image.open(BytesIO(output)) as im:
            if im.width*im.height>25000000:raise ValueError('Converted vector exceeds 25 MP')
            im.verify()
        return output

def transform_pictures(root,read,rels):
    """Apply Word's per-instance crop before importing shared image assets."""
    from PIL import Image,ImageOps
    import math
    assets={};audit=[]
    for pic in list(root.iter()):
        if pic.tag!='{http://schemas.openxmlformats.org/drawingml/2006/picture}pic':continue
        crop=pic.find('.//'+A+'srcRect');xf=pic.find('.//'+A+'xfrm');blip=pic.find('.//'+A+'blip')
        values=[int(crop.get(k,'0')) for k in ('l','t','r','b')] if crop is not None else [0]*4
        transform=xf.attrib if xf is not None else {}
        if not any(values) and not transform:continue
        if blip is None:raise ValueError('Picture transform missing image')
        if any(v<0 or v>=100000 for v in values) or values[0]+values[2]>=100000 or values[1]+values[3]>=100000:raise ValueError('Unsupported Word crop bounds')
        if any(k not in ('rot','flipH','flipV') for k in transform):raise ValueError('Unsupported picture transform')
        rotation=int(transform.get('rot','0'))/60000
        if rotation%90:raise ValueError('Non-orthogonal picture rotation needs explicit layout')
        path=rels.get(blip.get(R+'embed'),'');raw=read(path);ext=path.rsplit('.',1)[-1].lower()
        if ext in ('emf','wmf'):raw=vector_png(raw,ext)
        with Image.open(BytesIO(raw)) as source:
            if source.width*source.height>125000000 or getattr(source,'n_frames',1)!=1:raise ValueError('Picture transform size/frame limit')
            if source.mode not in ('1','L','LA','RGB','RGBA','P'):raise ValueError('Unsupported crop color mode')
            w,h=source.size;l,t,r,b=values
            im=source.crop((math.floor(w*l/100000),math.floor(h*t/100000),math.ceil(w*(1-r/100000)),math.ceil(h*(1-b/100000))))
            if transform.get('flipH') in ('1','true'):im=ImageOps.mirror(im)
            if transform.get('flipV') in ('1','true'):im=ImageOps.flip(im)
            if rotation:im=im.rotate(-rotation,expand=True)
            out=BytesIO();im.save(out,format='PNG')
        if out.tell()>5*1024*1024:raise ValueError('Transformed picture exceeds 5 MB')
        key='word/media/shuye-crop-'+str(len(audit))+'.png';rid='shuyeCrop'+str(len(audit));assets[key]=out.getvalue();rels[rid]=key;blip.set(R+'embed',rid)
        audit.append({'part':path,'sourceSha256':hashlib.sha256(raw).hexdigest(),'crop':values,'rotation':rotation})
    return assets,audit

def convert_objects(root,read,rels):
    """Replace only recognized equation OLEs with editable OMML, never previews."""
    sys.path.insert(0,str(Path(__file__).parent/'vendor'))
    from mathtypejx.mtef import mtef_to_mathml
    from mathml_import import mathml_to_omml
    audit=[]
    for parent in list(root.iter()):
        for e in list(parent):
            if e.tag!=W+'object':continue
            ole=e.find(O+'OLEObject')
            if ole is None:raise ValueError('OLE object has no embedded data')
            path=rels.get(ole.get(R+'id'),'');data=read(path)
            mathml=mtef_to_mathml(data)
            if not mathml:raise ValueError('OLE_MATH_UNSUPPORTED: '+path)
            converted=mathml_to_omml(mathml)
            i=list(parent).index(e);parent.remove(e);parent.insert(i,converted)
            audit.append({'part':path,'sha256':hashlib.sha256(data).hexdigest(),
                          'ommlSha256':hashlib.sha256(ET.tostring(converted)).hexdigest()})
    return audit

def normalize_fence_extensions(root):
    """Fold legacy hand-positioned Symbol brace extenders into real fences.

    Only U+F8F2 left-brace middles adjacent to an already parsed scalable
    left-brace equation qualify. No equation/token is invented from a picture.
    """
    body=root.find(W+'body');paragraphs=list(body) if body is not None else [];count=0
    for index,p in enumerate(paragraphs):
        candidates=[m for q in paragraphs[index:index+3] for m in q.iter(M+'oMath')]
        target=next((m for m in candidates if any(d.get(M+'val')=='{' for d in m.iter(M+'begChr'))),None)
        for parent in list(p.iter()):
            for drawing in list(parent):
                if drawing.tag!=W+'drawing':continue
                shapes=[x for x in drawing.iter() if x.tag.endswith('}wsp')]
                if len(shapes)!=1:continue
                shape=shapes[0];text=''.join(t.text or '' for t in shape.iter(W+'t'))
                props=next((x for x in shape if x.tag.endswith('}spPr')),None)
                invisible=props is not None and props.find(A+'noFill') is not None and props.find(A+'ln/'+A+'noFill') is not None
                if invisible and (not text.strip() or text.strip()=='\uf8f2' and target is not None):
                    parent.remove(drawing);count+=1
        if target is not None:
            for t in p.iter(W+'t'):
                if '\uf8f2' in (t.text or ''):count+=t.text.count('\uf8f2');t.text=t.text.replace('\uf8f2','')
    return count

def compose_groups(root,read,rels,preserve_pictures=False):
    """Rasterize picture-only DrawingML groups at their original coordinates.

    Overlaps and XML paint order are preserved; text/shapes/rotation/cropping
    fail closed rather than silently flattening them away.
    """
    from PIL import Image,ImageDraw
    assets={};groups=0;picture_count=0
    # Simple horizontal Word separator shapes are preserved as lossless line
    # images. Anything beyond this exact supported geometry remains blocking.
    for parent in list(root.iter()):
        for shape in list(parent):
            if shape.tag!='{http://schemas.microsoft.com/office/word/2010/wordprocessingShape}wsp':continue
            paths=list(shape.iter(A+'path'));texts=list(shape.iter(W+'t'))
            if len(paths)!=1 or texts:raise ValueError('Unsupported Word drawing shape')
            path=paths[0];commands=list(path)
            if [c.tag for c in commands]!=[A+'moveTo',A+'lnTo']:raise ValueError('Unsupported Word path geometry')
            points=[c.find(A+'pt') for c in commands]
            if any(p is None for p in points) or points[0].get('y')!=points[1].get('y'):raise ValueError('Unsupported nonhorizontal Word line')
            transform=next(shape.iter(A+'xfrm'),None);line=next(shape.iter(A+'ln'),None)
            if transform is None or transform.attrib or line is None:raise ValueError('Unsupported line transform')
            ext=transform.find(A+'ext');color=line.find(A+'solidFill/'+A+'srgbClr')
            if ext is None or color is None:raise ValueError('Unsupported line dimensions/color')
            width=round(int(ext.get('cx'))/914400*600);stroke=max(1,round(int(line.get('w','12700'))/914400*600))
            if width<1 or width>10000 or stroke>100:raise ValueError('Word line exceeds dimensions limit')
            canvas=Image.new('RGBA',(width,stroke+4),(255,255,255,0));ImageDraw.Draw(canvas).line((0,(stroke+4)//2,width,(stroke+4)//2),fill='#'+color.get('val'),width=stroke)
            out=BytesIO();canvas.save(out,format='PNG');key='word/media/shuye-shape-'+str(len(assets))+'.png';rid='shuyeShape'+str(len(assets))
            assets[key]=out.getvalue();rels[rid]=key;i=list(parent).index(shape);parent.remove(shape);parent.insert(i,ET.Element(A+'blip',{R+'embed':rid}))
    for parent in list(root.iter()):
        for group in list(parent):
            if group.tag!='{http://schemas.microsoft.com/office/word/2010/wordprocessingGroup}wgp':continue
            if preserve_pictures:continue
            pictures=[c for c in group if c.tag.endswith('}pic')]
            if len(pictures)<1 or any(c.tag.rsplit('}',1)[-1] not in ('cNvPr','cNvGrpSpPr','grpSpPr','pic') for c in group):raise ValueError('Unsupported non-picture drawing group')
            props=next((c for c in group if c.tag.endswith('}grpSpPr')),None)
            xf=props.find(A+'xfrm') if props is not None else None
            if xf is None or xf.attrib:raise ValueError('Unsupported group transform')
            origin=xf.find(A+'chOff');bounds=xf.find(A+'chExt');display=xf.find(A+'ext')
            if origin is None or bounds is None or display is None:raise ValueError('Incomplete drawing group geometry')
            ox,oy=int(origin.get('x')),int(origin.get('y'));bw,bh=int(bounds.get('cx')),int(bounds.get('cy'))
            width,height=round(int(display.get('cx'))/914400*600),round(int(display.get('cy'))/914400*600)
            if bw<=0 or bh<=0 or width<=0 or height<=0 or width*height>25000000:raise ValueError('Drawing group bounds exceed limit')
            canvas=Image.new('RGBA',(width,height),(255,255,255,0))
            for pic in pictures:
                if any(c.tag==A+'srcRect' and any(int(v) for v in c.attrib.values()) for c in pic.iter()):raise ValueError('Cropped group pictures unsupported')
                blip=next((c for c in pic.iter(A+'blip')),None);x=next((c for c in pic.iter(A+'xfrm')),None)
                if blip is None or x is None or x.attrib:raise ValueError('Unsupported picture transform')
                off=x.find(A+'off');ext=x.find(A+'ext')
                path=rels.get(blip.get(R+'embed'),'');raw=read(path)
                extension=path.rsplit('.',1)[-1].lower()
                if extension in ('emf','wmf'):raw=vector_png(raw,extension)
                with Image.open(BytesIO(raw)) as image:
                    if image.width*image.height>25000000:raise ValueError('Group source image exceeds 25 MP')
                    px,py=round((int(off.get('x'))-ox)*width/bw),round((int(off.get('y'))-oy)*height/bh)
                    pw,ph=round(int(ext.get('cx'))*width/bw),round(int(ext.get('cy'))*height/bh)
                    if pw<=0 or ph<=0 or pw*ph>25000000:raise ValueError('Group picture bounds exceed limit')
                    if extension not in ('emf','wmf') and (image.width/pw*600<300 or image.height/ph*600<300):
                        raise ValueError('Group raster source below 300 DPI at original size')
                    canvas.alpha_composite(image.convert('RGBA').resize((pw,ph),Image.Resampling.LANCZOS),(px,py))
            out=BytesIO();canvas.save(out,format='PNG');key='word/media/shuye-group-'+str(groups)+'.png'
            if out.tell()>5*1024*1024:raise ValueError('Drawing group PNG exceeds 5 MB')
            rid='shuyeGroup'+str(groups);assets[key]=out.getvalue();rels[rid]=key
            replacement=ET.Element(A+'blip',{R+'embed':rid});i=list(parent).index(group);parent.remove(group);parent.insert(i,replacement)
            groups+=1;picture_count+=len(pictures)
    return assets,groups,picture_count
