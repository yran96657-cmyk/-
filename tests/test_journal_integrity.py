import base64
import hashlib
import importlib.util
from io import BytesIO
from pathlib import Path
import re
import shutil
import tempfile
import unittest
from unittest.mock import patch
from xml.sax.saxutils import escape

from docx_import import import_docx
from publishing import build_tex, render_pdf, TEX_DEFAULT
from proof import text_geometry, inspect_output
from test_docx_v2 import package


def omml(value='x'):
    return '<m:oMath><m:r><m:t>'+escape(value)+'</m:t></m:r></m:oMath>'


class JournalImportTests(unittest.TestCase):
    def test_delimiters_and_multiple_arguments_preserve_meaning(self):
        cases=[('|','|',r'\left\vert x\right\vert '),('[',']',r'\left[x\right]'),('{','}',r'\left\{x\right\}'),('','',r'\left.x\right.')]
        for left,right,expected in cases:
            content='<w:p><m:oMath><m:d><m:dPr><m:begChr m:val="'+left+'"/><m:endChr m:val="'+right+'"/></m:dPr><m:e><m:r><m:t>x</m:t></m:r></m:e></m:d></m:oMath></w:p>'
            self.assertEqual(import_docx(package(content))['blocks'][0]['text'],expected)
        content='<w:p><m:oMath><m:d><m:dPr><m:sepChr m:val="|"/></m:dPr><m:e><m:r><m:t>x</m:t></m:r></m:e><m:e><m:r><m:t>y</m:t></m:r></m:e></m:d></m:oMath></w:p>'
        self.assertEqual(import_docx(package(content))['blocks'][0]['text'],r'\left(x\middle\vert y\right)')

    def test_inline_math_order_and_table_ownership(self):
        content='<w:p><w:r><w:t>若</w:t></w:r>'+omml()+'<w:r><w:t>成立，则</w:t></w:r>'+omml('y')+'<w:r><w:t>成立。</w:t></w:r></w:p>'
        content+='<w:tbl><w:tr><w:tc><w:p><w:r><w:t>系数</w:t></w:r>'+omml('a')+'</w:p></w:tc></w:tr></w:tbl>'
        result=import_docx(package(content));self.assertEqual(len(result['blocks']),2)
        body,table=result['blocks'];self.assertEqual([m['text'] for m in body['inlineMath']],['x','y'])
        self.assertEqual(re.sub(r'\[\[math:[-\w]+\]\]','FORMULA',body['text']),'若FORMULA成立，则FORMULA成立。')
        self.assertEqual(table['inlineMath'][0]['text'],'a');self.assertTrue(table['rows'][0][0].startswith('系数[[math:'))
        self.assertEqual(result['importReports'][0]['counts']['importedMath'],3)
        self.assertFalse(any('公式已' in warning for warning in result['warnings']))

    @unittest.skipUnless(importlib.util.find_spec('PIL'),'Pillow optional')
    def test_tiff_is_lossless_and_unsupported_color_is_reported(self):
        from PIL import Image
        image=Image.new('RGB',(12,7),(11,45,79));out=BytesIO();image.save(out,format='TIFF')
        drawing='<w:p xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:r><w:drawing><a:blip r:embed="r1"/></w:drawing></w:r></w:p>'
        rels='<Relationships><Relationship Id="r1" Target="media/a.tiff"/></Relationships>'
        data=package(drawing,{'word/_rels/document.xml.rels':rels,'word/media/a.tiff':out.getvalue()})
        result=import_docx(data);converted=Image.open(BytesIO(base64.b64decode(result['blocks'][0]['src'].split(',')[1])))
        self.assertEqual(converted.size,image.size);self.assertEqual(converted.tobytes(),image.tobytes())
        report=result['importReports'][0];self.assertEqual(report['sourceSha256'],hashlib.sha256(data).hexdigest())
        self.assertEqual(report['counts']['sourceImages'],report['counts']['importedImages'])
        bad=BytesIO();Image.new('CMYK',(12,7)).save(bad,format='TIFF')
        result=import_docx(package(drawing,{'word/_rels/document.xml.rels':rels,'word/media/a.tiff':bad.getvalue()}))
        self.assertTrue(any(d['severity']=='error' for d in result['importReports'][0]['diagnostics']))
        self.assertEqual(result['importReports'][0]['counts']['importedImages'],0)

    def test_fields_revisions_and_unsupported_formula_are_persistent_errors(self):
        content='<w:p><w:ins><w:r><w:t>修订</w:t></w:r></w:ins><w:r><w:instrText>REF target</w:instrText></w:r><m:oMath><m:unknown><m:r><m:t>x</m:t></m:r></m:unknown></m:oMath></w:p>'
        result=import_docx(package(content));diagnostics=result['importReports'][0]['diagnostics']
        for term in ('ins','instrText','unknown'):self.assertTrue(any(term in d['message'] and d['severity']=='error' for d in diagnostics))

    def test_complex_notes_are_not_misreported_as_lossless(self):
        notes='<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:footnote w:id="1"><w:p>'+omml()+'</w:p></w:footnote></w:footnotes>'
        result=import_docx(package('<w:p><w:r><w:footnoteReference w:id="1"/></w:r></w:p>',{'word/footnotes.xml':notes}))
        self.assertTrue(any('注释 1' in d['message'] and d['severity']=='error' for d in result['importReports'][0]['diagnostics']))

    def test_scientific_glyph_styles_and_table_superscripts_need_review(self):
        body='<w:p><w:r><w:sym w:font="Symbol" w:char="F061"/></w:r><m:oMath><m:r><m:rPr><m:sty m:val="b"/></m:rPr><m:t>x</m:t></m:r></m:oMath></w:p>'
        body+='<w:tbl><w:tr><w:tc><w:p><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t>2</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
        issues=import_docx(package(body))['importReports'][0]['diagnostics']
        self.assertTrue(any('编码符号' in d['message'] and d['severity']=='error' for d in issues))
        self.assertFalse(any(term in d['message'] for d in issues for term in ('公式字形','表内字符样式')))
        blocks=import_docx(package(body))['blocks']
        self.assertEqual(blocks[0]['text'],r'\mathbf{x}')
        self.assertTrue(blocks[1]['cellMarks'][0]['marks'][0]['superscript'])


