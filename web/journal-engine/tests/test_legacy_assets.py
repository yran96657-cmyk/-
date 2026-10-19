from copy import deepcopy
from io import BytesIO
import base64
import json
from pathlib import Path
import shutil
import struct
import tempfile
import unittest
from zipfile import ZipFile
from legacy_fixtures import char,line,template,mtef,ole,emf
from mtef import convert_ole
from mtef_reader import MtefError
from docx_import import import_docx
from emf import convert_emfs,read_emf,validate_vector_source,validate_vector_pdf
from publishing import build_tex,render_pdf
from proof import render_proof,text_geometry
from test_docx_v2 import package
from test_journal_calibration import document,AVAILABLE


def legacy_doc(raw):
    body='<w:p><w:r><w:object xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><o:OLEObject ProgID="Equation.DSMT4" r:id="eq"/></w:object></w:r></w:p>'
    return package(body,{'word/embeddings/a.bin':raw,'word/_rels/document.xml.rels':'<Relationships><Relationship Id="eq" Target="embeddings/a.bin"/></Relationships>'})


class LegacyTests(unittest.TestCase):
    def test_nested_native_fraction_script_and_empty_are_lossless(self):
        data=template(11,line(char('a')+template(28,line(),line(char('2')))),line(char('b')))+char('≥',6)+char('0')
        converted=convert_ole(ole(mtef(data)))
        self.assertEqual(converted['text'],r'\frac{a^{2}}{b}\ge 0');self.assertEqual(converted['characters'],5);self.assertEqual(converted['structures'],2)
        empty=convert_ole(ole(mtef()));self.assertEqual(empty['text'],'{}');self.assertTrue(empty['empty'])
        d=import_docx(legacy_doc(ole(mtef(data))));self.assertEqual(d['blocks'][0]['legacySource']['originalTex'],converted['text'])
        self.assertEqual(d['importReports'][0]['counts']['importedLegacyMath'],1)
        self.assertFalse(any(x['severity']=='error' for x in d['importReports'][0]['diagnostics']))

    def test_unsupported_truncated_trailing_and_unknown_glyph_never_fall_back(self):
        for raw in [mtef(char('x'))[:-1],mtef(char('x'))+b'x',mtef(b'\x64'),mtef(char('\ue123')),mtef(template(99,line(char('x')))),mtef(b'\x02\x40')]:
            with self.assertRaises((MtefError,ValueError)):convert_ole(ole(raw))
            result=import_docx(legacy_doc(ole(raw)))
            self.assertEqual(result['importReports'][0]['counts']['importedLegacyMath'],0)
            self.assertTrue(any(x['severity']=='error' for x in result['importReports'][0]['diagnostics']))

    def test_custom_reference_mark_and_one_alternate_branch(self):
        body='<w:p><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="w14"><w:r><w:t>ONCE</w:t></w:r></mc:Choice><mc:Fallback><w:r><w:t>DUPLICATE</w:t></w:r></mc:Fallback></mc:AlternateContent><w:r><w:footnoteReference w:id="1" w:customMarkFollows="1"/><w:t>*</w:t></w:r></w:p>'
        notes='<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:footnote w:id="1"><w:p><w:r><w:t>Note</w:t></w:r></w:p></w:footnote></w:footnotes>'
        d=import_docx(package(body,{'word/footnotes.xml':notes}));self.assertEqual(d['blocks'][0]['text'],'ONCE[^1]');self.assertEqual(d['notes'][0]['marker'],'*')

    @unittest.skipUnless(AVAILABLE,'XeLaTeX unavailable')
    def test_actual_pdf_native_ledger_and_tampering_gate(self):
        d=import_docx(legacy_doc(ole(mtef(template(11,line(char('a')),line(char('b')))))));d.update(document(d['blocks']))
        r=render_proof(d)['report'];self.assertEqual(r['compileMessages'],[]);self.assertEqual(r['legacyMathCoverage']['verifiedSources'],1)
        d['blocks'][0]['legacySource']['characters']+=1
        r=render_proof(d)['report'];self.assertTrue(any(x['code']=='MTEF_SOURCE_INVALID' for x in r['quality']['diagnostics']));self.assertFalse(r['quality']['productionReady'])

    def test_continued_equations_use_one_measure_and_keep_introduction(self):
        d=document([{'id':'p','type':'paragraph','text':'由此得到'}, {'id':'a','type':'equation','text':'x=y'}, {'id':'b','type':'equation','text':r'\ge z'}],columns=2)
        with tempfile.TemporaryDirectory() as folder:
            tex,_=build_tex(d,folder,{'a':200,'b':50});run=tex[tex.index(r'\begin{gather*}'):tex.index(r'\end{gather*}')]
            self.assertNotIn('multicols',run);self.assertIn(r'\\*',run)

    @unittest.skipUnless(AVAILABLE,'XeLaTeX unavailable')
    def test_relation_before_inline_formula_joins_display_without_losing_ids(self):
        d=document([{'id':'a','type':'equation','text':'a+b+c+d+e+f+g+h+i+j+k+l+m+n=x'}, {'id':'b','type':'paragraph','text':'   = [[math:m]],','inlineMath':[{'id':'m','text':'y+z'}]}],columns=2)
        original=deepcopy(d);r=render_proof(d)['report']
        self.assertEqual(r['compileMessages'],[]);self.assertEqual(r['semanticLayout']['sourceObjectCoverage']['missing'],[]);self.assertEqual(d,original)
        self.assertIn('b:m',r['semanticLayout']['objects'])


