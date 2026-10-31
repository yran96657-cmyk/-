"""Read embedded equations without launching or executing OLE objects."""
import base64
import hashlib
from docx_evidence import O,R,legacy_math
from mtef import convert_ole


def equation(element, archive, relationships):
    objects=list(element.iter(O+'OLEObject'))
    if len(objects)!=1 or (objects[0].get('ProgID','').strip() and not legacy_math(objects[0])):raise ValueError('非单一 MathType/Equation 对象')
    obj=objects[0];path=relationships.get(obj.get(R+'id'),'')
    if not path.startswith('word/embeddings/') or path not in archive.namelist():raise ValueError('缺少内嵌公式资产')
    raw=archive.read(path);result=convert_ole(raw)
    source={'format':'mtef5','sourceAsset':path,'data':base64.b64encode(raw).decode(),
            'sha256':hashlib.sha256(raw).hexdigest(),'mtefSha256':result['mtefSha256'],
            'originalTex':result['text'],'characters':result['characters'],
            'structures':result['structures'],'empty':result['empty']}
    previews=[e for e in element.iter() if e.tag=='{urn:schemas-microsoft-com:vml}imagedata']
    if len(previews)==1:
        preview=relationships.get(previews[0].get(R+'id'),'')
        if preview in archive.namelist():
            data=archive.read(preview)
            if len(data)>2*1024*1024:raise ValueError('公式原始预览超过 2 MB')
            source['preview']={'sourceAsset':preview,'data':base64.b64encode(data).decode(),'sha256':hashlib.sha256(data).hexdigest()}
    return {'text':result['text'],'legacySource':source}
