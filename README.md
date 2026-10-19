# 书页 · 开源中文排版工作台

独立编写的可视化中文排版工具。产品方向已改为参照**方正飞翔印刷版 9.0-1794**；当前网页版为 **Web 0.5.0**，本地版仍为 0.3。**尚未达到飞翔完整功能对等，也不承诺原生文件或版面完全兼容。**

网页版源代码在 [web/](web/)，提供云端工程、登录身份隔离、版本恢复、76 个 HTTP MCP 工具与浏览器内排版。0.5.0 增加自由图文框串接、母版与分节、跨框表格和长注续排、ICC 转换及受限 PDF/X-4 输出，并提供 PDML 保源编辑与 FFX 只读分析。参见 [0.5.0 发布说明](web/docs/release-0.5.0.md)、[网页使用与部署](web/README.md)、[原生格式与复杂排版验收](web/docs/native-rich-pdfx-acceptance.md) 和 [飞翔功能矩阵](web/docs/feixiang-matrix.md)。原生格式完整双向兼容及完整 PDF/X 合规认证尚未完成。仓库中的托管模板没有绑定维护者的 Site ID；自行部署时创建自己的站点并配置身份网关、D1 和 R2。

维护者站点：[书页在线出版工作台](https://inkq.online/shuye/)（独立服务器、私有账号登录，无需 ChatGPT 登录）。[自托管部署与验收](web/docs/self-hosting.md)包含 Node、SQLite、本地存储、Nginx 和 MCP 令牌配置；原 Sites 站点保留，两边后续编辑不会自动同步。

原有本地版及独立 XeLaTeX 印刷后端仍可使用。下文的本机启动和 42 个 stdio MCP 工具属于本地版。

![书页编辑器：注音与合并表格](docs/editor-current.jpg)

## AI / MCP 接入

提供 **44 个标准 stdio MCP 工具**，让 agent 通过代码控制工程、页眉页脚、标题章节、所有现有组件、注释、文献引用、批注及出版输出。包含原子批量修改、修订冲突检测、撤销和编辑器共享工程；不依赖 Computer Use。

安装 Node.js 22.13+（或 24+） 后执行 `npm ci`。完整配置与调用示例见 [MCP 接入指南](docs/mcp.md)，逐项结果见 [MCP 验收](docs/mcp-acceptance.md)。可运行 `npm run demo:mcp` 直接体验代码建书。

## 中文学术期刊改进

新增行内/表内公式、DOCX 导入诊断持久化、TIFF 子集无损导入与字体方案；“最终 PDF 校样”用 PDF.js 显示实际输出，下载字节与校样一致。AI 可通过 `render_candidate` 生成候选，再用 `get_proof_page` 读取真实页面文字坐标，无需操作界面。**这批改动仍不是工业级发印认证。**

产品经理请先看 [方正飞翔调研与期刊差距](docs/founder-fly-journal-gap.md)，研发和验收人员见 [期刊生产验收](docs/journal-production.md)。

## 第一次使用

1. 安装 [Python 3.10 或更新版本](https://www.python.org/downloads/)，Windows 安装时勾选 **Add Python to PATH**。
2. 点击仓库的 **Code → Download ZIP**，解压；或运行 `git clone https://github.com/yran96657-cmyk/-.git open-typesetter`。
3. Windows 双击 `start.cmd`。macOS / Linux 在项目目录运行 `python3 server.py`。浏览器访问 **http://127.0.0.1:8767**。
4. 点击“打开文稿”，选择 `examples/guide.shuye.json`，编辑后点击“保存工程”下载备份。

基础编辑无需 Node.js、npm、原版方正软件或登录账号。Windows 是当前主要验证平台；其他系统浏览器编辑可运行，但字体度量和 PDF 后端需要自行配置。不要直接双击 `index.html`。

需要 PDF 拼版、预检、文字几何预检或 WebP/TIFF 图片转换时，在项目目录执行 `python -m pip install -r requirements.txt`。独立 PDF 排版还需 XeLaTeX 和中文字体，详见 [PDF 安装与限制](docs/pdf-backend.md)。没有 XeLaTeX 时可用“打印 / PDF”调用浏览器打印。

遇到端口占用可用 `python server.py --port 8768`，然后访问对应地址。`python` 找不到时，Windows 可尝试 `py -3 server.py`；macOS / Linux 使用 `python3`。关闭服务终端会停止应用，已下载的工程文件仍保留。开发与反馈方式见 [贡献说明](CONTRIBUTING.md)。

## 启动

编辑器需要 Python 3.10+ 与现代 Chrome / Edge；基础编辑不需要 npm 或第三方 Python 库。Windows 双击 `start.cmd`，保持服务窗口打开，访问 [本机编辑器](http://127.0.0.1:8767)。也可在项目目录运行：

```powershell
python server.py
# 端口被占用时：
python server.py --port 8768
```

不要直接打开 index.html。服务仅监听 127.0.0.1，文稿在本机处理，无云端账号或遥测。KaTeX 公式预览资源随项目本地提供，不访问 CDN。

“最终 PDF 校样”需要先执行 `npm ci`，并另需安装 XeLaTeX / TeX Live 或 TinyTeX、相应宏包与中文字体；WebP 转换需要 Pillow。依赖、安装后的检查及限制见 [PDF 后端说明](docs/pdf-backend.md)。缺少后端时仍可使用编辑器和浏览器打印。PDF 页范围、骑马订拼版和有限预检还需 pypdf；它们不等于完整印前认证。

## 当前功能与范围

| 功能 | 当前实现与边界 |
| --- | --- |
| 可视化编辑 | 白纸分页、纸面编辑、完整段落编辑框、结构导航、添加删除与移动、手动分页、撤销重做；尚非跨段自由富文本编辑器 |
| 版式与样式 | 自定义开本、镜像页边距、1–4 栏、浏览器横排/竖排流式分页、奇偶页眉、起始页码、全局及段落缩进；可保存应用段落样式；基础孤行控制和标题带下文，不是完整中文禁则引擎 |
| 字符样式 | 选中文字设置粗体、斜体、下划线、上下标及清除；模型和导入支持局部字体、字号、颜色；使用系统宋/黑/楷字体，无原版私有字库 |
| 查找替换 | 正文、标题、表格单元格、题注及注释；区分大小写、Unicode 全字、前后导航、当前与全部替换；保护公式语法和脚注引用 |
| 表格 | 可视单元格编辑、矩形合并/拆分、增删行列、列宽、重复表头；保留被覆盖格原文，纵向合并组整体分页；超页合并组只诊断，无单元格内部拆页、嵌套表或卧排 |
| 公式 | 受限 LaTeX 文本输入，KaTeX 预览；支持常见分式、根式、上下标、矩阵等；不是结构化可视公式编辑器或完整 MathType/BD 数学兼容层 |
| 注释 | 引用标记、页下注/文末注、注释编辑；浏览器中高度超过版心 35% 的长注移至文末并警告，复杂跨页注释尚不完整 |
| 目录与索引 | 标题 1–4 级生成目录，索引词列表生成页码；浏览器迭代更新，复杂范围索引、交叉引用及完整辞书排序未实现 |
| 图片 | PNG/JPEG/WebP、宽度和题注，浏览器横排左右绕图；竖排图片与独立 PDF 绕排降为独立块，无自由拖动定位 |
| 导入与工程 | UTF-8/GB18030 TXT、有限 FBD、DOCX、JSON；读取 version 1/2/3；含行内公式、导入记录或新 PDF 设置时保存 version 3；DOCX 支持常见文字样式、表格、内嵌位图、脚注/尾注及部分 OMML，复杂结构警告或降级 |
| 手工注音 | 选区添加/修改/删除拼音或注音符号，完整字素范围和横竖 HTML ruby；不是自动多音字处理或 PY/ZY/PX 兼容 |
| 工程辅助 | 本机工程库快照、书签定位、字符信息、Unicode符号、受限操作序列、版本比较与章节合并；章节统一按当前版式重排，不是 PRO 书籍系统或网络协作 |
| 输出 | JSON、浏览器打印、独立 XeLaTeX PDF；另有页范围、左装订骑马订、裁切标记及有限字体/图像DPI预检；不同引擎输出不同，完整印前未认证 |

原创示例：[入门工程](examples/guide.shuye.json)、[综合出版样稿](examples/publishing-demo.shuye.json)。更多原创样例：[竖排](examples/vertical.shuye.json)、[绕图与表格](examples/flow-and-table.shuye.json)、[合并表格](examples/merged-table.shuye.json)、[注音与表格](examples/ruby-and-table.shuye.json)。逐项事实见 [当前验收账本](docs/acceptance-current.md)，完整功能差距见 [兼容性矩阵](docs/compatibility-matrix.md)。

## 编辑、保存与输出

纸面编辑后离开段落触发重排；跨页长段可在右侧编辑完整内容。局部样式针对当前段内选区。表格可在“编辑表格”窗口操作原格、合并和列宽，也可用原有文本编辑入口；公式在内容框填写数学 LaTeX。带注音段落在纸面点击选择，须在右侧修改基文，避免读音混入正文。编辑触及注音范围时会移除绑定；批量分散转换可能保守清理中间注音，请复核。

Ctrl+S 下载工程。输入区使用浏览器原生撤销；离开输入区后，Ctrl+Z / Ctrl+Shift+Z 操作应用历史，历史只保留在当前会话。自动保存按浏览器 origin 隔离；更换端口/浏览器不共享。配额不足时须另存工程，读取异常存档时保留旧存档并暂停自动覆盖。

工程 JSON 导入/下载上限 100 MB，其他稿件导入上限 20 MB，单图 5 MB。JSON HTTP 请求上限现为 100 MB；PDF 编译内容仍限 30 MB，超限需分卷。最多 10,000 个内容块；单段 300,000 个 UTF-16 单元；表格最多 5,000 行、50 列且总单元格不超过 100,000。千页手动分页样稿已检查页数/顺序/内容唯一性与溢出，但连续复杂整书、耗时、峰值内存和长期恢复尚未全面验收，建议大型稿件按章备份。

浏览器打印前选择正确纸张、100% 比例，关闭浏览器附加页眉页脚。独立 PDF 使用 XeLaTeX 重新分页：**此前同一综合样稿浏览器为 8 页，XeLaTeX 为 9 页**，不可宣称同版。PDF 中长表在多栏稿内改为通栏，短表可保留栏内；重复脚注引用保留原编号；索引近似定位块起始页，跨页表格和单元格词语不保证收全。独立 PDF 暂不支持竖排，图片绕排会退化为独立块并警告。输出后须核对警告、页码、字体和图表。印刷工具可选页、左装订骑马订拼版及添加裁切标记，检查页尺寸、字体嵌入和部分图像有效 DPI；出血只保留已有范围，不生成缺失图文。不提供 PDF/X、CMYK 转换或完整透明度/叠印/专色/总墨量预检，也未实物打样认证。

## 与方正书版、REA 的关系

使用 [REA](https://github.com/morluto/rea) 6.4.0 对用户提供的方正书版 11.0 安装包做过静态 PE 资源调查，并研究随附《书版2008 使用指南》和少量样例。见 [研究摘要](docs/research.md) 与 [FBD 支持范围](docs/fbd-support.md)。安装包版本与手册标题不同，不能把手册说明直接当成 11.0 已验证行为。

本工程未复制原程序、私有字库、图标、模板正文或反编译代码；REA 不是运行依赖。原程序内核未完成反编译，也未完成原版同输入对照测试。FBD 支持 HT 局部样式、简单 BT/SJ、整篇简单 FL 和部分控制符的近似导入；未知注解保留并提示。不写回 FBD，不读取 S10/S72/NPS 大样。PRO 支持有限参数导入，详见下文。

研究资料留在项目外，不进入开源源码发布。原创代码与示例采用 MIT；第三方 KaTeX 按其许可分发，见 [第三方说明](THIRD_PARTY_NOTICES.md)。系统字体与 TeX 发行版不随项目捆绑。本项目与方正无从属或授权背书关系。

## 架构与测试

```text
TXT / FBD / DOCX / JSON
          ↓
version 2/3 模型：layout + blocks（marks/ruby/merges/inlineMath）+ importReports+ notes + styles + indexTerms + bookmarks
          ↓                         ↓
DOM 字体测量与分页           publishing.py → XeLaTeX
          ↓                         ↓
可编辑预览 / 浏览器打印       独立重排 PDF
```

`src/model.mjs` 管理校验与撤销；`src/fbd.mjs` 导入有限 BD 注解；`src/pagination.mjs` 与 `flow-layout.mjs` 进行横竖/绕图分页；`table-layout.mjs` 和 `ruby.mjs` 管理合并格及注音边界；`src/app.mjs`、`advanced-ui.mjs`、`editor-tools.mjs`、`workspace-tools.mjs`、`table-editor.mjs` 提供编辑与工程辅助；`docx_import.py` 转换 DOCX；`publishing.py` 生成独立 PDF，`print_production.py` 做有限预检和拼版；`server.py` 提供本机服务。没有改造或接入上层 `book-layout-engine`，本项目后端是单独实现。

```powershell
node --test tests/*.test.mjs
python -m unittest discover -s tests -p "test_*.py"
```

0.2 排版验收快照：Node **62 通过、1 项可选浏览器跳过**，Python **22 通过**。CUA 竖排样稿 4 页/8 栏无已测溢出；绕图表格稿 4 页、1472 个正文 UTF-16 单元拼接无缺；千页手动分页稿 1000 页/1000 独特段落顺序正确。合并拆分、工程库快照保存/列表读回、注音显示/添加撤销已检查。注音合并表 PDF 为 2 页；骑马订补 2 空白后输出 2 面，修复后“甲组”已视觉复核。详见 [当前逐项账本](docs/acceptance-current.md) 与 [机器可读账本](docs/acceptance.json)。这些是局部用例结果，不是原版整项兼容或完整印前认证。

## 仍未完成

方正书版 11.0 的完整文件/语义/版面兼容与匹配参考 PDF 基线；完整 Word/MathType 还原；PRO、FE、大小样互操作；复杂分区、对照、割注、边注和原 PY/ZY/PX；超页合并组内部拆分、嵌套/卧排表；完整竖排标点混排及独立 PDF 竖排/绕图；EPS/复杂 TIFF、字库/花边/底纹管理、完整中文禁则和缺字诊断；复杂索引与交叉引用；任意折手、爬移补偿、PDF/X/CMYK 与专业印前；章级参数继承、协作、任意宏、CEB、聪明码及专有二维条码。多浏览器、IME、长期恢复、连续复杂整书性能仍需验收。完整请求仍在进行，当前局部通过不能写成全部完成。

## PRO 参数增量验收

新增“PRO 参数”入口：读取GB18030文本，预览BX方向及明确毫米尺寸；应用后原文保存在工程proSources，支持下载完整解析报告。8项用例通过，另只读检查本机9份PRO原文记录完整；CUA验证default.PRO导入与工程保存。旧字号、字体、行距、YM等仅保留并警告；超版式范围拒绝应用；SB只展示文件清单。此为参数子集，不代表完整PRO读写或原版同版。
