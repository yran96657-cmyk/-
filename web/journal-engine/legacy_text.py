"""Verify legacy Word's main text independently of the conversion filter.

MS-DOC FIB/CLX, STSH and CHPX are read, never executed. Only insertion-only
losses with exact paragraph order and visible source runs can be repaired.
Fields keep their stored result; deleted/hidden text is never resurrected.
Unsupported/ambiguous differences fail closed instead of guessing words.
"""
from io import BytesIO
from zipfile import ZipFile
import bisect
import copy
import difflib
import struct
import xml.etree.ElementTree as ET

W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
REMAP=dict(zip([0x82,0x83,0x84,0x85,0x86,0x87,0x88,0x89,0x8a,0x8b,0x8c,0x91,0x92,0x93,0x94,0x95,0x96,0x97,0x98,0x99,0x9a,0x9b,0x9c,0x9f],
 [0x201a,0x192,0x201e,0x2026,0x2020,0x2021,0x2c6,0x2030,0x160,0x2039,0x152,0x2018,0x2019,0x201c,0x201d,0x2022,0x2013,0x2014,0x2dc,0x2122,0x161,0x203a,0x153,0x178]))
def fail(reason):raise ValueError('WORD_DOC_TEXT_FIDELITY: '+reason)
def cut(data,start,size):
    if start<0 or size<0 or start+size>len(data):fail('原 DOC 的文本/样式索引越界')
    return data[start:start+size]
def u16(b,o=0):return struct.unpack('<H',cut(b,o,2))[0]
def u32(b,o=0):return struct.unpack('<I',cut(b,o,4))[0]
def prls(data):
    result={};i=0
    while i<len(data):
        code=u16(data,i);i+=2;kind=code>>13
        size=[1,1,2,4,2,2,None,3][kind]
        if size is None:size=cut(data,i,1)[0];i+=1
        operand=cut(data,i,size);i+=size;result[code]=operand
    return result
def truth(props,code):
    return bool(props.get(code,b'\0')[0])

def overlay(base,props):
    result={**base,**props}
    # MS-DOC ToggleOperand: 0x80 inherits the applied style, 0x81 inverts it.
    for code in (0x0800,0x0801,0x083c,0x0811,0x0836,0x0835):
        if code not in props:continue
        value=props[code][0]
        if value not in (0,1,128,129):fail('无效的字符可见性/强调样式')
        result[code]=bytes([int(truth(base,code)) ^ (value-128) if value>=128 else value])
    if truth(props,0x2a83):fail('DOC 含格式修订，请在 Word 中处理后另存为 DOCX')
    return result

