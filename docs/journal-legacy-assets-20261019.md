# 旧式公式、EMF 与跨栏大图回归（2026-10-19）

本次补齐旧式公式和 EMF 的实际转换及 PDF 输出，并修复通栏图前的大块留白、公式续行分离和浮动图进入参考文献的问题。此前的来源诊断继续保留；成功生成校样不等于正式出版批准。

## 真实稿件结果

稿件、工程 JSON、原图、PDF 和逐页图像仅保存在用户本地，公开仓库只含合成测试和汇总信息。

| 样本 | 最终校样 | 内容与输出核验 | 仍需闭合 |
| --- | --- | --- | --- |
| 旧式数学公式稿 | 7 页 | 378/378 MTEF；3691 个字符记录、465 个结构记录；61 个独立公式、317 个行内公式；523/523 对象定位；14 个公式编号、17 条参考文献 | 原稿自带 1 个空公式对象；布局残留需人工确认清理，不能静默忽略未知对象 |
| EMF 科研图稿 | 11 页 | 16/16 EMF 转为矢量 PDF，另有 2 张原始 PNG；18/18 图；135/135 对象定位；33 条参考文献、27 个已缓存域；11 个锚点均通过（约定上限 2 页） | 两张 PNG 在当前显示尺寸下仅 262.7 / 98.6 dpi；空自定义脚注、出版占位字段、原图标注需编辑处理 |
| 大图与留白稿 | 12 页 | 117 段正文、12 个表格单元、5 个 OMML、6 张图、1 条脚注、24 条参考文献不变；130/130 对象定位；7 个锚点均保持原上限 1 页；源图/模型图/PDF 图像像素一致 | 两张超大 TIFF 经本地无损准备，普通上传链路及修订裁决仍有 4 项阻断；第 9 页大图前仍有留白 |

三份最终 PDF 共 30 页，均在 300 dpi 单页图像上逐页查看。全部输出字体嵌入，编译诊断和文字越界均为 0。图像/字体许可、科学内容审定、印厂 PDF/X 与色彩验收未完成，`productionReady=false`。

大图稿第 7 页，两栏底部平均留白由 **110.86 mm → 4.70 mm（减少 95.8%）**。测量使用 300 dpi 实墨阈值 `<180`、版心 x=18–82 / 88–152 mm、y=20–221.5 mm，统计末行墨迹到版心底部的平均距离；不是总空白面积。只为图 4 开启页顶浮动，字体、图片字节、图片宽度及原锚点不变。进一步浮动后续图会使图 6 超出原锚距，该候选未采用；没有调大距离阈值使检查通过。

## 转换与保护

### MathType / Equation

- 只读 OLE `Equation Native` 流，不启动 OLE 或执行宏。支持本次实测覆盖的 MTEF 5 字符、上下标、分式、根式、定界符、限式和矩阵等结构。
- 原始 OLE、WMF 预览（如有）、SHA-256、转换后的原始 TeX、字符/结构计数一并保留。可编辑的 TeX 用原生字体排版，不以 WMF 截图代替公式。
- 对记录类型、变体、特殊字体字形、非零位置微调和边界做显式校验；未知内容报错，不能以空字符串或问号补齐。1 个原始空对象保留为空对象并报告，不猜测公式。
- PDF 核验重新读取 OLE，复核来源摘要、转换内容和计数；编辑后内容与原始转换有差异会报告 `MTEF_EDITED`。
- 二进制读取限制：OLE ≤2 MB、MTEF ≤1 MB、递归深度 ≤64、记录数 ≤20000。未实现全部历史 MTEF 版本和全部模板变体。

### EMF

- 以 LibreOffice Draw 的独立用户配置转换，宏安全级别最高，批处理超时 120 秒；单文件 ≤5 MB、每批 ≤100 张且合计 ≤30 MB。
- 原始 EMF 与 PDF、浏览器 PNG 预览分别保留。输出使用矢量 PDF；预览栅格化仅用于显示和测定外部空白边界。
- 转换后要求单页、字体嵌入、无可执行动作等；允许 LibreOffice 24 生成的本页静态初始视图数组，输出资产仅复制页面，不携带源目录；使用源 `EMR_EXTTEXTOUTW` 的 Unicode 字符清单与 PDF 文字逐项核对。导出时再核验原图、PDF、预览摘要及文字记录。
- 本稿一张图的全角括号缺字，渲染副本将 `（）` 映射成 `()`，保留位置与原图字节并记录每处偏移。若存在 EMF+，只在已声明 Dual 完整兼容流时使用标准 EMF 流；未知形式拒绝转换。
- 文字清单不能证明曲线、误差线、填色和面板语义完全相同，仍须逐图视觉核对。LibreOffice 可能替换源字体，字体嵌入并不表示字体外观与原应用完全一致。

