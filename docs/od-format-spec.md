# od-format v0.1 规格

> **文档类型**：格式设计说明书（implementation-ready spec）
> **版本**：v0.1（2026-11-10）
> **状态**：定稿，可直接指导 `packages/od-format` 实现
> **上游依据**：`docs/sdk-notes.md` §3（154 字段全表，机器生成、已核实）、§4（文本序列化可行性 + 4 个坑）、`docs/research.md` §3.2/§5.1/§7、**`docs/engine-semantics.md`（引擎语义层实测，本文已采信，见 §0.7）**
> **洁净室声明**：本格式为独立设计。竞品 `.pen` 的**设计思路**（id+type 判别、子集化布局、变量以 `$` 前缀绑定）可借鉴；本文件的**字段名、结构、取值域一律自定**，未引用其 schema 的任何字段名或结构（`docs/research.md` §7 红线）。

---

## 0. 总则

### 0.1 一句话

**od 格式是引擎文档模型（`SceneGraph` / `SceneNode`）的无损、可读、git-diff 友好的文本投影**；它不是新场景模型，是**投影层**——引擎模型是唯一的真相源，od 格式是它的一一映射 + 人类可读的重排。

### 0.2 三条不可协商的约束

下面三条按优先级排序。任何设计冲突都按这个顺序裁决。

| # | 约束 | 含义 | 违反后果 |
| --- | --- | --- | --- |
| **C1** | **往返无损** | `toEngine(fromEngine(g))` 必须逐字段还原 `g`（派生字段除外，见 §3.1） | 组件/自动布局/变量三类命门直接塌，Phase 1 验收不通过 |
| **C2** | **diff 友好** | 只改一个属性，文件里只应出现一处改动；同一份设计保存两次，文件应逐字节相同 | agent 无法可靠 patch，人无法 review |
| **C3** | **agent 可直接读写** | 文本里出现的每个 id 都能被 agent 读懂并复述；没有需要外部查表才能解释的引用 | 「agent 直接编辑文本」的产品叙事落空 |

### 0.3 目标 / 非目标

**目标**

1. 引擎文档 → od 文本 → 引擎文档，**无损**（C1）。
2. od 文本可被人读、可被 agent 改、可进 git（C2、C3）。
3. 格式**版本化 + 有迁移器**，旧文件永远能打开（§5）。
4. 公开 JSON Schema，工具链可校验（§7）。

**非目标**

1. 不做新的场景模型。od 没有引擎没有的概念，引擎没有的 od 也不臆造。
2. 不做 `.fig` 二进制的替代品（`.fig` 兼容是上游的事）。
3. v0.1 不做协作/合并（CRDT）、不做增量补丁格式。
4. v0.1 不保留用户写在文件里的注释（见 §6.1 的显式取舍）。

### 0.4 命名与排版约定（本文自身）

| 记号 | 含义 |
| --- | --- |
| `odId` | 本格式的语义 ID，语法见 §2.2 |
| `engineId` | 引擎内部 ID，格式 `${随机会话号}:${计数器}`，例如 `48213:57` |
| `od 字段路径` | 点分路径，例如 `layout.padding.top`、`text.font.size` |
| `MUST / MUST NOT / SHOULD / MAY` | 规范强度；`MUST` 未满足即实现不合规 |

### 0.5 上游事实核对表（本规格赖以成立的事实）

以下事实均已在 `@open-pencil/scene-graph@0.16.0` 的源码中逐条核实（本机实查，非转述）：

| 事实 | 证据 |
| --- | --- |
| `SceneNode` 恰有 154 个字段 | `node_modules/@open-pencil/scene-graph/dist/types.d.ts`，脚本解析接口块得 154，与 `docs/sdk-notes.md` §3.1 逐字段一致 |
| `SceneGraph` 有 12 个文档层字段 | `scene-graph/src/index.ts:186-209`（`nodes` / `images` / `variables` / `variableCollections` / `activeMode` / `rootId` / `figKiwiVersion` / `figSchemaDeflated` / `documentColorSpace` / `enabledLibraries` / `positionPreviewVersion` / `instanceIndex`） |
| 引擎 ID = `${session}:${counter}`，session 每进程随机 | `scene-graph/src/index.ts:169-171`、`setIdSession` 在 `:160` |
| 引擎**不解析** node id | `scene-graph` 全源码扫描：`split(':')` 只出现在 `icons/model.ts:18`（图标名）；`core` 全 dist 扫描：只在 `dist/tools/ai-adapter.js:217` 出现（工具 key）。**没有任何地方把 node id 当 `${session}:${local}` 解析** |
| `createNodeWithId(id, type, parentId, overrides)` 接受任意字符串 | `scene-graph/src/index.ts:537-551` |
| 实例会**实体化**子节点（真实节点进 `graph.nodes`） | `scene-graph/src/instances.ts:63` → `cloneChildrenWithMapping`（`instances/sync.ts:188`） |
| **普通**拷贝子节点 ↔ 主组件子节点的对应关系，记录在拷贝节点**自己的 `componentId` 字段** | 拷贝时 `cloneChildInCoordinates()` 调 `cloneNodeProps(src, src.id, mode)`，即拷贝的 `componentId` = 源子节点 id（`instances/sync.ts:173-186`）；同步时 `linkMatchedChild()` 对**非嵌套实例**写 `instChild.componentId = compChildId`（`sync.ts:349-356`） |
| **嵌套实例**拷贝子节点 ↔ 主组件子节点的对应关系，记录在 `instanceOverrides.descendants[cloneId].sourceComponentId` | `instances/sync.ts:354` `setInstanceOverride(overrides, instParentId, instChild.id, 'sourceComponentId', compChildId)`——**只有当克隆子节点本身是一个 INSTANCE 时才走这条**；`instance-overrides.ts:92-121` 确认 `descendants` 的键是**实例侧的克隆节点 id** |
| `componentPropertyAssignments` 按**属性 id** 索引，`componentPropertyValues` 按**属性名**索引 | `components/properties.ts:203`（`propertyId in node.componentPropertyAssignments`）vs `components/variants.ts:30`（`componentPropertyValues[property.name]`） |
| 共享样式的 id 派生自 `node.source.id`（非 engine node id），跨会话稳定 | `scene-graph/src/shared-styles.ts:41-50` |
| 图片 hash = 内容的 sha1 hex，天然稳定 | `scene-graph/src/images.ts:9-11` `computeImageHash` |
| 变量绑定字段路径是固定白名单，不接受任意字段名 | `scene-graph/src/variables/fields.ts` `NUMERIC_FIELDS` / `STRING_BINDING_FIELDS` / `BOOLEAN_BINDING_FIELDS` |
| `Color` = `{r,g,b,a}` 四个必填浮点（0..1） | `scene-graph/src/primitives.ts:7-12` |

> ✅ **`docs/engine-semantics.md` 已产出**（另一 worker，2026-11-10）。本文**已采信**它的实测结论，并据此修正了三处初稿设计（见 §0.7）。剩余未确认项汇总在 §10。
>
> **另**：`@open-pencil/core@0.16.0` 已被装进 `node_modules`，本文据此**直接核实**了 core 侧的关键行为（§0.6）。

### 0.6 core 侧已核实事实（`@open-pencil/core@0.16.0`）

| 事实 | 证据 |
| --- | --- |
| **自动布局会把子节点的 `x`/`y`/`width`/`height` 写回 `SceneNode`** | `core/dist/layout/apply.js:17-38` `writeLayoutGeometry()` → `graph.updateNode(id, {x,y,width,height})`；`:105-116` `updateChildFromYoga()` |
| **`layoutPositioning === 'ABSOLUTE'` 的子节点完全不参与写回** | `core/dist/layout/apply.js:126` `if (!child.visible || child.layoutPositioning === "ABSOLUTE") return;` |
| **HUG 尺寸由布局写回** | `core/dist/layout/apply.js:97-99` `if (frame.primaryAxisSizing === "HUG") updates[primary] = derived?.[primary] ?? computed(primary)` |
| **`.fig` 导出对非 GUID 形态的 id 是容忍的** | `core/dist/io/formats/fig/variable-export.js:13` `if (keepsGuid(id) && /^\d+:\d+$/.test(id) && ...)` 否则**兜底新铸** `{sessionID:0, localID:counter++}`；`fig/export-setup.js:36` `ownGuid()` 对非 GUID id 返回 `null` |
| **`source.id` 必须是 GUID 形态才有意义** | `core/dist/io/formats/fig/export-setup.js:43` `savedFromFile()` → `parseGuidOrNull(node.source.id) !== null` |
| **Yoga 是 grid 分支，CSS Grid 受支持** | `core/package.json:49` `"yoga-layout": "npm:@open-pencil/yoga-layout@3.3.0-grid.3"`；`core/dist/layout/grid.js:6-14` `setDisplay(Display.Grid)` / `setGridTemplateColumns` |
| **core 的 blob→SVG path 默认只保留 2 位小数（有损）** | `core/dist/io/formats/svg/paths.js:18` `geometryBlobToSVGPath(blob, decimals = 2)` |

### 0.7 本文采信 `docs/engine-semantics.md` 的修正清单

本文初稿写完后，`docs/engine-semantics.md` 产出。**凡与它冲突之处，一律以它为准**，本文已按下表修正：

| # | 初稿设计 | engine-semantics 的实测结论 | 本文修正 |
| --- | --- | --- | --- |
| **1** | `variableBindingScales` / `variableAssignmentScales` 当作派生缓存**剔除**（沿用 `sdk-notes.md` §4.3 坑 2） | **没有加载期重算入口**，且直接参与绑定解算（`bindings.ts:51-52`）；引擎自己的 .fig round-trip **保留**它们（`transfer.ts:85-86`） | §3.1.4 改判为 **D2 必留**；§3.2 映射到 `bindings.scales` / `bindings.assignmentScales`；§4.3 的 H2 |
| **2** | `textPicture` 按二进制 **base64 内联**（沿用 `sdk-notes.md` §3 的 C 类分类） | 它是**缓存**不是资产（Skia 段落快照，`text/picture.ts:6-9`） | §3.1.4 改判为 **D1 剔除**，不进 base64、不进 `assets/` |
| **3** | 实例的**拷贝子节点不写入** od 文件（省体积）；override 的键用「主组件子节点的 odId」 | **P2：主组件树与实例拷贝树必须一起存**，否则 override 悬空 | §4.1 决策 I-1 反转为**照存拷贝树**；override 的键改为**拷贝子节点自己的 odId**（恒等）；加载因此**不需要 core** |
| **4** | 几何按 G1/G2 **省略**派生量 | 布局重算**不保证逐位相同**，且 od-format 不跑布局趟 | §3.1.2 改为**几何一律照存**（规则 G） |
| **5** | （未涉及） | `createNodeWithId` **不查重**；构造器已消耗 2 个 id；id 生成器必须单调 | §2.7 / §4.1.4 写入三条硬约束 |

> **本文与 engine-semantics 的一致性**：§4 的三类硬骨头结论**完全一致**——组件「有条件可行」、自动布局「意图无损」、变量「可行但有坑」。差异只在**实现路径**（照存 vs 省略），本文按 engine-semantics 的前提逐条落实。

---

## 1. od 文档顶层结构

### 1.1 顶层键总表（规范顺序）

od 文档是一个 JSONC 对象。**顶层键必须按下列顺序出现**，且**不允许出现表外顶层键**：

| 顺序 | 键 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| 1 | `format` | `"od"` | 是 | 格式标识，固定字面量。用于未来出现第二种 od 变体时区分 |
| 2 | `version` | `"0.1"` | 是 | **格式版本**（MAJOR.MINOR），语义见 §5.1 |
| 3 | `meta` | object | 是 | 文档元信息，见 §1.2 |
| 4 | `nodes` | array | 是 | 节点集合，见 §1.3 |
| 5 | `assets` | object | 是 | 外部二进制资源，见 §1.4 |
| 6 | `variables` | array | 是 | 变量，见 §1.5 |
| 7 | `variableSets` | array | 是 | 变量集合（= 主题轴），见 §1.5 |
| 8 | `themes` | object | 是 | 文档级主题激活状态，见 §1.6 |
| 9 | `libraries` | array | 是 | 已启用的外部库绑定，见 §1.7 |

**为什么是这个顺序**：先「这份文件是什么」（format/version）→ 再「关于这份文件的元信息」（meta）→ 再「内容」（nodes）→ 再「内容的附属」（assets）→ 再「跨节点的概念层」（variables/sets/themes）→ 最后「外部引用」（libraries）。人从上往下读，认知负荷递增；机器从上往下读，前缀即可判类型。

**为什么没有「引擎 ID 映射表」段**：因为**不需要**。od 文件里出现的所有 id 都是 odId；odId 与 engineId 的映射是**恒等映射**（§2.6）。这一节是最容易做错的设计点，理由见 §2.6。

### 1.2 `meta` — 文档元信息

```jsonc
"meta": {
  "generator": "od-format@0.1.0",
  "engine": "@open-pencil/scene-graph@0.16.0",
  "colorSpace": "srgb",
  "root": "frame~document",
  "ordinal": 0
}
```

| 字段 | 必填 | 来源（引擎） | 说明 |
| --- | --- | --- | --- |
| `generator` | 是 | 无（od 层写入） | 写出该文件的 od-format 包版本。**MUST NOT** 含时间戳 |
| `engine` | 是 | 无（od 层写入） | 写出时所用引擎包版本。因为「省略 = 引擎默认值」（§3.1），默认值随引擎版本变化，必须记录 |
| `colorSpace` | 是 | `SceneGraph.documentColorSpace` | `'srgb' \| 'display-p3'` |
| `root` | 是 | `SceneGraph.rootId` → odId | 根节点 odId。**MUST** 与 `nodes` 中唯一一个 `parent` 缺省的节点一致 |
| `ordinal` | 是 | 无（od 层维护） | **odId 判别器的单调计数器**（§2.5）。默认 `0`；每次需要判别器时 `+1` 并取用。**MUST** 只增不减 |

**明确不放进 `meta` 的东西**（每一条都有理由）：

| 不放的东西 | 理由 |
| --- | --- |
| 创建/修改时间戳 | 每次保存都变 → 直接违反 C2。git 已经有 commit 时间了 |
| 文档标题 | 引擎没有这个概念；标题是根节点的 `name`（默认 `"Document"`）。要标题就改根节点名，不要造第二份真相 |
| 页面列表 | 可由 `nodes` 中 `type === "CANVAS"` 推导。冗余即脱节风险 |
| 作者 / 描述 | 引擎没有；v0.1 不臆造 |

> **`generator` 会造成一次 diff**：升级 od-format 包后重写文件，这一行会变。这是刻意的——它是排查「这份文件是哪版工具写的」的唯一线索，且每次工具升级只影响一行。

### 1.3 `nodes` — 节点集合

**形状**：`nodes` 是一个**扁平数组**，不是嵌套树。

```jsonc
"nodes": [
  { "id": "frame~document", "type": "FRAME", "name": "Document", "children": ["canvas~page-1"] },
  { "id": "canvas~page-1", "type": "CANVAS", "name": "Page 1", "parent": "frame~document", "children": [] },
  { "id": "frame~hero", "type": "FRAME", "name": "Hero", "parent": "canvas~page-1",
    "children": ["text~hero-title"], "box": { "x": 0, "y": 0, "width": 375, "height": 200 } },
  { "id": "text~hero-title", "type": "TEXT", "name": "标题", "parent": "frame~hero",
    "children": [], "box": { "x": 24, "y": 40, "width": 327, "height": 48 },
    "text": { "content": "你好，世界", "font": { "size": 32, "weight": 700 } } }
]
```

**为什么是扁平数组 + `parent` 指针，而不是嵌套树**：

| 维度 | 嵌套树 | 扁平数组 + parent（**选定**） |
| --- | --- | --- |
| agent 改一个节点的属性 | 要在文本里定位嵌套层级，改动还要连带调整缩进 | 直接搜 `"id": "text~hero-title"`，改一行 |
| agent 移动一个节点 | 要把整块文本剪出来贴到别处（易错、易丢缩进） | 改 `parent` 一个字段 |
| diff 友好度 | 移动节点 = 整块删除 + 整块新增 | 移动节点 = 改一行 |
| 顺序 | 天然 | **MUST** 按「树的前序遍历」排列，读起来仍然自上而下 |
| 引用完整性 | 结构上不可能悬空 | 需要 `od validate` 检查（§8.4） |

代价是「悬空引用」成为可能——这由校验器兜底（§8.4 的 V8/V9/V10）。收益是 agent 可写性，数量级更高。

**`nodes` 的顺序规范**：`MUST` 是**根节点在前、深度优先前序遍历（pre-order）**。`parent` 一定出现在其 `children` 之前。这个顺序使文件「从上往下读」与画布层级一致。

**节点对象的键顺序**（`MUST`，见 §6.2）：

```
id, type, name, parent, children,
box, limits, appearance, corners, flip, constraints,
styles,
fills, strokes, effects,
geometry, shape,
grid, guides,
text,
layout, stroke, borders,
component, bindings,
export, pluginData, pluginRelaunch, source
```

即：**结构字段 → 几何 → 外观 → 画笔 → 矢量 → 栅格 → 文本 → 布局 → 描边 → 组件 → 变量 → 杂项**。

**每个节点对象的字段分组（od 侧的「组」）**：

| 组 | 键 | 覆盖引擎字段 |
| --- | --- | --- |
| 结构 | `id` `type` `name` `parent` `children` | id / type / name / parentId / childIds |
| 几何 | `box` | x, y, width, height, rotation |
| 尺寸约束 | `limits` | minWidth, maxWidth, minHeight, maxHeight, targetAspectRatio |
| 外观 | `appearance` | opacity, visible, locked, clipsContent, blendMode, expanded, autoRename, internalOnly, isMask, maskType, maskIsOutline |
| 圆角 | `corners` | cornerRadius + 4 角 + independentCorners + cornerSmoothing |
| 翻转 | `flip` | flipX, flipY, handleMirroring |
| 约束 | `constraints` | horizontalConstraint, verticalConstraint |
| 共享样式 | `styles` | fillStyleId, strokeStyleId, textStyleId, effectStyleId, gridStyleId, sharedStyleType |
| 画笔 | `fills` `strokes` `effects` | 同名 |
| 矢量 | `geometry` `shape` | fillGeometry, strokeGeometry, vectorNetwork, arcData, booleanOperation, pointCount, starInnerRadius |
| 栅格 | `grid` `guides` | gridColumnGap, gridRowGap, gridTemplateColumns, gridTemplateRows, gridPosition, layoutGrids, guides |
| 文本 | `text` | 全部 `text*` / `font*` / `lineHeight` / `letterSpacing` / `maxLines` / `listSpacing` / `paragraph*` / `hangingList` / `styleRuns` / `leadingTrim` |
| 布局 | `layout` | 全部 `layout*` + padding* + itemSpacing + counterAxisSpacing + primaryAxisAlign 等 |
| 描边 | `stroke` `borders` | strokeWeight, strokeAlign, strokeCap, strokeJoin, strokeMiterLimit, dashPattern, border*Weight, independentStrokeWeights |
| 组件 | `component` | 全部 `component*` / `instance*` / `variant*` / `symbol*` / `library*` / `publish*` |
| 变量 | `bindings` | boundVariables, variableModes |
| 杂项 | `export` `pluginData` `pluginRelaunch` `source` | exportSettings, pluginData, pluginRelaunchData, source |

### 1.4 `assets` — 外部二进制资源

```jsonc
"assets": {
  "a3f5c1d2e4b60718293a4c5d6e7f8091a2b3c4d": {
    "file": "assets/a3f5c1d2e4b60718293a4c5d6e7f8091a2b3c4d.png",
    "mime": "image/png",
    "bytes": 20481
  }
}
```

| 字段 | 说明 |
| --- | --- |
| 键 | **引擎的 imageHash**（= 图片内容 sha1 hex，`computeImageHash`）。`Fill.imageHash` 就是引用这个键 |
| `file` | 相对于 **od 文件所在目录** 的路径。**MUST** 使用 `/` 分隔符 |
| `mime` | `'image/png' \| 'image/jpeg' \| 'image/gif' \| 'image/webp'`（引擎 `imageMimeType` 的取值域） |
| `bytes` | 文件字节数，用于校验与 diff 可读性 |

**规则**：

1. 图片**MUST NOT** 内联 base64（`docs/sdk-notes.md` §4.3 坑 3）。base64 会让文件不可读、diff 变天书。
2. `file` 路径**MUST** 以 `assets/` 开头（约定，不是强制；允许自定义目录，但 `od convert --assets` 可指定）。
3. `assets` 为空对象时**保留该键**（不省略）——保证顶层结构恒定，diff 只在内容变化时出现。
4. 资源文件**MUST NOT** 放在 od 文件之外（不能引用 `../../etc/passwd`）→ `od validate` 检查路径逃逸。

> **`textPicture` 不进 `assets/`**：它是引擎的路径文字渲染**缓存**（Skia 段落快照），不是用户素材 → 归入 D1 **直接剔除**（§3.1.4）。

### 1.5 `variables` / `variableSets` — 变量与集合

```jsonc
"variables": [
  {
    "id": "var~brand-primary",
    "name": "brand/primary",
    "type": "COLOR",
    "set": "vcol~brand",
    "values": {
      "mode~brand-light": { "r": 0.058, "g": 0.404, "b": 0.902, "a": 1 },
      "mode~brand-dark":  { "alias": "var~brand-accent" }
    },
    "description": "主色",
    "hidden": false,
    "scopes": ["ALL_SCOPES"],
    "unit": "px",
    "expressions": { "mode~brand-light": { "css": "clamp(1rem, 2vw, 3rem)", "resolved": 32 } },
    "codeSyntax": { "WEB": "--brand-primary" }
  }
],
"variableSets": [
  {
    "id": "vcol~brand",
    "name": "Brand",
    "defaultMode": "mode~brand-light",
    "modeAttribute": "data-theme",
    "modes": [
      { "id": "mode~brand-light", "name": "Light", "condition": "[data-theme=\"light\"]" },
      { "id": "mode~brand-dark",  "name": "Dark",  "condition": "[data-theme=\"dark\"]" }
    ],
    "variables": ["var~brand-primary", "var~brand-accent"]
  }
]
```

**字段映射（文档层）**：

