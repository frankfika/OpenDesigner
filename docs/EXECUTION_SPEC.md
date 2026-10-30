# OpenDesigner 执行手册（移交版）

> **⚠️ 已作废（2026-10-31）**：v2 自研画布方案因 OpenPencil 竞品核查而废止，见 docs/competitive-review.md 与 PLAN.md v3。本文件仅留档，勿据此施工。

> 本文件是唯一执行依据。执行者（AI）必须严格按本文件的契约、命令和验收标准施工，不得自行替换技术方案、增删功能、或"优化"流程。
> 战略背景见根目录 `PLAN.md`；本文件与之冲突时，**以本文件为准**。
> 版本：v1 · 2026-10-31

---

## 0. 执行总则（先读，必须遵守）

### 0.1 铁律

1. 本文件没写的东西**不做**。发现缺失 → 在任务报告里记录 `BLOCKER: <描述>` 并停下，不要自由发挥。
2. 每个任务（T 编号）完成后**必须**运行该任务的「验收」命令，把真实输出贴进报告。不许写"应该通过了"。
3. 任何验收 FAIL → 修复后**重跑该任务验收 + 之前全部验收**（回归），全绿才准进入下一任务。
4. 禁止 `git push`、禁止改 `~/.opendesigner/` 之外的系统路径、禁止安装本文件未列出的依赖。
5. 代码注释默认不写；变量函数用英文；UI 文案用中文。

### 0.2 多 agent 分工（强制）

主 agent（编排者）**不亲自写大段代码**，职责只有：拆任务、派工、收报告、合并、触发核验。

| Agent | 职责 | 什么时候派 |
|---|---|---|
| **implementer**（实现 agent） | 按任务书写代码 | 每个 T 任务一个实例；任务书 = 本文件对应 T 章节全文复制 + 仓库当前状态摘要 |
| **verifier**（核验 agent） | 全新上下文，只读+跑命令，逐项核对验收清单，回 PASS/FAIL 表格 | **每个 Phase 结束必须派一个**；主 agent 不得自证 |
| **scout**（侦察 agent，只读） | 查资料、读代码、回答"X 在哪" | 需要时 |

并行规则：
- 契约先行：§3（Schema）、§4（API）、§5（MCP 工具）的契约文件必须先落地，之后前端/后端/MCP 三类实现任务**可以并行**派给不同 implementer。
- 同一文件永远只有一个 agent 在写。任务书里必须列出该 agent 允许触碰的文件清单。
- verifier 必须是**新开的** agent，不能是写代码的那个。

### 0.3 核验协议（认真核验的落地方式）

1. **任务级**：验收命令真实运行，输出贴报告。
2. **Phase 级**：verifier agent 拿到该 Phase 的「验收清单」，逐项执行，输出表格：
   `| 检查项 | 结果 | 证据（命令输出摘要） |`
   任何一项 FAIL → Phase 不通过，主 agent 派 implementer 修复后 verifier 全量重跑。
3. **终验**：`bash scripts/e2e.sh` 全绿（该脚本在 T9 创建，覆盖 Phase 1-4 全部验收点）。
4. 所有验收证据汇总进 `docs/verification-report.md`，每项一行：检查项、PASS/FAIL、日期、证据摘要。

### 0.4 素材生成

需要图片素材（logo、空态插图）时，用本机 CLI：
`mmx image generate --prompt "<英文提示词>" --out <路径>`
不许用占位外链图（如 placehold.co）。

---

## 1. 产品定义（一句话）

本地优先的 AI 设计画布：浏览器打开 localhost 编辑器，设计存为 Git 友好的 `.od.json`，本地 Agent（Claude Code 等）通过 MCP 读写画布，可导出 PNG 和 HTML。

## 2. 环境与技术栈（不许替换）

| 项 | 选定 | 说明 |
|---|---|---|
| Node | ≥ 20 | `node -v` 确认 |
| 包管理 | npm（不用 pnpm/yarn） | 单 package.json，不用 workspaces |
| 前端 | Vite 5 + React 18 + TypeScript strict | |
| 画布 | konva@^9 + react-konva@^18 | 不许换 PixiJS/Fabric |
| Schema 校验 | zod@^3 | 前后端/MCP 共用同一份 |
| 后端 | hono@^4（Node adapter） | 只监听 127.0.0.1 |
| MCP | @modelcontextprotocol/sdk | stdio 传输 |
| ID 生成 | nanoid@^5 | |
| 运行器 | tsx@^4 | server 与 mcp 的开发运行 |
| 测试 | vitest@^2 | 只测 schema 和 ops 纯函数 |