def native_paragraphs(data):
    import olefile
    with olefile.OleFileIO(BytesIO(data)) as ole:
        w=ole.openstream('WordDocument').read();flags=u16(w,10)
        if u16(w)!=0xa5ec or u16(w,2)<0xc1 or flags&0x8100:fail('不支持加密或旧版本 DOC 的独立文字核验')
        table=ole.openstream('1Table' if flags&512 else '0Table').read()
    # Word 97+ FibRgFcLcb97. Validate the counts before accessing its fields.
    if u16(w,32)!=14 or u16(w,62)!=22 or u16(w,152)<34:fail('不支持此 DOC 的 FIB')
    clx=cut(table,u32(w,0x1a2),u32(w,0x1a6));i=0
    while i<len(clx) and clx[i]==1:i+=3+u16(clx,i+1)
    if cut(clx,i,1)!=b'\x02':fail('缺少文本片段表')
    p=cut(clx,i+5,u32(clx,i+1));n=(len(p)-4)//12
    if n<1 or n>100000 or len(p)!=12*n+4:fail('文本片段表无效')
    # Styles: preserve only semantic emphasis needed for recovered runs.
    sheet=cut(table,u32(w,0xa2),u32(w,0xa6));count=u16(sheet,2);base=u16(sheet,4);pos=2+u16(sheet);styles={}
    if count>4095 or base not in (10,18):fail('不支持此 DOC 的样式表')
    for sid in range(count):
        length=u16(sheet,pos);pos+=2;s=cut(sheet,pos,length);pos+=length
        if not s:continue
        kind=u16(s,2)&15;parent=u16(s,2)>>4;upxs=u16(s,4)&15
        q=base+2+2*u16(s,base)+2;arrays=[]
        for _ in range(upxs):
            if q%2:q+=1
            size=u16(s,q);q+=2;arrays.append(cut(s,q,size));q+=size
        if kind not in (1,2):continue
        props=prls(arrays[1] if kind==1 and len(arrays)>1 else arrays[0] if kind==2 and arrays else b'')
        styles[sid]=(parent,props)
    def style(sid,base=None,seen=()):
        if sid in seen or len(seen)>32:fail('循环样式继承')
        parent,props=styles.get(sid,(4095,{}))
        inherited=style(parent,base,seen+(sid,)) if parent!=4095 else (base or {})
        return overlay(inherited,props)
    # Paragraph character defaults also control visibility; a character style
    # alone is not sufficient evidence that a missing run was visible.
    pb=cut(table,u32(w,0x102),u32(w,0x106));pn=(len(pb)-4)//8;paragraph_runs=[]
    if len(pb)!=8*pn+4:fail('段落样式索引无效')
    for j in range(pn):
        fkp=cut(w,u32(pb,4*(pn+1+j))*512,512);nr=fkp[511]
        if nr>29:fail('段落样式页无效')
        for k in range(nr):
            off=fkp[4*(nr+1)+13*k]*2
            if not off:props=style(0)
            else:
                cb=fkp[off];start=off+1 if cb else off+2
                size=2*cb-1 if cb else 2*fkp[off+1]
                props=style(u16(cut(fkp,start,size)))
            paragraph_runs.append((u32(fkp,k*4),u32(fkp,(k+1)*4),props))
    paragraph_runs.sort();paragraph_starts=[r[0] for r in paragraph_runs]
    # Direct formatting runs are sorted by file offsets, not by story CPs.
    b=cut(table,u32(w,0xfa),u32(w,0xfe));count=(len(b)-4)//8;runs=[]
    if len(b)!=8*count+4:fail('字符样式索引无效')
    for j in range(count):
        fkp=cut(w,u32(b,4*(count+1+j))*512,512);nr=fkp[511]
        if nr>101:fail('字符样式页无效')
        for k in range(nr):
            off=fkp[4*(nr+1)+k]*2
            props=prls(cut(fkp,off+1,fkp[off])) if off else {}
            sid=u16(props[0x4a30]) if 0x4a30 in props else 10
            runs.append((u32(fkp,k*4),u32(fkp,(k+1)*4),sid,props))
    runs.sort();starts=[r[0] for r in runs]
    main=u32(w,0x4c);chars=[];last=0
    if main>1_000_000:fail('独立核验文本超出长度上限')
    for j in range(n):
        a,z=u32(p,4*j),u32(p,4*(j+1));off=4*(n+1)+8*j
        if a!=last or z<a:fail('文本片段顺序无效')
        last=z
        if a>=main:break
        if u16(p,off+6):fail('不支持片段级修订样式，请另存为 DOCX 后核验')
        raw=u32(p,off+2);compressed=bool(raw&0x40000000);fc=raw&0x3fffffff;fc=fc//2 if compressed else fc
        rawtext=cut(w,fc,(min(z,main)-a)*(1 if compressed else 2))
        text=''.join(chr(REMAP.get(c,c)) for c in rawtext) if compressed else rawtext.decode('utf-16-le')
        cp=a
        for char in text:
            at=fc+(cp-a)*(1 if compressed else 2);ri=bisect.bisect_right(starts,at)-1
            if ri<0 or at>=runs[ri][1]:fail('缺少字符可见性证据')
            pi=bisect.bisect_right(paragraph_starts,at)-1
            if pi<0 or at>=paragraph_runs[pi][1]:fail('缺少段落可见性证据')
            props=overlay(style(runs[ri][2],paragraph_runs[pi][2]),runs[ri][3])
            if any(truth(props,prop) for prop in (0x0800,0x0801)):
                fail('DOC 含修订文字（CP '+str(cp)+'），请在 Word 中处理后另存为 DOCX')
            # Hidden text is not source evidence for recovery. Retain structural
            # field delimiters and paragraph boundaries for exact alignment.
            if char in '\x13\x14\x15\x07' or not any(truth(props,prop) for prop in (0x083c,0x0811)):
                chars.append((char,cp,truth(props,0x0836),truth(props,0x0835)))
            cp+=len(char.encode('utf-16-le'))//2
    if last<main:fail('文本片段未覆盖完整正文，不能核验转换结果')
    paragraphs=[];current=[];stack=[]
    for item in chars:
        c=item[0]
        if c=='\x13':stack.append(False);continue
        if c=='\x14':
            if not stack:fail('域结果边界无效')
            stack[-1]=True;continue
        if c=='\x15':
            if not stack:fail('域结束边界无效')
            stack.pop();continue
        if not all(stack):continue
        if c in '\r\x07':
            if any(not x[0].isspace() for x in current):paragraphs.append(current)
            current=[]
        elif c in '\x01\x02\x00\xad':continue # separately imported objects, notes, optional hyphen
        elif ord(c)<32 and c not in '\t\n\x0b':fail('未支持的正文控制符')
        else:current.append(item)
    if stack:fail('未闭合的域')
    if any(not x[0].isspace() for x in current):paragraphs.append(current)
    return paragraphs

