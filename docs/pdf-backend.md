# 期刊 PDF 校样增量说明

当前工作树支持 `layout.fontSet: "windows" | "mac" | "fandol"`，优先于 `SHUYE_FONTSET` 环境变量；未设置时保留 Windows 默认。字体缺失时报错，不隐式换字库。Fandol 使用 TeX 自带字体；这不是具体期刊字体许可或模板的替代证明。

点击 **最终 PDF 校样** 后，PDF.js 从本机依赖渲染实际生成的 PDF，下载复用同一份字节，浏览器会核对 SHA-256。此入口需要先 `npm ci`，以及 `python -m pip install -r requirements.txt` 和 XeLaTeX。旧版的浏览器打印仍使用 DOM 排版；不能把两者页数相同当作质量保证。

短表在双栏等多栏版式中默认留在栏内（最多 10 行、4 列）；`placement: "column"` 强制栏内不可拆表，`"full-width"` 强制通栏可跨页。长表仍用 longtable；跨栏浮动、自动宽度适配、超页合并格内部分页没有完成。表格脚注显示为表后注，重复正文引用保留同一编号，不再改成星号；它不等于跨页底部脚注引擎。

`/api/render-proof` 和 `/api/production` 返回最终字节的哈希、字体、DPI、文字几何、导入诊断与未检查项。几何采用 PDF 字体度量框，不能检测全部遮挡、墨迹出界、内容语义或锚定关系。缺少几何依赖时返回 `NOT_CHECKED`，并保持 `INCOMPLETE`；已发现内容丢失、缺字、超宽或文字出页时为 `BLOCKED`。`productionReady` 始终为 `false`，正式发印须另行完成所列验收。

JSON HTTP 请求上限统一为 100 MB，DOCX 原件上限仍为 20 MB。模型允许的工程规模不代表 XeLaTeX 和 MCP 一次能处理该规模；PDF 编译内容仍有 30 MB、单次编译 90 秒、MCP 返回 100 MB 等保护。建议按篇处理并实测峰值内存和耗时。

详细执行方法与限制见 [期刊生产验收](journal-production.md)。以下为原版后端说明；其 Windows 默认仍有效，旧重复脚注与全部通栏限制以本节为准。

---

# 独立 PDF 出版后端与 DOCX 导入

MIT 独立实现。`publishing.render_pdf(doc)` 返回 `{pdf: bytes, warnings: list[str]}`；`build_tex(doc, assets_dir)` 返回 `(tex_source, warnings)`。`docx_import.import_docx(data)` 返回 `{blocks, notes, warnings}`。

## 依赖与运行

安装 XeLaTeX（TeX Live 或 TinyTeX），确保 xelatex 在 PATH。Windows 另自动查找 `%APPDATA%/TinyTeX/bin/windows/xelatex.exe`。需 ctex、fontspec、geometry、graphicx、longtable、booktabs、amsmath、amssymb、fancyhdr、multicol、ulem、hyperref、multirow、ruby。默认中文字体宋体、黑体、楷体，适合 Windows；其他系统需要调整字体设置。WebP 转 PNG 需 Pillow，拼版与预检需 pypdf。

每次导出在独立临时目录编译两遍，并清理临时文件。单次编译超时 90 秒；并发导出返回忙碌错误。数学命令使用白名单，禁止文件、网络、任意宏定义与 TeX 字符编码逃逸；编译关闭 shell escape，限制文件访问。普通正文、页眉、表格、注释严格转义。此接口是本地工具，不应直接公开到互联网。

## 已实现

- 横排中文、1–4 栏，奇偶页边距、页眉、外侧页码、自定义开本和版心。
- 标题、正文、逐字字体族与字号、粗体、斜体、下划线、上下标、缩进。
- 基础数学 LaTeX 公式，PNG/JPEG/WebP 图片。
- 跨页长表、重复表头、网格表和三线表，跨行跨列合并、百分比列宽及基文上方手工注音。多栏中的长表转为通栏。
- 脚注、尾注、目录、索引页码（索引定位到包含词语的段落起始页）。
- DOCX 标题层级、常见 run 格式（UTF-16 偏移）、表格、内嵌图片、脚注/尾注，以及分数、根式、上下标、大运算符、矩阵 OMML 转换。

## 明确限制

浏览器与 XeLaTeX 分页并非同一引擎，导出前须检查正式 PDF。竖排直接报错；不声称支持。字体效果随本机字体而变。表格合并组保持整体；长到超过一页的合并组需人工拆分。段内图片、公式变成独立块，图片绕排退化为独立块并警告，浮动定位、文本框、旧式绘图与 OLE 不能完整恢复。未知内容输出警告；Word 原页眉页脚需重建。复杂 OMML 退化为可读文本并提示核对。脚注重复引用以星号表示；索引跨页长段落须核对。孤行采用 TeX 的策略，不能保证浏览器参数完全一致。

`print_production.process_pdf(bytes, options)` 提供页范围提取、左装订骑马订拼版（补空白至4页倍数）、已有图文出血区域和裁切标记。报告列出纸张、字体嵌入及部分图像有效 DPI；不生成缺失出血图文，不作 PDF/X 或 CMYK 转换。尚无实物双面印刷验证、爬移补偿和任意折手。

## 验证

`python -m unittest discover -s tests -p test_publishing.py -v`

`python -m unittest discover -s tests -p test_docx_v2.py -v`

包含恶意 TeX 命令/字符逃逸拒绝、文本转义、UTF-16 样式、脚注、重复表头、目录、OMML、XML 实体拒绝，以及中文/数学/80 行长表的真实 XeLaTeX 编译。
