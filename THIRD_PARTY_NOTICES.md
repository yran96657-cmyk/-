# 第三方组件

公式预览使用 KaTeX 0.19.0，按 MIT 许可分发。原始许可保存在 `vendor/katex/LICENSE`，项目地址 https://github.com/KaTeX/KaTeX 。代码、CSS 与字体来自官方 npm 包，浏览器运行时不访问 CDN。

正式 PDF 后端调用用户安装的 XeLaTeX / TeX Live，不在源码包中捆绑 TeX 发行版或系统字库。运行前请安装后端所需依赖，详见 `docs/pdf-backend.md`。

REA 仅用于本地研究，不是应用依赖，不随本源码包分发。

MCP 服务使用官方 `@modelcontextprotocol/sdk` 1.32.1 与 `zod` 4.6.7（MIT），通过 npm 安装，不提交 node_modules。传递依赖版本锁定于 package-lock.json；各依赖许可证保留在安装包中。

## PDF.js / pdfjs-dist

最终校样在浏览器本地使用 Mozilla PDF.js（pdfjs-dist 6.4.299），按 Apache-2.0 许可分发；由 npm 安装，未将其构建文件复制入仓库。源码及许可见 https://github.com/mozilla/pdf.js ，安装包中的 LICENSE / NOTICE 保持不变。

pdfminer.six 为可选的 PDF 文字几何依赖，采用 MIT 许可：https://github.com/pdfminer/pdfminer.six 。页面坐标为字体度量，不是完整视觉/印前检测。
