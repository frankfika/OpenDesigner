# pen.dev 产品拆解与轻量开源复刻调研报告

> 调研对象：[pen.dev](https://pen.dev/)（原 pencil.dev）及其文档站 [docs.pen.dev](https://docs.pen.dev/)
> 调研日期：2026-10-31
> 调研目的：以逆向/产品拆解方式，理解 pen.dev 的产品结构与技术信号，产出一个**更轻量、开源友好**的替代品蓝图。
> 方法：全文抓取官网 + 23 页官方文档（Getting Started / Core Concepts / Design and Code / For Developers / Troubleshooting），抽取正文逐页精读；对渲染器、格式、MCP、CLI 等技术点回到对应文档 URL 复核。

---

## 1. 产品定位与用户

### 1.1 一句话定位

> "pen.dev is an agentic canvas for building bold software." —— 官网首页 title/meta
> "pen.dev is a powerful vector design tool that integrates directly into your development environment. Design right inside your IDE alongside your code, or use the standalone desktop app or headless CLI." —— <https://docs.pen.dev/>

关键词拆解：**agentic canvas（智能体画布）+ design as code（设计即代码）+ local-first（本地优先）**。它不是"Figma + AI"，而是"**一个能被 agent 直接读写的矢量画布，文件住在你的 git 仓库里**"。

### 1.2 品牌与主体

| 项目 | 事实 | 来源 |
|---|---|---|
| 现名 / 曾用名 | pen.dev（2026 年从 pencil.dev 改名，首页顶部有 rebrand banner：*"pencil.dev is now pen.dev"*） | <https://pen.dev/> |
| 法人主体 | High Agency Inc.（官网 JSON-LD `legalName: "High Agency Inc."`；页脚 "© 2026 High Agency Inc."） | <https://pen.dev/>、<https://pen.dev/pricing> |
| 投资方 | a16z Speedrun（页脚 "Backed by a16z speedrun"） | <https://pen.dev/pricing> |
| 许可 | EULA 授权（**闭源**，非开源） | <https://pen.dev/eula>、<https://pen.dev/terms> |

### 1.3 目标用户（三类核心画像）

1. **设计工程师 / 全栈开发者**——需要把 UI 稿直接放进 repo，agent 一边写代码一边改稿。文档明确："Design components, sync them with your code, and let AI assistants help you maintain consistency between design and implementation."（<https://docs.pen.dev/>）
2. **重度 AI 编码用户**——已经在用 Claude Code / Codex / Cursor / Gemini CLI / OpenCode / Kiro 的人，希望 agent 直接改设计稿而不是给一张截图。官网："pen.dev doesn't just provide MCP reading tools, but also full write access + many other handy tools to fully operate the canvas."（<https://pen.dev/>）
3. **有设计系统的小团队**——需要 components / variables / themes / 跨文件 design library，且要与 CSS token 双向同步（<https://docs.pen.dev/design-and-code/design-to-code>、<https://docs.pen.dev/core-concepts/build-a-design-system>）

**明确不服务的**：移动端 App 客户端、纯手工像素级绘图的传统平面设计师、要求强实时多人协作的团队（分享是"快照链接"，非实时协同）。

### 1.4 商业与分发形态

- 分发端共 5 个：**Web 应用**（app.pen.dev）、**桌面应用**（macOS / Windows / Linux，AppImage + tarball，<https://docs.pen.dev/getting-started/installation>）、**IDE 扩展**（VS Code / Cursor / Antigravity / Windsurf，OpenVSX 分发）、**Chrome 扩展**（网页导入）、**CLI**（`npm i -g @pen.dev/cli`，要求 Node.js ≥ 22.19）。
- 商业模式（<https://pen.dev/pricing>）：Free $0 / Pro $16 / Ultra $48 / Enterprise 定制。配额维度为 **agent 设计天数**（Free 5 天/月）、**图像与 SVG 生成次数**（25 / 350 / 750 次每月）、**并行 agent 数**（1 / 3 / 6）。托管模型另计 model credits。
- 数据口径：自有 provider 凭据的请求从设备直连 provider；**使用 pen.dev 托管模型与图像/SVG 服务的请求实时经过 High Agency 服务器**（<https://pen.dev/privacy>，被多家评测页引用）。

---

## 2. 完整功能清单

### 2.1 画布与编辑（Canvas / Editor）

| 能力 | 细节 | 来源 |
|---|---|---|
| 无限画布 | Space+拖拽平移，Cmd/Ctrl+滚轮缩放，Shift+1 适配全部，Shift+2 适配选区 | <https://docs.pen.dev/core-concepts/pencil-interface> |
| 基础图形 | 矩形(R)、椭圆(O)、多边形、路径(P 钢笔工具，可切割 X / 平滑-拐角切换)、文字(T)、图标 | <https://docs.pen.dev/core-concepts/drawing-and-editing> |
| 容器与组织 | Frame（Cmd/Ctrl+Opt+G 包裹）、Group（Cmd/Ctrl+G）、图层面板（重命名/排序/显隐）、属性面板 | 同上 |
| Flex 布局 | Shift+A 添加 flex；横向/纵向、gap、padding、justifyContent、alignItems；**Fill（填满）/ Hug（贴合）/ Absolute（绝对定位）** | <https://docs.pen.dev/core-concepts/pencil-interface> |
| 对齐与吸附 | 边缘/中心/等距吸附、像素网格（像素与半像素对齐）、像素网格可见性开关 | <https://pen.dev/>、<https://docs.pen.dev/core-concepts/pencil-interface> |
| 测量 | 悬停读取任意两层精确距离 | <https://pen.dev/> |
| 缩放工具 | K 键整体缩放组（文字、描边、圆角、间距、效果同步缩放），锚点九宫格 | <https://docs.pen.dev/core-concepts/drawing-and-editing> |
| 图层树 | 嵌套选择（Cmd/Ctrl+点击深选、Enter 选子级、Shift+Enter 选父级）、框选 | <https://docs.pen.dev/core-concepts/pencil-interface> |

### 2.2 图形与外观（Graphics）

- **填充**：纯色、线性/径向/角度/**网格（mesh）渐变**、图片填充、**Shader 填充（WebGL 1.0 GLSL 片元着色器）**；支持多填充叠加与 **blend mode**（20 余种）。<https://docs.pen.dev/core-concepts/drawing-and-editing>
- **描边**：单描边多填充、粗细（整体或分边）、端点/连接（butt/round/square、miter/bevel/round）、对齐（inner/center/outer）。
- **效果**：模糊、背景模糊、投影、内阴影、**Shader 效果（对已渲染节点做后处理滤镜）**。<https://docs.pen.dev/core-concepts/drawing-and-editing>
- **图片操作**：裁剪（transform 仿射矩阵）、**去背景**、**位图转可编辑矢量**（两者需联网 + pen.dev 账号，走托管服务）。<https://docs.pen.dev/core-concepts/drawing-and-editing>
- **图标库内置**：Material Symbols (Outlined/Rounded/Sharp)、Lucide、Feather、Phosphor；也可自导入 SVG。<https://docs.pen.dev/core-concepts/import-and-export>
- **字体**：字体选择器 + 自定义字体（`.ttf/.otf/.woff/.woff2`，仅限该文档，迁移时需随文件携带）。<https://docs.pen.dev/core-concepts/drawing-and-editing>
- **蒙版**：任意形状可作为下方图层的遮罩。<https://pen.dev/>

### 2.3 组件 / 变量 / 主题（Design System 层）

- **组件**：`reusable: true` 定义源组件，复制产生实例；实例可覆盖属性、可 **Detach instance** 脱离源。<https://docs.pen.dev/core-concepts/components>
- **Overrides 与 descendants**：实例通过 `descendants` 路径（如 `"ok-button/label"`）改写深层子节点；也可整体**替换**某节点（给 descendants 写 `type` 即为替换）。<https://docs.pen.dev/for-developers/the-pen-format>
- **Slots**：组件内空 frame 可标记为 slot，并推荐（suggest）特定组件，UI 上以斜纹标出可投放区域。<https://docs.pen.dev/core-concepts/slots>
- **变量**：color / number / string / boolean；支持变量别名（`button-fill` → `accent`）；可由 CSS `globals.css` 或 Figma 变量表截图生成。<https://docs.pen.dev/core-concepts/variables>
- **主题（多轴）**：`themes` 定义轴（如 mode: light/dark、spacing: regular/condensed），变量按轴给出多值，frame 上可 `theme: {mode:"dark"}` 覆盖，子节点继承。<https://docs.pen.dev/for-developers/the-pen-format>
- **Design Library**：`.lib.pen` 文件跨文件复用组件与变量；消费者文档 `imports` 相对 URI 引用；库更新后需重开文档才生效。<https://docs.pen.dev/core-concepts/design-libraries>

### 2.4 Code on Canvas（脚本节点）

- 在画布上放 **Script 节点**，指向同目录 `.js` 文件，脚本输出渲染为嵌套图层（图表、网格、装饰图案）。<https://docs.pen.dev/core-concepts/code-on-canvas>
- 头部声明：`@schema <version>` + `@input name: type(args) = default`（number/string/boolean/color/enum/ref）。
- 运行时 `pencil.width / pencil.height / pencil.input.*`；必须 `return` 节点数组，**上限 1000 个节点、2 秒内完成、同步执行**；沙箱内无 DOM/网络/文件；`Math.random()` 每次运行重播种（保证可复现）。
- 脚本输出是派生状态，不进 undo 历史；可"Convert to layers"固化为普通图层。
- 官方示例脚本仓库 `highagency/pencil-scripts`（团队维护的 charts/grid/pattern 示例）。

### 2.5 AI Agent 层

- **集成 agent**：桌面应用内置 chat（Cmd/Ctrl+K），可从模型选择器切模型与 reasoning effort；VS Code/Cursor 用 Copilot chat 或外部 MCP client。<https://docs.pen.dev/core-concepts/ai-agents>
- **上下文**：画布选中即上下文；可附加 PNG/JPEG/Markdown/源码文件；可拖拽入附件。
- **权限**：Permission Request 逐条 Allow/Deny；对 Claude 系模型可开 "Auto permission mode"。
- **并行 agent（swarm）**：1–6 个，"Split Work"（分工）与 "Side by Side"（同题多解）；"Let it cook" 迭代变体（Layout 变布局 / Style 变风格，2–6 变体）。
- **Skills**：内置设计 skills + 用户自定义 `SKILL.md`（目录名即 skill 名）；外部 MCP client 通过 `read_skill()` 读取 pen.dev 的设计指令（`pen-schema.md` / `execute.md` 等）。
- **MCP 工具**：`get_style`、`read_skill`、`get_app_state`、`execute`（`execute` 内含 `Insert()` / `TakeScreenshot()` / `Export()` 等操作）；桌面场景另有 `browser` 工具；`spawn_agents` 需 `-enable_spawn_agents`。<https://docs.pen.dev/getting-started/ai-integration>、<https://docs.pen.dev/for-developers/pen-cli>
- **模型接入（BYOK）**：OpenAI ChatGPT/Codex、Anthropic Claude Code（含 Bedrock/Vertex/Foundry/自定义 Claude）、Google Gemini、Cursor、GitHub Copilot、Meta、xAI、Kimi For Coding、OpenRouter、Moonshot/Deepseek/Together/Fireworks/Z.AI/OpenCode Zen & Go、以及**自定义 OpenAI/Anthropic 兼容端点**。<https://docs.pen.dev/getting-started/authentication>
- **托管模型**：MiniMax、GLM、Qwen、DeepSeek（走 High Agency，计 model credits）。

### 2.6 MCP 生态与客户端

- 本机 MCP server，客户端列表：Claude Code CLI、Codex CLI（ChatGPT 桌面版与 Codex IDE 扩展复用同一配置）、Gemini CLI、Antigravity 2.0、OpenCode CLI、Kiro CLI、Claude Desktop。也可通过 **WebMCP** 或 CLI 接入。<https://docs.pen.dev/getting-started/installation>
- 配置路径：应用内 Settings(⚙️) → MCP 启用；IDE 扩展里 `pen.dev: Toggle Design Mode` 切换自定义编辑器。

### 2.7 CLI（`@pen.dev/cli`）

> "It runs the same editor engine as the desktop app and IDE extension, fully headless and without a GUI." —— <https://docs.pen.dev/for-developers/pen-cli>

- 安装：`npm install -g @pen.dev/cli`，要求 **Node.js ≥ 22.19**；命令 `pen`。
- 认证：`pen login`（邮箱+密码/OTP，token 存 `~/.pencil/session-cli.json`）或 CI 用 `PEN_CLI_KEY`（组织级 CLI Key，优先于本地会话）。
- 其他命令：`pen status`、`pen codex-login/logout`、`pen version`、`pen interactive`。
- Agent 模式：`pen --out d.pen --prompt "..."`、`--in/--out`、`--prompt-file`、`--agent claude|codex|google|xai|openrouter`、`--model`、`--effort`、`--usage`（token 成本 JSON）、`--tasks <tasks.json>` 批量、`--repo -C`（工作目录）、`--list-models`、`--workspace/--list-workspaces`、`--max-failed-calls`。
- 导出：`--export path --export-scale n --export-type png|jpeg|webp|pdf`（**扩展名不决定格式**，需显式指定）；`--enable-preview` 每次变更后存预览 PNG 到 `~/.pencil/latest-preview.png`。
- Interactive 模式：`--app desktop` 接管运行中的桌面应用（live 修改，先 `get_app_state()`），或 headless 模式；shell 里直接 `tool_name({k:v})`、`save()`、`exit()`。
- 环境变量：`PEN_CLI_KEY`、`PEN_AGENT_API_KEY`、`ANTHROPIC_API_KEY`、`GEMINI_API_KEY`、`XAI_API_KEY`、`PEN_API_BASE`（默认 `https://api.pen.dev`）、`DEBUG`。

### 2.8 导入导出（Import / Export）

**导入**：完整 `.fig` Figma 文件；Figma 图层复制粘贴（**不支持粘贴图片元素**）；PNG/JPEG/SVG（SVG 变可编辑图层）；**内置浏览器导入网页或单个元素为可编辑图层**（含 localhost URL，可选设备预设；不保留 JS 交互）；Chrome 扩展抓网页；`browser` MCP 工具截图/导入。

**导出**：HTML + CSS 或 HTML + Tailwind（属性面板 Code 区，一键 Copy/Export，可配 HTML 脚手架与资源内联方式）；PNG/JPEG/WEBP/PDF，1x/2x/3x；多选栅格导出为 `export.zip`；PDF 多选中每层一页；`Copy as PNG` 到剪贴板；Slides 视图按幻灯顺序导出 PDF。

### 2.9 协作、演示与其他

- **分享**：Share → Create share link，**上传文档及其引用的图片与 `.pen` 库为快照**；可 Update snapshot；可撤销链接；访客可浏览器查看与下载 ZIP。**不是实时多人协同**。<https://docs.pen.dev/core-concepts/sharing>
- **Slides / 演示**：左栏 Slides 视图管理顶层 frame 顺序，Present 模式（Cmd/Ctrl+Enter），按幻灯序导出 PDF。<https://docs.pen.dev/core-concepts/presentations>
- **Design as Code**：`.pen` 随代码入库、Git diff/branch/merge；设计冲突**禁止直接改 JSON**，要在应用内合并。<https://docs.pen.dev/core-concepts/design-as-code>、<https://docs.pen.dev/core-concepts/pen-files>
- **恢复机制**：桌面端异常退出后写独立 recovery backup，重开可"Recovered changes"；明确声明**恢复备份不是版本历史**。
- **图标库 / 内置品牌 kit**：Material Symbols、Lucide、Feather、Phosphor；官网还有 "Goodies" 素材区与 "UI Libraries"（跨文件共享组件集）。<https://pen.dev/>

---

## 3. 公开技术架构信号

### 3.1 渲染层：自定义 WebGL 管线

官网功能卡原文："Thousands of layers stay smooth as you pan, zoom, and edit powered by a **custom WebGL pipeline**."（<https://pen.dev/>）

格式层面的佐证（`.pen` schema）：
- `Fill` 类型含 `{ type: "shader" }`：`url` 指向 **WebGL 1.0 (#version 100) fragment shader** 文件（相对 `.pen` 文件路径），uniform 由着色器内 `@directive` 注释声明；`@resolution` 标注的 uniform 自动绑定像素尺寸；`@time` 标注的不可被用户覆盖。
- `Effect` 类型同样支持 `{ type: "shader" }`，且 `sampler2D` uniform 可绑定 `pencil:object`（已渲染节点）做后处理。
- `Mesh gradient` 走 `columns/rows/colors/points`（带贝塞尔手柄）的顶点色网格插值。
- 关键含义：**着色器是"一等公民"写在文档里的**，渲染器必须支持 GLSL 编译、uniform 反射、节点纹理回读。这不是一个普通 SVG/Canvas 编辑器能承载的能力。

> 推论：pen.dev 的渲染核心大概率是自研 WebGL/Canvas2D 混合管线（**未开源**），这对开源复刻是最重的一块。

### 3.2 数据层：`.pen` 格式（公开的完整 TypeScript schema）

文档："The following sections provide a birds-eye view of the .pen format. For the authoritative, exhaustive reference of all the supported features, please consult the TypeScript schema at the end of this page."（<https://docs.pen.dev/for-developers/the-pen-format>）

实测 schema 关键点：

```
export interface Document {
  version: "2.21";                       // schema 版本，随文档携带
  themes?: { [axis]: string[] };          // 主题轴
  imports?: { [alias]: relativeUri };     // 引用其他 .pen（库）
  variables?: { [name]: { type: "boolean"|"color"|"number"|"string"; value: ... } };
  children: (Frame|Group|Rectangle|Ellipse|Polygon|Path|Text|Note|Context|Prompt|Icon|Script|Browser|Ref)[];
}
```

节点类型全集（Child union）：**Frame / Group / Rectangle / Ellipse / Polygon / Path / Text / Note / Prompt / Context / Icon / Script / Browser / Ref**。

其他值得注意的 schema 设计：

| 机制 | 语义 |
|---|---|
| `id` + `type` | 唯一 id（不得含 `/`）、类型判别 |
| `x/y` | 相对父级左上角；父级有 flex 时被忽略 |
| `layout: "none"\|"vertical"\|"horizontal"` + `gap/padding/justifyContent/alignItems` | CSS Flex 语义的子集 |
| `width/height: number \| "fit_content" \| "fill_container" \| "fit_content(100)"` | SizingBehavior 动态尺寸 |
| `fill` 多值数组 + `blendMode` | 多层填充叠加 |
| `reusable: true` + `type: "ref"` + `ref: id` + `descendants` | 组件/实例/覆盖/替换 |
| `slot: false \| string[]` | 插槽 + 推荐组件 |
| `theme: {axis: value}` | 主题继承与覆盖 |
| `variable` 绑定 | 属性值写 `"$color.text"` |
| `type: "script"` + `scriptUri` + `inputs` | Code on Canvas 节点 |
| `type: "browser"` + `url/deviceId/zoom/scrollX/scrollY` | 画布内嵌实时网页 |
| `type: "icon"` + `library: lucide\|feather\|Material Symbols Outlined\|Rounded\|Sharp\|phosphor` | 图标引用 |
| `metadata: {type, ...}` | 扩展位（自研可扩展点） |
| JSON 注释 | **.pen 文件允许 JSON 注释**（非严格 JSON） |

### 3.3 Agent 层：本地 MCP + 统一引擎

- **单一引擎三端复用**是整个架构的核心信号：CLI 文档明说"runs the same editor engine as the desktop app and IDE extension, fully headless"。这意味着"画布状态模型 + MCP 工具 + 序列化"是与 UI 解耦的核心库，桌面/IDE/CLI 都是它的壳。
- MCP server 在**本机**运行，工具为 `execute` / `get_app_state` / `read_skill` / `get_style`（+ `browser`、`spawn_agents`）。设计文件**留在用户机器**。
- `execute` 是关键抽象：agent 不直接写 JSON，而是调用**带参数的文档操作 DSL**（如 `Insert(document,{type:"frame",...})`、`TakeScreenshot([hero])`、`Export()`），由引擎负责校验与应用。这解决了"agent 手写 JSON 破坏文档"的问题。
- 远程服务仅承担：账号/组织/配额、托管模型、图像与 SVG 生成、分享快照上传。`PEN_API_BASE` 默认 `https://api.pen.dev`。

### 3.4 BYOK 多模型

- 桌面端 Settings → Agents 可接 20+ provider 认证方式（订阅登录、API key、Bedrock/Vertex/Foundry、自定义端点）。
- 官方结论："Use with your ChatGPT or Claude subscription, add API keys or connect via MCP, WebMCP or CLI."（<https://pen.dev/>）
- 模型选择器带 **reasoning effort** 箭头；"Designed for…" 可展开查看用量；Context usage 显示 token 与估算成本。
- 托管模型（MiniMax / GLM / Qwen / DeepSeek）与 BYOK 并存，走 credit 计费。

### 3.5 三端（+两端）架构汇总

| 端 | 形态 | 职责 |
|---|---|---|
| 桌面应用 | macOS(Intel/Apple Silicon)、Windows x64(ARM64 待定)、Linux(x64/ARM64, AppImage+tarball) | 主编辑器、内置浏览器、AI chat、Slides、分享 |
| IDE 扩展 | VS Code / Cursor / Antigravity / Windsurf（OpenVSX） | 自定义编辑器（Design Mode）、可与 IDE chat / Copilot 协作 |
| CLI | Node ≥ 22.19，npm `@pen.dev/cli` | headless 编辑、agent 批处理、导出、CI/CD |
| Web | app.pen.dev | 免费版 web 入口 |
| Chrome 扩展 | Chrome Web Store（约 4k 用户） | 抓网页为可编辑图层 |

### 3.6 其他工程信号

- **桌面端是"壳 + 引擎"**：CLI 与桌面共用引擎，所以 Rust/C++/原生加速只写一次；Web 版本另有一套（推测）。
- **恢复/事务性写盘**：文档提到 recovery backup、Save As、原子保存等细节（<https://docs.pen.dev/core-concepts/pen-files>）。
- **Undo/Redo**：Cmd+Z / Cmd+Shift+Z，聚焦画布时生效；脚本派生输出不进 undo 历史。
- **性能定位**："thousands of layers stay smooth"，说明有分块/视口裁剪/脏矩形等机制，但实现未公开。

---

## 4. 为什么它感觉"重"，哪些部分不利于开源友好

### 4.1 "重"的来源（均可在公开材料中定位）

1. **五端并行维护**：web + 桌面 + IDE 扩展 + Chrome 扩展 + CLI，任何一次引擎升级要同步五个壳。（<https://pen.dev/pricing>、<https://docs.pen.dev/getting-started/installation>）
2. **渲染野心过重**：自定义 WebGL 管线 + GLSL shader fill/effect + mesh gradient + 内嵌浏览器实时渲染页面（`type: "browser"` 节点带 scroll/zoom/device 模拟）。单是 shader 这条就等于自研 mini 渲染引擎 + uniform 反射系统。（<https://pen.dev/>、<https://docs.pen.dev/for-developers/the-pen-format>）
3. **功能面爆炸**：官网功能网格 30+ 张卡，末尾直接写 "This list goes on and on and on…"；编辑器同时覆盖矢量、组件系统、主题、脚本、幻灯片、分享、Figma 导入、网页导入、图像 AI（去背景/矢量化）。（<https://pen.dev/>）
4. **智能体编排层复杂度**：1–6 并行 agent × Split Work/Side by Side × "Let it cook" 迭代变体（Layout/Style）× 权限模型（逐条 Allow/Deny + Auto）× 会话/用量/成本面板。
5. **云端依赖仍在**：虽然"本地优先"，但托管模型、图像/SVG 生成、账号/组织/配额、分享快照全在 High Agency 侧；桌面应用**登录后**才能用内置 agent 与分享。
6. **导入的复杂度被低估**：`.fig` 解析（闭源格式）、Figma 剪贴板协议、SVG、位图、整页网页/元素网页转可编辑图层——每种都是独立的大工程。
7. **打包与运行时门槛**：CLI 强制 Node.js ≥ 22.19；桌面端还要塞一个 Chromium 内核浏览器。
8. **配额带来的仪式感**：agent 设计天数、图像生成次数、并行 agent 数——用户必须学会"算配额"，产品体验被计费模型切割。
9. **桌面端与 IDE 端体验割裂**：同一引擎两套壳，自定义编辑器（Design Mode）、命令面板（`pen.dev: Toggle Design Mode`）、活动栏图标、备份策略都要各自实现（<https://docs.pen.dev/troubleshooting> 里大量条目就是在修 IDE 集成）。

### 4.2 不利于开源友好的具体部分

| 部位 | 问题 | 影响开源复刻 |
|---|---|---|
| 应用源码 | 闭源，仅 EULA 授权（不可再分发、不可 fork） | 无法"改造成 OSS"，只能**重写** |
| `.pen` schema | **虽公开但明确保留破坏性变更权**："This is a live documentation, and we reserve the right to introduce breaking changes in the .pen format." 且文档要求"Keep the original file before opening it in a different version" | 不能把"兼容 .pen"当作产品承诺；上游一次改版就打断下游 |
| WebGL 渲染核心 | 不开源，且是最高价值也最难复刻的部分 | 开源替代品要么放弃 shader（功能不对等），要么自研（成本极高） |
| Figma `.fig` 解析 | 依赖 Figma 闭源格式，逆向解析存在法务风险 | 开源项目应改走 Figma 官方 API / 插件导出 / SVG 路径 |
| 托管 AI 服务（图像/SVG 生成、模型 credits） | 服务端专有，无法自建 | 需要替代路径（本地模型 / 第三方 API 抽象） |
| 账号、组织、计费、配额 | 与产品主线耦合但对开源无意义 | 开源版应直接去掉，改为纯本地 + 自带 key |
| 分享快照上传 | 依赖 High Agency 存储 | 改为静态导出 / 自托管 |
| 品牌资产 | "pencil"/"pen" 命名、nib 图形 logo、官网素材、Shader Gallery 样例 | 必须完全另起品牌与视觉 |
| 官方脚本库 `highagency/pencil-scripts` | 需单独确认授权；默认应视为"只读参考" | 不得直接搬运 |

### 4.3 反过来看：它留下的机会窗口

- **格式公开 + 工具链开放**：MCP、JSON、CLI 让生态位天然可替代。
- **痛点清晰**：配额与 agent 天数、schema 不稳定、闭源、CLI 的 Node 版本门槛、共享仅快照——这些都是开源版本可以直接攻击的点。
- **社区已有底座**：Penpot / tldraw / Excalidraw 提供了渲染与协作的成熟件，可以"拼装"而不是从零。

---

## 5. 开源对标

> 说明：下表为公开资料 + 官方文档/仓库核对结果；标注"待核实"的字段表示未取得一手确认，不作为结论使用。

| 维度 | **pen.dev**（对标对象） | **Penpot** | **tldraw** | **Excalidraw** |
|---|---|---|---|---|
| 许可证 | 闭源（EULA） | **MPL-2.0**（GitHub API SPDX 实测：MPL-2.0，真开源，文件级 copyleft） | 源码可见但**非 OSI 开源**：GitHub API 判定 `NOASSERTION / Other`，即 tldraw 自有 "tldraw license"——原文写明仅允许 Development Environment 使用，Production Environment 需 **License Key** 与另行商业授权 | **MIT**（GitHub API SPDX 实测：MIT，最宽松） |
| 主体 | High Agency Inc.（a16z Speedrun 支持） | 社区 + Kitteh（公司） | tldraw Inc. | Excalidraw 社区 / Facebook 起源 |
| 技术栈 | 闭源；TypeScript 生态（Next.js/Nextra 文档、Next.js 官网、npm CLI） | 前端 ClojureScript（自研 Reactive/编辑器内核）、后端 Scala/Kotlin，**SVG 为核心渲染模型** | TypeScript / React，**Canvas 自研渲染器**（含 WebGL 加速路径） | TypeScript / React，**Canvas 2D** 手绘风渲染 |
| 渲染方式 | 自定义 WebGL 管线（+ GLSL shader 节点） | SVG（DOM/服务端渲染友好） | Canvas（2D/WebGL 混合） | Canvas 2D |
| 文件格式 | `.pen`（JSON，schema 公开但可破坏性演进） | 自有格式（原生 SVG 树，插件 API 访问），非"设计即代码"仓库友好 | 自有 record 模型（JSON snapshot） | `.excalidraw` JSON scene |
| 仓库友好度 | **高**（设计文件与代码同 repo，Git diff 可读） | 低-中（需插件/导出才能落库） | 中（snapshot JSON 可入库，但缺 schema 契约） | 中（JSON scene 可入库） |
| AI / Agent | 原生内置 agent + MCP 读写 + 多模型 BYOK + 并行 agent | **有官方 MCP**：`penpot/penpot-mcp`（TypeScript，534★，MPL-2.0） | **无官方 AI/MCP**（org 下无 mcp 仓库，仅社区实现） | **有官方 MCP**：`excalidraw/excalidraw-mcp`（TypeScript，5.6k★，仓库根目录未检出 LICENSE，使用前需逐包核对授权） |
| 自托管 | ❌（闭源 SaaS） | ✅ 官方 Docker/K8s 自托管路径 | 部分（SDK 可自建；官方 Sync 需付费） | ✅ |
| 代码交付 | ✅ 一键 HTML+CSS/Tailwind，agent 生成 React/Vue/Svelte 等 | ✅ dev mode + token/CSS 导出（中等） | 弱（SDK 路线） | 弱（SVG 导出为主） |
| 实时多人 | ❌（链接快照分享） | ✅ | ✅（官方 Sync，付费） | ✅（多人协作房间） |
| 组件/变量/主题 | ✅ 组件 + 覆盖 + 插槽 + 多轴主题变量 | ✅ | ❌ | ❌ |
| 脚本/动态图形 | ✅ Script 节点 + shader 节点 | ❌ | ❌（有 shape utils） | ❌（embeddable） |
| 能否作为复刻底座 | ❌ 闭源 | ✅ **最合适的底座**：MPL-2.0、可自托管、SVG 模型与"设计即代码"契合 | ⚠️ 许可证限制，需商业授权才能用于商业闭源产品 | ✅ MIT 宽松，但产品定位偏白板/手绘，非"设计稿 + 代码交付" |
| 最短板 | 闭源、schema 不稳、配额制 | 无 agentic 能力、编辑器 UX 偏"工程" | 许可证 + 商业成本 | 无组件系统/主题/代码交付 |

**结论性判断**：
- **Penpot** 是"结构最接近、许可证最友好"的底座（SVG + 自托管 + 插件 API + 真开源），但它没有 agentic 叙事。
- **tldraw** 是"交互手感最好"的底座，但**许可证是硬伤**——若新产品要商用/闭源分发，不能直接套用其 SDK 代码；可以读其公开论文/文档/交互设计思想，但**不能复制代码**。
- **Excalidraw** 许可证最干净，但产品形态（白板/手绘）离"可交付代码的设计系统"太远。
- 因此推荐路线：**自研场景模型与格式（借鉴 .pen 的设计思想，不抄实现），渲染层基于 SVG/Canvas 的通用库，AI 编排层用 MCP 标准协议现成件**。

### 5.1 补充对标：OpenPencil（MIT）—— 更激进的路线分支

在本次调研之后补充核对了 **[open-pencil/open-pencil](https://github.com/open-pencil/open-pencil)**（MIT · TypeScript · 9,480★ · 2026-10-30 仍在提交 · 官方定位 "AI-native design editor. Open-source Figma alternative."）。它是本项目最接近的**现成开源引擎**，结论与上表所有候选都不同：

| 维度 | pen.dev | **OpenPencil** |
|---|---|---|
| 许可证 | 闭源 EULA | **MIT**（GitHub API SPDX 实测） |
| 形态 | Web + 桌面 + IDE 扩展 + Chrome 扩展 + CLI | Tauri v2 桌面（~15MB）+ 浏览器 PWA，**无账号无后端** |
| 原生格式 | `.pen`（JSON 文本，但保留破坏性变更权） | `.fig` **二进制（Kiwi）**，Figma 兼容优先 → **Git diff 不友好** |
| 布局引擎 | 自研 flex 子集 | Yoga WASM（flex + CSS Grid） |
| MCP | 内置 `execute`/`get_app_state`/`read_skill`/`get_style` | `@open-pencil/mcp`，**100+ 工具** |
| AI | 内置 agent + 20+ provider BYOK + 1–6 并行 | BYOK chat（OpenRouter/Anthropic/OpenAI/Google/DeepSeek/Z.ai/MiniMax）+ 桌面内置 coding agent 接入 |
| 组件/导出 | 组件 + 插槽 + 变量 + 多轴主题；HTML/Tailwind、PDF | 组件 + variants + 组件集；导出 jsx / tailwind-jsx / html / storybook / svg / pdf / pptx，且**可从 HTML/Tailwind 反向导入** |
| 桌面端 | 需登录、配额制 | 无账号无后端 |

**这条分支的战略含义**：

1. **"自研画布"这条路基本被证伪**——OpenPencil 是 MIT、活跃、功能是 pen.dev 的超集，自己画一遍等于"重造一个更差的 OpenPencil"。理性选择是**不 fork、作为上游 npm 依赖**（官方提供 custom editor shell，正是为这种模式设计），把自研精力压到差异层。
2. **pen.dev 唯一尚未被开源覆盖的真洞察，正是"文本 JSON、Git diff 友好"**（OpenPencil 走 `.fig` 二进制路线，主动放弃了这一块）。因此差异层应聚焦：**文本化文档格式 + agent 可直接 patch 文件 + 与 `.fig` 双向转换 + 中文内容创作工作流（社媒尺寸模板、一键多尺寸派生、素材生成入画布）**。
3. **本报告第 6 节的技术栈建议据此修订（OpenDesigner 仓库 `PLAN.md` v3 已按此路线改写）**：把"自研 `schema` + `renderer-svg` + `engine`"替换为"**复用 `@open-pencil/core` / `@open-pencil/scene-graph` / `@open-pencil/vue` / canvaskit-wasm**，只自研 `od-format` 序列化层（文本 JSON ⇄ 引擎文档）+ 自定义 Shell + 工作流层**"；MCP 复用 `@open-pencil/mcp`，不另起协议实现。
4. **风险点**：引擎文档模型 → 文本 JSON 的**序列化保真度**是整个差异层的技术命门（组件 + 自动布局 + 变量 三者 round-trip 无损才算成立），必须先实测再立项。
5. **参考**：仓库 `docs/competitive-review.md` 已记录同结论（2026-10-31 实跑 `npx @open-pencil/cli --help` 验证）。

---

## 6. 轻量、开源友好的复刻蓝图

### 6.1 产品定位（差异化主张）

> **"一个本地优先、格式稳定、模型自由的设计画布，专为 agent 读写而设计。"**

三条硬承诺（对标 pen.dev 的软肋）：
1. **格式不破坏**：语义化版本 + 公开 JSON Schema + **迁移器随版本发布**，永不要求"保留旧文件备份"。
2. **不设配额**：全部本地运行；模型一律 BYOK（OpenAI/Anthropic/Gemini/Ollama/OpenRouter…），不托管、不限次、不计费。
3. **一个核心，四种壳**：一套引擎 → Web / 桌面(Tauri) / VS Code 扩展 / CLI；IDE 与桌面共享同一份编辑器（可后期再拆）。

### 6.2 MVP 必做 / 可砍

| 能力 | MVP 必做 | 可砍（v1 之后） | 说明 |
|---|---|---|---|
| 场景模型 | 矩形/椭圆/路径/文本/frame/group/id+type/坐标 | 网格渐变、shader | 保留 `fill/stroke/opacity` 基础字段 |
| 布局 | 绝对定位 + 简单纵向/横向 flow（gap/padding） | fit/fill 动态尺寸、绝对定位切换 | flex 子集即可覆盖 80% 场景 |
| 渲染 | **SVG 渲染器**（DOM 或 canvas→svg） | 自研 WebGL 管线 | SVG 换来零成本导出、可读 DOM、命中测试简单、代码生成直接映射 |
| 格式 | JSON + 公开 JSON Schema + `version` + 迁移器 + 允许注释的解析器 | 复杂 mesh/shader uniform 反射 | 格式是产品核心资产，必须自己定，不抄 `.pen` |
| 组件 | 组件源 + 实例 + 简单 override | 嵌套 descendants 覆盖、detach、slot 推荐 | 第一版只做"实例 + 属性覆盖" |
| 变量/主题 | 颜色/尺寸变量 + 单轴 light/dark | 多轴主题、变量别名 | 先支持 `$var` 绑定 |
| Agent | **MCP server（stdio + HTTP）**：`read_doc` / `list_nodes` / `apply_ops` / `screenshot` / `export` | 多 agent 并行、Let it cook 变体 | 这是差异化核心，必须第一版就有 |
| 模型 | BYOK 适配器（OpenAI/Anthropic/Gemini/OpenAI-compatible）+ 内置 chat 面板 | 托管模型、credits | 直接对接用户 key |
| 导出 | SVG、PNG、HTML+CSS/Tailwind | PDF 多页、Figma/fig 导出 | HTML 导出做"结构 → 语义标签 → 类名"映射 |
| 导入 | SVG、PNG/JPEG、剪贴板 HTML | **`.fig` 解析**、整页网页转图层 | Figma 走 API/插件，网页走 Playwright（放 v2） |
| 交互 | 平移缩放、选择、拖拽、图层面板、属性面板、撤销重做 | 像素网格、测量、Scale 工具、对齐吸附 | 常规编辑器手感即可 |
| 分发 | Web + CLI + VS Code 扩展 | 桌面应用、Chrome 扩展 | CLI 用 tsx/Node 20+，别学 Node 22.19 门槛 |
| 协作 | 纯本地文件 + Git | 实时多人、云分享快照 | 用 CRDT(Yjs) 放 v3 |
| 脚本/代码画布 | — | Script 节点、shader 节点、浏览器节点 | 直接砍掉，这是 pen.dev 最重的部分 |
| 图像 AI | — | 去背景、矢量化 | 交给用户自己的视觉模型/第三方 API |
| 品牌 kit | — | 内置图标库、品牌素材 | 保留一个开源图标集（Lucide/Phosphor，MIT/ISC） |

### 6.3 推荐技术栈

> ⚠️ **本节已被 §5.1 修订**：若采纳"复用 OpenPencil 上游引擎"路线，下列 `packages/schema`、`packages/engine`、`packages/renderer-svg`、`packages/mcp` 四件应改为 **npm 依赖 `@open-pencil/core` / `@open-pencil/scene-graph` / `@open-pencil/vue` / `@open-pencil/mcp` + canvaskit-wasm**，本项目只自研 **`od-format`（文本 JSON ⇄ 引擎文档双向序列化层）**、`apps/ui`（中文 Shell）与工作流层。下表保留"从零自研"的完整形态，作为**备选路线（若不复用上游）**与**最小可行内核的抽象清单**。

```
pen-lite/
├── packages/
│   ├── schema/        # 场景模型 + zod + JSON Schema 生成 + 迁移器（纯 TS，无运行时依赖）
│   ├── engine/        # 文档状态机 + 操作（op）日志 + undo/redo + 序列化（无 UI 依赖，可 headless 运行）
│   ├── renderer-svg/  # SVG 渲染器（可插拔；未来可加 renderer-canvas）
│   ├── mcp/           # @modelcontextprotocol/sdk server：stdio + streamable HTTP
│   ├── agent/         # BYOK 模型适配层（Vercel AI SDK 或自写薄封装）+ tool-calling 循环
│   ├── exporter/      # SVG/PNG（satori 或 resvg-wasm）/HTML+Tailwind 生成器
│   └── ui/            # React + Zustand（或 Jotai）编辑 UI（Web）
├── apps/
│   ├── web/           # Vite + React；也可直接被 VS Code webview 复用
│   ├── cli/           # Node ≥20，tsx 运行；pen-lite create/edit/export/mcp
│   └── vscode/        # vscode extension + webview 加载 apps/web
└── (v2) apps/desktop/ # Tauri 2（Rust），复用 apps/web
```

选型理由：
- **TypeScript 全栈**：文档、CLI、MCP、UI 共用一套类型；schema 即 agent 的契约。
- **SVG 而非 WebGL**：pen.dev 的性能优势来自 WebGL；开源复刻第一版用 SVG 换开发速度与"代码交付"天然映射。预留 `Renderer` 接口，后续可加 Canvas/WebGL 渲染器。
- **MCP 用官方 SDK**：这是 pen.dev 最大的资产也是开源最容易对齐的协议；外部 agent（Claude Code / Codex / Cursor）零成本接入。
- **模型层用 AI SDK / 薄封装**：避免把 provider SDK 全塞进仓库；统一 tool-calling 与流式。
- **CLI 用 Node 20+ + tsx**：不引入 Electron 依赖，不强制高版本 Node。
- **桌面版选 Tauri 而非 Electron**：安装包小、内存低，对"轻量"叙事一致；如需内置浏览器（网页导入）再单独用系统 WebView / Playwright。
- **文件格式自研**：JSON + 明确 schema + 迁移器 + 可选注释（JSONC）。**不要用 `.pen` 扩展名**，避免商标/混淆问题。

### 6.4 分阶段路线图

| 阶段 | 周期(估) | 交付物 | 验收标准 |
|---|---|---|---|
| **P0 引擎与契约** | 4–6 周 | `schema` 包（场景模型 + JSON Schema + 迁移框架）、`engine` 包（op 日志 + undo/redo + 序列化）、单元测试、公开 schema 文档站 | 一个 `.json` 设计文件能被读写往返；v1→v2 迁移有测试覆盖；引擎可在 Node 里 headless 运行 |
| **P1 最小可用画布** | 4–6 周 | SVG 渲染器、选择/拖拽/缩放/图层面板/属性面板、撤销重做、Web UI | 200 个节点下交互不卡；可手动画一个登录页 |
| **P2 Agent 化（差异化）** | 4–6 周 | MCP server（`read_doc`/`list_nodes`/`apply_ops`/`screenshot`/`export`）、CLI（`create/edit/export/mcp`）、BYOK 内置 chat | Claude Code / Cursor 能读改本工具的设计文件；CLI 能在 CI 里从 prompt 生成 `.json` 设计 |
| **P3 设计系统与交付** | 4–6 周 | 组件/实例/override、变量 + light-dark、SVG/PNG/HTML+Tailwind 导出、变量→CSS token 同步 | 设计稿导出的 HTML/CSS 结构可读、与手写组件库对齐 |
| **P4 分发与集成** | 4–6 周 | VS Code 扩展（webview）、Tauri 桌面应用、SVG/剪贴板导入 | VS Code 里能打开设计文件；桌面版安装包 < 100MB |
| **P5 生态** | 后续 | Figma 官方 API/插件导入、网页→图层（Playwright）、设计库（类似 `.lib`）、Yjs 协作 | 与 Figma 往返一次不丢结构；两人同时编辑不冲突 |
| **明确不做** | — | 自研 WebGL 管线、GLSL shader 节点、Script 节点、`.fig` 解析、托管模型与配额、云分享快照 | 这些是"重"的来源，交给插件生态或不做 |

---

## 7. 洁净室复刻注意点（不要抄专有代码/资源）

### 7.1 什么是可以合法使用的

- **公开事实与规格**：`pen.dev` 的功能列表、`.pen` 格式的公开描述与文档中发布的 TypeScript schema（<https://docs.pen.dev/for-developers/the-pen-format>）、MCP 工具名与语义、CLI 参数与行为——这些是**可观察的接口规格**，可以阅读、参考、做兼容性思考。
- **独立实现**：依据上述规格自行实现的代码、数据结构、文档均属己方作品。
- **第三方开源资产**：Lucide（ISC）、Feather（MIT）、Phosphor（MIT）、Material Symbols（Apache-2.0）可各自按原授权使用（注意保留许可声明）。

### 7.2 绝对不要碰的

| 红线 | 说明 |
|---|---|
| 应用源码 | 桌面应用为闭源 EULA 授权。**不要反编译/解包 Electron 或原生二进制**，不要复制其 JS bundle 中的实现代码。 |
| 品牌与素材 | "pen"/"pencil" 命名、nib 笔尖 logo、favicon、`/assets/marketing/...` 下的 webp/png/视频、官网文案与 feature card 文案、Shader Gallery 样例——一律不用。项目需完全另起命名与视觉体系（且不要用 `.pen` 扩展名）。 |
| 官方示例脚本 | `highagency/pencil-scripts` 在未确认许可前只作阅读参考，**不复制文件内容**；需要图表脚本应自行实现或引用 MIT 许可的图表库。 |
| **本地解包产物（重要）** | 若在本地留有从竞品桌面应用解包出的 asar 产物、主进程 bundle、`@vendor/*` 私有包、厂商内置 skill 文档或大体积 JS 摘要，它们都是**专有代码与受版权保护的文档**：本地用于理解行为可以，**绝对不得进入任何 Git 仓库**（尤其公开仓库），也不得再分发或作为本项目的实现来源。本项目自身的代码必须按 §7.3 的洁净室流程独立实现。仓库 `.gitignore` 应显式挡住宿主目录与解包产物。 |
| 服务端 | 不调用/代理 `api.pen.dev`，不抓取其托管模型；自有实现直连用户指定的 provider。 |
| Figma `.fig` 解析 | 逆向解析闭源格式存在法务风险。走 Figma 官方 REST API、插件导出或 SVG 路径。 |
| 用户数据 | 不用真实用户的 `.pen` 文件做训练集或演示素材，除非拿到明确授权。 |

### 7.3 建议的洁净室流程（可写进项目 CONTRIBUTING）

1. **规格先行**：由一名成员只依据官网 + 官方文档写出"功能规格说明书"与"格式设计文档"（自己的 schema），并记录每条规格的来源 URL。
2. **实现隔离**：实现者只读自己的规格文档，不读 pen.dev 的实现物（本来也读不到）。
3. **命名隔离**：内部领域词用自有词汇（scene/node/token/palette…），避免直接复制 pen.dev 的字段名与错误信息文案。
4. **不兼容也无所谓**：本项目**不承诺** `.pen` 兼容。若未来确需导入旧 `.pen` 文件，单独写一个**基于公开文档重写**的转换器（clean-room），并在 README 中注明"依据公开文档独立实现，与 pen.dev 无关"，同时避免逐字段复制其 TS schema 源码（结构相似不可避免，但表达式应自己写）。
5. **合规检查**：发布前过一遍 license（依赖树）、商标（名称/图标）、字体与图标许可、AI 训练数据来源。
6. **过程留痕**：保留规格来源清单与设计决策记录（ADR），便于日后审计。

### 7.4 一条务实的提醒

pen.dev 的核心体验（agent 改稿、像素级稿转代码）**不是靠抄代码获得的，而是靠三件事**：稳定的场景模型、统一的操作 DSL、以及 MCP 协议接入。这三件事都可以独立原创，原创成本远低于逆向成本，且能顺带解决它的两大痛点（schema 破坏性变更、配额制）。

---

## 8. Executive Summary —— 10 条要点

1. **pen.dev 的本质不是"Figma + AI"，而是"agent 可读写的矢量画布 + 设计即代码"**：`.pen` 是 JSON 文档，落在你的 git 仓库里，agent 通过 MCP 直接读写；产品叙事是消除设计与开发之间的交接（<https://docs.pen.dev/>、<https://docs.pen.dev/core-concepts/design-as-code>）。
2. **格式公开是它最大的善意，也是最大的坑**：官方发布了完整 TypeScript schema，但同时声明"we reserve the right to introduce breaking changes"，并要求用户"Keep the original file"——任何把 `.pen` 当作长期契约的下游都会被上游打断（<https://docs.pen.dev/for-developers/the-pen-format>）。
3. **架构上最值得学的一点是"单一引擎、四种壳"**：CLI 文档明说 headless CLI 与桌面应用、IDE 扩展共用同一编辑器引擎；这让"批处理/自动化"与"交互式设计"共享同一套语义，是可复刻的关键决策（<https://docs.pen.dev/for-developers/pen-cli>）。
4. **最值得学的抽象是 `execute` 操作 DSL**：agent 不直接手写 JSON，而是调用带参操作（Insert/TakeScreenshot/Export）由引擎校验应用——这既是安全边界，也是把"agent 能力"与"文件格式"解耦的接口设计（<https://docs.pen.dev/for-developers/pen-cli>、<https://docs.pen.dev/getting-started/ai-integration>）。
5. **"重"的三大来源**：五端并行维护；渲染野心（自定义 WebGL 管线 + GLSL shader fill/effect + mesh gradient + 内嵌浏览器）；智能体编排复杂度（1–6 并行 agent × 变体迭代 × 权限模型），再加 30+ 项功能的横向铺开（<https://pen.dev/>）。
6. **最不利于开源的四点**：应用闭源仅 EULA；渲染核心不可复用；`.fig` 逆向解析有法务风险；账号/配额/托管模型/云分享无法自建（<https://pen.dev/pricing>、<https://pen.dev/eula>）。
7. **对标结论**：Penpot（MPL-2.0、自托管、SVG 模型）是许可证与架构上最合适的底座；tldraw 手感最好但**自有非 OSI 许可证**是硬伤；Excalidraw（MIT）最宽松但产品形态（白板）离"可交付代码"太远——因此推荐"自研场景模型与格式 + 通用渲染库 + MCP 官方 SDK"的拼装路线。
8. **复刻的必做内核**：稳定的场景模型与版本化迁移器 + SVG 级渲染 + MCP server（read/list/apply-ops/screenshot/export）+ BYOK 模型层 + CLI headless + HTML/Tailwind 导出 + VS Code 扩展；**必砍**：WebGL 自研管线、shader 节点、Script 节点、`.fig` 解析、托管模型与配额、云分享快照（这些正是"重"的来源）。
9. **建议技术栈**：TypeScript monorepo（`schema` / `engine` / `renderer-svg` / `mcp` / `agent` / `exporter` / `ui`），Web(Vite+React) + CLI(Node 20+, tsx) + VS Code 扩展(webview) 先行，桌面用 Tauri 2 后期补；渲染器做可插拔接口，为将来 Canvas/WebGL 留门。
10. **洁净室红线**：只读公开文档与官网、不反编译应用、不复用品牌/logo/营销素材/官方脚本库、不调用其 API、不逆向 `.fig`、不宣称 `.pen` 兼容（也**不要用 `.pen` 扩展名**）；规格先行、实现隔离、过程留痕——pen.dev 真正难复制的是它的工程品味与生态位，而不是它的代码。

---

### 参考链接清单

- 产品与商业：<https://pen.dev/>、<https://pen.dev/pricing>、<https://pen.dev/faq>、<https://pen.dev/privacy>、<https://pen.dev/eula>、<https://pen.dev/terms>
- 文档总览：<https://docs.pen.dev/>
- Getting Started：<https://docs.pen.dev/getting-started/installation>、<https://docs.pen.dev/getting-started/authentication>、<https://docs.pen.dev/getting-started/ai-integration>、<https://docs.pen.dev/getting-started/create-your-first-design>
- Core Concepts：<https://docs.pen.dev/core-concepts/pen-files>、<https://docs.pen.dev/core-concepts/design-as-code>、<https://docs.pen.dev/core-concepts/pencil-interface>、<https://docs.pen.dev/core-concepts/drawing-and-editing>、<https://docs.pen.dev/core-concepts/ai-agents>、<https://docs.pen.dev/core-concepts/variables>、<https://docs.pen.dev/core-concepts/components>、<https://docs.pen.dev/core-concepts/slots>、<https://docs.pen.dev/core-concepts/code-on-canvas>、<https://docs.pen.dev/core-concepts/design-libraries>、<https://docs.pen.dev/core-concepts/build-a-design-system>、<https://docs.pen.dev/core-concepts/import-and-export>、<https://docs.pen.dev/core-concepts/sharing>、<https://docs.pen.dev/core-concepts/presentations>、<https://docs.pen.dev/core-concepts/keyboard-shortcuts>
- Design and Code：<https://docs.pen.dev/design-and-code/design-to-code>
- For Developers：<https://docs.pen.dev/for-developers/the-pen-format>、<https://docs.pen.dev/for-developers/pen-cli>
- Troubleshooting：<https://docs.pen.dev/troubleshooting>
- 开源对标：<https://github.com/penpot/penpot>、<https://penpot.app/>、<https://github.com/tldraw/tldraw>、<https://tldraw.dev/>、<https://github.com/excalidraw/excalidraw>、<https://excalidraw.com/>