端口约定（写死，不许改）：后端 `127.0.0.1:7788`；Vite dev `5173`（代理 `/api` → 7788）。

## 3. 仓库结构（最终形态，Phase 1 末应已成型）

```
opendesigner/
  package.json
  tsconfig.json
  README.md
  PLAN.md
  docs/
    EXECUTION_SPEC.md        # 本文件
    verification-report.md   # T10 创建并持续追加
  shared/                    # 前后端、MCP 三方共用的契约
    schema.ts                # zod 定义 + TS 类型（T1）
    ops.ts                   # apply_ops 纯函数（T2）
    constants.ts             # 端口、版本号等
  server/                    # 本地后端
    index.ts                 # hono app 入口（T3）
    store.ts                 # .od.json 文件读写
    config.ts                # ~/.opendesigner 凭据读写
    exportHtml.ts            # HTML 导出（T7）
  mcp/
    server.ts                # MCP stdio server（T5）
  web/                       # Vite 根目录
    index.html
    vite.config.ts
    src/
      main.tsx
      App.tsx
      api.ts                 # 调后端的 fetch 封装
      canvas/CanvasStage.tsx # Konva 舞台（T4）
      canvas/nodeRenderer.tsx
      panels/LayerTree.tsx
      panels/Inspector.tsx
      panels/ChatPanel.tsx   # BYOK 对话（T8）
  designs/                   # 用户设计文件 *.od.json（gitignore 除 .gitkeep）
  scripts/
    e2e.sh                   # 终验脚本（T9）
  test/
    schema.test.ts
    ops.test.ts
```

`~/.opendesigner/config.json`（用户机，0600 权限）：
```json
{ "provider": "anthropic", "apiKey": "sk-...", "model": "claude-sonnet-4-5" }
```

## 4. 契约一：文档 Schema（T1 的精确规格）

文件 `shared/schema.ts`，用 zod 定义并导出对应 TS 类型。规则：

- Document：`{ version: "0.1", id: string, name: string, children: Node[], revision: number }`
- 所有节点共有字段：`id`(nanoid), `type`, `name`, `x`, `y`, `width`, `height`, `visible`(默认 true), `locked`(默认 false)
- 样式字段（所有图形节点可有）：`fills: Fill[]`、`strokes: Stroke[]`、`opacity`(0-1，默认 1)、`cornerRadius`(number，默认 0)
  - `Fill = { type:"color", color:string } | { type:"linearGradient", from:string, to:string, angle:number }`
  - `Stroke = { color:string, width:number }`
- 节点类型（**只有这 5 种**，多一种都是违规）：
  - `frame`：容器。额外字段：`children: Node[]`、`layout: "none"|"vertical"|"horizontal"`(默认 none)、`gap`(默认 0)、`padding`(默认 0)、`align: "start"|"center"|"end"`(默认 start)、`reusable: boolean`(默认 false)
  - `group`：仅分组。额外字段：`children: Node[]`
  - `rect`：无额外字段
  - `ellipse`：无额外字段
  - `text`：额外字段：`text: string`、`fontSize`(默认 16)、`fontFamily`(默认 "system-ui")、`fontWeight`(默认 400)、`color`(默认 "#141414")、`align: "left"|"center"|"right"`
- 坐标系：所有 x/y 相对父节点；根 children 相对画布原点。v1 不做约束/吸附规则。
- 布局语义（仅 frame）：`layout != none` 时，渲染与导出都把 children 按流式排（vertical=纵排，gap 间距，padding 内边距，align=交叉轴对齐）；children 的 x/y 被忽略。
- 导出函数：`parseDocument(json: unknown): Document`（zod 解析，失败抛错）、`createDocument(name): Document`（revision=0）。

## 5. 契约二：Ops（T2 的精确规格）

文件 `shared/ops.ts`，纯函数，无副作用，必须能被 vitest 直接测。

