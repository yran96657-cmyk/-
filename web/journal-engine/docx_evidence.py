"""Source addresses for failed DOCX objects; never execute embedded OLE data."""
import hashlib
import re

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
O = '{urn:schemas-microsoft-com:office:office}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'


def legacy_math(element):
    return element.tag == O+'OLEObject' and bool(re.match(
        r'^(Equation|MathType)(\.|$)', element.get('ProgID', ''), re.I))


class SourceEvidence:
    def __init__(self, root, archive, relationships):
        self.archive, self.relationships = archive, relationships
        self.paths, self.diagnostics, self.hashes = {}, [], {}
        # Iterative traversal also handles deeply nested source structures.
        stack = [(root, '/document[1]')]
        while stack:
            node, path = stack.pop(); self.paths[node] = path
            counts = {}
            for child in node:
                tag = child.tag.rsplit('}', 1)[-1]
                counts[tag] = counts.get(tag, 0)+1
                stack.append((child, path+'/'+tag+'['+str(counts[tag])+']'))

    def add(self, code, message, element, asset=None, severity='error'):
        path = self.paths[element]
        # Very deep documents retain the root and nearest object ancestry.
        if len(path) > 1800: path = path[:200]+'/…/'+path[-1500:]
        diagnostic = {'code': code, 'severity': severity, 'message': message,
                      'sourcePart': 'word/document.xml', 'sourcePath': path}
        if asset:
            diagnostic['sourceAsset'] = asset[:1000]
            if asset in self.archive.namelist():
                if asset not in self.hashes:
                    self.hashes[asset] = hashlib.sha256(self.archive.read(asset)).hexdigest()
                diagnostic['assetSha256'] = self.hashes[asset]
        self.diagnostics.append(diagnostic)

    def ole_objects(self, root):
        objects = list(root.iter(O+'OLEObject'))
        for obj in objects:
            if legacy_math(obj): continue # The importer attempts native conversion.
            kind = '旧式公式' if legacy_math(obj) else 'OLE 对象'
            self.add('DOCX_LEGACY_MATH' if legacy_math(obj) else 'DOCX_OLE_UNSUPPORTED',
                     kind+'未导入：'+obj.get('ProgID', '未知类型')[:200]+'。请在原稿中转为可编辑的 Word 公式或受支持对象后重新导入；不可直接交付。',
                     obj, self.relationships.get(obj.get(R+'id')))
        return {'sourceOleObjects': len(objects),
                'sourceLegacyMath': sum(legacy_math(e) for e in objects),
                'importedLegacyMath': 0}
