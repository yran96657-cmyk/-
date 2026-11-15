"""Explicit publication-note/reference styles. Source text is never rewritten."""
import re


def annotation_preamble(journal):
    if journal.get('annotations', {}).get('fontSet', 'inherit') != 'founder-sample':
        return ''
    return r'''
\newfontfamily\ShuyeAnnotationLatin{Times New Roman}
\newfontfamily\ShuyeNoteLatin[LetterSpace=1.020408]{Times New Roman}
\newCJKfontfamily\ShuyeAnnotationCJK{FZShuSong-Z01}
\newCJKfontfamily\ShuyeAnnotationLabel{FZHei-B01}
\newCJKfontfamily\ShuyeReferenceBracket{SimSun}
\newcommand{\ShuyeAnnotationFont}{\normalfont\ShuyeAnnotationLatin\ShuyeAnnotationCJK}
\newcommand{\ShuyeAnnotationSpacing}{\frenchspacing\xeCJKsetup{CJKglue={\hskip .18bp plus .2bp},CJKecglue={\hskip 0pt},PunctStyle=kaiming}}
\xeCJKDeclarePunctStyle{shuye-note}{fixed-punct-ratio=.510204,mixed-punct-ratio=1.020408,optimize-margin=false,kerning-total-ratio=.510204,optimize-kerning=false}
\newcommand{\ShuyeNoteSpacing}{\frenchspacing\xeCJKsetup{CJKglue={\hskip .18bp plus .2bp},CJKecglue={\hskip 0pt},PunctStyle=shuye-note}}
\newcommand{\ShuyeReferenceSpacing}{\ShuyeAnnotationSpacing\xeCJKsetup{CJKspace=true}\pretolerance=-1\hyphenpenalty=30\exhyphenpenalty=30\emergencystretch=3em}
'''


def reference_text(text, escape):
    """Render bibliographic type brackets; never change the stored citation.

    Only recognised reference types are typographic markers. Mathematical
    brackets, URLs, DOI strings and numeric citations are not rewritten.
    """
    result = []
    start = 0
    protected=[(m.start(),m.end()) for m in re.finditer(r'https?://\S+|\b10\.\d{4,9}/\S+',text)]
    for match in re.finditer(r'(?<!\[)[\[［](J|M|C|D|N|R|S|P|EB|DB|CP)(/(?:OL|CD|DK))?[\]］](?!\])', text):
        if any(a<=match.start()<z for a,z in protected):continue
        result.append(escape(text[start:match.start()].rstrip()))
        bracket=lambda c:r'{\mdseries\upshape\xeCJKsetup{PunctStyle=plain}\ShuyeReferenceBracket '+c+'}'
        result.append(r'\allowbreak{}\mbox{\hspace*{-.46em}'+bracket('［')+r'\kern-.025em '+escape(match[1]+(match[2] or ''))+r'\kern-.032em '+bracket('］')+r'\hspace*{-.46em}}')
        start = match.end()
    result.append(escape(text[start:]))
    return ''.join(result)


def note_text(text, escape):
    # Remove Word's literal padding around Chinese punctuation at display time.
    # English word spaces, author spelling, dates and fund numbers stay intact.
    text = re.sub(r'\((\s*\d{4}[^()\n]*?)\)', r'（\1）', text)
    text = re.sub(r'(?<=[\u3400-\u9fff）])\s*([,.;:])', lambda m:{',':'，','.':'。',';':'；',':':'：'}[m[1]], text)
    text = re.sub(r'\s*([，。；：（）])\s*', r'\1', text)
    text = re.sub(r'(E-mail)\s*[:：]\s*', r'\1：', text, flags=re.I)
    return escape(text)


def note_body(text, journal, escape, number):
    a = journal.get('annotations', {})
    custom = journal.get('roleStyles', {}).get('article-note', {})
    size = number(custom.get('fontSize'), 6.9, 6, 24)
    leading = number(custom.get('leading'), max(8, size * 1.2), 7, 36)
    inset = number(a.get('noteIndentMm'), 0, 0, 20)
    label_width = str(number(a['noteLabelWidthMm'], 0, 0, 30))+'mm' if 'noteLabelWidthMm' in a else '5.5em'
    exact = a.get('fontSet') == 'founder-sample'
    font = r'\ShuyeAnnotationFont\ShuyeNoteLatin ' if exact else r'\normalfont '
    result = font+r'\fontsize{'+str(size)+'}{'+str(leading)+r'}\selectfont '+(r'\ShuyeNoteSpacing ' if exact else '')+r'\leftskip='+str(inset)+r'mm\rightskip=0pt\parskip=0pt '
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        label = re.match(r'^([*＊∗†‡]?)(收稿日期|基金项目|作者简介|通讯作者|通信作者)([：:])\s*', line)
        if label:
            symbol = ('*' if label[2] in ('通讯作者', '通信作者') else '') if exact else label[1]
            prefix = r'\llap{'+escape(symbol)+'}' if symbol else ''
            name = escape(label[2]+('：' if exact else label[3]))
            name = r'{\ShuyeAnnotationLabel\ShuyeAnnotationSpacing '+name+'}' if exact else r'\textbf{'+name+'}'
            body = prefix+r'\makebox['+label_width+'][l]{'+name+'}'+(note_text(line[label.end():], escape) if exact else escape(line[label.end():]))
        else:
            # Unlabelled source lines remain intact; continuation text aligns
            # with the labelled values, not with the page edge.
            body = r'\hspace*{'+label_width+'}'+(note_text(line, escape) if exact else escape(line))
        result += r'\noindent\hangindent='+label_width+r'\hangafter=1 '+body+r'\par'
    return result


def reference_label(source, annotations, escape):
    if annotations.get('referenceLabelStyle') != 'fullwidth':
        return escape(source)
    digits = re.search(r'\d+', source)[0]
    bracket = lambda c: r'{\mdseries\upshape\xeCJKsetup{PunctStyle=plain}\ShuyeReferenceBracket '+c+'}' if annotations.get('fontSet') == 'founder-sample' else c
    # Optical half-bracket overhang matches the sample while all text lines
    # retain the explicit hanging indent. The number itself is unchanged.
    return r'\hspace*{-.46em}'+bracket('［')+r'\kern-.025em '+digits+r'\kern-.032em '+bracket('］')
