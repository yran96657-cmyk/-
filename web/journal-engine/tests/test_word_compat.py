import base64,hashlib,sys,unittest,tempfile
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile
import xml.etree.ElementTree as ET
from docx_import import import_docx,NS
from mathml_import import mathml_to_omml,M
from omml import to_tex
from word_compat import accept_revisions,choose_alternates,normalize_fence_extensions,W,A,MC

def package(body,parts=None):
    data=BytesIO()
    with ZipFile(data,'w') as z:
        z.writestr('word/document.xml','<w:document xmlns:w="'+NS['w']+'" xmlns:a="'+NS['a']+'"><w:body>'+body+'</w:body></w:document>')
        for name,text in (parts or {}).items():z.writestr(name,text)
    return data.getvalue()

class WordCompatibilityTests(unittest.TestCase):
    def test_inherited_italic_and_explicit_off_survive(self):
        styles='<w:styles xmlns:w="'+NS['w']+'"><w:style w:type="character" w:styleId="base"><w:rPr><w:i/><w:sz w:val="18"/></w:rPr></w:style><w:style w:type="character" w:styleId="child"><w:basedOn w:val="base"/></w:style></w:styles>'
        body='<w:p><w:r><w:rPr><w:rStyle w:val="child"/></w:rPr><w:t>Citrus</w:t></w:r><w:r><w:rPr><w:rStyle w:val="child"/><w:i w:val="0"/></w:rPr><w:t> upright</w:t></w:r></w:p>'
        r=import_docx(package(body,{'word/styles.xml':styles}))
        self.assertEqual(r['blocks'][0]['marks'],[{'start':0,'end':6,'italic':True,'fontSize':9},{'start':6,'end':14,'italic':False,'fontSize':9}])
        self.assertFalse(any(d['severity']=='error' for d in r['importReports'][0]['diagnostics']))

    def test_wps_legacy_conversion_requires_native_reader(self):
        from unittest.mock import patch,MagicMock
        from word_compat import check_legacy_converter
        compound=MagicMock();compound.__enter__.return_value.exists.return_value=True
        with patch('olefile.OleFileIO',return_value=compound):
            with self.assertRaisesRegex(ValueError,'WORD_DOC_NATIVE_REQUIRED'):check_legacy_converter(b'fixture','LibreOffice')
            check_legacy_converter(b'fixture','Microsoft Word')
    def test_png_pdf_preserves_pixels_without_raster_resampling(self):
        from png_pdf import png_pdf
        from PIL import Image
        from pypdf import PdfReader
        im=Image.new('RGB',(300,200),'red');im.paste('blue',(50,70,150,170));raw=BytesIO();im.save(raw,format='PNG')
        embedded=png_pdf(raw.getvalue());pdf=PdfReader(BytesIO(embedded))
        actual=Image.open(BytesIO(pdf.pages[0].images[0].data))
        self.assertEqual(actual.size,im.size);self.assertEqual(actual.convert('RGB').tobytes(),im.tobytes())
        rgba=BytesIO();im.convert('RGBA').save(rgba,format='PNG');self.assertIsNone(png_pdf(rgba.getvalue()))
        broken=bytearray(raw.getvalue());broken[-5]^=1
        with self.assertRaisesRegex(ValueError,'CRC'):png_pdf(broken)

    def test_missing_figure_assets_block_publication_even_when_pdf_compiles(self):
        from proof import inspect_output
        from pypdf import PdfWriter
        out=BytesIO();pdf=PdfWriter();pdf.add_blank_page(200,300);pdf.write(out)
        result=inspect_output({'pdf':out.getvalue(),'report':{}},{'journal':{'template':'cn-academic'},'blocks':[{'id':'c','type':'paragraph','text':'图1 原始图缺失'},{'id':'prose','type':'paragraph','text':'图2展示了实验结果。'}]})
        self.assertEqual([d['blockId'] for d in result['report']['quality']['diagnostics'] if d['code']=='FIGURE_ASSET_UNASSIGNED'],['c'])
        self.assertEqual(result['report']['quality']['status'],'BLOCKED')

    def test_math_style_survives_fraction_and_script_wrappers(self):
        m=mathml_to_omml('<math><mstyle mathvariant="bold"><mfrac><msub><mi>x</mi><mn>1</mn></msub><mi>y</mi></mfrac></mstyle></math>')
        self.assertEqual([s.get(M+'val') for s in m.iter(M+'sty')],['b','b','b'])

    def test_shared_image_keeps_distinct_crop_instances(self):
        from word_compat import transform_pictures,R
        from PIL import Image
        im=Image.new('RGB',(100,100),'red');im.paste('blue',(0,50,100,100));raw=BytesIO();im.save(raw,format='PNG')
        root=ET.fromstring('<root xmlns:a="'+NS['a']+'" xmlns:r="'+NS['r']+'" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'+''.join('<pic:pic><a:blip r:embed="same"/><a:srcRect '+crop+'/></pic:pic>' for crop in ['b="50000"','t="50000"'])+'</root>')
        assets,audit=transform_pictures(root,lambda path:raw.getvalue(),{'same':'image.png'})
        self.assertEqual(len(audit),2);self.assertEqual(len(assets),2)
        pictures=[Image.open(BytesIO(b)) for b in assets.values()]
        self.assertEqual([p.size for p in pictures],[(100,50),(100,50)]);self.assertEqual([p.getpixel((0,0)) for p in pictures],[(255,0,0),(0,0,255)])

    def test_structural_revision_cannot_silently_keep_deleted_paragraph_mark(self):
        root=ET.fromstring('<w:p xmlns:w="'+NS['w']+'"><w:pPr><w:rPr><w:del/></w:rPr></w:pPr><w:r><w:t>text</w:t></w:r></w:p>')
        with self.assertRaisesRegex(ValueError,'STRUCTURAL_REVISION'):accept_revisions(root,'accept')

    def test_footer_after_latin_text_and_scientific_symbols_compile(self):
        from publishing import render_pdf
        from pypdf import PdfReader
        d={'journal':{'template':'cn-academic'},'layout':{'fontSet':'fandol','header':'HEADER-ODD','headerEven':'HEADER-EVEN','footer':'FOOTER {page}'},
           'notes':[{'id':'n','text':'Note'}],'blocks':[{'id':'a','type':'paragraph','text':'μ θ δ ≤ ≥ ≡ 10\u202f°C; enzyme[^n]carrier'},
           {'id':'br','type':'pageBreak'},{'id':'b','type':'paragraph','text':'Second page.'}]}
        r=render_pdf(d);self.assertEqual(r['compileMessages'],[])
        reader=PdfReader(BytesIO(r['pdf']));pages=[p.extract_text() for p in reader.pages]
        self.assertIn('HEADER-ODD',pages[0]);self.assertIn('HEADER-EVEN',pages[1]);self.assertIn('FOOTER',pages[0]);self.assertIn('carrier',pages[0])

    def test_narrow_empty_word_columns_and_long_url_stay_inside(self):
        from publishing import render_pdf
        d={'journal':{'template':'cn-academic'},'layout':{'fontSet':'fandol'},'blocks':[
            {'id':'t','type':'table','rows':[['Name','Value','',''],['Alpha','123','','']],'columnWidths':[50,49.8,.1,.1],'fontSize':9,'borderStyle':'three-line'},
            {'id':'u','type':'paragraph','role':'reference','text':'[1] https://example.org/'+('a_long_path_1234567890'*12)+'.html'}]}
        r=render_pdf(d);self.assertEqual(r['compileMessages'],[])

    def test_final_revision_text_and_source_hash(self):
        source=package('<w:p><w:r><w:t>A</w:t></w:r><w:del><w:r><w:delText>OLD</w:delText></w:r></w:del><w:ins><w:r><w:t>NEW</w:t></w:r></w:ins></w:p>')
        result=import_docx(source,'accept');self.assertEqual(result['blocks'][0]['text'],'ANEW')
        report=result['importReports'][0];self.assertEqual(report['sourceSha256'],hashlib.sha256(source).hexdigest());self.assertEqual(report['counts']['acceptedRevisions'],2)
        self.assertFalse(any(d['severity']=='error' for d in report['diagnostics']))
        self.assertTrue(any(d['severity']=='error' for d in import_docx(source)['importReports'][0]['diagnostics']))

    def test_drawing_move_is_not_word_revision(self):
        result=import_docx(package('<w:p><w:r><w:t>Intact</w:t></w:r><a:moveTo/></w:p>'))
        self.assertEqual(result['importReports'][0]['counts']['acceptedRevisions'],0)

    def test_custom_note_consumed_once(self):
        p=package('<w:p><w:r><w:t>A</w:t></w:r><w:r><w:footnoteReference w:id="1" w:customMarkFollows="1"/><w:t>*tail</w:t></w:r></w:p>',
                  {'word/footnotes.xml':'<w:footnotes xmlns:w="'+NS['w']+'"><w:footnote w:id="1"><w:p><w:r><w:t>Funding</w:t></w:r></w:p></w:footnote></w:footnotes>'})
        r=import_docx(p);self.assertEqual(r['blocks'][0]['text'],'A[^1]tail');self.assertEqual(r['notes'][0]['marker'],'*')

    def test_symbol_multiply_unknown_blocks(self):
        r=import_docx(package('<w:p><w:r><w:sym w:font="Symbol" w:char="F0D7"/></w:r></w:p>'))
        self.assertEqual(r['blocks'][0]['text'],'×')
        r=import_docx(package('<w:p><w:r><w:sym w:font="Unknown" w:char="F0D7"/></w:r></w:p>'))
        self.assertTrue(any(d['severity']=='error' for d in r['importReports'][0]['diagnostics']))

    def test_mathml_slots_fences_matrix(self):
        source='<math><mrow><mo>{</mo><mtable><mtr><mtd><mi>x</mi></mtd><mtd><mn>0</mn></mtd></mtr><mtr><mtd><mi>y</mi></mtd><mtd><mn>1</mn></mtd></mtr></mtable></mrow></math>'
        omml=mathml_to_omml(source);warnings=[];tex=to_tex(omml,warnings)
        self.assertEqual(warnings,[]);self.assertIn(r'\left\{',tex);self.assertIn(r'\right.',tex)
        self.assertEqual([len(row) for row in omml.iter(M+'mr')],[2,2])
        self.assertIn(r'x & 0 \\ y & 1',tex)
        for source in ['<math><evil/></math>','<math><mfrac><mi>x</mi></mfrac></math>','<math><mi unknown="true">x</mi></math>']:
            with self.assertRaises(ValueError):mathml_to_omml(source)

    def test_mtef_matrix_xslt_preserves_two_dimensions(self):
        sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'vendor'))
        from lxml import etree
        from mathtypejx.mtef.mathml import _xslt_transform
        root=etree.fromstring(b'<root><mtef><equation_options>block</equation_options><slot><matrix><rows>2</rows><cols>2</cols><slot/><slot/><slot/><slot/></matrix></slot></mtef></root>')
        converted=ET.fromstring(_xslt_transform(root));rows=list(converted.find('.//mtable'))
        self.assertEqual(len(rows),2);self.assertEqual([len(row) for row in rows],[2,2])

    def test_mathml_scripts_and_limit_tokens(self):
        m=mathml_to_omml('<math><msubsup><mi>x</mi><mn>1</mn><mn>2</mn></msubsup><munderover><mo>∑</mo><mi>i</mi><mi>n</mi></munderover></math>')
        w=[];tex=to_tex(m,w);self.assertIn('_{1}^{2}',tex);self.assertIn(r'\sum\limits_{i}^{n}',tex);self.assertEqual(w,[])

    def test_known_empty_mathtype_metadata_never_executed(self):
        for instruction in ['MACROBUTTON MTEditEquationSection2',r'MACROBUTTON MTPlaceRef \* MERGEFORMAT',r'SEQ MTChap \r 1 \h \* MERGEFORMAT']:
            body='<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>'+instruction+'</w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'
            r=import_docx(package(body));self.assertEqual(r['importReports'][0]['counts']['metadataFields'],1)
            self.assertFalse(any(d['severity']=='error' for d in r['importReports'][0]['diagnostics']))

    def test_nested_mathtype_hidden_counter_preserves_literal_number(self):
        def instruction(value):return '<w:r><w:instrText>'+value+'</w:instrText></w:r>'
        begin='<w:r><w:fldChar w:fldCharType="begin"/></w:r>'
        end='<w:r><w:fldChar w:fldCharType="end"/></w:r>'
        hidden=begin+instruction(r'SEQ MTEqn \h \* MERGEFORMAT')+end
        body='<w:p>'+begin+instruction(r'MACROBUTTON MTPlaceRef \* MERGEFORMAT ')+hidden+instruction('(')+instruction('12')+instruction(')')+end+'</w:p>'
        result=import_docx(package(body));report=result['importReports'][0]
        self.assertEqual(result['blocks'][0]['text'],'(12)')
        self.assertEqual(report['counts']['metadataFields'],2)
        self.assertFalse(any(d['severity']=='error' for d in report['diagnostics']))
        for invalid in [body.replace(r'\h ',''),body.replace('MTPlaceRef','UnknownMacro'),body.replace('>12<','>unsafe<')]:
            result=import_docx(package(invalid))
            self.assertTrue(any(d['severity']=='error' for d in result['importReports'][0]['diagnostics']))

if __name__=='__main__':unittest.main()
