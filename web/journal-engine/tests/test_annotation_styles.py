"""Real-PDF regressions for publication notes and independently flowing references."""
import unittest
from io import BytesIO
from statistics import median
import pdfplumber
from publishing import render_pdf


class AnnotationStyleTests(unittest.TestCase):
    def source(self):
        return {'layout':{'fontSet':'fandol','width':210,'height':285,'columns':1,'fontSize':10.5},
                'journal':{'template':'cn-academic','articleNoteId':'pub',
                    'annotations':{'noteMarker':'hidden','noteIndentMm':6.13,'noteLabelWidthMm':15.17,'referenceColumns':2,'referenceIndentMm':9,
                                   'noteRuleWidthMm':36.668,'noteRuleThicknessPt':.3685*72.27/72,'noteRuleAfterPt':7.45},
                    'roleStyles':{'article-note':{'fontSize':8.853075,'leading':10.302991875},
                                  'reference':{'fontSize':8.853075,'leading':14.2432125}}},
                'notes':[{'id':'pub','marker':'9','text':'收稿日期：2026-04-14。\n基金项目：基金示例。\n作者简介：作者。'},
                         {'id':'ordinary','marker':'7','text':'Ordinary footnote'}],
                'blocks':[{'id':'title','type':'paragraph','role':'title-zh','text':'TITLE[^pub]'},
                          {'id':'body','type':'paragraph','text':'Body[^ordinary] with repeated publication note[^pub].'},
                          {'id':'refs','type':'heading','text':'参考文献：','level':1}]+
                         [{'id':f'r{i}','type':'paragraph','role':'reference','text':f'[{i}] '+('Author. Reference title and source journal. '*3)} for i in range(1,15)]}

    def test_real_pdf_note_size_leading_marker_and_reference_columns(self):
        result=render_pdf(self.source())
        self.assertEqual(result['compileMessages'],[])
        with pdfplumber.open(BytesIO(result['pdf'])) as pdf:
            first=pdf.pages[0];lines=first.extract_text_lines()
            title=next(l for l in lines if 'TITLE' in l['text'])
            self.assertEqual(title['text'],'TITLE')
            body=next(l for l in lines if l['text'].startswith('Body'))
            self.assertIn('7',body['text']);self.assertNotIn('9',body['text'])
            notes=[next(l for l in lines if name in l['text']) for name in ['收稿日期','基金项目','作者简介']]
            self.assertAlmostEqual(median(c['size'] for c in notes[0]['chars']),8.82,delta=.03)
            self.assertAlmostEqual(notes[1]['top']-notes[0]['top'],10.2645,delta=.03)
            self.assertAlmostEqual(notes[0]['x0'],(24+6.13)*72/25.4,delta=.15)
            rule=next(line for line in first.lines if 103<line['width']<105 and line['top']>400)
            self.assertAlmostEqual(rule['width'],103.942,delta=.03)
            self.assertAlmostEqual(rule['linewidth'],.3685,delta=.005)
            alltext=''.join(p.extract_text() for p in pdf.pages)
            self.assertIn('Ordinaryfootnote',alltext.replace(' ',''))
            refs=[w for p in pdf.pages for w in p.extract_words() if w['text'].startswith('[')]
            self.assertTrue(any(w['x0']<200 for w in refs))
            self.assertTrue(any(w['x0']>290 for w in refs))

    def test_citation_size_and_rise_preserve_inline_citations_and_numbers(self):
        source=self.source();body=source['blocks'][1]
        body['text']='Citation [12] and inline [3].'
        body['marks']=[{'start':9,'end':13,'superscript':True}]
        source['journal']['annotations'].update(citationSuperscriptSize=5.45349*72.27/72,citationRisePt=4.19946*72.27/72,citationInlineSize=10.2899*72.27/72)
        result=render_pdf(source);self.assertEqual(result['compileMessages'],[])
        with pdfplumber.open(BytesIO(result['pdf'])) as pdf:
            chars=pdf.pages[0].chars;one=next(c for c in chars if c['text']=='1');three=next(c for c in chars if c['text']=='3');normal=next(c for c in chars if c['text']=='C')
            self.assertAlmostEqual(one['size'],5.45349,delta=.03)
            self.assertAlmostEqual(three['size'],10.2899,delta=.03)
            self.assertAlmostEqual(one['matrix'][5]-normal['matrix'][5],4.19946,delta=.03)

    def test_empty_source_note_preserves_marker_without_empty_footer(self):
        source=self.source();source['notes'][1]['text']=''
        result=render_pdf(source)
        self.assertEqual(result['compileMessages'],[])
        self.assertIn('note:ordinary',result['objectPositions'])

    def test_exact_brackets_in_bold_heading_do_not_request_synthetic_simsun(self):
        from font_inventory import probe_fonts
        if not probe_fonts()['profiles']['annotations']['founder-sample']['available']:
            self.skipTest('Licensed sample fonts are not installed')
        source=self.source()
        source['journal']['annotations']['fontSet']='founder-sample'
        source['notes'][0]['text']='作者简介: 作者。'
        source['blocks'][1]={'id':'body','type':'heading','level':1,'text':'定理 [12]', 'bold':True}
        result=render_pdf(source)
        self.assertEqual(result['compileMessages'],[])
        with pdfplumber.open(BytesIO(result['pdf'])) as pdf:
            brackets=[c for c in pdf.pages[0].chars if c['text'] in '［］']
            self.assertTrue(brackets)
            self.assertTrue(all(c['fontname'].endswith('SimSun') for c in brackets))
            colon=next(c for c in pdf.pages[0].chars if c['text']=='：')
            self.assertTrue(colon['fontname'].endswith('FZHTK--GBK1-0'))

    def test_single_column_references_after_two_column_body(self):
        # A standalone single-column reference section must also work when the
        # body itself used two columns (the inverse of the first regression).
        source=self.source();source['layout']['columns']=2
        source['journal']['annotations']['referenceColumns']=1
        result=render_pdf(source)
        self.assertEqual(result['compileMessages'],[])
        with pdfplumber.open(BytesIO(result['pdf'])) as pdf:
            labels=[w for p in pdf.pages for w in p.extract_words() if w['text'].startswith('[')]
            self.assertTrue(labels);self.assertTrue(all(w['x0']<100 for w in labels))

if __name__=='__main__':unittest.main()
