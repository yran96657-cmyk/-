"""Line-oriented English references for the measured founder-sample profile.

The document text and UTF-16 marks are never modified. Break hints are ephemeral
Python character offsets consumed by the PDF renderer. Other profiles retain
TeX paragraph composition. Mixed CJK/math, URLs and unsupported styled runs use
that existing compositor rather than measuring with the wrong font.
"""
from functools import lru_cache
from pathlib import Path
import os
import re
import shutil
import subprocess


@lru_cache(maxsize=1)
def patterns():
    data=re.sub(r'%[^\n]*','',Path(__file__).with_name('vendor').joinpath('hyphen.tex').read_text(encoding='ascii'))
    tree={}
    for pat in re.search(r'\\patterns\{(.*?)\}',data,re.S)[1].split():
        chars=re.sub(r'[0-9]','',pat)
        points=[int(x) if x else 0 for x in re.split(r'[^0-9]',pat)]
        branch=tree
        for c in chars:branch=branch.setdefault(c,{})
        branch['#']=points
    exceptions={}
    match=re.search(r'\\hyphenation\{(.*?)\}',data,re.S)
    words=(match[1].split() if match else [])+['chem-is-try','photo-catalyt-ic']
    for word in words:
        exceptions[word.replace('-','')]=[len(word[:i].replace('-','')) for i,c in enumerate(word) if c=='-']
    return tree,exceptions


@lru_cache(maxsize=8192)
def hyphen_positions(word):
    tree,exceptions=patterns();word=word.lower()
    if word in exceptions:return tuple(exceptions[word])
    text='.'+word+'.';points=[0]*(len(text)+1)
    for i in range(len(text)):
        branch=tree
        for char in text[i:]:
            if char not in branch:break
            branch=branch[char]
            if '#' in branch:
                for j,n in enumerate(branch['#']):points[i+j]=max(points[i+j],n)
    return tuple(i for i in range(2,len(word)-2) if points[i+1]%2)


@lru_cache(maxsize=1)
def latin_font():
    from PIL import ImageFont
    if os.name=='nt':
        path=Path(os.environ.get('WINDIR','C:/Windows'))/'Fonts/times.ttf'
    elif shutil.which('fc-match'):
        match=subprocess.run(['fc-match','-f','%{family}\n%{file}','Times New Roman'],capture_output=True,text=True,timeout=10,check=True).stdout.splitlines()
        if len(match)!=2 or 'Times New Roman' not in match[0]:raise RuntimeError('Reference layout requires Times New Roman')
        path=Path(match[1])
    else:
        raise RuntimeError('Reference font metrics are unavailable on this platform')
    return ImageFont.truetype(str(path),1000)


def reference_breaks(text, width_bp, size_bp, marks=()):
    if not text.strip() or len(text)>10000 or width_bp<40:return None
    if re.search(r'[\u3400-\u9fff]|\[\[math:|\[\^|https?://|\bdoi\s*:',text,re.I):return None
    if any(m.get('bold') or m.get('italic') or 'fontSize' in m or m.get('fontFamily') not in (None,'serif') for m in marks):return None
    try:font=latin_font()
    except (OSError,RuntimeError,subprocess.SubprocessError):return None
    # The sample uses 98% visible glyphs on a nominal 9 bp character pitch.
    # Measuring on that pitch reproduces its line-oriented word fitting without
    # changing font files, shrinking text or inserting characters in the model.
    pitch=size_bp/.98
    offsets=[0]
    for c in text:offsets.append(offsets[-1]+len(c.encode('utf-16-le'))//2)
    small=set()
    for m in marks:
        if m.get('superscript') or m.get('subscript'):
            small.update(i for i in range(len(text)) if m.get('start',0)<=offsets[i]<m.get('end',0))
    @lru_cache(maxsize=4096)
    def measure(a,z,dash=False):
        value=text[a:z].rstrip()
        # Bibliographic type brackets occupy half an em at each side.
        # Only the two bracket widths are replaced; the type letters retain
        # their normal metrics.
        delta=0
        for m in re.finditer(r'([\[［])((?:J|M|C|D|N|R|S|P|EB|DB|CP)(?:/(?:OL|CD|DK))?)([\]］])',value):
            delta+=1-(font.getlength(m[1])+font.getlength(m[3]))/1000
        width=(font.getlength(value)/1000+delta)*pitch
        width-=sum(font.getlength(text[i])/1000*pitch*.3 for i in small if a<=i<z)
        return width+(font.getlength('-')/1000*pitch if dash else 0)
    candidates=[]
    for m in re.finditer(r'\s+|[A-Za-z]{5,}|(?<=[A-Za-z])-(?=[A-Za-z])',text):
        if m[0].isspace():candidates.append((m.end(),False))
        elif m[0]=='-':candidates.append((m.end(),False))
        else:candidates.extend((m.start()+p,True) for p in hyphen_positions(m[0]))
    candidates.sort();result=[];start=0
    while start<len(text) and measure(start,len(text))>width_bp:
        chosen=None
        for end,dash in candidates:
            if end<=start:continue
            if measure(start,end,dash)<=width_bp:chosen=(end,dash)
            elif chosen is not None:break
        if chosen is None:return None
        result.append(chosen);start=chosen[0]
    return result


def explicit_reference_breaks(block,prefix):
    value=block.get('referenceBreaks')
    if value is None:return None
    text=block.get('text','')
    if not isinstance(value,dict) or not isinstance(value.get('sourceText'),str) or not isinstance(value.get('breaks'),list) or len(value['breaks'])>5000:raise ValueError('参考文献断行格式无效。')
    if value['sourceText']!=text:return None
    offsets=[0]
    for c in text:offsets.append(offsets[-1]+len(c.encode('utf-16-le'))//2)
    result=[];previous=len(prefix)
    atoms=list(re.finditer(r'[［\[](?:(?:J|M|C|D|N|R|S|P|EB|DB|CP)(?:/(?:OL|CD|DK))?|\d+)[］\]]',text))
    for point in value['breaks']:
        if not isinstance(point,dict) or type(point.get('offset')) is not int or type(point.get('hyphen')) is not bool:raise ValueError('参考文献断行格式无效。')
        try:index=offsets.index(point['offset'])
        except ValueError:raise ValueError('参考文献断行不能拆开 Unicode 字符。')
        if not previous<index<len(text) or any(m.start()<index<m.end() for m in atoms):raise ValueError('参考文献断行位置无效。')
        if point['hyphen'] and not re.fullmatch(r'[A-Za-z]{2}',text[index-1:index+1]):raise ValueError('断词连字符只能位于英文单词内部。')
        result.append((index-len(prefix),point['hyphen']));previous=index
    return result