def repair_converted_docx(source,converted):
    native=native_paragraphs(source)
    with ZipFile(BytesIO(converted)) as z:
        entries=[(info,z.read(info)) for info in z.infolist()]
    raw=next(data for info,data in entries if info.filename=='word/document.xml')
    if b'<!ENTITY' in raw.upper() or b'<!DOCTYPE' in raw.upper():fail('不支持 XML 实体')
    root=ET.fromstring(raw);paragraphs=[]
    for p in root.find(W+'body').iter(W+'p'):
        chars=[];all_chars=[]
        for r in p.iter(W+'r'):
            for node in r:
                value=node.text or '' if node.tag==W+'t' else {'tab':'\t','br':'\n','noBreakHyphen':'\u2011'}.get(node.tag.removeprefix(W),'')
                for i,c in enumerate(value):
                    all_chars.append((c,r,node,i))
                    if not c.isspace() and c!='\xad':chars.append((c,r,node,i))
        if chars:paragraphs.append((p,chars,all_chars))
    # Some Word paragraph marks are folded by Writer. Accept only an ordered,
    # insertion-only match of at most three source paragraphs, never a fuzzy
    # replacement or a reordering. The converted paragraph geometry is retained.
    aligned=[];cursor=0
    for _,visible,_ in paragraphs:
        actual=''.join(x[0] for x in visible);candidate=[];matched=False
        for count in range(1,4):
            if cursor+count>len(native):break
            candidate+=native[cursor+count-1]
            wanted=''.join(x[0] for x in candidate if not x[0].isspace())
            if max(len(actual),len(wanted))>20000:fail('单段超出文字核验上限')
            ops=difflib.SequenceMatcher(None,actual,wanted,autojunk=False).get_opcodes()
            if all(op in ('equal','insert') for op,*_ in ops):
                if count>1 and (len(actual)<len(wanted)*.8 or len(actual)<40):break
                aligned.append(candidate);cursor+=count;matched=True;break
        if not matched:fail('原稿与转换稿段落/单元格内容不对应，请另存为 DOCX 后核验')
    if cursor!=len(native):fail('转换稿遗漏完整段落，需核验原稿')
    repairs=[]
    for index,(source_chars,(p,visible,all_chars)) in enumerate(zip(aligned,paragraphs)):
        all_source=source_chars
        source_chars=[x for x in source_chars if not x[0].isspace()]
        wanted=''.join(x[0] for x in source_chars);actual=''.join(x[0] for x in visible)
        if wanted==actual:continue
        if max(len(wanted),len(actual))>20000:fail('单段超出文字核验上限')
        diff=difflib.SequenceMatcher(None,actual,wanted,autojunk=False).get_opcodes()
        if any(op not in ('equal','insert') for op,*_ in diff):fail('第 '+str(index+1)+' 段有替换或重排，不能自动恢复')
        for op,a,b,c,d in reversed(diff):
            if op=='equal':continue
            first,last=source_chars[c][1],source_chars[d-1][1]
            missing=[x for x in all_source if first<=x[1]<=last]
            lower=source_chars[c-1][1] if c else -1
            upper=source_chars[d][1] if d<len(source_chars) else float('inf')
            replacement=[x for x in all_source if lower<x[1]<upper]
            # Insert only into a text run. Never split an equation, object or field.
            edge=visible[a] if a<len(visible) else visible[-1];_,run,node,offset=edge
            if node.tag!=W+'t' or run not in list(p):fail('缺漏位于复杂域/对象内部，需人工核验')
            offset=offset if a<len(visible) else offset+1
            start=all_chars.index(visible[a-1])+1 if a else 0
            end=all_chars.index(visible[a]) if a<len(visible) else len(all_chars)
            for char,_,gap_node,gap_offset in reversed(all_chars[start:end]):
                if not char.isspace() or gap_node.tag!=W+'t':fail('缺字边界包含复杂分隔符，需人工核验')
                gap_node.text=(gap_node.text or '')[:gap_offset]+(gap_node.text or '')[gap_offset+1:]
                if gap_node is node and gap_offset<offset:offset-=1
            nodes=list(run);at=nodes.index(node);after=ET.Element(W+'r',run.attrib)
            if run.find(W+'rPr') is not None:after.append(copy.deepcopy(run.find(W+'rPr')))
            for child in nodes[at:]:after.append(copy.deepcopy(child))
            after_node=next(x for x in after if x.tag==W+'t')
            after_node.text=(node.text or '')[offset:]
            node.text=(node.text or '')[:offset]
            for child in nodes[at+1:]:run.remove(child)
            position=list(p).index(run)+1
            for char,cp,italic,bold in replacement:
                new=ET.Element(W+'r');props=ET.SubElement(new,W+'rPr')
                if italic:ET.SubElement(props,W+'i')
                if bold:ET.SubElement(props,W+'b')
                ET.SubElement(new,W+'t',{'{http://www.w3.org/XML/1998/namespace}space':'preserve'}).text=char;p.insert(position,new);position+=1
            p.insert(position,after)
            repairs.append({'paragraph':index+1,'sourceCp':missing[0][1],'text':''.join(x[0] for x in missing),'characters':len(missing)})
    if not repairs:return converted,[]
    out=BytesIO()
    with ZipFile(out,'w') as z:
        for info,data in entries:z.writestr(info,ET.tostring(root,encoding='utf-8',xml_declaration=True) if info.filename=='word/document.xml' else data)
    return out.getvalue(),sorted(repairs,key=lambda r:r['sourceCp'])