```ts
type Op =
  | { op: "add"; parentId: string | null; node: Node }      // null = 根
  | { op: "update"; id: string; patch: Partial<Node> }      // 浅合并，不许改 id/type
  | { op: "remove"; id: string }                            // 连带子树删除
  | { op: "move"; id: string; parentId: string | null; index: number }

applyOps(doc: Document, ops: Op[]): Document
```

- 原子性：任一 op 非法（id 不存在 / parentId 不存在 / patch 含 id 或 type / move 造成环）→ 整个 `applyOps` 抛 `OpsError`，文档不变。
- 成功返回新文档（不可变更新），`revision + 1`。
- `OpsError extends Error`，带 `opIndex: number` 字段。

## 6. 契约三：后端 API（T3 的精确规格）

Hono，只绑 `127.0.0.1:7788`，所有路由前缀 `/api`。JSON 进出。错误统一 `{ error: string }` + 合适状态码。

| 方法+路径 | 请求体 | 响应 |
|---|---|---|
| `GET /api/designs` | — | `{ files: { name: string, mtime: string }[] }`（列 `designs/*.od.json`） |
| `POST /api/designs` | `{ name: string }` | Document（新建落盘） |
| `GET /api/designs/:name` | — | Document |
| `PUT /api/designs/:name` | Document | `{ ok: true }`（zod 校验后覆写） |
| `POST /api/designs/:name/ops` | `{ ops: Op[], baseRevision: number }` | 新 Document；revision 不匹配 → 409 `{ error, current: Document }` |
| `GET /api/designs/:name/export.png` | — | image/png（T7 前可 501） |
| `GET /api/designs/:name/export.html` | — | text/html（T7 前可 501） |
| `GET /api/config` | — | `{ configured: boolean, provider?, model? }`（**永不返回 apiKey**） |
| `PUT /api/config` | `{ provider, apiKey, model }` | `{ ok: true }`（写 ~/.opendesigner/config.json，chmod 600） |
| `POST /api/chat` | `{ name: string, message: string }` | `{ reply: string, ops: Op[] }`（T8 实现，之前 501） |

`name` 必须 sanitize：`/^[a-zA-Z0-9_-]{1,64}\.od\.json$/`，否则 400。防路径穿越是安全红线。

## 7. 契约四：MCP 工具（T5 的精确规格）

`mcp/server.ts`，stdio，server 名 `opendesigner`。三个工具（内部就是调 §6 的 HTTP API，baseURL `http://127.0.0.1:7788`）：

1. `get_state` — 入参 `{ name: string }` → 返回文档 JSON 文本。
2. `apply_ops` — 入参 `{ name: string, ops: Op[] }` → 自动先 get_state 取 revision 再提交；409 时重取重试一次，仍失败则返回错误文本。返回新 revision。
3. `export` — 入参 `{ name: string, format: "png"|"html", outPath: string }` → 调导出接口写文件，返回 `outPath`。

同目录产出 `mcp/SKILL.md`：教 Agent 画布概念（5 种节点、坐标、layout）、典型 ops 序列（画卡片=add frame+add rect+add text）、坐标估算建议（自上而下布局，间距 16 的倍数）。

## 8. 前端交互规格（T4 的精确规格）

布局：左栏图层树（240px）｜中间画布｜右栏属性面板（280px）｜顶栏（文件名、保存状态、导出按钮、对话开关）。

画布（Konva）：
- 无限感：舞台可拖拽平移（空白处拖）+ 滚轮缩放（0.1x–4x，以鼠标为中心）。
- 单击选中；Shift+单击多选；拖动移动（写回 x/y，frame 有 layout 时禁止拖其子节点）；选中框 8 向 resize（rect/ellipse/text/frame）。
- 工具栏：选择(V)、frame(F)、rect(R)、ellipse(O)、text(T)。绘制=点击或拖拽。
- 双击 text 节点进入编辑（contenteditable 覆盖层或 prompt 均可，选简单的）。

图层树：树形展示，点击选中，双击改名，拖拽调层级（调 `move` op）。

属性面板：按选中节点类型显示共有字段 + 类型专属字段（§4 列举的），修改即存（debounce 500ms 提交 `update` op）。

状态流：前端所有变更**必须**走 `POST .../ops`（与 MCP 同一条路径），不允许前端直接 PUT 整个文档（防两条写路径漂移）。加载用 `GET`，之后所有写都用 ops + baseRevision。

