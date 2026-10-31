import unittest
from copy import deepcopy
from io import BytesIO
from pypdf import PdfWriter
from figure_assets import missing_figures
from issue_export import missing_figures as issue_missing_figures
from proof import inspect_output


def fixture(kind='image'):
    asset = {'id': 'asset', 'type': kind, 'captionIds': ['caption'],
             'anchor': {'targetId': 'body', 'position': 'after', 'maxPageDistance': 1}}
    if kind == 'table':
        asset['cellImages'] = [{'row': 0, 'col': 0, 'imageId': 'image'}]
    return {'journal': {'template': 'cn-academic'}, 'blocks': [
        {'id': 'body', 'type': 'paragraph', 'text': '图 1 展示合成数据。'},
        asset, {'id': 'caption', 'type': 'paragraph', 'text': '图 1 合成示意图'}]}


class FigureAssetsTests(unittest.TestCase):
    def test_export_report_retains_actionable_metadata_and_prefix_warnings(self):
        doc={'journal':{'template':'cn-academic'},'blocks':[
            {'id':'prefix','type':'paragraph','text':'unclassified source'},
            {'id':'cite','type':'paragraph','role':'citation','text':'Example[J]. XX(X): X-X.'}]}
        before=deepcopy(doc);out=BytesIO();pdf=PdfWriter();pdf.add_blank_page(200,300);pdf.write(out)
        notes=inspect_output({'pdf':out.getvalue(),'report':{}},doc)['report']['quality']['diagnostics']
        self.assertTrue(any(d.get('field')=='name' and d['message']=='请补全中文刊名' for d in notes))
        self.assertTrue(any(d['code']=='UNCLASSIFIED_PREFIX' and d['blockId']=='prefix' for d in notes))
        self.assertTrue(any(d['code']=='PUBLICATION_METADATA_PLACEHOLDER' and d['blockId']=='cite' for d in notes))
        self.assertEqual(doc,before)

    def test_proof_keeps_unresolved_editorial_comments_and_original_import_evidence(self):
        doc=fixture();doc['comments']=[{'id':'c','blockId':'asset','text':'Need original image','resolved':False}]
        doc['importReports']=[{'sourceSha256':'a'*64,'diagnostics':[{'code':'DOCX_FIGURE_CONTENT_MISSING','severity':'warning','message':'Original had no images'}]}]
        out=BytesIO();pdf=PdfWriter();pdf.add_blank_page(200,300);pdf.write(out)
        def issues():return inspect_output({'pdf':out.getvalue(),'report':{}},doc)['report']['quality']['diagnostics']
        self.assertTrue(any(d['code']=='EDITORIAL_COMMENT_UNRESOLVED' and d['blockId']=='asset' for d in issues()))
        self.assertEqual(next(d for d in issues() if d['code']=='DOCX_FIGURE_CONTENT_MISSING')['severity'],'info')
        self.assertEqual(doc['importReports'][0]['diagnostics'][0]['severity'],'warning')
        doc['comments'][0]['resolved']=True
        self.assertFalse(any(d['code']=='EDITORIAL_COMMENT_UNRESOLVED' for d in issues()))

    def test_explicit_reference_is_not_a_missing_caption_in_both_export_paths(self):
        for kind in ('image', 'table'):
            for prefix in ('图1', '图 1', '图\u30001'):
                with self.subTest(kind=kind, prefix=prefix):
                    doc = fixture(kind)
                    doc['blocks'][0]['text'] = prefix + ' 展示合成数据。'
                    before = deepcopy(doc)
                    self.assertEqual(missing_figures(doc), [])
                    self.assertEqual(issue_missing_figures(doc), [])
                    out = BytesIO()
                    pdf = PdfWriter(); pdf.add_blank_page(200, 300); pdf.write(out)
                    result = inspect_output({'pdf': out.getvalue(), 'report': {}}, doc)
                    self.assertFalse(any(d['code'] == 'FIGURE_ASSET_UNASSIGNED' for d in result['report']['quality']['diagnostics']))
                    self.assertEqual(doc, before)

    def test_unrelated_figure_and_unbound_captions_still_block(self):
        doc = fixture()
        doc['blocks'][0]['text'] = '图 2 未提供的图件'
        self.assertEqual([d['blockId'] for d in missing_figures(doc)], ['body'])
        doc['blocks'].append({'id': 'missing', 'type': 'paragraph', 'text': '图 3 展示缺失的结果。'})
        self.assertEqual([d['blockId'] for d in missing_figures(doc)], ['body', 'missing'])

    def test_incomplete_or_nonfigure_bindings_do_not_exempt_prose(self):
        for mutation in ('no-anchor', 'no-caption', 'dangling-caption', 'ordinary-table'):
            with self.subTest(mutation=mutation):
                doc = fixture()
                asset = doc['blocks'][1]
                if mutation == 'no-anchor': asset.pop('anchor')
                if mutation == 'no-caption': asset['captionIds'] = []
                if mutation == 'dangling-caption': asset['captionIds'] = ['absent']
                if mutation == 'ordinary-table': asset['type'] = 'table'
                self.assertIn('body', [d['blockId'] for d in missing_figures(doc)])

    def test_bilingual_caption_without_whitespace_still_blocks(self):
        doc = {'blocks': [{'id': 'c', 'type': 'paragraph', 'text': '图2缺失的结果'},
                          {'id': 'en', 'type': 'paragraph', 'text': 'Fig. 2 Missing results'}]}
        self.assertEqual([d['blockId'] for d in missing_figures(doc)], ['c'])
