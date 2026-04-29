# Attachment Messages（原始翻译版）

> 在此处，我通过marketplace加载了一批document-skills，在此之前，仅有update-config和simplify两个skill

## 原始内容翻译

- update-config: 使用该技能通过 settings.json 配置 Claude Code 运行环境。自动化行为（“从现在开始当 X 时”、“每次 X 时”、“每当 X 时”、“在 X 前/后”）需要在 settings.json 中配置 hooks —— 实际执行的是 harness，而不是 Claude 本身。

- simplify: 审查已更改的代码，从复用性、质量和效率角度进行分析，并修复发现的问题。

- document-skills:slack-gif-creator: 用于创建适用于 Slack 的动画 GIF 的知识与工具。提供约束、校验工具和动画概念。当用户请求“为 Slack 制作某个 GIF”时使用。

- document-skills:theme-factory: 用于为产物应用主题的工具包。这些产物可以是幻灯片、文档、报告、HTML 页面等。提供 10 种预设主题（颜色/字体），也可以生成新的主题。

- document-skills:brand-guidelines: 将 Anthropic 官方品牌颜色和字体应用到各种内容中。在需要品牌风格、视觉规范或公司设计标准时使用。

- document-skills:internal-comms: 一组用于编写公司内部沟通内容的资源。适用于状态报告、管理层更新等。

- document-skills:frontend-design: 创建具有高设计质量的前端界面。适用于构建网站、页面、组件、仪表盘等。

- document-skills:doc-coauthoring: 用于协作文档的结构化工作流。适用于技术文档、提案、决策文档等。

- document-skills:algorithmic-art: 使用 p5.js 创建算法艺术，支持随机种子和参数探索。适用于生成艺术请求。

- document-skills:skill-creator: 创建新技能、修改现有技能并评估性能。支持测试与基准分析。

- document-skills:pdf: 用于处理 PDF 文件，包括读取、提取、合并、拆分、旋转、水印和创建。

- document-skills:claude-api: 构建、调试和优化 Claude API / SDK 应用。支持 prompt caching 和模型迁移。

- document-skills:mcp-builder: 用于构建 MCP 服务，使 LLM 能通过工具调用外部 API。

- document-skills:pptx: 处理 PowerPoint 文件，包括创建、读取和解析。

- document-skills:xlsx: 处理表格文件（xlsx/csv/tsv），包括读取、编辑、计算和格式化。

- document-skills:web-artifacts-builder: 用于构建复杂 Web 应用（React + Tailwind + shadcn/ui）。

- document-skills:webapp-testing: 使用 Playwright 测试 Web 应用，支持截图和日志查看。

- document-skills:canvas-design: 创建视觉设计（PNG / PDF），用于海报或设计作品。

- document-skills:docx: 处理 Word 文档（创建、编辑、格式化等）。
