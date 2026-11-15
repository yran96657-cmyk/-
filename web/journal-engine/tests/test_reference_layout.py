import unittest
from unittest.mock import patch
from reference_layout import reference_breaks,hyphen_positions,latin_font,explicit_reference_breaks


class ReferenceLayoutTests(unittest.TestCase):
    def test_explicit_hints_bind_source_and_convert_utf16_without_text_edits(self):
        text='[1] 𠀀 testing text';block={'text':text,'referenceBreaks':{'sourceText':text,'breaks':[{'offset':10,'hyphen':True}]}}
        self.assertEqual(explicit_reference_breaks(block,'[1] '),[(5,True)])
        self.assertEqual(block['text'],text)
        self.assertIsNone(explicit_reference_breaks({**block,'text':text+' changed'},'[1] '))
        block['referenceBreaks']['breaks'][0]['offset']=5
        with self.assertRaisesRegex(ValueError,'Unicode'):explicit_reference_breaks(block,'[1] ')

    def test_recognized_hyphenation_and_minimum_fragments(self):
        self.assertEqual(hyphen_positions('enzyme'),(2,))
        self.assertIn(5,hyphen_positions('critical'))
        self.assertIn(6,hyphen_positions('Chemistry'))
        self.assertIn(12,hyphen_positions('photocatalytic'))
        self.assertEqual(hyphen_positions('X'),())

    def test_non_latin_and_rich_objects_use_existing_compositor(self):
        for text,marks in [('中文文献[J].',[]),('Math [[math:id]]',[]),('https://example.org/article',[]),('An italic name',[{'start':0,'end':9,'italic':True}]),('Custom size',[{'start':0,'end':6,'fontSize':12}])]:
            self.assertIsNone(reference_breaks(text,205,8.82,marks))

    def test_unavailable_metrics_fall_back_without_substitution(self):
        with patch('reference_layout.latin_font',side_effect=RuntimeError('missing')):
            self.assertIsNone(reference_breaks('A reference',205,8.82))

    def test_reference_is_fitted_without_changing_characters(self):
        try:latin_font()
        except (OSError,RuntimeError):self.skipTest('Times New Roman metrics not available')
        text='Merz M, Eisele T, Berends P, et al. Flavourzyme, an enzyme preparation with industrial relevance: automated nine-step purification and partial characterization of eight enzymes[J]. Journal of Agricultural and Food Chemistry, 2015, 63(23): 5682-5693.'
        hints=reference_breaks(text,205,8.82);start=0;pieces=[]
        for end,dash in hints:
            pieces.append(text[start:end].rstrip()+('-' if dash else ''));start=end
        pieces.append(text[start:])
        self.assertEqual(pieces[:4],[
            'Merz M, Eisele T, Berends P, et al. Flavourzyme, an en-',
            'zyme preparation with industrial relevance: automated',
            'nine-step purification and partial characterization of',
            'eight enzymes[J]. Journal of Agricultural and Food'])
        self.assertEqual(''.join(text[a:z] for a,z in zip([0]+[h[0] for h in hints],[h[0] for h in hints]+[len(text)])),text)
