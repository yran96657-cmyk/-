from io import BytesIO
import tempfile
from pathlib import Path
import unittest
import os
from docx import Document
from publishing import render_pdf
from proof import text_geometry
from editable_docx import export_article

class ApiStyleTests(unittest.TestCase):
    def sample(self):
        return {'layout':{'fontSet':'fandol','width':210,'height':285,'header':'ODD HEADER','headerEven':'EVEN HEADER','footer':'{page}','footerEven':'{page}','pageStart':11},
                'journal':{'template':'cn-academic','name':'Test','roleStyles':{'title-zh':{'fontSize':15}}},
                'blocks':[{'id':'title','type':'paragraph','role':'title-zh','text':'API Title','fontSize':8,'bold':False,'journalStyle':{'fontSize':18,'bold':True,'align':'center'}},
                          {'id':'p','type':'paragraph','text':'Body with note[^n]'}, {'id':'b2','type':'pageBreak'}, {'id':'p2','type':'paragraph','text':'Second page'},
                          {'id':'b3','type':'pageBreak'},{'id':'p3','type':'paragraph','text':'Third page'}],
                'notes':[{'id':'n','text':'Preserved note'}]}

    def test_explicit_role_style_and_plain_folios_reach_real_pdf(self):
        source=self.sample();result=render_pdf(source);geometry=text_geometry(result['pdf'])
        self.assertEqual(geometry['outside'],[]);self.assertEqual(len(geometry['pages']),3)
        for i,page in enumerate(geometry['pages']):
            text='\n'.join(line['text'] for line in page['lines'])
            self.assertIn('EVEN HEADER' if i==1 else 'ODD HEADER',text)
            foot=[line['text'].strip() for line in page['lines'] if line['bboxPt'][1]>page['heightPt']*.85]
            self.assertIn(str(11+i),foot)
        title=next(line for line in geometry['pages'][0]['lines'] if line['text'].strip()=='API Title')
        self.assertAlmostEqual(title['fontSizesPt'][0],18,delta=.15)
        self.assertTrue(any('Bold' in f for f in title['fonts']))
        self.assertIn('Preserved note',''.join(line['text'] for page in geometry['pages'] for line in page['lines']))

    def test_word_uses_same_explicit_size_and_weight(self):
        with tempfile.TemporaryDirectory() as folder:
            target=Path(folder)/'sample.docx';export_article({'document':self.sample()},{'width':210,'height':285,'title':'Test'},target,11)
            d=Document(target);title=next(p for p in d.paragraphs if p.text=='API Title')
            self.assertTrue(all(r.font.size.pt==18 and r.bold for r in title.runs))

    @unittest.skipUnless(os.environ.get('SHUYE_NOTO_FONT_DIR'),'Portable Noto fallback not configured')
    def test_fallback_preserves_rare_reference_characters(self):
        source=self.sample();source['blocks'].append({'id':'rare','type':'paragraph','text':'作者王玥，李啟。'})
        result=render_pdf(source);text=''.join(line['text'] for p in text_geometry(result['pdf'])['pages'] for line in p['lines'])
        self.assertIn('王玥',text);self.assertIn('李啟',text)

if __name__=='__main__':unittest.main()
