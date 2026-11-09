# 书页 · 在线出版工作台

独立开源的中文图书排版网站。产品方向参照方正飞翔印刷版 9.0-1794，**尚未达到飞翔完整功能对等**。Web 0.8.0 包含已验收的自由版面、母版、跨页表格与注释、ICC/PDF 输出和有限 PDML 保留式编辑。按用户要求发布已完成功能，尚未完成项继续明确列出；详见 [发布说明](docs/release-0.5.0.md) 和 [逐项验收](docs/native-rich-pdfx-acceptance.md)。

## 自有服务器

当前地址：[书页在线出版工作台](https://inkq.online/shuye/)。支持独立账号、SQLite/本地文稿存储和 Bearer MCP，不需要 ChatGPT 登录。构建、Nginx、备份与验证见 [自托管部署](docs/self-hosting.md)。原 Sites 部署保留，工程不会自动双向同步。

## 使用

登录网站 → 新建学术期刊/图书/A4 论文/竖排项目 → 编辑纸面或组件属性 → 保存到云端 → 下载 JSON 备份或浏览器打印 PDF。云端版本保存最近十次可恢复历史。归档可恢复，不删除文稿。

支持文字样式、章节、1–4 栏、横竖排、奇偶页眉页脚、图片绕排、表格合并、数学公式、注音、脚注尾注、文献引用、批注、目录索引。“打开文稿”中的浏览器 Word 导入仍是有损子集。含公式的期刊请使用新增的“导入期刊 Word”，它需要独立服务器启用 Python/XeLaTeX，保存原始 OMML、导入诊断及对象身份；发现不支持的内容会拒绝新建工程。

期刊工作流：导入 Word → “期刊模板”设置刊名、卷期、日期与字体 → 右侧指定中英文首面角色、图表锚点和题注 → 保存 → “全文期刊 PDF”。浏览器纸面是结构编辑预览；首面、分页、公式换行和锚点验收以服务端全文 PDF 为准。PDF 与报告绑定源修订，刷新后可“取回期刊校样”；文稿变化后拒绝交付旧校样。下载成功不代表可发印。配置、接口及限制见 [全文期刊生产链](docs/journal-production.md)。0.6.0 增加旧 DOC、MathType、矢量与组合图片兼容、明确的接受修订策略，以及期刊自动排版计划；发布与实稿测试见 [0.6.0 验收](../docs/release-0.6.0.md)。

学术期刊模板直接提供中英文首面角色、编号公式、带锚点的三线表和参考文献。模板内容是明确标注的合成示例；实际使用时替换为自己的稿件。[学术排版工作流](docs/journal-workflow.md)说明 AI 提案、人工微调与校样验收的协作方式。

## 整期与 Word

项目库进入“整期编排与 Word 导出”，加入已应用期刊模板的文章，调整顺序、开本和正文起始页，保存方案并生成。导出包含原生可编辑文字、表格、公式及脚注；目录以这份整期 Word 渲染出的 PDF 为准。历史方案恢复保存为新修订；“取回上次任务”可读取 agent 创建的任务。详见 [使用、MCP 与边界](docs/issue-composition.md)。

## Agent / MCP

当前工作区 `POST /mcp` 提供 113 个工具，与编辑器共享用户隔离的云端工程。Sites 使用发布生成的个人插件，自托管使用 Bearer MCP。`list_projects` → `get_project_context` → `list_components` → `apply_changes`，修改必须携带 `expectedRevision`，可先使用 `dryRun:true`。所有操作按稳定组件 ID 定位，无 computer-use 依赖。新增期刊工具先调用 `get_journal_capabilities`，只有 `enabled:true` 才能进行原生导入和全文 PDF 编译；Workers 部署不支持本机 TeX。

`inspect_journal_docx` 可在创建项目之前检查原稿的修订、公式和图像。125 MP 单帧 TIFF、MTEF/EMF 来源校验与修订策略的整合边界见 [导入链验证](docs/journal-import-integration.md)。


模型 v4 在保留 v3 `composition` 的同时，新增首面角色、带来源摘要的行内/表内公式、脚注标记、图表锚点及不可抹去的导入报告。`get_journal_proof_page` 返回实际 PDF 的对象与文字坐标，AI 可据此定位和修改源组件，再按新修订输出校样。它不等同于视觉或数学语义验收。

模型 v3 的 `composition` 保存页面、文字/图片/色块、母版和独立文字流。`upsert_frame` 操作毫米几何；`upsert_story` 管理原文；`thread_frames` 设置有序框 ID；`split_story` 在字素边界拆分原文与框链；`override_master_object` 设置页面或子母版覆盖，`reset:true` 恢复继承。`upsert_master.baseMasterId` 继承父母版；`upsert_section` 按章节起始页设置首页、奇数页和偶数页母版，奇偶按物理页位置计算。页面显式母版优先，`assign_master` 的 `inherit:true` 恢复章节规则，`masterId:null` 显式不使用母版。改章节/重排页面时保留仍有效的覆盖，移除无来源覆盖。母版文字支持 `{title}`、`{page}`、`{physicalPage}`、`{section}`、`{sectionPage}`。`set_slot_content` 按槽标识保留页面内容，切换母版后仍在；`master_from_page` 从未串接页面创建母版。章节支持页码重启、阿拉伯/罗马/中文格式，`align_section_start` 按左右页要求插入空白页。框和页面删除后原文仍在文字流内。完整 schema 由 `get_document_schema` 返回，页面合成结果用 `list_page_objects` 读取。

自由文字流支持不同字号、字体和颜色范围、横竖排、不等宽栏、多边形文章区、矩形避让与基础中文禁则。`paginate_story` 按提供的字体自动创建续排框和页面，保留原文及局部样式，在后续章节之前插页；操作受修订号、dry-run 与原子失败保护。默认字体字段为 `fontBase64`，使用无衬线/楷体时另传 `fontFamilyBase64.sans/kai`。

结构文字流用 `story.blocks` 保存段落与表格，`story.notes` 保存带稳定 ID 的脚注/尾注，`story.text` 留空。表格支持不等列宽、横纵合并、跨框拆分超高行、完整重复表头，长脚注随引用排入栏底并带续页标识，尾注排在流末。浏览器提供单元格编辑与合并/拆分；MCP 提供 `story_table_set_cell/merge/split/resize`、`story_update_paragraph`、`story_update_note`，可随整篇工程保存、恢复。当前结构流要求横排矩形框、相同列宽/字体度量，可使用等宽多栏和不同框高；每条注释仅允许一个源引用。自动续排、浏览器和 PDF 共用排版计划。超出支持范围会拒绝输出并显示诊断。

“导出排版 PDF”或 `export_composition_pdf` 支持多字体嵌入、TrimBox/BleedBox、裁切标记、骑马订、显式 CMYK、专色及叠印。允许子集化的 TTF/CFF 字体只嵌入所需字形。上传印刷 ICC 后，使用 LittleCMS 的真实转换；RGB 图片的内嵌 ICC、CMYK JPEG 的内嵌/指定源 ICC 会参与转换，PNG 透明度保留。未标记 RGB 按 sRGB 处理，缺少源 ICC 的 CMYK 转换拒绝。`pdfX:true` 写出 PDF/X-4 标识、OutputIntent、XMP 与文件 ID；**仅通过项目声明范围的独立结构检查，尚未获得完整 ISO 15930-7 合规验证**。必须使用适合印厂条件的真实 ICC；测试目录中的合成 ICC 不能用于印刷。

导出会拒绝缺字、溢出、未解析引用、低 DPI、超出总墨量上限和无效 ICC。图片最多 200 万像素，PNG/JPEG 以外格式不进入此输出链路。屏幕使用系统字体和近似色彩，没有跨设备同版、ICC 软打样或叠印预览保证。

文稿保存在 R2，用户/工程索引、当前修订和历史指针在 D1。服务端从部署平台注入的身份读取用户 ID，不接收请求体中的用户 ID。普通部署必须在可信网关中去除外部伪造身份头，再注入验证后的身份；不得将 Worker 直接裸露后信任任意客户端提供的身份头。

## 开发与验证

Node 22.13+（完整自动测试使用 Node 24 的 `node:sqlite`），npm ci，npm test，npm run build。Windows 若 npm.cmd 路径解析失败，可用 `node "C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js" run build`。

本地数据库：首次构建后，使用 `node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_regular_quasimodo.sql`。仅初始化一次。随后 npm run dev，在输出的本地地址登录测试账号。

`npm run test:http` 针对正在运行的本地服务验证真实 HTTP MCP、D1/R2 与冲突拒绝。生产部署由 Sites 工作流构建和发布；schema migration 自动应用。已应用的迁移不可修改，新增表结构需要追加迁移。

参见 [验收记录](docs/web-acceptance.md)、[飞翔功能矩阵](docs/feixiang-matrix.md)、[框架运行说明](docs/framework-runtime.md)。

## 限制

单工程 20 MB；列表最多 200 个工程。自由版面最多 1000 页、5000 个对象；自动续排单次增加最多 200 页。自由版面 PDF 单次最多 200 页，响应最多 8 MB；浏览器输出时需要选择字体和 ICC。全文期刊 PDF 的工作进程、超时及存储限制见专门文档。正文顺序流和自由版面仍是两套模型，混合工程的全文期刊输出会拒绝，不会静默遗漏画布。复杂表格和跨页注释已进入受限结构流，注音、竖排表格、异形表格及全中文标点规则仍未覆盖。全文期刊已支持段落锚定和题注同页；任意位置浮动/绕排、完整中文禁则/标点挤压、专业图层与对象样式、飞翔原生编辑往返、EPUB 和生产级实时协作仍有缺口。

历史旧对象为恢复保留，暂未实现存储垃圾回收。数据库响应不确定时保留 R2 稿件，并尝试核对已提交版本；可能留下未引用对象，以避免误删已提交文稿。项目数限制在并发创建时不是严格配额。

MIT。仅包含独立源代码与声明的第三方依赖，不包含方正程序、字库或用户稿件。第三方许可见 THIRD_PARTY_NOTICES.md 和 build/sites-vite-plugin.LICENSE。

本轮使用用户提供的飞翔 9.0.0.1794 安装包做静态研究。`open_founder_pdml` / `edit_founder_pdml` 提供保留原文的 PDML 编辑：SHA-256 防冲突，文本按原有字符边界等长修改，可改对象几何和已有样式，未改动 XML 原样保留。“PDML 原文编辑”按钮支持打开、编辑和下载。显式页面原点、单页纸板纯文本子集可用 `import_founder_pdml_composition` / `export_founder_pdml_composition` 导入画布结构和写回；不支持的原生特性明确拒绝。真实捆绑模板通过原文保留修改与逆操作测试，但未在飞翔重新打开、重排和保存。

`inspect_founder_ffx` / `scripts/inspect-founder-ffx.mjs` 对随包旧版 FFX 连续解析 18 条对象记录，遇未知类型/版本原位停止；没有 FFX 写出。下一类序列化进入受保护代码区，尚未恢复字段定义。用户没有飞翔账号，不再重复要求登录。详见 [当前验收](docs/native-rich-pdfx-acceptance.md)、[PDF/X 验证边界](docs/pdfx-validation-acceptance.md) 和 [研究依据](docs/fx9-research-acceptance.md)。

## AI 排版工作台

期刊编辑器默认打开 Agent 任务面板，完整工具集中在“全部工具”（Ctrl/⌘K）。独立服务器配置本机 Ollama 与期刊引擎后，可连续执行检查、版式应用、PDF 校样和机器检查；人处理例外、审阅结果或整次撤销。后台任务关闭页面仍可继续，外部 Agent 使用同一组任务工具。见 [Agent 工作流](docs/agent-workflow.md)。配置和真实模型验收见 [AI 排版工作台](docs/ai-workbench.md)。

普通 API 模型的部署、出站连接器、批量样式与任务恢复见 [API Agent](../docs/api-agent.md)。
