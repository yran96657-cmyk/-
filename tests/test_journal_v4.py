"""Source preservation and actual-output checks for journal production."""
import hashlib
from io import BytesIO
from pathlib import Path
import re
import shutil
import tempfile
import unittest
import xml.etree.ElementTree as ET

from docx_import import import_docx
from docx_numbering import Numbering
from journal import prepare_blocks, relation_report, final_positions
from math_layout import break_formula
from omml import to_tex
from publishing import build_tex, render_pdf, TEX_DEFAULT, compile_diagnostics
from proof import render_proof
from print_production import process_pdf
from test_docx_v2 import package

W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
M='http://schemas.openxmlformats.org/officeDocument/2006/math'
def run(text,style=''):
    return '<m:r>'+('<m:rPr>'+style+'</m:rPr>' if style else '')+'<m:t>'+text+'</m:t></m:r>'
def convert(body):
    source='<m:oMath xmlns:m="'+M+'">'+body+'</m:oMath>';warnings=[]
    return to_tex(ET.fromstring(source),warnings),warnings

def numbered(num='2',level=0,text='文献'):
    return '<w:p><w:pPr><w:numPr><w:ilvl w:val="'+str(level)+'"/><w:numId w:val="'+num+'"/></w:numPr></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>'+text+'</w:t></w:r></w:p>'

class SourceTests(unittest.TestCase):
    def test_numbered_references_starts_overrides_and_utf16_marks(self):
        numbering='<w:numbering xmlns:w="'+W+'"><w:abstractNum w:abstractNumId="7"><w:lvl w:ilvl="0"><w:start w:val="3"/><w:numFmt w:val="decimal"/><w:lvlText w:val="[%1]"/></w:lvl></w:abstractNum><w:num w:numId="2"><w:abstractNumId w:val="7"/></w:num><w:num w:numId="3"><w:abstractNumId w:val="7"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="10"/></w:lvlOverride></w:num></w:numbering>'
        r=import_docx(package(numbered(text='😀文献')+numbered()+numbered('3')+numbered(),{'word/numbering.xml':numbering}))
        self.assertEqual([b['text'] for b in r['blocks']],['[3] 😀文献','[4] 文献','[10] 文献','[5] 文献'])
        self.assertEqual(r['blocks'][0]['marks'],[{'start':4,'end':8,'bold':True}])
        self.assertEqual(r['importReports'][0]['counts']['importedNumberedParagraphs'],4)
        failed=import_docx(package(numbered()))
        self.assertEqual(failed['importReports'][0]['counts']['importedNumberedParagraphs'],0)
        self.assertTrue(any(d['severity']=='error' for d in failed['importReports'][0]['diagnostics']))

    def test_numbering_style_inheritance_and_sublevel_restart(self):
        numbering='<w:numbering xmlns:w="'+W+'"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1.%2"/></w:lvl></w:abstractNum><w:num w:numId="2"><w:abstractNumId w:val="0"/></w:num></w:numbering>'
        styles='<w:styles xmlns:w="'+W+'"><w:style w:styleId="base"><w:pPr><w:numPr><w:numId w:val="2"/></w:numPr></w:pPr></w:style><w:style w:styleId="child"><w:basedOn w:val="base"/></w:style></w:styles>'
        inherited='<w:p><w:pPr><w:pStyle w:val="child"/></w:pPr><w:r><w:t>章</w:t></w:r></w:p>'
        result=import_docx(package(inherited+numbered(level=1)+numbered(level=1)+inherited+numbered(level=1),{'word/numbering.xml':numbering,'word/styles.xml':styles}))
        self.assertEqual([b['text'].split()[0] for b in result['blocks']],['1.','1.1','1.2','2.','2.1'])

    def test_cached_fields_need_complete_boundaries_and_visible_result(self):
        def field(result):return '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText>REF target</w:instrText><w:fldChar w:fldCharType="separate"/><w:t>'+result+'</w:t><w:fldChar w:fldCharType="end"/></w:r></w:p>'
        r=import_docx(package(field('[12]')))
        self.assertEqual(r['blocks'][0]['text'],'[12]');self.assertFalse(any(d['severity']=='error' for d in r['importReports'][0]['diagnostics']))
        for body in [field(''),field('12').replace('<w:fldChar w:fldCharType="end"/>',''),'<w:p><w:r><w:instrText>REF target</w:instrText></w:r></w:p>']:
            self.assertTrue(any(d['severity']=='error' for d in import_docx(package(body))['importReports'][0]['diagnostics']))

    def test_footnote_symbol_uses_reference_order_not_note_id(self):
        settings='<w:settings xmlns:w="'+W+'"><w:footnotePr><w:numFmt w:val="chicago"/></w:footnotePr></w:settings>'
        notes='<w:footnotes xmlns:w="'+W+'">'+''.join('<w:footnote w:id="'+i+'"><w:p><w:r><w:t>说明</w:t></w:r></w:p></w:footnote>' for i in ('2','8'))+'</w:footnotes>'
        r=import_docx(package('<w:p><w:r><w:footnoteReference w:id="8"/><w:footnoteReference w:id="2"/></w:r></w:p>',{'word/settings.xml':settings,'word/footnotes.xml':notes}))
        self.assertEqual({n['id']:n['marker'] for n in r['notes']},{'8':'*','2':'†'})
        with tempfile.TemporaryDirectory() as folder:
            tex,_=build_tex({'blocks':r['blocks'],'notes':r['notes']},folder)
            self.assertIn(r'\renewcommand{\thefootnote}{*}',tex);self.assertEqual(tex.count('说明'),2)

    def test_complex_omml_keeps_styles_limits_matrix_and_source_digest(self):
        cases=[(run('x','<m:sty m:val="bi"/>'),r'\boldsymbol{x}'),
               ('<m:f><m:fPr><m:type m:val="noBar"/></m:fPr><m:num>'+run('n')+'</m:num><m:den>'+run('k')+'</m:den></m:f>',r'\genfrac{}{}{0pt}{}{n}{k}'),
               ('<m:eqArr><m:e>'+run('x=1')+'</m:e><m:e>'+run('y=2')+'</m:e></m:eqArr>',r'\begin{gathered}x=1 \\ y=2\end{gathered}'),
               ('<m:func><m:fName><m:limLow><m:e>'+run('lim','<m:sty m:val="p"/>')+'</m:e><m:lim>'+run('x→0')+'</m:lim></m:limLow></m:fName><m:e>'+run('f(x)')+'</m:e></m:func>',r'\underset{x\to 0}{\mathrm{lim}}\,f(x)'),
               ('<m:m><m:mr><m:e>'+run('1')+'</m:e><m:e>'+run('2')+'</m:e></m:mr><m:mr><m:e>'+run('3')+'</m:e><m:e>'+run('4')+'</m:e></m:mr></m:m>',r'\begin{matrix}1 & 2 \\ 3 & 4\end{matrix}')]
        for body,expected in cases:
            tex,warnings=convert(body);self.assertEqual(tex,expected);self.assertEqual(warnings,[])
            b=import_docx(package('<w:p><m:oMath>'+body+'</m:oMath><w:r><w:t>(12)</w:t></w:r></w:p>'))['blocks'][0]
            self.assertEqual(b['equationNumber'],'12');self.assertEqual(hashlib.sha256(b['sourceOmml'].encode()).hexdigest(),b['sourceSha256'])
        self.assertTrue(convert('<m:unsupported>'+run('x')+'</m:unsupported>')[1])

    def test_long_formula_breaks_keep_order_and_all_tokens(self):
        tex='A='+ '+'.join('x_{'+str(i)+'}' for i in range(100));broken=break_formula(tex)
        self.assertIn(r'\begin{gathered}',broken)
        cleaned=broken.replace(r'\begin{gathered}','').replace(r'\end{gathered}','').replace(r'\displaystyle ','').replace(r' \\ ','')
        self.assertEqual(cleaned,tex)