class EmfTests(unittest.TestCase):
    def test_static_page_view_is_allowed_but_actions_and_foreign_destinations_are_not(self):
        from pypdf import PdfWriter
        from pypdf.generic import ArrayObject,NameObject,NumberObject,NullObject,DictionaryObject,TextStringObject
        def asset(view):
            writer=PdfWriter();page=writer.add_blank_page(width=200,height=100)
            writer._root_object[NameObject('/OpenAction')]=view(page.indirect_reference)
            buffer=BytesIO();writer.write(buffer);return buffer.getvalue()
        validate_vector_pdf(asset(lambda ref:ArrayObject([ref,NameObject('/XYZ'),NullObject(),NullObject(),NumberObject(0)])))
        validate_vector_pdf(asset(lambda ref:ArrayObject([ref,NameObject('/Fit')])))
        for value in [
            lambda ref:DictionaryObject({NameObject('/S'):NameObject('/JavaScript'),NameObject('/JS'):TextStringObject('test')}),
            lambda ref:ArrayObject([TextStringObject('outside.pdf'),NameObject('/Fit')]),
            lambda ref:ArrayObject([NumberObject(1),NameObject('/Fit')]),
            lambda ref:ArrayObject([ref,NameObject('/XYZ'),TextStringObject('unsafe'),NullObject(),NumberObject(0)]),
        ]:
            with self.assertRaises(ValueError):validate_vector_pdf(asset(value))

    def test_record_bounds_and_normalization_ledger(self):
        raw=emf('（a）');normalized,text,changes,fonts=read_emf(raw)
        self.assertEqual(text,'(a)');self.assertEqual([n['to'] for n in changes],['(',')']);self.assertNotEqual(raw,normalized)
        self.assertEqual(fonts,['Liberation Serif'])
        for value in [raw[:-1],raw[:48]+struct.pack('<I',12)+raw[52:]]:
            with self.assertRaises(ValueError):read_emf(value)

    @unittest.skipUnless(shutil.which('soffice'),'LibreOffice Draw unavailable')
    def test_real_vector_conversion_export_and_text_integrity(self):
        original=emf('Result （a）');a=convert_emfs({'word/media/a.emf':original})['word/media/a.emf'];s=a['vectorSource']
        pdf=base64.b64decode(s['pdf']);validate_vector_source(s,pdf,original)
        self.assertEqual(base64.b64decode(s['data']),original);self.assertEqual(len(s['normalizations']),2)
        d=document([{'id':'i','type':'image','text':'',**a}]);r=render_pdf(d)
        self.assertEqual(r['compileMessages'],[])
        text=''.join(l['text'] for p in text_geometry(r['pdf'])['pages'] for l in p['lines'])
        self.assertIn('Result(a)',text.replace(' ',''))
        bad=deepcopy(s);bad['text']='Lost text'
        with self.assertRaises(ValueError):validate_vector_source(bad,pdf,original)
        d['blocks'][0]['src']='data:image/png;base64,AAAA'
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(ValueError,'摘要'):build_tex(d,folder)

    @unittest.skipUnless(AVAILABLE,'XeLaTeX unavailable')
    def test_top_float_continues_body_and_retains_caption_and_anchor(self):
        from test_cell_images import png
        blocks=[{'id':'lead','type':'paragraph','text':'图见下页。'}, {'id':'im','type':'image','text':'','src':'data:image/png;base64,'+base64.b64encode(png()).decode(),'placement':'full-width','floatPlacement':'top','captionIds':['cap'],'anchor':{'targetId':'lead','position':'after','maxPageDistance':2}}, {'id':'cap','type':'paragraph','text':'SYNTHETIC_CAPTION'}, *[{'id':'p'+str(i),'type':'paragraph','text':'这里是检查图文浮动后内容连续性的合成正文。'*12} for i in range(8)]]
        d=document(blocks,columns=2);r=render_proof(d)['report'];self.assertEqual(r['compileMessages'],[])
        self.assertEqual(r['semanticLayout']['sourceObjectCoverage']['missing'],[])
        self.assertTrue(all(x['status']=='PASS' for x in r['semanticLayout']['relations']))

    @unittest.skipUnless(AVAILABLE,'XeLaTeX unavailable')
    def test_deferred_body_figure_cannot_interrupt_references(self):
        from test_cell_images import png
        blocks=[{'id':'body','type':'paragraph','text':'完整正文。'*12},
                {'id':'im','type':'image','text':'','src':'data:image/png;base64,'+base64.b64encode(png()).decode(),'placement':'full-width','floatPlacement':'top'},
                {'id':'refs','type':'heading','level':1,'text':'参考文献'},
                *[{'id':'ref'+str(i),'type':'paragraph','role':'reference','text':'['+str(i)+'] A complete synthetic reference.'*8} for i in range(1,20)]]
        r=render_proof(document(blocks,columns=2))['report'];objects=r['semanticLayout']['objects']
        self.assertEqual(r['compileMessages'],[])
        image_end=objects['im']['end'];reference_start=objects['refs']['start']
        self.assertLess((image_end['page'],image_end['yPt']),(reference_start['page'],reference_start['yPt']))
        self.assertEqual(r['semanticLayout']['sourceObjectCoverage']['missing'],[])
