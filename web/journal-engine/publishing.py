"""Independent, bounded XeLaTeX book publishing backend (MIT)."""
import base64
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import threading
from contextlib import nullcontext
from journal import prepare_blocks,ROLE_STYLE,FRONT_ROLES,marker,read_positions,side_groups

_LOCK=threading.Lock()
TEX_DEFAULT=Path.home()/'AppData/Roaming/TinyTeX/bin/windows/xelatex.exe'
SAFE_COMMANDS=set('frac dfrac tfrac sqrt sum prod int oint iint iiint lim min max log ln exp sin cos tan cot sec csc arcsin arccos arctan sinh cosh tanh alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi varpi rho varrho sigma varsigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega left right middle cdot times div pm mp le leq ge geq neq approx equiv sim simeq propto in notin subset supset subseteq supseteq cup cap emptyset infinity infty partial nabla forall exists neg land lor to rightarrow leftarrow leftrightarrow Rightarrow Leftarrow Leftrightarrow mapsto overline underline hat widehat bar vec dot ddot tilde widetilde overbrace underbrace text mathrm mathbf mathit mathsf mathtt mathcal mathbb operatorname limits nolimits displaystyle textstyle scriptstyle scriptscriptstyle quad qquad space thinspace backslash lceil rceil lfloor rfloor lbrace rbrace langle rangle lvert rvert vert Vert colon ldots cdots vdots ddots binom dbinom tbinom overset underset stackrel big Big bigg Bigg bmod pmod mod det gcd ker hom dim sup inf Pr begin end'.split())
SAFE_COMMANDS.update('boldsymbol mathfrak genfrac check breve coprod bigcup bigcap'.split())
SAFE_ENVS={'matrix','pmatrix','bmatrix','Bmatrix','vmatrix','Vmatrix','cases','aligned','gathered'}
TEXT_SUPERSCRIPTS=dict(zip('⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ',list('0123456789+')+[r'\ensuremath{-}']+list('=()ni')))
def escape(text):
    # Unicode subscript numerals are often absent from text/math font cmaps.
    # Typeset the same numeral using TeX's subscript positioning; retain the
    # original Unicode string in the document model and import evidence.
    return ''.join((r'\textsuperscript{'+TEXT_SUPERSCRIPTS[c]+'}') if c in TEXT_SUPERSCRIPTS else (r'\textsubscript{'+str(ord(c)-0x2080)+'}') if c in '₀₁₂₃₄₅₆₇₈₉' else (r'\ShuyeTextSymbol{'+format(ord(c),'X')+'}{'+c+'}') if '\u0370'<=c<='\u03ff' or c=='µ' else {'∗':r'\ensuremath{\ast}','\\':r'\textbackslash{}','{':r'\{','}':r'\}','$':r'\$','&':r'\&','#':r'\#','%':r'\%','_':r'\_','^':r'\textasciicircum{}','~':r'\textasciitilde{}','\n':r'\newline ','\t':r'\quad '}.get(c,c) for c in str(text) if ord(c)>=32 or c in '\n\t')
def safe_math(value):
    s=str(value)
    if len(s)>30000 or any(ord(c)<32 and c not in '\n\t\r' for c in s): raise ValueError('数学公式过长或含控制字符。')
    if '^^' in s: raise ValueError('数学公式不允许 TeX 字符编码转义。')
    if '%' in re.sub(r'\\%', '',s) or '#' in re.sub(r'\\#','',s) or '$' in re.sub(r'\\\$','',s): raise ValueError('数学公式不允许 TeX 注释、参数或数学模式分隔符。')
    for m in re.finditer(r'\\([A-Za-z]+|.)',s,re.S):
        command=m.group(1)
        if command not in SAFE_COMMANDS and command not in '{}_%#&$,;:!| \\': raise ValueError('不允许的数学命令：'+command)
    for env in re.finditer(r'\\(?:begin|end)\s*\{([^}]*)\}',s):
        if env.group(1) not in SAFE_ENVS: raise ValueError('不允许的数学环境：'+env.group(1))
    # Any begin/end must have literal allowed environment, no macro-generated names.
    if len(re.findall(r'\\(?:begin|end)\b',s))!=len(re.findall(r'\\(?:begin|end)\s*\{(?:'+ '|'.join(SAFE_ENVS)+r')\}',s)): raise ValueError('数学环境语法无效。')
    return s

def math_with_suffix(tex,suffix):
    # The punctuation belongs on the last line of a wrapped expression, not
    # beside the vertically centred gathered box.
    end=r'\end{gathered}'
    if suffix and tex.startswith(r'\begin{gathered}') and tex.endswith(end):
        return tex[:-len(end)]+suffix+end
    return tex+suffix

def number(value,default,lo,hi):
    try: n=float(value)
    except (TypeError,ValueError): n=default
    if not math.isfinite(n) or not lo<=n<=hi: raise ValueError('版式数值超出范围。')
    return n

def resolve_font_set(layout):
    value=layout.get('fontSet') or os.environ.get('SHUYE_FONTSET','windows')
    if value not in ('windows','mac','fandol','source-han'): raise ValueError('PDF 字体方案必须为 windows / mac / fandol / source-han。')
    return value

def compile_diagnostics(log):
    """Only discard vbox messages explicitly rejected by multicol's trial pass.

    Actual page output, horizontal overflow, missing glyphs and ambiguous log
    messages remain errors. Keep rejected messages separately for audit.
    """
    messages=[];trials=[];pending=[];balancing=False
    for line in log.splitlines():
        if 'Package multicol: Balance columns' in line:
            messages.extend(pending);pending=[];balancing=True
        elif 'Package multicol: Balancing failed ... cut a normal page' in line and balancing:
            trials.extend(pending);pending=[];balancing=False
        elif line.startswith('Package multicol:') and ('Column spec:' in line or 'End multicols' in line):
            messages.extend(pending);pending=[];balancing=False
        if any(term in line for term in ('Missing character:','Overfull','LaTeX Font Warning:')):
            if balancing and re.match(r'Overfull \\vbox .*while \\output is active',line):pending.append(line)
            else:messages.append(line)
    messages.extend(pending)
    return messages[:200],trials[:200]

