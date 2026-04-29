具体数量拆分如下：

24 个 Claude Code 内置工具 (如 Bash, Read, Agent, TaskCreate 等)

24 个 Computer Use (计算机控制) MCP 工具 (如 mcp__computer-use__left_click, screenshot 等)

5 个 Tavily (搜索与爬虫) MCP 工具 (如 mcp__tavily__tavily_search, tavily_crawl 等)

加上 MCP 插件后，你实际每次请求发给大模型的工具上下文非常庞大

---

## 1. 核心代理与规划 (Agent & Planning)

### `Agent` (智能代理)
* **功能描述**：启动一个专门的后台/前台代理（子进程）来自主处理复杂的多步任务。拥有不同类型的代理（如通用搜索、指南问答等）。支持并行执行和隔离的 git 工作树 (`worktree`)。
* **核心参数**：
  * `prompt` (String): 代理需要执行的具体任务。
  * `description` (String): 简短的3-5个词的任务描述。
  * `subagent_type` (String): 代理类型（如不填默认为 general-purpose）。
  * `run_in_background` (Boolean): 是否在后台运行。
  * `isolation` (String): 隔离模式，例如 `"worktree"`。

### `EnterPlanMode` (进入计划模式)
* **功能描述**：在开始复杂的代码实现（尤其是多文件修改、架构决策）之前主动使用，用于探索代码库并设计实现方案，必须获得用户批准后才能开始写代码。
* **核心参数**：无参数。

### `ExitPlanMode` (退出计划模式)
* **功能描述**：在计划模式中完成计划文件的编写后调用，用于向用户展示计划并请求审批。
* **核心参数**：`allowedPrompts` (Array) 实施计划所需的权限类别。

---

## 2. 文件与搜索操作 (File & Search)

### `Read` (读取文件)
* **功能描述**：从本地文件系统读取文件内容。支持读取纯文本、图像、大型 PDF（必须指定页码）以及 Jupyter Notebook。
* **核心参数**：`file_path` (路径), `offset` (起始行), `limit` (读取行数), `pages` (PDF页码范围)。

### `Write` (写入文件)
* **功能描述**：将内容写入本地文件（会覆盖现有文件）。如果要修改现有文件，必须先用 `Read` 读取。
* **核心参数**：`file_path` (路径), `content` (文件内容)。

### `Edit` (编辑文件)
* **功能描述**：在文件中执行精确的字符串替换。推荐使用此工具修改现有文件，而不是用 `Write` 重写。
* **核心参数**：`file_path` (路径), `old_string` (被替换文本), `new_string` (新文本), `replace_all` (是否全部替换)。

### `Glob` (全局模式匹配)
* **功能描述**：快速的文件路径匹配工具（如查找 `**/*.js`），适用于任何规模的代码库。
* **核心参数**：`pattern` (匹配模式), `path` (搜索目录，默认当前目录)。

### `Grep` (正则表达式搜索)
* **功能描述**：基于 ripgrep 的强大内容搜索工具。支持正则，应优先使用此工具而不是 Bash 中的 grep 命令。
* **核心参数**：`pattern` (搜索的正则), `path` (目录), `glob` (文件过滤), `output_mode` (输出模式：内容/文件路径/计数) 等。

### `NotebookEdit` (编辑 Notebook)
* **功能描述**：完全替换、插入或删除 Jupyter Notebook (`.ipynb`) 中特定单元格的内容。
* **核心参数**：`notebook_path`, `cell_id`, `new_source`, `cell_type`, `edit_mode`。

---

## 3. 系统控制与网络 (System & Web)

### `Bash` (执行 Shell 命令)
* **功能描述**：执行给定的 Bash 命令并返回输出。禁止用于基础文件操作（如 cat, grep, ls），应优先使用专用工具。包含严格的 Git 操作规范，默认禁止破坏性操作和跳过 hook。
* **核心参数**：`command` (执行的命令), `timeout` (超时时间 ms), `run_in_background` (后台运行)。

### `EnterWorktree` / `ExitWorktree` (Git 工作树管理)
* **功能描述**：仅当用户明确要求时，创建/退出一个隔离的 git worktree 并在其中切换会话环境，避免污染主分支。
* **核心参数**：
  * `EnterWorktree`: `name` (可选的工作树名称)。
  * `ExitWorktree`: `action` (keep保留 或 remove删除), `discard_changes` (是否丢弃未提交的修改)。

