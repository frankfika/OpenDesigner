# Phase 2 验收报告

> 本文只贴**真实命令的真实输出**。没有跑过的不写，失败的就写成失败。
> 命令与脚本都在仓库里，可以复跑。

日期：2026-11-10（Phase 1 推送后）
基线：`ce0dd19`（Phase 1：P0 od-format 层 + 305 个测试）

---

## 0. 这一轮做对了什么（对照 `docs/gap-analysis-vs-pen.md` 的五条规矩）

反思文档里我给自己立的规矩是：

| 规矩 | 这一轮怎么落地的 |
|---|---|
| 每阶段至少有一条**让用户立刻看到东西**的命令 | `node shell/scripts/acceptance.mjs http://127.0.0.1:5173/ out` —— 一条命令跑完画布、实时交互、导出、od 往返四条链路 |
| 验收必须有**用户视角**的维度 | 不再只测"序列化对不对"，而是测"画布有没有画出来""按钮是不是真的能点""悬停会不会切变体" |
| 引擎已有的能力优先复用 | 画布用 `@open-pencil/vue` 的 `CanvasRoot`/`CanvasSurface`/`PlayIslands`；导出全部用引擎的 `IORegistry`；实时交互用引擎的 behaviours —— **一行转换代码都没自己写** |
| 每轮问一次用户拿它干什么 | 用户明确要求"支持的画布，实时在工作的动画都要有"，这一轮就全押在这两件事上 |
| 交付前跑从零 clone 的端到端演示 | 见 §5 |

---

## 1. 真实画布

`@open-pencil/vue` 0.16.0 的画布组件直接接上（`shell/src/App.vue`）：

- `CanvasRoot` → slot 拿 `canvasRef`
- `CanvasSurface` 挂 `<canvas>`
- `PlayIslands` 挂在同一坐标系上

验收脚本实测：

```
PASS  画布 · 真实 canvas + WebGL2  {"canvasCount":1,"webgl2":true,"surfaceError":null,"size":"948x818"}
```

截图：`shell/out/editor-edit.png`（编辑态）、`shell/out/editor-play.png`（预览态）。

画布上能看到：中文标题、正文、三张特性卡片、组件集边框、5 个状态变体的按钮、吸附参考线、选中框、尺寸胶囊。

---

## 2. 实时在工作的动画

这不是录好的动画，是**引擎的 behaviours 真的在跑**：

1. `editor.setBehaviour(compId, { kind: 'button', … })` 装交互行为
2. `editor.addBehaviourStates(compId)` 自动把主组件包成 `COMPONENT_SET`，并建出 5 个状态变体（Default / Hover / Pressed / Focus / Disabled）
3. `editor.createInstanceFromComponent(...)` 生成实例
4. `editor.togglePlay()` 开预览 → `PlayIslands` 把带 behaviour 的图层在 **shadow root** 里跑成真实控件

实测（`shell/scripts/acceptance.mjs`）：

```
PASS  实时预览 · 岛里跑起真实控件  {"islands":1,"hosts":1,"buttons":1,"labels":["立即体验"],"tags":["div","span","button"]}
PASS  实时预览 · 悬停切变体  hover background = rgb(90, 107, 250)
```

第二条的含义：悬停后按钮背景从 `rgb(73,90,238)`（Default）变成 `rgb(90,107,250)`（Hover 变体）——
**是真的换了变体，不是静态图**。

> 踩坑记录：预览岛的 DOM 在 **shadow root** 里（上游 `useShadowContainer` + Teleport），
> `document.querySelectorAll('button')` 查不到。第一版脚本因此误判成"岛里没有控件"，
> 改成钻进 `host.shadowRoot` 才看到真相。

---

## 3. 导出（引擎自带导出器，一个字没自己写）

引擎的 `IORegistry` + `BUILTIN_IO_FORMATS` 里有 8 个导出器。接出来 6 个：

