import unittest
from io import BytesIO
from zipfile import ZipFile
from docx_import import import_docx

def package(body,extra=None):
    stream=BytesIO()
    with ZipFile(stream,'w') as z:
        z.writestr('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body>'+body+'</w:body></w:document>')
        for name,data in (extra or {}).items(): z.writestr(name,data)
    return stream.getvalue()
class DocxTests(unittest.TestCase):
    def test_utf16_and_heading(self):
        result=import_docx(package('<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>😀</w:t></w:r><w:r><w:rPr><w:b/><w:i/></w:rPr><w:t>中文</w:t></w:r></w:p>'))
        b=result['blocks'][0]; self.assertEqual(b['level'],2); self.assertEqual(b['marks'][0],{'start':2,'end':4,'bold':True,'italic':True}); self.assertTrue(b['id'])
    def test_table_and_math(self):
        result=import_docx(package('<w:tbl><w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:p><w:r><w:t>格子</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><m:oMath><m:f><m:num><m:r><m:t>1</m:t></m:r></m:num><m:den><m:r><m:t>2</m:t></m:r></m:den></m:f></m:oMath></w:p>'))
        self.assertEqual(result['blocks'][0]['rows'],[['格子']]); self.assertEqual(result['blocks'][0]['headerRows'],1); self.assertEqual(result['blocks'][1]['text'],r'\frac{1}{2}')
    def test_notes(self):
        notes='<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:footnote w:id="1"><w:p><w:r><w:t>注释</w:t></w:r></w:p></w:footnote></w:footnotes>'
        result=import_docx(package('<w:p><w:r><w:t>正文</w:t><w:footnoteReference w:id="1"/></w:r></w:p>',{'word/footnotes.xml':notes}))
        self.assertEqual(result['blocks'][0]['text'],'正文[^1]'); self.assertEqual(result['notes'],[{'id':'1','text':'注释','marker':'1'}])
    def test_entities(self):
        with self.assertRaises(ValueError): import_docx(package('<!DOCTYPE x>'))
if __name__=='__main__': unittest.main()