### `WebFetch` (网页抓取)
* **功能描述**：获取指定 URL 的内容，将其转换为 Markdown 并使用轻量级 AI 模型提取信息。无法访问需要登录的私有页面。
* **核心参数**：`url` (网址), `prompt` (需要提取的信息提示词)。

### `WebSearch` (网络搜索)
* **功能描述**：搜索网络以获取最新信息。强制要求在回答末尾附带来源链接 (Sources)。
* **核心参数**：`query` (搜索词), `allowed_domains` (允许的域名), `blocked_domains` (排除的域名)。

---

## 4. 任务管理流 (Task Management)

这一组工具用于结构化地管理复杂的编码任务，向用户展示进度并在内部跟踪依赖关系。

* **`TaskCreate`**: 创建一个带有标题和描述的新任务。
* **`TaskGet`**: 根据任务 ID 获取任务的完整要求和依赖。
* **`TaskList`**: 列出当前所有的任务、分配情况及阻塞状态。
* **`TaskUpdate`**: 更新任务状态（pending / in_progress / completed / deleted），设置阻塞依赖 (`addBlocks`, `addBlockedBy`)。
* **`TaskStop`**: 终止正在运行的后台任务。
* **`TaskOutput`**: (已废弃) 获取任务输出，现建议直接通过 Read 读取输出文件。

---

## 5. 用户交互与本地技能 (Interaction & Skills)

### `AskUserQuestion` (询问用户)
* **功能描述**：在执行中向用户提问以收集偏好或澄清指令。支持多选和 UI 预览（如 ASCII 布局、代码对比）。
* **核心参数**：`questions` (包含标题、选项、描述和预览内容的数组)。

### `Skill` (执行技能)
* **功能描述**：触发特定的快捷技能或斜杠命令（如 `/commit`, `/review-pr`）。
* **核心参数**：`skill` (技能名称), `args` (附带参数)。

---

## 6. MCP 扩展工具 (Model Context Protocol)

你当前环境挂载了 MCP 服务，以下是通过 MCP 暴露的额外能力。

### 6.1 MCP 资源读取
* **`ListMcpResourcesTool`**: 列出已配置 MCP 服务器中的可用资源。
* **`ReadMcpResourceTool`**: 读取特定的 MCP 资源 URI。

### 6.2 Computer Use (计算机控制自动化)
*允许模型直接操控操作系统键鼠和屏幕。*
* **基础键鼠操作**: `key` (按键/组合键), `type` (输入文本), `hold_key` (长按)。
* **鼠标移动与点击**: `mouse_move`, `left_click`, `right_click`, `middle_click`, `double_click`, `triple_click`, `left_click_drag` (拖拽), `scroll` (滚动)。
* **系统与屏幕监控**: 
  * `screenshot` (截取主屏幕)
  * `zoom` (放大局部截图获取高清细节)
  * `cursor_position` (获取当前鼠标坐标)
  * `switch_display` (切换监听的显示器)
* **应用与剪贴板控制**:
  * `request_access` (请求控制特定应用的权限)
  * `open_application` (打开或前置应用)
  * `read_clipboard` / `write_clipboard` (读写剪贴板)
* **高级自动化**: `computer_batch` (将多个动作打包成一个批处理操作，减少 API 往返延迟)。

### 6.3 Tavily (高级数据抓取与研究)
*集成 Tavily 搜索引擎的专业爬虫和研究能力。*
* **`mcp__tavily__tavily_search`**: 执行高级的网络搜索，可过滤时间、国家、域名并指定搜索深度 (basic/advanced/fast)。
* **`mcp__tavily__tavily_research`**: 对指定主题进行深度的综合研究，内部自带子话题展开机制。
* **`mcp__tavily__tavily_crawl`**: 给定一个根 URL 进行广度和深度爬取。
* **`mcp__tavily__tavily_extract`**: 深度提取 URL 的正文内容（支持突破部分防爬虫网站和表格识别）。
* **`mcp__tavily__tavily_map`**: 映射并返回网站结构 URL 列表。