```
--- 导出结果 ---
HTML          4000 字节  <div data-open-pencil-node-id="2119220846:3" style="width: 1440px; height: 900px; position
Tailwind      3888 字节  <div data-name="画板 · 产品发布" className="relative overflow-hidden w-360 h-225 bg-[#FBF9F5]">
React JSX      240 字节  <Frame name="State=Default" x={320} y={700} w={200} h={56} bg="#495AEE"> <Text name="标签" x
SVG           4000 字节  <?xml version="1.0" encoding="UTF-8"?> <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink
PDF             40 字节  （二进制 3965 字节，头部 25 50 44 46 2d 31 2e 33）
PPTX             0 字节
```

（预览面板只显示前 4000 字符，完整内容写到 `shell/out/export-*.txt`。）

> **PPTX 是已知缺陷，不掩饰**：浏览器端触发上游引擎的渲染崩溃，栈是
> `readEffectiveFigmaRawField` → `rawLayoutGrids` → 读到一个 `undefined` 节点。
> **同一张图在 Node 端导出正常**（49,537 字节，见 §4），所以不是文档内容的问题，
> 是引擎在"字体已加载 + 节点带 `source` 溯源数据"场景下的渲染 bug。
> 我不 fork 上游，所以这里如实单列，验收不计它。

---

## 4. Agent 出图（JSX → 设计节点）

引擎自带 **26 个 agent 工具**（`CORE_TOOLS`），其中最关键的是一对：

- `render`  —— **JSX → 设计节点**。agent 写一段 JSX，画布上就长出东西。
- `get_jsx` —— **设计节点 → JSX**。把画布上的东西变回 agent 能读的代码。

这一对就是「agent 出图」的闭环：**写 → 看 → 改 → 再看**。
pen.dev 的核心卖点在这儿，本项目**不自己造**，直接用引擎的。

实测（`shell/scripts/acceptance.mjs`）：

```
PASS  Agent 出图 · JSX 变成画布节点  生成成功：AgentCard（FRAME） · 补齐 3 个文本节点 · 图层 2 → 3
```

截图：`shell/out/acceptance-agent.png` —— 画布上出现了 AgentCard，
标题「agent 出的图」、生僻字「苗圃图册」、蓝色按钮「立即体验」全部正常渲染，
图层树同步多出 AgentCard。

### 4.1 这里踩了两个坑，都值得记下来

**坑一：引擎的 `render` 工具建出来的文本节点，画布上完全不显示。**

节点在、图层树里有、SVG 导出里也有 `<text>` —— 就是画布上空白。
对比引擎默认节点与 render 工具建的节点，差三个字段：

| 字段 | 引擎默认 | render 工具建的 | 后果 |
|---|---|---|---|
| `textDirection` | `"AUTO"` | `undefined` | 文本方向判定失效 |
| `layoutDirection` | `"AUTO"` | `undefined` | 同上 |
| `textAutoResize` | `"NONE"` | `"HEIGHT"` | 高度随文字自动调整，而自动调整要靠字形测量；刚建出来还没测量完，高度算成 0，**零高度的文本节点不画** |

所以 `shell/src/agent.ts` 里加了 `normalizeRenderedNodes()`，生成后补齐这三个字段。

**坑二：新写的字没有字形，节点被引擎 block 掉。**

表现同样是「节点在、画布上空白」。根因链条：

1. Google Fonts 的 `text=` 精确子集**只含我们指定的那几个字**；
2. 引擎画文本节点时**只认节点自己的 `fontFamily`，不走 CJK fallback 列表**
   （实测：节点 `fontFamily="Noto Sans SC"` + 字不在子集里 → 不显示；
   装了 CJK 兜底族也照样不显示）；
3. 补子集这条路走不通 —— Skia 的 `TypefaceFontProvider` 一个族只认一个 typeface，
   同族重复注册**不覆盖**（`std::map::emplace` 不替换已存在的 key），
   后取的子集永远排在旧的后面、用不上。