自动保存：ops 即保存（后端落盘），顶栏显示"已保存 / 保存中… / 保存失败"。

## 9. 导出规格（T7 的精确规格）

- **PNG**：`server/exportHtml.ts` 不管 PNG；PNG 由前端 Konva `stage.toDataURL()` 生成后 `POST /api/designs/:name/png`（允许 T7 时给后端加这个路由，body 为 dataURL，后端解码落盘）。MCP export png 走同一文件。
- **HTML**：`server/exportHtml.ts` 纯函数 `docToHtml(doc): string`。单文件、无外部依赖、内联 `<style>`。规则：
  - 每个节点一个绝对定位 div（`position:absolute; left/top/width/height`）；
  - frame `layout=vertical` → `display:flex;flex-direction:column;gap;padding`，此时子 div 用 `position:static`；
  - text → 对应 font 样式；ellipse → `border-radius:50%`；cornerRadius → `border-radius`；
  - fills[0] 生效（color→background，linearGradient→`linear-gradient(angle, from, to)`），strokes[0]→`border`；
  - 验收只看视觉还原，不追求 class 语义化。Tailwind 不做（降级说明：v1 输出内联样式即可）。

## 10. BYOK 对话（T8 的精确规格）

- 设置入口：属性面板顶部"API 设置"，填 provider（anthropic/openai 兼容）、apiKey、model → `PUT /api/config`。
- `POST /api/chat`：后端读凭据 → 把「系统提示 + 当前文档 JSON + 用户消息」发给模型 → 要求模型返回 JSON `{ reply: string, ops: Op[] }` → 服务端用 zod 校验 ops → 不落库，直接返回给前端 → 前端确认后走正常 ops 提交通道（§8 状态流）。
- provider=anthropic 用 `https://api.anthropic.com/v1/messages`（header `x-api-key`、`anthropic-version: 2023-06-01`）；openai 兼容用 `{baseURL}/chat/completions`。都不许引 SDK，裸 fetch。
- 系统提示词要点（写死在 server/chat.ts）：你是画布助手；只允许输出 JSON；节点类型只有 5 种；坐标估算规范；ops 必须能通过 zod。

## 11. 任务分解（T 编号，按序执行；标注 [可并行] 的才准并行）

> 每个任务派工时的任务书 = 本节对应全文 + 「允许触碰的文件」+ 「验收」原文。

### Phase 1 — 地基

**T1 契约：schema**
- 文件：`shared/schema.ts`、`shared/constants.ts`、`test/schema.test.ts`
- 内容：§4 全部 + `createDocument`/`parseDocument`；测试覆盖：合法文档通过、缺 version 报错、未知节点类型报错、layout 默认值。
- 验收：`npx vitest run test/schema.test.ts` 全绿；`npx tsc --noEmit` 无错。

**T2 契约：ops**
- 文件：`shared/ops.ts`、`test/ops.test.ts`
- 内容：§5 全部；测试：add/update/remove/move 各正例 + 每类非法 op 的原子性（文档不变）+ 防环。
- 验收：`npx vitest run test/ops.test.ts` 全绿。

**T3 后端**
- 文件：`server/*.ts`（exportHtml/chat 可留 501 桩）、`package.json` scripts
- scripts 约定：`"dev:server": "tsx watch server/index.ts"`、`"dev:web": "vite web"`、`"dev": "同时起两个（用 npm-run-all 或两个终端，README 写清楚）"`
- 验收（逐条 curl，输出贴报告）：
  - `curl 127.0.0.1:7788/api/designs` → 200 `{"files":[]}`
  - POST 新建 → GET 拿回一致
  - `POST .../ops` baseRevision 错误 → 409
  - name 用 `../etc` → 400
  - `GET /api/config` 响应体里**不含** apiKey 字段

**T4 前端编辑器** [T1 完成后可与 T3 并行]
- 文件：`web/**`
- 内容：§8 全部。
- 验收（verifier 用 Playwright/手动逐条）：
  1. 打开 `localhost:5173`，新建设计，画 frame+rect+text，刷新后还在
  2. 拖拽/缩放/改属性生效，顶栏状态流转正常
  3. frame 设 layout=vertical 后子节点流式排列
  4. 图层树拖拽排序后画布同步

