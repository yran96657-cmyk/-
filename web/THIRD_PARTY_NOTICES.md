# 第三方组件

MathType MTEF 解析使用 mathtype2omml 的 mathtypejx/mtef 子模块，来源 https://github.com/uwjiaoxing/mathtype2omml ，提交 fe5293326ec047bd943de88293add86b8a9050d3（MIT）。许可、字体映射的 BSD 通知和修改说明保留在 journal-engine/vendor/。本项目修正矩阵行列转换，并独立实现 MathML → OMML 转换；不分发 Microsoft 的 MML2OMML.XSL。旧 DOC 和矢量图片转换分别调用服务器自行安装的 LibreOffice 和 Inkscape，不捆绑其二进制。

公式预览使用 KaTeX 0.19.0，按 MIT 许可分发。原始许可保存在 `public/editor/vendor/katex/LICENSE`，项目地址 https://github.com/KaTeX/KaTeX 。代码、CSS 与字体来自官方 npm 包，浏览器运行时不访问 CDN。

网站自由版面 PDF 使用 pdf-lib 1.17.1 和 @pdf-lib/fontkit 1.1.1（MIT）。通过 npm 安装，许可证保留在安装包中，不捆绑用户字体。字体嵌入权限由字体所有者及字体的 OS/2 标志决定。独立验收用 Fandol 字体来自本机 TeX Live，仅用于本地测试，不随网站分发。

REA 仅用于本地研究，不是应用依赖，不随本源码包分发。

英文参考文献逐行断词读取 TeX Live 分发的 Plain TeX `hyphen.tex`，原文件及允许原样复制、分发的许可头保留在 `journal-engine/vendor/hyphen.tex`。本项目不修改该表，独立实现模式匹配和逐行填充；学术词汇的显式断词例外保存在 Python 代码中。字宽使用部署机器已有的 Pillow 和授权 Times New Roman 字体测量，不分发商业字体。

网站 HTTP MCP 是独立的 JSON-RPC 实现，schema 使用 zod/v4（MIT）；准确包版本及所有传递依赖锁定于 package-lock.json。测试 fixtures 中 test-only.ttf / .otf 是由 tests/make-test-font.py 生成的原创几何字形（CC0），不是供实际阅读使用的字体。

PDML XML 检查使用 @xmldom/xmldom 0.9.12（MIT），来源 https://github.com/xmldom/xmldom ，版本锁定于 package-lock.json。仅使用独立编写的检查代码；厂商安装包、模板、图像、字体及二进制分析产物均不随本项目分发。


ICC conversion uses the unchanged JavaScript and WebAssembly runtime from `@kittl/little-cms@1.0.3` (MIT), https://github.com/Kittl/Little-CMS . License: `vendor/lcms/LICENSE`. The WASM SHA-256 is `bb9c28e9de6ef25efdfe55a3132485535a974eaa68b5604f1432ef368f46e005`; runtime JS SHA-256 is `a31a5da975795fe158cd9f0d8e660ff53296ee5cf0c8fc47bfff6cb8fdd66722`. No commercial printer ICC profile is distributed.

PNG decoding uses `@pdf-lib/upng@1.0.1` (MIT). JPEG encoding/decoding uses `jpeg-js@0.4.4` (BSD-3-Clause; decoder derived from PDF.js under Apache-2.0), https://github.com/jpeg-js/jpeg-js . `vendor/jpeg-cmyk/decoder.mjs` is adapted from its decoder: CommonJS/export wrappers removed and a bounded `decodeCmyk` entry added to preserve CMYK samples before RGB conversion. Original copyright notice is preserved. Full licenses: `vendor/jpeg-cmyk/LICENSE-BSD` and `LICENSE-APACHE`.

Additional color test fixture provenance and reproduction instructions are in `tests/fixtures/README.md`. The bundled synthetic CMYK ICC is an original test fixture, not a print production profile.

整期 Word 写入使用 python-docx 1.2.0（MIT），来源 https://github.com/python-openxml/python-docx 。服务端使用自行安装的 LibreOffice Writer 和 Python UNO 生成 PDF，不捆绑其二进制。整期流程按用户授权整合 InkQ 的选稿、目录回算和原生 Word 交付方式；Word 渲染临时副本采用其字面数学字符兼容思路，书页源工程及交付 Word 不改写原始 OMML。未复制 InkQ 的账号、额度账本或其他客户数据。
