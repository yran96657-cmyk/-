"""Bounded MTEF 5 reader based on the published Wiris binary specification.

Unknown records and truncated structures fail closed. Embedded OLE is data:
only the Equation Native stream is read; no object or application is executed.
"""
from io import BytesIO
import struct


class MtefError(ValueError):
    pass


class Reader:
    def __init__(self, data):
        if not 12 <= len(data) <= 1024 * 1024:
            raise MtefError('MTEF size is outside the supported bounds')
        self.data, self.pos, self.records = data, 0, 0
        self.fonts, self.styles, self.encodings = [], [], []
        self.sizes, self.spaces = [], []

    def take(self, size):
        if size < 0 or self.pos + size > len(self.data):
            raise MtefError('Truncated MTEF at byte ' + str(self.pos))
        data = self.data[self.pos:self.pos + size]; self.pos += size
        return data

    def byte(self):
        return self.take(1)[0]

    def short(self):
        return int.from_bytes(self.take(2), 'little')

    def uint(self):
        value = self.byte()
        return self.short() if value == 255 else value

    def signed(self):
        value = self.byte()
        return self.short() - 32768 if value == 255 else value - 128

    def string(self):
        stop = self.data.find(b'\0', self.pos, self.pos + 1025)
        if stop < 0:
            raise MtefError('MTEF string has no bounded terminator')
        return self.take(stop - self.pos + 1)[:-1].decode('latin-1')

    def dimensions(self):
        count = self.byte(); result = []; current = []; units = None
        while len(result) < count:
            value = self.byte()
            for nibble in (value >> 4, value & 15):
                if len(result) == count:
                    break  # Unused half-byte is padding.
                if units is None:
                    if nibble > 4: raise MtefError('Unknown MTEF dimension unit')
                    units = nibble
                elif nibble == 15:
                    result.append([units, ''.join(current)]); current = []; units = None
                elif nibble <= 11:
                    current.append('0123456789.-'[nibble])
                    if len(current) > 30: raise MtefError('MTEF dimension is too long')
                else:
                    raise MtefError('Invalid MTEF dimension')
        return result

    def nudge(self):
        x, y = self.byte(), self.byte()
        if (x, y) == (128, 128):
            return list(struct.unpack('<hh', self.take(4)))
        return [x - 128, y - 128]

    def sequence(self, depth=0):
        if depth > 64: raise MtefError('MTEF nesting exceeds 64')
        out = []
        while True:
            start = self.pos; tag = self.byte(); self.records += 1
            if self.records > 20000: raise MtefError('Too many MTEF records')
            if tag == 0: return out
            node = {'type': tag, 'offset': start}
            if tag in (1, 2, 3, 4, 5, 6):
                options = self.byte(); node['options'] = options
                allowed={1:15,2:63,3:8,4:10,5:8,6:8}[tag]
                if options & ~allowed or tag==2 and options&4 and options&16:raise MtefError('Unsupported MTEF record flags')
                if options & 8: node['nudge'] = self.nudge()
            if tag == 1:
                if options & 4: node['lineSpacing'] = self.short()
                if options & 2: node['ruler'] = self.ruler()
                node['children'] = [] if options & 1 else self.sequence(depth + 1)
            elif tag == 2:
                node['typeface'] = self.signed()
                if not options & 32: node['code'] = self.short()
                if options & 4: node['fontPosition'] = self.byte()
                if options & 16: node['fontPosition'] = self.short()
                if options & 1: node['embellishments'] = self.sequence(depth + 1)
            elif tag == 3:
                node['selector'] = self.byte(); variation = self.byte()
                node['variation'] = (variation & 127) | (self.byte() << 8) if variation & 128 else variation
                node['templateOptions'] = self.byte(); node['children'] = self.sequence(depth + 1)
            elif tag == 4:
                node['hAlign'], node['vAlign'] = self.byte(), self.byte()
                if options & 2: node['ruler'] = self.ruler()
                node['children'] = self.sequence(depth + 1)
            elif tag == 5:
                node['vAlign'], node['hJust'], node['vJust'] = self.byte(), self.byte(), self.byte()
                rows, cols = self.byte(), self.byte(); node.update(rows=rows, cols=cols)
                if not rows or not cols or rows * cols > 1000: raise MtefError('Invalid MTEF matrix dimensions')
                node['rowLines'] = list(self.take((rows + 4) // 4))
                node['colLines'] = list(self.take((cols + 4) // 4))
                node['children'] = self.sequence(depth + 1)
            elif tag == 6:
                node['embellishment'] = self.byte()
            elif tag == 7:
                node['stops'] = self.ruler_body()
            elif tag == 8:
                node['font'], node['style'] = self.uint(), self.byte()
            elif tag == 9:
                size = self.byte()
                if size == 101:
                    node['points32'] = -struct.unpack('<h', self.take(2))[0]
                elif size == 100:
                    node['size'] = self.byte(); node['delta'] = struct.unpack('<h', self.take(2))[0]
                else:
                    node['size'] = size; node['delta'] = self.byte() - 128
            elif 10 <= tag <= 14:
                pass
            elif tag == 15:
                node['color'] = self.uint()
            elif tag == 16:
                flags = self.byte(); node['flags'] = flags
                node['values'] = [self.short() for _ in range(4 if flags & 1 else 3)]
                if flags & 4: node['name'] = self.string()
            elif tag == 17:
                font = [self.uint(), self.string()]; self.fonts.append(font); node['font'] = font
            elif tag == 18:
                node['options'] = self.byte()
                self.sizes, self.spaces = self.dimensions(), self.dimensions()
                self.styles = []
                for _ in range(self.byte()):
                    index = self.uint(); self.styles.append([index, self.byte() if index else 0])
                node.update(sizes=self.sizes, spaces=self.spaces, styles=self.styles)
            elif tag == 19:
                value = self.string(); self.encodings.append(value); node['encoding'] = value
            else:
                raise MtefError('Unsupported MTEF record ' + str(tag) + ' at byte ' + str(start))
            out.append(node)

    def ruler_body(self):
        return [[self.byte(), self.short()] for _ in range(self.byte())]

    def ruler(self):
        if self.byte() != 7: raise MtefError('Expected MTEF ruler')
        return self.ruler_body()

    def parse(self):
        header = list(self.take(5))
        if header[0] != 5: raise MtefError('Only MTEF version 5 is supported')
        application, options = self.string(), self.byte()
        if options & ~1: raise MtefError('Unsupported MTEF equation options')
        tree = self.sequence()
        if self.pos != len(self.data): raise MtefError('Trailing MTEF content at byte ' + str(self.pos))
        return {'version': 5, 'application': application, 'inline': bool(options & 1),
                'nodes': tree, 'fonts': self.fonts, 'styles': self.styles,
                'records': self.records, 'bytesConsumed': self.pos}


def native_stream(ole_bytes):
    if not 512 <= len(ole_bytes) <= 2 * 1024 * 1024:
        raise MtefError('Equation OLE size is outside the supported bounds')
    try:
        import olefile
    except ImportError as exc:
        raise MtefError('Legacy equations require olefile') from exc
    with olefile.OleFileIO(BytesIO(ole_bytes), raise_defects=olefile.DEFECT_INCORRECT) as archive:
        if not archive.exists('Equation Native'): raise MtefError('OLE has no Equation Native stream')
        if archive.get_size('Equation Native') > 1024 * 1024: raise MtefError('Equation Native stream is too large')
        data = archive.openstream('Equation Native').read()
    if len(data) < 40: raise MtefError('Truncated Equation Native header')
    header_size = int.from_bytes(data[:2], 'little')
    size = int.from_bytes(data[8:12], 'little')
    if header_size != 28 or size != len(data) - header_size:
        raise MtefError('Equation Native length does not match its header')
    return data[header_size:]
