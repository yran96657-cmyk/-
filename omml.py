"""OMML to bounded TeX. Preserve source XML separately; never execute it.

Unsupported semantic properties produce diagnostics instead of disappearing.
Layout-only Word run properties do not change the mathematical expression.
"""
import re
import xml.etree.ElementTree as ET

M='{http://schemas.openxmlformats.org/officeDocument/2006/math}'
W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
SYMBOLS=dict(zip('αβγδεζηθικλμνξπρστυφχψω',
    ['\\'+s+' ' for s in 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi pi rho sigma tau upsilon phi chi psi omega'.split()]))
SYMBOLS.update({'×':r'\times ','÷':r'\div ','≤':r'\leq ','≥':r'\geq ','≠':r'\neq ','∈':r'\in ','∉':r'\notin ','∪':r'\cup ','∩':r'\cap ','∞':r'\infty ','⋮':r'\vdots ','⋯':r'\cdots ','…':r'\ldots ','⋱':r'\ddots ','−':'-','→':r'\to ','∂':r'\partial ','∇':r'\nabla ','∅':r'\emptyset ','∀':r'\forall ','∃':r'\exists '})
DELIMITERS={'':'.','.':'.','(':'(',')':')','（':'(', '）':')','[':'[',']':']','{':r'\{','}':r'\}','|':r'\vert ','‖':r'\Vert ','∥':r'\Vert ','⌈':r'\lceil ','⌉':r'\rceil ','⌊':r'\lfloor ','⌋':r'\rfloor ','⟨':r'\langle ','⟩':r'\rangle ','〈':r'\langle ','〉':r'\rangle '}
def literal(text):
    escaped=''.join({'\\':r'\backslash ','{':r'\{','}':r'\}','%':r'\%','#':r'\#','&':r'\&','$':r'\$','_':r'\_'}.get(c,SYMBOLS.get(c,c)) for c in text)
    # CJK prose inside an equation is text, not individual math variables.
    return re.sub(r'[\u3000-\u303f\u3400-\u9fff\uff00-\uffef“”]+',lambda m:''.join(r'\text{'+m[0][i:i+16]+'}' for i in range(0,len(m[0]),16)),escaped)

def to_tex(node,warnings):
    def convert(e):
        if e is None:return ''
        k=e.tag.rsplit('}',1)[-1]
        def part(name):return convert(e.find(M+name))
        def prop(name,default=None):
            item=e.find(M+k+'Pr/'+M+name)
            return item.get(M+'val',default) if item is not None else default
        if e.tag in {W+n for n in ('bookmarkStart','bookmarkEnd','proofErr','lastRenderedPageBreak','commentRangeStart','commentRangeEnd')} :return ''
        if e.tag==W+'rPr' or k.endswith('Pr'):return ''
        if k=='t':return literal(e.text or '')
        if k=='r':
            text=''.join(convert(c) for c in e if not c.tag.endswith('Pr'))
            props=e.find(M+'rPr')
            if props is None:return text
            def value(name,default=None):
                x=props.find(M+name);return x.get(M+'val',default) if x is not None else default
            normal=props.find(M+'nor') is not None and value('nor','1') not in ('0','false','off')
            style=value('sty','p' if normal else 'i');script=value('scr','roman')
            family={'roman':None,'script':'mathcal','double-struck':'mathbb','fraktur':'mathfrak','sans-serif':'mathsf','monospace':'mathtt'}.get(script)
            if script not in ('roman','script','double-struck','fraktur','sans-serif','monospace'):
                warnings.append('未支持公式字族 '+str(script)+'，须核对原稿。')
            if family:text='\\'+family+'{'+text+'}'
            if style=='p' and not family and not text.startswith(r'\text{'):text=r'\mathrm{'+text+'}'
            elif style=='b':text=r'\mathbf{'+text+'}'
            elif style=='bi':text=r'\boldsymbol{'+text+'}'
            elif style not in ('i','p'):warnings.append('未支持公式字形 '+str(style)+'，须核对原稿。')
            for child in props:
                if child.tag not in {M+n for n in ('sty','scr','nor','lit','brk','aln')}:
                    warnings.append('未支持公式运行属性 '+child.tag.rsplit('}',1)[-1]+'，须核对原稿。')
            return text
        if k=='f':
            kind=prop('type','bar');a,b=part('num'),part('den')
            if kind=='bar':return r'\frac{'+a+'}{'+b+'}'
            if kind=='noBar':return r'\genfrac{}{}{0pt}{}{'+a+'}{'+b+'}'
            if kind in ('lin','skw'):return '{'+a+'}/{'+b+'}'
            warnings.append('未支持分式类型 '+kind+'，须核对原稿。');return r'\frac{'+a+'}{'+b+'}'
        if k=='rad':return r'\sqrt'+('['+part('deg')+']' if part('deg') and prop('degHide','0') in ('0','false','off') else '')+'{'+part('e')+'}'
        if k in ('sSub','sSup','sSubSup','sPre'):
            sub='_{'+part('sub')+'}' if k in ('sSub','sSubSup','sPre') else ''
            sup='^{'+part('sup')+'}' if k in ('sSup','sSubSup','sPre') else ''
            return ('{}'+sub+sup+'{'+part('e')+'}') if k=='sPre' else '{'+part('e')+'}'+sub+sup
        if k=='nary':
            ch=prop('chr','∫');op={'∑':r'\sum','∏':r'\prod','∐':r'\coprod','∫':r'\int','∮':r'\oint','∬':r'\iint','∭':r'\iiint','⋃':r'\bigcup','⋂':r'\bigcap'}.get(ch)
            if op is None:warnings.append('未支持大型运算符 '+ch+'，须核对原稿。');op=literal(ch)
            loc=r'\limits' if prop('limLoc')=='undOvr' else r'\nolimits'
            return op+loc+('_{'+part('sub')+'}' if part('sub') and prop('subHide','0') in ('0','false','off') else '')+('^{'+part('sup')+'}' if part('sup') and prop('supHide','0') in ('0','false','off') else '')+' '+part('e')
        if k=='m':return r'\begin{matrix}'+r' \\ '.join(' & '.join(convert(c) for c in row if c.tag==M+'e') for row in e if row.tag==M+'mr')+r'\end{matrix}'
        if k=='eqArr':return r'\begin{gathered}'+r' \\ '.join(convert(c) for c in e if c.tag==M+'e')+r'\end{gathered}'
        if k=='d':
            def delim(name,default):
                v=prop(name,default)
                if v not in DELIMITERS:warnings.append('公式定界符 '+repr(v)+' 不支持，须按原稿重建。')
                return DELIMITERS.get(v,'.')
            sep=delim('sepChr','|');mid='' if sep=='.' else r'\middle'+sep
            return r'\left'+delim('begChr','(')+mid.join(convert(c) for c in e if c.tag==M+'e')+r'\right'+delim('endChr',')')
        if k=='func':
            name=e.find(M+'fName');raw=''.join(t.text or '' for t in name.iter(M+'t')) if name is not None else ''
            if raw in 'sin cos tan cot sec csc log ln exp min max lim sup inf det gcd'.split() and not any(c.tag in (M+'limLow',M+'limUpp') for c in name):return '\\'+raw+' '+part('e')
            return part('fName')+r'\,'+part('e')
        if k in ('limLow','limUpp'):return ('\\underset{' if k=='limLow' else '\\overset{')+part('lim')+'}{'+part('e')+'}'
        if k=='acc':
            ch=prop('chr','̂');cmd={'̂':'widehat','̅':'overline','̄':'overline','̃':'widetilde','⃗':'vec','̇':'dot','̈':'ddot','̌':'check','̆':'breve'}.get(ch)
            if cmd:return '\\'+cmd+'{'+part('e')+'}'
            warnings.append('未支持公式重音 '+repr(ch)+'，须核对原稿。');return part('e')
        if k=='bar':return ('\\underline{' if prop('pos')=='bot' else '\\overline{')+part('e')+'}'
        if k=='groupChr':
            ch=prop('chr','⏟');cmd={'⏟':'underbrace','⏞':'overbrace'}.get(ch)
            if cmd:return '\\'+cmd+'{'+part('e')+'}'
            warnings.append('未支持公式组合符 '+repr(ch)+'，须核对原稿。');return part('e')
        if k in ('oMath','oMathPara','e','num','den','sup','sub','deg','lim','fName','mr'):return ''.join(convert(c) for c in e)
        warnings.append('公式结构 '+k+' 未完整转换，须核对原稿。')
        return ''.join(convert(c) for c in e)
    return convert(node)
