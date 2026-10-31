"""Synthetic Word 97 text streams; no private manuscript bytes."""
from io import BytesIO
from zipfile import ZipFile
import struct
import unittest
import xml.etree.ElementTree as ET
from legacy_text import native_paragraphs,repair_converted_docx,W

def doc(text,properties=None,paragraph_properties=b''):
    properties=properties or {};w=bytearray(8192);t=bytearray(4096)
    def put(b,o,fmt,*v):struct.pack_into('<'+fmt,b,o,*v)
    put(w,0,'HH',0xa5ec,0xc1);put(w,32,'H',14);put(w,62,'H',22);put(w,152,'H',93);put(w,0x4c,'I',len(text))
    def style(kind,props):
        s=bytearray(10);put(s,2,'H',0xfff0|kind);put(s,4,'H',2 if kind==1 else 1)
        s+=b'\0\0\0\0' # Empty style name and terminator.
        if kind==1:s+=struct.pack('<H',2)+b'\0\0'
        s+=struct.pack('<H',len(props))+props
        return struct.pack('<H',len(s))+s
    header=bytearray(20);put(header,0,'HHH',18,11,10)
    sheet=header+style(1,paragraph_properties)+b'\0\0'*9+style(2,b'')
    t[:len(sheet)]=sheet;put(w,0xa2,'II',0,len(sheet))
    raw=text.encode('utf-16-le');w[2048:2048+len(raw)]=raw
    pcd=struct.pack('<IIH I H',0,len(text),0,2048,0);clx=b'\x02'+struct.pack('<I',len(pcd))+pcd
    t[600:600+len(clx)]=clx;put(w,0x1a2,'II',600,len(clx))
    f=bytearray(512);n=len(text);assert n<29;pos=256
    for i in range(n+1):put(f,i*4,'I',2048+i*2)
    for i,c in enumerate(text):
        pr=properties.get(c,b'')
        if pr:
            if pos%2:pos+=1
            f[4*(n+1)+i]=pos//2;f[pos]=len(pr);f[pos+1:pos+1+len(pr)]=pr;pos+=1+len(pr)
    f[511]=n;w[6144:6656]=f
    put(t,512,'III',2048,2048+len(raw),12);put(w,0xfa,'II',512,12)
    f=bytearray(512);put(f,0,'II',2048,2048+len(raw));f[8]=100;f[200:204]=b'\0\x01\0\0';f[511]=1;w[6656:7168]=f
    put(t,524,'III',2048,2048+len(raw),13);put(w,0x102,'II',524,12)
    free,end,fat=0xffffffff,0xfffffffe,0xfffffffd
    header=bytearray(512);header[:8]=bytes.fromhex('d0cf11e0a1b11ae1');put(header,24,'HHHHH',0x3e,3,0xfffe,9,6)
    put(header,40,'IIIIIIIII',0,1,0,0,4096,end,0,end,0);put(header,76,'109I',1,*([free]*108))
    def entry(name,kind,start,size,child=free,right=free):
        b=bytearray(128);s=(name+'\0').encode('utf-16-le');b[:len(s)]=s;put(b,64,'HBBIII',len(s),kind,1,free,right,child);put(b,116,'IQ',start,size);return b
    directory=entry('Root Entry',5,end,0,1)+entry('WordDocument',2,2,len(w),right=2)+entry('0Table',2,18,len(t))+bytes(128)
    fats=[end,fat]+list(range(3,18))+[end]+list(range(19,26))+[end]+[free]*102
    return bytes(header+directory+struct.pack('<128I',*fats)+w+t)

def converted(body):
    out=BytesIO()
    with ZipFile(out,'w') as z:
        z.writestr('word/document.xml','<w:document xmlns:w="'+W[1:-1]+'"><w:body>'+body+'</w:body></w:document>')
        z.writestr('word/embeddings/object.bin',b'preserve-object')
    return out.getvalue()

class LegacyTextTests(unittest.TestCase):
    def test_loss_recovery_preserves_spacing_emphasis_and_assets(self):
        source=doc('属名 Citrus L.\rA及S1\r',{'C':b'\x36\x08\x01','A':b'\x36\x08\x01','S':b'\x36\x08\x01'})
        raw=converted('<w:p><w:r><w:t>属名  L.</w:t></w:r></w:p><w:p><w:r><w:t>及</w:t></w:r><w:r><w:rPr><w:vertAlign w:val="subscript"/></w:rPr><w:t>1</w:t></w:r></w:p>')
        out,audit=repair_converted_docx(source,raw)
        with ZipFile(BytesIO(out)) as z:
            root=ET.fromstring(z.read('word/document.xml'));self.assertEqual(z.read('word/embeddings/object.bin'),b'preserve-object')
        self.assertEqual([''.join(p.itertext()) for p in root.find(W+'body')],['属名 Citrus L.','A及S1'])
        self.assertEqual(len(list(root.iter(W+'i'))),3)
        self.assertEqual([r.find(W+'rPr/'+W+'vertAlign').get(W+'val') for r in root.iter(W+'r') if ''.join(r.itertext())=='1'],['subscript'])
        self.assertEqual(repair_converted_docx(source,out)[1],[])
        self.assertEqual(sum(a['characters'] for a in audit),8)

    def test_hidden_source_and_hidden_paragraph_defaults_are_not_reintroduced(self):
        s=doc('A隐藏B\r',{'隐':b'\x3c\x08\x01','藏':b'\x3c\x08\x01'})
        raw=converted('<w:p><w:r><w:t>AB</w:t></w:r></w:p>')
        self.assertEqual(repair_converted_docx(s,raw),(raw,[]))
        self.assertEqual(native_paragraphs(doc('隐\r',paragraph_properties=b'\x3c\x08\x01')),[])

    def test_revisions_replacements_deleted_paragraphs_and_bad_indices_fail_closed(self):
        for source,raw in [(doc('ABC\r'),converted('<w:p><w:r><w:t>AXC</w:t></w:r></w:p>')),
                           (doc('ABC\rDEF\r'),converted('<w:p><w:r><w:t>ABC</w:t></w:r></w:p>')),
                           (doc('A\r',{'A':b'\x00\x08\x01'}),converted('<w:p><w:r><w:t>A</w:t></w:r></w:p>'))]:
            with self.assertRaisesRegex(ValueError,'WORD_DOC_TEXT_FIDELITY'):repair_converted_docx(source,raw)
        incomplete=bytearray(doc('AB\r'));struct.pack_into('<I',incomplete,1536+0x4c,9)
        with self.assertRaisesRegex(ValueError,'未覆盖完整正文'):native_paragraphs(incomplete)

    def test_relative_visibility_uses_the_applied_paragraph_style(self):
        source=doc('AB\r',{'A':b'\x3c\x08\x80','B':b'\x3c\x08\x81'},paragraph_properties=b'\x3c\x08\x01')
        self.assertEqual(''.join(x[0] for p in native_paragraphs(source) for x in p),'B')
        raw=converted('<w:p><w:r><w:t>B</w:t></w:r></w:p>')
        self.assertEqual(repair_converted_docx(source,raw),(raw,[]))
        with self.assertRaisesRegex(ValueError,'WORD_DOC_TEXT_FIDELITY'):
            native_paragraphs(doc('A\r',{'A':b'\x83\x2a\x01'}))

if __name__=='__main__':unittest.main()