| 引擎 | od | 处理 |
| --- | --- | --- |
| `Variable.id` | `variables[].id` | 改名：engineId → odId（`var~` 前缀） |
| `Variable.name` | `variables[].name` | 原样 |
| `Variable.type` | `variables[].type` | 原样（`COLOR`/`FLOAT`/`STRING`/`BOOLEAN`） |
| `Variable.collectionId` | `variables[].set` | 改名：引用 `variableSets[].id` |
| `Variable.valuesByMode` | `variables[].values` | 改名：**键为模式 odId**；值是判别联合（§1.5.1） |
| `Variable.description` | `variables[].description` | 原样 |
| `Variable.hiddenFromPublishing` | `variables[].hidden` | 改名 |
| `Variable.scopes` | `variables[].scopes` | 原样（`ALL_SCOPES` 等） |
| `Variable.unit` | `variables[].unit` | 原样（FLOAT only） |
| `Variable.expressions` | `variables[].expressions` | 改名：键为模式 odId，值 `{css, resolved}` 原样 |
| `Variable.codeSyntax` | `variables[].codeSyntax` | 原样 |
| `Variable.pluginData` | `variables[].pluginData` | 原样 |
| `Variable.key` / `Variable.version` | `variables[].key` / `.version` | 原样（外部库发布的引用） |
| `VariableCollection.id` | `variableSets[].id` | 改名：→ odId（`vcol~` 前缀） |
| `VariableCollection.name` | `variableSets[].name` | 原样 |
| `VariableCollection.defaultModeId` | `variableSets[].defaultMode` | 改名：→ 模式 odId |
| `VariableCollection.modes[]` | `variableSets[].modes[]` | 改名：`modeId` → `id`（odId）；`name`/`condition`/`sortPosition` 原样 |
| `VariableCollection.variableIds[]` | `variableSets[].variables[]` | 改名：→ 变量 odId，**保持顺序** |
| `VariableCollection.modeAttribute` | `variableSets[].modeAttribute` | 原样 |
| `VariableCollection.pluginData` | `variableSets[].pluginData` | 原样 |
| `VariableCollection.key` / `.version` | `variableSets[].key` / `.version` | 原样 |

#### 1.5.1 变量值的判别联合

引擎的 `VariableValue = Color | number | string | boolean | { aliasId: string }` 是**五路联合**，JSON 里无法靠类型区分 `Color` 与 `{aliasId}`。od 侧规则：

| od 值 | 引擎值 |
| --- | --- |
| `number` | `number` |
| `string` | `string` |
| `boolean` | `boolean` |
| `{ "r": n, "g": n, "b": n, "a": n }`（**恰好这 4 个键**） | `Color` |
| `{ "alias": "<varId>" }` | `{ aliasId: <engineVarId> }` |

**判别规则（MUST）**：对象值若含 `alias` 键 → 别名；否则若含 `r`/`g`/`b`/`a` 四键 → 颜色；否则 → 非法（`od validate` 报 `OD1111_INVALID_VARIABLE_VALUE`，见 §8.4 V15）。

**别名必须可解析**：别名指向的变量**MUST** 在同一文档的 `variables` 中存在（`od validate` 检查）。别名环由引擎处理，od 只负责无损传递。

#### 1.5.2 颜色为什么不用 hex

**决策：颜色用引擎原生的 `{r, g, b, a}` 浮点（0..1），不用 `#rrggbb`。**

理由：`float → hex → float` 是有损的（`0.1` → `26/255 = 0.10196…`），会直接违反 **C1 无损红线**。可读性由 §6.4 的「最短往返表示」保证（`0.058` 就写 `0.058`，不写成 `0.058000000000000003`）。

> 变通：`od inspect` 可以**按需**渲染成 hex 给人看（`--format text` 的输出不是格式文件，不承担无损责任）。

### 1.6 `themes` — 主题模式

```jsonc
"themes": {
  "active": { "vcol~brand": "mode~brand-dark" }
}
```

| 字段 | 引擎来源 | 说明 |
| --- | --- | --- |
| `themes.active` | `SceneGraph.activeMode: Map<collectionId, modeId>` | 文档级「哪个集合当前处于哪个模式」 |

**为什么主题只有这一段，而不是一套独立的 theme 表**：

引擎的变量模型**本身就是**主题模型——**一个变量集合 = 一条主题轴，它的多个模式 = 这条轴上的主题取值**。所以 od 侧：

- 主题的**定义**（有哪些模式、每个模式下变量是什么值）在 `variables[].values` 与 `variableSets[].modes` 里；
- 主题的**当前状态**（文档默认处于哪个模式）在 `themes.active` 里；
- 节点级的**局部覆盖**在节点的 `bindings.modes` 里（`variableModes`）。

三处各司其职，**没有第二份真相**。如果另立一张 theme 表，就会出现「theme 表说 dark，active 说 light」的矛盾状态——这是典型的冗余即脱节。

> 「多轴主题」「主题在 CSS 中的落地条件」由 `variableSets[].modes[].condition` 与 `modeAttribute` 承载，v0.1 已能表达。

### 1.7 `libraries` — 外部库绑定

```jsonc
"libraries": [
  { "id": "lib~material", "revision": "rev-7", "enabled": true }
]
```

| 字段 | 引擎来源 | 说明 |
| --- | --- | --- |
| `id` | `EnabledLibraryBinding.libraryId` | **外部 id，原样保留**，不铸 odId（见下） |
| `revision` | `EnabledLibraryBinding.revisionId` | 原样 |
| `enabled` | `EnabledLibraryBinding.enabled` | 原样 |

**规则**：**只有文档内实体才铸 odId**（节点、变量、变量集合、集合模式、组件属性）。一切**外部引用**（库 id、共享样式 id、`.fig` 溯源 id、插件 id）**原样保留为字符串**，不进入 odId 命名空间。原因：外部 id 不由本文档控制，套上 odId 外衣只会制造「本地可改」的错觉。

> 引擎的 `EnabledLibraryBinding` 是 `Map<string, EnabledLibraryBinding>`，键即 `libraryId`；od 用数组 + `id` 字段表达，保持数组序稳定。

### 1.8 顶层完整示例

见 **附录 B**。

---

## 2. 语义 ID 层

> **这是本规格最核心的一节。** 引擎 id 是 `${随机会话号}:${计数器}`，每次跑都不一样，直接写进文件会让 diff 全是噪音。`docs/sdk-notes.md` §4.3 坑 1 已经把这条定为「Phase 1 的首要设计项，不是优化项」。

### 2.1 问题陈述

| 症状 | 原因 |
| --- | --- |
| 同一份设计导入两次，得到两套完全不同的 id | `generateId()` 的会话号每进程随机 |
| diff 里出现 `48213:57` → `90211:12` 这种整行抖动 | id 变了，所有引用它的字段都跟着变 |
| 人读不懂「这个节点是谁」 | `48213:57` 不携带任何语义 |
| agent 无法在文件里稳定地指向一个节点 | 目标 id 每次都不同 |

**要达到的目标**：

1. 文件里的 id **稳定**：同一份文件反复保存，id 不变。
2. 文件里的 id **可读**：人扫一眼知道这是什么。
3. 文件里的 id **可引用**：agent 能据此检索、patch。
4. 文件里的 id **不与引擎 id 耦合**：不随引擎会话变化。

### 2.2 odId 语法（正式文法）

```
odId    := kind "~" slug [ "~" disc ]
kind    := "canvas" | "frame" | "group" | "rect" | "ellipse" | "text" | "line"
          | "star" | "poly" | "vector" | "bool" | "section" | "comp" | "compSet"
          | "inst" | "connector" | "shape"
          | "var" | "vcol" | "mode" | "prop"
slug    := /[a-z0-9]+(-[a-z0-9]+)*/          ; 1..24 字符
disc    := /[1-9][0-9]*/                      ; 值来自 meta.ordinal，首次冲突用 "~1"
```

**完整正则（MUST 用这一条判定一个字符串是不是 odId）**：

```regex
^(?:canvas|frame|group|rect|ellipse|text|line|star|poly|vector|bool|section|comp|compSet|inst|connector|shape|var|vcol|mode|prop)~[a-z0-9]+(?:-[a-z0-9]+)*(?:~[1-9][0-9]*)?$
```

**为什么用 `~` 而不是 `:` 或 `/`**：

| 候选 | 问题 |
| --- | --- |
| `:` | 引擎 id 本身就是 `${session}:${counter}`，用 `:` 会让「像不像 odId」的判定出现歧义，且 `.fig` 生态里 `:` 有特殊含义 |
| `/` | 在路径、URL、shell 里都要转义；`od inspect` 输出路径时会被搞乱 |
| `-` | 与 slug 的连字符混淆，无法在不改 slug 的前提下追加判别器 |
| **`~`** | JSON 键合法、URL 需转义但很少出现在 URL 里的 id、shell 需引号但不常出现、**与引擎 id 格式永不冲突**（引擎 id 无 `~`） |

**关键性质**：引擎 id（`48213:57`）**永远不可能匹配 odId 正则**（无 `~`），而 odId **永远不可能匹配引擎 id 格式**（含 `~`）。因此「这个 id 是不是 odId」是**无歧义的单向判定**，这是 §2.6 的恒等映射能成立的前提。

### 2.3 kind 前缀表

| kind | 对应引擎 `NodeType` | 备注 |
| --- | --- | --- |
| `canvas` | `CANVAS` | 页面 |
| `frame` | `FRAME` | |
| `group` | `GROUP` | |
| `rect` | `RECTANGLE` / `ROUNDED_RECTANGLE` | 两者共用 kind，靠 slug/判别器区分 |
| `ellipse` | `ELLIPSE` | |
| `text` | `TEXT` | |
| `line` | `LINE` | |
| `star` | `STAR` | |
| `poly` | `POLYGON` | |
| `vector` | `VECTOR` | |
| `bool` | `BOOLEAN_OPERATION` | |
| `section` | `SECTION` | |
| `comp` | `COMPONENT` | |
| `compSet` | `COMPONENT_SET` | |
| `inst` | `INSTANCE` | |
| `connector` | `CONNECTOR` | |
| `shape` | `SHAPE_WITH_TEXT` | |
| `var` | — | 变量 |
| `vcol` | — | 变量集合 |
| `mode` | — | 集合模式 |
| `prop` | — | 组件属性定义 |

### 2.4 slug 生成算法（规范性）

给定节点的 `name`（或变量的 `name`、集合的 `name`）：

```
1. NFKD 规范化，剥离组合记号（é → e）
2. 转小写
3. 任何不在 [a-z0-9] 的字符 → "-"
4. 连续的 "-" 折叠为一个；去掉首尾 "-"
5. 结果为空 → "n"
6. 长度 > 24 → 截断到 24；若第 24 位落在 "-" 上，回退到最后一个 "-" 处
```

示例：

| 原始 name | slug |
| --- | --- |
| `Hero` | `hero` |
| `Hero Title` | `hero-title` |
| `标题` | `n`（CJK 全被剥离 → 空） |
| `按钮 / 主要` | `n` |
| `CTA（首屏）` | `cta` |
| `hero__title--v2` | `hero-title-v2` |

**注意「标题」→ `n`**：中文名不含 ASCII 字母，slug 会退化。这是可接受的——**中文文档里的可读性主要由 `name` 字段本身承担**（`name` 原样保留中文），odId 的作用是**稳定句柄**而非阅读材料。所以：

- **kind 前缀保证 odId 至少携带类型信息**（`text~n` 仍然知道是文本节点）；
- slug 只在名字是 ASCII/拉丁字母时有额外价值。

> 若产品侧认为中文文档需要更强的 id 可读性，v1 可引入「拼音 slug」——但**必须**保持 slug 只在铸造时计算一次、此后不再变化（§2.9）。v0.1 不做。

### 2.5 唯一性与判别器

**规则**：`(kind, slug)` 在文档内唯一。冲突时给**后出现者**追加判别器。

判别器的值来自 **`meta.ordinal`** 这个**单调递增、持久化在文件里**的计数器：

```
铸造 odId(kind, slug):
  base = kind + "~" + slug
  if base 不在文档已用的 odId 集合里:
      return base                      // 无冲突，不消耗判别器
  loop:
      ordinal = ordinal + 1            // 只增不减
      candidate = base + "~" + ordinal
      if candidate 不在已用集合里:
          return candidate
```

| 场景 | 结果 | `meta.ordinal` |
| --- | --- | --- |
| 第一个叫 `Hero` 的 frame | `frame~hero` | 0 |
| 第二个也叫 `Hero` 的 frame | `frame~hero~1` | 1 |
| 第三个 | `frame~hero~2` | 2 |
| 删掉第二个（`frame~hero~1`）后新建一个同名 | `frame~hero~3`（**判别器不复用**） | 3 |

**「判别器绝不复用」是怎么保证的**（这是本节最容易被做错的地方）：

- 判别器**不是**「文档里第几个同名节点」，而是**一个只增不减的全局计数器**。删除节点不会让计数器回退。
- 计数器**存在文件里**（`meta.ordinal`），所以**跨会话也成立**：加载 → 删节点 → 存盘 → 下次加载 → 新建同名节点 → 拿到的判别器比上一个更大。
- 计数器**MUST NOT** 减小。实现上：加载时 `ordinal = max(doc.meta.ordinal, 文件里出现过的最大判别器)`（§2.8）；保存时写回 `registry.ordinal()`（只增）。
- **手工编辑的边界**：如果 agent 手写文件加了一个 `frame~hero~1` 却没把 `meta.ordinal` 调大，那么下一轮铸造**可能**撞上它——铸造循环会**跳过已占用的值**继续加，所以**不会产生重复 id**，但可能出现「同一个判别器值被两个不同时代的节点用过」。这是手工编辑的固有边界，`od validate` **SHOULD** 报 warning（`OD1321`：`meta.ordinal` 小于文中出现的最大判别器）。

> **为什么必须用计数器而不是「第 N 个同名节点」**：后者在删除节点后会回退——删掉 `frame~hero~1` 再新建同名节点会重新拿到 `~1`，而旧引用（agent 的 patch 脚本、issue 链接）还指向那个被删的节点。计数器方案从机制上杜绝了这件事。

**判别器的分配时机**：在**铸造时刻**按文档当时的遍历顺序分配。因为 odId 一旦铸成就冻结（§2.9），顺序变化不影响已有 id。

**关于 `~1`**：计数器从 `0` 起，第一次冲突用 `~1`。因此 `~1` 是**规范值**（不是特例），正则接受任意 `~` + 正整数。

### 2.6 odId ↔ engineId 映射：**文件里不存映射表**

**这是本节最重要的结论，先给答案**：

> **od 文档里不存在「引擎 ID 映射表」段。文件里出现的所有 id 都是 odId。**
> **odId → engineId 的映射是恒等映射（identity），因为加载时我们把 odId 直接注入为引擎 node id。**

**为什么不能把 engineId 写进文件**（三条独立理由，任一条都足以否决）：

1. **engineId 每次会话都变**（`${随机会话号}:${计数器}`）。写进文件 = 每次保存都产生 diff 噪音，直接违反 **C2**。
2. **写进去也没用**。文件里存的是「上一轮会话的 id」，新一轮加载时引擎必然生成新 id，存的那份是**陈旧值**，不能用来做映射——只是纯噪音。
3. **破坏「同一份设计导入两次得到同一份文件」**。若文件含 engineId，两次导入产出的文件必然不同（engineId 不同），C2 再次破。

**为什么恒等映射可行**（关键前提，已核实）：

1. 引擎**不解析** node id —— 全源码扫描确认 `split(':')` 只出现在图标名解析里（`icons/model.ts:18`）。
2. 引擎提供 `createNodeWithId(id, type, parentId, overrides)`（`index.ts:537`），接受任意字符串。
3. 因此加载时可以直接 `createNodeWithId(odId, ...)`，让**引擎 node id 就是 odId**。

**代价与缓解**：

| 代价 | 缓解 |
| --- | --- |
| 引擎内部 id 不再是 `${session}:${counter}` 形态 | 只在 od-format 管理的文档里如此。引擎不解析 id，无功能影响 |
| `.fig` 导出路径可能假设 node id 是数字（Figma node id 是 uint64） | ✅ **已核实**（§0.6）：导出器**容忍**非 GUID id，但 **odId 无法跨 `.fig` 往返保持**。`.fig` 定位为「导出通道」而非「同步通道」（§2.12） |

### 2.7 加载路径：`toEngine(doc)`

```
1. 解析 od 文本 → JSONC 去注释 → JSON.parse → zod 校验（按 doc.version 选 schema）
2. 建 SceneGraph，随后 **graph.nodes.clear()**（丢掉构造器自带的 root + "Page 1"）
3. 第 1 遍：顺序遍历 doc.nodes（文件里已是前序，天然满足「父在子前」）：
     engineId = registry.adopt(node.id)           // 恒等：engineId := odId，并登记映射
     graph.createNodeWithId(engineId, node.type, parentEngineId, props)
     // 本遍暂不写引用字段（component.main / bindings.* / override 的引用值）
4. 第 2 遍：所有节点建完后，解析并写入全部引用字段
5. 写入文档层：variables / variableCollections / activeMode / images / enabledLibraries / documentColorSpace
6. `registry.restoreOrdinal(max(doc.meta.ordinal, 文件里出现过的最大判别器))`（§2.5 的判别器计数器；§2.8 给了这条「取大」规则的必要性）
```

**关键顺序约束（MUST）**：

- **引用字段必须后写**。`component.main` 指向的组件**可能出现在文件的后面**（组件定义在根、实例在页面深处），所以必须两遍建图（§4.1.4）。
- **变量 / 变量集合必须先于绑定写入**。因为 `boundVariables` 引用变量 id。
- **不需要 `populateInstanceChildren()`**。实例的拷贝子节点**在文件里**（决策 I-1），照常建出来即可。→ od-format 因此**不需要** `@open-pencil/core` 就能加载组件文档。
- **`createNodeWithId` 不查重**（实测）：od-format **MUST** 自己在建图前查重并报错。
- **构造器会消耗 2 个 id**（root + "Page 1"）：**MUST** `graph.nodes.clear()` 后再建自己的节点。

**为什么不需要 `populateInstanceChildren`**：od 文档里的实例**存了**它的拷贝子节点（§4.1 决策 I-1），加载时照常建出来即可，实例不会是空的。→ od-format 因此**只依赖 `@open-pencil/scene-graph`**，不需要 core。

### 2.8 保存路径：`fromEngine(graph, registry?)`

```
1. 从 graph.rootId 起做前序遍历
2. 遍历全部节点（**没有**要跳过的例外——实例的拷贝子节点照常写出，§4.1 决策 I-1）
3. 对每个「作者节点」：
     odId = registry.resolve(node.id)          // 见下
4. 写 nodes[]，字段按 §3.2 的映射表编码
5. 写文档层
6. 写 `meta.ordinal = registry.ordinal()`（§2.5）
```

**`fromEngine` 独立调用时（未传 registry）的 MUST**：**MUST** 用图里已有 odId 的**最大判别器**初始化计数器：

```
ordinal = max(所有匹配 odId 正则的 node.id 里的最大 disc, 无则 0)
```

否则一个不带 registry 的保存会把 `meta.ordinal` 写回 0，**计数器归零 → 判别器会被复用**（§2.5 的保证失效）。加载路径（§2.7）则用 `max(doc.meta.ordinal, 文件里出现的最大判别器)` 初始化，两者取大，保证**计数器永远不小于文件里已出现的最大判别器**。

**`registry.resolve(engineId)` 的三级判定**（`MUST` 按此顺序）：

| 优先级 | 条件 | 结果 |
| --- | --- | --- |
| 1 | `engineId` 匹配 odId 正则（§2.2） | `engineId` 本身就是 odId → 直接用。**恒等映射** |
| 2 | registry 里有该 engineId 的登记 | 返回登记的 odId（编辑器运行期新建的节点） |
| 3 | 都不是 | **铸造新 odId** 并登记到 registry |

> 优先级 1 是整个设计的关键：**文件里的 odId 在加载后就是引擎 node id**，所以优先级 2/3 只服务于「编辑器运行期新建、还没落盘」的节点。这让 `fromEngine(graph)` **可以不带 registry 独立工作**——对库使用者更友好。

### 2.9 odId 生命周期规则

| 事件 | odId 行为 | 理由 |
| --- | --- | --- |
| **首次落盘**（新节点） | 铸造一次，之后冻结 | |
| **重命名**（`name` 改变） | **不变** | slug 只在铸造时算一次；改名是高频操作，改 id 会造成大面积 diff |
| **移动**（换父节点） | **不变** | odId 不含路径 |
| **复制**（节点 + 其子树） | 源与全部后代**各自获得新 odId** | odId 是身份标识，两个节点不能共享。判别器按 `meta.ordinal` 取（`frame~hero` → `frame~hero~1` → `frame~hero~2`…，§2.5） |
| **删除** | odId 从文件消失 | |
| **删除后重建同名节点** | 获得**新** odId（判别器继续递增），**不复用**旧 odId | 避免悬空引用指向新对象（§2.5） |
| **实例 detach**（脱离主组件） | 被 detach 的子节点从「克隆」变成「作者节点」，**首次进入文件** → 此时铸造 odId | 它们此前没有 odId（克隆不需要） |
| **组件改版触发实例同步**（`syncInstance`） | 克隆节点被重建 → 克隆的 engine id 变 → **不影响任何 odId** | 克隆没有 odId |
| **引擎里新建节点后保存** | 铸造 odId，登记进 registry | 优先级 2/3 |

**不变式（实现必须保证，MUST）**：

- **I1**：文件中出现的 odId，在加载后 **就是** 对应引擎节点的 `node.id`。
- **I2**：一次保存过程内，同一节点**至多铸造一次** odId。
- **I3**：odId 在文档内全局唯一（含变量/集合/模式/组件属性）。
- **I4**：odId 一经写入文件，永不因后续编辑而改变（重命名、移动、复制父节点均不影响）。

### 2.10 非节点 id 的 odId

| 实体 | kind | 例 | 备注 |
| --- | --- | --- | --- |
| 变量 | `var` | `var~brand-primary` | `Variable.id` |
| 变量集合 | `vcol` | `vcol~brand` | `VariableCollection.id` |
| 集合模式 | `mode` | `mode~brand-light` | `VariableCollectionMode.modeId` |
| 组件属性 | `prop` | `prop~label-text` | `ComponentPropertyDefinition.id` |

**这四类 id 在引擎里也是 `${session}:${counter}` 形态**，所以同样适用 §2.6 的恒等策略：加载时用 odId 覆盖引擎 id。

