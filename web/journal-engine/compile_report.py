"""Actionable compiler evidence; source matches are candidates, not ink analysis."""
import re


def glyph_sources(document, character):
    locations = []
    def add(text, object_id, field, **extra):
        text = str(text)
        if character not in text:
            return
        at = text.index(character)
        locations.append({'objectId': object_id, 'field': field, 'occurrences': text.count(character),
                          'excerpt': text[max(0, at-25):at+45], **extra})
    for b in document.get('blocks', []):
        add(b.get('text', ''), b['id'], 'text')
        for m in b.get('inlineMath', []):
            add(m['text'], b['id']+':'+m['id'], 'inlineMath', blockId=b['id'], formulaId=m['id'])
        for row, cells in enumerate(b.get('rows', [])):
            for col, value in enumerate(cells):
                add(value, b['id'], 'rows', row=row, col=col)
    for n in document.get('notes', []):
        add(n.get('text', ''), 'note:'+n['id'], 'text')
    for key in ('name', 'nameEn', 'volume', 'issue', 'year', 'date', 'dateEn', 'shortTitle'):
        add(document.get('journal', {}).get(key, ''), None, 'journal.'+key)
    return locations


def compiler_report(messages, source, document):
    lines = source.splitlines()
    line_objects = []; active = set(); gathers = []; gather_start = None
    for index, line in enumerate(lines):
        ids = set(active)
        for direction, ident in re.findall(r'pdf:dest \(shuye-(start|end)-([\w:-]+)\)', line):
            ids.add(ident)
            if direction == 'start': active.add(ident)
            else: active.discard(ident)
        line_objects.append(ids)
        if r'\begin{gather*}' in line: gather_start = index
        if r'\end{gather*}' in line and gather_start is not None:
            gathers.append((gather_start, index)); gather_start = None
    diagnostics = []; seen = set()
    for message in messages:
        if message in seen: continue
        seen.add(message)
        entry = {'code': 'TEX_LAYOUT_ERROR', 'severity': 'error', 'compilerMessage': message}
        missing = re.search(r'Missing character: There is no (.+?) \(U\+([0-9A-Fa-f]+)\) in font (.+)', message)
        if missing:
            character = chr(int(missing[2], 16)); sources = glyph_sources(document, character)
            entry.update(code='TEX_MISSING_GLYPH', character=character, codePoint='U+'+missing[2], font=missing[3],
                         message=f'字体缺字：{character}（U+{missing[2]}）；请更换覆盖该字符的字体并重排。',
                         sourceLocations=sources[:200], totalSourceLocations=len(sources),
                         locationBasis='source character matches; confirm the affected occurrence in the PDF')
        else:
            match = re.search(r'(?:at line|at lines) (\d+)(?:--(\d+))?', message)
            ids = set()
            if match:
                start = max(0, int(match[1])-1); end = min(len(lines)-1, int(match[2] or match[1])-1)
                for a, b in gathers:
                    if a <= end <= b: start = min(start, a); end = max(end, b)
                for candidates in line_objects[start:end+1]: ids.update(candidates)
                entry['texLines'] = [int(match[1]), int(match[2] or match[1])]
            entry.update(message='行、公式或表格超出版心，请检查列出的候选对象。' if 'Overfull' in message else '存在字体形状替代，请检查 PDF。',
                         candidateObjectIds=sorted(ids), locationBasis='TeX paragraph/display environment; candidate objects may span several lines')
        diagnostics.append(entry)
    return diagnostics