### OOXML 和版式

- `AlternateContent` 只选一个可处理分支，避免 Choice/Fallback 双重计数。
- 导入已覆盖的双图组合，保留面板顺序和独立图像身份；旋转、裁切、无法确定横纵方向或更复杂组合仍报错。
- 自定义脚注标记与普通编号分别处理；原稿空脚注仍为空，不编造内容。
- `floatPlacement: "in-flow" | "top"` 对 UI、JSON 和 MCP 一致；页顶浮动限定期刊多栏通栏图片/短表，图与题注一起移动。长表不允许强塞进浮动盒。
- 去掉 `multicols` 内近似 `needspace` 导致的异常提前断页，保留标题与正文衔接约束；通栏长公式与相邻续行统一栏宽，关系符前后不拆散。
- 正文浮动图在参考文献之前清空；队列已空时不强制分页。

## 本地准备与产品边界

旧式公式稿的已审阅副本只去掉已识别的 MathType 控制段和 WPS/括号布局残留；全部 378 个 OLE 和其余 ZIP 部件字节未变。另将 11 处源稿中的句内硬段落断点合并，正文字符与公式均不变。通用导入器没有忽略未知残留的例外。

EMF 稿直接从原始 DOCX 导入。期刊角色、图题和锚点经结构化编辑设置；将一个以手动换行嵌在正文段内的一级标题拆为独立标题，重组后文字完全一致。没有声称自动识别全部期刊格式。

大图稿保留原有 4 项导入阻断（真实修订、6/4 图计数和两张超大 TIFF）。本地完整 PDF 的所有图像像素已核对，但服务器 `start_journal_proof` 仍正确拒绝这份带未决阻断的工程。下一项产品工作是受控大图转换、编辑接受/拒绝修订及补资产后的重新核验；不能删除历史错误冒充普通接稿成功。

## 验证与复现

本地原生 **94/94**、Web **174/174** 测试通过，无跳过；Web 和 standalone 构建通过。合成测试包括嵌套公式、未知/截断记录、来源篡改、EMF 实际转换、公式续行、图题锚点和浮动图不得插入参考文献。

认证 HTTP 测试启动构建产物及独立临时工作区，完成能力查询、两篇导入、替换结构化工程、保存后重开、生成 PDF、下载及 SHA-256 核对。整个流程使用 MCP/HTTP，无 computer use；没有部署或修改在线工作区。

在仓库根目录（需要 XeLaTeX、配置好的期刊字体、Python 及 LibreOffice Draw）：

```sh
python3 -m pip install -r web/journal-engine/requirements.txt
cd web/journal-engine
python3 run_tests.py
cd ..
npm test
node standalone/build.mjs
SHUYE_PYTHON=python3 node scripts/journal-http-acceptance.mjs
```

Linux 依赖见 `.github/workflows/tests.yml`，包含 `libreoffice-draw`。若 `soffice` 不在 PATH，可用 `SHUYE_SOFFICE` 指定可执行文件。`get_journal_capabilities.environment.imports` 报告可用依赖；依赖被发现不替代每张资产转换验证。

格式依据：[Wiris MTEF 5](https://docs.wiris.com/en_US/mathtype-mtef-v5-mathtype-40-and-later)、[Microsoft EMR_EXTTEXTOUTW](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-emf/a59a79ac-328e-492d-a34d-e02727af6edf)、[Microsoft EMF+ Dual](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-emfplus/10f336a0-5f7c-4ee2-ab89-5329af0720c7)、[LibreOffice PDF 导出](https://help.libreoffice.org/latest/en-US/text/shared/guide/pdf_params.html)。MTEF 实现按公开格式编写，未引入其他转换项目代码。