class PlacementTests(unittest.TestCase):
    def test_only_explicitly_rejected_multicol_trials_are_nonblocking(self):
        warning=r'Overfull \vbox (2pt too high) has occurred while \output is active []'
        start='Package multicol: Balance columns on input line 10:'
        retry='Package multicol: Balancing failed ... cut a normal page on input line 10.'
        self.assertEqual(compile_diagnostics(start+'\n'+warning+'\n'+retry),([],[warning]))
        for log in [warning,start+'\n'+warning,start+'\n'+warning+'\nPackage multicol: Column spec: 400pt\n'+retry]:
            self.assertEqual(compile_diagnostics(log),([warning],[]))
        horizontal=r'Overfull \hbox (5pt too wide) in paragraph at lines 1--2'
        self.assertEqual(compile_diagnostics(start+'\n'+horizontal+'\n'+retry),([horizontal],[]))

    @unittest.skipUnless(shutil.which('xelatex') or TEX_DEFAULT.exists(),'XeLaTeX unavailable')
    def test_short_journal_table_stays_together_and_math_cells_share_baseline(self):
        doc={'journal':{'template':'cn-academic'},'layout':{'fontSet':'fandol','width':170,'height':240,'columns':2},'blocks':[
          {'id':'lead','type':'paragraph','text':'用于分页的合成正文。'*80},
          {'id':'table','type':'table','placement':'full-width','text':'表 1 合成短表','rows':[['[[math:a]]','[[math:b]]','标题']]+[[str(i),'值','结果'] for i in range(7)],'inlineMath':[{'id':'a','text':'x_i'},{'id':'b','text':'y_i'}]}]}
        result=render_pdf(doc);positions=result['objectPositions']
        self.assertEqual(positions['table']['start']['page'],positions['table']['end']['page'])
        self.assertAlmostEqual(positions['table:a']['start']['yPt'],positions['table:b']['start']['yPt'],delta=1)
        with tempfile.TemporaryDirectory() as folder:
            source,_=build_tex(doc,folder);self.assertIn(r'\begin{tabular}',source)
            doc['blocks'][-1]['rows'] += [['长表','继续','数据'] for _ in range(60)]
            source,_=build_tex(doc,folder);self.assertIn(r'\begin{longtable}',source)

    def test_promoted_inline_formula_keeps_closing_punctuation(self):
        doc={'journal':{'template':'cn-academic'},'layout':{'columns':2},'blocks':[{'id':'p','type':'paragraph','text':'条件（[[math:m]])，成立。','inlineMath':[{'id':'m','text':'x+y'}]}]}
        with tempfile.TemporaryDirectory() as folder:
            source,_=build_tex(doc,folder,{'p:m':200})
            self.assertIn(r'x+y\text{)，}',source)
            self.assertNotIn(r'\noindent )，',source)

    def test_caption_group_and_anchors_reorder_without_mutating_source(self):
        blocks=[{'id':'img','type':'image','captionIds':['cap'],'anchor':{'targetId':'p','position':'after','maxPageDistance':1}},{'id':'cap','type':'paragraph','text':'图 1'},{'id':'p','type':'paragraph','text':'见图 1'},{'id':'title','type':'paragraph','text':'题名','role':'title-zh'}]
        prepared,_=prepare_blocks({'journal':{'template':'cn-academic'},'blocks':blocks})
        self.assertEqual([b['id'] for b in prepared],['title','p','img']);self.assertEqual(len(blocks),4)
        blocks[0]['anchor']['targetId']='cap'
        with self.assertRaises(ValueError):prepare_blocks({'blocks':blocks})

    def test_relation_gate_and_source_coverage_do_not_confuse_booklet_order(self):
        doc={'blocks':[{'id':'p','type':'paragraph'},{'id':'img','type':'image','captionIds':['cap'],'anchor':{'targetId':'p','position':'after','maxPageDistance':1}},{'id':'cap','type':'paragraph'}]}
        def point(page):return {'start':{'page':page},'end':{'page':page}}
        logical={'p':point(1),'img':point(2),'cap':point(2)};physical={'p':point(2),'img':point(1),'cap':point(1)}
        result=relation_report(doc,physical,logical);self.assertEqual(result['relations'][0]['status'],'PASS');self.assertEqual(result['sourceObjectCoverage']['missing'],[])
        logical['cap']=point(3);self.assertTrue(any(d['code']=='CAPTION_SEPARATED' for d in relation_report(doc,physical,logical)['diagnostics']))
        del logical['img'];self.assertTrue(any(d['code']=='SOURCE_OBJECT_NOT_LOCATED' for d in relation_report(doc,physical,logical)['diagnostics']))

    @unittest.skipUnless(shutil.which('xelatex') or TEX_DEFAULT.exists(),'XeLaTeX unavailable')
    def test_real_destinations_math_headers_cell_styles_notes_and_imposition(self):
        # The same local inline ID in two blocks must remain two distinct objects.
        doc={'layout':{'fontSet':'fandol','width':170,'height':240,'columns':2},'blocks':[
          {'id':'p','type':'paragraph','text':'引用[[math:x]]','inlineMath':[{'id':'x','text':'x^2'}]},
          {'id':'table','type':'table','placement':'full-width','captionIds':['cap'],'anchor':{'targetId':'p','position':'after','maxPageDistance':1},'rows':[['[[math:x]]','表头'],['3','值[^note]']]+[[str(i),'跨页表格测试'] for i in range(45)],'headerRows':1,'inlineMath':[{'id':'x','text':'x^3'}],'cellMarks':[{'row':1,'col':0,'marks':[{'start':0,'end':1,'superscript':True}]},{'row':1,'col':1,'marks':[{'start':0,'end':9,'bold':True}]}]},
          {'id':'cap','type':'paragraph','text':'表 1 示例'}], 'notes':[{'id':'note','text':'表内说明','marker':'*'}]}
        result=render_pdf(doc);positions=result['objectPositions']
        self.assertTrue({'p','p:x','table','table:x','cap'}<=positions.keys())
        self.assertEqual(positions['table:x']['start']['page'],positions['table']['start']['page'])
        self.assertGreater(positions['table']['end']['page'],positions['table']['start']['page'])
        output=process_pdf(result['pdf'],{'booklet':True,'cropMarks':True,'bleedMm':3})
        mapped=final_positions(positions,result['pdf'],output['pdf'],output['report']);self.assertEqual(mapped.keys(),positions.keys())
        self.assertTrue(all(v['start']['xPt']>=0 and v['start']['yPt']>=0 for v in mapped.values()))
        with tempfile.TemporaryDirectory() as folder:
            tex,_=build_tex(doc,folder);self.assertEqual(tex.count('shuye-start-table:x'),1);self.assertEqual(tex.count('表内说明'),1)
            self.assertIn(r'\textsuperscript{3}',tex);self.assertIn(r'\textsuperscript{*}',tex)

if __name__=='__main__':unittest.main()
