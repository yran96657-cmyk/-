# 注释与引用样式（Web 0.8.1）

首面出版说明以前使用固定小字号，未读取 `article-note` 角色样式；参考文献沿用正文栏式，显式段落字号还可能覆盖模板。现在分别控制出版说明、引用编号、参考文献和参考文献标题，浏览器入口为“工具 → 期刊模板 → 注释与参考文献”。

## MCP 配置

先调用 `get_typesetting_context` 检查文稿角色及 `fonts.profiles.annotations`。再通过 `apply_typesetting` 传入 `journal.annotations` 和 `journal.roleStyles`；先 `dryRun: true`，再以同一修订及返回的 `previewHash` 提交。嵌套设置按字段合并，不会抹掉未指定的设置。

```json
{
  "journal": {
    "annotations": {
      "fontSet": "founder-sample",
      "noteMarker": "hidden",
      "noteIndentMm": 6.13,
      "noteLabelWidthMm": 15.17,
      "noteRuleWidthMm": 36.668,
      "noteRuleThicknessPt": 0.369881875,
      "noteRuleAfterPt": 6.01,
      "referenceColumns": 2,
      "referenceGapMm": 7.4,
      "referenceIndentMm": 9,
      "referenceLabelStyle": "fullwidth",
      "citationSuperscriptSize": 5.473450625,
      "citationRisePt": 4.215248125
    },
    "roleStyles": {
      "article-note": {"fontSize": 8.853075, "leading": 10.302991875},
      "reference": {"fontSize": 8.853075, "leading": 14.2432125, "bold": false},
      "reference-heading": {"fontSize": 11.8041, "leading": 16, "bold": false}
    }
  }
}
```

这是一份具体样本的参数示例，不是所有期刊的统一标准。数学稿可使用单栏参考文献，并保留行内引用。`citationInlineSize` 只调整已有行内数字引用的字号；上标尺寸与抬升只用于原稿已有上标，不把全部方括号改成上标。

字号、行距与抬升单位为 TeX pt（1/72.27 英寸），PDF 测量通常为 bp（1/72 英寸）。例如 PDF 8.82 bp 对应 8.853075 pt。毫米参数不需要这项换算。

`noteMarker: hidden` 仅隐藏首面出版说明的锚点；默认 `source` 保留原有标记，普通脚注不受影响。空脚注保留作者星号及语义锚点，不输出空白脚注行。参考文献编号来自原文，设置只改变括号外观，不增删或重排编号。

已有逐段 `journalStyle.fontSize` 的优先级高于角色样式。MCP 如需统一旧稿字号，应同时使用 `styles: [{"role":"reference","patch":{"fontSize":8.853075,"bold":false}}]`。浏览器修改注释或参考文献角色字号时会清除该角色旧的字号覆盖，保留其他逐段设置。

## 字体与验收范围

`founder-sample` 要求 FZShuSong-Z01、FZHei-B01、SimSun 和 Times New Roman 四种字形变体。通过实际 XeTeX 字体解析器校验，缺失时阻止提交或出样，不静默替换。字体须由有使用权限的部署者自行安装；本仓库不分发字体或测试稿件。`inherit` 沿用文稿原字体，不承诺与样本字体相同。

最终 PDF 为样式验收依据；浏览器预览不是完整 TeX 分页替代。此次对照范围为首面出版说明、正文数字引用和参考文献。正文、图表及全篇分页沿用既有排版，原稿与已出版样本的文字差异保留，不据此声称整页像素相同或自动批准发印。

## 2026-11-15 七稿验收

- 真实 HTTP/MCP：七篇逐一创建、预检、提交、出样、下载校验；134 项最终 PDF 样式测量全部通过，208 条参考文献编号完整，零缺失对象、零页面越界，字体全部嵌入。
- 页数依次为 9、13、8、12、11、8、12，共 73 页。参考文献栏数依次为 2、2、2、1、2、1、2。
- 注释与参考文献实际字号 8.82 bp；注释基线间距 10.2645 bp；参考文献按各篇样本为 13.41–14.40 bp。注释缩进约 6.13 mm、标签宽度约 15.17 mm、文献悬挂缩进 9 mm、双栏栏距 7.4 mm。
- PDF 中标签使用 FZHTK--GBK1-0，中文正文使用 FZSSK--GBK1-0，拉丁文字使用 TimesNewRomanPS 系列，全角引用括号使用 SimSun。固定字形的括号不继承标题粗体，避免宋体缺失粗体字形而替代；样本方案的注释标签冒号统一为全角，原文不改写。
- 第二篇的文献 [25]、[31]、[33] 按出版样本改为行内显示，仅改变字符样式。第六篇原来混入正文的三段出版说明移至首面，补充“基金项目：”显示标签，并保留来源块及逐字核对记录；不补造原稿缺少的收稿日期。
- Web 完整回归 281/281；最终 HTTP/MCP 与校样运行器补测 23/23；Python 引擎 144 项中 142 通过、2 项既有环境跳过（STIX 字体与 LibreOffice Draw 夹具）。原本地核心 92 项中 90 通过、2 项既有跳过。
- 浏览器验证设置保存、重开一致及非法负值阻止；七篇注释和参考文献已渲染放大图检查。逐项数值、原样本/修复前/修复后的图片和稿件校样为维护者私有交付，不进入公开仓库。

此次调用确定性 MCP 样式工具复测，没有重新调用 Codex 或 DeepSeek 模型，不更新此前的模型 token 比较。
