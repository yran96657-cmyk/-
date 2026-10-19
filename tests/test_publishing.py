import unittest, tempfile, os, shutil
from pathlib import Path
from publishing import safe_math, build_tex, render_pdf, TEX_DEFAULT

class PublishingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        (Path(__file__).resolve().parents[1]/'tmp').mkdir(exist_ok=True)
    def test_reject_programs(self):
        for value in [r'^^5cinput{secret}',r'\input{secret}',r'\write18{cmd}',r'\csname input\endcsname',r'\begin{document}',r'\catcode1=2',r'\def\a{x}',r'\href{file:///secret}{x}',r'\includegraphics{x}',r'\text{\input{x}}','x% comment',r'\begin\foo']:
            with self.subTest(value=value),self.assertRaises(ValueError): safe_math(value)
    def test_math(self):
        self.assertEqual(safe_math(r'\frac{a_1}{\sqrt{b}}+\begin{matrix}1&2\\3&4\end{matrix}'),r'\frac{a_1}{\sqrt{b}}+\begin{matrix}1&2\\3&4\end{matrix}')
    def test_escape_and_structure(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[1]/'tmp') as d:
            source,warnings=build_tex({'layout':{'columns':2},'notes':[{'id':'n','text':'注释'}],'blocks':[{'type':'paragraph','text':r'\input{x}[^n]'},{'type':'table','placement':'full-width','rows':[['标题','数值'],['甲','1']],'headerRows':1,'borderStyle':'three-line'},{'type':'toc'}]},d)
            self.assertIn(r'\textbackslash{}input\{x\}',source); self.assertIn(r'\footnote[1]{注释}',source)
            self.assertIn(r'\endhead',source); self.assertIn(r'\begin{longtable}',source); self.assertIn(r'\tableofcontents',source)
    def test_table_titles_and_endnote_numbers(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[1]/'tmp') as d:
            source,warnings=build_tex({'layout':{'notesMode':'endnote'},'notes':[{'id':'zeta','text':'第一条'},{'id':'alpha','text':'第二条'}],'blocks':[{'type':'paragraph','text':'先引第二条[^alpha]，再引第一条[^zeta]，重复[^alpha]。'},{'type':'table','text':'表 1 原创测试数据 & 校验','rows':[['甲','乙'],['1','2']],'headerRows':1}]},d)
            first=source.index(r'\endfirsthead'); repeat=source.index(r'\endhead')
            self.assertIn(r'表 1 原创测试数据 \& 校验',source[:first])
            self.assertIn(r'表 1 原创测试数据 \& 校验（续）',source[first:repeat])
            self.assertNotIn(r'\caption',source)
            self.assertEqual(source.count(r'\textsuperscript{2}'),2)
            self.assertIn(r'\textsuperscript{1}',source)
            self.assertIn(r'\textbf{注 1} 第一条',source)
            self.assertIn(r'\textbf{注 2} 第二条',source)
            self.assertNotIn(r'\textsuperscript{*}',source)
    def test_merged_cells_preserve_all_text(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[1]/'tmp') as d:
            source,warnings=build_tex({'blocks':[{'type':'table','rows':[['甲','乙','A'],['丙','丁','B'],['C','D','E']],'columnWidths':[20,30,50],'headerRows':1,'merges':[{'row':0,'col':0,'rowspan':2,'colspan':2}]}]},d)
            self.assertIn(r'\multirow[t]{2}',source)
            self.assertIn(r'甲\newline 乙\newline 丙\newline 丁',source)
            self.assertIn(r'\multicolumn{2}',source)
            self.assertIn('0.5\\ShuyeTableWidth',source)
            self.assertIn(r'\setlength{\ShuyeTableWidth}{\linewidth}\begin{longtable}',source)
            self.assertNotIn(r'0.5\linewidth',source)
            self.assertTrue(any('表头' in w for w in warnings))
    def test_wrap_warning(self):
        import base64
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[1]/'tmp') as d:
            _,warnings=build_tex({'blocks':[{'type':'image','src':'data:image/png;base64,'+base64.b64encode(b'image').decode(),'wrap':'left'}]},d)
            self.assertTrue(any('环绕' in w for w in warnings))
    def test_ruby_utf16_marks_and_escaping(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[1]/'tmp') as d:
            source,_=build_tex({'blocks':[{'type':'paragraph','text':'😀前中文后','marks':[{'start':3,'end':4,'bold':True}],'ruby':[{'start':3,'end':5,'text':r'zhong \input{x} & wen'}]}]},d)
            self.assertIn(r'😀前\ruby{\textbf{中}文}{zhong \textbackslash{}input\{x\} \& wen}后',source)
            self.assertEqual(source.count('中文'),0)
            self.assertEqual(source.count(r'\textbf{中}文'),1)
            with self.assertRaises(ValueError):build_tex({'blocks':[{'type':'paragraph','text':'😀中','ruby':[{'start':1,'end':3,'text':'invalid'}]}]},d)
            with self.assertRaises(ValueError):build_tex({'blocks':[{'type':'paragraph','text':'中文','ruby':[{'start':0,'end':2,'text':'a'},{'start':1,'end':2,'text':'b'}]}]},d)
    def test_utf16_marks(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[1]/'tmp') as d:
            source,_=build_tex({'blocks':[{'type':'paragraph','text':'😀中文','marks':[{'start':2,'end':4,'bold':True}]}]},d)
            self.assertIn(r'\textbf{中文}',source)
    def test_vertical_rejected(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[1]/'tmp') as d:
            with self.assertRaises(ValueError): build_tex({'layout':{'vertical':True}},d)
    @unittest.skipUnless(shutil.which('xelatex') or TEX_DEFAULT.exists(),'XeLaTeX not installed')
    def test_real_compile(self):
        doc={'layout':{'fontSet':'fandol','columns':2},'notes':[{'id':'1','text':'真实脚注内容'}],'indexTerms':['测试'],'blocks':[{'type':'toc'},{'type':'heading','level':1,'text':'中文测试'},{'type':'paragraph','text':'测试正文及脚注[^1]。','ruby':[{'start':0,'end':2,'text':'cè shì'}],'marks':[{'start':0,'end':2,'bold':True}]},{'type':'equation','text':r'\frac{1}{2}+\sqrt{x}'},{'type':'table','text':'表 1 原创测试数据','headerRows':1,'borderStyle':'three-line','rows':[['名称','数量']]+[['中文长表格测试',str(i)] for i in range(80)]},{'type':'table','text':'合并表格','rows':[['甲','乙','A'],['丙','丁','B'],['C','D','E']],'columnWidths':[20,30,50],'headerRows':1,'merges':[{'row':0,'col':0,'rowspan':2,'colspan':2}]},{'type':'index','text':''}]}
        result=render_pdf(doc); self.assertTrue(result['pdf'].startswith(b'%PDF')); self.assertGreater(len(result['pdf']),10000)
if __name__=='__main__': unittest.main()