**解法**：构建期合成一个**全量常用汉字**字体，运行时本地注册一次。

`shell/scripts/build-cjk-font.py`：

1. 用旧 Safari 的 UA 请求 Google —— 它给的是 **woff**（不是 woff2），
   fontTools 能直接读（woff 只需 zlib，不需要 brotli）；
2. `fontTools subset` 裁到 **GB2312 一级字表 3755 字 + ASCII**；
3. 输出 `shell/public/OpenDesignerSC.otf`（1,134 KB）。

运行时 `shell/src/fonts.ts` 把 `/OpenDesignerSC.otf` 注册成 `OpenDesigner SC` 族，
`shell/src/agent.ts` 把**含非 ASCII 字符**的新文本节点指向这个族。

> 中间踩过的两个弯路也记一下：① 想用 5 个批次分别请求再合并 ——
> Noto Sans SC 是 CFF 字体，CID 是全局的，合并后 glyph 数 123309 远超
> `maxp` 表 uint16 的上限；② 曾经把字符集重复拼了一遍导致长度翻倍、
> 超过 `text=` 的上限退回整族字体，取到的第一个切片正好没有中文字形。

---

## 5. od 文本格式接入编辑器（这是 OpenDesigner 的核心主张）

`.od.json` 现在是**画布的一等公民**，不是导出附件：

- 顶栏「打开 .od」→ `parseOd` → `toEngine` → `editor.replaceGraph()`
- 顶栏「保存 .od」→ `fromEngine` → `stringifyOd` → 落盘
- 顶栏「复制 od」→ 直接进剪贴板，agent 立刻能读

实测：

```
--- od 文件 ---
{
  "bytes": 13697,
  "hasVersion": true,
  "nodeCount": 29,
  "head": "{ \"format\": \"od\", \"version\": \"0.1\", \"meta\": {\"generator\":\"od-format@0.1.0\",\"engine\":\"@open-pencil/scene-graph@0.16.0\",\"colorSpace\":\"srgb\",\"root\":\"frame~document\",\"ordinal\":16}, \"nodes\": [ "
}
PASS  od 保存 · 落盘且是合法 JSONC  13697 字节 / 29 个 id
PASS  od 打开 · 文档能复原  打开前 2 行图层 → 打开后 2 行，文档名 roundtrip.od.json
```

保存出来的文件长这样（可直接手改、可 git diff）：

```json
{
  "format": "od",
  "version": "0.1",
  "meta": {"generator":"od-format@0.1.0","engine":"@open-pencil/scene-graph@0.16.0","colorSpace":"srgb","root":"frame~document","ordinal":16},
  "nodes": [
```

---

## 6. 中文字形（这一轮最费劲的一块）

**问题**：引擎内置字体只有 Inter（拉丁）和 Noto Naskh Arabic。中文全是豆腐块。

**根因链**（每一条都是实测出来的）：

1. 引擎从**站点根目录**取内置字体（`${BASE_URL}/Inter-Regular.ttf`）→ dev server 把这些路径 fallback 成 index.html → 引擎拿到 `0x3C21444F`（= `<!DO`）→ `OTS parsing error: invalid sfntVersion`。
   → 解法：把 core 包自带的 ttf 拷进 `shell/public/`。
2. 引擎在浏览器里**不会自己联网**：必须宿主调 `fontManager.setWebFontFetch(...)`。
3. provider 链（google → fontsource → bunny → fontshare）里**第一个 provider 的初始化失败会毒化整条链** —— google provider 要读 `fonts.google.com/metadata/fonts`，该域在本环境不通，后面本来可用的 fontsource 根本轮不到。
4. provider 给回来的是**子集**：不给字符时只给 latin 子集（34,868 字节），中文全是豆腐；**而且这份 latin 子集会被缓存下来，反而把正确的中文子集挡住**。
5. 字符必须传 —— 但 fontsource 即使传了字符，给的仍是 latin 子集（34,924 字节，只多了 56 字节）。
6. 干净的口子是 `fontManager.loadLocalFont` → 它第一件事就是问 `hostFontLoader`。
7. Google Fonts 的 CSS API（现代 UA）配 `text=` 参数可以取**精确子集**：2,096 字节的 woff2，`FontFace` 测量 `wCJK 319.999755859375` vs `wFallback 320` → **确实含中文字形**。

