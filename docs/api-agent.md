# 普通 API 模型通过 MCP 排版

独立服务器支持 OpenAI-compatible `chat/completions` 工具调用。编辑器 Agent 面板选择模型、输入目标后，后台通过同一套 MCP 工具调整版式、编译真实 PDF 并检查质量。关闭浏览器不会中断任务；停止、继续、整次撤销和版本冲突保护沿用现有任务系统。

本功能处理已导入、已标注首面角色的期刊文章，保留正文、公式、图件和注释。校样就绪表示可审阅，不表示获得发印批准。整期与 Word 导出的既有 MCP 工具仍可由外部 Agent 调用，当前内置模型循环不自动操作整期任务。

## 连接模型

在独立服务器配置中增加：

```json
{"apiAgent":{"models":[{"id":"deepseek","label":"DeepSeek","model":"group/deepseek-v4.1"}]}}
```

私有 Tailscale 网关由能访问它的电脑运行出站连接器。连接器只访问书页 HTTPS 和本机 Magpie，不开放电脑端口。书页账号页创建的 MCP 令牌应放进私有文件。在仓库之外创建配置：

```json
{
  "mcpUrl":"https://your-domain.example/shuye/mcp",
  "tokenFile":"D:/private/shuye-token.txt",
  "url":"http://127.0.0.1:3425/v1",
  "modelMap":{"group/deepseek-v4.1":"EXACT_MODEL_ID_FROM_MAGPIE_MODELS"}
}
```

运行 `node mcp/api-worker.mjs D:/private/worker.json`，需要 Node 22.13+，无需 node_modules。模型网关、Magpie、Tailscale 和连接器均需保持运行。连接器离线时不能提交新的 API 任务；上游超时会保存检查点，恢复后可继续。在线状态表示连接器心跳可达，不保证上游模型正常。

`modelMap` 右侧必须使用本机 `/v1/models` 返回的完整 ID；网关新增中继前缀后，旧 ID 可能失效，不能只看供应商名称。

若服务器能直接访问 API，在 `apiAgent` 内配置 `url` 和 `keyFile` 或 `keyEnv`，可省去连接器。远程端点必须 HTTPS，仅 loopback 支持 HTTP。密钥不要放入 Git、提示词、浏览器或静态目录。

## MCP 工作流

1. `get_api_models` 查询模型及连接器状态。
2. `start_agent_task({projectId,expectedRevision,requestId,mode:"api",apiModel:"deepseek",goal})` 创建任务。
3. `get_agent_task` 读取真实步骤、源修订、校样、模型用量和下一步。
4. `cancel_agent_task`、`resume_agent_task`、`undo_agent_task` 停止、恢复或整体撤销；人工产生新修订后拒绝覆盖。

外部 Agent 也可直接调用 `get_typesetting_context` 和 `apply_typesetting`。前者返回版式、角色、可用字体和图件尺寸约束，不发送全文图片或公式二进制。后者支持 `layout`、合并的 `journal`、按 `type/role/blockIds` 选择的 `styles`，以及 `fitImages:{minDpi:300}`。图件适配只缩小尺寸，不重采样。`dataTablesOnly:true` 排除组合图容器。

先 `dryRun:true`，再以相同修订、相同修改和返回的 `previewHash` 提交，整批只有一个新修订。角色的显式字号、字体、字重和对齐覆盖模板，编辑器预览、PDF 和可编辑 Word 共用覆盖值。显式 `{page}` 页脚输出实际页码。

## 保护与限制

- 内置模型仅能操作当前工程的排版、校验和校样工具，不运行 shell。每轮、每次工具调用核对修订与摘要。
- 提交前持久化意图；无法确定写入结果时不盲目重放。API 任务保存原始对象，整体撤销不受最近十版历史窗口限制。
- 每任务最多 16 轮、每轮 8 个工具调用、3 次模型触发的校样编译。供应商报告用量超过 160,000 tokens 后停止；单次响应可能使总量超过阈值。未报告用量时仍受轮数及时间限制。
- 完整质量报告保留全部转换账本；给模型的摘要优先错误和警告，数百条 MathType 信息按代码计数。
- 每轮附带当前修订、已完成修改、校样及已检查页码，减少重复查询；每次调用保留工具名称和供应商实际用量。仍会拒绝超过预算的任务，不把失败改写成通过。
- MCP 令牌有当前单用户工作区的工程权限，连接器必须是受信任客户端。账号页可撤销令牌。
- 用量来自供应商响应，缓存输入计入总输入，不再次加总。缺失用量标记为未报告，不估造数字。
- 机器检查不替代学术核校、图片原始清晰度评估、刊期确认和印厂 PDF/X 验证。原稿缺失或有歧义的内容保留待处理记录。

## 字体与测试

旧 `.doc` 在 Windows 由本机已安装的 Microsoft Word 只读转换为临时 DOCX，禁用宏和打开时外部链接更新，不改原稿。Linux 使用隔离 LibreOffice；检测到 WPS 二进制 DOC 时会要求先用 Word 转成 DOCX，因为这类文件实测可能在 LibreOffice 转换时丢失斜体文字。服务器没有 Microsoft Word，不能宣称所有旧 DOC 均无损直传。字符样式继承和 MathType 隐藏计数器后的显式公式编号由导入器保留，不执行域宏。

Linux 使用已安装的 Noto CJK 补充 Fandol 缺字。桌面可通过 `journal.env.SHUYE_NOTO_FONT_DIR` 指定目录，内含 `NotoSerifCJKsc-Regular.otf`、`NotoSansCJKsc-Regular.otf`。自行安装开源字体并保留许可证，不复制商业排版软件字体。实际 PDF 缺字仍是阻断错误。

`web/tests/api-typesetting.test.mjs` 验证预检绑定、内容保持、字体拒绝、图件适配、质量摘要及撤销；`api-connector.test.mjs` 启动真实 CLI，经 HTTP/MCP 完成模型请求；`journal-engine/tests/test_api_styles.py` 验证实际 PDF 页码、字号、罕见字和可编辑 Word。
