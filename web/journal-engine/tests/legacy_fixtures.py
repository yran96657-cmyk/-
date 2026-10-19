"""Small generated binary formats. No manuscript or third-party fixture bytes."""
import struct


def char(c,face=3):return bytes([2,0,128+face])+c.encode('utf-16le')
def line(data=b''):return b'\x01\x00'+data+b'\0'
def template(selector,*slots,variation=0):return bytes([3,0,selector,variation,0])+b''.join(slots)+b'\0'
def mtef(data=b''):return b'\x05\x01\x00\x07\x04DSMT7\x00\x00\x0a'+line(data)+b'\0'


def ole(raw):
    """A v3 CFB containing only an Equation Native stream in its mini FAT."""
    native=bytearray(28);struct.pack_into('<H',native,0,28);struct.pack_into('<I',native,8,len(raw));native+=raw
    assert len(native)<=512
    FREE=0xffffffff;END=0xfffffffe;FAT=0xfffffffd
    header=bytearray(512);header[:8]=bytes.fromhex('d0cf11e0a1b11ae1')
    struct.pack_into('<HHHHH',header,24,0x3e,3,0xfffe,9,6)
    struct.pack_into('<IIIIIIIII',header,40,0,1,0,0,4096,2,1,END,0)
    struct.pack_into('<109I',header,76,1,*([FREE]*108))
    def entry(name,kind,start,size,child=FREE):
        d=bytearray(128);n=(name+'\0').encode('utf-16le');d[:len(n)]=n
        struct.pack_into('<HBBIII',d,64,len(n),kind,1,FREE,FREE,child)
        struct.pack_into('<IQ',d,116,start,size);return d
    directory=entry('Root Entry',5,3,512,1)+entry('Equation Native',2,0,len(native))+bytes(256)
    fat=struct.pack('<128I',END,FAT,END,END,*([FREE]*124))
    count=(len(native)+63)//64;mini=list(range(1,count))+[END]+[FREE]*(128-count)
    return bytes(header+directory+fat+struct.pack('<128I',*mini)+native+bytes(512-len(native)))


def emf(text='Result (a)'):
    def record(tag,payload):
        payload+=bytes((-len(payload))%4);return struct.pack('<II',tag,8+len(payload))+payload
    font=bytearray(324);struct.pack_into('<Iii',font,0,1,-24,0);struct.pack_into('<I',font,20,400);font[27]=1
    name='Liberation Serif\0'.encode('utf-16le');font[32:32+len(name)]=name
    label=bytearray(68);struct.pack_into('<4iIff2iIII',label,0,0,0,400,120,1,1.,1.,30,60,len(text),76,0)
    records=[record(82,font),record(37,struct.pack('<I',1)),record(18,struct.pack('<I',1)),record(24,struct.pack('<I',0)),record(43,struct.pack('<4i',20,20,380,100)),record(84,label+text.encode('utf-16le')),record(14,struct.pack('<III',0,0,20))]
    header=bytearray(108);struct.pack_into('<II4i4i',header,0,1,108,0,0,400,120,0,0,10000,3000);header[40:44]=b' EMF'
    struct.pack_into('<IIIH',header,44,0x10000,len(header)+sum(map(len,records)),1+len(records),2)
    struct.pack_into('<4i',header,72,1024,768,270,203);struct.pack_into('<2i',header,100,270000,203000)
    return bytes(header)+b''.join(records)
