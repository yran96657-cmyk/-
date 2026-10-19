"""Resolve visible Word list labels before removing the Word package.

Counters belong to concrete numId instances. Unsupported numbering fails the
import gate instead of quietly dropping a reference/step number.
"""
import re

W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'

def val(parent,path,default=None):
    e=parent.find('/'.join(W+p for p in path.split('/'))) if parent is not None else None
    return e.get(W+'val',default) if e is not None else default

def format_number(n,fmt):
    if fmt=='decimal':return str(n)
    if fmt=='decimalZero':return str(n).zfill(2)
    if fmt=='chicago':
        if not 1<=n<=6:raise ValueError('重复符号编号须核对 Word 原稿')
        symbols=['*','†','‡','§','‖','¶'];return symbols[(n-1)%6]*((n-1)//6+1)
    if n<1:raise ValueError('字母/罗马数字编号须为正数')
    if fmt in ('lowerLetter','upperLetter'):
        if n>26:raise ValueError('多字母编号须核对 Word 原稿')
        text=''
        while n:n,r=divmod(n-1,26);text=chr(65+r)+text
        return text.lower() if fmt=='lowerLetter' else text
    if fmt in ('lowerRoman','upperRoman') and n<4000:
        text=''
        for value,token in [(1000,'M'),(900,'CM'),(500,'D'),(400,'CD'),(100,'C'),(90,'XC'),(50,'L'),(40,'XL'),(10,'X'),(9,'IX'),(5,'V'),(4,'IV'),(1,'I')]:
            q,n=divmod(n,value);text+=token*q
        return text.lower() if fmt=='lowerRoman' else text
    raise ValueError('编号格式 '+str(fmt)+' 未支持')

class Numbering:
    def __init__(self,root,styles,warnings):
        self.warnings=warnings;self.counts={};self.source_count=0;self.imported_count=0
        self.nums={n.get(W+'numId'):n for n in root.findall(W+'num')} if root is not None else {}
        self.abstracts={n.get(W+'abstractNumId'):n for n in root.findall(W+'abstractNum')} if root is not None else {}
        self.styles={s.get(W+'styleId'):s for s in styles.findall(W+'style')} if styles is not None else {}

    def properties(self,p):
        result={};style=val(p,'pPr/pStyle');seen=set();chain=[p.find(W+'pPr')]
        while style and style not in seen:
            seen.add(style);s=self.styles.get(style)
            if s is None:break
            chain.append(s.find(W+'pPr'));style=val(s,'basedOn')
        for props in reversed(chain):
            for key in ('numId','ilvl'):
                value=val(props,'numPr/'+key)
                if value is not None:result[key]=value
        return result

    def level(self,num,level):
        concrete=self.nums.get(num)
        if concrete is None:raise ValueError('找不到 numId='+num)
        abstract=self.abstracts.get(val(concrete,'abstractNumId'))
        if abstract is None:raise ValueError('找不到抽象编号定义')
        if abstract.find(W+'numStyleLink') is not None:raise ValueError('链接编号样式尚未支持')
        override=next((e for e in concrete.findall(W+'lvlOverride') if e.get(W+'ilvl')==str(level)),None)
        definition=override.find(W+'lvl') if override is not None else None
        if definition is None:definition=next((e for e in abstract.findall(W+'lvl') if e.get(W+'ilvl')==str(level)),None)
        if definition is None:raise ValueError('找不到编号层级 '+str(level))
        start=int(val(override,'startOverride',val(definition,'start','0')))
        return definition,start

    def prefix(self,p):
        props=self.properties(p);num=props.get('numId')
        if not num or num=='0':return ''
        self.source_count+=1
        try:
            level=int(props.get('ilvl','0'))
            if not 0<=level<=8:raise ValueError('编号层级超界')
            definition,start=self.level(num,level);counts=self.counts.setdefault(num,{})
            counts[level]=counts.get(level,start-1)+1
            for child in list(counts):
                if child<=level:continue
                childdef,_=self.level(num,child);restart=int(val(childdef,'lvlRestart',str(child)))
                if restart and level==restart-1:counts.pop(child)
            if definition.find(W+'lvlPicBulletId') is not None:raise ValueError('图片项目符号尚未支持')
            fmt=val(definition,'numFmt','decimal');label=val(definition,'lvlText','')
            if fmt=='none':label=''
            elif fmt=='bullet':
                if any(0xE000<=ord(c)<=0xF8FF for c in label):raise ValueError('字体编码项目符号尚未支持')
            else:
                def replace(m):
                    index=int(m[1])-1
                    if index>level:raise ValueError('编号引用较深层级')
                    spec,initial=self.level(num,index)
                    return format_number(counts.get(index,initial),'decimal' if definition.find(W+'isLgl') is not None else val(spec,'numFmt','decimal'))
                label=re.sub(r'%([1-9])',replace,label)
            self.imported_count+=1
            suffix=val(definition,'suff','tab')
            return label+('' if not label or suffix=='nothing' else ' ')
        except (ValueError,TypeError) as error:
            self.warnings.append('Word 自动编号未完整恢复：'+str(error)+'；须核对原稿。');return ''

def check_fields(root,warnings):
    stack=[];count=0
    for e in root.iter():
        if e.tag==W+'fldSimple':
            count+=1
            if not ''.join(t.text or '' for t in e.iter(W+'t')).strip():warnings.append('Word fldSimple 域缺少可见缓存结果，须在原稿中更新。')
        elif e.tag==W+'fldChar':
            kind=e.get(W+'fldCharType')
            if kind=='begin':stack.append({'separated':False,'text':''});count+=1
            elif kind=='separate' and stack:stack[-1]['separated']=True
            elif kind=='end' and stack:
                f=stack.pop()
                if not f['separated'] or not f['text'].strip():warnings.append('Word 域缺少可见缓存结果，须在原稿中更新。')
            else:warnings.append('Word 域边界不完整，须核对原稿。')
        elif e.tag==W+'instrText' and not stack:warnings.append('Word instrText 缺少域边界，须核对原稿。')
        elif e.tag==W+'t':
            for f in stack:
                if f['separated']:f['text']+=e.text or ''
    if stack:warnings.append('Word 域边界未闭合，须核对原稿。')
    return count
