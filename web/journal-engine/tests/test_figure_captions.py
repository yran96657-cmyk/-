import unittest
from docx_import import import_docx
from test_docx_v2 import package

class FigureCaptionTests(unittest.TestCase):
    def test_zero_embedded_images_with_bilingual_captions_is_not_complete(self):
        texts=['图2展示实验结果。','图1实验图','Fig.1 Experiment','图2 第二图','Fig.2 Another experiment']
        result=import_docx(package(''.join('<w:p><w:r><w:t>'+t+'</w:t></w:r></w:p>' for t in texts)))
        report=result['importReports'][0]
        self.assertEqual(report['counts']['figureCaptions'],2)
        missing=[d for d in report['diagnostics'] if d['code']=='DOCX_FIGURE_CONTENT_MISSING']
        self.assertEqual(len(missing),1)
        self.assertEqual(missing[0]['severity'],'warning')
        self.assertEqual(len(result['blocks']),len(texts))

    def test_prose_reference_does_not_require_a_figure(self):
        result=import_docx(package('<w:p><w:r><w:t>图2展示实验结果。</w:t></w:r></w:p>'))
        self.assertEqual(result['importReports'][0]['counts']['figureCaptions'],0)
