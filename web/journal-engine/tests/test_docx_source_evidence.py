import hashlib
import base64
import json
from pathlib import Path
import subprocess
import sys
import unittest
import shutil
from unittest.mock import patch

from docx_import import import_docx
from test_docx_v2 import package
from publishing import render_pdf, TEX_DEFAULT, escape

NS = 'xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'


class SourceEvidenceTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which('xelatex') or TEX_DEFAULT.exists(),'XeLaTeX unavailable')
    def test_footnote_before_latin_word_compiles_without_control_word_collision(self):
        from pypdf import PdfReader
        from io import BytesIO
        result=render_pdf({'layout':{'fontSet':'fandol'},'blocks':[{'id':'p','type':'paragraph','text':'porous [^n]carrier; mg·mL⁻¹; 10⁺²'}],'notes':[{'id':'n','text':'source note'}]})
        self.assertEqual(result['compileMessages'],[])
        self.assertIn('carrier',''.join(p.extract_text() for p in PdfReader(BytesIO(result['pdf'])).pages))
        self.assertEqual(escape('mL⁻¹'),r'mL\textsuperscript{\ensuremath{-}}\textsuperscript{1}')

    def test_inspection_returns_full_evidence_but_import_still_rejects(self):
        body='<w:p '+NS+'><w:r><w:object><o:OLEObject ProgID="Equation.3"/></w:object></w:r></w:p>'
        encoded=base64.b64encode(package(body)).decode()
        def run(method):
            return subprocess.run([sys.executable,str(Path(__file__).parents[1]/'worker.py')],input=json.dumps({'method':method,'base64':encoded}),capture_output=True,text=True,timeout=15)
        inspected=run('inspect');self.assertEqual(inspected.returncode,0)
        report=json.loads(inspected.stdout);self.assertFalse(report['importable'])
        self.assertEqual(report['importReports'][0]['counts']['sourceMath'],1)
        self.assertTrue(any(d.get('sourcePath') for d in report['importReports'][0]['diagnostics']))
        rejected=run('import');self.assertNotEqual(rejected.returncode,0)
        self.assertIn('数学区 0/1',json.loads(rejected.stdout)['error'])

    def test_percentage_equation_keeps_its_suffix_and_separate_number(self):
        formula='<m:oMath><m:r><m:t>P=100</m:t></m:r></m:oMath>'
        result=import_docx(package('<w:p>'+formula+'<w:r><w:t>%   （4）</w:t></w:r></w:p>'))
        block=result['blocks'][0]
        self.assertEqual((block['type'],block['equationNumber'],block['equationSuffix']),('equation','4','%'))
        self.assertIn('P=100',block['sourceOmml'])
        prose=import_docx(package('<w:p><w:r><w:t>占比为</w:t></w:r>'+formula+'<w:r><w:t>%（4）</w:t></w:r></w:p>'))
        self.assertEqual(prose['blocks'][0]['type'],'paragraph')

    def test_legacy_equations_count_instances_not_unique_assets(self):
        equation = '<w:r><w:object><o:OLEObject ProgID="Equation.DSMT4" r:id="r1"/></w:object></w:r>'
        body = '<w:p '+NS+'>'+equation+equation+'<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath></w:p>'
        body += '<w:p '+NS+'><w:r><w:object><o:OLEObject ProgID="Excel.Sheet.12" r:id="r2"/></w:object></w:r></w:p>'
        result = import_docx(package(body, {'word/_rels/document.xml.rels': '<Relationships><Relationship Id="r1" Target="embeddings/math.bin"/><Relationship Id="r2" Target="embeddings/sheet.bin"/></Relationships>', 'word/embeddings/math.bin': b'opaque equation', 'word/embeddings/sheet.bin': b'opaque sheet'}))
        report = result['importReports'][0]; counts = report['counts']
        self.assertEqual((counts['sourceMath'], counts['importedMath']), (3, 1))
        self.assertEqual((counts['sourceOmmlMath'], counts['sourceLegacyMath'], counts['sourceOleObjects']), (1, 2, 3))
        diagnostics = [d for d in report['diagnostics'] if d['code']=='DOCX_LEGACY_MATH']
        self.assertEqual(len(diagnostics), 2)
        self.assertNotEqual(diagnostics[0]['sourcePath'], diagnostics[1]['sourcePath'])
        self.assertTrue(all(d['assetSha256']==hashlib.sha256(b'opaque equation').hexdigest() and d['severity']=='error' for d in diagnostics))
        self.assertEqual(sum(d['code']=='DOCX_OLE_UNSUPPORTED' for d in report['diagnostics']), 1)

    def test_drawing_commands_are_not_word_revision_markup(self):
        body = '<w:p xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><w:r><w:t>正文</w:t><w:drawing><a:path><a:moveTo><a:pt x="0" y="0"/></a:moveTo></a:path></w:drawing></w:r></w:p>'
        result = import_docx(package(body))
        self.assertFalse(any('修订' in d['message'] for d in result['importReports'][0]['diagnostics']))
        result = import_docx(package(body+'<w:p><w:moveTo><w:r><w:t>待确认</w:t></w:r></w:moveTo></w:p>'))
        self.assertTrue(any('moveTo' in d['message'] and d['severity']=='error' for d in result['importReports'][0]['diagnostics']))

    def test_unsupported_image_reports_source_address_and_hash(self):
        body = '<w:tbl><w:tr><w:tc><w:p xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '+NS+'><w:r><w:drawing><a:blip r:embed="r1"/></w:drawing></w:r></w:p></w:tc></w:tr></w:tbl>'
        result = import_docx(package(body, {'word/_rels/document.xml.rels': '<Relationships><Relationship Id="r1" Target="media/chart.emf"/></Relationships>', 'word/media/chart.emf': b'vector'}))
        diagnostic = next(d for d in result['importReports'][0]['diagnostics'] if d['code']=='DOCX_IMAGE_UNSUPPORTED')
        self.assertIn('/tbl[1]/tr[1]/tc[1]/p[1]/', diagnostic['sourcePath'])
        self.assertEqual(diagnostic['sourceAsset'], 'word/media/chart.emf')
        self.assertEqual(diagnostic['assetSha256'], hashlib.sha256(b'vector').hexdigest())

    def test_large_tiff_keeps_pixel_limit_without_decoding(self):
        body = '<w:p xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '+NS+'><w:r><w:drawing><a:blip r:embed="r1"/></w:drawing></w:r></w:p>'
        with patch('PIL.Image.open') as opened:
            image = opened.return_value.__enter__.return_value
            image.width, image.height, image.n_frames = 11100, 10800, 1
            result = import_docx(package(body, {'word/_rels/document.xml.rels': '<Relationships><Relationship Id="r1" Target="media/chart.tiff"/></Relationships>', 'word/media/chart.tiff': b'tiff'}))
            image.load.assert_not_called()
        diagnostic = next(d for d in result['importReports'][0]['diagnostics'] if d['code']=='DOCX_IMAGE_UNSUPPORTED')
        self.assertIn('11100×10800', diagnostic['message'])
        self.assertIn('25 MP', diagnostic['message'])
        self.assertEqual(result['importReports'][0]['counts']['importedImages'], 0)