class JournalPdfTests(unittest.TestCase):
    def test_inline_formula_safety_and_styles_reach_tex(self):
        with tempfile.TemporaryDirectory() as folder:
            doc={'layout':{'fontSet':'fandol'},'blocks':[{'type':'heading','text':'标题','fontSize':36,'fontFamily':'kai','align':'right'}, {'type':'paragraph','text':'若[[math:m]]成立','inlineMath':[{'id':'m','text':r'\left|x\right|'}],'marks':[{'start':3,'end':7,'bold':True}]}]}
            source,_=build_tex(doc,folder)
            self.assertRegex(source,r'若.*\\\(\\left\|x\\right\|\\\).*成立')
            self.assertIn(r'\raggedleft \fontsize{36.0}',source);self.assertIn(r'\kaifamily',source)
            self.assertLess(source.index(r'\geometry'),source.index(r'\pagestyle{fancy}'))
            doc['blocks'][1]['inlineMath'][0]['text']=r'\input{secret}'
            with self.assertRaises(ValueError):build_tex(doc,folder)

    def test_small_table_and_repeated_notes(self):
        with tempfile.TemporaryDirectory() as folder:
            doc={'layout':{'columns':2},'blocks':[{'type':'table','rows':[['[[math:m]]','值[^n]']],'inlineMath':[{'id':'m','text':'x^2'}]},{'type':'paragraph','text':'重复[^n]'}],'notes':[{'id':'n','text':'原始表注'}]}
            source,_=build_tex(doc,folder)
            self.assertIn(r'\begin{tabular}',source);self.assertNotIn(r'\end{multicols}',source[:source.index(r'\begin{tabular}')])
            self.assertIn(r'\(x^2\)',source);self.assertNotIn('[^n]',source)
            self.assertEqual(source.count('原始表注'),1);self.assertEqual(source.count(r'\textsuperscript{1}'),3)
            doc['blocks'][0]['placement']='full-width';source,_=build_tex(doc,folder);self.assertIn(r'\begin{longtable}',source)
            doc['blocks'][0]['text']='题注 [[math:caption]] [^n]';doc['blocks'][0]['inlineMath'].append({'id':'caption','text':'y^2'})
            source,_=build_tex(doc,folder);self.assertRegex(source,r'题注 .*\\\(y\^2\\\)');self.assertNotIn('[[math:',source)

    def test_geometry_missing_dependency_is_not_pass(self):
        with patch.dict('sys.modules',{'pdfminer.high_level':None}):
            self.assertEqual(text_geometry(b'anything')['status'],'NOT_CHECKED')

    def test_geometry_finds_outside_text_and_never_approves_print(self):
        from pypdf import PdfWriter
        from pypdf.generic import DictionaryObject,NameObject,DecodedStreamObject
        writer=PdfWriter();page=writer.add_blank_page(200,300)
        font=DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type1'),NameObject('/BaseFont'):NameObject('/Helvetica')})
        page[NameObject('/Resources')]=DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):writer._add_object(font)})})
        stream=DecodedStreamObject();stream.set_data(b'BT /F1 12 Tf 190 280 Td (outside text) Tj ET');page[NameObject('/Contents')]=writer._add_object(stream)
        buffer=BytesIO();writer.write(buffer);data=buffer.getvalue()
        output=inspect_output({'pdf':data,'report':{'fonts':[]}})
        self.assertEqual(output['report']['geometry']['status'],'COMPLETE');self.assertTrue(output['report']['geometry']['outside'])
        self.assertEqual(output['report']['quality']['status'],'BLOCKED');self.assertFalse(output['report']['quality']['productionReady'])
        self.assertEqual(output['report']['pdfSha256'],hashlib.sha256(data).hexdigest())

    @unittest.skipUnless(shutil.which('xelatex') or TEX_DEFAULT.exists(),'XeLaTeX unavailable')
    def test_real_pdf_geometry_heading_font_size_and_table_note(self):
        doc={'layout':{'fontSet':'fandol','width':170,'height':240,'columns':2,'header':'Header visible','footer':'Page {page}'},'blocks':[
            {'type':'heading','text':'小标题','fontSize':12,'align':'left'},
            {'type':'paragraph','text':'若[[math:m]]成立。','inlineMath':[{'id':'m','text':r'\left|x\right|>0'}]},
            {'type':'table','text':'表 1','rows':[['符号','值'],['x','1[^n]']],'headerRows':1},
            {'type':'pageBreak'}, {'type':'heading','text':'大标题','fontSize':36,'fontFamily':'kai','align':'right'},
        ],'notes':[{'id':'n','text':'表内脚注可见'}]}
        result=render_pdf(doc);geometry=text_geometry(result['pdf']);self.assertEqual(geometry['status'],'COMPLETE')
        self.assertEqual(geometry['outside'],[]);self.assertFalse(any('超出版心' in w for w in result['warnings']))
        lines=[line for p in geometry['pages'] for line in p['lines']];text=''.join(line['text'] for line in lines)
        self.assertIn('表内脚注可见',text);self.assertNotIn('[[math:',text)
        sizes={line['text'].strip():max(line['fontSizesPt']) for line in lines}
        self.assertAlmostEqual(sizes['小标题'],12,delta=.2);self.assertAlmostEqual(sizes['大标题'],36,delta=.3)
        self.assertTrue(any('FandolKai' in f for line in lines if line['text'].strip()=='大标题' for f in line['fonts']))


if __name__=='__main__':unittest.main()
