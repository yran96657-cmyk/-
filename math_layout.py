"""Break only at outer binary/relation operators; retain all expression tokens."""
import re

def break_formula(tex,display=True):
    if '\\begin{' in tex:return tex
    # Upright styling of punctuation has no mathematical distinction.
    value=re.sub(r'\\mathrm\{([=+<>,-])\}',r'\1',tex)
    # Delimited lists may be wider than an entire page. Break their contents
    # without removing either delimiter, or changing any mathematical tokens.
    pairs=[];stack=[];i=0
    token=re.compile(r'\\(?:left|right)(?:\\[A-Za-z]+\s*|\\.|.)')
    for m in token.finditer(value):
        if m[0].startswith('\\left'):stack.append(m)
        elif stack:
            left=stack.pop()
            if not stack:pairs.append((left,m))
    for left,right in reversed(pairs):
        inner=value[left.end():right.start()]
        if visual_length(inner)>75:
            wrapped=break_formula(inner,display)
            if wrapped!=inner:value=value[:left.end()]+wrapped+value[right.start():]
    depth=0;delimiters=0;cuts=[];i=0
    while i<len(value):
        if value[i]=='\\':
            m=re.match(r'\\(?:[A-Za-z]+|.)',value[i:]);cmd=m[0];i+=len(cmd)
            if cmd=='\\left':delimiters+=1
            if cmd=='\\right':delimiters=max(0,delimiters-1)
            if not depth and not delimiters and cmd=='\\text' and i>5:cuts.append(i-len(cmd))
            if not depth and not delimiters and cmd in ('\\leq','\\geq','\\approx','\\equiv'):cuts.append(i-len(cmd))
            continue
        c=value[i]
        if c=='{':depth+=1
        elif c=='}':depth-=1
        elif not depth and not delimiters and c in '=+<>,':cuts.append(i)
        i+=1
    cuts=[p for p in cuts if p>0]
    if not cuts:return tex
    parts=[value[a:b] for a,b in zip([0]+cuts,cuts+[len(value)])]
    lines=[];line=''
    for part in parts:
        if visual_length(line)>16 and visual_length(line+part)>65:lines.append(line);line=''
        line+=part
    if line:lines.append(line)
    if len(lines)<2:return value
    # Only layout markup is inserted. Never delete, crop or scale mathematical data.
    return r'\begin{gathered}'+r' \\ '.join((r'\displaystyle ' if display else r'\textstyle ')+line for line in lines)+r'\end{gathered}'

def visual_length(tex):
    visible=re.sub(r'\\[A-Za-z]+|[{}_^]','',tex)
    return sum(2 if ord(c)>0x3000 else 1 for c in visible)