**组件属性 id 的特殊约束**：同一个组件的属性定义 id **必须唯一且稳定**——因为 `componentPropertyAssignments`（按 id 索引）、`componentPropertyReferences[].propertyId`、`variantPropSpecs[].propDefId` 三处都引用它。引擎的 `createComponentPropertyId()` 也是随机的，所以 od 层统一铸造 `prop~` 前缀 id。

> **注意引擎内部的不对称**（已核实）：`componentPropertyAssignments` 按 **id** 索引，而 `componentPropertyValues` 按 **名称** 索引（`variants.ts:30`）。od 侧**原样保留这个不对称**——`component.values` 的键仍是属性名，不是 odId。

### 2.11 `IdRegistry` API（实现契约）

```ts
export interface IdRegistry {
  /**
   * 登记「这个 odId 就是引擎 node id」（恒等映射），返回该 engineId。
   * 加载路径用它把 od 文件里的 odId 直接注入引擎（§2.7 第 1 遍）。
   */
  adopt(odId: string): string
  /** 解析 engineId → odId；必要时铸造。 */
  resolve(engineId: string, seed: { kind: OdIdKind; name: string }): string
  /** 登记显式绑定（加载时用）。 */
  bind(engineId: string, odId: string): void
  /** 查询，不铸造。 */
  peek(engineId: string): string | undefined
  /** 反查。 */
  engineIdOf(odId: string): string | undefined
  /** 已铸造的 odId 集合（校验唯一性）。 */
  known(): ReadonlySet<string>
  /** 当前判别器计数器的值（写回 `meta.ordinal`）。 */
  ordinal(): number
  /** 从文件里的 `meta.ordinal` 恢复计数器（加载时用）。 */
  restoreOrdinal(value: number): void
}
```

**实现要点**：

1. `resolve` 的判定顺序严格按 §2.8 的三级。
2. 铸造时扫描 `known()` 检查 `(kind, slug)` 冲突 → 按 §2.5 的算法取判别器（`ordinal` 只增不减）。
3. **判别器分配必须确定性**：同一次保存中按遍历顺序分配，同样的输入产生同样的 odId 集合。
4. registry 本身是运行时状态，但 **`meta.ordinal` 是它的计数器，必须写进文件**（§1.2）——这是「判别器跨会话不复用」的落点。
5. `adopt(odId)` 用于加载路径：登记恒等映射并把 odId 加进 `known()`，**MUST NOT** 消耗判别器。

### 2.12 `idStrategy`：为 `.fig` 预留的口子

`toEngine` 提供一个选项：

```ts
interface ToEngineOptions {
  /**
   * 'od'（默认）：引擎 node id = odId，恒等映射。
   * 'native'：让引擎自己生成 ${session}:${counter}，另建 engineId→odId 旁表。
   *            .fig 导出走这个（§2.12 的「明确限制」）。
   */
  idStrategy?: 'od' | 'native'
}
```

**为什么需要**（**已核实**，见 §0.6）：`.fig` 的 GUID 是 `sessionID:localID` 形态的数字对。core 的导出器**容忍**非 GUID 形态的 id——`assignVariableGuid()`（`variable-export.js:12-24`）在 id 不匹配 `/^\d+:\d+$/` 时会**兜底新铸**一个 GUID，`ownGuid()`（`export-setup.js:36`）对图层同理返回 `null` 并走计数器。

**所以 `.fig` 导出不会崩，但会丢 id 对应关系**：导出的 `.fig` 里所有变量/集合/模式/组件属性拿到的是**新铸的数字 GUID**，与 od 文件里的 `var~xxx` / `mode~xxx` / `prop~xxx` **不再对应**。

**能不能把 odId 存进 `source.id` 来保持对应？——不能。** `savedFromFile()`（`export-setup.js:43`）用 `parseGuidOrNull(node.source.id)` 判断，`source.id` 只有是 GUID 形态才会被当成「已保存的记录」。塞 `frame~hero` 会被当作无效 GUID 丢弃。

> ### 📌 **明确限制：odId 不能跨 `.fig` 往返保持。**
>
> `.od.json → .fig → .od.json` 之后，所有 odId 都会变（变成新铸的 odId，语义 id 丢失）。
> **这是格式层面的固有限制，不是 bug。** `.fig` 是二进制交换格式，不是 od 的往返通道。
> `.fig` 的正确定位是「**导出**通道」（把设计交给 Figma / 其它工具），而不是「**同步**通道」。
> 若将来需要 `.fig` 往返保持 odId，唯一可行路径是在 `.fig` 之外**另存一张 odId ↔ GUID 旁表**（例如 `design.odmap.json`），或把 odId 编进 `.fig` 的 pluginData。

**v0.1 的取舍**：`'native'` 策略**在 v0.1 不实现**（`.fig` 双向转换本来就不在 §8 的 CLI 契约里），但**接口必须留出来**，否则后续要动 API。

---

## 3. 字段映射表

### 3.1 编码总则

#### 3.1.1 省略规则（默认即省略）

**规则 E1（MUST）**：od 中**省略某个字段 ⇔ 该字段的值等于「该节点类型在引擎里的默认值」**。

实现方式（MUST NOT 手抄默认值）：

```ts
// 每个节点类型调一次，缓存起来
const defaults = new Map<NodeType, SceneNode>()
function defaultOf(type: NodeType): SceneNode {
  let d = defaults.get(type)
  if (!d) { d = createDefaultNode(() => 'x', type); defaults.set(type, d) }
  return d
}
```

用引擎自己的 `createDefaultNode()`（`node-defaults.ts`）取默认值，**保证默认值表永不与引擎漂移**。手抄 154 个默认值是 bug 温床。

**深比较**：数组/对象字段用结构化深比较（`util.isDeepStrictEqual` 或 zod 的 `safeParse` 复用）。

**规则 E2（MUST）**：`null` 与「省略」是两回事：
- **省略** = 等于引擎默认值。
- **`null`** = 显式空值（对应引擎的 `null`）。
- 引擎里 `T | undefined` 的字段（值真为 `undefined`）→ **省略**（undefined ≈ 未设置 ≈ 默认）。
  > 这正是 `docs/sdk-notes.md` §4.3 坑 4 的结论：zod schema 对这类字段 MUST 用 `.optional()`，MUST NOT 用 `.nullable()`。

**规则 E3（MUST）**：`id` / `type` / `name` / `parent` / `children` **永远写出**（结构字段不参与省略）。根节点的 `parent` 省略。

#### 3.1.2 几何字段：照存（不省略）

**规则 G（MUST）**：`box.x` / `box.y` / `box.width` / `box.height` **一律照存**，只要它们不等于该节点类型的引擎默认值（规则 E1 照常生效）。**MUST NOT** 因为「该值是布局算出来的」而省略。

**为什么照存（而不是省略）**——这是本规格与「派生即丢弃」直觉相左的一处，理由有三条：

1. **布局重算不保证逐位相同。** 布局计算不在 scene-graph，在 core 的 Yoga（`@open-pencil/yoga-layout@3.3.0-grid.3`）；几何结果依赖字体度量与 Yoga 版本，**重算不保证与原值逐位相同**（`docs/engine-semantics.md` §11.1 的判定「意图可无损，结果不可靠」）。省略几何就等于把「往返后几何逐位相同」这条验收线交给一个**不可靠**的重算过程。
2. **od-format 不运行布局。** od-format 只依赖 `@open-pencil/scene-graph`，布局趟在 core 里（§9.2 的 `opts.layout` 回调）。若省略几何，加载后的图在**没有布局趟**的环境里（CLI、无头渲染、agent 直接读图）就是错的——节点全在 `(0,0)`。照存则**加载即可用**。
3. **文件因此是引擎文档的忠实快照**，满足 C1 的严格形式。

**代价（必须写进文档，不能藏）**：

- 自动布局子节点的位置是布局写回的派生值（§0.6）。**若宿主应用（带 core 的编辑器）在加载后跑了一次布局趟，且重算结果与文件里的值不完全相同**，那么下一次保存时该值会变 → 产生一次 diff。
- 这是**环境漂移**（字体/Yoga 版本变化）导致的，不是设计缺陷。同一环境下的反复保存是幂等的（§9.4 的 T7/T8）。

**sizing 的作用（不用于省略，但用于校验与展示）**：`layoutSizingInParent(parentNode, node, axis)`（`scene-graph/src/layout/sizing.ts:75`）返回 `'FIXED' | 'HUG' | 'FILL'`：

- `FILL`（在自动布局父里被拉伸）→ 该轴尺寸是派生的。
- `HUG`（该轴贴合内容）→ 派生。文本节点按 `textAutoResize` 判定（`textHugs()`，`sizing.ts:56`）。
- `FIXED` → 作者写的。

`od inspect` **SHOULD** 用它标出「该尺寸由布局决定」（例如 `375×200 (hug)`），让人一眼看出哪些值会随布局漂移。`od validate` **SHOULD** 在「派生尺寸被手工改动」时报 warning。

> **历史**（保留以便 review）：本规格初稿曾设计 G1/G2 两条省略规则（自动布局子节点省略位置、HUG/FILL 轴省略尺寸）。在读到 `docs/engine-semantics.md` §11.2 与 core 的布局源码后**推翻**——理由即上面三条。

#### 3.1.3 值的编码约定

| 约定 | 规则 |
| --- | --- |
| 枚举 | **原样保留引擎的 SCREAMING_SNAKE 字面量**（`"HORIZONTAL"`、`"DROP_SHADOW"`、`"MIN"`）。MUST NOT 转小写——转换表是纯噪音与出错源，且引擎侧可直接用 |
| 数字 | 见 §6.4（最短往返表示，禁止四舍五入） |
| 颜色 | `{r,g,b,a}` 浮点，**不用 hex**（§1.5.2） |
| 二进制 | `Uint8Array` → base64 字符串。**v0.1 无此用例**：`textPicture` 已改判为缓存并剔除（§3.1.4 D1）；图片走 `assets/` 外置（§1.4） |
| 几何 blob | `commandsBlob` → SVG path `d` 字符串（§6.4） |
| `Map` | → 对象；键排序（§3.6） |
| `Set` | → 数组；按插入序或字典序（见对应字段） |
| 无限/NaN | **MUST 报错**，MUST NOT 写出 `null`（`JSON.stringify` 会把 `Infinity` 写成 `null`，静默丢数据） |

#### 3.1.4 派生字段：两档处理（**已按 engine-semantics 修正**）

> ⚠️ **本节修正了 `docs/sdk-notes.md` §4.3 坑 2 的分类。** `docs/engine-semantics.md` §6.3 按「有没有重算入口」的判据复查后发现：Phase 0 把 `variableBindingScales` / `variableAssignmentScales` 归进「派生缓存（丢弃重算）」是**误判**——它们**没有加载期重算入口**，且**直接参与绑定解算**。本规格采信 engine-semantics 的修正。

判据：**有没有对应的重算入口**。

**D1 · 必丢**（有明确重算入口，加载后由引擎重算）

| 位置 | 引擎字段 | 处理 | 重算入口 |
| --- | --- | --- | --- |
| 节点 | `derivedLayout` | **剔除** | core `applyEffectiveGeneratedTextLayout()` / `sizeAutoResizingText()` |
| 节点 | `derivedTextGlyphs` | **剔除** | 文本整形（core / 渲染侧） |
| 节点 | `textPicture` | **剔除** | Skia 段落快照缓存，失效逻辑 `scene-graph/src/text/picture.ts:25-53` |
| 文档 | `instanceIndex` | **剔除** | 逐个 `createNodeWithId` 注册时自动重建（实测） |
| 文档 | `positionPreviewVersion` | **剔除** | 运行时计数，无重算概念 |
| 文档 | `figKiwiVersion` | **剔除** | `.fig` 导入溯源 |
| 文档 | `figSchemaDeflated` | **剔除** | 二进制溯源 |

> **`textPicture` 的改判**：Phase 0 把它归成「C 类 · 直接二进制（需 base64 或外置资产）」，**这是误判**——它是**缓存**不是**资产**（`scene-graph/src/text/picture.ts:6-9` 的注释明确写着「缓存的 Skia Paragraph 快照」）。因此**剔除即可，不进 base64 分支**，也不进 `assets/`。

**D2 · 必留**（**没有**加载期重算入口，丢掉就回不来）

| 位置 | 引擎字段 | od 位置 | 为什么必留 |
| --- | --- | --- | --- |
| 节点 | `variableBindingScales` | `bindings.scales` | 绑定值 → 场景单位的**乘数**。解算时 `const scale = node.variableBindingScales[field] ?? 1; const effective = value * scale`（`scene-graph/src/variables/bindings.ts:51-52`）。scale ≠ 1 时丢掉它，**绑定会解出不同的数** |
| 节点 | `variableAssignmentScales` | `bindings.assignmentScales` | 同上，且**只对 `INSTANCE` 写**（`scene-graph/src/variables/units.ts:11-12`），只在缩放发生时写。一旦丢弃且不同步，**再也回不来** |

**独立佐证**：引擎自己的全图 round-trip **保留**这两个字段——`core/src/kiwi/fig/parse/transfer.ts:85-86` 明确把它们拷进新节点。

**唯一的重算入口**是 `scaleVariableBindingUnits()`（`scene-graph/src/variables/units.ts:4-15`），它只被 `instances/sync.ts:120`（实例同步）与 `scaling/tree.ts:44`（用户缩放）调用——**普通加载不会触发**。

**D1 一共 7 个**：**3 个节点字段**（`derivedLayout` / `derivedTextGlyphs` / `textPicture`）+ **4 个文档字段**（`instanceIndex` / `positionPreviewVersion` / `figKiwiVersion` / `figSchemaDeflated`）。
**D2 一共 2 个**：**都是节点字段**（`variableBindingScales` / `variableAssignmentScales`）。

**MUST 写一条单测**：遍历 154 个字段名，断言 **D1 的 3 个节点字段**不出现在任何节点输出中、**D1 的 4 个文档字段**不出现在任何文档输出中，且 **D2 的 2 个字段**在有值时**一定出现**。

### 3.2 节点字段映射全表（154/154）

处理方式取值：**原样**（名字与结构都不变）/ **改名**（换名字，结构不变）/ **合并**（并入某个 od 组，路径变了）/ **拆分**（一个引擎字段拆成多个 od 字段，或丢弃其子结构）/ **剔除**（不写出）。

<!-- FIELD-TABLE-START -->
#### A · 结构与标识

| 引擎字段 | od 字段路径 | 处理 | 说明 |
| --- | --- | --- | --- |
| `id` | `id` | 改名 | 语义改名：值不再是引擎 id，而是 odId（见 §2） |
| `type` | `type` | 原样 | 枚举原样保留（SCREAMING_SNAKE） |
| `name` | `name` | 原样 |  |
| `parentId` | `parent` | 改名 | 引用父节点 odId；根节点省略 |
| `childIds` | `children` | 改名 | 引用子节点 odId，按绘制顺序；**实例的拷贝子节点照常写入**（§4.1 决策 I-1） |

#### B · 几何与尺寸

| 引擎字段 | od 字段路径 | 处理 | 说明 |
| --- | --- | --- | --- |
| `x` | `box.x` | 合并 | **一律照存**，不因是布局派生量而省略（§3.1.2 规则 G） |
| `y` | `box.y` | 合并 | 同上：一律照存 |
| `width` | `box.width` | 合并 | 一律照存，不因派生而省略（§3.1.2） |
| `height` | `box.height` | 合并 | 同上：一律照存 |
| `rotation` | `box.rotation` | 合并 |  |
| `minWidth` | `limits.minWidth` | 合并 |  |
| `maxWidth` | `limits.maxWidth` | 合并 |  |
| `minHeight` | `limits.minHeight` | 合并 |  |
| `maxHeight` | `limits.maxHeight` | 合并 |  |
| `targetAspectRatio` | `limits.aspect` | 原样 | 结构 {x,y} 不变 |

#### C · 外观

| 引擎字段 | od 字段路径 | 处理 | 说明 |
| --- | --- | --- | --- |
| `opacity` | `appearance.opacity` | 改名 |  |
| `visible` | `appearance.visible` | 改名 |  |
| `locked` | `appearance.locked` | 改名 |  |
| `clipsContent` | `appearance.clipsContent` | 改名 |  |
| `blendMode` | `appearance.blendMode` | 改名 |  |
| `expanded` | `appearance.expanded` | 改名 |  |
| `autoRename` | `appearance.autoRename` | 改名 |  |
| `internalOnly` | `appearance.internal` | 改名 |  |
| `isMask` | `appearance.mask` | 改名 |  |
| `maskType` | `appearance.maskType` | 改名 |  |
| `maskIsOutline` | `appearance.maskOutline` | 改名 |  |
| `cornerRadius` | `corners.radius` | 改名 | 与四角的统一入口：值等于四角时写标量，否则展开 |
| `topLeftRadius` | `corners.topLeft` | 改名 |  |
| `topRightRadius` | `corners.topRight` | 改名 |  |
| `bottomRightRadius` | `corners.bottomRight` | 改名 |  |
| `bottomLeftRadius` | `corners.bottomLeft` | 改名 |  |
| `independentCorners` | `corners.independent` | 改名 |  |
| `cornerSmoothing` | `corners.smoothing` | 改名 |  |
| `flipX` | `flip.x` | 改名 |  |
| `flipY` | `flip.y` | 改名 |  |
| `handleMirroring` | `flip.handleMirroring` | 改名 |  |

#### D · 画笔与描边

| 引擎字段 | od 字段路径 | 处理 | 说明 |
| --- | --- | --- | --- |
| `fills` | `fills` | 原样 | 数组；元素结构见 §3.6 |
| `strokes` | `strokes` | 原样 | 数组；元素结构见 §3.6 |
| `effects` | `effects` | 原样 | 数组 |
| `strokeAlign` | `stroke.align` | 改名 |  |
| `strokeCap` | `stroke.cap` | 改名 |  |
| `strokeJoin` | `stroke.join` | 改名 |  |
| `strokeMiterLimit` | `stroke.miterLimit` | 改名 |  |
| `strokeWeight` | `stroke.weight` | 改名 |  |
| `dashPattern` | `stroke.dash` | 改名 | number[] |
| `borderTopWeight` | `borders.top` | 改名 |  |
| `borderRightWeight` | `borders.right` | 改名 |  |
| `borderBottomWeight` | `borders.bottom` | 改名 |  |
| `borderLeftWeight` | `borders.left` | 改名 |  |
| `independentStrokeWeights` | `borders.independent` | 改名 |  |

#### E · 矢量与几何体

| 引擎字段 | od 字段路径 | 处理 | 说明 |
| --- | --- | --- | --- |
| `fillGeometry` | `geometry.fill` | 改名 | GeometryPath[]；commandsBlob → SVG path d（§6.4） |
| `strokeGeometry` | `geometry.stroke` | 改名 | 同上 |
| `vectorNetwork` | `geometry.network` | 改名 | VectorNetwork | null |
| `arcData` | `geometry.arc` | 改名 |  |
| `booleanOperation` | `geometry.boolean` | 改名 | 可 undefined → od 省略 |
| `pointCount` | `shape.points` | 改名 |  |
| `starInnerRadius` | `shape.innerRadius` | 改名 |  |

#### F · 共享样式引用

| 引擎字段 | od 字段路径 | 处理 | 说明 |
| --- | --- | --- | --- |
| `fillStyleId` | `styles.fill` | 改名 | 外部/派生引用，值保持原样字符串（§3.5） |
| `strokeStyleId` | `styles.stroke` | 改名 | 同上 |
| `textStyleId` | `styles.text` | 改名 | 同上 |
| `effectStyleId` | `styles.effect` | 改名 | 同上 |
| `gridStyleId` | `styles.grid` | 改名 | 同上 |
| `sharedStyleType` | `styles.sharedType` | 改名 |  |

#### G · 文本

| 引擎字段 | od 字段路径 | 处理 | 说明 |
| --- | --- | --- | --- |
| `text` | `text.content` | 改名 | 字符串绑定路径改为 text.content（§3.5） |
| `fontSize` | `text.font.size` | 改名 |  |
| `fontFamily` | `text.font.family` | 改名 |  |
| `fontWeight` | `text.font.weight` | 改名 |  |
| `italic` | `text.font.italic` | 改名 |  |
| `fontVariations` | `text.font.variations` | 改名 |  |
| `fontFeatures` | `text.font.features` | 改名 |  |
| `textAlignHorizontal` | `text.align.horizontal` | 改名 |  |
| `textAlignVertical` | `text.align.vertical` | 改名 |  |
| `textDirection` | `text.direction` | 改名 |  |
| `textLanguage` | `text.language` | 改名 |  |
| `textAutoResize` | `text.autosize` | 改名 |  |
| `textCase` | `text.case` | 改名 |  |
| `textDecoration` | `text.decoration.kind` | 改名 | NONE/UNDERLINE/STRIKETHROUGH |
| `textDecorationStyle` | `text.decoration.style` | 改名 | SOLID/DOTTED/WAVY |
| `textDecorationThickness` | `text.decoration.thickness` | 改名 |  |
| `textDecorationSkipInk` | `text.decoration.skipInk` | 改名 |  |
| `textDecorationFills` | `text.decoration.fills` | 改名 |  |
| `textUnderlineOffset` | `text.decoration.underlineOffset` | 改名 |  |
| `leadingTrim` | `text.leading.trim` | 改名 |  |
| `lineHeight` | `text.leading.lineHeight` | 改名 |  |
| `letterSpacing` | `text.leading.letterSpacing` | 改名 |  |
| `maxLines` | `text.limits.maxLines` | 改名 |  |
| `textTruncation` | `text.limits.truncation` | 改名 |  |
| `listSpacing` | `text.list.spacing` | 改名 |  |
| `paragraphSpacing` | `text.list.paragraphSpacing` | 改名 |  |
| `paragraphIndent` | `text.list.paragraphIndent` | 改名 |  |
| `hangingList` | `text.list.hanging` | 改名 |  |
| `textParagraphs` | `text.paragraphs` | 改名 |  |
| `styleRuns` | `text.runs` | 改名 | StyleRun[]；run.style 内部字段原样 |
| `textPathData` | `text.path` | 改名 | TextPathData | null |
| `textPathBox` | `text.pathBox` | 改名 | Rect | null |

#### H · 自动布局与约束

