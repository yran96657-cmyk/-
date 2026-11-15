"""Explicit publication-note/reference styles. Source text is never rewritten."""
import re


def annotation_preamble(journal):
    if journal.get('annotations', {}).get('fontSet', 'inherit') != 'founder-sample':
        return ''
    return r'''
\newfontfamily\ShuyeAnnotationLatin{Times New Roman}
\newCJKfontfamily\ShuyeAnnotationCJK{FZShuSong-Z01}
\newCJKfontfamily\ShuyeAnnotationLabel{FZHei-B01}
\newCJKfontfamily\ShuyeReferenceBracket{SimSun}
\newcommand{\ShuyeAnnotationFont}{\normalfont\ShuyeAnnotationLatin\ShuyeAnnotationCJK}
'''


def note_body(text, journal, escape, number):
    a = journal.get('annotations', {})
    custom = journal.get('roleStyles', {}).get('article-note', {})
    size = number(custom.get('fontSize'), 6.9, 6, 24)
    leading = number(custom.get('leading'), max(8, size * 1.2), 7, 36)
    inset = number(a.get('noteIndentMm'), 0, 0, 20)
    label_width = str(number(a['noteLabelWidthMm'], 0, 0, 30))+'mm' if 'noteLabelWidthMm' in a else '5.5em'
    exact = a.get('fontSet') == 'founder-sample'
    font = r'\ShuyeAnnotationFont ' if exact else r'\normalfont '
    result = font+r'\fontsize{'+str(size)+'}{'+str(leading)+r'}\selectfont\leftskip='+str(inset)+r'mm\rightskip=0pt\parskip=0pt '
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        label = re.match(r'^([*＊∗†‡]?)(收稿日期|基金项目|作者简介|通讯作者|通信作者)([：:])\s*', line)
        if label:
            prefix = r'\llap{'+escape(label[1])+'}' if label[1] else ''
            name = escape(label[2]+('：' if exact else label[3]))
            name = r'{\ShuyeAnnotationLabel '+name+'}' if exact else r'\textbf{'+name+'}'
            body = prefix+r'\makebox['+label_width+'][l]{'+name+'}'+escape(line[label.end():])
        else:
            # Unlabelled source lines remain intact; continuation text aligns
            # with the labelled values, not with the page edge.
            body = r'\hspace*{'+label_width+'}'+escape(line)
        result += r'\noindent\hangindent='+label_width+r'\hangafter=1 '+body+r'\par'
    return result


def reference_label(source, annotations, escape):
    if annotations.get('referenceLabelStyle') != 'fullwidth':
        return escape(source)
    digits = re.search(r'\d+', source)[0]
    bracket = lambda c: r'{\mdseries\upshape\ShuyeReferenceBracket '+c+'}' if annotations.get('fontSet') == 'founder-sample' else c
    # Optical half-bracket overhang matches the sample while all text lines
    # retain the explicit hanging indent. The number itself is unchanged.
    return r'\hspace*{-.46em}'+bracket('［')+digits+bracket('］')
