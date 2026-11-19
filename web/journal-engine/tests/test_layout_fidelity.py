from copy import deepcopy
from pathlib import Path
import tempfile,unittest,os
from io import BytesIO
from publishing import build_tex,render_pdf
from journal import prepare_blocks,relation_report

def document():
    return {'layout':{'fontSet':'founder-sample'},'journal':{'template':'cn-academic','headerFontSize':8.85,'headerLeading':12,'roleStyles':{'abstract-zh':{'fontFamily':'fangsong','leftIndentMm':7.4,'rightIndentMm':1,'firstLineIndentPt':18}},'excludedParagraphs':[{'blockId':'residue','sourceText':'ob25 mg·L-1','reason':'作者确认模板残留'}]},'blocks':[{'id':'residue','type':'paragraph','text':'ob25 mg·L-1'},{'id':'body','type':'paragraph','role':'abstract-zh','text':'摘要：原始正文保留'}]}
class LayoutFidelityTests(unittest.TestCase):
    def test_source_bound_rule_exclusion_and_join_retain_every_text_destination(self):
        import base64
        from PIL import Image
        stream=BytesIO();Image.new('RGB',(10,1),'black').save(stream,format='PNG')
        src='data:image/png;base64,'+base64.b64encode(stream.getvalue()).decode()
        d=document();d['journal']['excludedParagraphs']=[]
        d['blocks']=[{'id':'a','type':'paragraph','text':'作者提'},{'id':'rule','type':'image','src':src},{'id':'b','type':'paragraph','text':'出了定理。'}]
        d['journal'].update(excludedImages=[{'blockId':'rule','sourceSrc':src,'reason':'作者确认排除横线'}],paragraphJoins=[{'blockIds':['a','b'],'separator':''}])
        original=deepcopy(d)
        with tempfile.TemporaryDirectory() as folder:tex,_=build_tex(d,folder)
        for ident in ['a','b']:
            for edge in ['start','end']:self.assertEqual(tex.count('(shuye-'+edge+'-'+ident+')'),1)
        self.assertIn('作者提',tex);self.assertIn('出了定理。',tex);self.assertEqual(d,original)
        d['blocks'][2]['text']='出了定理 [[math:m]]。';d['blocks'][2]['inlineMath']=[{'id':'m','text':'x^2'}]
        with tempfile.TemporaryDirectory() as folder:tex,_=build_tex(d,folder)
        self.assertIn('(shuye-start-b:m)',tex);self.assertIn('x^2',tex)
        d['blocks'][1]['src']+='changed'
        with self.assertRaises(ValueError):prepare_blocks(d)
    def test_exclusion_preserves_source_and_separates_coverage(self):
        d=document();original=deepcopy(d);blocks,_=prepare_blocks(d)
        self.assertEqual([b['id'] for b in blocks],['body']);self.assertEqual(d,original)
        report=relation_report(d,{'body':{'start':{},'end':{}}})
        self.assertEqual(report['sourceObjectCoverage'],{'expected':1,'mapped':1,'missing':[]})
        self.assertEqual(report['excludedParagraphs'],d['journal']['excludedParagraphs'])
        d['blocks'][0]['text']='变更后的正文'
        with self.assertRaises(ValueError):prepare_blocks(d)
    def test_fonts_and_insets_reach_tex_without_erasing_source(self):
        d=document()
        with tempfile.TemporaryDirectory() as folder:tex,_=build_tex(d,folder)
        for command in ['FZFangSong-Z02','FZKai-Z03',r'\leftskip=7.4mm',r'\rightskip=1.0mm',r'\setlength{\parindent}{18.0pt}',r'\setlength{\headheight}{24.0pt}']:self.assertIn(command,tex)
        self.assertNotIn('ob25',tex);self.assertIn('原始正文保留',tex)
    @unittest.skipUnless(os.environ.get('SHUYE_TEST_SAMPLE_FONTS')=='1','Private licensed fonts required')
    def test_real_pdf_scripts_and_custom_note_rule_do_not_overflow_columns(self):
        import pdfplumber
        d=document();d['layout'].update(columns=2,width=210,height=297)
        d['journal'].update(latinFont='times',latinTrackingPercent=1.020408)
        d['journal']['annotations']={'noteRuleThicknessPt':.369881875,'noteRuleAfterPt':6.01}
        d['journal']['roleStyles']['title-zh']={'cjkTrackingPt':.98927*72.27/72,'latinTrackingPercent':3.061224}
        d['blocks']=[{'id':'title','type':'paragraph','role':'title-zh','text':'标题H2O[^note]','marks':[{'start':3,'end':4,'subscript':True}]},{'id':'body','type':'paragraph','text':'正文包含 Y-O-Ni 结构与 FP-TZ-AAC 的实验结果，记录变量 V 和质量 m。'*100}]
        d['journal']['excludedParagraphs']=[];d['notes']=[{'id':'note','text':'原稿注释保持不变。'}]
        result=render_pdf(d);self.assertEqual(result['compileMessages'],[])
        with pdfplumber.open(BytesIO(result['pdf'])) as pdf:
            chars=pdf.pages[0].chars;h=next(c for c in chars if c['text']=='H');two=next(c for c in chars if c['text']=='2')
            self.assertAlmostEqual(two['size']/h['size'],.53,delta=.003)
            a=next(c for c in chars if c['text']=='标');b=next(c for c in chars if c['text']=='题')
            self.assertAlmostEqual(b['x0']-a['x1'],.98927,delta=.02)
    @unittest.skipUnless(os.environ.get('SHUYE_TEST_SAMPLE_FONTS')=='1','Private licensed fonts required')
    def test_narrow_multiline_title_keeps_centering_with_measured_insets(self):
        import pdfplumber
        d=document();d['layout'].update(width=210,height=297,inner=20,outer=20)
        d['journal'].update(latinFont='times',excludedParagraphs=[],roleStyles={'title-en':{'fontSize':11.8,'leading':17.2,'leftIndentMm':30,'rightIndentMm':30,'latinTrackingPercent':3.061224}})
        d['journal']['roleStyles']['abstract-zh']={'fontSize':8.85,'fontFamily':'fangsong','bold':False}
        d['blocks']=[{'id':'title','type':'paragraph','role':'title-en','text':'A sufficiently long English academic title with several words to inspect centered line wrapping'},{'id':'abstract','type':'paragraph','role':'abstract-zh','text':'摘要：正文使用仿宋。'}]
        result=render_pdf(d);self.assertEqual(result['compileMessages'],[])
        with pdfplumber.open(BytesIO(result['pdf'])) as pdf:
            lines=[l for l in pdf.pages[0].extract_text_lines() if any(abs(c['size']-11.8*72/72.27)<.03 for c in l['chars'])]
            self.assertGreater(len(lines),1)
            for line in lines:self.assertAlmostEqual((line['x0']+line['x1'])/2,pdf.pages[0].width/2,delta=.5)
            chars=pdf.pages[0].chars
            self.assertIn('FZHTK',next(c for c in chars if c['text']=='摘')['fontname'])
            self.assertIn('FZFSK',next(c for c in chars if c['text']=='正')['fontname'])
