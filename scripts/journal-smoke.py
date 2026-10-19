"""Reproducible synthetic journal proof. Never uses a customer's manuscript.

Usage: python scripts/journal-smoke.py NEW_OUTPUT_DIRECTORY
Requires the optional requirements.txt dependencies and XeLaTeX on PATH.
"""
from io import BytesIO
import json
from pathlib import Path
import sys
from zipfile import ZipFile
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from PIL import Image, ImageDraw
from docx_import import import_docx
from proof import render_proof


def create_fixture():
    image=Image.new('RGB',(1200,600),'white');draw=ImageDraw.Draw(image)
    draw.line([(100,70),(100,500),(1100,500)],fill='black',width=5)
    draw.line([(100,450),(350,340),(600,290),(850,150),(1100,100)],fill='black',width=8)
    raster=BytesIO();image.save(raster,format='TIFF')
    body='''<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>中文学术期刊合成校样</w:t></w:r></w:p>
<w:p><w:r><w:t>若</w:t></w:r><m:oMath><m:d><m:dPr><m:begChr m:val="|"/><m:endChr m:val="|"/></m:dPr><m:e><m:r><m:t>x</m:t></m:r></m:e></m:d></m:oMath><w:r><w:t>大于零，则比较</w:t></w:r><m:oMath><m:d><m:dPr><m:begChr m:val="["/><m:endChr m:val="]"/></m:dPr><m:e><m:r><m:t>x</m:t></m:r></m:e></m:d></m:oMath><w:r><w:t>的取值。本文全部数据为软件回归测试合成数据。</w:t></w:r></w:p>
<w:tbl><w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:p><w:r><w:t>表达式</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>数值</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><m:oMath><m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f></m:oMath></w:p></w:tc><w:tc><w:p><w:r><w:t>1</w:t><w:footnoteReference w:id="n1"/></w:r></w:p></w:tc></w:tr></w:tbl>
<w:p><w:r><w:drawing><a:blip r:embed="image1"/></w:drawing></w:r></w:p>'''
    notes='<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:footnote w:id="n1"><w:p><w:r><w:t>表注：此值仅用于测试。</w:t></w:r></w:p></w:footnote></w:footnotes>'
    archive=BytesIO()
    with ZipFile(archive,'w') as z:
        z.writestr('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>'+body+'</w:body></w:document>')
        z.writestr('word/_rels/document.xml.rels','<Relationships><Relationship Id="image1" Target="media/chart.tiff"/></Relationships>')
        z.writestr('word/media/chart.tiff',raster.getvalue());z.writestr('word/footnotes.xml',notes)
    return archive.getvalue()


def main():
    folder=Path(sys.argv[1]);folder.mkdir(parents=True,exist_ok=False)
    source=create_fixture();(folder/'synthetic.docx').write_bytes(source);imported=import_docx(source)
    doc={'format':'open-typesetter','version':3,'title':'中文学术期刊合成校样','layout':{'fontSet':'fandol','width':170,'height':240,'inner':20,'outer':18,'top':22,'bottom':22,'fontSize':10,'lineHeight':1.6,'columns':2,'gap':8,'header':'期刊回归测试 · 合成数据','headerEven':'合成数据 · 偶数页页眉','footer':'第 {page} 页'},'blocks':imported['blocks'],'notes':imported['notes'],'importReports':imported['importReports']}
    doc['blocks'][0].update(fontSize=16,align='center')
    table=next(b for b in doc['blocks'] if b['type']=='table');table.update(text='表 1 栏内公式与表注',borderStyle='three-line')
    next(b for b in doc['blocks'] if b['type']=='image').update(text='图 1 合成折线（TIFF 转 PNG）',width=90)
    doc['blocks'] += [{'id':'body-'+str(i),'type':'paragraph','text':'这是双栏正文测试，用于核对文字、标点和版面流动。公式与图表必须保留原始内容关系，排版结果还需逐页校对。'*4} for i in range(4)]
    doc['blocks'] += [{'id':'page-break','type':'pageBreak','text':''},{'id':'long-table','type':'table','text':'表 2 跨页续表测试','placement':'full-width','headerRows':1,'borderStyle':'three-line','rows':[['编号','合成数值','说明']]+[[str(i),str(i*i),'测试数据，无科学结论'] for i in range(1,65)]}]
    (folder/'journal.shuye.json').write_text(json.dumps(doc,ensure_ascii=False,indent=2),encoding='utf-8')
    result=render_proof(doc,{'minDpi':300})
    (folder/'proof.pdf').write_bytes(result['pdf']);(folder/'proof-report.json').write_text(json.dumps(result['report'],ensure_ascii=False,indent=2),encoding='utf-8')
    report=result['report'];assert report['geometry']['status']=='COMPLETE';assert not report['geometry']['outside'];assert all(f['embedded'] for f in report['fonts'])
    assert not any('缺字' in w or '超出版心' in w for w in report['layoutWarnings']),report['layoutWarnings']
    print(json.dumps({'pages':report['outputPages'],'pdfSha256':report['pdfSha256'],'geometry':report['geometry']['status'],'quality':report['quality']['status'],'counts':imported['importReports'][0]['counts']},ensure_ascii=False))


if __name__=='__main__':main()