| 引擎字段 | od 字段路径 | 处理 | 说明 |
| --- | --- | --- | --- |
| `layoutMode` | `layout.mode` | 改名 |  |
| `layoutDirection` | `layout.direction` | 改名 |  |
| `layoutWrap` | `layout.wrap` | 改名 |  |
| `primaryAxisAlign` | `layout.align.primary` | 改名 |  |
| `counterAxisAlign` | `layout.align.counter` | 改名 |  |
| `counterAxisAlignContent` | `layout.align.content` | 改名 |  |
| `primaryAxisSizing` | `layout.sizing.primary` | 改名 |  |
| `counterAxisSizing` | `layout.sizing.counter` | 改名 |  |
| `itemSpacing` | `layout.gap` | 改名 | 变量绑定路径同步改写 |
| `counterAxisSpacing` | `layout.crossGap` | 改名 |  |
| `paddingTop` | `layout.padding.top` | 改名 |  |
| `paddingRight` | `layout.padding.right` | 改名 |  |
| `paddingBottom` | `layout.padding.bottom` | 改名 |  |
| `paddingLeft` | `layout.padding.left` | 改名 |  |
| `layoutPositioning` | `layout.positioning` | 改名 |  |
| `layoutGrow` | `layout.grow` | 改名 |  |
| `layoutAlignSelf` | `layout.alignSelf` | 改名 |  |
| `itemReverseZIndex` | `layout.reverseZ` | 改名 |  |
| `strokesIncludedInLayout` | `layout.includeStrokes` | 改名 |  |
| `horizontalConstraint` | `constraints.horizontal` | 改名 |  |
| `verticalConstraint` | `constraints.vertical` | 改名 |  |

#### I · 栅格与参考线

| 引擎字段 | od 字段路径 | 处理 | 说明 |
| --- | --- | --- | --- |
| `gridColumnGap` | `grid.columnGap` | 改名 |  |
| `gridRowGap` | `grid.rowGap` | 改名 |  |
| `gridTemplateColumns` | `grid.template.columns` | 改名 | GridTrack[] |
| `gridTemplateRows` | `grid.template.rows` | 改名 | GridTrack[] |
| `gridPosition` | `grid.position` | 改名 | GridPosition | null |
| `layoutGrids` | `grid.grids` | 改名 | LayoutGrid[] |
| `guides` | `guides` | 原样 | CanvasGuide[] |

#### J · 组件与实例

| 引擎字段 | od 字段路径 | 处理 | 说明 |
| --- | --- | --- | --- |
| `componentId` | `component.main` | 改名 | 引用主组件 odId；库组件改用 component.library（§4.1） |
| `componentKey` | `component.key` | 改名 |  |
| `sourceLibraryKey` | `component.libraryKey` | 改名 |  |
| `publishId` | `component.publishId` | 改名 |  |
| `overrideKey` | `component.overrideKey` | 改名 |  |
| `sharedSymbolVersion` | `component.symbolVersion` | 改名 |  |
| `publishedVersion` | `component.publishedVersion` | 改名 |  |
| `librarySource` | `component.library` | 改名 | LibraryAssetSource | null |
| `isPublishable` | `component.publishable` | 改名 |  |
| `isSymbolPublishable` | `component.symbolPublishable` | 改名 |  |
| `isExposedInstance` | `component.exposed` | 改名 |  |
| `symbolDescription` | `component.description` | 改名 |  |
| `componentScale` | `component.scale` | 改名 |  |
| `symbolLinks` | `component.links` | 改名 | SymbolLink[] |
| `variantPropSpecs` | `component.variants` | 改名 | propDefId → 组件属性 odId |
| `instanceOverrides` | `component.overrides` | 改名 | 见 §4.1 的 descendants 键改写 |
| `componentPropertyDefinitions` | `component.properties` | 改名 | 每条 definition.id → odId |
| `componentPropertyReferences` | `component.propertyRefs` | 改名 | propertyId → odId |
| `componentPropertyAssignments` | `component.assignments` | 改名 | 键为属性 id → odId |
| `componentPropertyValues` | `component.values` | 改名 | 键为属性「名称」（非 id），保持不变 |

#### K · 变量绑定

| 引擎字段 | od 字段路径 | 处理 | 说明 |
| --- | --- | --- | --- |
| `boundVariables` | `bindings.fields` | 改名 | 键为 od 侧绑定路径（§3.5） |
| `variableModes` | `bindings.modes` | 改名 | 集合 odId → 模式 odId |
| `variableBindingScales` | `bindings.scales` | 改名 | **D2 必留**：绑定值的单位乘数，无加载期重算入口 |
| `variableAssignmentScales` | `bindings.assignmentScales` | 改名 | **D2 必留**：仅 INSTANCE 写，丢了回不来 |

#### L · 导出 / 插件 / 来源

| 引擎字段 | od 字段路径 | 处理 | 说明 |
| --- | --- | --- | --- |
| `exportSettings` | `export` | 改名 | ExportSetting[] |
| `pluginData` | `pluginData` | 原样 | PluginDataEntry[] |
| `pluginRelaunchData` | `pluginRelaunch` | 改名 | PluginRelaunchDataEntry[] |
| `source` | `source` | 拆分 | 只保留 format/id/orderKey/editedFields；丢弃 fig 载荷（§3.3） |

#### M · 派生缓存 D1（全部剔除）

| 引擎字段 | od 字段路径 | 处理 | 说明 |
| --- | --- | --- | --- |
| `derivedLayout` | `—` | 剔除 | D1 派生缓存，加载时重算 |
| `derivedTextGlyphs` | `—` | 剔除 | D1 派生缓存，剔除重算 |
| `textPicture` | `—` | 剔除 | **D1**：Skia 段落快照**缓存**，不是资产，剔除即可 |
<!-- FIELD-TABLE-END -->

#### 3.2.1 拆 / 合 清单（汇总）

| 引擎侧（扁平） | od 侧（分组） | 动作 |
| --- | --- | --- |
| `x` `y` `width` `height` `rotation` | `box.*` | 合 |
| `minWidth` `maxWidth` `minHeight` `maxHeight` `targetAspectRatio` | `limits.*` | 合 |
| `opacity` `visible` `locked` `clipsContent` `blendMode` `expanded` `autoRename` `internalOnly` `isMask` `maskType` `maskIsOutline` | `appearance.*` | 合 |
| `cornerRadius` + 4 角 + `independentCorners` + `cornerSmoothing` | `corners.*` | 合 |
| `flipX` `flipY` `handleMirroring` | `flip.*` | 合 |
| `horizontalConstraint` `verticalConstraint` | `constraints.*` | 合 |
| 5 个 `*StyleId` + `sharedStyleType` | `styles.*` | 合 |
| `fillGeometry` `strokeGeometry` `vectorNetwork` `arcData` `booleanOperation` | `geometry.*` | 合 |
| `pointCount` `starInnerRadius` | `shape.*` | 合 |
| `gridColumnGap` `gridRowGap` `gridTemplateColumns` `gridTemplateRows` `gridPosition` `layoutGrids` | `grid.*` | 合 |
| 32 个文本相关字段 | `text.*`（再分 `content`/`font`/`align`/`decoration`/`leading`/`limits`/`list`/`paragraphs`/`runs`/`path`） | 合 |
| 21 个布局相关字段 | `layout.*`（再分 `mode`/`direction`/`wrap`/`align`/`sizing`/`padding`/`positioning`/`grow`/`alignSelf`/`content`） | 合 |
| `strokeWeight` `strokeAlign` `strokeCap` `strokeJoin` `strokeMiterLimit` `dashPattern` | `stroke.*` | 合 |
| `borderTopWeight` `borderRightWeight` `borderBottomWeight` `borderLeftWeight` `independentStrokeWeights` | `borders.*` | 合 |
| 20 个组件相关字段 | `component.*` | 合 |
| `boundVariables` `variableModes` | `bindings.*` | 合 |
| `source` | `source` | **拆**：只保留 `format`/`id`/`orderKey`/`editedFields`，**丢弃 `fig` 载荷** |
| `instanceOverrides` | `component.overrides` | **拆**：`descendants` 的键改写（§4.1） |
| `boundVariables` 的键 | `bindings.fields` 的键 | **拆**：路径重写到 od 空间（§3.5） |

### 3.3 文档层字段映射（SceneGraph 12 字段）

| 引擎字段 | 类型 | od 位置 | 处理 |
| --- | --- | --- | --- |
| `nodes` | `Map<string, SceneNode>` | `nodes[]` | 改名：Map → 数组（前序遍历序） |
| `images` | `Map<string, Uint8Array>` | `assets{}` + 外部文件 | **拆**：二进制外置为 `assets/<hash>.<ext>`，文件里只留引用 |
| `variables` | `Map<string, Variable>` | `variables[]` | 改名：Map → 数组（按 id 字典序） |
| `variableCollections` | `Map<string, VariableCollection>` | `variableSets[]` | 改名：Map → 数组（按 id 字典序） |
| `activeMode` | `Map<string, string>` | `themes.active{}` | 改名：Map → 对象（键 = 集合 odId） |
| `rootId` | `string` | `meta.root` | 改名：engineId → odId |
| `figKiwiVersion` | `number \| null` | — | 剔除 |
| `figSchemaDeflated` | `Uint8Array \| null` | — | 剔除 |
| `documentColorSpace` | `DocumentColorSpace` | `meta.colorSpace` | 改名 |
| `enabledLibraries` | `Map<string, EnabledLibraryBinding>` | `libraries[]` | 改名：Map → 数组 |
| `positionPreviewVersion` | `number` | — | 剔除 |
| `instanceIndex` | `Map<string, Set<string>>` | — | 剔除（派生索引） |

> **`variables` / `variableSets` 的数组顺序**：按 `id` 的**字典序**排（稳定、与创建顺序无关）。`variableSets[].variables` 内部**保持引擎的 `variableIds` 原序**（顺序有语义：面板里变量的展示顺序）。

### 3.4 哪些字段的值是「引用」（需要重映射）

| 字段（od 路径） | 值的含义 | 目标命名空间 | 重映射规则 |
| --- | --- | --- | --- |
| `nodes[].parent` | 父节点 | 节点 | engineId → odId |
| `nodes[].children[]` | 子节点 | 节点 | engineId → odId（**拷贝子节点照写**，§4.1 决策 I-1） |
| `nodes[].component.main` | 主组件 | 节点 | engineId → odId；库组件时为 `null` |
| `nodes[].component.variants[].propDefId` | 组件属性 | 组件属性 | engineId → odId |
| `nodes[].component.properties[].id` | 组件属性自身 | 组件属性 | engineId → odId |
| `nodes[].component.propertyRefs[].propertyId` | 组件属性 | 组件属性 | engineId → odId |
| `nodes[].component.assignments{}` 的键 | 组件属性 | 组件属性 | engineId → odId |
| `nodes[].component.values{}` 的键 | 属性**名称** | — | **不重映射**（引擎语义，见 §1.5） |
| `nodes[].bindings.fields{}` 的值 | 变量 | 变量 | engineId → odId |
| `nodes[].bindings.scales{}` 的值 | 变量 | 变量 | engineId → odId |
| `nodes[].bindings.scales{}` 的键 | 绑定字段路径 | — | **键是引擎路径空间**，需翻译（§3.5） |
| `nodes[].bindings.assignmentScales{}` 的值 | 变量 | 变量 | engineId → odId |
| `nodes[].bindings.modes{}` 的键/值 | 集合 / 模式 | 变量集合 / 模式 | engineId → odId |
| `nodes[].component.overrides.descendants{}` 的键 | 主组件子节点 | 节点 | **特殊改写**，见 §4.1 |
| `nodes[].component.overrides.self.componentId` | 被换入的组件 | 节点 | engineId → odId（`instance-overrides.ts:104`） |
| `nodes[].component.overrides.self.boundVariables/*` | 变量 | 变量 | engineId → odId（`instance-overrides.ts:105`） |
| `nodes[].component.overrides.descendants[*].sourceComponentId` | 主组件子节点 | 节点 | **特殊改写**，见 §4.1 |
| `variables[].set` | 变量集合 | 变量集合 | engineId → odId |
| `variables[].values{}` 的键 | 模式 | 模式 | engineId → odId |
| `variables[].values{m}.alias` | 变量（别名） | 变量 | engineId → odId |
| `variables[].expressions{}` 的键 | 模式 | 模式 | engineId → odId |
| `variableSets[].defaultMode` | 模式 | 模式 | engineId → odId |
| `variableSets[].modes[].id` | 模式自身 | 模式 | engineId → odId |
| `variableSets[].variables[]` | 变量 | 变量 | engineId → odId |
| `themes.active{}` 的键/值 | 集合 / 模式 | 变量集合 / 模式 | engineId → odId |
| `assets{}` 的键 | 图片 hash | — | **不重映射**（内容寻址，天然稳定） |
| `nodes[].styles.*` | 共享样式引用 | 外部/派生 | **不重映射**（派生自 `source.id`，跨会话稳定，见 §0.5） |
| `nodes[].source.id` | `.fig` 溯源 id | 外部 | **不重映射** |
| `libraries[].id` | 库 id | 外部 | **不重映射** |

### 3.5 变量绑定路径的翻译表（规范性）

引擎的 `bindVariable(nodeId, field, variableId)` **只接受白名单字段名**，写错会抛 `Unknown binding field`（`docs/sdk-notes.md` §5 坑 H）。因为 od 侧改了路径，**必须有双向翻译表**。

**od 侧 `bindings.fields` 的键格式**：`<组路径>` 或 `<组路径>.<数组索引>.<叶字段>`，用 `.` 分隔。例如 `appearance.opacity`、`fills.0.color`。

| 引擎绑定字段（白名单） | od 绑定路径 | 类型 |
| --- | --- | --- |
| `opacity` | `appearance.opacity` | number |
| `width` | `box.width` | number |
| `height` | `box.height` | number |
| `minWidth` | `limits.minWidth` | number |
| `maxWidth` | `limits.maxWidth` | number |
| `minHeight` | `limits.minHeight` | number |
| `maxHeight` | `limits.maxHeight` | number |
| `x` | `box.x` | number |
| `y` | `box.y` | number |
| `rotation` | `box.rotation` | number |
| `cornerRadius` | `corners.radius` | number |
| `topLeftRadius` | `corners.topLeft` | number |
| `topRightRadius` | `corners.topRight` | number |
| `bottomLeftRadius` | `corners.bottomLeft` | number |
| `bottomRightRadius` | `corners.bottomRight` | number |
| `strokeWeight` | `stroke.weight` | number |
| `borderTopWeight` | `borders.top` | number |
| `borderRightWeight` | `borders.right` | number |
| `borderBottomWeight` | `borders.bottom` | number |
| `borderLeftWeight` | `borders.left` | number |
| `fontSize` | `text.font.size` | number |
| `letterSpacing` | `text.leading.letterSpacing` | number |
| `lineHeight` | `text.leading.lineHeight` | number |
| `paddingLeft` | `layout.padding.left` | number |
| `paddingRight` | `layout.padding.right` | number |
| `paddingTop` | `layout.padding.top` | number |
| `paddingBottom` | `layout.padding.bottom` | number |
| `itemSpacing` | `layout.gap` | number |
| `counterAxisSpacing` | `layout.crossGap` | number |
| `gridRowGap` | `grid.rowGap` | number |
| `gridColumnGap` | `grid.columnGap` | number |
| `text` | `text.content` | string |
| `fontFamily` | `text.font.family` | string |
| `visible` | `appearance.visible` | boolean |
| `fills/<i>/color` | `fills.<i>.color` | color |
| `strokes/<i>/color` | `strokes.<i>.color` | color |

**引擎侧的路径格式（必须知道，否则翻译表会写错）**：

- 引擎的绑定路径**用斜杠 `/` 分隔数组下标**，例如 `fills/0/color`、`strokes/0/color`（`scene-graph/src/variables.ts:362` 的正则）。**不是点号**——实测 `fills.0.color` 与 `fills[0]/color` 都会被判 `Unknown binding field`。
- 引擎**接受**前导零（`fills/00/color` 等价于 `fills/0/color`，因为 `parseInt('00') === 0`）。
- 引擎在**绑定时校验下标越界**（`fills/5/color` 在只有 1 个 fill 时报错）。
- 引擎**不做任何数组重排**：`removeStaleBindings()` 只在新数组更短时删掉越界下标的绑定；**同长度重排会让绑定静默指向另一个画笔**（`docs/engine-semantics.md` §4.3 的硬伤 H1）。

**od 侧的路径格式（本规格自定）**：点分路径，数组下标作为数字段，例如 `fills.0.color`、`layout.padding.left`。

**规则**：

1. 保存时：引擎字段名 → od 路径。加载时：od 路径 → 引擎字段名。**同一张表，两个方向**。
2. od 的数组下标**MUST NOT 有前导零**（`fills.00.color` 非法）；`od validate` 报 `OD1108`。
3. 加载时把 od 的下标转成引擎的十进制整数（`Number('0') === 0`）。
4. od 里出现**不在表内的绑定路径** → `od validate` 报 `OD1108_UNKNOWN_BINDING_PATH`（见 §8.4 V12）。
5. 颜色绑定路径的**索引**必须落在数组范围内 → 校验时检查。
6. **`cornerRadius` vs 四角**：绑定 `cornerRadius` 映射到 `corners.radius`；当节点用的是展开的四角形式（`corners` 是对象而非标量）时，`corners.radius` 仍需存在（承载统一入口值），实现见 §3.2 注。

> **run 级绑定（别漏）**：`styleRuns[].style.boundVariables` 是**第三层**绑定，绑 `fontSize` / `fontWeight` / `letterSpacing` / `lineHeight`（`scene-graph/src/variables/bindings.ts:121-136`）。它**不在** `node.boundVariables` 里。本规格把 `styleRuns` 的内部结构**原样保留**（`text.runs`），所以这层绑定的键仍是引擎字段名，**不需要翻译**——但**MUST NOT** 在实现时把它当成 `text.runs` 的「无绑定子字段」而清空。

> **副作用提醒**：引擎的 `bindVariable()` 有副作用（写 `boundVariables` + `assignVariableBindingUnits()` + 发 `node:updated`，`scene-graph/src/variables.ts:404-410`）。od-format **MUST 直接写 `boundVariables` 字段**，**MUST NOT** 调用 `bindVariable()`——因为我们要保留 `variableBindingScales`（§3.1.4 D2），而 `bindVariable()` 会重算并覆盖它。
> 另外，`bindVariable` 等自由函数**不在包根导出**里（在 `@open-pencil/scene-graph/variables` 子路径），`graph.bindVariable()` 才是实例方法——但 od-format 用不上。

### 3.6 自由格式 Map 的编码（`Map` → 对象）

引擎有若干 `Map<string, X>` / `Record<string, string>` 字段。编码规则统一：

| 规则 | 说明 |
| --- | --- |
| **MUST** 用对象（`{...}`），不用数组 of tuples | 人可读；agent 好改 |
| **MUST** 键按**字典序**输出 | 引擎的 Map 插入序不稳定 → 必须排序才满足 C2 |
| 例外：`bindings.modes`、`themes.active`、`variableSets[].variables[]` | 后两者有语义顺序（§3.3），保持原序 |

受影响的字段：

| 引擎字段 | od 路径 | 键排序 |
| --- | --- | --- |
| `boundVariables` | `bindings.fields` | 字典序 |
| `variableModes` | `bindings.modes` | 字典序 |
| `componentPropertyAssignments` | `component.assignments` | 字典序（键是 odId） |
| `componentPropertyValues` | `component.values` | 字典序（键是属性名） |
| `activeMode` | `themes.active` | 字典序 |
| `instanceOverrides.self` | `component.overrides.self` | 字典序（键是字段名） |
| `instanceOverrides.descendants` | `component.overrides.descendants` | 字典序（键是 odId） |
| `Variable.valuesByMode` | `variables[].values` | 字典序（键是模式 odId） |
| `Variable.expressions` | `variables[].expressions` | 字典序 |
| `Variable.codeSyntax` | `variables[].codeSyntax` | 字典序 |

### 3.7 `instanceOverrides` 的值编码

`InstanceOverrideState` 的值类型是 `unknown`。上游提供了 `serializeInstanceOverrideState()`（`instance-overrides.ts:52`），它把值包成 `{ defined: boolean, value?: unknown }` —— 这解决了「Map 里存了 `undefined` 值」在 JSON 里会消失的问题（坑 4）。

**od 侧的决策（MUST）**：**直接采用上游的 `SerializedInstanceOverrideState` 形状**，不自创：

```jsonc
"overrides": {
  "self": [
    ["width", { "defined": true, "value": 200 }],
    ["height", { "defined": false }]
  ],
  "descendants": [
    ["text~hero-title", [
      ["text", { "defined": true, "value": "改过的文字" }]
    ]]
  ]
}
```

**为什么用数组 of tuples 而不是对象**：

1. `Map` 的键是 `InstanceOverrideField = string`，值可能是 `undefined`。用对象会丢掉「键存在但值为 undefined」这一信息（`{"width": undefined}` → JSON 里 `width` 键消失）。
2. 上游的 `serializeInstanceOverrideState` 已经解决好了，实现**直接调用**它，不要自己写。
3. 数组保序（Map 的插入序在引擎里是稳定的：先 `self` 后 `descendants`）。

**排序规则**：`self` 的条目按**字段名**字典序；`descendants` 的条目按**键（odId）**字典序；每个条目内部的字段也按字典序。（`serializeInstanceOverrideState` 保留 Map 插入序 → 编码器需要额外排序。）

**值的重映射**（§3.4 的表）：

| override 字段名 | 值的处理 |
| --- | --- |
| `componentId` / `sourceComponentId` | 节点引用 → odId（`sourceComponentId` 另有特殊改写，§4.1） |
| `boundVariables/<field>` | 变量引用 → odId |
| 其它 | 原样透传（JSON 安全） |

> 实现可复用引擎的 `remapInstanceOverrideState()`（`instance-overrides.ts:103`）做**值**的重映射（它已经处理了 `componentId`/`sourceComponentId`/`boundVariables/*` 三类）。但 **`descendants` 的键需要自定义处理**（§4.1），不能直接用它的 `references.node`。

---

## 4. 三类硬骨头

> `docs/research.md` §5.1 风险 #4：*引擎文档模型 → 文本 JSON 的序列化保真度是整个差异层的技术命门（组件 + 自动布局 + 变量 三者 round-trip 无损才算成立）*。
> 本节逐类给出 **od 侧结构 → 往返会丢什么 → 结论（可行 / 有条件可行 / 不可行）+ 依据**。

