"""Source-neutral reproductions of actual online journal output defects."""
from copy import deepcopy
import unittest
from compile_report import compiler_report
from math_layout import break_formula
from publishing import render_pdf
from proof import render_proof, text_geometry
from test_journal_calibration import document, AVAILABLE


class CompilerEvidenceTests(unittest.TestCase):
    def test_missing_glyph_has_all_candidate_cells_and_notes_not_a_guessed_page(self):
        d={'blocks':[{'id':'t','type':'table','rows':[['浓度/μmol','μmol']]}],
           'notes':[{'id':'n','text':'单位μmol'}]}
        warning='Missing character: There is no μ (U+03BC) in font lmroman8-regular!'
        result=compiler_report([warning,warning],'',d)
        self.assertEqual(len(result),1)
        self.assertEqual(result[0]['code'],'TEX_MISSING_GLYPH')
        self.assertEqual(result[0]['character'],'μ')
        self.assertEqual(result[0]['totalSourceLocations'],3)
        self.assertEqual(result[0]['sourceLocations'][1]['col'],1)
        self.assertEqual(result[0]['sourceLocations'][2]['objectId'],'note:n')
        self.assertNotIn('page',result[0])

    def test_overfull_gather_reports_both_candidates_not_just_last_row(self):
        source='\n'.join([r'\begin{gather*}',
          r'\special{pdf:dest (shuye-start-e1)} x \special{pdf:dest (shuye-end-e1)}\\',
          r'\special{pdf:dest (shuye-start-e2)} y \special{pdf:dest (shuye-end-e2)}\end{gather*}'])
        result=compiler_report([r'Overfull \hbox (12pt too wide) detected at line 3'],source,{})
        self.assertEqual(result[0]['candidateObjectIds'],['e1','e2'])

    def test_nonwrapping_punctuation_and_scripts_are_unchanged(self):
        value=r'x\mathrm{=|}y\mathrm{|}'
        self.assertEqual(break_formula(value),value)
        nested=r'\frac{a+b+c}{d+e+f}'
        self.assertEqual(break_formula(nested,width_ratio=.2),nested)

    def test_wrapped_list_separator_stays_at_end_of_preceding_line(self):
        result=break_formula('abcdefghijklmnopqrst,uvwxyzabcdefghijklmno',width_ratio=.5)
        self.assertIn(r'abcdefghijklmnopqrst, \\ \displaystyle uvw',result)


@unittest.skipUnless(AVAILABLE,'XeLaTeX unavailable')
class ActualPdfRegressions(unittest.TestCase):
    def test_greek_units_and_superior_symbols_survive_without_changing_source(self):
        d=document([{'id':'p','type':'paragraph','text':'单位μmol，角度2θ，Crδ+，δ>3，微量µmol。',
                     'marks':[{'start':16,'end':18,'superscript':True}]},
                    {'id':'t','type':'table','headerRows':0,'rows':[['浓度/μmol','δ>3']]}])
        original=deepcopy(d);r=render_pdf(d)
        text=''.join(l['text'] for p in text_geometry(r['pdf'])['pages'] for l in p['lines'])
        for glyph in ['μ','θ','δ','µ']:self.assertIn(glyph,text)
        self.assertNotIn('(cid:0)',text)
        self.assertEqual(r['compileMessages'],[]);self.assertEqual(d,original)

    def test_first_english_word_in_narrow_table_cell_can_hyphenate(self):
        d=document([{'id':'t','type':'table','headerRows':0,'borderStyle':'three-line',
                     'rows':[['Dispersion/%','Result'],['6.1','8.2']], 'columnWidths':[.15,.85]}],inner=20,outer=20)
        r=render_pdf(d);self.assertEqual(r['compileMessages'],[])
        text=''.join(l['text'] for p in text_geometry(r['pdf'])['pages'] for l in p['lines'])
        self.assertIn('Dispersion/%',text.replace('-','').replace(' ',''))

    def test_dense_inline_paragraph_wraps_at_same_body_size(self):
        d=document([{'id':'p','type':'paragraph','text':'其中，若[[math:c]]为效益型参数，则[[math:a]]；若为成本型，则[[math:b]]。',
                     'inlineMath':[{'id':'c','text':r'{C}_{j}'},
                       {'id':'a','text':r'r_{ij}=\frac{f_{ij}}{\sqrt{\sum\nolimits_{i=1}^{p}f_{ij}^{2}}}'},
                       {'id':'b','text':r'r_{ij}=1-\frac{f_{ij}}{\sqrt{\sum\nolimits_{i=1}^{p}f_{ij}^{2}}},\mathrm{i=1,2,\ldots,p,j=1,2,\ldots,q}'}]}],inner=19.71,outer=16.56)
        d['journal']['inlineDisplayThreshold']=.9
        original=deepcopy(d);r=render_pdf(d);self.assertEqual(r['compileMessages'],[]);self.assertEqual(d,original)
        pos=r['objectPositions'];self.assertGreater(pos['p']['end']['yPt'],pos['p']['start']['yPt'])
        self.assertEqual(set(pos),{'p','p:c','p:a','p:b'})

    def test_compound_upright_relations_wrap_a_measured_display(self):
        term=lambda k:r'{Prj}_{Y_'+k+r'Y^+}\left(Y^-Y^+\right)'
        value=term('1')+r'\mathrm{=|}Y^-Y^+\mathrm{|}\cos\mathrm{(}Y^-Y_1,Y^-Y^+\mathrm{)<|}Y^-Y^+\mathrm{|}\cos\mathrm{(}Y^-Y_2,Y^-Y^+\mathrm{)=}'+term('2')
        d=document([{'id':'e','type':'equation','text':value,'equationSuffix':'，'}],inner=30,outer=30)
        original=deepcopy(d);r=render_pdf(d);self.assertEqual(r['compileMessages'],[]);self.assertEqual(d,original)
        self.assertIn('e',r['objectPositions'])

    def test_missing_cjk_is_still_blocked_with_page_and_source_identity(self):
        d=document([{'id':'ref','type':'paragraph','text':'引用作者：啟。'}])
        r=render_proof(d)['report'];missing=next(x for x in r['quality']['diagnostics'] if x['code']=='TEX_MISSING_GLYPH')
        self.assertEqual(missing['character'],'啟')
        self.assertEqual(missing['sourceLocations'][0]['objectId'],'ref')
        self.assertEqual(missing['sourceLocations'][0]['pages'],[1,1])
        self.assertEqual(r['quality']['status'],'BLOCKED');self.assertFalse(r['quality']['productionReady'])

if __name__=='__main__':unittest.main()
