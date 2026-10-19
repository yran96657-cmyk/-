"""MTEF 5 to editable, bounded TeX with a character/structure coverage ledger.

Implemented from the public Wiris MTEF/MTCode format. Unknown glyphs, templates,
embellishments and drawing adjustments stop import instead of using OLE previews.
Font sizes are normalized by the journal template; source bytes remain attached.
"""
import hashlib
import re
from mtef_reader import Reader, MtefError, native_stream

SYMBOLS = dict(zip('αβγδεζηθικλμνξπρστυφχψωΓΔΘΛΞΠΣΥΦΨΩ',
                  'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi pi rho sigma tau upsilon varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega'.split()))
SYMBOLS.update(dict(zip('≤≥≠≈≡∈∉⊂⊆⊃⊇∩∪∅∞∀∃→←↦×÷±∑∏∫∂∇',
                       'le ge neq approx equiv in notin subset subseteq supset supseteq cap cup emptyset infty forall exists to leftarrow mapsto times div pm sum prod int partial nabla'.split())))
SYMBOLS.update({'ℕ': 'mathbb{N}', 'ℝ': 'mathbb{R}', 'ℤ': 'mathbb{Z}', 'ℂ': 'mathbb{C}',
                'ε': 'varepsilon', 'ϕ': 'phi', 'ϑ': 'vartheta'})
FENCES = {0:(r'\langle',r'\rangle'),1:('(',')'),2:(r'\{',r'\}'),3:('[',']'),
          4:('|','|'),5:(r'\Vert',r'\Vert'),6:(r'\lfloor',r'\rfloor'),7:(r'\lceil',r'\rceil')}


