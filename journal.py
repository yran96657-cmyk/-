"""Semantic article roles and deterministic figure/table anchors.

Anchor order is explicit, not a heuristic that guesses the author's intent.
PDF destinations measure the actual result, including after imposition.
"""
from io import BytesIO
import re

FRONT_ROLES={'title-zh','authors-zh','affiliation-zh','abstract-zh','keywords-zh','classification','title-en','authors-en','affiliation-en','abstract-en','keywords-en','citation','article-note'}
ROLE_STYLE={
 'title-zh':(15,19,'center',True),'authors-zh':(8.6,12,'center',False),
 'affiliation-zh':(7,10,'center',False),'abstract-zh':(6.9,12.2,'justify',False),
 'keywords-zh':(6.9,12.2,'justify',False),'classification':(6.9,11,'left',False),
 'title-en':(9.3,12,'center',True),'authors-en':(8,11,'center',False),
 'affiliation-en':(6.9,10,'center',False),'abstract-en':(6.9,11.6,'justify',False),
 'keywords-en':(6.9,11.6,'justify',False),'citation':(6.9,11.5,'left',False),
 'article-note':(6.9,8,'left',False),'reference':(6.94,8.5,'justify',False)}

def prepare_blocks(doc):
    blocks=doc.get('blocks',[]);by_id={b.get('id'):b for b in blocks};caption_ids=set();anchored=set()
    for b in blocks:
        if (b.get('anchor') or b.get('captionIds')) and b.get('type') not in ('image','table','equation'):raise ValueError('锚定只支持图、表和公式。')
        for ident in b.get('captionIds',[]):
            c=by_id.get(ident)
            if not c or c.get('type') not in ('paragraph','heading') or c.get('role') or ident in caption_ids:raise ValueError('题注关联失效或重复。')
            caption_ids.add(ident)
    before={};after={}
    for b in blocks:
        a=b.get('anchor')
        if not a:continue
        target=by_id.get(a.get('targetId'))
        if not target or target.get('type') not in ('paragraph','heading') or target.get('role') or target.get('id') in caption_ids:raise ValueError('锚点须指向普通正文/标题。')
        if a.get('position') not in ('before','after') or not isinstance(a.get('maxPageDistance'),int) or not 0<=a['maxPageDistance']<=3:raise ValueError('锚点约束无效。')
        (before if a['position']=='before' else after).setdefault(target['id'],[]).append(b);anchored.add(b['id'])
    front=[];body=[]
    for b in blocks:
        if b.get('id') in caption_ids or b.get('id') in anchored:continue
        if b.get('role') in FRONT_ROLES:
            if not doc.get('journal'):raise ValueError('首面角色须启用期刊模板。')
            front.append(b)
        else:body.extend(before.get(b.get('id'),[])+[b]+after.get(b.get('id'),[]))
    return front+body,by_id

def marker(ident,edge):
    if not isinstance(ident,str) or not re.fullmatch(r'[A-Za-z0-9_:-]{1,180}',ident):return ''
    return r'\special{pdf:dest (shuye-'+edge+'-'+ident+') [@thispage /XYZ @xpos @ypos null]}'

def read_positions(pdf):
    from pypdf import PdfReader
    reader=PdfReader(BytesIO(pdf));objects={}
    for name,d in reader.named_destinations.items():
        m=re.fullmatch(r'shuye-(start|end)-([A-Za-z0-9_:-]+)',name)
        if not m:continue
        page=reader.get_destination_page_number(d)
        if page<0 or d.left is None or d.top is None:continue
        objects.setdefault(m[2],{})[m[1]]={'page':page+1,'xPt':float(d.left),'yPt':float(reader.pages[page].mediabox.height)-float(d.top)}
    return objects

def final_positions(source,source_pdf,output_pdf,report):
    from pypdf import PdfReader
    source_reader=PdfReader(BytesIO(source_pdf));out_reader=PdfReader(BytesIO(output_pdf));result={}
    mappings=[]
    if report.get('imposition'):
        for i,sheet in enumerate(report['imposition']):
            trim=out_reader.pages[i].trimbox;half=float(trim.width)/2
            for side in ('left','right'):
                if sheet[side]:mappings.append((sheet[side],i+1,float(trim.left)+(half if side=='right' else 0),float(trim.bottom)))
    else:
        for i,original in enumerate(report['selectedPages']):
            trim=out_reader.pages[i].trimbox;mappings.append((original,i+1,float(trim.left),float(trim.bottom)))
    for ident,positions in source.items():
        obj={}
        for edge,pos in positions.items():
            for original,page,x,y in mappings:
                if original!=pos['page']:continue
                src=source_reader.pages[original-1];dest=out_reader.pages[page-1];trim=src.trimbox
                obj[edge]={'page':page,'xPt':round(pos['xPt']-float(trim.left)+x,3),'yPt':round(float(dest.mediabox.height)-(float(src.mediabox.height)-pos['yPt']-float(trim.bottom)+y),3)}
        if obj:result[ident]=obj
    return result

def relation_report(document,objects,logical_objects=None):
    diagnostics=[];relations=[]
    logical=objects if logical_objects is None else logical_objects
    for b in document.get('blocks',[]):
        a=b.get('anchor');obj=logical.get(b.get('id'),{})
        if a:
            target=logical.get(a['targetId'],{});at=target.get('end' if a['position']=='after' else 'start');placed=obj.get('start' if a['position']=='after' else 'end')
            distance=abs(placed['page']-at['page']) if at and placed else None
            order_ok=bool(at and placed and (placed['page']>=at['page'] if a['position']=='after' else placed['page']<=at['page']))
            status='NOT_CHECKED' if distance is None else 'FAIL' if distance>a['maxPageDistance'] or not order_ok else 'PASS'
            relations.append({'blockId':b['id'],'targetId':a['targetId'],'status':status,'pageDistance':distance,'maxPageDistance':a['maxPageDistance']})
            if status!='PASS':diagnostics.append({'code':'ANCHOR_CONSTRAINT','severity':'error','message':'对象锚点未通过：'+b['id'],'blockId':b['id']})
        for ident in b.get('captionIds',[]):
            caption=logical.get(ident,{});c=caption.get('start');p=obj.get('start')
            if not c or not p or c['page']!=p['page']:diagnostics.append({'code':'CAPTION_SEPARATED','severity':'error','message':'题注与图表起始页分离或未定位：'+ident,'blockId':b['id']})
    expected=[b['id'] for b in document.get('blocks',[]) if b.get('id') and b.get('type') in ('paragraph','heading','image','table','equation')]
    expected += [b['id']+':'+m['id'] for b in document.get('blocks',[]) for m in b.get('inlineMath',[]) if b.get('id')]
    missing=[ident for ident in expected if not all(edge in logical.get(ident,{}) for edge in ('start','end'))]
    if missing:diagnostics.append({'code':'SOURCE_OBJECT_NOT_LOCATED','severity':'error','message':'源对象未完整定位：'+str(len(missing))+' 个'})
    return {'units':'pt','origin':'top-left','scope':'semantic start/end destinations, not ink or collision bounds','relationPageBasis':'logical pages before selection/imposition','sourceObjectCoverage':{'expected':len(expected),'mapped':len(expected)-len(missing),'missing':missing},'objects':objects,'relations':relations,'diagnostics':diagnostics}
