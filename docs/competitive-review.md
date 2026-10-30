# 竞品核查（2026-10-31，mmx search + GitHub API + 实跑 CLI 验证）

## 结论：OpenDesigner v1 计划的功能已被 OpenPencil 全覆盖

**[open-pencil/open-pencil](https://github.com/open-pencil/open-pencil)** — MIT · TypeScript · 9,475 星 · 当天仍在提交 · v0.16.0

已实跑 `npx @open-pencil/cli --help` 验证可用。它已有：

| OpenDesigner 原计划 | OpenPencil 现状 |
|---|---|
| MCP 三工具操作画布 | `@open-pencil/mcp`，100+ 工具，Claude Code 一键接入 |
| BYOK 对话面板 | ⌘J AI 助手，支持 OpenRouter/Anthropic/OpenAI/Google/DeepSeek/Z.ai/**MiniMax** |
| Claude Code 等 coding agent 集成 | 桌面 app 内置，guided setup |
| frame/自动布局 | Yoga WASM，flex + CSS Grid |
| 组件 | 组件 + variants + 组件集 |
| 导出 HTML/Tailwind | export 到 jsx/tailwind-jsx/html/storybook/svg/pdf/pptx，还能**从** HTML/Tailwind 导入 |
| 本地 app | Tauri v2 桌面 ~15MB + 浏览器 PWA，无账号无后端 |
| Git 友好 | ✗ 原生 .fig 二进制（Kiwi），非文本 diff 友好 |
| lint/tokens/变量/XPath 查询/undo | 全有（CLI 直出） |

## 其他先例

- **tldraw-mcp**（社区 MIT）：白板便签级，写 .tldr 文件，无设计语义。tldraw SDK 商用需付费 license
- **drawio/Excalidraw/Mermaid MCP**：图表向，非设计工具
- **pen.dev / Paper.design**：商业闭源，按 agent-day/席位计费——它们验证赛道，不构成开源替代

## 剩余的真实差异点（OpenPencil 没做的）

1. **文本 JSON、Git diff 友好的文档格式**（pen.dev 的核心洞察；OpenPencil 走 .fig 兼容路线，二进制）
2. **面向特定工作流的模板/skill 层**（如中文社媒尺寸、品牌 kit、mmx 生图入画布）——与画布引擎无关，可直接建在 OpenPencil 的 MCP/CLI 上

## 判断

自研画布 = 重造一个更差的 OpenPencil（它 MIT、活跃、功能超集）。理性选择是复用，把精力投到差异层。
