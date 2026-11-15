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
 'article-note':(6.9,8,'left',False),'reference':(6.94,8.5,'justify',False),'reference-heading':(11.8,16,'left',False)}

def prepare_blocks(doc):
    blocks=doc.get('blocks',[]);by_id={b.get('id'):b for b in blocks};caption_ids=set();anchored=set()
    cell_ids=validate_cell_images(blocks)
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
        if b.get('id') in caption_ids or b.get('id') in anchored or b.get('id') in cell_ids:continue
        if b.get('role') in FRONT_ROLES:
            if not doc.get('journal'):raise ValueError('首面角色须启用期刊模板。')
            front.append(b)
        else:body.extend(before.get(b.get('id'),[])+[b]+after.get(b.get('id'),[]))
    return front+body,by_id

def validate_cell_images(blocks):
    by_id={b.get('id'):b for b in blocks};owned=set()
    for table in blocks:
        if 'cellImages' not in table:continue
        entries=table['cellImages']
        if table.get('type')!='table' or not isinstance(entries,list) or len(entries)>10000:raise ValueError('单元格图片列表无效。')
        for entry in entries:
            r,c=entry.get('row'),entry.get('col');ident=entry.get('imageId');rows=table.get('rows',[])
            if any(not isinstance(v,int) or isinstance(v,bool) or v<0 for v in (r,c)) or r>=len(rows) or c>=len(rows[r]):raise ValueError('单元格图片位置无效。')
            image=by_id.get(ident)
            if not image or image.get('type')!='image' or ident in owned or image.get('anchor') or image.get('captionIds') or image.get('sideTextIds') or image.get('text') or image.get('wrap','none')!='none' or image.get('placement','auto')!='auto':raise ValueError('单元格图片不存在、重复归属或含独立定位/题注。')
            for m in table.get('merges',[]):
                if m['row']<=r<m['row']+m['rowspan'] and m['col']<=c<m['col']+m['colspan'] and (m['rowspan']!=1 or (r,c)!=(m['row'],m['col'])):raise ValueError('单元格图片只支持普通格或横向合并起点。')
            owned.add(ident)
    return owned

def marker(ident,edge):
    if not isinstance(ident,str) or not re.fullmatch(r'[A-Za-z0-9_:-]{1,180}',ident):return ''
    return r'\special{pdf:dest (shuye-'+edge+'-'+ident+') [@thispage /XYZ @xpos @ypos null]}'