class Converter:
    def __init__(self, tree):
        self.tree, self.ledger, self.font_styles = tree, [], []
        self.colors=0

    def char(self, n, role='character'):
        if any(n.get('nudge',[])): raise MtefError('MTEF nudged character requires review')
        if n.get('embellishments'): raise MtefError('MTEF character embellishments are not supported')
        code = n.get('code')
        if code is None: raise MtefError('MTEF font-encoded character has no MTCode')
        c, face = chr(code), n['typeface']
        if face>=0 and face not in (*range(1,13),22,23,24):raise MtefError('Unsupported MTEF typeface')
        if 1<=face<=12 and len(self.tree['styles'])>=face:
            if self.tree['styles'][face-1][1] != {3:2,4:2,7:1}.get(face,0):raise MtefError('Custom MTEF character style requires review')
        if code == 0xF085:
            # MTCode DOUBLE-STRUCK CAPITAL F. Verify the font fallback too.
            if face >= 0 or -face > len(self.font_styles): raise MtefError('Unverified double-struck F font')
            index = self.font_styles[-face-1]['font']
            if not 1 <= index <= len(self.tree['fonts']) or self.tree['fonts'][index-1][1] != 'Euclid Math Two':
                raise MtefError('Unverified double-struck F font')
            token = r'\mathbb{F}'
        elif code == 0xEF04 and face == 24: token = r'\ '
        elif code in (0xEC07, 0xEC08) and face == 22: token = '|'
        elif c in SYMBOLS: token = '\\'+SYMBOLS[c]+' '
        elif c == '−': token = '-'
        elif c in (' ', '\u00a0'): token = r'\ '
        elif c in '{}_%#&$': token = '\\'+c
        elif c in ('（','）'): token = r'\text{'+c+'}'
        elif 0x4E00 <= code <= 0x9FFF: token = r'\text{'+c+'}'
        elif c in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:;!?+-=<>/()[]|'":
            token = c
            if c.isalpha() and face in (1,2): token = r'\mathrm{'+c+'}'
            if c.isalpha() and face == 7: token = r'\mathbf{'+c+'}'
        else: raise MtefError('Unsupported MTEF character U+'+format(code,'04X'))
        if face < 0 and code != 0xF085: raise MtefError('Unsupported explicit MTEF character style')
        self.ledger.append({'offset':n['offset'],'kind':role,'code':code,'tex':token})
        return token

    def content(self, nodes):
        out = []
        for n in nodes:
            if n.get('nudge') and any(n['nudge']): raise MtefError('MTEF nudged content requires review')
            t = n['type']
            if t == 1:
                if n.get('ruler') or n.get('lineSpacing'): raise MtefError('MTEF custom line spacing requires review')
                out.append(self.content(n['children']))
            elif t == 2: out.append(self.char(n))
            elif t == 3: out.append(self.template(n))
            elif t == 5:
                children = self.structural(n['children'])
                if len(children) != n['rows']*n['cols'] or any(c['type'] != 1 for c in children): raise MtefError('Invalid MTEF matrix slots')
                if any(n['rowLines']+n['colLines']): raise MtefError('Ruled MTEF matrix requires review')
                if n['hJust'] not in (1,2,3): raise MtefError('Unsupported matrix alignment')
                cells = [self.content([c]) for c in children]
                # Aligned pairs preserve the source's left-aligned cases slots.
                if n['hJust'] == 1 and n['cols'] == 2:
                    rows = ['&'+cells[i]+r'\quad &&'+cells[i+1] for i in range(0,len(cells),2)]
                    tex = r'\begin{aligned}'+r'\\'.join(rows)+r'\end{aligned}'
                elif n['hJust'] == 2:
                    tex = r'\begin{matrix}'+r'\\'.join('&'.join(cells[i:i+n['cols']]) for i in range(0,len(cells),n['cols']))+r'\end{matrix}'
                else: raise MtefError('Unsupported matrix column alignment')
                out.append(tex); self.ledger.append({'offset':n['offset'],'kind':'matrix','tex':tex})
            elif t in (4,6,7): raise MtefError('Unsupported MTEF pile, embellishment or ruler')
            else: self.metadata(n)
        text = ''.join(out)
        # Joining adjacent text atoms keeps Chinese words and roman operators intact.
        for command in ('mathrm','text'):
            pattern = r'\\'+command+r'\{([^{}]*)\}\\'+command+r'\{([^{}]*)\}'
            while re.search(pattern,text): text = re.sub(pattern,lambda m:'\\'+command+'{'+m[1]+m[2]+'}',text)
        return text

    def metadata(self, n):
        t = n['type']
        if t == 8: self.font_styles.append(n)
        elif t == 16:
            if n['flags'] & 3 or any(n['values']): raise MtefError('Colored MTEF content requires review')
            self.colors+=1
        elif t==15:
            if n['color']>self.colors:raise MtefError('Undefined MTEF color')
        elif t == 9:
            if n.get('size',0) not in (0,1,2,3,4) or abs(n.get('delta',0)) > 64 or 'points32' in n:
                raise MtefError('MTEF custom size requires review')
        elif t not in (10,11,12,13,14,15,17,18,19): raise MtefError('Unsupported MTEF metadata')

    def structural(self, nodes):
        result = []
        for n in nodes:
            if n['type'] < 8: result.append(n)
            else: self.metadata(n)
        return result

    def template(self, n):
        s,v = n['selector'],n['variation']
        if n['templateOptions']: raise MtefError('Unsupported MTEF template options')
        children = self.structural(n['children'])
        lines = [c for c in children if c['type'] == 1]
        chars = [c for c in children if c['type'] == 2]
        if len(lines)+len(chars) != len(children): raise MtefError('Invalid MTEF template slots')
        slots = [self.content([line]) for line in lines]
        glyphs = [self.char(c,'template-character') for c in chars]
        if s in FENCES and v in (1,2,3) and len(slots)==1 and len(chars)==bool(v&1)+bool(v&2):
            left,right = FENCES[s]
            # Reject a fence that disagrees with its encoded glyphs.
            expected = ([left] if v&1 else [])+([right] if v&2 else [])
            if glyphs != expected: raise MtefError('MTEF fence glyph disagrees with its template')
            tex = r'\left'+(left if v&1 else '.')+' '+slots[0]+r'\right'+(right if v&2 else '.')+' '
        elif s == 10 and v in (0,1) and len(slots)==2 and not chars:
            tex = r'\sqrt'+('['+slots[1]+']' if v else '')+'{'+slots[0]+'}'
        elif s == 11 and v == 0 and len(slots)==2 and not chars:
            tex = r'\frac{'+slots[0]+'}{'+slots[1]+'}'
        elif s in (12,13) and v == 0 and len(slots)==1 and not chars:
            tex = ('\\underline' if s==12 else '\\overline')+'{'+slots[0]+'}'
        elif s in (27,28,29) and v in (0,1) and len(slots)==2 and not chars:
            if (s==27 and slots[1]) or (s==28 and slots[0]): raise MtefError('MTEF script slots disagree with selector')
            tex = ('{}' if v else '')+('_{'+slots[0]+'}' if s!=28 else '')+('^{'+slots[1]+'}' if s!=27 else '')
        elif s in (15,16,17,18,19,20) and len(slots)==3 and len(chars)==1:
            operators={15:r'\int',16:r'\sum',17:r'\prod',18:r'\coprod',19:r'\bigcup',20:r'\bigcap'}
            allowed = (1,17,33,49,65,81,97,113) if s==15 else (0,16,32,48,64,80,96,112)
            if v not in allowed or glyphs[0].strip()!=operators[s]: raise MtefError('Unsupported MTEF operator variant')
            if bool(slots[1]) != bool(v&16) or bool(slots[2]) != bool(v&32): raise MtefError('MTEF limit slots disagree with flags')
            tex = operators[s]+(r'\limits' if v&64 else r'\nolimits')+('_{'+slots[1]+'}' if slots[1] else '')+('^{'+slots[2]+'}' if slots[2] else '')+' '+slots[0]
        elif s==23 and v in (0,16,32,48) and len(slots)==3 and not chars:
            tex = slots[0]
            if slots[1]:tex = r'\underset{'+slots[1]+'}{'+tex+'}'
            if slots[2]:tex = r'\overset{'+slots[2]+'}{'+tex+'}'
        else: raise MtefError('Unsupported MTEF template '+str(s)+' variation '+str(v))
        self.ledger.append({'offset':n['offset'],'kind':'template','selector':s,'variation':v,'tex':tex})
        return tex

    def convert(self):
        tex = self.content(self.tree['nodes'])
        def objects(nodes):
            for n in nodes:
                if n['type'] in (2,3,5): yield n['offset']
                yield from objects(n.get('children',[]))
                yield from objects(n.get('embellishments',[]))
        expected = sorted(objects(self.tree['nodes']))
        if expected != sorted(n['offset'] for n in self.ledger): raise MtefError('MTEF conversion coverage mismatch')
        from publishing import safe_math
        safe_math(tex)
        return {'text':tex or '{}','characters':sum(n['kind'] in ('character','template-character') for n in self.ledger),
                'structures':sum(n['kind'] in ('template','matrix') for n in self.ledger),
                'empty':not expected,'ledger':self.ledger}


def convert_ole(data):
    raw = native_stream(data)
    result = Converter(Reader(raw).parse()).convert()
    result['mtefSha256'] = hashlib.sha256(raw).hexdigest()
    return result