### Phase 2 — MCP

**T5 MCP server**
- 文件：`mcp/server.ts`、`mcp/SKILL.md`
- 内容：§7 全部。
- 验收：`echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | npx tsx mcp/server.ts`（或等价初始化握手）能列出 3 个工具；用 MCP inspector 或 Claude Code 配置后实测"画一个 300×200 蓝底卡片"成功。
- Claude Code 接入命令写进 README：`claude mcp add opendesigner -- npx tsx <abs path>/mcp/server.ts`

### Phase 3 — 组件与导出

**T6 组件 v1**
- schema 变化：`frame.reusable` 已有；新增节点类型 `ref`？——**不许**。v1 组件 = reusable frame 的**复制引用**：新增 op `{ op:"instance", sourceId, parentId, x, y }`（T6 时加进 ops.ts），生成深拷贝并在拷贝根节点记 `instanceOf: sourceId`；`update` 打到 source 节点时，后端把 patch 同步到所有 `instanceOf` 它的副本（样式字段同步，x/y/width/height 不同步）。
- 验收：vitest 覆盖 instance 同步逻辑；UI 上改源组件填充色，两个实例同步变色。

**T7 导出**
- 文件：`server/exportHtml.ts`、前端 PNG 导出、`/api/designs/:name/png` 路由
- 内容：§9 全部。
- 验收：画一个含 vertical layout frame + text + ellipse 的文档 → `export.html` 浏览器打开，与编辑器截图视觉比对（verifier 用 `mmx vision describe --image <截图>` 分别描述两份截图，布局/文字/颜色一致即 PASS）；PNG 文件非空且尺寸正确。

### Phase 4 — Agent 环

**T8 BYOK 对话**
- 文件：`server/chat.ts`、`web/src/panels/ChatPanel.tsx`、`/api/chat` 实现
- 内容：§10 全部。
- 验收：配置测试 key 后，对话"加一个写着'你好'的文本节点"→ 画布出现该节点；`GET /api/config` 仍不泄露 key；无 key 时返回明确错误提示。

**T9 终验脚本**
- 文件：`scripts/e2e.sh`
- 内容：顺序执行：vitest 全部 → tsc → curl 冒烟（T3 全部 curl）→ 构建 `vite build` 成功。任一失败非零退出。
- 验收：`bash scripts/e2e.sh; echo $?` 输出 0。

**T10 报告**
- 文件：`docs/verification-report.md`
- 内容：汇总所有 Phase verifier 的 PASS 表格（由主 agent 从各 verifier 报告整理）。

## 12. 多 agent 派工总表

| 顺序 | 动作 |
|---|---|
| 1 | 主 agent：初始化仓库（npm init、装 §2 依赖、tsconfig strict、git init） |
| 2 | 派 implementer-A：T1；implementer-B：T2（不同文件，可并行） |
| 3 | 派 implementer-C：T3；implementer-D：T4（可并行） |
| 4 | 派 **verifier-1**：Phase 1 验收清单（T1-T4 全部验收项）全量跑 |
| 5 | 派 implementer-E：T5 → 派 **verifier-2**：Phase 2 |
| 6 | 派 implementer-F：T6+T7 → 派 **verifier-3**：Phase 3 |
| 7 | 派 implementer-G：T8 → 派 **verifier-4**：Phase 4 |
| 8 | 派 implementer-H：T9；主 agent 跑终验；派 implementer-I：T10 |
| 9 | 主 agent 汇总报告交付 |

每个 verifier 的提示词模板：
```
你是独立核验员，没参与开发。仓库：<path>。
逐项执行以下验收清单，每项给出 PASS/FAIL 和真实命令输出证据，不许推断、不许留情。
发现 FAIL 时不许修代码，只报告。
清单：<粘贴对应 T 任务的「验收」全文>
```

## 13. 范围红线（防蔓延）

出现以下任何"顺便做一下"的冲动 → 记进 `docs/later.md` 然后继续做原任务：
- 更多节点类型（path/polygon/icon/image）
- 变量/主题、slots、多层嵌套覆盖
- 多人协作、云同步、账号
- Tailwind 类名导出、React 组件导出
- 撤销重做（v1 没有，靠 Git）
- Tauri 桌面壳