### 4.0 结论速览

| 硬骨头 | 结论 | 一句话依据 |
| --- | --- | --- |
| **组件 / 实例 / override** | **有条件可行** | 本地组件完全可行（主组件树 + 实例拷贝树一起存）；库组件的 override 目标解析不到本地 odId，需要 `component.library` + `component.overrides.external` 保留原始远端 id |
| **自动布局** | **可行（意图无损，结果以文件为准）** | 26 个布局相关字段（21 个 flow/约束 + 5 个栅格）全部可表达——24 个是标量、2 个是对象数组（`GridTrack[]`）；**几何照存不靠重算**，因为 Yoga 重算不保证逐位相同且 od-format 不跑布局趟 |
| **变量 + 主题模式** | **可行（3 个坑已封堵）** | 变量/集合/模式/绑定全是标量与字符串；变量值五路联合用形状判别解决；`fills`/`strokes` 保序、两个 scale 字段必留、主题两层都存 |

---

### 4.1 组件 / 实例 / override

#### 4.1.1 引擎模型（先搞清楚再用）

已核实的事实：

1. **组件定义** = `COMPONENT` 节点；变体集 = `COMPONENT_SET` 节点，其子节点是 `COMPONENT`。
2. **实例** = `INSTANCE` 节点，`componentId` 指向主组件。
3. **实例会实体化子节点**：`createInstance()` 调用 `cloneChildrenWithMapping()`（`instances.ts:63`），把主组件的子树**克隆成真实节点**放进 `graph.nodes`。
4. **克隆 ↔ 源子节点的对应关系分两种**：
   - **普通拷贝子节点** → 记录在拷贝节点**自己的 `componentId` 字段**（拷贝时 `cloneNodeProps(src, src.id)` 写入；同步时 `linkMatchedChild()` 写 `instChild.componentId = compChildId`，`sync.ts:349-356`）。
   - **嵌套实例拷贝子节点** → 记录在 `instanceOverrides.descendants[cloneId].sourceComponentId = compChildId`（`instances/sync.ts:354`）。
   `syncInstance()` 的 Pass 1 就是「按 `sourceComponentId` 或 `componentId` 直接匹配」（`sync.ts:536-545`）。
5. **`descendants` 的键是实例侧的克隆节点 id**（`instance-overrides.ts:92-121`），不是主组件的子节点 id。
6. **组件属性**：`ComponentPropertyDefinition.id` 被三处引用——`componentPropertyAssignments`（按 id）、`componentPropertyReferences[].propertyId`、`variantPropSpecs[].propDefId`。而 `componentPropertyValues` 另按**属性名**索引。

#### 4.1.2 od 侧结构

**组件定义**（就是一个普通节点，只是多一个 `component` 组）：

```jsonc
{
  "id": "comp~button",
  "type": "COMPONENT",
  "name": "Button",
  "parent": "frame~document",
  "children": ["text~button-label"],
  "component": {
    "properties": [
      { "id": "prop~button-label", "name": "label", "type": "TEXT", "defaultValue": "按钮" },
      { "id": "prop~button-size",  "name": "size",  "type": "VARIANT", "defaultValue": "md",
        "variantOptions": ["sm", "md", "lg"], "preferredValues": ["md"] }
    ],
    "variants": [ { "propDefId": "prop~button-size", "value": "md" } ]
  }
}
```

**实例**——注意 `children` 里**有**子节点：

```jsonc
{
  "id": "inst~button-1",
  "type": "INSTANCE",
  "name": "Button",
  "parent": "frame~hero",
  "children": ["text~button-label-1"],
  "component": {
    "main": "comp~button",
    "assignments": { "prop~button-label": "提交" },
    "overrides": {
      "self": [ ["width", { "defined": true, "value": 200 }] ],
      "descendants": [
        ["text~button-label-1", [
          ["text", { "defined": true, "value": "提交" }]
        ]]
      ]
    }
  }
}
```

**实例的子节点**（拷贝，与主组件里的 `text~button-label` 是**两个不同的节点**）：

```jsonc
{
  "id": "text~button-label-1",
  "type": "TEXT",
  "name": "Button",
  "parent": "inst~button-1",
  "children": [],
  "component": { "main": "text~button-label" }
}
```

#### 4.1.3 三个关键设计决策

**决策 I-1：实例的子节点（拷贝）**照常写进 `nodes[]`**，与普通节点无异。

- **依据**：`docs/engine-semantics.md` §2.4 的硬前提 **P2**——「主组件树与实例拷贝树必须一起存」。`descendants` 的键指向的是**拷贝节点**的 id（`scene-graph/src/instance-overrides.ts:75`），拷贝树丢了 override 就悬空。
- **已核实的关键细节**（决定了「照存」是安全的）：拷贝节点与源节点的**关联由普通字段 `componentId` 承载**——
  - 拷贝时 `cloneChildInCoordinates()` 调 `cloneNodeProps(src, src.id, mode)`，即**拷贝的 `componentId` = 源子节点的 id**（`scene-graph/src/instances/sync.ts:173-186`）。
  - 同步时 `linkMatchedChild()` 对非嵌套实例写 `instChild.componentId = compChildId`，对嵌套实例写 `sourceComponentId` override（`sync.ts:349-356`）。
  - `syncInstance()` 的 Pass 1 就是「按 `sourceComponentId` 或 `componentId` 直接匹配」（`sync.ts:536-545`）。
  → 所以**只要 `componentId` 被保留，引擎就能重新认出「这是主组件里某个节点的拷贝」**，加载后同步不会错配、不会重复克隆。
- **代价（必须写进文档）**：一个组件被用 N 次，文件里就有 N 份它的子树 → 体积与 diff 面积随实例数线性增长；改组件会同时改动每个实例的拷贝。

> **v1 的可选优化（不在 v0.1 范围）**：只存主组件、加载时用 `populateInstanceChildren()` + `syncInstance()` 重新物化拷贝，override 的键改存「主组件子节点的 odId」。**代价**：加载必须依赖 scene-graph 的实例同步语义，且嵌套实例的关联存在 `sourceComponentId` override 里（不是普通字段），重物化路径要额外处理。**v0.1 不做**——P2 的做法更简单、更稳，且 od-format 因此**不需要** core 就能加载组件文档。

**决策 I-2：`overrides.descendants` 的键是拷贝子节点自己的 odId**（恒等映射，与其它节点引用同一套规则）。

- 与 `parent` / `children` / `component.main` 完全一致 → **只有一种引用语义**，不需要第二套键空间。
- 加载时：`overrides.descendants[copyChildOdId]` 的各字段值写回该拷贝节点。
- **注意**：`sourceComponentId` 这个 override 字段**MUST 保留**（它是嵌套实例的关联），其值是**节点引用** → 重映射为 odId（§3.4）。

**决策 I-3：库组件用 `component.library` 表达，`component.main` 指向本地组件或置 `null`。**

- 库组件的主组件**不在本文档里** → 无法铸 odId。
- od 侧：`component.library` 保留 `LibraryAssetSource`（`identity` / `sourceNodeId` / `readOnly`），`component.libraryKey` 保留 `sourceLibraryKey`。
- **库组件的 override 目标**：其拷贝节点的 `sourceComponentId` 指向**远端 id**（Figma 节点 guid），在本地解析不到 odId。
  → **处理**：这类 override 放进 `component.overrides.external`，键就是**原始远端 id 字符串**，**原样保留**。

```jsonc
"overrides": {
  "self": [],
  "descendants": [],
  "external": [ ["123:456", [ ["text", { "defined": true, "value": "远端覆盖" }] ]] ]
}
```

- **这是「有条件可行」的那个条件。**

#### 4.1.4 加载顺序（两遍建图）

因为 `component.main` 指向的节点**可能在文件里出现在后面**（组件定义在根、实例在页面深处），加载**MUST** 分两遍：

| 遍 | 做什么 | 为什么 |
| --- | --- | --- |
| **第 1 遍** | 按文件顺序 `createNodeWithId(odId, type, parentId, fields)`，**暂不写引用字段**（`component.main`、`bindings.*`、override 的引用值） | 引用目标可能还没建出来。`createNodeWithId` 会把节点注册进 `instanceIndex`，若 `componentId` 指向尚不存在的节点，索引会错 |
| **第 2 遍** | 所有节点建完后，解析并写入全部引用字段 | 目标此时一定存在 |

> 引擎侧的先例：`core/src/kiwi/fig/parse/transfer.ts:91-106` 的 `deserializeSceneGraph` 是**直接替换整个 Map** 的；`scene-graph/src/transfer/apply.ts:70` 走 `createNodeWithId` 那条路。**两条路都能保 id。**

**三个必须避开的坑**（`docs/engine-semantics.md` §7.2 实测）：

| 坑 | 后果 | od-format 的做法 |
| --- | --- | --- |
| **`createNodeWithId` 不查重** | 同名 id **静默覆盖** | od-format **MUST** 自己在建图前查重并报 `OD1103`（odId 重复） |
| **构造器已经消耗了 2 个 id**（根 FRAME + "Page 1"） | `new SceneGraph()` 之后图里有两个**不属于本文档**的节点 | od-format **MUST** 在建自己的节点前 `graph.nodes.clear()`（并按需清 `rootId`），否则文件会多出两截内容 |
| **id 生成器必须单调** | 返回重复 id 会抛 `The ID generator only returned IDs that are in use` | od-format 不用生成器建节点（全部 `createNodeWithId`）；需要新 id 时**MUST** 用单调计数器，不用纯哈希 |

#### 4.1.5 结论

> ### ✅ **有条件可行**
>
> **可行部分**：本地组件（`COMPONENT` / `COMPONENT_SET` / `INSTANCE`）的完整往返——组件定义、变体属性、实例属性赋值、实例自身的 override、对拷贝子节点的 override——**全部无损**。这是 `docs/engine-semantics.md` §2.4 的判定（「组件可以无损往返，但有 3 个硬前提」），本规格逐条落实：
>
> | engine-semantics 的前提 | 本规格的落实 |
> | --- | --- |
> | **P1** override 必须用引擎自带的编解码 | §3.7 直接采用 `serializeInstanceOverrideState()` 的 `[k, {defined, value?}]` 三态数组编码，**不自创** |
> | **P2** 主组件树与实例拷贝树必须一起存 | 决策 I-1：拷贝树照常写进 `nodes[]`；关联由普通字段 `componentId` 承载（已核实：`cloneChildInCoordinates` / `linkMatchedChild` / `syncInstance` Pass 1） |
> | **P3** 加载必须用 `createNodeWithId` 逐节点注册 | §2.7 第 1 遍全程 `createNodeWithId`；id 由 odId 直接给定，生成器 0 次调用 |
>
> **条件**：外部库组件（`sourceLibraryKey` / `librarySource` 非空）的 override 目标解析不到本地 odId，**必须**依赖 `component.overrides.external` 保留原始远端 id。引擎自身也用远端 guid 做这种索引，因此不构成额外损失。
>
> **不可行的场景（明确列出）**：**跨文档引用组件**。若 A 文档的实例引用 B 文档里的主组件，od 无法表达（B 文档的 odId 在 A 里无意义）。→ **v0.1 不支持跨文档组件引用**，`od validate` 报 `OD1114_UNRESOLVED_COMPONENT`（见 §8.4 V18 / V18b）。
>
> **已知的成本（不是缺陷，是取舍）**：实例的拷贝树进文件 → 体积与 diff 面积随实例数线性增长。缓解方案（只存主组件 + 重新物化）留到 v1（决策 I-1 的说明）。

**必须配套的测试**：

1. 造一个含「组件 + 3 个实例 + 实例属性赋值 + 子节点 override + 变体集」的文档，`fromEngine → toEngine → fromEngine`，断言两次 `fromEngine` 的输出**逐字节相同**。
2. 断言实例的**拷贝子节点出现在 od 文本里**，且每个拷贝节点的 `component.main` 指向主组件里对应的源节点。
3. 断言加载后实例的子节点数与源组件的子节点数一致，且引擎的实例同步**不会重复克隆**（拷贝节点的 `componentId` 已保留）。

---

### 4.2 自动布局

#### 4.2.1 引擎模型

自动布局相关字段共 **21 个**（§3.2 H 组），全部是标量或短数组：

| 维度 | 字段 |
| --- | --- |
| 模式 | `layoutMode`（NONE/HORIZONTAL/VERTICAL/GRID）、`layoutDirection`、`layoutWrap` |
| 主轴 | `primaryAxisAlign`、`primaryAxisSizing`、`itemSpacing` |
| 交叉轴 | `counterAxisAlign`、`counterAxisAlignContent`、`counterAxisSizing`、`counterAxisSpacing` |
| 内边距 | `paddingTop` / `paddingRight` / `paddingBottom` / `paddingLeft` |
| 子项定位 | `layoutPositioning`（AUTO/ABSOLUTE）、`layoutGrow`、`layoutAlignSelf` |
| 栅格 | `gridColumnGap`、`gridRowGap`、`gridTemplateColumns`、`gridTemplateRows`、`gridPosition` |
| 杂项 | `strokesIncludedInLayout`、`itemReverseZIndex` |

#### 4.2.2 od 侧结构

```jsonc
{
  "id": "frame~hero",
  "type": "FRAME",
  "name": "Hero",
  "parent": "canvas~page-1",
  "children": ["text~hero-title", "rect~hero-bg"],
  "box": { "width": 375, "height": 200 },
  "layout": {
    "mode": "VERTICAL",
    "direction": "LTR",
    "wrap": "NO_WRAP",
    "gap": 16,
    "crossGap": 16,
    "padding": { "top": 16, "right": 16, "bottom": 16, "left": 16 },
    "align": { "primary": "MIN", "counter": "MIN", "content": "AUTO" },
    "sizing": { "primary": "HUG", "counter": "FIXED" },
    "positioning": "AUTO",
    "grow": 0,
    "alignSelf": "INHERIT",
    "reverseZ": false,
    "includeStrokes": true
  }
}
```

**设计要点**：

1. **扁平 21 字段 → 嵌套 `layout` 对象**，因为扁平形态既难读又难 diff（改一次内边距要跨 21 行找）。
2. `padding` 四字段 → `padding.{top,right,bottom,left}`（保持四边显式，不做 `padding: 16` 简写——**简写会在「三边相同一边不同」时产生歧义**，且引擎有 `paddingFromShorthand` 反向工具，但 od 侧显式更利于 agent 精确 patch）。
3. `itemSpacing` → `layout.gap`、`counterAxisSpacing` → `layout.crossGap`（语义化命名；变量绑定路径同步改写，见 §3.5）。
4. `align` 组里 `primary` / `counter` / `content` 三个对齐语义放一起。

#### 4.2.3 往返会丢什么

| 潜在丢失 | 实际情况 | 结论 |
| --- | --- | --- |
| 自动布局子节点的 x/y | **照存**（§3.1.2 规则 G）。加载后若宿主跑了布局趟，可能被重算值覆盖 —— 文件本身无损 | **不丢** |
| HUG / FILL 轴的 width/height | **照存**（同上） | **不丢** |
| `layoutMode: 'GRID'` 的轨道语义 | `gridTemplateColumns/Rows`（`GridTrack[]`）原样保留 | **不丢**（能否正确渲染取决于 Yoga 的 grid 支持，§10 #2） |
| `layoutPositioning: 'ABSOLUTE'` 子节点的位置 | 照存（core 明确**不**回写绝对定位子节点的几何，§0.6） | **不丢** |
| 布局的「计算结果」本身 | 不存 | **正确**：结果是派生的 |

#### 4.2.4 结论

> ### ✅ **可行（布局意图无损；布局结果以文件为准）**
>
> **依据**：布局相关字段共 **26 个**（§4.2.1 的清单）：**21 个 flow / 约束字段**（§3.2 的 H 组）+ **5 个栅格字段**（§3.2 的 I 组：`gridColumnGap` / `gridRowGap` / `gridTemplateColumns` / `gridTemplateRows` / `gridPosition`）。
> 其中 **24 个是标量或字面量联合**，**2 个是对象数组**（`gridTemplateColumns` / `gridTemplateRows`，元素是 `GridTrack = {sizing, value}`）。除这 2 个外，其余与 JSON 一一对应，**无任何结构损失**。
> 这与 `docs/engine-semantics.md` §11.1 的判定一致：「布局意图 30 余字段全是标量/字面量联合，文本化零损耗」（该处「30 余」还含参考线叠层 `layoutGrids` 与页面标尺 `guides`，它们不属于布局语义本身）。
>
> **「结果不可靠」这半句怎么落到 od 侧**：布局计算不在 scene-graph，在 core 的 Yoga（`@open-pencil/yoga-layout@3.3.0-grid.3`），**几何结果（x/y/width/height）重算不保证与原值逐位相同**，且 Yoga flex 语义 ≠ Figma auto-layout。因此本规格的决策是：**几何照存，不靠重算**（§3.1.2 规则 G）。
> - 文件因此是引擎文档的**忠实快照** → 加载后无需跑布局趟，几何就是对的（od-format 不依赖 core，§9.2）。
> - 代价：宿主应用（带 core 的编辑器）若在加载后跑了布局趟且重算结果不同，下一次保存会产生一次 diff。**这是环境漂移（字体/Yoga 版本）导致的，不是丢数据。**
>
> **已核实的两处细节**（§0.6）：
> - core **确实会**把布局算出的 `x`/`y`/`width`/`height` 写回 `SceneNode`（`writeLayoutGeometry()`），且 `layoutPositioning === 'ABSOLUTE'` 的子节点**不参与**写回（`apply.js:126`）——即绝对定位子节点的几何是**作者值**，照存无争议。
> - `layoutMode: 'GRID'` **受支持**：core 依赖的是 grid 分支 Yoga，`configureAsGrid()` 会调用 `setDisplay(Display.Grid)` / `setGridTemplateColumns` / `setGridTemplateRows`（`core/dist/layout/grid.js:6-14`）。`gridTemplateColumns` / `gridTemplateRows` / `gridColumnGap` / `gridRowGap` / `gridPosition` 在 od 侧原样保留，**可完整还原**。
>
> **注意别混三样东西**（`docs/engine-semantics.md` §3.1 的提醒）：`layoutGrids` 是 Figma 画布上那层**可见参考线叠层**；`gridTemplateColumns/Rows` 是**网格布局**；`CanvasGuide` 是**页面标尺**。三者互不相干，od 侧分列在 `grid.grids` / `grid.template.*` / `guides`。

**必须配套的测试**：

1. 造一个 VERTICAL + HORIZONTAL + 嵌套 + ABSOLUTE 子项 + HUG/FILL 尺寸的文档，断言往返后 `layout` 组逐字段相同。
2. 断言 `box.x` / `box.y` / `box.width` / `box.height` **一律出现**（几何照存，§3.1.2 规则 G），且往返后**逐位相同**。
3. 断言绝对定位（`layoutPositioning: 'ABSOLUTE'`）子节点的几何在往返后逐位相同。

---

### 4.3 变量 + 主题模式

#### 4.3.1 引擎模型

| 概念 | 引擎载体 |
| --- | --- |
| 变量 | `Variable`（id / name / type / collectionId / valuesByMode / description / hiddenFromPublishing / scopes? / codeSyntax? / unit? / expressions? / pluginData? / key? / version?） |
| 变量集合（= 主题轴） | `VariableCollection`（id / name / modes[] / defaultModeId / variableIds[] / modeAttribute? / pluginData? / key? / version?） |
| 集合模式（= 主题取值） | `VariableCollectionMode`（modeId / name / condition? / sortPosition?） |
| 文档级当前模式 | `SceneGraph.activeMode: Map<collectionId, modeId>` |
| 节点级模式覆盖 | `SceneNode.variableModes: Record<collectionId, modeId>` |
| 节点级字段绑定 | `SceneNode.boundVariables: Record<fieldPath, variableId>` |

**变量值**是五路联合：`Color | number | string | boolean | { aliasId }`（§1.5.1 已给判别规则）。

#### 4.3.2 od 侧结构

见 §1.5 与 §1.6。要点重申：

- 变量 id → `var~` odId；集合 → `vcol~`；模式 → `mode~`。
- `values` 的键是**模式 odId**。
- 别名写成 `{ "alias": "var~other" }`（不是引擎的 `aliasId`）——**改名**，让 od 侧一眼看出这是引用。
- 颜色用浮点 `{r,g,b,a}`（§1.5.2）。
- 文档级当前模式在 `themes.active`；节点级覆盖在 `bindings.modes`。

#### 4.3.3 od 侧的「变量绑定」表达

**决策**：绑定**不**用「把字段值换成 `$varName` 字符串」的做法（竞品那种 `$` 前缀的思路）。od 侧用**独立的绑定表**：

```jsonc
{
  "id": "text~hero-title",
  "type": "TEXT",
  "name": "标题",
  "parent": "frame~hero",
  "children": [],
  "box": { "x": 24, "y": 40, "width": 327, "height": 48 },
  "text": { "content": "你好，世界", "font": { "size": 32 } },
  "bindings": {
    "fields": { "text.font.size": "var~font-title" },
    "modes": { "vcol~brand": "mode~brand-dark" }
  }
}
```

**为什么不用 `$` 前缀内联**：

| 维度 | `$` 前缀内联 | 独立绑定表（**选定**） |
| --- | --- | --- |
| 类型 | 字段值变成 `string \| number`，类型信息丢失 | 绑定与值分离，值的类型保持 |
| 歧义 | 字面量字符串 `"$brand"` 无法表达 | 无歧义 |
| 多个绑定 | 一个字段只能绑一个 | 天然支持 |
| 引擎能力对齐 | 引擎的 `boundVariables` 就是独立表 | **与引擎一一对应，零翻译** |
| agent 可写性 | 要解析字符串才知道是不是绑定 | 看 `bindings.fields` 一眼明白 |

**代价**：文件里同一个字段出现两次（`text.font.size` 的字面值 + `bindings.fields` 的绑定）。这是**刻意的冗余**：字面值是「绑定失效时的兜底」，引擎也需要它（`boundVariables` 与字段值并存）。

> 引擎侧的实现印证了这个模型：`bindVariable(nodeId, field, variableId)` **不修改**字段值，只在 `boundVariables` 里登记；渲染时用绑定值覆盖。

#### 4.3.4 往返会丢什么