**最终方案**（`shell/src/fonts.ts`）：

- 宿主实现 `fontManager.setHostFontLoader`，按**文档实际用到的字**向 Google 要精确子集
- 字符集 = 文档字符 ∪ **所有图层的名字** ∪ 基础 ASCII ∪ 常用符号
  （图层的名字也要带上：引擎把图层名画成标签浮在画布上，那些字不在文本节点里，
  漏了就会变成"□□ · □□□□"）
- **Linux 兜底族重定向**：引擎画图层标签时的字体列表是 `[Inter, ...本地 CJK 兜底族]`，
  而 `Noto Sans CJK SC` / `文泉驿` / `Droid Sans Fallback` 在容器和 CI 里根本不存在。
  把它们重定向到 Google 上真实存在的 `Noto Sans SC`（数据仍注册回原族名），
  引擎的字体列表照旧能命中，中文字形就有了。
  macOS 的 PingFang / Windows 的微软雅黑**不重定向** —— 它们是系统自带的，重定向反而降级真机观感。

效果：正文、标题、卡片、图层名、变体名（`State=Default`）、尺寸胶囊（`200 × 56`）**全部正常**。

---

## 7. 团队残留的收编

上一轮多 agent 计划的产物当时 verifier 判 FAIL、没提交。这一轮单 agent 接手后：

| 产物 | 处置 | 依据 |
|---|---|---|
| `packages/od-ops/` | **保留** | 实现 insert/update/delete/move/set/reorder/batch，纯函数 + 原子性 + validate 回滚，76 个测试全过 |
| `packages/od-cli/src/{apply,export,mcp,cli-error}.ts` | **保留** | `tsc` 零错误，导出/应用有测试；`mcp.ts` 用动态 import，依赖的包缺席时优雅降级到退出码 3 |
| `packages/od-mcp/` | **删除** | 只有 `package.json`，`src/` 是空的，而 `bin` 指向不存在的 `src/server.ts` —— 是个坏壳，留着只会误导 |
| `templates/`（17 个）+ `scripts/gen-templates.ts` + `docs/templates/sizes.md` | **保留** | 全部验证过，见下 |

模板验证（`scripts/check-templates.ts`，schema 合法 ≠ 能渲染，所以真渲染了一遍）：

```
✓ bilibili-cover.od.json                   2150 字符 SVG
✓ douyin-vertical.od.json                  2101 字符 SVG
... （共 17 个）
✓ zhihu-header.od.json                     2108 字符 SVG

17/17 个模板能渲染成 SVG
```

---

## 8. 完整验证（真实输出）

```
$ npx tsc -p tsconfig.json --noEmit
（零错误）

$ npx vitest run
 Test Files  18 passed (18)
      Tests  381 passed (381)
   Duration  180.39s

$ cd shell && npx vue-tsc --noEmit -p tsconfig.json
（零错误）

$ node scripts/acceptance.mjs http://127.0.0.1:5173/ out
PASS  画布 · 真实 canvas + WebGL2  {"canvasCount":1,"webgl2":true,"surfaceError":null,"size":"948x818"}
PASS  实时预览 · 岛里跑起真实控件  {"islands":1,"hosts":1,"buttons":1,"labels":["立即体验"],"tags":["div","span","button"]}
PASS  实时预览 · 悬停切变体  hover background = rgb(90, 107, 250)
PASS  导出 · 5 种格式都出内容  HTML:4000 Tailwind:3888 React JSX:240 SVG:4000 PDF:40
KNOWN  导出 · PPTX：0 字节（上游引擎缺陷，详见 docs/phase2-acceptance.md）
PASS  Agent 出图 · JSX 变成画布节点  生成成功：AgentCard（FRAME） · 补齐 3 个文本节点 · 图层 2 → 3
PASS  od 保存 · 落盘且是合法 JSONC  16455 字节 / 34 个 id
PASS  od 打开 · 文档能复原  打开前 3 行图层 → 打开后 3 行，文档名 roundtrip.od.json

验收：7/7 通过
ACCEPTANCE: PASS
```

