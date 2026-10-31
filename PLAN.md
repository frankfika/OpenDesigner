# OpenDesigner 规划方案

v3 · 2026-10-31 · 基于竞品核查后重构（[docs/competitive-review.md](docs/competitive-review.md)）
~~v2 自研画布方案~~ 已废止——OpenPencil（MIT、9.5k 星）功能全覆盖。v1 执行手册（docs/EXECUTION_SPEC.md）随之作废，新手册待 v3 定稿后重写。

> pen.dev 的完整逆向拆解与功能/架构/格式调研见 [docs/research.md](docs/research.md)：含 `.pen` 格式 schema、渲染层技术信号、MCP/CLI 能力边界、"重"的成因，以及洁净室复刻红线。差异层（文本 JSON 格式）的设计依据在该文 §5.1 与 §6。

## 产品定义

**OpenDesigner — AI 时代内容创作者的开源设计工作台，built on OpenPencil 引擎。**

一句话区分：**OpenPencil 是开源的 Figma 替代（.fig 文件兼容优先）；OpenDesigner 是 Git/Agent 原生 + 中文内容工作流的设计工具（工作流优先）。同一引擎，两种产品哲学。**

## 与 OpenPencil 的区别（开源定位声明，README 用）

| 维度 | OpenPencil（上游，MIT） | OpenDesigner（本项目，MIT） |
|---|---|---|
| 原生格式 | `.fig` 二进制（Kiwi，Figma 兼容优先） | **文本 JSON，Git diff 友好**；agent 可直接读/patch 文件，不必经 MCP；与 .fig/.pen 双向互转 |
| 产品目标 | 替代 Figma，兼容其生态（插件 API、.fig、复制粘贴） | 服务 **AI 工作流 + 中文内容创作**：设计进 repo、agent 协同、一键出稿 |
| 画布外能力 | 通用编辑器 + 100+ 通用工具 | **社媒模板库**（公众号 900×383 / 小红书 1242×1660 / B站 1146×717 / X 1600×900…）+ **一键多尺寸派生** |
| AI 集成 | 通用 BYOK chat（多家 LLM） | **MiniMax 原生**：mmx 生图/语音/视频素材在画布内直接生成并落为设计元素 |
| 界面 | 英文优先，功能全量 | 中文优先，面向出稿场景裁剪的极简 UI（自定义 shell，官方支持路径） |
| 关系 | 上游引擎（`@open-pencil/core` + `@open-pencil/vue`，npm 依赖） | 下游产品，**不 fork**，跟随上游版本 |

不 fork 的理由：上游每天提交，fork 即维护死刑；官方 SDK 的 custom editor shell 就是为此设计的。

## 技术架构（v3）

```
┌─ OpenDesigner Shell（Vue 3 自定义壳，中文 UI）──────────┐
│  模板面板 / 多尺寸派生 / mmx 素材面板 / 极简属性栏         │
├─ @open-pencil/vue + @open-pencil/core（npm 依赖，引擎）──┤
├─ od-format：.od.json ⇄ 引擎文档 双向序列化层（本项目核心）┤
├─ 本地服务：mmx CLI 桥（生图/语音/视频）、凭据（0600）     ─┤
└─ 分发：Web 先行，后上 Tauri（引擎支持）───────────────────┘
```

## 核心资产：.od.json 格式

pen.dev 验证过的洞察，OpenPencil 放弃的领域：
- 文档 = 单个可读 JSON 文本，稳定排序 + 语义化 ID，diff 就是设计变更
- agent 改设计有两条路：MCP（经引擎）**或直接编辑文本**（离线、可脚本化、可 code review）
- `od convert` 命令：`.od.json ⇄ .fig` 双向（借 OpenPencil CLI 的 import/convert 能力）
- 风险：引擎文档模型 → 文本的序列化保真度需实测（v3 Phase 1 的验证重点）

## 阶段计划（v3）

### Phase 0 — SDK 摸底（0.5-1 天）
- 跑通 `@open-pencil/core + @open-pencil/vue` custom shell 官方示例
- 摸清引擎文档模型（scene-graph API），评估文本序列化保真度
- 产出：`docs/sdk-notes.md` + 可运行的最小壳

### Phase 1 — od-format 层（核心资产，2-3 天）
- `.od.json` schema（zod）+ 与引擎文档双向转换
- `od convert` CLI：od.json ⇄ fig
- 验收：复杂设计（组件+自动布局+变量）round-trip 无损

### Phase 2 — 中文工作台 Shell（2-3 天）
- Vue 自定义壳：中文 UI、模板面板、属性栏裁剪
- 社媒模板库 v1（6-8 个尺寸模板）+ 一键多尺寸派生
- 验收：从模板出一张公众号封面，改字导出 < 1 分钟

### Phase 3 — mmx 素材面板（1-2 天）
- 画布内调 mmx image/voice/video，结果直接插入为设计元素
- 凭据存本地（0600），复用 mmx CLI 已有配置
- 验收：画布内一句话生成配图并排版进模板

### Phase 4 — 开源发布（1 天）
- README（中英）含「与 OpenPencil 的区别」一节、MIT license、demo 视频（mmx 生成）
- 发布到 GitHub，回馈上游（发现 bug 提 PR）

## 分工策略（省 K3 token，沿用）

调研/检索 → `mmx search`；截图分析 → `mmx vision`；素材 → `mmx image/video/voice/music`；找代码 → code-scout；补测试 → test-writer。主线程只做架构与核心转换层。

## 风险

1. **SDK 依赖风险**：`@open-pencil/vue` 是 development 版本，API 可能变 → package.json 锁版本，升级手动
2. **文本序列化保真度**：引擎模型可能有文本难表达的状态（CanvasKit 特效）→ Phase 1 验收红线，不达标则 .od.json 降级为"主要状态文本 + 引擎 blob 附件"混合格式
3. **上游 .pen 读取能力重叠**：若上游后续原生支持文本写格式，本项目的差异收缩到模板/中文/mmx——可接受，引擎活让别人干