| 潜在丢失 | 实际情况 | 结论 |
| --- | --- | --- |
| 绑定的字段路径 | 按 §3.5 双向翻译 | **不丢** |
| 绑定字段的**字面兜底值** | 照常写出 | **不丢**（引擎本来就要它） |
| 变量别名 | `{alias: "<odId>"}` | **不丢** |
| 多模式的变量取值 | `values{}` 的键是模式 odId | **不丢** |
| 节点的模式覆盖 | `bindings.modes` | **不丢** |
| 文档的当前模式 | `themes.active` | **不丢** |
| `Variable.expressions`（裸 CSS） | `{css, resolved}` 原样 | **不丢** |
| `Variable.codeSyntax`（Dev Mode 代码片段） | 原样 | **不丢** |
| `Variable.scopes` / `unit` / `description` / `hidden` | 原样 | **不丢** |
| **解析后的实际取值** | 不存 | **正确**：派生量，引擎运行时解析 |

#### 4.3.5 结论

> ### ✅ **可行（3 个坑已逐条封堵）**
>
> **依据**：变量体系的全部数据都是标量、字符串或短数组，**结构上无任何损失**。唯一的「坑」是变量值是五路联合（`Color` 与 `{aliasId}` 在 JSON 里都是对象），已用**形状判别**解决（§1.5.1），不依赖任何额外标记。
>
> **三个坑**（`docs/engine-semantics.md` §4.4 的 H1/H2/H3）与本规格的封堵：
>
> | 坑 | 后果 | 本规格的封堵 |
> | --- | --- | --- |
> | **H1（硬伤）** `fills` / `strokes` 数组必须**保序** | 绑定路径带位置下标；同长度重排会让绑定**静默指向另一个画笔**，引擎自己不修 | §3.6 规则 K4：**`fills` / `strokes` / `effects` 一律保持引擎原序**，MUST NOT 做「按类型归并」之类的重排。**MUST 有单测**断言重排后绑定仍指向同一元素 |
> | **H2** 两个 scale 字段不能无条件丢 | `variableBindingScales` 是绑定值的单位乘数，scale ≠ 1 时丢掉，绑定会**解出不同的数** | §3.1.4 **D2 必留**：`bindings.scales` / `bindings.assignmentScales` |
> | **H3** 主题**两层**都要存 | 只存文档级 `activeMode` 会丢掉节点级的主题锁定 | 本规格两层都存：文档级 `themes.active`（`activeMode`）+ 节点级 `bindings.modes`（`variableModes`） |
>
> **实现提醒**：加载时**直接写 `boundVariables` 字段**，MUST NOT 调 `bindVariable()`——后者会 `assignVariableBindingUnits()` 重算并覆盖我们要保留的 `variableBindingScales`（§3.5 末尾）。
>
> **附加条件**：变量 id 的 odId 化要求引擎侧接受 `var~xxx` 作为 `Variable.id`（已在 §2.10 确立为全局策略）。

**必须配套的测试**：

1. 造一个含「2 个集合 × 3 个模式 × 4 个变量（含颜色/数字/字符串/布尔/别名）× 节点绑定 × 节点模式覆盖」的文档，断言往返逐字段相同。
2. 断言 `bindings.fields` 的每个键都能翻译回引擎白名单字段名（**照 `variables/fields.ts` 的集合逐条断言**）。
3. 断言别名指向的变量存在。

---

### 4.4 已知信息损失总表（诚实清单）

以下是**已知会被丢弃**的引擎数据。它们全部属于「派生缓存」或「外部格式溯源」，不属于设计意图。**任何一条要恢复，都必须改本规格。**

| 丢失项 | 引擎位置 | 原因 | 影响 |
| --- | --- | --- | --- |
| `derivedLayout` | 节点 | D1 派生缓存 | 无（core 重算） |
| `derivedTextGlyphs` | 节点 | D1 派生缓存 | 无（重新整形） |
| `textPicture` | 节点 | D1 派生缓存（Skia 段落快照） | 无（重算） |
| `instanceIndex` | 文档 | 派生索引 | 无（重算） |
| `positionPreviewVersion` | 文档 | 运行时计数 | 无 |
| `figKiwiVersion` / `figSchemaDeflated` | 文档 | `.fig` 导入溯源 | **`.fig` 导出保真度下降**（见下） |
| `source.fig` 载荷 | 节点 | `.fig` 导入溯源 | **同上** |
| 引擎原生 node id | 全局 | 被 odId 取代 | **odId 不跨 `.fig` 往返保持**（§2.12）——`.fig` 是导出通道，不是同步通道 |
| 用户写在文件里的注释 | 文件层 | v0.1 写出时不保留（§6.1） | 用户手写注释在下次保存时被清掉 |
| 引擎的 `absPosCache` | 文档（private） | 纯缓存，不可序列化 | 无（`clearAbsPosCache()` 可清） |
| module 级 `WeakMap`（`syncingComponentsByGraph` / `removedCopies` / `activeRemovals`） | 模块 | 随图存活，不进文档 | 无 |
| 共享样式 id | 节点 `styles.*` | 派生自 `source.id`，**保留** | 无 |

> **`.fig` 保真度的连带影响**：丢弃 `source.fig` 与 `figSchemaDeflated` 后，**`.fig` 导出不能 100% 还原原始 .fig 文件**。若产品需要「.od.json ⇄ .fig 无损」，必须在 v1 之前决定：把 `source.fig` 作为**不透明的二进制附件**存进 `assets/`（类似图片外置），还是接受 `.fig` 导出的有损。**本规格 v0.1 选择接受有损**，并在 `od convert --to fig` 的文档里明示。

### 4.5 三类骨头的验收红线（写进 Phase 1 的验收标准）

`docs/PLAN.md` Phase 1 的验收是「复杂设计（组件+自动布局+变量）round-trip 无损」。落到可执行的断言：

| # | 断言 | 判据 |
| --- | --- | --- |
| T1 | 组件往返 | 含组件/变体集/实例/属性赋值/子节点 override 的文档，`fromEngine → toEngine → fromEngine` 两次输出**逐字节相同** |
| T2 | 实例拷贝树完整 | od 文本里**含**实例的拷贝子节点，且每个拷贝节点的 `component.main` 指向主组件里对应的源节点 |
| T3 | 自动布局往返 | 26 个布局相关字段（21 flow/约束 + 5 栅格）往返后逐字段相同；`box.x/y/width/height` **一律照存**且往返逐位相同 |
| T4 | 变量往返 | 变量/集合/模式/绑定/别名/模式覆盖往返后逐字段相同 |
| T5 | 全字段覆盖 | 154 个引擎字段**每一个**都有明确的 od 映射（§3.2 全表），单测断言「无遗漏」 |
| T6 | 派生字段两档 | D1 的 3 个节点字段**一个都不出现**；D2 的 2 个字段在有值时**一定出现** |
| T7 | 幂等 | `stringify(fromEngine(toEngine(doc)))` 与 `stringify(doc)` 在**规范化后**逐字节相同 |
| T8 | 确定性 | 同一引擎文档连续 `fromEngine` 两次，输出逐字节相同（含新铸 odId 的分配） |

---

## 5. 版本策略与迁移框架

### 5.1 `version` 字段的语义

od 文档的 `version` 字段是 **格式版本**（不是工具版本）。工具版本在 `meta.generator`。

**格式**：`<MAJOR>.<MINOR>`，十进制，无前导零。当前：`"0.1"`。

| 位 | 何时递增 | 对文件的含义 |
| --- | --- | --- |
| **MAJOR** | 破坏性变更：删除/改名/改类型的字段、改变 id 语义、改变枚举取值域 | 需要迁移器；旧文件不能被新工具直接读 |
| **MINOR** | 向后兼容变更：新增**可选**字段、新增 kind 前缀、新增枚举值、放宽校验 | 旧工具能读新文件（按 §5.5 的未知键策略） |

**明确不做 PATCH 位**：格式层的勘误（改错别字、修描述）**不升版本**。理由：版本号是给「文件结构可能不同」的读者看的；勘误不改变结构，升版本只会制造无意义的迁移。

> **实现提示**：`packages/od-format/src/index.ts` 现有 `export const OD_FORMAT_VERSION = '0.1.0'`。实现任务**应改为** `'0.1'`（格式版本），另加 `OD_FORMAT_PACKAGE_VERSION = '0.1.0'`（包版本，进 `meta.generator`）。**本规格不修改 packages/ 下任何文件**，此处仅作交接说明。

**版本号与迁移的关系**：`version` 是**文档自称的版本**。工具读到高于自己支持的版本 → 拒绝（§5.6），不做「尽力而为」的猜测。

### 5.2 迁移器接口

```ts
export type OdVersion = `${number}.${number}`

export interface OdMigration {
  /** 源版本（精确匹配）。 */
  from: OdVersion
  /** 目标版本（精确匹配）。 */
  to: OdVersion
  /** 一句话说明，写进 CLI 的迁移日志。 */
  description: string
  /** 是否是破坏性迁移（破坏性迁移 MUST 在 CHANGELOG 记录）。 */
  breaking: boolean
  /** 执行迁移。 */
  migrate(doc: OdDocument): OdDocument
}

/** 主入口。 */
export function migrate(doc: unknown, from: OdVersion, to: OdVersion): OdDocument
```

**语义**：

1. `from` 与 `to` 相等 → 原样返回（但仍**必须**校验）。
2. `from` → `to` 通过**迁移链**完成：注册表里存在一条从 `from` 到 `to` 的路径（每步恰好升/降一个版本），逐个应用。
3. 找不到路径 → 抛 `OdMigrationError`（**MUST NOT** 猜测或做有损降级）。
4. `migrate` **MUST** 是纯函数：同样的输入 → 同样的输出，**MUST NOT** 修改入参。

**迁移链示例**：

```
0.1 --[0.1→0.2]--> 0.2 --[0.2→1.0]--> 1.0
```

`migrate(doc, '0.1', '1.0')` = 先应用 `0.1→0.2`，再应用 `0.2→1.0`。

### 5.3 迁移器注册表与版本 schema 留存

```ts
export const migrations: readonly OdMigration[] = [ /* 按 from 升序 */ ]

/** 每个历史版本保留一份只读 zod schema，用于「按旧版本校验后再迁移」。 */
export const schemas: Record<OdVersion, z.ZodType> = { '0.1': OdDocumentV01 }
```

**MUST**：每个版本在发布时**冻结**其 zod schema（放在 `packages/od-format/src/versions/v0.1.ts` 之类的地方），**永不修改**。改了等于让旧文件的语义漂移。

### 5.4 v0.1 → v1 的迁移怎么写（完整示例）

v1.0 的假想破坏性变更（用于示范迁移器的写法，**不是已定的产品决策**）：

> 把外观组 `appearance.*` 改名为 `style.*`，并把 `text.content` 改名为 `text.value`。

```ts
export const migrate_0_1_to_1_0: OdMigration = {
  from: '0.1',
  to: '1.0',
  description: 'appearance.* → style.*；text.content → text.value',
  breaking: true,
  migrate(doc) {
    const next = structuredClone(doc) as any
    next.version = '1.0'
    for (const node of next.nodes) {
      if (node.appearance) {
        node.style = node.appearance
        delete node.appearance
      }
      if (node.text && 'content' in node.text) {
        node.text.value = node.text.content
        delete node.text.content
      }
      // 绑定路径同步改写（§3.5 的表必须一起迁移）
      if (node.bindings?.fields) {
        const fields: Record<string, string> = {}
        for (const [path, varId] of Object.entries(node.bindings.fields)) {
          fields[path.replace(/^appearance\./, 'style.')
                   .replace(/^text\.content$/, 'text.value')] = varId
        }
        node.bindings.fields = fields
      }
    }
    return next as OdDocument
  }
}
```

**这个示例要说明的四件事**：

1. **迁移器必须同时改「值」和「路径」**。只改字段名不改绑定路径 = 绑定静默失效（**最危险的迁移 bug**）。
2. **迁移器改完必须能被新 schema 校验**。`migrate()` 的实现 MUST 在返回前用 `schemas[to]` 做一次 `parse`。
3. **迁移器 MUST NOT 依赖 od-format 的当前默认值**（不能靠「省略 = 默认」来偷懒）。
4. **迁移器 MUST 是纯函数 + 深拷贝**，不得就地改入参（调用方可能想保留原文档做 diff）。

### 5.5 未知字段策略（向前兼容）

| 位置 | 策略 | 理由 |
| --- | --- | --- |
| 顶层对象 | **宽松**（保留未知键） | 新版本加的顶层段不该让旧工具直接报错 |
| 节点对象 | **宽松**（保留未知键） | 同上 |
| 叶子结构（`fills[]` 的元素、`layout` 组等） | **严格** | 叶子结构未知 = 真的不认识，无法安全透传 |

**代价**：打错字（`widht`）会被宽松接受。**缓解**：`od validate --strict` 把「未知键」报为 warning（§8.4）。

**写出时的行为**：宽松对象里**保留**的未知键，会被原样写回文件（透传）。但**这不保证数据无损**——旧工具不认识新语义，写回时可能破坏新格式的语义。**因此文档明确要求**：

> **不要用旧版本的 od-format 打开新版本的文件再保存。** `od validate` 在遇到比自己新的 `version` 时**直接拒绝**（退出码 3），不做「尽力而为」。

### 5.6 迁移的可测性

**「可逆」的准确定义**：格式迁移**不需要可逆**（前向迁移是常态）。本规格要求的「可逆」实际是三条可测的不变式：

| # | 不变式 | 测试 |
| --- | --- | --- |
| **M1 确定性** | 同一输入永远得到同一输出 | 同一 fixture 迁移两次，断言结果逐字节相同 |
| **M2 幂等** | `migrate(migrate(x, a, b), a, b)` ≡ `migrate(x, a, b)` | 幂等测试 |
| **M3 无损（除声明的破坏性变更外）** | 迁移只改「迁移器声明要改的字段」 | 断言迁移前后除白名单外**深度相等** |

**每个迁移器 MUST 配套的测试**：

```ts
describe('migration 0.1 → 1.0', () => {
  it('把 appearance.* 改名为 style.*', () => { /* ... */ })
  it('把 text.content 改名为 text.value', () => { /* ... */ })
  it('同步改写变量绑定路径', () => { /* ... */ })
  it('迁移后能被 v1 schema 校验', () => { /* ... */ })
  it('是幂等的', () => { /* ... */ })
  it('除白名单外不改动其它字段', () => { /* ... */ })
})
```

**Fixture 目录**（约定）：

```
packages/od-format/tests/fixtures/
  v0.1/minimal.od.json
  v0.1/components.od.json
  v0.1/autolayout.od.json
  v0.1/variables.od.json
  v0.1/edge-cases.od.json
  v1.0/...            # 迁移后的期望输出（快照）
```

**降级**：`migrate(doc, '1.0', '0.1')` 若无降级器 → 抛 `OdMigrationError`，**MUST NOT** 做有损降级（悄悄丢字段比报错更糟）。

### 5.7 版本策略表

| 版本 | 日期 | 变更 | 迁移器 | 破坏性 |
| --- | --- | --- | --- | --- |
| `0.1` | 2026-11-10 | 初始版本（本规格） | — | — |
| `1.0` | 待定 | 示例：`appearance.*`→`style.*`；`text.content`→`text.value` | `0.1 → 1.0` | 是 |

**发布纪律**：

1. **格式版本与包版本解耦**。包版本（`0.1.0`）每次发布都变；格式版本只在结构变化时变。
2. **格式版本变更 MUST 附带**：(a) 迁移器；(b) 冻结的旧 schema；(c) fixture 测试；(d) CHANGELOG 条目；(e) 公开 JSON Schema 的新版本文件（§7）。
3. **破坏性变更 MUST NOT** 在同一个包版本里「悄悄」发生——必须先发布带迁移器的新格式版本。

---

## 6. 文本形态

### 6.1 JSONC 注释容忍

**决策**：

- **读**：**MUST** 容忍 JSONC 注释（`//` 行注释、`/* */` 块注释）。
- **写**：**MUST NOT** 输出注释。
- **注释在往返中丢失**（写出时丢弃）。这是 v0.1 的**显式取舍**，写在这里以免被当成 bug。

**为什么容忍**：

1. 人需要在设计文件里写「这一块是给运营的临时稿，别动」——注释是自然的载体。
2. agent 也可能写注释标注意图。
3. 竞品也允许注释（**仅借鉴「允许注释」这个思路，不借鉴其实现**）。

**为什么写出时丢弃**：

1. 保留注释需要维护「文本位置 ↔ 语义节点」的映射表（source map），成本高、复杂度大。
2. 文件是**生成物**，注释应该写在 commit message / issue / 设计文档里，而不是生成物里。
3. 保留注释会与「固定键序 + 规范化写出」冲突（注释位置必须跟着键走）。

**实现要求**：

- MUST 实现 `stripJsonComments(text: string): string`，**自己写**，不引入新依赖（od-format 目前只有 `zod` 一个运行时依赖）。
- MUST 正确处理字符串字面量内的 `//`、`/*`、`*/`（含转义引号 `\"`）。
- MUST 拒绝「字符串未闭合」的错误（交给 `JSON.parse` 报错，但错误信息里要指出是哪个字符位置）。
- 建议实现方式：单遍扫描器，跟踪 `inString` / `inLineComment` / `inBlockComment` 三态；注释内容替换为等长空格（**保持字符偏移不变**，这样 `JSON.parse` 的报错行号仍然准确）。这个「等长空格」技巧 MUST 采用。

> **后续版本可考虑**：保留注释（需 source map）。v0.1 不做，但 §5.5 的宽松顶层对象已经为「未知键透传」留了门。

### 6.2 键顺序策略

**规则 K1（MUST）**：每个 od 对象类型的键顺序**固定**，由本规格定义（见 §1.3 的节点键序，以及各小节给出的键序）。

**规则 K2（MUST）**：实现**MUST** 在写出前显式重排键，**MUST NOT** 依赖 zod 的 parse 输出顺序或 JS 对象的插入序细节。

```ts
// 实现要点
function orderKeys<T>(obj: T, order: readonly string[]): T {
  const out: Record<string, unknown> = {}
  for (const k of order) if (k in obj) out[k] = (obj as any)[k]
  // 未列出的键（宽松对象的透传键）按字典序追加
  for (const k of Object.keys(obj).sort()) if (!(k in out)) out[k] = (obj as any)[k]
  return out as T
}
```

**规则 K3**：**自由格式对象的键 MUST 按字典序**（§3.6）。

**为什么固定键序是硬要求**：JSON 对象的键序在文本里是可见的。不固定 → 两次保存同一份文档可能键序不同 → diff 全是噪音 → **C2 破**。JSON 本身不保证键序（RFC 8259 只说「 SHOULD 保持不变」），所以**必须由写出版本主动保证**。

**规则 K4（MUST）**：`nodes[]` 按前序遍历序；`variables[]` / `variableSets[]` / `libraries[]` 按 `id` 字典序；`assets{}` 按键字典序；其余数组**保持引擎原序**（顺序有语义：`children`、`variableSets[].variables[]`、`fills`、`strokes`、`effects`、`text.paragraphs`、`text.runs`、`grid.template.columns` 等）。

### 6.3 缩进、换行、编码

| 项 | 规定 |
| --- | --- |
| 缩进 | **2 空格** |
| 换行符 | **LF**（`\n`）。MUST NOT 输出 CRLF |
| 文件末尾 | **单个 LF** |
| BOM | **MUST NOT** 输出；读取时若存在则剥离 |
| 行宽 | 无硬限制（JSON 不支持行注释式折行） |
| 空对象 | `{}`（不展开） |
| 空数组 | `[]`（不展开） |

### 6.4 浮点精度

**规则 F1（MUST）**：**禁止四舍五入**。所有数字用 **JS `Number` 的最短往返表示**输出（`JSON.stringify` 的默认行为即是）。

理由：`0.1 + 0.2 === 0.30000000000000004` 是那个 double 的**唯一精确值**。四舍五入到 6 位会把它变成 `0.3`，加载回来是**另一个 double** → 违反 **C1 无损红线**。

**规则 F2**：MUST 归一化 `-0` → `0`（`Object.is(-0, 0)` 为 false，但语义等价；JSON.stringify 本来也写 `0`）。

**规则 F3**：MUST 拒绝 `NaN` / `±Infinity`。`JSON.stringify` 会把它们写成 `null`（静默丢数据）→ 编码器 MUST 抛 `OdEncodeError`。

**规则 F4（可选精度档）**：`--precision 6` 模式把**所有**数字四舍五入到 6 位小数写出，读取时也按 6 位小数解释。这会**牺牲 C1**，仅供「想要干净 diff」的场景使用，且 MUST 在写出时于 `meta` 里标注（`"precision": 6`）。

> **默认是 `exact`**。`--precision 6` 是显式选择。

**几何 blob（`commandsBlob`）的编码**：引擎的 blob 是「1 字节 opcode + float32 小端坐标对」（`0=close, 1=move, 2=line, 3=quad, 4=cubic`，`geometry.ts:319-327`），与 SVG path 的 `Z/M/L/Q/C` 一一对应。

**决策 G-1**：用 **SVG path `d` 字符串**表示 `commandsBlob`。

- 理由：人类可读、diff 友好（改一个顶点只改一行里的几个数），且**可无损互转**（opcode 表与 SVG path 的 `Z/M/L/Q/C` 一一对应）。
- **MUST NOT 直接使用 core 的 `geometryBlobToSVGPath()`**：它默认 `decimals = 2`（`core/dist/io/formats/svg/paths.js:18`），**有损**。od-format **MUST** 自己实现双向转换（od-format 不依赖 core）。

**无损精度的具体算法（MUST）**：

```
// blob → d（每个坐标）
function encodeCoord(v: number): string {
  const f = Math.fround(v)                 // 源值本来就是 float32
  for (let sig = 1; sig <= 9; sig++) {
    const s = f.toPrecision(sig)           // 最短的 sig 位有效数字表示
    if (Math.fround(Number(s)) === f) return trimZeros(s)
  }
  return f.toString()                      // 兜底
}

// d → blob（每个坐标）
const f = Math.fround(Number(token))        // 必须先 fround 再写 float32
```

**为什么这个算法是无损的**：`Math.fround(Number(s)) === f` 是**充分必要条件**——它直接检验「解析回来再转 float32 是否等于原值」。逐坐标成立 ⇒ 整条路径逐字节还原。float32 只有约 7 位十进制有效数字，所以 `sig ≤ 9` 一定收敛。

