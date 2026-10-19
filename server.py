"""Local-only static workbench and bounded, execution-free DOCX paragraph import."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from io import BytesIO
from zipfile import ZipFile, BadZipFile
import argparse
import json
import base64
import binascii
import hashlib
import subprocess
import os
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent
NS = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
W = '{' + NS['w'] + '}'
MAX_UPLOAD = 20 * 1024 * 1024

from docx_import import import_docx
from publishing import render_pdf
from urllib.parse import quote, unquote

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def allowed_host(self):
        return self.headers.get('Host') in {f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'}

    def do_GET(self):
        if not self.allowed_host():
            self.send_error(403); return
        # Serve only public application files, not local reports or configuration.
        route = self.path.split('?',1)[0]
        allowed = {'/','/index.html','/style.css','/flow-layout.css','/table-editor.css','/workspace-tools.css','/src/app.mjs','/src/model.mjs','/src/pagination.mjs','/src/fbd.mjs','/src/advanced-ui.mjs','/src/editor-tools.mjs','/src/flow-layout.mjs','/src/table-layout.mjs','/src/table-editor.mjs','/src/workspace-tools.mjs','/src/production-ui.mjs','/src/pro.mjs','/src/pro-ui.mjs'}
        vendor = (ROOT / unquote(route).lstrip('/')).resolve()
        allowed.update({'/src/integrity.mjs','/src/proof-ui.mjs','/ruby.css','/src/ruby.mjs'})
        allowed.update({'/src/references.mjs','/src/mcp-ui.mjs','/src/project-sync.mjs'})
        allowed.update({'/src/journal.mjs','/src/journal-ui.mjs','/node_modules/pdfjs-dist/build/pdf.mjs','/node_modules/pdfjs-dist/build/pdf.worker.mjs'})
        vendor_ok = route.startswith('/vendor/katex/') and vendor.is_relative_to((ROOT/'vendor/katex').resolve()) and vendor.is_file()
        for directory in ('cmaps','standard_fonts','wasm'):
            prefix='/node_modules/pdfjs-dist/'+directory+'/'
            if route.startswith(prefix) and vendor.is_relative_to((ROOT/prefix.lstrip('/')).resolve()) and vendor.is_file(): vendor_ok=True
        if route not in allowed and not vendor_ok:
            self.send_error(404); return
        super().do_GET()

    def end_headers(self):
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Cache-Control','no-store')
        super().end_headers()

    def guess_type(self, path):
        return 'text/javascript' if path.endswith('.mjs') else super().guess_type(path)

    def do_POST(self):
        if not self.allowed_host():
            self.send_error(403); return
        origin = self.headers.get('Origin')
        if origin and origin not in {f'http://127.0.0.1:{self.server.server_port}',f'http://localhost:{self.server.server_port}'}:
            self.send_error(403); return
        if self.path not in {'/api/import-docx','/api/render-proof','/api/export-pdf','/api/production','/api/mcp-projects'}:
            self.send_error(404); return
        try:
            length = int(self.headers.get('Content-Length','0'))
            limit=MAX_UPLOAD if self.path=='/api/import-docx' else 100*1024*1024
            if not 0 < length <= limit:
                raise ValueError('请求超过限制（DOCX 20 MB，工程 100 MB）。')
            data = self.rfile.read(length)
            if self.path == '/api/mcp-projects':
                env = dict(os.environ)
                env.setdefault('SHUYE_PYTHON', __import__('sys').executable)
                run = subprocess.run(['node',str(ROOT/'mcp/bridge.mjs')],input=data,capture_output=True,timeout=30,env=env,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
                if not run.stdout:
                    raise ValueError('请先安装 Node.js 22+ 并在项目目录执行 npm ci。')
                result=json.loads(run.stdout)
                payload=json.dumps(result,ensure_ascii=False).encode('utf-8')
                self.send_response(400 if run.returncode else 200);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(payload)));self.end_headers();self.wfile.write(payload);return
            if self.path in ('/api/production','/api/render-proof'):
                from print_production import process_pdf
                from proof import render_proof, inspect_output
                request=json.loads(data)
                if not isinstance(request,dict): raise ValueError('出版请求格式无效。')
                if 'doc' in request:
                    doc=request['doc']
                    if not isinstance(doc,dict) or doc.get('format')!='open-typesetter' or doc.get('version') not in (1,2,3,4): raise ValueError('工程格式无效。')
                    production=render_proof(doc,request.get('options',{}))
                elif isinstance(request.get('pdf'),str):
                    production=inspect_output(process_pdf(base64.b64decode(request['pdf'],validate=True),request.get('options',{})))
                else: raise ValueError('缺少工程或 PDF。')
                payload=json.dumps({'pdf':base64.b64encode(production['pdf']).decode('ascii'),'report':production['report']},ensure_ascii=False).encode('utf-8')
                self.send_response(200);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(payload)));self.end_headers();self.wfile.write(payload);return
            if self.path == '/api/export-pdf':
                doc = json.loads(data)
                if not isinstance(doc,dict) or doc.get('format')!='open-typesetter' or doc.get('version') not in (1,2,3,4):
                    raise ValueError('工程格式无效。')
                result = render_pdf(doc)
                payload = result['pdf']
                self.send_response(200)
                self.send_header('Content-Type','application/pdf')
                self.send_header('Content-Length',str(len(payload)))
                self.send_header('X-Production-Ready','false')
                self.send_header('X-PDF-SHA256',hashlib.sha256(payload).hexdigest())
                result['warnings'] += [d['message'] for r in doc.get('importReports',[]) for d in r['diagnostics']]
                self.send_header('X-Layout-Warnings',quote(json.dumps(result['warnings'],ensure_ascii=False)))
                self.end_headers()
                self.wfile.write(payload)
                return
            result = import_docx(data)
            code = 200
        except (ValueError, BadZipFile, KeyError, ET.ParseError, RuntimeError, NotImplementedError, TypeError, AttributeError, OSError, ImportError, binascii.Error, subprocess.TimeoutExpired) as e:
            result = {'error':f'处理失败：{e}'}
            code = 400
        payload = json.dumps(result, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Content-Length',str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port',type=int,default=8767)
    args = parser.parse_args()
    server = ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
    print(f'书页已启动：http://127.0.0.1:{args.port}  （Ctrl+C 退出）',flush=True)
    server.serve_forever()
