# 用 MCP 让 agent 编排图书

书页 0.3.0 提供 **44 个 MCP 工具、工程资源和工作流提示词**。agent 直接操作结构化模型，无需 Computer Use、截图或浏览器自动化；MCP 服务不需要先打开编辑器。模型调用由你的 agent 提供，书页不需要大模型 API Key。

## 安装和连接

需要 Node.js 22.13+（或 24+）。DOCX、PDF 能力及编辑器共享工程另需 Python 3.10+。

```sh
git clone https://github.com/yran96657-cmyk/-.git open-typesetter
cd open-typesetter
npm ci
python -m pip install -r requirements.txt
```

把服务项添加到支持 **stdio MCP** 的 agent 客户端，替换绝对路径。已有其他 MCP 配置时合并 `shuye` 条目即可。不要用 `npm run` 作为 stdio command，以免 npm 普通输出混入协议。

```json
{
  "mcpServers": {
    "shuye": {
      "command": "node",
      "args": ["C:/tools/open-typesetter/mcp/server.mjs", "--workspace", "C:/books/shuye-workspace"],
      "env": {"SHUYE_PYTHON": "python"}
    }
  }
}
```

Node/Python 不在客户端 PATH 时填写可执行文件绝对路径。Windows JSON 路径可使用 `/`。独立 PDF 另需安装 [XeLaTeX 与中文字体](pdf-backend.md)；Python 包不会安装 TeX 或字库。先调用 `get_capabilities` 检查后端依赖。

运行真实客户端示例：

```sh
npm run demo:mcp
npm run demo:mcp -- --pdf
# 自定义工作目录：
node scripts/mcp-demo.mjs --workspace C:/books/shuye-workspace --pdf
```

示例通过真实 MCP 创建工程，设置奇偶页眉页脚、主标题、章节，插入正文、表格、公式、目录、注释、文献与交叉引用，试运行后提交、校验并导出。输出包含工程 ID、revision 和产物路径；完整代码见 [mcp-demo.mjs](../scripts/mcp-demo.mjs)。

## 实际 PDF 候选与反馈

`apply_changes(dryRun=true)` 只做结构预览，返回 `visualPaginationChecked:false`。需要实际排版时调用 `render_candidate({projectId, expectedRevision, operations})`：候选只写校样产物，不修改工程或修订号。随后 `get_proof_page({proofId, page, offset:0, limit:50})` 读取文字框（pt、左上原点）、字体、来源修订号和过期状态。它不提供源块到版面对象的完整映射，也不能代替逐页视觉检查。

核对后以同一 `expectedRevision` 和同一 `operations` 调用 `apply_changes`，再 `export_pdf`。插入块请自行提供稳定 ID；没有 ID 的插入会每次生成新 ID，候选和提交的身份哈希将不同。工程在编译期间变动时返回 `REVISION_CHANGED_DURING_RENDER`，必须重新读取。页范围/拼版后的最终 PDF 也会重新绑定 SHA-256 和几何。

`validate_project.valid` / `structureValid` 仅表示模型合法；另看 `contentStatus`、`diagnostics` 和 `productionReady`。导入记录不会在保存、撤销、整工程替换时静默丢失；需要清理错误导入时，修好原稿并创建一个新工程。v3 行内公式由 `[[math:id]]` 和同块 `inlineMath: [{id,text}]` 绑定；整块更新可原子修改两者，单字符编辑不能切断标记，删表格行列也不能留下失联公式。

## 推荐工作流

1. `get_document_schema` 读取字段和单位；`list_projects` 查找工程，或 `create_project` 建立工程。
2. `get_outline` 获取章节，`list_components` 分页读取组件，必要时 `get_project` 获取完整源数据。
3. 使用稳定 ID 修改，先 `apply_changes` + `dryRun: true` 看预览，再提交。
4. `validate_project` 检查结构；`export_project` 保存工程；`export_pdf` 排版并读取预检/降级警告。
5. 遇到 `REVISION_CONFLICT` 重新读取并合并意图，不能盲目改 revision 覆盖别人修改。

一次修改页眉页脚、标题与脚注的 `apply_changes` 参数：

```json
{
  "projectId": "my-book",
  "expectedRevision": 3,
  "operations": [
    {"op": "set_layout", "patch": {"header": "我的书", "headerEven": "第一编", "footer": "第 {page} 页", "footerEven": "第 {page} 页"}},
    {"op": "update_block", "blockId": "main-title", "patch": {"text": "新的主标题", "fontSize": 24}},
    {"op": "upsert_note", "note": {"id": "note-1", "text": "出版注释。"}},
    {"op": "insert_reference", "blockId": "body-1", "offset": 0, "kind": "note", "targetId": "note-1"}
  ]
}
```

目标须已存在或由同批前面的 `insert_blocks` 创建。新块不传 ID 时返回 `createdIds`；后续操作需要引用新块，或希望 dry-run 和提交得到相同 ID 时，请自行指定。ID 以英文/数字开头，后接英文、数字、下划线或短横线，最多80字符。

## 工具目录

