两个好问题。先来研究一下 `bun:bundle` 的 feature 机制，以及主流 MCP prompts servers。

Listed directory runtime
Searched web: "bun:bundle feature() function define flag runtime behavior false"
Read URL: https://bun.sh/docs/bundler/macros
Read URL: https://bun.sh/docs/bundler/bundle-api#feature
Viewed content.md:1-485

现在我去搜索 `bun:bundle` 里 `feature` 函数的具体实现，以及主流带 prompts 的 MCP servers：

Searched web: "bun "bun:bundle" "feature" function runtime returns false source code github oven-sh"
Searched web: "MCP server provides "prompts" not just tools examples list github 2024 2025"
Read URL: https://raw.githubusercontent.com/oven-sh/bun/main/src/js/internal/bun-bundle.ts
Read URL: https://modelcontextprotocol.io/examples
Read URL: https://raw.githubusercontent.com/oven-sh/bun/main/src/js/bun/bundle.ts
Viewed content.md:1-178

找到关键信息了。`Everything` 这个 reference server 就明确说 "with prompts, resources, and tools"。让我也查一下 `bun:bundle` 的 feature 运行时行为：

Read URL: https://raw.githubusercontent.com/oven-sh/bun/refs/heads/main/src/js/internal/bun-bundle.ts
Read URL: https://github.com/modelcontextprotocol/servers/tree/main/src/everything
Ran command: `bun --help 2>&1 | Select-String "define"`
Ran command: `bun run --help 2>&1 | head -50`
Ran command: `bun run --help 2>&1 | Select-String -Pattern "define|feature"`
Searched web: "bun "bun:bundle" feature() runtime false define environment variable how to enable"

找到了！`bun run --feature=SUPER_SECRET` 就是答案！

## 问题 1：可以在启动时通过 `--feature` 开启！

`bun run` 支持 `--feature` flag，专门用于这个场景：

```
--feature=<val>    Enable a feature flag for dead-code elimination
```

所以你可以这样启动：

```bash
bun --feature=MCP_SKILLS run ./src/entrypoints/cli.tsx
```

或者修改 `bin/claude-haha` 的启动行：

```bash
# 在 bin/claude-haha 里，把最后一行改成：
exec bun --feature=MCP_SKILLS $ENV_FILE_FLAG ./src/entrypoints/cli.tsx "$@"
```

---

## 问题 2：哪些主流 MCP server 提供 prompts？

官方认证的能直接用的只有 **`@modelcontextprotocol/server-everything`**（测试/reference server，明确包含 prompts + resources + tools）：

```json
{
  "mcpServers": {
    "everything": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-everything"]
    }
  }
}
```

其他主流 server（`filesystem`、`memory`、`git` 等）基本只提供 **tools**，不提供 prompts。

> **结论：** 目前在 MCP 生态里，**提供 prompts 的生产级 server 极少**，`MCP_SKILLS` 这个功能本身还处于非常早期的实验阶段。`server-everything` 是你现在能直接 `npx` 用的最佳选择来验证这条代码路径。

**完整测试步骤：**

**第一步** — 在 `claude_code` 配置里（`%USERPROFILE%\.claude.json` 或项目 `.claude/settings.json`）加入：
```json
{
  "mcpServers": {
    "everything": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-everything"]
    }
  }
}
```

**第二步** — 启动时加 `--feature=MCP_SKILLS`：
```bash
bun --feature=MCP_SKILLS run ./src/entrypoints/cli.tsx
```

这两个条件同时满足后，`mcpSkills` 就会有内容，你的 `logForLearning` 就能输出非空结果了。



Viewed claude-haha:1-31
Edited claude-haha

用户已经把 `--feature=MCP_SKILLS` 加好了，现在问能不能用 `mcp add` 命令来添加这个 server。让我看看这个命令的实现：

Listed directory mcp
Viewed addCommand.ts:1-281

逻辑完全清晰了。直接回答：

## 完全可以用 `mcp add` 来添加

根据 `addCommand.ts` 的实现，`mcp add` 支持 `stdio` 类型（默认），命令格式是：

```
claude mcp add <name> <command> [args...]
```

所以 `@modelcontextprotocol/server-everything` 的添加命令是：

```bash
./bin/claude-haha mcp add everything npx -- -y @modelcontextprotocol/server-everything
```

或者在已经启动的 REPL 里，直接输入 slash command：

```
/mcp add everything npx -- -y @modelcontextprotocol/server-everything
```

### `--` 是什么意思？

根据代码第 82 行的注释：
> "Commander.js handles -- natively: it consumes -- and everything after becomes args"

`--` 后面的内容会被解析为 `args`，这样 `npx` 的参数 `-y @modelcontextprotocol/server-everything` 就会被正确传入，不会被 Commander.js 误解为自己的 flag。

### 会写入哪里？

默认 scope 是 `local`（见第 51 行），会写入当前目录的 `.claude/settings.json`。如果想写到全局用户配置，加 `-s user`：

```bash
./bin/claude-haha mcp add -s user everything npx -- -y @modelcontextprotocol/server-everything
```