**可读性收益**：算法会挑**最短**的表示，于是 `100.10000000149012` 会被写成 `100.1`，而 `0.1`（float32）会被写成 `0.1`。

**验收断言（MUST）**：
1. 随机生成 1000 条 blob → `d` → blob，**逐字节相同**。
2. `d` 字符串 MUST 只含 `[0-9.\-+eE M L Q C Z 空格]`。
3. 坐标 MUST NOT 输出 `NaN` / `Infinity`（遇到即抛 `OdEncodeError`）。

> **降级方案（仅当上面的算法实测失败时启用）**：把 blob 以 base64 存进 `geometry.fill[].blob`，牺牲可读性保无损。**本规格判定算法 A 无损，不需要降级**（依据：float32 ⊂ double，`Number(f).toPrecision(sig)` 的 `fround` 检验是精确判据）。

### 6.5 Unicode 转义策略

**规则 U1**：**MUST NOT** 转义非 ASCII 字符。中文、日文、emoji **原样输出**（`JSON.stringify` 默认行为）。

**规则 U2**：MUST 按 JSON 规范转义：`"` → `\"`，`\` → `\\`，控制字符（U+0000–U+001F）→ `\b` `\f` `\n` `\r` `\t` 或 `\u00XX`。

**规则 U3**：MUST NOT 转义 `/`（`\/` 合法但没必要，且难看）。

**规则 U4**：MUST 转义 U+2028 / U+2029（行分隔符/段分隔符）→ `\u2028` / `\u2029`。它们在 JSON 里合法，但一旦文件被内联进 JS 源码就会破坏脚本。代价极低。

**规则 U5**：MUST 拒绝**孤立代理项**（lone surrogate）→ 抛 `OdEncodeError`（否则会产生非法 UTF-8）。

**规则 U6**：MUST NOT 做 Unicode 规范化（NFC/NFD）。**例外**：odId 的 slug 生成 MUST 做 NFKD 折叠（§2.4）——那只影响 id，不影响用户文本。

**规则 U7**：读取时 MUST 剥离 BOM（MUST NOT 写入）。

### 6.6 短数组的单行输出

**规则 S1**：**纯标量数组**且元素数 ≤ 4 时，MUST 单行输出。

```jsonc
"dash": [4, 2],
"gaps": [1, 1, 1, 1]
```

而不是：

```jsonc
"dash": [
  4,
  2
]
```

数组元素含对象时（`fills`、`strokes`、`effects`、`text.runs`、`text.paragraphs`、`component.properties`）**MUST** 展开成多行。

**实现**：MUST 用**自定义序列化器**，MUST NOT 用 `JSON.stringify(doc, null, 2)`（它总是展开数组）。自定义序列化器的规模约 80–120 行，规则：

```
writeValue(v, indent):
  - number/string/bool/null → 字面量
  - Array:
      若全部元素是标量 且 长度 ≤ 4 → "[" + 元素.join(", ") + "]"
      否则 → "[\n" + 每项 writeValue(v, indent+1) + ",\n" ... + "]"
  - Object → "{\n" + 每键 "key": writeValue(...) + ",\n" ... + "}"
```

> 顶层数组 `nodes[]` 里的元素是对象 → 展开 ✔；`fills[]` 里的元素是对象 → 展开 ✔；`dash` 是标量数组 → 单行 ✔。

### 6.7 完整文本样例

见 **附录 B**。

---

## 7. 公开 JSON Schema

### 7.1 生成方式

**决策**：用 **zod v4 自带的 `z.toJSONSchema()`** 生成。

理由：

1. zod 已是 od-format 的运行时依赖（`zod@4.6.7`），**不新增依赖**。
2. **单一真相源**：校验用的 zod schema 与发布的 JSON Schema 是同一份定义，**天然不会脱节**。
3. zod v4 的 JSON Schema 输出目标可选 `draft-2020-12`。

```ts
import { z } from 'zod'

export const OdDocumentSchema = z.looseObject({ ... })   // 见 §1 / §3

export const odDocumentJsonSchema = z.toJSONSchema(OdDocumentSchema, {
  target: 'draft-2020-12',
  // 顶层 $id / title / description 通过 .meta() 提供
})
```

**Schema 的元信息（MUST）**：

| 项 | 值 |
| --- | --- |
| `$schema` | `https://json-schema.org/draft/2020-12/schema` |
| `$id` | `https://opendesigner.dev/schema/od-format/0.1.schema.json` |
| `title` | `OpenDesigner od-format document` |
| `description` | 指向本文档 `docs/od-format-spec.md` |

**每个字段 MUST 有 `description`**（用 zod 的 `.describe()`），因为这份 schema 是**给 agent 读的契约**——agent 靠 description 判断字段含义，比靠名字猜可靠得多。

**odId 字段 MUST 带 `pattern`**（§2.2 的正则），让编辑器/IDE 能即时校验。

### 7.2 产物位置

```
packages/od-format/
  schema/
    od-format-0.1.schema.json        # 当前版本的公开 schema（签入 git）
    index.json                        # 版本索引：{ "0.1": "./od-format-0.1.schema.json" }
  scripts/
    gen-schema.ts                     # 生成脚本
```

**MUST 签入 git**（不是 build 产物）——理由：用户/agent 需要**在本地、离线、无需构建**就能拿到 schema 去做校验与代码生成。

**同时在仓库根提供一份拷贝** `docs/schema/od-format-0.1.schema.json`？→ **不做**（两份会漂移）。需要分发时，用 `od schema --print`（§8.5）导出。

### 7.3 防脱节机制

**这是本节的重点**——公开 schema 最常见的失败模式是「实现改了，schema 没改」。

| # | 机制 | 说明 |
| --- | --- | --- |
| **S1 单一真相源** | schema 由**校验用的同一份 zod 定义**生成 | 不存在「两份定义」的问题 |
| **S2 快照测试** | 单测重新生成 schema，与签入的文件**逐字节比对** | 任何 zod 改动都会让测试失败，强制同步 |
| **S3 CI 检查** | `npm run schema:check`（等价于跑那个单测） | 合并前拦住 |
| **S4 版本文件** | 每个历史版本一份 `od-format-<v>.schema.json` | 旧文件的校验器不会随新版本漂移 |
| **S5 版本索引** | `schema/index.json` 列出所有版本 | 工具可以按版本选 schema |
| **S6 发布门禁** | `npm publish` 前跑 `schema:check` | 防止发了不一致的包 |

**测试代码形态**：

```ts
import { readFileSync } from 'node:fs'
import { odDocumentJsonSchema } from '../src/schema'

it('公开 JSON Schema 与实现同步', () => {
  const committed = readFileSync(new URL('../schema/od-format-0.1.schema.json', import.meta.url), 'utf8')
  expect(JSON.stringify(odDocumentJsonSchema, null, 2) + '\n').toBe(committed)
})
```

### 7.4 Schema 的覆盖面

**MUST** 覆盖：

- 顶层 9 个键及其类型。
- 节点对象的全部组（`box` / `limits` / `appearance` / `corners` / `flip` / `constraints` / `styles` / `fills` / `strokes` / `effects` / `geometry` / `shape` / `grid` / `guides` / `text` / `layout` / `stroke` / `borders` / `component` / `bindings` / `export` / `pluginData` / `pluginRelaunch` / `source`）。
- 所有枚举的取值域（`type`、`layout.mode`、`blendMode`、`fill.type` 等）。
- odId 的 `pattern`。
- 变量值的五路联合（`oneOf` + `alias` 与颜色的判别）。

**MUST NOT** 覆盖：引擎内部概念（`engineId`、`derivedLayout` 等）——它们在 od 里不存在，出现即为错。

---

## 8. CLI 契约

### 8.1 全局约定

```
od <command> [options] [args]
```

| 命令 | 作用 |
| --- | --- |
| `od convert` | 文档格式转换（双向） |
| `od inspect` | 打印文档摘要（人读 / 机器读） |
| `od validate` | 校验文档 |
| `od migrate` | 版本迁移（v0.1 建议实现，见 §5.6） |
| `od schema` | 导出公开 JSON Schema（v0.1 建议实现，见 §7.2） |

**全局选项**：

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `--help`, `-h` | — | 打印用法，退出码 0 |
| `--version`, `-V` | — | 打印 `od-format/<pkg version>`，退出码 0 |
| `--json` | off | 机器可读输出（stdout 为 JSON） |
| `--quiet`, `-q` | off | 只输出错误 |
| `--no-color` | 自动 | 关闭 ANSI 颜色（非 TTY 时自动关闭） |

**输出约定**：

- **正常结果 → stdout**；**诊断/进度 → stderr**。
- `--json` 时，stdout **只**有一个 JSON 文档（无任何其它输出混进去）。

### 8.2 `od convert`

```
od convert [options] <input> [output]
```

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `--from <fmt>` | 按扩展名推断 | `od` \| `engine` \| `fig` \| `auto` |
| `--to <fmt>` | 按输出扩展名推断；无输出则 `od` | 同上 |
| `--assets <dir>` | 与输出同目录下的 `assets/` | 资源目录 |
| `--precision <p>` | `exact` | `exact` \| `6`（§6.4 F4） |
| `--force` | off | 覆盖已存在的输出 |
| `--check` | off | 只比对，不写；输出有差异则退出码 2 |
| `--id-strategy <s>` | `od` | `od` \| `native`（§2.12） |

**格式标识与载体**：

| `--from/--to` | 载体 | 说明 |
| --- | --- | --- |
| `od` | `.od.json` | 本格式 |
| `engine` | `.odgraph.json` | **引擎文档的原生 JSON 转储**（见下） |
| `fig` | `.fig` | Figma 二进制。**需要 `@open-pencil/core`**（可选 peer 依赖）；未安装 → 退出码 3 |

**`engine` 载体的定义**（`od convert` 的「引擎文档 ⇄ od 文本」另一侧）：

`engine` 格式是**引擎文档模型的无损 JSON 转储**，用**引擎自己的字段名**（不做任何重命名/分组），供「已经持有引擎文档」的场景使用，也是往返测试的对照组。

```jsonc
{
  "kind": "openpencil-scene-graph",
  "version": 1,
  "rootId": "48213:1",
  "nodes": [ { "id": "48213:1", "type": "FRAME", "name": "Document", "childIds": ["48213:2"], /* ...其余 154 字段... */ } ],
  "images": { "a3f5c1...": { "0": 137, "1": 80, "2": 78 } },
  "variables": [ { "id": "48213:9", "name": "primary", "type": "COLOR", "collectionId": "48213:8", "valuesByMode": { "48213:10": { "r": 0, "g": 0, "b": 0, "a": 1 } }, "description": "", "hiddenFromPublishing": false } ],
  "variableCollections": [ { "id": "48213:8", "name": "Brand", "modes": [ { "modeId": "48213:10", "name": "Light" } ], "defaultModeId": "48213:10", "variableIds": ["48213:9"] } ],
  "activeMode": { "48213:8": "48213:10" },
  "documentColorSpace": "srgb",
  "enabledLibraries": []
}
```

**`engine` 载体的编码规则**（与 od 同样的通用规则，但字段名保持引擎原样）：

| 项 | 规则 |
| --- | --- |
| `nodes` | 引擎 `SceneNode` 的**完整展开**（154 字段，`undefined` 的键直接不写） |
| `Map` | 转对象 |
| `Uint8Array` | 转 `{"0":137,"1":80,...}`（**JS 原生 JSON 形态**，上游剪贴板格式同款） |
| 派生字段 | **保留**（这是引擎文档的忠实转储，不是 od 格式） |
| 键序 | 引擎声明顺序 |

**为什么要这个载体**：§8 的 CLI 契约要求「引擎文档 ⇄ od 文本」双向可转。`engine` 载体让这条链路**只依赖 `@open-pencil/scene-graph`**（不需要 core），因此 **v0.1 就能完整实现并测试**。`.fig` 是后续增强。

**行为约定**：

| 情形 | 行为 |
| --- | --- |
| 未给 `output` | 写到 **stdout**（供管道使用） |
| `output` 已存在且未加 `--force` | **拒绝写入**，退出码 4，提示用 `--force` |
| `--to od` 且输入是 `engine` | 铸造 odId（§2.8 优先级 3），**首次转换会生成新 id** |
| `--from od` 且输入是 `od` | 规范化重写（键序/缩进/精度统一），这是**预期的** |
| 输入文件不存在 | 退出码 4 |
| 输入格式无法识别 | 退出码 3 |
| 文档 `version` 高于工具支持 | 退出码 3 |
| 资源文件缺失（`od → engine` 需要图片） | 退出码 2（校验失败），逐个列出缺失资源 |

**幂等性要求（MUST）**：`od convert a.od.json b.od.json` 后再 `od convert b.od.json c.od.json`，**b 与 c MUST 逐字节相同**。

### 8.3 `od inspect`

```
od inspect [options] <input>
```

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `--format <f>` | `text` | `text` \| `json` |
| `--depth <n>` | 无限 | 树的最大深度（`text` 模式） |
| `--paths` | off | 额外打印每个节点的**派生路径**（如 `Page 1 / Hero / 标题`）——路径**不在文件里**，是运行时派生的（§2.4 的理由） |
| `--ids` | off | 打印 odId → 引擎 id 的映射（`engine` 载体输入时才有意义；`od` 输入时该映射是恒等的） |
| `--stats` | off | 只打印统计（节点数、各类型计数、变量数、组件数、资源数） |
| `--select <id>` | — | 只看某个子树 |
| `--grep <re>` | — | 只打印 odId 或 name 匹配正则的节点 |

**`text` 输出形态**（示例）：

```
od-format 0.1 · 引擎 @open-pencil/scene-graph@0.16.0
Document (FRAME)                                    frame~document
├─ Page 1 (CANVAS)                                 canvas~page-1
│  └─ Hero (FRAME)  375×200                        frame~hero
│     ├─ 标题 (TEXT)  327×48  "你好，世界"           text~hero-title
│     └─ 背景 (RECTANGLE) 375×200                  rect~hero-bg
统计: 节点 5 · 变量 2 · 集合 1 · 组件 0 · 实例 0 · 资源 0
```

**`json` 输出形态**（**给 agent 用**，MUST 稳定）：

```json
{
  "ok": true,
  "command": "inspect",
  "format": "0.1",
  "engine": "@open-pencil/scene-graph@0.16.0",
  "root": "frame~document",
  "counts": { "nodes": 5, "byType": { "FRAME": 2, "CANVAS": 1, "TEXT": 1, "RECTANGLE": 1 },
              "variables": 2, "variableSets": 1, "components": 0, "instances": 0, "assets": 0 },
  "tree": [
    { "id": "frame~document", "type": "FRAME", "name": "Document",
      "path": ["Document"], "children": ["canvas~page-1"] },
    { "id": "canvas~page-1", "type": "CANVAS", "name": "Page 1",
      "path": ["Document", "Page 1"], "children": [] }
  ],
  "variables": [ { "id": "var~brand-primary", "name": "brand/primary", "type": "COLOR", "set": "vcol~brand" } ],
  "variableSets": [ { "id": "vcol~brand", "name": "Brand", "modes": ["mode~brand-light", "mode~brand-dark"] } ],
  "assets": [],
  "warnings": []
}
```

**`tree[]` 是扁平的**（每项带 `path` 数组表示层级），与 od 文件的扁平 `nodes[]` 一致。

**MUST NOT** 在 `inspect` 里修改任何东西（只读命令）。

### 8.4 `od validate`

```
od validate [options] <input>
```

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `--strict` | off | 把 warning 升级为 error |
| `--schema <path>` | 自动按版本选 | 指定 schema 文件 |
| `--no-assets` | off | 跳过资源文件的存在性检查（CI 里资源不在本地时用） |
| `--json` | off | 机器可读 |

**校验项（规范性）**：

| # | 检查 | 错误码 | 级别 |
| --- | --- | --- | --- |
| V1 | JSONC 可解析（注释容忍） | `OD1001` | error |
| V2 | `version` 存在且被本工具支持 | `OD1003` | error（不支持的更高版本 → 退出码 3） |
| V3 | `format === "od"` | `OD1004` | error |
| V4 | zod schema 校验（按版本） | `OD1100` | error |
| V5 | 顶层键顺序/未知键 | `OD1101` | warning（`--strict` → error） |
| V6 | odId 语法 | `OD1102` | error |
| V7 | odId 唯一 | `OD1103` | error |
| V7b | `meta.ordinal` **小于**文中出现过的最大判别器（说明手工编辑时计数器没跟上） | `OD1321` | warning |
| V8 | `parent` 指向存在的节点 | `OD1104` | error |
| V9 | `children` 指向存在的节点，且与对方的 `parent` 一致 | `OD1105` | error |
| V10 | 无环（父子关系是树） | `OD1106` | error |
| V11 | `meta.root` 存在且是唯一的根 | `OD1107` | error |
| V12 | 绑定路径在白名单内（§3.5） | `OD1108` | error |
| V13 | 绑定指向的变量存在 | `OD1109` | error |
| V14 | 变量别名指向的变量存在 | `OD1110` | error |
| V15 | 变量值的形状合法（§1.5.1） | `OD1111` | error |
| V16 | 模式 id 存在（`values` 键 / `defaultMode` / `modes[].id` / `themes.active` / `bindings.modes`） | `OD1112` | error |
| V17 | `variableSets[].variables[]` 指向的变量存在 | `OD1113` | error |
| V18 | `component.main` 指向的节点**存在**（两种情形都要查：① `INSTANCE` 节点 → 它的主组件；② 实例的**拷贝子节点** → 主组件里对应的源节点） | `OD1114` | error |
| V18b | **仅当**本节点 `type` 为 `INSTANCE` 时，`component.main` 指向的节点的 `type` **MUST** 为 `COMPONENT`（拷贝子节点的 `component.main` 指向的是源节点，源节点**可以是任意类型**，不受此限） | `OD1120` | error |
| V19 | `component.overrides.descendants` 的键指向存在的节点 | `OD1115` | error |
| V20 | `component.overrides` 里的 `componentId` / `boundVariables/*` 引用存在 | `OD1116` | error |
| V21 | `component.properties[].id` 唯一；`component.assignments` 的键存在于某组件的属性定义中 | `OD1117` | error |
| V22 | `assets{}` 的键被至少一个 `fills[].imageHash` 引用（未被引用的资源 → warning） | `OD1118` | warning |
| V23 | `fills[].imageHash` 引用的资源在 `assets{}` 中存在 | `OD1119` | error |
| V24 | 资源文件在磁盘上存在 | `OD1201` | error（`--no-assets` 跳过） |
| V25 | 资源文件路径不逃逸出 od 文件所在目录 | `OD1202` | error |
| V26 | 资源文件的 sha1 与 `assets{}` 的键一致 | `OD1203` | error |
| V27 | **派生字段 D1 黑名单**（`derivedLayout` / `derivedTextGlyphs` / `textPicture`）不出现在任何节点里 | `OD1301` | error |
| V27b | **派生字段 D2**（`variableBindingScales` / `variableAssignmentScales`）若在图里有值，**MUST** 出现在 od 里 | `OD1302` | error |
| V29 | 未知顶层键 | `OD1303` | warning |
| V30 | `meta.generator` 缺失 | `OD1304` | warning |

**V26 是资源完整性检查**：资源的键是内容的 sha1（`computeImageHash`），所以可以直接重算校验。**MUST** 实现（用 `node:crypto` 的 sha1）。

**输出形态（`text`）**：

```
od validate design.od.json

✗ 2 errors, 1 warning

  OD1114  nodes[7].component.main
          未知组件引用 "comp~missing"
          提示: 该 odId 在本文档中不存在

  OD1201  assets["a3f5c1…"].file
          资源文件不存在: assets/a3f5c1….png
          提示: 运行 `od convert --from od --to engine` 检查资源完整性

  ! OD1118  assets["deadbeef…"]
          资源未被任何 fills[].imageHash 引用
```

**输出形态（`--json`）**：

```json
{
  "ok": false,
  "command": "validate",
  "file": "design.od.json",
  "format": "0.1",
  "errors": [
    { "code": "OD1114", "path": "nodes[7].component.main", "message": "未知组件引用 \"comp~missing\"", "hint": "该 odId 在本文档中不存在" }
  ],
  "warnings": [
    { "code": "OD1118", "path": "assets[\"deadbeef…\"]", "message": "资源未被任何 fills[].imageHash 引用" }
  ],
  "summary": { "errors": 1, "warnings": 1 }
}
```

### 8.5 `od migrate` 与 `od schema`

```
od migrate [options] <input> [output]
  --from <v>    源版本（默认读文档自带的 version）
  --to <v>      目标版本（默认当前格式版本）
  --force       覆盖输出

od schema [options]
  --version <v>  版本（默认当前）
  --out <path>   输出文件（默认 stdout）
  --list         列出所有已发布的 schema 版本
```

### 8.6 退出码

| 码 | 含义 | 何时 |
| --- | --- | --- |
| **0** | 成功 | |
| **1** | **用法错误** | 未知命令、缺少必需参数、非法选项值 |
| **2** | **校验失败** | 输入文档不合法；`convert --check` 发现差异；`validate` 有 error |
| **3** | **格式不支持** | 未知输入格式；文档 `version` 高于工具支持；`--to fig` 但未装 `@open-pencil/core` |
| **4** | **IO 错误** | 文件不存在、读失败、写失败、输出已存在且未 `--force` |
| **5** | **内部错误** | 未预期的异常（bug）。MUST 打印堆栈 |

**退出码的稳定性（MUST）**：这些码是**契约**，CI 脚本会依赖。改动必须走 §5 的版本流程。

### 8.7 错误信息格式

**人读格式**（`text`）：

```
od: <命令>: <一句话描述>
  <定位>: <细节>
    提示: <可选的操作建议>
```

三部分：
1. **一句话描述**：发生了什么，不含定位信息。
2. **定位**：`file:line:col`（若能定位到文本位置）或**JSON 路径**（如 `nodes[7].component.main`）。
3. **提示**：可操作的建议。

**定位到文本行号**：zod 的错误自带 `path`（JSON 路径），但**不带行号**。实现 SHOULD 在解析时记录「每个 JSON 路径 → 字符偏移」的映射（JSONC 去注释时顺带记），以便把 zod 的 path 映射回行号。**v0.1：SHOULD**（行号缺失时退回 JSON 路径，仍可用）。

**机器读格式**（`--json`）：

