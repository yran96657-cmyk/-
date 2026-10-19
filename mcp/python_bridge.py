"""Bounded JSON stdin/stdout adapter for the existing publishing backend."""
import base64
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

def main():
    data=sys.stdin.buffer.read(100*1024*1024+1)
    if len(data)>100*1024*1024: raise ValueError('BACKEND_REQUEST_TOO_LARGE')
    request=json.loads(data)
    command=request['command']
    if command=='capabilities':
        import importlib.util
        import shutil
        from publishing import TEX_DEFAULT
        return {'python':sys.version.split()[0],'xelatex':bool(shutil.which('xelatex') or TEX_DEFAULT.exists()),'pypdf':importlib.util.find_spec('pypdf') is not None,'pillow':importlib.util.find_spec('PIL') is not None,'pdfminer':importlib.util.find_spec('pdfminer') is not None,'platform':sys.platform}
    if command=='preflight_pdf':
        from print_production import process_pdf
        from proof import inspect_output
        output=inspect_output(process_pdf(base64.b64decode(request['data'],validate=True),request.get('options',{})))
        return {'pdf':base64.b64encode(output['pdf']).decode('ascii'),'report':output['report']}
    if command=='import_docx':
        from docx_import import import_docx
        return import_docx(base64.b64decode(request['data'],validate=True))
    if command!='export_pdf': raise ValueError('Unsupported backend command: '+str(command))
    from proof import render_proof
    output=render_proof(request['document'],request.get('options',{}))
    return {'pdf':base64.b64encode(output['pdf']).decode('ascii'),'report':output['report']}

if __name__=='__main__':
    try:
        sys.stdout.buffer.write(json.dumps(main(),ensure_ascii=False).encode('utf-8'))
    except Exception as error:
        sys.stdout.buffer.write(json.dumps({'error':str(error)},ensure_ascii=False).encode('utf-8'))
        sys.exit(1)