def build_tex(doc,assets_dir,math_widths=None):
    """Return (trusted TeX source, warnings); assets_dir must be a private build dir."""
    warnings=[]; assets_dir=Path(assets_dir); assets_dir.mkdir(parents=True,exist_ok=True)
    layout=doc.get('layout',{}); font_set=resolve_font_set(layout)
    if layout.get('widowLines',1)>1: warnings.append('PDF 使用 TeX 防孤行策略，不能保证浏览器设定的孤行数量。')
    if layout.get('writingMode','horizontal') not in ('horizontal','horizontal-tb') or layout.get('vertical'): raise ValueError('正式 PDF 暂不支持竖排，请切换横排。')
    blocks,by_id=prepare_blocks(doc)
    journal=doc.get('journal')
    blocks,side_widths=side_groups(blocks,by_id)
    if side_widths and not journal:raise ValueError('图文并排须启用期刊 PDF 模板。')
    def render_math(value):
        tex=safe_math(value)
        if journal and journal.get('mathFont')=='stix-two':
            # Legacy math alphabet commands may select the text font for Greek
            # or request a nonexistent bold face. Unicode math has explicit
            # symbol alphabets; preserve the source style without a fallback.
            alphabets={'mathrm':'symup','mathbf':'symbfup','mathit':'symit','boldsymbol':'symbfit',
                       'mathsf':'symsfup','mathtt':'symtt','mathcal':'symcal','mathbb':'symbb','mathfrak':'symfrak'}
            tex=re.sub(r'\\('+'|'.join(alphabets)+r')\b',lambda m:'\\'+alphabets[m[1]],tex)
        return tex
    def image_asset(image):
        if image.get('vectorSource'):
            from emf import validate_vector_source,digest
            source=image['vectorSource'];raw=base64.b64decode(source['pdf'],validate=True)
            original=base64.b64decode(source['data'],validate=True)
            preview=base64.b64decode(str(image.get('src','')).split(',',1)[-1],validate=True)
            if source.get('format')!='emf' or digest(original)!=source.get('sha256') or digest(raw)!=source.get('pdfSha256') or digest(preview)!=source.get('previewSha256'):raise ValueError('矢量图或原始 EMF/预览摘要不一致。')
            validate_vector_source(source,raw,original)
            name='asset-'+str(len(list(assets_dir.glob('asset-*'))))+'.pdf';(assets_dir/name).write_bytes(raw);return name
        match=re.fullmatch(r'data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)',str(image.get('src','')))
        if not match: raise ValueError('图片必须为内嵌 PNG/JPEG/WebP。')
        raw=base64.b64decode(match[2],validate=True)
        if len(raw)>5*1024*1024: raise ValueError('图片超过 5 MB。')
        ext=match[1]; name='asset-'+str(len(list(assets_dir.glob('asset-*'))))+'.'+ext
        if ext=='webp':
            try:
                from PIL import Image
                from io import BytesIO
                Image.MAX_IMAGE_PIXELS=25000000
                im=Image.open(BytesIO(raw)); im.load(); name=name.rsplit('.',1)[0]+'.png'; im.save(assets_dir/name)
            except ImportError: raise ValueError('WebP 导出需要 Pillow；请改用 PNG/JPEG。')
        else: (assets_dir/name).write_bytes(raw)
        return name
    terms=[str(t) for t in doc.get('indexTerms',[]) if str(t).strip()][:1000]
    index_refs={term:['idx-'+str(ti)+'-'+str(bi) for bi,b in enumerate(blocks) if term in str(b.get('text','')) and b.get('type')!='index'] for ti,term in enumerate(terms)}
    if not isinstance(blocks,list) or len(blocks)>10000: raise ValueError('文档块数量无效。')
    if sum(len(str(b)) for b in blocks)>30000000: raise ValueError('文档过大，请分卷。')
    values={k:number(layout.get(k),d,lo,hi) for k,d,lo,hi in [('width',185,100,450),('height',260,100,500),('top',24,5,80),('bottom',22,5,80),('inner',24,5,80),('outer',20,5,80),('fontSize',11,5,72),('lineHeight',1.8,1,3),('gap',8,2,30),('indent',2,0,6),('pageStart',1,1,9999)]}
    if values['width']-values['inner']-values['outer']<30 or values['height']-values['top']-values['bottom']<40: raise ValueError('页边距过大。')
    cols=int(number(layout.get('columns'),1,1,4))
    active_width=100000;active_block_id=""
    notes={str(n.get('id')):str(n.get('text','')) for n in doc.get('notes',[]) if isinstance(n,dict)}; note_seen=set()
    if journal and journal.get('articleNoteId') and journal['articleNoteId'] not in notes:raise ValueError('首面脚注引用失效。')
    note_numbers={ident:i+1 for i,ident in enumerate(notes)}
    note_markers={str(n.get('id')):escape(str(n.get('marker',note_numbers.get(str(n.get('id')),'')))) for n in doc.get('notes',[]) if isinstance(n,dict)}
    def plain(s,formulas=None,table_notes=None,owner_id=None):
        out=[]; start=0
        for m in re.finditer(r'\[\^([^\]\n]+)\]|\[\[math:([-\w]+)\]\]',s):
            out.append(escape(s[start:m.start()])); ident=m.group(1)
            if m.group(2):
                if m.group(2) not in (formulas or {}): raise ValueError('缺少行内公式定义：'+m.group(2))
                tex=render_math(formulas[m.group(2)]);object_id=(owner_id or active_block_id)+':'+m.group(2)
                punctuation=re.match(r'[，。；：、,.!?;:！？)\]）】]+',s[m.end():])
                if journal and table_notes is None and math_widths and math_widths.get(object_id,0)>min(active_width,(values['width']-values['inner']-values['outer']-values['gap']*(cols-1))/cols*72.27/25.4)*number(journal.get('inlineDisplayThreshold'),.65,.65,.95):
                    suffix=r'\text{'+escape(punctuation[0])+'}' if punctuation else ''
                    start=m.end()+(len(punctuation[0]) if punctuation else 0)
                    # Starting horizontal mode before/after a display creates
                    # empty baseline rows. The semantic markers live inside it.
                    tail=bool(s[start:].strip())
                    out.append((r'\postdisplaypenalty=10000 ' if tail else r'\postdisplaypenalty=0 ')+r'\[\textstyle '+marker(object_id,'start')+math_with_suffix(tex,suffix)+marker(object_id,'end')+r'\]'+(r'\noindent ' if tail else ''))
                else:
                    if journal and table_notes is None:
                        from math_layout import inline_breaks
                        tex=inline_breaks(tex)
                    out.append(r'\allowbreak '+marker(object_id,'start')+r'\('+tex+r'\)'+marker(object_id,'end')+(r'\nobreak ' if punctuation else r'\allowbreak '));start=m.end()
                continue
            if ident in notes:
                if layout.get('notesMode')=='endnote': out.append(r'\textsuperscript{'+note_markers[ident]+'}'); note_seen.add(ident)
                elif table_notes is not None:
                    out.append(r'\textsuperscript{'+note_markers[ident]+'}');table_notes.add(ident);note_seen.add(ident)
                elif ident in note_seen: out.append(r'\textsuperscript{'+note_markers[ident]+'}')
                else:
                    body=escape(notes[ident]);custom=''
                    if journal and journal.get('articleNoteId')==ident:
                        custom=r'\ShuyeArticleNote'
                        lines=[]
                        for line in notes[ident].splitlines():
                            line=line.strip()
                            label=re.match(r'^([*＊]?(?:收稿日期|基金项目|作者简介|通讯作者|通信作者)[：:])\s*',line)
                            if label:line_tex=r'\makebox[5.5em][l]{\textbf{'+escape(label[1])+'}}'+escape(line[len(label[0]):])
                            else:line_tex=r'\hspace*{5.5em}'+escape(line)
                            lines.append(r'\noindent\hangindent=5.5em\hangafter=1 '+line_tex+r'\par')
                        body=''.join(lines)
                    body=marker('note:'+ident,'start')+body+marker('note:'+ident,'end')
                    out.append(r'\begingroup'+custom+r'\renewcommand{\thefootnote}{'+note_markers[ident]+r'}\footnote['+str(note_numbers[ident])+']{'+body+r'}\endgroup{}');note_seen.add(ident)

            else: out.append(escape(m.group(0))); warnings.append('缺少脚注内容：'+ident)
            start=m.end()
        out.append(escape(s[start:])); return ''.join(out)
    def styled(b,table_notes=None):
        s=str(b.get('text','')); marks=b.get('marks',[])
        if journal and journal.get('normalizeTypography',True):marks=[{k:v for k,v in m.items() if k not in ('fontFamily','fontSize')} for m in marks];marks=[m for m in marks if len(m)>2]
        # UTF-16 boundaries matching JavaScript; never split surrogate pairs.
        offsets=[0]
        for c in s: offsets.append(offsets[-1]+len(c.encode('utf-16-le'))//2)
        ruby=b.get('ruby',[])
        if ruby:
            if not isinstance(ruby,list) or len(ruby)>10000: raise ValueError('注音数据无效或过多。')
            spans=[]
            for item in ruby:
                try:
                    a=offsets.index(item['start']);z=offsets.index(item['end']);reading=item['text']
                except (KeyError,ValueError,TypeError): raise ValueError('注音必须使用有效 UTF-16 字符边界。')
                if a>=z or not isinstance(reading,str) or not reading.strip() or len(reading)>1000 or '\n' in reading: raise ValueError('注音范围或文字无效。')
                if '\n' in s[a:z]: raise ValueError('注音不能跨越换行。')
                if any(a<m.end() and z>m.start() for m in re.finditer(r'\[\^[^\]\n]+\]|\[\[math:([-\w]+)\]\]',s)): raise ValueError('注音不能覆盖脚注标记。')
                spans.append((a,z,reading))
            spans.sort()
            if any(spans[i][0]<spans[i-1][1] for i in range(1,len(spans))): raise ValueError('注音范围不能重叠。')
            def segment(a,z):
                lo,hi=offsets[a],offsets[z]
                inner=[{**m,'start':max(lo,m.get('start',0))-lo,'end':min(hi,m.get('end',0))-lo} for m in marks if m.get('start',0)<hi and m.get('end',0)>lo]
                return styled({**b,'text':s[a:z],'marks':inner,'ruby':[]},table_notes)
            chunks=[];pos=0
            for a,z,reading in spans:
                if a>pos:chunks.append(segment(pos,a))
                chunks.append(r'\ruby{'+segment(a,z)+'}{'+escape(reading)+'}');pos=z
            if pos<len(s):chunks.append(segment(pos,len(s)))
            return ''.join(chunks)
        boundaries={0,len(s)}
        converted=[]
        for m in marks:
            try: a=offsets.index(int(m['start'])); z=offsets.index(int(m['end']))
            except (KeyError,ValueError,TypeError): warnings.append('无效逐字样式范围已忽略。'); continue
            if a<z: boundaries.update((a,z)); converted.append((a,z,m))
        for ref in re.finditer(r'\[\^[^\]\n]+\]|\[\[math:([-\w]+)\]\]',s):
            boundaries={x for x in boundaries if not ref.start()<x<ref.end()}
            if ref[0].startswith('[^'):boundaries.update((ref.start(),ref.end()))
        result=[]; ends=sorted(boundaries)
        for a,z in zip(ends,ends[1:]):
            style={}
            for x,y,m in converted:
                if x<=a and z<=y: style.update(m)
            t=plain(s[a:z],{m['id']:m['text'] for m in b.get('inlineMath',[])},table_notes,owner_id=b.get('id'))
            # Word formats footnote-reference runs as superscripts. The TeX
            # footnote already owns its marker; nesting its paragraph body in
            # textsuper/subscript either doubles the rise or breaks compilation.
            if re.fullmatch(r'\[\^[^\]\n]+\]',s[a:z]):result.append(t);continue
            for key,cmd in [('bold','textbf'),('italic','textit'),('underline','uline'),('superscript','textsuperscript'),('subscript','textsubscript')]:
                if style.get(key): t='\\'+cmd+'{'+t+'}'
            if style.get('bold') is False: t=r'\textmd{'+t+'}'
            if style.get('italic') is False: t=r'\textup{'+t+'}'
            if re.fullmatch(r'#[0-9a-fA-F]{6}',str(style.get('color',''))): t=r'\textcolor[HTML]{'+style['color'][1:]+'}{'+t+'}'
            if style.get('fontFamily') in ('serif','sans','kai'): t='{'+{'serif':r'\rmfamily ','sans':r'\sffamily ','kai':r'\kaifamily '}[style['fontFamily']]+t+'}'
            if 'fontSize' in style:
                size=number(style['fontSize'],11,5,72); t=r'{\fontsize{'+str(size)+'}{'+str(size*1.3)+r'}\selectfont '+t+'}'
            result.append(t)
        return ''.join(result)
    pre=r'''\documentclass[twoside,UTF8,fontset=SHUYEFONTSET]{ctexart}
\usepackage{geometry,fontspec,graphicx,longtable,array,booktabs,amsmath,amssymb,fancyhdr,multicol,xcolor,multirow,needspace}
\usepackage[normalem]{ulem}
\usepackage[latin,nooverlap]{ruby}
\newCJKfontfamily\kaifamily{SHUYEKAI}
% Latin Modern text lacks Greek. Preserve the original Unicode code point and
% existing text font whenever it has the glyph (e.g. Times). A text-font fallback
% keeps units upright and avoids silently turning micromoles into moles.
\newfontfamily\ShuyeSymbolFont[BoldFont=FandolSong-Bold.otf,ItalicFont=FandolKai-Regular.otf,BoldItalicFont=FandolKai-Regular.otf]{FandolSong-Regular.otf}
\DeclareRobustCommand{\ShuyeTextSymbol}[2]{\iffontchar\font"#1\relax#2\else{\ShuyeSymbolFont #2}\fi}
\newlength{\ShuyeTableWidth}
\newsavebox{\ShuyeSideBox}
\newsavebox{\ShuyeCellBox}
\usepackage[unicode,hidelinks]{hyperref}
\setcounter{secnumdepth}{0}
\setcounter{tocdepth}{4}
\clubpenalty=10000
\widowpenalty=10000
\raggedbottom
\maxbalancingoverflow=0pt
\setcounter{tracingmulticols}{2}
\setlength{\emergencystretch}{2em}
% Paragraph style groups must not restore the one-shot after-heading hook.
% Otherwise every later paragraph is treated as the first after the heading,
% and whole text/table sequences become unnecessarily inseparable.
\makeatletter
\newcommand{\ShuyeArticleNote}{\long\def\@makefntext##1{##1}}
\newcommand{\ShuyeAfterParagraph}{\if@nobreak\@nobreakfalse\everypar{}\fi}
\makeatother
% fancyhdr is activated after geometry so it uses the actual paper width.
\renewcommand{\headrulewidth}{0.3pt}
\setlength{\headheight}{18pt}
'''
    if journal and 'headSepMm' in journal:pre+=r'\setlength{\headsep}{'+str(number(journal['headSepMm'],3,2,12))+'mm}\n'
    pre+=r'\geometry{paperwidth='+str(values['width'])+'mm,paperheight='+str(values['height'])+'mm,top='+str(values['top'])+'mm,bottom='+str(values['bottom'])+'mm,inner='+str(values['inner'])+'mm,outer='+str(values['outer'])+'mm}\n'
    pre=pre.replace('SHUYEFONTSET','none' if font_set=='source-han' else font_set).replace('SHUYEKAI',{'windows':'KaiTi','mac':'Kaiti SC','fandol':'FandolKai-Regular.otf','source-han':'FandolKai-Regular.otf'}[font_set])
    if journal and journal.get('bodyWeight','regular') not in ('regular','light'):raise ValueError('正文字重无效。')
    if journal and journal.get('bodyWeight')=='light' and font_set!='source-han':raise ValueError('轻字重正文须使用思源字体方案。')
    if font_set=='source-han':pre+=r'\setCJKmainfont[BoldFont={Source Han Serif SC Bold}]{Source Han Serif SC}\setCJKsansfont[BoldFont={Source Han Sans SC Bold}]{Source Han Sans SC}'+'\n'
    if journal and journal.get('bodyWeight')=='light':pre=pre.replace(']{Source Han Serif SC}',']{Source Han Serif SC Light}')
    if journal and journal.get('latinFont')=='times':pre+=r'\setmainfont{Times New Roman}'+'\n'
    if journal:
        math_font=journal.get('mathFont','tex-default')
        if math_font not in ('tex-default','stix-two'):raise ValueError('数学字体方案无效。')
        if math_font=='stix-two':pre+=r'\usepackage{unicode-math}\setmathfont{STIX Two Math}'+'\n'
    if journal:
        # ctexart defaults to a 1.3 baseline multiplier. Journal sizes already
        # specify their measured leading; applying that multiplier a second
        # time inflates body/front-matter/table spacing and changes pagination.
        pre+=r'\linespread{1}'+'\n'
        pre+=r'\setlength{\heavyrulewidth}{.75pt}\setlength{\lightrulewidth}{.25pt}'+'\n'
        pre+=r'\setlength{\parskip}{0pt}\setlength{\skip\footins}{5pt}\renewcommand{\footnoterule}{\kern-3pt\hrule width81pt height.3pt\kern2.7pt}'+'\n'
        pre+=r'\makeatletter\renewcommand\footnotesize{\@setfontsize\footnotesize{6.9pt}{8pt}}\makeatother'+'\n'
    if any(b.get('floatPlacement')=='top' for b in blocks):
        pre+=r'\renewcommand{\dbltopfraction}{.9}\renewcommand{\textfraction}{.05}\makeatletter\setlength{\@fptop}{0pt}\setlength{\@dblfptop}{0pt}\makeatother'+'\n'
    pre+=r'\xeCJKDeclareCharClass{CJK}{"2160->"2188,"2103,"2109}'+'\n'
    pre+=r'\pagestyle{fancy}\fancyhf{}\setlength{\headwidth}{\textwidth}'+'\n'
    pre+=r'\fancyhead[LE]{'+escape(layout.get('headerEven',layout.get('header','')))+r'}\fancyhead[RO]{'+escape(layout.get('headerOdd',layout.get('header','')))+'}\n'
    footer=lambda s: r'\thepage{}'.join(escape(part) for part in str(s).split('{page}'))
    pre+=r'\fancyfoot[LE]{'+footer(layout.get('footerEven',layout.get('footer','{page}')))+r'}\fancyfoot[RO]{'+footer(layout.get('footer','{page}'))+'}\n'
    if journal:
        name=escape(journal.get('name',''));name_en=escape(journal.get('nameEn',''))
        volume,issue,year=(escape(journal.get(k,'')) for k in ('volume','issue','year'))
        small=r'\fontsize{6.9}{8.5}\selectfont '
        page_label=r'\thepage' if journal.get('pageNumberStyle','plain')=='plain' else r'·\enspace\thepage\enspace·'
        year+=escape(journal.get('yearSuffix',''))
        pre+=r'\fancyhf{}\fancyhead[LE]{'+small+page_label+r'}\fancyhead[CE]{'+small+name+r'}\fancyhead[RE]{'+small+year+r'}\fancyhead[LO]{'+small+('第'+issue+'期' if issue else '')+r'}\fancyhead[CO]{'+small+escape(journal.get('shortTitle',''))+r'}\fancyhead[RO]{'+small+page_label+r'}'+'\n'
        left=r'\strut '+('第'+volume+'卷' if volume else '')+('第'+issue+'期' if issue else '')+r'\\ '+escape(journal.get('date',''))
        right=r'\strut '+('Vol. '+volume if volume else '')+(' No. '+issue if issue else '')+r'\\ '+escape(journal.get('dateEn') or journal.get('year',''))
        pre+=r'\fancypagestyle{journalfirst}{\fancyhf{}\fancyhead[C]{'+small+r'\parbox[t]{.24\textwidth}{\raggedright '+left+r'}\parbox[t]{.52\textwidth}{\centering '+r'\strut '+name+r'\\ '+name_en+r'}\parbox[t]{.24\textwidth}{\raggedleft '+right+r'}}}'+"\n"
    pre+=r'\setlength{\columnsep}{'+str(values['gap'])+'mm}\n'+r'\setlength{\parindent}{'+str(values['indent'])+'em}\n'
    pre+=r'\begin{document}\setcounter{page}{'+str(int(values['pageStart']))+'}\n'+r'\fontsize{'+str(values['fontSize'])+'}{'+str(values['fontSize']*values['lineHeight'])+r'}\selectfont'+'\n'
    if journal:pre+=r'\allowdisplaybreaks[1]\thispagestyle{journalfirst}\setlength{\emergencystretch}{3em}\setlength{\abovedisplayskip}{4pt plus 1pt minus 1pt}\setlength{\belowdisplayskip}{4pt plus 1pt minus 1pt}\setlength{\abovedisplayshortskip}{3pt}\setlength{\belowdisplayshortskip}{3pt}\setlength{\multicolsep}{5pt}'+'\n'
    # Measure at the actual body size. A subsequent compile uses the measurements
    # to promote oversized inline/display mathematics to full-width blocks.
    if journal:
        for b in doc.get('blocks',[]):
            formulas=([{'id':b.get('id'),'text':b.get('text','')}] if b.get('type')=='equation' else b.get('inlineMath',[]))
            for m in formulas:
                if not re.fullmatch(r'[-\w]{1,80}',str(m.get('id',''))):continue
                measure_id=m['id'] if b.get('type')=='equation' else b.get('id','')+':'+m['id']
                pre+=r'\setbox0=\hbox{$'+(r'\displaystyle ' if b.get('type')=='equation' else '')+render_math(m['text'])+r'$}\typeout{SHUYEWIDTH:'+measure_id+r':\the\wd0}'+'\n'
    content=[]; incols=False
    def columns(on,minimum=50):
        nonlocal incols
        if cols>1 and on!=incols: content.append(r'\begin{multicols}{'+str(cols)+r'}[]['+str(round(minimum,2))+r'pt]\raggedcolumns' if on else r'\end{multicols}'); incols=on
    if not journal:columns(True)
    planned=[]
    for source_index,b in enumerate(blocks):
        inline=b.get('inlineMath',[])
        if journal and b.get('type')=='paragraph' and not b.get('role') and len(inline)==1:
            m=inline[0]
            continuation_match=re.fullmatch(r'\s*([=<>≤≥])\s*\[\[math:'+re.escape(m['id'])+r'\]\]\s*([,，.。;；]?)\s*',b.get('text',''))
            if continuation_match:
                prefix={'≤':r'\le ','≥':r'\ge '}.get(continuation_match[1],continuation_match[1])
                ident=b['id']+':'+m['id']
                if math_widths:math_widths={**math_widths,b['id']:math_widths.get(ident,0)+values['fontSize']}
                b={**b,'type':'equation','text':prefix+m['text'],'equationSuffix':continuation_match[2],'inlineMath':[],'_inlineDisplayId':ident}
        # Word sometimes stores an isolated relation sign between two display
        # objects as a text paragraph. Keep its object ID and visible token,
        # but include it in the display run so column balancing cannot detach it.
        if journal and 0<source_index<len(blocks)-1 and b.get('type')=='paragraph' and not b.get('role') and b.get('text','').strip() in ('=','<','>','≤','≥') and blocks[source_index-1].get('type')=='equation' and blocks[source_index+1].get('type')=='equation':
            b={**b,'type':'equation','text':b['text'].strip()}
        if journal and math_widths:
            col_width=(values['width']-values['inner']-values['outer']-values['gap']*(cols-1))/cols*72.27/25.4
            full_width=(values['width']-values['inner']-values['outer'])*72.27/25.4
            if b.get('id') in side_widths:
                full_width=full_width*(1-side_widths[b['id']]/100)-3*72.27/25.4;col_width=full_width
            widest=max([math_widths.get(b.get('id','')+':'+m['id'],0) for m in b.get('inlineMath',[])]+[math_widths.get(b.get('id'),0)])
            if b.get('type')=='equation' and widest>col_width-24:b={**b,'placement':'full-width'}
            elif b.get('type')=='paragraph' and widest>col_width-16:b={**b,'fullWidth':True}
            if widest>full_width-24:
                from math_layout import break_formula
                if b.get('type')=='equation':b={**b,'text':break_formula(b['text'],width_ratio=(full_width-24)/widest)}
                else:b={**b,'inlineMath':[{**m,'text':break_formula(m['text'],False,width_ratio=(full_width-24)/math_widths[b.get('id','')+':'+m['id']]) if math_widths.get(b.get('id','')+':'+m['id'],0)>full_width-24 else m['text']} for m in b.get('inlineMath',[])]}
        planned.append(b)
    # Consecutive equation rows must keep one measure. Switching back to columns
    # between an identity and its continuation separates the proof visually.
    index=0
    while index<len(planned):
        if planned[index].get('type')!='equation':index+=1;continue
        end=index+1
        while end<len(planned) and planned[end].get('type')=='equation':end+=1
        if any(row.get('placement')=='full-width' for row in planned[index:end]):
            for i in range(index,end):planned[i]={**planned[i],'placement':'full-width'}
        index=end
    # A heading must share the column measure of the text it introduces.
    # Otherwise multicols balances it into an isolated right-hand heading.
    for i in range(len(planned)-2,-1,-1):
        following=planned[i+1]
        if journal and planned[i].get('type')=='paragraph' and not planned[i].get('role') and following.get('type')=='equation' and following.get('placement')=='full-width':
            planned[i]={**planned[i],'fullWidth':True}
        if journal and planned[i].get('type')=='heading' and not planned[i].get('role') and (following.get('fullWidth') or following.get('placement')=='full-width'):
            planned[i]={**planned[i],'fullWidth':True}
    blocks=planned
    # A deferred body figure must never interrupt the reference list. Include
    # its explicit heading in the boundary, so the heading stays with item 1.
    reference_start=None
    if journal and any(b.get('floatPlacement')=='top' for b in blocks):
        reference_start=next((i for i,b in enumerate(blocks) if b.get('role')=='reference'),None)
        if reference_start and re.fullmatch(r'(?:参考文献|References)\s*[:：]?',blocks[reference_start-1].get('text','').strip(),re.I):reference_start-=1
    paragraph_open=False;side=None
    for block_num,b in enumerate(blocks):
        if block_num==reference_start:
            columns(False)
            # No forced page break when the float queues are already empty.
            content.append(r'\makeatletter\ifx\@deferlist\@empty\ifx\@dbldeferlist\@empty\else\clearpage\fi\else\clearpage\fi\makeatother')
        if b['type']=='sideStart':
            columns(False);side={'image':b['image'],'start':len(content)};continue
        if b['type']=='sideEnd':
            body='\n'.join(content[side['start']:side['split']]);graphic='\n'.join(content[side['split']:]);del content[side['start']:]
            fraction=side['image']['width']/100
            text_width=r'\dimexpr '+str(1-fraction)+r'\linewidth-3mm\relax'
            left=r'\begin{minipage}[t]{'+text_width+r'}\vspace{0pt}\setlength{\parindent}{'+str(values['indent'])+r'em}'+body+r'\end{minipage}'
            right=r'\begin{minipage}[t]{'+str(fraction)+r'\linewidth}\vspace{0pt}'+graphic+r'\end{minipage}'
            if side['image']['wrap']=='left':left,right=right,left
            content.append(r'\par\setbox\ShuyeSideBox=\vbox{\noindent '+left+r'\hspace{3mm}'+right+r'\par}'+
                r'\ifdim\dimexpr\ht\ShuyeSideBox+\dp\ShuyeSideBox\relax>\textheight\PackageError{shuye}{Side-by-side group exceeds page height}{Reduce the selected text range or use a full-width figure.}\fi'+
                r'\noindent\usebox{\ShuyeSideBox}\par\smallskip')
            side=None;continue
        if b.get('_sideImage'):
            if paragraph_open:raise ValueError('并排范围不能截断公式引导段。')
            side['split']=len(content)
            b={**b,'width':100,'wrap':'none'}
        role=b.get('role');front=bool(journal and role in FRONT_ROLES)
        floating=b.get('floatPlacement')=='top'
        if floating and (not journal or cols<2 or b.get('placement')!='full-width' or b.get('type') not in ('image','table') or side):raise ValueError('页顶浮动仅支持期刊双栏中的通栏图或短表。')
        heading_space=values['fontSize']*values['lineHeight']*4
        if b.get('type')=='heading' and not front:
            column_pt=(values['width']-values['inner']-values['outer']-values['gap']*(cols-1))/cols*72.27/25.4
            heading_space=values['fontSize']*values['lineHeight']*3
            for heading in blocks[block_num:]:
                if heading.get('type')!='heading':break
                lev=int(number(heading.get('level'),1,1,4));size=number(heading.get('fontSize'),([10,9,8.5,8.2][lev-1] if journal else values['fontSize']*(1.8-lev*.2)),5,72)
                lines=max(1,math.ceil(sum(size if ord(c)>127 else size*.6 for c in heading.get('text',''))/column_pt))
                heading_space+=lines*size*1.3+(6 if journal else size*3)
            heading_space=min(heading_space,(values['height']-values['top']-values['bottom'])*72.27/25.4*.9)
        if not side:columns(not front and not b.get('fullWidth',False) and (b.get('placement')!='full-width' or floating),heading_space)
        if floating:content.append(r'\begin{figure*}[tp]')
        block_labels=marker(b.get('id'),'start')
        for term_num,term in enumerate(terms):
            if term in str(b.get('text','')) and b.get('type')!='index':
                label='idx-'+str(term_num)+'-'+str(block_num); block_labels+=r'\phantomsection\label{'+label+'}'
        active_block_id=b.get('id','')
        active_width=(values['width']-values['inner']-values['outer']-(values['gap']*(cols-1) if incols else 0))/(cols if incols else 1)*72.27/25.4
        if side:active_width=active_width*(side['image']['width']/100 if b.get('_sideImage') else 1-side['image']['width']/100)-(0 if b.get('_sideImage') else 3*72.27/25.4)
        typ=b.get('type')
        formulas=b.get('inlineMath',[]);formula_ids=[m.get('id') for m in formulas]
        if formulas and typ not in ('paragraph','heading','table'): raise ValueError('该类型不能使用行内公式。')
        if len(formula_ids)!=len(set(formula_ids)): raise ValueError('行内公式 ID 重复。')
        tokens=[m.group(1) for value in [str(b.get('text',''))]+[str(c) for row in b.get('rows',[]) for c in row] for m in re.finditer(r'\[\[math:([-\w]+)\]\]',value)]
        if sorted(tokens)!=sorted(formula_ids) or len(tokens)!=len(set(tokens)): raise ValueError('行内公式标记与定义不一致。')
        formula_map={m['id']:m['text'] for m in formulas}
        table_notes=set() if typ=='table' else None
        if b.get('ruby') and typ not in ('paragraph','heading'): raise ValueError('正式 PDF 仅支持正文和标题块的注音。')
        text='' if typ in ('paragraph','heading') else plain(b.get('text',''),formula_map,table_notes) if typ=='table' else escape(b.get('text',''))
        if typ in ('paragraph','heading'):
            if journal and role in ROLE_STYLE:
                size,leading,alignment,bold=ROLE_STYLE[role]
                custom=journal.get('roleStyles',{}).get(role,{})
                render_source=b
                size=number(custom.get('fontSize'),size,6,24);leading=number(custom.get('leading'),leading,7,36)
                if 'bold' in custom:
                    if not isinstance(custom['bold'],bool):raise ValueError('角色字重无效。')
                    bold=custom['bold'];render_source={**b,'marks':[{k:v for k,v in m.items() if k!='bold'} for m in b.get('marks',[])]}
                family=custom.get('fontFamily','serif')
                if family not in ('serif','sans'):raise ValueError('角色字体无效。')
                family_cmd=r'\sffamily ' if family=='sans' else ''
                align_cmd={'center':r'\centering ','left':r'\raggedright ','justify':''}[alignment]
                indent=r'\setlength{\parindent}{13.8pt}' if role in ('abstract-zh','keywords-zh','abstract-en','keywords-en') else r'\setlength{\parindent}{0pt}'
                if role in ('abstract-zh','keywords-zh'):indent+=r'\leftskip=16pt '
                before=number(custom.get('spaceBefore'),4 if role.startswith('title') else 0,0,36)
                after=number(custom.get('spaceAfter'),0,0,24)
                gap=r'\addvspace{'+str(before)+'pt}' if before else ''
                if role=='reference':
                    indent=r'\setlength{\parindent}{0pt}\hangindent=7mm\hangafter=1 '
                    # Keep styled source bytes/marks intact; only box the visible
                    # numeric label so first and continuation lines align.
                    label=re.match(r'^(\[[0-9]+\]|［[0-9]+］)\s*',b.get('text',''))
                    if label and not b.get('inlineMath') and not b.get('ruby'):
                        cut=len(label[0].encode('utf-16-le'))//2
                        marks=[{**m,'start':max(cut,m['start'])-cut,'end':m['end']-cut} for m in render_source.get('marks',[]) if m.get('end',0)>cut]
                        text=r'\makebox[7mm][l]{'+escape(label[1])+'}'+styled({**render_source,'text':b['text'][len(label[0]):],'marks':marks})
                # Rendering notes is stateful. Style overrides must not render
                # and discard the first copy, consuming the only footnote body.
                if not text:text=styled(render_source)
                if role=='classification':text=re.sub(r' {2,}',lambda _:r'\hspace{6em}',text)
                content.append(r'\par'+gap+'{'+align_cmd+family_cmd+indent+r'\fontsize{'+str(size)+'}{'+str(leading)+r'}\selectfont '+(r'\bfseries ' if bold else '')+r'\leavevmode '+block_labels+text+marker(b.get('id'),'end')+r'\par}\ShuyeAfterParagraph'+(r'\addvspace{'+str(after)+'pt}' if after else ''))
                continue
            text=styled(b)
            if typ=='heading':
                lev=int(number(b.get('level'),1,1,4));command=['section','subsection','subsubsection','paragraph'][lev-1]
                size=number(b.get('fontSize'),([10,9,8.5,8.2][lev-1] if journal else values['fontSize']*(1.8-lev*.2)),5,72)
                fmt=r'\normalfont\bfseries '+(r'\sffamily ' if journal and journal.get('headingFamily')=='sans' else '')+{'serif':r'\rmfamily ','sans':r'\sffamily ','kai':r'\kaifamily '}.get(None if journal and journal.get('headingFamily')=='sans' else b.get('fontFamily'),'')
                fmt+={'left':r'\raggedright ','right':r'\raggedleft ','center':r'\centering '}.get(b.get('align'),'')
                fmt+=r'\fontsize{'+str(size)+'}{'+str(size*1.5)+r'}\selectfont '
                spacing=',beforeskip=4pt,afterskip=2pt' if journal else ''
                # Section commands install an after-heading paragraph hook. A
                # surrounding group discards that hook before the following
                # paragraph and permits an orphan heading during column balance.
                short_title=re.sub(r'\\special\{pdf:dest [^}]+\}','',text)
                # The first heading reserves space for the entire chain. A
                # second needspace inserts a legal break between the headings.
                previous_heading=block_num>0 and blocks[block_num-1].get('type')=='heading' and not blocks[block_num-1].get('role')
                # On a normal page use the exact remaining-height check. The
                # approximate needspace adds stretch at the heading and can
                # make a half-empty page cheaper than a later paragraph break.
                space_command=r'\needspace{' if incols else r'\Needspace{'
                # multicol collects a whole page before splitting columns. The
                # stretch inserted by needspace gives it an artificially cheap
                # break before a heading, leaving large holes on both columns.
                # ctex's after-heading hook + club penalty keeps the first body
                # lines; use the measured reserve only outside multicol.
                reserve='' if previous_heading or incols else space_command+str(round(heading_space,2))+r'pt}'
                content.append(reserve+r'\ctexset{'+command+'={format={'+fmt+'}'+spacing+'}}'+chr(92)+command+'['+short_title+']{'+block_labels+text+marker(b.get('id'),'end')+'}');continue
            style=''
            if journal and formulas:
                # Dense inline math offers few stretchable text spaces. TeX's
                # emergency pass otherwise prefers an overfull single line to
                # a legal, shorter line. This changes break selection only;
                # it neither scales glyphs nor adds space to the final measure.
                style+=r'\setlength{\emergencystretch}{.5\linewidth}'
            if 'indentPt' in b: style+=r'\setlength{\parindent}{'+str(number(b['indentPt'],0,0,200))+'pt}'
            elif 'indent' in b: style+=r'\setlength{\parindent}{'+str(number(b['indent'],2,0,20))+'em}'
            if b.get('bold'): style+=r'\bfseries '
            style+= {'serif':r'\rmfamily ','sans':r'\sffamily ','kai':r'\kaifamily '}.get(b.get('fontFamily'),'')
            size=number(b.get('fontSize'),values['fontSize'],5,72); style+=r'\fontsize{'+str(size)+'}{'+str(size*values['lineHeight'])+r'}\selectfont '
            style+= {'left':r'\raggedright ','right':r'\raggedleft ','center':r'\centering '}.get(b.get('align'),'')
            # A vertical destination between a heading's no-break penalty and
            # paragraph glue creates a new legal column break. Put text markers
            # on the actual first line; displays already manage their own mode.
            enter='' if re.match(r'(?:\\postdisplaypenalty=\d+\s*)?\\\[',text.lstrip()) else r'\leavevmode '
            follows_equation=block_num+1<len(blocks) and blocks[block_num+1].get('type')=='equation'
            # A source paragraph and its following display are separate model
            # objects, but need not be separate TeX paragraphs. Closing the
            # paragraph first creates a phantom baseline and weakens the
            # display's native keep-with-introduction penalty. Bridge only a
            # single-column, normal-body-size run, without crossing column or
            # font-style boundaries. Both semantic object IDs remain intact.
            same_measure=cols==1 or not incols and blocks[block_num+1].get('placement')=='full-width' if follows_equation else False
            paragraph_open=bool(journal and same_measure and follows_equation and size==values['fontSize'] and not b.get('bold') and b.get('fontFamily','serif')=='serif')
            ending='' if paragraph_open else r'\par}\ShuyeAfterParagraph'
            content.append('{'+style+enter+block_labels+text+marker(b.get('id'),'end')+ending)
            if journal and not incols and follows_equation and not paragraph_open:content.append(r'\nopagebreak[4]')
        elif typ=='pageBreak': columns(False); content.append(r'\newpage'); columns(True)
        elif typ=='equation':
            if not side and b.get('placement')=='full-width':columns(False)
            equation=render_math(b.get('text',''))
            number_text=b.get('equationNumber','');suffix=(r'\text{'+escape(b['equationSuffix'])+'}') if b.get('equationSuffix') else ''
            from math_layout import continues_equation,starts_relation
            continuation=bool(journal and block_num+1<len(blocks) and blocks[block_num+1].get('type')=='equation' and (continues_equation(b.get('text','')+b.get('equationSuffix','')) or starts_relation(blocks[block_num+1].get('text',''))))
            previous_display=bool(journal and block_num and blocks[block_num-1].get('type')=='equation')
            next_display=bool(journal and block_num+1<len(blocks) and blocks[block_num+1].get('type')=='equation')
            expression=block_labels+marker(b.get('_inlineDisplayId'),'start')+math_with_suffix(equation,suffix)+(r'\tag{'+escape(number_text)+'}' if number_text else '')+marker(b.get('_inlineDisplayId'),'end')+marker(b.get('id'),'end')
            if previous_display or next_display:
                # One display run eliminates phantom text baselines between
                # adjacent source equations. Rows retain their own destinations
                # and tags, and may break pages except across a continued relation.
                if not previous_display:content.append(r'\postdisplaypenalty=0 \begin{gather*}')
                content.append(expression+(r'\\*' if continuation else r'\\') if next_display else expression+r'\end{gather*}')
                if not next_display and paragraph_open:content.append(r'\par}\ShuyeAfterParagraph');paragraph_open=False
            else:
                content.append((r'\postdisplaypenalty=10000 ' if continuation else r'\postdisplaypenalty=0 ')+r'\begin{equation*}'+expression+r'\end{equation*}')
                if paragraph_open:content.append(r'\par}\ShuyeAfterParagraph');paragraph_open=False
                if continuation:content.append(r'\nopagebreak[4]')
        elif typ=='image':
            if not side and not floating and b.get('placement')=='full-width':columns(False)
            if b.get('wrap','none')!='none': raise ValueError('PDF 图文并排必须显式提供 sideTextIds 正文范围，不能静默丢弃环绕设置。')
            name=image_asset(b)
            width=number(b.get('width'),80,1,100)/100
            captions=''.join(marker(c,'start')+styled(by_id[c])+marker(c,'end')+r'\par ' for c in b.get('captionIds',[]))
            content.append(r'\par\noindent\begin{minipage}{\linewidth}\centering '+block_labels+r'\includegraphics[width='+str(width)+r'\linewidth,height=.75\textheight,keepaspectratio]{'+name+'}'+r'\par\vspace{2mm}{\fontsize{7}{9}\selectfont '+(r'\bfseries ' if journal and journal.get('captionBold') else '')+text+r'\par '+captions+'}'+marker(b.get('id'),'end')+r'\end{minipage}\par\smallskip')
        elif typ=='table':
            rows=b.get('rows',[])
            caption_below=b.get('captionPosition','above')=='below'
            caption_text=''.join(marker(c,'start')+styled(by_id[c],table_notes)+marker(c,'end')+r'\par ' for c in b.get('captionIds',[]))
            if caption_text:text=(text+r'\par ' if text else '')+caption_text
            cell_styles={(c['row'],c['col']):c['marks'] for c in b.get('cellMarks',[])}
            def cell_plain(r,c):
                value=styled({'id':b.get('id'),'text':str(rows[r][c]),'marks':cell_styles.get((r,c),[]),'inlineMath':b.get('inlineMath',[])},table_notes) if cell_styles.get((r,c)) else plain(str(rows[r][c]),formula_map,table_notes)
                # Permit TeX's ordinary word hyphenation for the first word in
                # a p-column as well (e.g. an English scientific table header).
                return r'\hspace{0pt}'+value if re.match(r'[A-Za-z]',str(rows[r][c]).lstrip()) else value
            cell_images={}
            for entry in b.get('cellImages',[]):cell_images.setdefault((entry['row'],entry['col']),[]).append(by_id[entry['imageId']])
            def cell_text(r,c):
                images=''.join(marker(image['id'],'start')+r'\includegraphics[width='+str(number(image.get('width'),100,10,100)/100)+r'\linewidth]{'+image_asset(image)+'}'+marker(image['id'],'end')+r'\par ' for image in cell_images.get((r,c),[]))
                return (r'\begin{minipage}[t]{\linewidth}\centering '+images+cell_plain(r,c)+r'\end{minipage}') if images else cell_plain(r,c)
            placement=b.get('placement','auto')
            if placement not in ('auto','column','full-width'): raise ValueError('表格位置无效。')
            in_column=cols>1 and (placement=='column' or (placement=='auto' and len(rows)<=10 and max(map(len,rows),default=0)<=4))
            if not in_column and not floating: columns(False)
            if not rows: warnings.append('空表格已忽略。'); columns(True); continue
            if len(rows)>5000 or max(map(len,rows))>50: raise ValueError('表格过大。')
            n=max(map(len,rows)); heads=min(len(rows),int(number(b.get('headerRows'),1,0,len(rows)))); grid=b.get('borderStyle','grid')=='grid'
            raw_widths=b.get('columnWidths') or [1]*n
            if len(raw_widths)!=n: raise ValueError('表格列宽数量与列数不一致。')
            widths=[number(v,1,.001,10000) for v in raw_widths]; total=sum(widths);widths=[v/total for v in widths]
            def cell_width(col,span=1): return r'\dimexpr '+str(round(sum(widths[col:col+span]),7))+r'\ShuyeTableWidth-2\tabcolsep-2\arrayrulewidth\relax'
            table_fraction=number((journal or {}).get('tableWidthPercent'),100,70,100)/100
            cell_align='>{'+{'center':r'\centering', 'right':r'\raggedleft'}.get(b.get('align'),r'\raggedright')+r'\arraybackslash}'
            spec=('|' if grid else '')+''.join(cell_align+'p{'+cell_width(j)+'}'+('|' if grid else '') for j in range(n))
            merged={}; anchors={}; joined_after=set()
            for merge in b.get('merges',[]):
                r,c,rs,cs=[merge.get(k) for k in ('row','col','rowspan','colspan')]
                if any(not isinstance(v,int) or isinstance(v,bool) for v in (r,c,rs,cs)) or r<0 or c<0 or rs<1 or cs<1 or r+rs>len(rows) or c+cs>n: raise ValueError('合并单元格范围无效。')
                for rr in range(r,r+rs):
                    for cc in range(c,c+cs):
                        if (rr,cc) in merged: raise ValueError('合并单元格不能重叠。')
                        merged[rr,cc]=(r,c,rs,cs)
                anchors[r,c]=(rs,cs); joined_after.update(range(r,r+rs-1))
            original_heads=heads
            while heads and heads-1 in joined_after: heads+=1
            if heads!=original_heads: warnings.append('合并单元格跨越表头边界，重复表头已扩展至第 '+str(heads)+' 行。')
            # A TeX strut height excludes its depth. Using a whole line as the
            # height adds the depth again, inflating every short table row.
            table_leading=values['fontSize']*(1.25 if journal else values['lineHeight'])
            row_heights=[table_leading*.7 if journal else values['fontSize']*1.5 for row in rows]
            for (r,c),(rs,cs) in anchors.items():
                if rs==1:continue # Horizontal cells get their natural p-column height.
                contents='\n'.join(str(rows[rr][cc]) for rr in range(r,r+rs) for cc in range(c,c+cs) if cc<len(rows[rr]) and str(rows[rr][cc]))
                available=((values['width']-values['inner']-values['outer']-values['gap']*(cols-1))/cols if in_column else values['width']-values['inner']-values['outer'])*table_fraction*72/25.4*sum(widths[c:c+cs])-12
                chars=max(1,available/values['fontSize']); lines=sum(max(1,math.ceil(len(line)/chars)) for line in contents.split('\n'))
                needed=(lines+1)*values['fontSize']*values['lineHeight']
                for rr in range(r,r+rs): row_heights[rr]=max(row_heights[rr],needed/rs)
                if needed>(values['height']-values['top']-values['bottom'])*72/25.4: warnings.append('表格合并组可能超过一页，请拆分合并组；PDF 不会拆分该组。')
            group_start=0
            for ri in range(len(rows)):
                if ri not in joined_after:
                    if ri>group_start and sum(row_heights[group_start:ri+1])>(values['height']-values['top']-values['bottom'])*72/25.4:
                        warnings.append('连接的跨行合并组高于版心，请拆分；不能保证该组完整落在一页内。')
                    group_start=ri+1
            def render(ri):
                cells=[];j=0
                while j<n:
                    merge=merged.get((ri,j)); span=merge[3] if merge and j==merge[1] else 1
                    if merge:
                        r,c,rs,cs=merge
                        if j!=c: j+=1;continue
                        t=r'\newline '.join(cell_text(rr,cc) for rr in range(r,r+rs) for cc in range(c,c+cs) if cc<len(rows[rr]) and (str(rows[rr][cc]) or (rr,cc) in cell_images)) if ri==r else ''
                        if ri==r and rs>1: t=r'\multirow[t]{'+str(rs)+'}{'+cell_width(c,cs)+'}{'+t+'}'
                        if cs>1: t=r'\multicolumn{'+str(cs)+'}{'+('|' if grid else '')+cell_align+'p{'+cell_width(c,cs)+'}'+('|' if grid else '')+r'}{\leavevmode '+(block_labels if ri==0 and j==0 and (not text or caption_below) else '')+(r'\rule{0pt}{'+str(round(row_heights[ri],2))+'pt}' if j==0 else '')+t+'}'
                    else: t=cell_text(ri,j) if j<len(rows[ri]) else ''
                    # A phantom strut distributes space for long merged-cell text.
                    if j==0 and not (merge and span>1): t=r'\rule{0pt}{'+str(round(row_heights[ri],2))+'pt}'+t
                    # Enter horizontal mode before PDF destinations/penalties.
                    # Otherwise math-only p-cells acquire an empty first baseline.
                    cells.append(t if merge and span>1 else r'\leavevmode '+(block_labels if ri==0 and j==0 and (not text or caption_below) else '')+t);j+=span
                suffix=r' \\* ' if ri in joined_after else r' \\ '
                if grid:
                    active={cc for (rr,cc),(r,c,rs,cs) in merged.items() if rr==ri and r+rs-1>ri}
                    runs=[];start=None
                    for cc in range(n+1):
                        if cc<n and cc not in active:
                            if start is None:start=cc
                        elif start is not None:runs.append((start+1,cc));start=None
                    suffix+=''.join(r'\cline{'+str(a)+'-'+str(z)+'}' for a,z in runs)
                return ' & '.join(cells)+suffix
            estimated_height=sum(row_heights)+(len(rows)*table_leading*.3 if journal else 0)+30+16*len(b.get('captionIds',[]))
            table_width_pt=(values['width']-values['inner']-values['outer'])*72.27/25.4*table_fraction
            for ri,row in enumerate(rows):
                extra=0
                for ci,cell in enumerate(row):
                    # Conservative wrapping allowance; very long short tables
                    # retain the breakable longtable path.
                    cell=str(cell);available=max(1,table_width_pt*widths[ci]-14)
                    measured=sum((math_widths or {}).get(b.get('id','')+':'+ident,values['fontSize']*5) for ident in re.findall(r'\[\[math:([-\w]+)\]\]',cell))
                    visible=re.sub(r'\[\[math:([-\w]+)\]\]','',cell)
                    width=sum(values['fontSize']*(1 if ord(c)>127 else .6) for c in visible)+measured
                    extra=max(extra,max(0,math.ceil(width/available)-1)*values['fontSize']*values['lineHeight'])
                estimated_height+=extra
            keep_table=bool(cell_images) or in_column or bool(journal and len(rows)<=10 and estimated_height<(values['height']-values['top']-values['bottom'])*72.27/25.4*.45)
            if floating and not keep_table:raise ValueError('长表不能页顶浮动；请使用随正文排放。')
            if caption_below and not cell_images:raise ValueError('下方题注目前只支持含单元格图片的整组输出。')
            env='tabular' if keep_table else 'longtable'
            if journal:content.append(r'{\fontsize{'+str(values['fontSize'])+'}{'+str(table_leading)+r'}\selectfont ')
            if cell_images:content.append(r'\setbox\ShuyeCellBox=\vbox{')
            if keep_table: content.append(r'\par'+(r'\addvspace{4pt}' if journal else '')+r'\noindent\begin{minipage}{\linewidth}'+(r'\centering ' if journal else ''))
            content.append(r'\setlength{\ShuyeTableWidth}{'+('' if table_fraction==1 else str(table_fraction))+r'\linewidth}'+r'\begin{'+env+'}{'+spec+'}')
            # Explicit spanning title rows avoid longtable's automatic table number.
            # Separate first/continuation heads also work when headerRows is zero.
            def table_head(continued=False):
                if text and not caption_below:
                    title=(re.sub(r'\\special\{pdf:dest [^}]+\}','',text)+'（续）') if continued else block_labels+text
                    caption_style=(r'\fontsize{7}{9}\selectfont '+(r'\bfseries ' if journal.get('captionBold') else '')) if journal else ''
                    content.append(r'\multicolumn{'+str(n)+r'}{@{}c@{}}{\parbox{\ShuyeTableWidth}{\centering '+caption_style+r'\leavevmode '+title+r'}} \\[6pt]')
                content.append(r'\hline' if grid else r'\toprule' if b.get('borderStyle')!='none' else '')
                for ri in range(heads):
                    row=render(ri)
                    if continued:row=re.sub(r'\\special\{pdf:dest [^}]+\}','',row)
                    content.append(row)
                if heads and not grid and b.get('borderStyle')!='none': content.append(r'\midrule')
            table_head()
            if not keep_table:
                content.append(r'\endfirsthead');table_head(True);content.append(r'\endhead')
            content.extend(render(ri) for ri in range(heads,len(rows))); content.append((r'\hline' if grid else r'\bottomrule' if b.get('borderStyle')!='none' else '')+r'\end{'+env+'}')
            if caption_below and text:content.append(r'\par\vspace{2mm}{\centering\fontsize{7}{9}\selectfont '+(r'\bfseries ' if journal and journal.get('captionBold') else '')+text+r'\par}')
            for ident in sorted(table_notes,key=lambda k:note_numbers[k]):
                content.append(r'\par\noindent{\footnotesize '+marker('note:'+ident,'start')+r'\textsuperscript{'+note_markers[ident]+'} '+escape(notes[ident])+marker('note:'+ident,'end')+r'\par}')
            content.append(marker(b.get('id'),'end'))
            if keep_table: content.append(r'\end{minipage}\par\smallskip')
            if cell_images:content.append(r'}\ifdim\dimexpr\ht\ShuyeCellBox+\dp\ShuyeCellBox\relax>\textheight\PackageError{shuye}{Cell image table exceeds page height}{Reduce image width or split the table explicitly.}\fi\noindent\usebox{\ShuyeCellBox}\par')
            elif not keep_table and cols>1: warnings.append('长表格以通栏输出，表格前后恢复双栏。')
            if journal:content.append('}')
        elif typ=='toc': columns(False); content.append(r'\tableofcontents\clearpage'); columns(True)
        elif typ=='index':
            content.append(r'\section*{'+(text or '索引')+'}')
            for term in sorted(terms):
                refs=index_refs[term]
                content.append(escape(term)+r'\quad '+(', '.join(r'\pageref{'+label+'}' for label in refs) if refs else '—')+r'\par')
            warnings.append('索引为近似定位：仅扫描块标题/正文并标记块起始页；跨页段落、跨页表格的中间页及单元格词语不保证收全，出版前需核对。')
        else: warnings.append('未支持块 '+str(typ)+' 已按文字保留。'); content.append(text+r'\par')
        if floating:content.append(r'\end{figure*}')
    columns(False)
    for ident,n in notes.items():
        if ident not in note_seen or layout.get('notesMode')=='endnote':
            if ident not in note_seen: warnings.append('未引用脚注已追加文末：'+ident)
            content.append(r'\par\textbf{注 '+note_markers[ident]+'} '+marker('note:'+ident,'start')+escape(n)+marker('note:'+ident,'end'))
    return pre+'\n'.join(content)+'\n'+r'\end{document}',list(dict.fromkeys(warnings))

def render_pdf(doc, evidence_dir=None):
    exe=shutil.which('xelatex') or (str(TEX_DEFAULT) if TEX_DEFAULT.exists() else None)
    if not exe: raise RuntimeError('未找到 XeLaTeX。请安装 TeX Live/TinyTeX 并加入 PATH。')
    if not _LOCK.acquire(blocking=False): raise RuntimeError('已有 PDF 正在排版，请稍后重试。')
    try:
        if evidence_dir is not None:Path(evidence_dir).mkdir(parents=True,exist_ok=False)
        with (tempfile.TemporaryDirectory(prefix='shuye-pdf-') if evidence_dir is None else nullcontext(str(Path(evidence_dir).resolve()))) as tmp:
            folder=Path(tmp); source,warnings=build_tex(doc,folder); (folder/'book.tex').write_text(source,encoding='utf-8')
            env=os.environ.copy(); env.update({'openin_any':'p','openout_any':'p','shell_escape':'f','TEXMFOUTPUT':tmp,'max_print_line':'1000'})
            for run in range(3 if doc.get('journal') else 2):
                try: result=subprocess.run([exe,'-no-shell-escape','-interaction=nonstopmode','-halt-on-error','-file-line-error','book.tex'],cwd=tmp,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=90,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
                except subprocess.TimeoutExpired: raise RuntimeError('PDF 编译超时，请缩短文稿或检查公式。')
                if run==0 and doc.get('journal') and result.returncode==0:
                    widths={m[1]:float(m[2]) for m in re.finditer(r'SHUYEWIDTH:([A-Za-z0-9_:-]+):([0-9.]+)pt',result.stdout.decode('utf-8',errors='replace'))}
                    source,warnings=build_tex(doc,folder,widths);(folder/'book.tex').write_text(source,encoding='utf-8')
                if result.returncode: raise RuntimeError('PDF 编译失败：'+result.stdout.decode('utf-8',errors='replace')[-2500:])
            log=(folder/'book.log').read_text(encoding='utf-8',errors='replace')
            messages,trials=compile_diagnostics(log)
            if any('Overfull' in line for line in messages): warnings.append('存在超出版心的行或表格，请检查 PDF。')
            if any('Missing character:' in line for line in messages): warnings.append('存在字体缺字，请检查 PDF 并更换字体。')
            if any('LaTeX Font Warning:' in line for line in messages): warnings.append('存在字体形状替代，请核对 PDF 中的粗体、斜体和数学字形。')
            pdf=(folder/'book.pdf').read_bytes()
            from compile_report import compiler_report
            return {'pdf':pdf,'compileMessages':messages,'compileDiagnostics':compiler_report(messages,source,doc),'discardedLayoutTrials':trials,'warnings':list(dict.fromkeys(warnings)),'fontSet':resolve_font_set(doc.get('layout',{})),'objectPositions':read_positions(pdf),'engine':'XeLaTeX','engineVersion':subprocess.run([exe,'--version'],capture_output=True,text=True,timeout=10).stdout.splitlines()[0]}
    finally: _LOCK.release()