| 能力 | 工具 |
| --- | --- |
| 环境与模型 | `get_capabilities`、`get_document_schema` |
| 工程 | `list_projects`、`create_project`、`get_project`、`replace_project`、`undo_project` |
| 读取结构 | `list_components`、`get_outline` |
| 批量事务 | `apply_changes` |
| 书名与版式 | `set_title`、`set_layout` |
| 组件 | `insert_blocks`、`update_block`、`delete_blocks`、`move_blocks`、`replace_text` |
| 章节 | `chapter_insert`、`chapter_move`、`chapter_delete` |
| 出版注释 | `upsert_note`、`delete_note`、`insert_reference` |
| 参考文献 | `upsert_bibliography`、`delete_bibliography` |
| 审阅批注 | `upsert_comment`、`delete_comment` |
| 表格 | `table_set_cell`、`table_merge`、`table_split`、`table_resize` |
| 样式定位 | `set_styles`、`apply_style`、`set_index`、`set_bookmarks` |
| 导入 | `import_text`（TXT/FBD）、`import_docx`、`import_pro` |
| 检查输出 | `validate_project`、`export_project`、`export_pdf`、`preflight_pdf`、`render_candidate`、`get_proof_page` |

单项修改工具也支持 `expectedRevision` 和 `dryRun`（撤销除外）。未知属性报错，不接受任意脚本或 shell 字符串。

### 模型与引用

- 主标题、章节都是 `heading`，level 为1–4。`set_title` 改工程书名；纸面主标题用 `update_block`。章节截止至下一同级或更高级标题。
- 组件覆盖 `paragraph`、`heading`、`pageBreak`、`image`、`table`、`equation`、`toc`、`index`。`update_block` 支持 marks、ruby、图片宽度/绕排、表格合并/列宽等；保持原类型，改类型可整稿替换。
- 范围采用 **UTF-16 偏移**；替换与插入引用禁止切断 emoji/组合字素或引用标记。样式用 `marks`、注音用 `ruby`。
- `note` 插入 `[^id]`，按 notesMode 输出脚注/尾注。审阅批注在 `comments`，按组件锚定，支持 resolved，不进入成书。
- `cite` 插入 `[[cite:id]]`，按 bibliography 顺序显示 `[1]` 等序号，文末生成文献表；文献内容由 agent 提供，不自动检索或判断真实性。
- `ref` 插入 `[[ref:block-id]]`，显示目标标题/题注，目标文字变化后重排更新。不是页码交叉引用。
- 删除仍被引用的注释、文献或组件会使事务失败。可在同批先清理引用再删目标。删组件同时移除其批注与书签。
- 奇偶页眉用 `header/headerEven`；页脚用 `footer/footerEven`，支持 `{page}`。奇偶按实际页码判断。设置两者避免旧的偶数页参数继续生效。
- 图片使用 PNG/JPEG/WebP data URL；DOCX/PDF 用 base64。TXT/FBD/PRO 先按正确编码解码；服务不读取任意路径或网络地址。

## 持久化与编辑器同步

默认目录为项目下 `.shuye-mcp`，可用 `--workspace` 或 `SHUYE_WORKSPACE` 改变。`projects` 保存含修订号的记录，`artifacts` 保存生成的 JSON/PDF。不能把 projects 记录直接当成普通工程导入；请使用“MCP 工程”入口或 export_project。

每次写入使用工程锁、临时文件与原子重命名；批次任一步失败都不落盘。保留最近10次修改，可 undo_project；撤销也产生新 revision。单条持久记录含历史限100 MB，一次事务最多500步。异常退出可能留下 `.lock`；确认没有其他写入者后备份并清理锁，不自动猜测锁已失效。

编辑器“MCP 工程”入口可创建、打开和提交。Python 服务与 MCP 进程须使用同一工作目录。连接后每3秒接收 agent 新修订；本地有修改就暂停接收，提交时检查 revision。冲突时先另存本地工程再打开远端版本比较，不自动覆盖或合并。

资源：`shuye://schema`、`shuye://projects/{projectId}`；提示词：`book-editing`。客户端也可仅使用工具。

## 验收与边界

见 [逐项验收](mcp-acceptance.md)。MCP 提供当前排版模型的代码控制，不补齐原引擎所有缺口：独立 PDF 竖排、页码交叉引用、字符级批注、自由坐标绘图尚不支持；PDF 绕图仍降级，PDF/X/CMYK 未认证。validate_project 是结构与引用校验，返回 `visualPaginationChecked: false`；正式成书需检查实际输出。

实现使用 [官方 TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) 和 [MCP stdio](https://modelcontextprotocol.io/docs/develop/build-server)，依赖锁定于 package-lock.json。


## 期刊 v4

`set_journal` 保存首面模板；图表的 `anchor`、`captionIds`、公式的 `equationNumber` 和段落 `role` 均通过现有事务修改。`get_proof_page` 增加当前页的 `objects` 与 `objectTotal`，其分页独立于文字行数；取全量时按两者较大值继续分页。`semanticLayout` 的点位为语义起止位置，不是墨迹框。字段、复现命令和边界见 [期刊 v4 实稿记录](journal-pilot-v4.md)。
