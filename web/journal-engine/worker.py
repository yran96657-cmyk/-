"""Private one-request worker; all filenames are supplied by the server, not users."""
import base64
import hashlib
import json
from pathlib import Path
import sys

from docx_import import import_docx
from proof import render_proof


def main():
    request = json.loads(sys.stdin.buffer.read(30 * 1024 * 1024 + 1))
    if request['method'] == 'probe':
        # Compile, inspect fonts and read geometry: checking the executable alone
        # misses absent TeX packages and Python modules on a fresh deployment.
        import PIL
        from font_inventory import probe_fonts
        result = render_proof({'journal': {'template': 'cn-academic'},
                              'layout': {'fontSet': 'fandol'},
                              'blocks': [{'id': 'probe', 'type': 'paragraph', 'text': '期刊运行时检查'}]})
        if result['report']['geometry']['status'] != 'COMPLETE' or result['report']['compileMessages']:
            raise ValueError('JOURNAL_RUNTIME_PROBE_FAILED')
        import importlib.util
        import os
        import shutil
        imports={'legacyMath':{'format':'MTEF 5','available':importlib.util.find_spec('olefile') is not None},
                 'emf':{'available':bool(os.environ.get('SHUYE_SOFFICE') or shutil.which('soffice')) and importlib.util.find_spec('pypdfium2') is not None,
                        'renderer':'LibreOffice Draw','verification':'dependencies detected; each asset must pass conversion and text checks'}}
        print(json.dumps({'engine': result['report']['renderer'], 'python': sys.version.split()[0], 'fonts': probe_fonts(),'imports':imports}))
    elif request['method'] in ('import', 'inspect'):
        data = base64.b64decode(request['base64'], validate=True)
        result = import_docx(data)
        if request['method'] == 'inspect':
            print(json.dumps({'importReports': result['importReports'],
                              'importable': not any(d['severity']=='error' for r in result['importReports'] for d in r['diagnostics'])}, ensure_ascii=False))
            return
        errors = [d for r in result['importReports'] for d in r['diagnostics'] if d['severity'] == 'error']
        if errors:
            c=result['importReports'][0]['counts']
            summary='数学区 '+str(c['importedMath'])+'/'+str(c['sourceMath'])+'（旧式公式 '+str(c['sourceLegacyMath'])+'），图片 '+str(c['importedImages'])+'/'+str(c['sourceImages'])+'。'
            raise ValueError('DOCX_IMPORT_UNSUPPORTED: '+summary+'; '.join(d['message'] for d in errors[:12])+'；完整逐项定位请使用 inspect_journal_docx。')
        print(json.dumps(result, ensure_ascii=False))
    elif request['method'] == 'render':
        folder = Path(request['directory'])
        document = request['document']
        if document.get('composition'):
            raise ValueError('JOURNAL_PDF_COMPOSITION_NOT_SUPPORTED')
        if not document.get('journal') or not document.get('blocks'):
            raise ValueError('JOURNAL_TEMPLATE_REQUIRED')
        result = render_proof(document, evidence_dir=folder / 'engine')
        report = result['report']
        report['scope'] = 'complete-journal-document'
        report['sourceDocumentSha256'] = request['sourceDocumentSha256']
        report['sourceRevision'] = request['revision']
        report['formulaCoverage'] = {
            'total': sum(1 if b['type'] == 'equation' else len(b.get('inlineMath', [])) for b in document['blocks']),
            'display': sum(b['type'] == 'equation' for b in document['blocks']),
            'inline': sum(len(b.get('inlineMath', [])) for b in document['blocks']),
            'sourceMath': sum(r['counts'].get('sourceMath', 0) for r in document.get('importReports', [])),
            'sourceLegacyMath': sum(r['counts'].get('sourceLegacyMath', 0) for r in document.get('importReports', [])),
            'sourceDisplayMathContainers': sum(r['counts'].get('sourceDisplayMath', 0) for r in document.get('importReports', [])),
            'basis': 'display/inline count model objects; sourceMath includes OMML and identified legacy OLE equations; sourceDisplayMathContainers counts OOXML oMathPara, including tables',
        }
        # Report and PDF are published only after both writes have completed.
        (folder / 'proof.pdf').write_bytes(result['pdf'])
        (folder / 'report.json').write_text(json.dumps(report, ensure_ascii=False), encoding='utf-8')
        print(json.dumps({'pdfSha256': hashlib.sha256(result['pdf']).hexdigest(),
                          'reportSha256': hashlib.sha256((folder / 'report.json').read_bytes()).hexdigest(),
                          'pages': report['outputPages']}))
    else:
        raise ValueError('UNKNOWN_WORKER_METHOD')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'error': str(error)[:5000]}, ensure_ascii=False))
        sys.exit(1)