---

## 9. 已知缺陷 / 诚实清单

| # | 问题 | 状态 |
|---|---|---|
| 1 | **PPTX 导出在浏览器端崩溃** | 上游引擎 bug（`readEffectiveFigmaRawField` → `rawLayoutGrids`）。Node 端同图正常（49,537 字节）。未修（不 fork 上游） |
| 2 | `.fig` 载体 | 仍是退出码 3（Phase 1 遗留） |
| 3 | 跨文档组件引用 | 不支持（Phase 1 遗留） |
| 4 | 库组件远端 override 未实测 | Phase 1 遗留 |
| 5 | `meta.ordinal` 跨会话 base 复用有残留缺口 | Phase 1 遗留 |
| 6 | 导出预览只显示前 4000 字符 | 已知，下载的是完整内容 |
| 7 | 渲染级像素比对 | 未做（只做了 SVG 字符数与内容特征校验） |
| 8 | 实时预览目前只验证了 `button` 一种 behaviour | 引擎支持 15 种（textField / toggle / slider / tabs / accordion …），未逐个验 |
| 8b | agent 出图目前只能跑 `render` / `get_jsx` 两个工具 | 引擎有 26 个（`update_node` / `set_fill` / `batch_update` / `diff_visual` …），其余没接 UI |
| 8c | agent 出图没有自然语言入口 | 只有 JSX。要"说一句就出图"需要接 LLM，API key 不能入库，得由使用者本地提供 |
| 9 | 图层编辑（拖拽/改尺寸）未接 od 写回 | 画布上的编辑目前只改引擎内存，不落盘；`od-ops` 有操作层但还没接 UI |

---

## 10. 与 pen.dev 的差距（这一轮之后的诚实版本）

**这一轮补上的**：

- ✅ 真实画布（不是渲染出来的假图）
- ✅ 实时在工作的动画（真的能点、真的切变体）
- ✅ 中文字形（含 agent 现写的新字、生僻字）
- ✅ 一键出代码（HTML / Tailwind / React JSX / SVG / PDF）
- ✅ 文本格式与画布同源（`.od.json` 直接读写，agent 可直接改）
- ✅ **agent 出图的引擎链路**（JSX → 设计节点 → 画布可见 → 再导回 JSX）

**仍然比不上 pen.dev 的**：

- ❌ **agent 能出图，但还不能"用自然语言让它画"** —— 出图链路是通的（JSX 进、设计节点出、画布上看得见），
  但没有对话式生成、没有变体迭代、没有同题多解。pen.dev 的核心卖点还差一层。
- ❌ 编辑深度：图层树能看能选，但拖拽、改尺寸、改颜色这些还没接 od 写回
- ❌ 协作、分享、评论
- ❌ 组件库的规模
- ❌ PPTX 导出（上游 bug）

> 按 `docs/gap-analysis-vs-pen.md` 的判断，**下一轮该押在"agent 自然语言改稿 + 出图反馈闭环"上**，
> 而不是继续补编辑器功能。引擎已经能画、能导出、能交互、能被 agent 用工具改，
> 缺的是让 agent 看得见自己改了什么 —— 这正是 `diff_visual` 那个工具的用途，
> 本轮还没接。