def side_groups(blocks,by_id):
    """Bounded side-by-side groups, never a float that silently displaces text.

    The selected source paragraphs/displays remain in order. Headings, other
    objects, footnotes and nested anchors cannot enter an indivisible group.
    """
    groups={};claimed=set();widths={}
    for image in (b for b in blocks if b.get('sideTextIds') is not None):
        ids=image['sideTextIds'];anchor=image.get('anchor',{})
        if image.get('type')!='image' or not isinstance(ids,list) or not 1<=len(ids)<=32 or len(set(ids))!=len(ids):raise ValueError('图文并排正文范围无效。')
        width=image.get('width')
        if image.get('wrap') not in ('left','right') or not isinstance(width,(int,float)) or not 15<=width<=60 or anchor.get('targetId') not in ids:raise ValueError('图文并排须指定左右位置、15–60% 图宽及范围内锚点。')
        members=[]
        for ident in ids:
            b=by_id.get(ident)
            if not b or b.get('type') not in ('paragraph','equation') or b.get('role') or b.get('anchor') or ident in claimed or '[^' in b.get('text',''):raise ValueError('并排范围只支持连续正文/公式，不能重叠、含脚注或嵌套锚点。')
            members.append(b)
        all_ids=set(ids+[image['id']]);indices=[i for i,b in enumerate(blocks) if b.get('id') in all_ids]
        if len(indices)!=len(all_ids) or indices[-1]-indices[0]+1!=len(all_ids) or [b['id'] for b in blocks if b.get('id') in ids]!=ids:raise ValueError('图文并排范围必须按正文顺序连续，不能跨越其他图表或标题。')
        groups[indices[0]]=(indices[-1],image,members);claimed.update(all_ids)
        widths.update({ident:width for ident in ids})
    result=[];i=0
    while i<len(blocks):
        if i in groups:
            end,image,members=groups[i]
            result.extend([{'type':'sideStart','image':image}]+members+[{**image,'_sideImage':True},{'type':'sideEnd'}]);i=end+1
        else:result.append(blocks[i]);i+=1
    return result,widths

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
    diagnostics=[];relations=[];side_relations=[];cell_relations=[]
    logical=objects if logical_objects is None else logical_objects
    for b in document.get('blocks',[]):
        a=b.get('anchor');obj=logical.get(b.get('id'),{})
        for cell in b.get('cellImages',[]):
            positions=[logical.get(ident,{}).get(edge) for ident in (b['id'],cell['imageId']) for edge in ('start','end')]
            pages={p['page'] for p in positions if p};status='PASS' if all(positions) and len(pages)==1 else 'FAIL'
            cell_relations.append({'tableId':b['id'],**cell,'status':status,'pages':sorted(pages)})
            if status!='PASS':diagnostics.append({'code':'CELL_IMAGE_SEPARATED','severity':'error','message':'单元格图片与表格未完整落在同一页：'+cell['imageId'],'blockId':b['id']})
        if a:
            target=logical.get(a['targetId'],{});at=target.get('end' if a['position']=='after' else 'start');placed=obj.get('start' if a['position']=='after' else 'end')
            distance=abs(placed['page']-at['page']) if at and placed else None
            order_ok=bool(at and placed and (placed['page']>=at['page'] if a['position']=='after' else placed['page']<=at['page']))
            status='NOT_CHECKED' if distance is None else 'FAIL' if distance>a['maxPageDistance'] or not order_ok else 'PASS'
            relations.append({'blockId':b['id'],'targetId':a['targetId'],'status':status,'pageDistance':distance,'maxPageDistance':a['maxPageDistance']})
            if status!='PASS':diagnostics.append({'code':'ANCHOR_CONSTRAINT','severity':'error','message':'对象锚点未通过：'+b['id'],'blockId':b['id']})
        if b.get('sideTextIds'):
            members=[b['id']]+b['sideTextIds']+b.get('captionIds',[])
            positions=[logical.get(ident,{}).get(edge) for ident in members for edge in ('start','end')]
            pages={p['page'] for p in positions if p}
            status='PASS' if all(positions) and len(pages)==1 else 'FAIL'
            side_relations.append({'blockId':b['id'],'textIds':b['sideTextIds'],'status':status,'pages':sorted(pages),'scope':'same-page semantic coverage; ink collision still requires inspection'})
            if status!='PASS':diagnostics.append({'code':'SIDE_GROUP_SEPARATED','severity':'error','message':'图文并排组未完整落在同一页：'+b['id'],'blockId':b['id']})
        for ident in b.get('captionIds',[]):
            caption=logical.get(ident,{});c=caption.get('start');p=obj.get('start')
            if not c or not p or c['page']!=p['page']:diagnostics.append({'code':'CAPTION_SEPARATED','severity':'error','message':'题注与图表起始页分离或未定位：'+ident,'blockId':b['id']})
    expected=[b['id'] for b in document.get('blocks',[]) if b.get('id') and b.get('type') in ('paragraph','heading','image','table','equation')]
    expected += [b['id']+':'+m['id'] for b in document.get('blocks',[]) for m in b.get('inlineMath',[]) if b.get('id')]
    expected += ['note:'+n['id'] for n in document.get('notes',[]) if n.get('id')]
    missing=[ident for ident in expected if not all(edge in logical.get(ident,{}) for edge in ('start','end'))]
    if missing:diagnostics.append({'code':'SOURCE_OBJECT_NOT_LOCATED','severity':'error','message':'源对象未完整定位：'+str(len(missing))+' 个'})
    return {'units':'pt','origin':'top-left','scope':'semantic start/end destinations, not ink or collision bounds','relationPageBasis':'logical pages before selection/imposition','sourceObjectCoverage':{'expected':len(expected),'mapped':len(expected)-len(missing),'missing':missing},'objects':objects,'relations':relations,'sideGroups':side_relations,'cellImages':cell_relations,'diagnostics':diagnostics}