```json
{
  "ok": false,
  "command": "validate",
  "code": 2,
  "file": "design.od.json",
  "errors": [
    { "code": "OD1114", "path": "nodes[7].component.main", "line": 128, "column": 17,
      "message": "未知组件引用 \"comp~missing\"", "hint": "该 odId 在本文档中不存在" }
  ],
  "warnings": [ ... ]
}
```

**字段**：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `code` | 是 | 稳定错误码（`OD` + 4 位数字），见 §8.4 |
| `path` | 是 | JSON 路径（`nodes[7].component.main`）或资源路径 |
| `line` / `column` | 否 | 文本位置（1-based） |
| `message` | 是 | 人读的一句话（**不含**路径信息，路径单独放 `path`） |
| `hint` | 否 | 可操作建议 |

**错误码分段**：

| 段 | 含义 |
| --- | --- |
| `OD1xxx` | 结构 / 引用完整性 |
| `OD2xxx` | 资源（图片、外部文件） |
| `OD3xxx` | 版本 / 迁移 / 格式约束（派生字段两档的强制检查） |
| `OD4xxx` | IO |
| `OD5xxx` | 内部错误 |

**MUST NOT** 把内部异常信息（堆栈）放进 `message`；堆栈只进 stderr。

### 8.8 典型会话

```bash
# 引擎文档 → od 文本
od convert --from engine --to od design.odgraph.json design.od.json

# od 文本 → 引擎文档
od convert --from od --to engine design.od.json design.odgraph.json

# 校验
od validate design.od.json
od validate --strict --json design.od.json | jq '.errors'

# 看结构
od inspect design.od.json --paths
od inspect design.od.json --stats --format json

# 规范化（键序/缩进统一）
od convert --to od design.od.json design.norm.od.json --force

# 检查转换会不会改内容
od convert --check --to od design.od.json design.norm.od.json   # 退出码 0=无差异, 2=有差异
```

---

## 9. 实现清单（交给 `packages/od-format` 实现任务）

### 9.1 包结构建议

```
packages/od-format/
  src/
    index.ts               # 公开 API 导出
    version.ts             # OD_FORMAT_VERSION / OD_FORMAT_PACKAGE_VERSION
    schema/
      document.ts          # OdDocumentSchema（zod）
      node.ts              # 节点与各字段组
      paint.ts             # fills / strokes / effects
      variable.ts          # variables / variableSets / themes
      component.ts         # component 组
      ids.ts               # odId 语法、正则、slug、铸造
    ids.ts                 # IdRegistry 实现
    encode.ts              # fromEngine：引擎 → od
    decode.ts              # toEngine：od → 引擎
    defaults.ts            # 引擎默认值缓存（createDefaultNode）
    paths.ts               # 变量绑定路径双向翻译表
    geometry.ts            # commandsBlob ↔ SVG path d
    text/
      jsonc.ts             # stripJsonComments
      writer.ts            # 自定义序列化器（键序 + 短数组单行）
    migrate/
      index.ts             # migrate() + 注册表
      versions/v0.1.ts     # 冻结的 v0.1 schema
    errors.ts              # OdError / OdEncodeError / OdMigrationError / 错误码
  schema/
    od-format-0.1.schema.json
    index.json
  scripts/
    gen-schema.ts
  tests/
    fixtures/v0.1/*.od.json
    roundtrip.test.ts
    ids.test.ts
    encoding.test.ts
    migration.test.ts
    schema.test.ts
    cli.test.ts            # 在 od-cli 里
```

### 9.2 公开 API（与 `packages/od-format/src/index.ts` 的现有注释对齐）

```ts
export const OD_FORMAT_VERSION = '0.1'            // 格式版本
export const OD_FORMAT_PACKAGE_VERSION = '0.1.0'  // 包版本

export type OdDocument = z.infer<typeof OdDocumentSchema>
export { OdDocumentSchema }

export interface ToEngineResult { graph: SceneGraph; registry: IdRegistry }
export function toEngine(doc: OdDocument, opts?: ToEngineOptions): ToEngineResult
export function fromEngine(graph: SceneGraph, registry?: IdRegistry): OdDocument

export interface ToEngineOptions {
  idStrategy?: 'od' | 'native'      // §2.12，默认 'od'
  /**
   * 布局回调。od-format **不依赖 @open-pencil/core**，因此**不运行布局**。
   * 调用方（core 可用的环境）应注入 core 的 computeLayouts，
   * 否则自动布局子节点的 x/y/width/height 在图里是未布局的值。
   * 注意：这**不影响 od 文件**——几何是一律照存的（§3.1.2 规则 G），文件里始终有正确几何。
   */
  layout?: (graph: SceneGraph) => void
}

export function parseOd(text: string): OdDocument      // JSONC 容忍 + zod 校验
export function stringifyOd(doc: OdDocument): string   // 规范化写出

export function migrate(doc: unknown, from: OdVersion, to: OdVersion): OdDocument
export function validate(doc: OdDocument, opts?): ValidationResult

export { odDocumentJsonSchema } from './schema'
```

> **注意**：现有 `packages/od-format/src/index.ts` 的注释里写的是 `toEngine(doc, opts): SceneGraph`（直接返回 graph）。本规格建议改成返回 `{ graph, registry }`，否则 §2.8 的 registry 无处安放。**这是一个 API 决策，实现任务需要照办**——本规格**不修改** packages/ 下的文件。

### 9.3 实现顺序建议（每步都可独立验证）

| 步 | 交付 | 验证 |
| --- | --- | --- |
| 1 | `ids.ts`（odId 语法 / slug / 铸造 / IdRegistry） | 单测：slug 规范化表、冲突判别器、唯一性、恒等映射判定 |
| 2 | `defaults.ts` + `encode.ts`（**先只处理「无引用」的纯字段**） | 单测：154 字段全覆盖断言、派生字段黑名单 |
| 3 | `decode.ts`（反向） | 往返测试：纯字段逐字段相等 |
| 4 | `paths.ts`（绑定路径翻译） | 单测：对齐 `variables/fields.ts` 的白名单逐条断言 |
| 5 | `component.ts` + override 编解码（直接用引擎的 `serializeInstanceOverrideState`） | 组件往返测试（§4.5 T1/T2） |
| 6 | `variable.ts` + `themes` | 变量往返测试（§4.5 T4） |
| 7 | `geometry.ts`（blob ↔ path） | **逐字节**往返测试（§6.4） |
| 8 | `jsonc.ts` + `writer.ts` | 注释容忍测试、键序测试、短数组单行测试、幂等测试 |
| 9 | `migrate/` | §5.6 的 M1/M2/M3 |
| 10 | `scripts/gen-schema.ts` + schema 测试 | §7.3 S2 |
| 11 | `od-cli` 的三个命令 | §8 的契约测试 |

### 9.4 MUST 写的测试清单

| # | 测试 | 断言 |
| --- | --- | --- |
| 1 | **154 字段全覆盖** | 从引擎类型定义自动取出字段名集合，断言映射表里没有遗漏（**用脚本生成，不要手抄**） |
| 2 | **派生字段两档（D1）** | D1 的 **3 个节点字段 + 4 个文档字段 = 7 个**都不出现在输出中 |
| 3 | **纯字段往返** | 造一个含全部 154 字段非默认值的节点，往返后逐字段相等 |
| 4 | **组件往返** | §4.5 T1 |
| 5 | **实例不膨胀** | §4.5 T2 |
| 6 | **自动布局往返** | §4.5 T3 |
| 7 | **变量往返** | §4.5 T4 |
| 8 | **幂等** | §4.5 T7 |
| 9 | **确定性** | §4.5 T8 |
| 10 | **odId 恒等** | 加载后 `graph.nodes.get(odId)` 存在且 `node.id === odId` |
| 11 | **复制/删除/改名/移动** | §2.9 的四条生命周期规则各一个断言 |
| 12 | **blob 逐字节** | §6.4 |
| 13 | **JSONC 注释** | 含 `//`、`/* */`、字符串里的 `//`、转义引号的输入都能解析 |
| 14 | **键序固定** | 同一文档序列化两次逐字节相同 |
| 15 | **schema 同步** | §7.3 S2 |
| 16 | **迁移** | §5.6 的 6 条 |
| 17 | **CLI 退出码** | §8.6 的每个码各一个用例 |
| 18 | **建图三坑** | ① `createNodeWithId` 重复 id **MUST 报错**（不静默覆盖）；② `new SceneGraph()` 的两个自带节点 **MUST NOT** 出现在输出里；③ 新 id **MUST** 来自单调计数器 |
| 19 | **派生字段两档** | D1 的 **3 个节点字段 + 4 个文档字段**一个都不出现；D2 的 2 个节点字段在图里有值时**一定出现**，且往返后数值相同 |
| 20 | **画笔保序** | `fills` / `strokes` 往返后**逐元素相同**（顺序不变）；构造一个 `fills[0]` 绑定了颜色变量的节点，往返后绑定仍指向同一元素（硬伤 H1） |
| 21 | **绑定路径翻译** | §3.5 的 **36 条**白名单（31 数值 + 2 字符串 + 1 布尔 + 2 颜色）逐条双向断言；`fills.00.color`（前导零）**MUST** 被 `od validate` 拒绝 |
| 22 | **几何逐位相同** | `box.x/y/width/height` 往返后**逐位相同**（用 `Object.is` 断言，不只是 `===`） |

### 9.5 明确的「不做」清单（v0.1）

| 不做 | 原因 |
| --- | --- |
| 跨文档组件引用 | §4.1.5 |
| 注释保留 | §6.1 |
| `.fig` 双向转换 | 需要 `@open-pencil/core`；`--to fig` 留接口不实现（§8.2） |
| `idStrategy: 'native'` | §2.12，接口先留 |
| 拼音 slug | §2.4 |
| 多轴主题的独立表 | §1.6（引擎的集合+模式已经够用） |
| 增量/补丁格式 | §0.3 |
| `source.fig` 的二进制附件化 | §4.4（接受 `.fig` 导出有损） |

---

## 10. 待核实清单

> **`docs/engine-semantics.md` 已产出并被本文采信**（§0.7）。本节现在只列**尚未被任何一方确认**的点。
> 每条都给了「怎么核实」与「两种可能各自的应对」，因此**不阻塞实现起步**，但必须在 Phase 1 验收前逐条核实。

### 10.1 已关闭（engine-semantics 或本文直接核实）

| 原 # | 项 | 状态 |
| --- | --- | --- |
| 1 | core 的布局 pass 是否回写子节点几何 | ✅ 已核实：**会回写**（`core/dist/layout/apply.js:17-38`）→ §3.1.2 改为一律照存 |
| 2 | GRID 是否受支持 | ✅ 已核实：Yoga 是 grid 分支 `@open-pencil/yoga-layout@3.3.0-grid.3` |
| 6 | `.fig` 导出是否要求数字 id | ✅ 已核实：导出器**容忍**非 GUID id，但 **odId 不跨 `.fig` 往返保持**（§2.12） |
| 7 | blob → path → blob 能否逐字节还原 | ✅ 已定稿：§6.4 的 `fround` 判据算法，无损 |
| 13 | od-format 不跑布局 | ✅ 已确认并给出 `opts.layout` 注入点（§9.2） |
| — | 派生字段两档、组件三前提、变量三坑、绑定路径格式 | ✅ engine-semantics 实测，本文已采信（§0.7） |

### 10.2 仍未确认

| # | 待核实项 | 为什么重要 | 怎么核实 | 两种可能与应对 |
| --- | --- | --- | --- | --- |
| **R1** | `publishId` / `overrideKey` / `sharedSymbolVersion` / `publishedVersion` / `isPublishable` / `isSymbolPublishable` / `symbolDescription` 的语义 | engine-semantics §11.3：在 `src/` 里**零读点**，只有声明 + 默认值 | 读 core 侧的消费方 | 语义不明 → **往返原样保留即可**，但 od 侧**MUST NOT** 赋予含义（文档里已如此写） |
| **R2** | `itemReverseZIndex` / `strokesIncludedInLayout` 是否影响布局 | engine-semantics §11.3：core 的 `layout*` 里找不到消费方 | 读 core 的 Figma-API 代理层 | 不影响 → 照存即可（无风险） |
| **R3** | `instanceIndex` 的全量重建入口 | engine-semantics §11.3：无全量重建函数，只有增量维护；但 `createNodeWithId` 逐个注册时**实测**会自动重建 | 本规格已按「逐个注册自动重建」设计（§2.7） | 若不自动重建 → od-format **MUST** 在加载后显式重建（引擎已导出 `getInstances()` 等工具） |
| **R4** | `derivedLayout` / `derivedTextGlyphs` 在 core 侧的重算时机 | 二者被剔除（§3.1.4 D1），但重算发生在 core，od-format 本身不重算 | 在 core 里跑一次「加载 → 布局趟 → 检查 derivedLayout 是否被填回」 | 不重算 → 剔除后由 core 补；若 core 也不补 → **保留**这两个字段（降级方案，od 侧加 `geometry.derived`） |
| **R5** | Yoga flex 语义与 Figma auto-layout 的等价性 | engine-semantics §11.3：**未实测**。影响的是**渲染/编辑行为**，不影响 od 的信息完整性 | 构造用例对比 core 的布局输出 | 不等价 → 属引擎上游问题，od 格式**无需改动**（意图字段完整） |
| **R6** | `Color` 是否可能出现 0..1 之外的值（OkHCL / HDR） | 影响 §6.4 的精度规则与 §1.5.2 的颜色约定 | 读 `color/management.ts` 与 `OkHCLPayload` | 超出 → od 侧 **MUST NOT** 钳制范围，原样透传（规则不变，补一条断言） |
| **R7** | `Variable.scopes` / `TOKEN_UNITS` 的完整取值域 | §1.5 的 schema 枚举要写全 | 直接读 `types.ts` 的 `VARIABLE_SCOPES` / `TOKEN_UNITS` | 低风险，但 schema 必须写全 |
| **R8** | 实例拷贝树进文件后，**编辑器**的同步行为是否会产生意外 diff | 决策 I-1 的已知成本：改组件会同时改动每个实例的拷贝 | 在编辑器里改一个组件的文本，保存后看 diff | 噪音不可接受 → 启用 v1 的「只存主组件 + 重新物化」方案（§4.1.3 决策 I-1 的说明已写清代价） |
| **R9** | `source.id` 在 `.fig` 导入后是否跨会话稳定 | `styles.*` 共享样式引用依赖它稳定 | 两次导入同一 .fig，比较 `node.source.id` | 不稳定 → `styles.*` 也需在 od 侧降级为「不写出」 |
| **R10** | `targetAspectRatio` 存的是「锁定那一刻的尺寸」而非约分后的比例 | engine-semantics §3.1 的注释（`types.ts:658-661`） | 已确认注释，**语义待 core 侧确认消费方** | 语义不明 → **照存原值**（本规格已如此） |

**核实后的动作**：更新本文对应小节 + 在本表标 ✅ 与实测输出。**核实结论与本文冲突时，以实测为准，并同步改本文**（本文是活文档）。

## 附录 A · odId 示例

| 场景 | 引擎侧 | od 侧 |
| --- | --- | --- |
| 第一个名为 `Hero` 的 frame | `48213:57` | `frame~hero` |
| 第二个名为 `Hero` 的 frame | `48213:58` | `frame~hero~1` |
| 名为 `Hero Title` 的文本 | `48213:59` | `text~hero-title` |
| 名为 `标题` 的文本 | `48213:60` | `text~n` |
| 名为 `CTA（首屏）` 的按钮 | `48213:61` | `frame~cta` |
| 名为 `Hero` 的 frame 被改名成 `Banner` | `48213:57` | `frame~hero`（**不变**） |
| `Hero` 被移到另一个父节点下 | `48213:57` | `frame~hero`（**不变**） |
| `Hero` 被复制一份 | `48213:99` | `frame~hero~2`（**新 id**，判别器不复用） |
| 变量 `brand/primary` | `48213:70` | `var~brand-primary` |
| 变量集合 `Brand` | `48213:68` | `vcol~brand` |
| 集合模式 `Light` | `48213:69` | `mode~brand-light` |
| 组件属性 `label` | `48213:71` | `prop~label-text` |

**odId 正则（判定用）**：

```regex
^(?:canvas|frame|group|rect|ellipse|text|line|star|poly|vector|bool|section|comp|compSet|inst|connector|shape|var|vcol|mode|prop)~[a-z0-9]+(?:-[a-z0-9]+)*(?:~[1-9][0-9]*)?$
```

**判别器（`~N`）来自 `meta.ordinal` 这个单调计数器**，所以：
- 上表里 `frame~hero~1` / `frame~hero~2` 里的数字是**分配顺序**，不是「第几个同名节点」；
- 删除节点**不会**让计数器回退，判别器**跨会话也不复用**（§2.5）。

---

## 附录 B · 完整 od 文档样例

```jsonc
{
  // ── 这是一份示例 od 文档 ──
  // 注释在读取时 tolerated（容忍），写出时会被丢弃。
  "format": "od",
  "version": "0.1",

  "meta": {
    "generator": "od-format@0.1.0",
    "engine": "@open-pencil/scene-graph@0.16.0",
    "colorSpace": "srgb",
    "root": "frame~document",
    "ordinal": 0
  },

  "nodes": [
    {
      "id": "frame~document",
      "type": "FRAME",
      "name": "Document",
      "children": ["canvas~page-1"]
    },
    {
      "id": "canvas~page-1",
      "type": "CANVAS",
      "name": "Page 1",
      "parent": "frame~document",
      "children": ["frame~hero"]
    },
    {
      "id": "frame~hero",
      "type": "FRAME",
      "name": "Hero",
      "parent": "canvas~page-1",
      // 注：几何一律照存（§3.1.2 规则 G），不因是布局派生量而省略。
      "children": ["text~hero-title", "rect~hero-bg"],
      "box": { "width": 375, "height": 200 },
      "appearance": { "opacity": 1, "clipsContent": true },
      "corners": 16,
      "fills": [
        {
          "type": "SOLID",
          "color": { "r": 0.058, "g": 0.404, "b": 0.902, "a": 1 },
          "opacity": 1,
          "visible": true
        }
      ],
      "layout": {
        "mode": "VERTICAL",
        "gap": 12,
        "crossGap": 12,
        "padding": { "top": 24, "right": 24, "bottom": 24, "left": 24 },
        "align": { "primary": "MIN", "counter": "MIN" },
        "sizing": { "primary": "HUG", "counter": "FIXED" },
        "positioning": "AUTO"
      },
      "bindings": { "fields": { "fills.0.color": "var~brand-primary" } }
    },
    {
      "id": "text~hero-title",
      "type": "TEXT",
      "name": "标题",
      "parent": "frame~hero",
      "children": [],
      "box": { "width": 327, "height": 48 },
      "text": {
        "content": "你好，世界",
        "font": { "family": "Inter", "size": 32, "weight": 700 },
        "align": { "horizontal": "LEFT", "vertical": "TOP" }
      }
    },
    {
      "id": "rect~hero-bg",
      "type": "RECTANGLE",
      "name": "背景",
      "parent": "frame~hero",
      "children": [],
      "box": { "width": 375, "height": 200 },
      "fills": [
        {
          "type": "IMAGE",
          "color": { "r": 0, "g": 0, "b": 0, "a": 0 },
          "opacity": 1,
          "visible": true,
          "imageHash": "a3f5c1d2e4b60718293a4c5d6e7f8091a2b3c4d",
          "imageScaleMode": "FILL"
        }
      ]
    }
  ],

  "assets": {
    "a3f5c1d2e4b60718293a4c5d6e7f8091a2b3c4d": {
      "file": "assets/a3f5c1d2e4b60718293a4c5d6e7f8091a2b3c4d.png",
      "mime": "image/png",
      "bytes": 20481
    }
  },

  "variables": [
    {
      "id": "var~brand-primary",
      "name": "brand/primary",
      "type": "COLOR",
      "set": "vcol~brand",
      "values": {
        "mode~brand-light": { "r": 0.058, "g": 0.404, "b": 0.902, "a": 1 },
        "mode~brand-dark": { "alias": "var~brand-accent" }
      },
      "description": "主色",
      "hidden": false
    },
    {
      "id": "var~brand-accent",
      "name": "brand/accent",
      "type": "COLOR",
      "set": "vcol~brand",
      "values": {
        "mode~brand-light": { "r": 0.98, "g": 0.4, "b": 0.2, "a": 1 },
        "mode~brand-dark": { "r": 1, "g": 0.55, "b": 0.3, "a": 1 }
      },
      "description": "强调色",
      "hidden": false
    }
  ],

  "variableSets": [
    {
      "id": "vcol~brand",
      "name": "Brand",
      "defaultMode": "mode~brand-light",
      "modeAttribute": "data-theme",
      "modes": [
        { "id": "mode~brand-light", "name": "Light", "condition": "[data-theme=\"light\"]" },
        { "id": "mode~brand-dark", "name": "Dark", "condition": "[data-theme=\"dark\"]" }
      ],
      "variables": ["var~brand-primary", "var~brand-accent"]
    }
  ],

  "themes": {
    "active": { "vcol~brand": "mode~brand-light" }
  },

  "libraries": []
}
```

---

## 附录 C · 术语对照

| 本文术语 | 引擎术语 | 说明 |
| --- | --- | --- |
| od 文档 | — | 一个 `.od.json` 文件 |
| 节点 | `SceneNode` | |
| 文档 | `SceneGraph` | |
| odId | — | 本格式的语义 ID |
| engineId | `node.id` | 引擎内部 ID |
| 拷贝子节点 | 实例克隆 | 由主组件克隆而来、随主组件同步的节点。**v0.1 照常写进文件**（§4.1 决策 I-1）；其 `component.main` 指向主组件里对应的源节点 |
| 源节点 | — | 主组件里的那个节点，被拷贝子节点镜像。**MUST** 在本文档内存在 |
| 变量集合 | `VariableCollection` | 一条主题轴 |
| 集合模式 | `VariableCollectionMode` | 一条主题轴上的一个取值 |
| 绑定 | `boundVariables` | 字段 → 变量的引用 |
| 派生字段 D1 | — | §3.1.4 里**必丢**的 7 个（3 个节点字段 + 4 个文档字段） |
| 派生字段 D2 | — | §3.1.4 里**必留**的 2 个（`variableBindingScales` / `variableAssignmentScales`，都是节点字段） |

---

**文档结束。**
