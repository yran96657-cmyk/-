"""Full first-page template + complex math + anchored figures (synthetic only)."""
from io import BytesIO
import importlib.util
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from docx_import import import_docx
from proof import render_proof


def create_document():
    spec=importlib.util.spec_from_file_location('smoke',Path(__file__).with_name('journal-smoke.py'));module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    imported=import_docx(module.create_fixture());body=imported['blocks'][1:]
    roles=[('title-zh','中文学术期刊首面与复杂对象合成样稿'),('authors-zh','测试作者甲1，测试作者乙2'),('affiliation-zh','（1. 合成研究院；2. 合成实验室）'),('abstract-zh','摘要：本文用于检验双语首面、公式结构和图表锚点。所有数据均为软件测试构造。'),('keywords-zh','关键词：双栏；矩阵；图表；源对象定位'),('classification','分类号：测试字段'),('title-en','A synthetic journal article for verifiable typesetting'),('authors-en','TEST Author A, TEST Author B'),('affiliation-en','Synthetic Research Institute'),('abstract-en','Abstract: This synthetic article exercises first-page roles, mathematical structures and figure anchors. It contains no customer material.'),('keywords-en','Key words: columns; mathematics; anchors')]
    front=[{'id':role,'type':'paragraph','text':text,'role':role} for role,text in roles]
    table=next(b for b in body if b['type']=='table');table.update(borderStyle='three-line',captionIds=['cap-table'],anchor={'targetId':body[0]['id'],'position':'after','maxPageDistance':1})
    figure=next(b for b in body if b['type']=='image');figure.update(width=85,captionIds=['cap-image'],anchor={'targetId':body[0]['id'],'position':'after','maxPageDistance':1})
    equations=[r'\lim_{n\to\infty}\sum_{i=1}^{n}\frac{\boldsymbol{x}_{i}\boldsymbol{x}_{i}^{T}}{n}',r'\left[\begin{matrix}a_{11}&a_{12}\\a_{21}&a_{22}\end{matrix}\right]\begin{pmatrix}x\\y\end{pmatrix}=\begin{pmatrix}1\\2\end{pmatrix}',r'\begin{cases}\frac{1}{\sqrt{2\pi}}e^{-x^{2}/2},&x>0\\0,&x\leq0\end{cases}', 'A='+ '+'.join('x_{'+str(i)+'}' for i in range(75))]
    doc={'format':'open-typesetter','version':4,'title':'期刊模板合成校样','journal':{'template':'cn-academic','name':'合成期刊','nameEn':'Synthetic Journal','volume':'1','issue':'1','year':'2026','date':'合成日期','shortTitle':'首面、公式与锚点回归'},'layout':{'fontSet':'fandol','width':170,'height':240,'inner':13,'outer':13,'top':16,'bottom':16,'fontSize':8.2,'lineHeight':1.55,'columns':2,'gap':6},'blocks':front+body+[{'id':'cap-table','type':'paragraph','text':'表 1 含公式和脚注的合成数据'},{'id':'cap-image','type':'paragraph','text':'图 1 合成趋势图'}]+[{'id':'e'+str(i),'type':'equation','text':t,'equationNumber':str(i+1)} for i,t in enumerate(equations)],'notes':imported['notes'],'importReports':imported['importReports']}
    doc['blocks'] += [{'id':'body-'+str(i),'type':'paragraph','text':'这是合成正文，用于检查复杂公式前后的双栏阅读顺序。任何内容修订都应保留源对象身份，并在最终 PDF 中校验位置。'*4} for i in range(3)]
    doc['blocks'] += [{'id':'long-table','type':'table','text':'表 2 跨页续表（合成）','placement':'full-width','headerRows':1,'borderStyle':'three-line','inlineMath':[{'id':'head','text':'x_i^2'}],'rows':[['序号','[[math:head]]','说明']]+[[str(i),str(i*i),'合成数据，无科学结论'] for i in range(1,65)]}]
    return doc


def main():
    folder=Path(sys.argv[1]);folder.mkdir(parents=True,exist_ok=False);doc=create_document()
    (folder/'journal.shuye.json').write_text(json.dumps(doc,ensure_ascii=False,indent=2))
    result=render_proof(doc,evidence_dir=folder/'engine');report=result['report']
    (folder/'proof.pdf').write_bytes(result['pdf']);(folder/'proof-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    assert report['geometry']['status']=='COMPLETE' and not report['geometry']['outside']
    assert not report['compileMessages'],report['compileMessages']
    assert not report['semanticLayout']['diagnostics'],report['semanticLayout']['diagnostics']
    assert not any(d['severity']=='error' for d in report['quality']['diagnostics']),report['quality']['diagnostics']
    assert all(f['embedded'] for f in report['fonts'])
    print(json.dumps({'pages':report['outputPages'],'pdfSha256':report['pdfSha256'],'coverage':report['semanticLayout']['sourceObjectCoverage'],'quality':report['quality']['status']},ensure_ascii=False))

if __name__=='__main__':main()
