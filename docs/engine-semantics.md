# 引擎语义层调研：组件 / 布局 / 变量 / 资源到底怎么表示

> 调研对象：`@open-pencil/scene-graph@0.16.0`（`node_modules/@open-pencil/scene-graph/`）
> 上层参照：`@open-pencil/core@0.16.0`（`shell/node_modules/@open-pencil/core/`）
> 目的：回答 `docs/research.md` §5.1 第 4 条的命门——**组件 + 自动布局 + 变量 三者 round-trip 无损才算成立**
> 边界：本文只写**语义层**（语义住在哪、怎么表达、能不能往返）。**字段层**（154 个字段的清单）在 `docs/sdk-notes.md` §3。

---

## 0. 八问速览

| # | 问题 | 一句话答案 |
|---|---|---|
| 1 | 组件 / 实例 / override | 语义住在一段连续字段（`types.ts:685-707`）；**override 在节点上的 `instanceOverrides: InstanceOverrideState`（两层 Map）**，引擎自带可逆编解码；`enabledLibraries` 键=libraryId，`instanceIndex` 键=componentId（派生，可重建） |
| 2 | 自动布局 | 布局**意图**是 30 来个节点字段（全是标量/字面量联合），**布局计算不在 scene-graph**，在 core 的 Yoga（`core/src/layout.ts:59`）；scene-graph 只存意图 + 一个 `derivedLayout` 物化提示 |
| 3 | 变量与主题 | `variables`/`variableCollections` 是 Map，**`activeMode` 是 `Map<collectionId, modeId>`**；mode 有**两层**（文档级 activeMode + 节点级 `variableModes`）；绑定字段路径是**斜杠**格式 `fills/0/color`，不是点号 |
| 4 | 图片资源 | `graph.images` 的键是**字节的 SHA-1 hex**（`computeImageHash`）；节点引用走 `fills[i].imageHash` / `strokes[i].imageHash`；应**外置资产 + hash 引用**，不 base64 |
| 5 | 派生缓存 | 节点级共 **5 个**（含 `textPicture`）；**但 Phase 0 认定可丢的两个 scale 字段其实是必留的**——引擎自己的 round-trip 也保留它们 |
| 6 | 确定性 ID | 生成器只在**引擎要铸新 id 时**被调用（构造耗 2 次）；`createNodeWithId` 完全不碰生成器且原样保 id → 往返保 ID 靠 `createNodeWithId`，不靠生成器 |
| 7 | 现成序列化 API | **scene-graph 里没有**（85 个原型方法，零 toJSON/fromJSON/export/import）。全图级编解码在 **core**：`serializeSceneGraph` / `deserializeSceneGraph` |
| 8 | 隐藏状态 | 引擎自己的全图 round-trip 恰好保 **11 项**（`core/src/kiwi/fig/parse/transfer.ts:13-27`）——直接照抄这份清单即可 |

---

## 1. 证据方法

本文每条结论都带 `文件:行号`。**路径简写约定**（下文一律用简写）：

| 简写 | 实际路径 |
|---|---|
| `src/xxx.ts` | `node_modules/@open-pencil/scene-graph/src/xxx.ts` |
| `core/src/xxx.ts` | `shell/node_modules/@open-pencil/core/src/xxx.ts` |
| `core/package.json` | `shell/node_modules/@open-pencil/core/package.json` |

`types.ts` / `index.ts` / `variables.ts` 这类裸文件名，一律指 scene-graph 包的同名文件。

**两种标记：**

- **【实测】** —— 在源码里读到并给出 `file:line`，或跑运行时探针得到（探针脚本见下）。
- **【推断】** —— 由已确认事实推出，**推断依据一并写出**。

**运行时探针**（本次调研自建，不在仓库里；仓库只新增 `docs/engine-semantics.md` 与 `scripts/gen-engine-semantics.py` 两个文件）：

- `/workspace/.mavis/plans/plan_14b95845/workspace/probe-id.mjs` —— ID 生成器语义、Map 丢失、`instanceIndex` 重建
- `/workspace/.mavis/plans/plan_14b95845/workspace/probe-vars.mjs` —— 变量绑定路径格式与类型约束
- `/workspace/.mavis/plans/plan_14b95845/workspace/check-citations.py` —— 复核本文每条 `file:line` 是否落在真实文件的非空行上（220 条引用全部通过）

**【实测】对任务前提的两处修正：**

1. `node_modules/@open-pencil/core/` **不存在**。顶层 `node_modules/@open-pencil/` 下**只有 `scene-graph`**；`@open-pencil/core@0.16.0` 在 **`shell/node_modules/@open-pencil/core/`**（shell 工作区的依赖）。
2. **Yoga 不在 scene-graph 里**。`scene-graph/package.json:11-19` 的依赖是 `@noble/hashes, culori, es-toolkit, nanoevents, postcss-value-parser, svgpath, valibot` —— 没有 yoga。Yoga 在 core：`shell/node_modules/@open-pencil/core/package.json:49` → `"yoga-layout": "npm:@open-pencil/yoga-layout@3.3.0-grid.3"`。

---

## 2. 组件 / 实例 / override

### 2.1 承载组件语义的字段

**【实测】** 全部集中在 `SceneNode` 的两段：`node_modules/@open-pencil/scene-graph/src/types.ts:685-707`（组件块）与 `:715`（`componentScale`）。

| 字段 | 类型 | 语义 | 证据 |
|---|---|---|---|
| `componentId` | `string \| null` | **实例 → 主组件的本地链接**（本地 node id） | `types.ts:685`；读它的是 `getMainComponent`（`src/instances.ts:224-225`）、`instanceMainComponent`（`src/instances/main-component.ts:13`） |
| `instanceOverrides` | `InstanceOverrideState` | **override 存储本体**（见 §2.3） | `types.ts:686` |
| `componentPropertyDefinitions` | `ComponentPropertyDefinition[]` | COMPONENT / COMPONENT_SET 定义的属性 | `types.ts:687`；定义体 `types.ts:759-768` |
| `componentPropertyReferences` | `ComponentPropertyReference[]` | 属性驱动哪些图层（组件侧） | `types.ts:688`；定义体 `types.ts:740-743` |
| `componentPropertyAssignments` | `Record<string, string>` | **键 = 属性定义 id** → 值 | `types.ts:689`；写入 `src/components/properties.ts:166-171` |
| `componentPropertyValues` | `Record<string, string>` | **键 = 属性名（不是 id）** ——变体值 | `types.ts:690`；`src/components/variants.ts:30`、`src/variant-properties.ts:36` |
| `componentKey` | `string \| null` | **已发布库的 key**，不用于解析实例的主组件 | `types.ts:691`；只在 `src/components/properties.ts:50` 与 `src/slots/limits.ts:13` 被读 |
| `sourceLibraryKey` | `string \| null` | 节点来源库的 key，同样只在这两处被读 | `types.ts:692` |
| `publishId` | `string \| null` | 【实测】**在 `src/` 里零读点**，只声明 + 默认值 | `types.ts:693`；默认值 `src/node-defaults.ts:188` |
| `overrideKey` | `string \| null` | 【实测】同上，零读点 | `types.ts:694` |
| `sharedSymbolVersion` | `string \| null` | 【实测】同上，零读点 | `types.ts:695` |
| `publishedVersion` | `string \| null` | 【实测】同上，零读点 | `types.ts:696` |
| `librarySource` | `LibraryAssetSource \| null` | 节点从哪个库资产插入而来 | `types.ts:697`；体 `types.ts:461-465` |
| `isPublishable` / `isSymbolPublishable` | `boolean` | 【实测】零读点 | `types.ts:698-699` |
| `isExposedInstance` | `boolean` | 实例在组件内，其属性对外暴露（Figma 的 `isExposedInstance`） | `types.ts:700-704` |
| `symbolDescription` | `string` | 【实测】零读点 | `types.ts:705` |
| `symbolLinks` | `SymbolLink[]` | 符号链接 | `types.ts:706`；体 `types.ts:416-420` |
| `variantPropSpecs` | `VariantPropSpec[]` | 变体属性规格 | `types.ts:707`；体 `types.ts:422-425` |
| `componentScale` | `number` | 相对所在组件定义的显式坐标缩放 | `types.ts:715` |

**【实测】关键区分：`componentId` vs `componentKey`。**
`componentId` 是**本地图内链接**（`graph.nodes.get(node.componentId)`）；`componentKey` / `sourceLibraryKey` 是**已发布库的身份串**，只用来解析 INSTANCE_SWAP 属性值（`src/components/properties.ts:50`）和首选值匹配（`src/slots/limits.ts:13`）。**往返时两者都要存**：`componentId` 维持图内关系，`componentKey` 维持对外发布身份。

### 2.2 `enabledLibraries` 与 `instanceIndex`

**【实测】`enabledLibraries: Map<string, EnabledLibraryBinding>`** —— `src/index.ts:197`。

绑定体（`src/types.ts:467-471`）：

```ts
export interface EnabledLibraryBinding {
  libraryId: string
  revisionId: string
  enabled: boolean
}
```

**键的语义 = `libraryId`**。证据：`shell/node_modules/@open-pencil/core/src/library/materialize.ts:143` 是全仓唯一写入这个 Map 的地方——

```ts
consumer.enabledLibraries.set(libraryId, { libraryId, revisionId, enabled: true })
```

即 **键与值里的 `libraryId` 冗余相同**。旁证：持久化到文档根节点 plugin data 时存的是**扁平数组**（没有键），schema 在 `src/plugin-data/fields.ts:81-98`，落点 `src/plugin-data/fields.ts:202`；core 侧写回用 `[...graph.enabledLibraries.values()]`（`core/src/io/formats/fig/library-metadata.ts:18`）。

> 任务描述里说「`Map<string, EnabledLibraryBinding>`」——**已确认键就是 libraryId**，不是库名。

**【实测】`instanceIndex: Map<string, Set<string>>`** —— `src/index.ts:209`。
**键 = 主组件的 `componentId`，值 = 该组件的实例节点 id 集合。**
- 建：`src/index.ts:514-521`（`registerNode`，仅当 `node.type === 'INSTANCE' && node.componentId`）
- 改：`src/index.ts:706-720`（`applyNodeChanges`，`componentId` 变化时）
- 删：`src/index.ts:847-849`（`deleteNode`）、`src/instances.ts:214-216`（`detachInstance`）
- 读：`src/instances.ts:229`（`getInstances`）

**它是纯派生索引**。【实测】运行时探针确认：用 `createNodeWithId` 建一个 INSTANCE 后，`graph.instanceIndex` 自动变成 `{ [componentId]: ['g2:inst-1'] }` ——即**丢弃后只要用 `createNodeWithId` 逐个注册节点即可重建**，不需要序列化它。

### 2.3 override 存在哪里、怎么表达

**【实测】override 就在节点上**：`SceneNode.instanceOverrides: InstanceOverrideState`（`src/types.ts:686`），类型定义 `src/instance-overrides.ts:1-6`：

```ts
export type InstanceOverrideField = string

export interface InstanceOverrideState {
  self: Map<InstanceOverrideField, unknown>
  descendants: Map<string, Map<InstanceOverrideField, unknown>>
}
```

- `self` —— 实例**自己**身上的 override，键是节点字段名。
- `descendants` —— 实例**后代节点**上的 override，外层键 = 后代节点 id，内层键 = 字段名。
- 键是**字段名**（`'text'`、`'visible'`、`'fills'`、`'name'`、`'componentId'`、`'sourceComponentId'`），**不是属性 id**。
- 属性 id 键的赋值在**另一个字段** `componentPropertyAssignments`（`src/types.ts:689`）。

**合法的 override 字段名**由 `src/instances/fields.ts:132-137` 的 `INSTANCE_OVERRIDE_FIELDS` 枚举，由三段拼成：
`INSTANCE_SYNC_PROPS`（`src/instances/fields.ts:43-104`，几何/布局/样式/变量类）、`INSTANCE_SYNC_TEXT_PROPS`（`:3-35`，文本类）、`INSTANCE_SYNC_CHILD_PROPS`（`:107`，`layoutGrow` / `layoutAlignSelf` / `locked`），再加 `visible`。

**【实测】引擎自带可逆编解码**（这是组件往返能成立的关键）：

- `serializeInstanceOverrideState(state): SerializedInstanceOverrideState` —— `src/instance-overrides.ts:52-62`
- `deserializeInstanceOverrideState(state: unknown): InstanceOverrideState` —— `src/instance-overrides.ts:64-78`

编码形态（`src/instance-overrides.ts:12-20`）：

```ts
export interface SerializedOverrideValue {
  defined: boolean
  value?: unknown
}

export interface SerializedInstanceOverrideState {
  self: Array<[InstanceOverrideField, SerializedOverrideValue]>
  descendants: Array<[string, Array<[InstanceOverrideField, SerializedOverrideValue]>]>
}
```

三点必须照抄：
1. Map 摊平成 **`[key, value]` 数组**（JSON 里 Map 会变 `{}`）。
2. 值用 **三态编码** `{defined, value?}`——显式区分「值是 undefined」和「键不存在」。
3. `descendants` 的外层键是**实例内拷贝节点的 id**，不是主组件里的节点 id。

**【实测】直接 JSON.stringify 会丢光**。运行时探针输出：

```
instanceOverrides 直接 JSON.stringify = {"self":{},"descendants":{}}
serializeInstanceOverrideState = {"self":[["text",{"defined":true,"value":"hello"}]],
                                  "descendants":[["g2:child-1",[["visible",{"defined":true,"value":false}]]]]}
```

**【实测】实例子节点是「拷贝」不是「引用」**：实例的子节点由 `populateInstanceChildren` / `cloneChildrenWithMapping`（`src/instances/sync.ts:188-199`）从主组件**复制**进实例树。因此：
- 往返时**主组件树和实例拷贝树都要存**。
- `descendants` 的键指向的是**拷贝节点**的 id —— 拷贝树丢了，override 就悬空。

### 2.4 组件往返可行性判断

**结论：组件可以无损往返，但有 3 个硬前提。**

| 前提 | 依据 | 不满足的后果 |
|---|---|---|
| P1 override 必须用引擎自带的编解码 | `src/instance-overrides.ts:52-78` | 用 JSON.stringify 直接序列化 → override 全丢（实测） |
| P2 主组件树与实例拷贝树必须一起存 | `src/instances/sync.ts:188-199`（拷贝语义）；`src/instance-overrides.ts:75`（descendants 键指向拷贝节点） | override 目标悬空，实例显示为组件原样 |
| P3 加载必须用 `createNodeWithId` 逐节点注册 | `src/index.ts:537-551`（保 id + 重建 instanceIndex）；`src/transfer/apply.ts:70` 是引擎自己的做法 | 用 `createNode` 会重新铸 id，ID 全变；instanceIndex 也建不起来 |

**没有障碍。** 组件语义是 scene-graph 里**表达最完整**的一块：定义、引用、赋值、override、slot、变体都有显式字段，且 override 层自带可逆编码。

**【实测】但有一个 Phase 0 没注意的坑**：override 字段是**字段名**而不是属性 id，且 `componentPropertyValues` 用**属性名**作键而 `componentPropertyAssignments` 用**属性 id** 作键。两套键空间不能混。

---

## 3. 自动布局

### 3.1 承载布局语义的字段

**【实测】** 全部在 `SceneNode`（`src/types.ts:605-624`、`:654-672`、`:674-676`）。类型串逐条来自 `.d.ts`，完整清单见 §10 的机器生成表。

**自动布局（flow）容器字段**

| 字段 | 类型 | 含义 |
|---|---|---|
| `layoutMode` | `LayoutMode` = `'NONE' \| 'HORIZONTAL' \| 'VERTICAL' \| 'GRID'` | `NONE` = 无自动布局；`GRID` = 网格容器（`src/types.ts:338`） |
| `layoutDirection` | `LayoutDirection` = `'AUTO' \| 'LTR' \| 'RTL'` | 流方向（`src/types.ts:247`） |
| `layoutWrap` | `LayoutWrap` = `'NO_WRAP' \| 'WRAP'` | 换行（`src/types.ts:360`） |
| `primaryAxisAlign` | `LayoutAlign` = `'MIN' \| 'CENTER' \| 'MAX' \| 'SPACE_BETWEEN'` | 主轴对齐 = `justify-content`（`src/types.ts:357`） |
| `counterAxisAlign` | `LayoutCounterAlign` = `'MIN' \| 'CENTER' \| 'MAX' \| 'STRETCH' \| 'BASELINE'` | 交叉轴对齐 = `align-items`（`src/types.ts:358`） |
| `primaryAxisSizing` / `counterAxisSizing` | `AxisSizingMode` = `'FIXED' \| 'HUG'` | 本节点沿自身主/交叉轴是固定还是抱紧（`src/types.ts:342`） |
| `itemSpacing` | `number` | **主轴**间距（gap）（`src/types.ts:615`） |
| `counterAxisSpacing` | `number` | **交叉轴**间距（换行 gap）（`src/types.ts:616`） |
| `paddingTop/Right/Bottom/Left` | `number` ×4 | 内边距（`src/types.ts:617-620`） |
| `counterAxisAlignContent` | `'AUTO' \| 'SPACE_BETWEEN'` | 换行后各行内容对齐（`src/types.ts:674`） |

**子节点在流里的位置**

| 字段 | 类型 | 含义 |
|---|---|---|
| `layoutPositioning` | `'AUTO' \| 'ABSOLUTE'` | **绝对定位 vs 流**。行内字面量联合，**没有具名导出类型**（`src/types.ts:622`） |
| `layoutGrow` | `number` | 主轴 grow（>0 = 填满）（`src/types.ts:623`） |
| `layoutAlignSelf` | `LayoutAlignSelf` = `'AUTO' \| 'MIN' \| 'CENTER' \| 'MAX' \| 'STRETCH' \| 'BASELINE'` | 单个子的交叉轴对齐（`src/types.ts:359`） |

**绝对定位 vs 流的判定**（`layoutPositioning === 'ABSOLUTE'`）：
- 绝对子节点**不参与**父级的 fill 尺寸计算 —— `src/layout/sizing.ts:22`
- 绝对子节点**不能**设成 `FILL` —— `src/layout/sizing.ts:103-105`
- 绝对子节点由**约束**定位，不由流定位 —— `core/src/layout/apply.ts:85`
- 绝对子节点被排除在「流」结构变化检测之外 —— `core/src/layout/derived.ts:31`

**网格（GRID）**

| 字段 | 类型 |
|---|---|
| `gridTemplateColumns` / `gridTemplateRows` | `GridTrack[]`（`GridTrack` = `{ sizing: GridTrackSizing; value: number }`，`src/types.ts:346-349`） |
| `gridColumnGap` / `gridRowGap` | `number` |
| `gridPosition` | `GridPosition \| null` = `{ column, row, columnSpan, rowSpan }`（`src/types.ts:351-356`） |

**约束与尺寸**

`horizontalConstraint` / `verticalConstraint`：`ConstraintType` = `'MIN' \| 'CENTER' \| 'MAX' \| 'STRETCH' \| 'SCALE'`（`src/types.ts:239`、`:605-606`）；
`minWidth` / `maxWidth` / `minHeight` / `maxHeight`：`number \| null`（`src/types.ts:654-657`）；
`targetAspectRatio: Vector \| null` —— 存的是**锁定那一刻的尺寸**，不是约分后的比例（注释 `src/types.ts:658-661`）；`clipsContent: boolean`（`src/types.ts:562`）。

> **注意别混**：`layoutGrids: LayoutGrid[]`（`src/types.ts:542`）是 Figma 画布上那层**可见参考线叠层**，跟 `gridTemplateColumns` / `gridTemplateRows` 的网格布局是两回事。叠层几何在 `src/layout/guides.ts:82`（`layoutGuideSections`）/ `:100`（`layoutGuideLines`）算。`CanvasGuide`（`src/guides.ts:5`）又是第三样东西——页面标尺。

### 3.2 布局是引擎自研还是外部引擎（Yoga）？

**【实测】结论：布局计算不在 scene-graph，在 core 的 Yoga。**

- scene-graph **零**布局入口。对 `src/` 全量 grep `computeLayout|applyLayout|layoutNode|relayout|reflow|layoutPass|layoutTree` **无命中**。
- `src/layout/index.ts:1-4` 只是 4 行 barrel：`aspect-ratio` / `guides` / `keywords` / `sizing`。`src/layout/sizing.ts:62-196` 给的是**尺寸策略**（FIXED/HUG/FILL 怎么判），不是几何。
- `src/layout/keywords.ts:32,43,51,60` 与 `src/css/layout.ts:28,37,44,50` 只做**关键字翻译**（CSS `justify-content` → `LayoutAlign` 之类）。
- 真正的计算在 core：
  - `computeLayout(graph, frameId)` —— `shell/node_modules/@open-pencil/core/src/layout.ts:59`
  - `computeAllLayouts(graph, scopeId?)` —— `core/src/layout.ts:86`
  - `layoutAuthoredNodes(graph, rootIds)` —— `core/src/layout.ts:102`
  - Yoga 调用 `yogaRoot.calculateLayout(...)` —— `core/src/layout.ts:73`
  - 字段 → Yoga 的映射在 `configureFlexContainer` —— `core/src/layout.ts:188-222`
  - Yoga 本身：`core/package.json:49` → `"yoga-layout": "npm:@open-pencil/yoga-layout@3.3.0-grid.3"`，import 在 `core/src/layout/yoga-helpers.ts:1-8`
- scene-graph 只提供引擎跑布局时的**变更守卫**：`withLayoutMutations` / `isApplyingLayout`（`src/index.ts:646-656`），被 `core/src/layout.ts:60,87` 调用。

**【推断】** 这条链说明 `SceneNode` 上的布局字段是**纯意图声明**——引擎不解释它们，只把它们交给外部布局趟。推断依据：scene-graph 侧只有关键字解析与尺寸策略，没有任何几何计算代码。

### 3.3 自动布局往返可行性判断

**结论：布局「意图」可无损往返；布局「结果」不可靠往返。**

| 项 | 判断 | 依据 |
|---|---|---|
| 意图字段（§3.1 全部） | **可无损** | 全是标量 / 字面量联合 / 极简结构（`GridTrack`、`GridPosition`），文本化零损耗 |
| 几何结果（`x/y/width/height`） | **不可靠** | 这些值是布局趟算出来写回节点的（`core/src/layout/apply.ts`）；不同 Yoga 版本 / 不同字体度量下结果可能不同。往返时应当**照存**（保住所见即所得），但不能指望重算出一模一样的数 |
| `derivedLayout` | **是提示，不是结果** | 见 §6.2 |

**障碍清单：**

1. **Yoga 的 flex 语义 ≠ Figma auto-layout 语义**（至少 `SPACE_BETWEEN`、`BASELINE`、`GRID` 模式三处）。scene-graph 侧只做关键字翻译，不做等价性保证。
2. **场景图不含布局引擎**——od-format 的往返实现拿不到 Yoga，只能存意图。若要重算，得依赖 core（`shell/` 侧）。
3. **`itemReverseZIndex` / `strokesIncludedInLayout` 未被布局趟消费**。【实测】在 core 的 `src/layout*` 里找不到读它们的地方——只有 Figma-API 代理层暴露（`core/src/figma-api/accessors/layout.ts:117-118`）。**推断**：这两个字段目前是「存着但没人用」，往返时保留即可，不要假设它们影响布局。

---

## 4. 变量与主题

### 4.1 `variables` / `variableCollections` / `activeMode` 三者的关系

**【实测】** 三者都是 `SceneGraph` 上的 Map（`src/index.ts:189-191`）：

```ts
variables = new Map<string, Variable>()            // src/index.ts:189
variableCollections = new Map<string, VariableCollection>()  // src/index.ts:190
activeMode = new Map<string, string>()             // src/index.ts:191  ← 注意是 Map
```

**`activeMode` 不是一个 mode id 字符串，是 `Map<collectionId, modeId>`。**
- `setActiveMode(graph, collectionId, modeId)` → `graph.activeMode.set(collectionId, modeId)` —— `src/variables.ts:162-164`
- `getActiveModeId(graph, collectionId)` → 先查 `graph.activeMode`，再退到 `collection.defaultModeId`，再退到 `''` —— `src/variables.ts:132-137`
- 【实测】`createCollection` 会把 `activeMode` 预置成默认模式（探针：`activeMode 初始 = [["p:0v1q4qfe","p:6wxy05oy"]]`，而 `collection.defaultModeId = p:6wxy05oy`）

**关系链**：`VariableCollection`（`src/types.ts:861-881`）持有 `modes: VariableCollectionMode[]`（`src/types.ts:849-859`）、`defaultModeId`、`variableIds`；每个 `Variable`（`src/types.ts:818-842`）持 `collectionId` 与 `valuesByMode: Record<string, VariableValue>`（**按 modeId 存值**）。所以：

```
collectionId ─┬─> VariableCollection.modes[]  (modeId, name, condition?, sortPosition?)
              └─> Variable.collectionId ──> Variable.valuesByMode[modeId]
```

### 4.2 mode（主题）在哪表达 —— **两层**

**【实测】第 1 层：文档级** —— `graph.activeMode: Map<collectionId, modeId>`（`src/index.ts:191`）。

**【实测】第 2 层：节点级** —— `SceneNode.variableModes: VariableModeMap`（`src/types.ts:716`），`VariableModeMap = Record<string, string>`（`src/types.ts:772`），**键也是 collectionId**。

解析顺序在 `getNodeVariableModeId`（`src/variables.ts:145-160`）：

1. 从节点自己往上找祖先，**第一个**有 `variableModes[collectionId]` 的节点说了算（`:150-153`）
2. 找不到 → `fallback === 'default'` 时用 `collection.defaultModeId`（`:155-156`）
3. 否则 → `getActiveModeId`（走第 1 层的 `activeMode`）（`:157-158`）

**【实测】节点级 `variableModes` 在 scene-graph 里没有公开 setter**。写它的地方只有：克隆（`src/copy.ts:250`、`:263`）、实例同步从组件拷贝（`src/instances/sync.ts:53-54`）、transfer 重映射（`src/transfer/nodes.ts:81-86`）、初始化（`src/node-defaults.ts:203`）。其余由 core 直接改节点。

> **对 od-format 的含义**：主题有两处状态，**两处都得存**——文档级 `activeMode`（编辑器当前显示哪个模式）与节点级 `variableModes`（某个子树固定用哪个模式）。只存前者会丢掉节点级的主题锁定。

### 4.3 变量绑定的字段路径 —— 合法取值全清单

**【实测】路径分隔符是斜杠 `/`，不是点号。** 任务描述里的 `fills.0.color` 这个例子**是错的**。

绑定存放在 `SceneNode.boundVariables: Record<string, string>`（`src/types.ts:709`），键 = 字段路径，值 = 变量 id。

**全部合法路径格式**（`bindVariable` 的校验逻辑，`src/variables.ts:346-411`）：

| 格式 | 例子 | 变量类型要求 | 证据 |
|---|---|---|---|
| 标量数值字段 | `width`、`height`、`x`、`y`、`opacity`、`rotation`、`cornerRadius`、`minWidth`… 共 **31 个** | `FLOAT` | 名单 `src/variables/fields.ts:1-33`；校验 `src/variables.ts:381-383` |
| 字符串字段 | `text`、`fontFamily` | `STRING` | `src/variables/fields.ts:40`；校验 `src/variables.ts:385-387` |
| 布尔字段 | `visible` | `BOOLEAN` | `src/variables/fields.ts:43`；校验 `src/variables.ts:389-391` |
| 画笔颜色 | `fills/<n>/color`、`strokes/<n>/color` | `COLOR` | 正则 `src/variables.ts:362`；校验 `:363-373` |

`NUMERIC_FIELDS` 的 31 个（`src/variables/fields.ts:1-33`）：`opacity, width, height, minWidth, maxWidth, minHeight, maxHeight, x, y, rotation, cornerRadius, topLeftRadius, topRightRadius, bottomRightRadius, bottomLeftRadius, strokeWeight, borderTopWeight, borderBottomWeight, borderLeftWeight, borderRightWeight, fontSize, letterSpacing, lineHeight, paddingLeft, paddingRight, paddingTop, paddingBottom, itemSpacing, counterAxisSpacing, gridRowGap, gridColumnGap`。

**【实测】运行时探针的实测结果**（`probe-vars.mjs`）：

```
✓ bindVariable("width") OK
✓ bindVariable("itemSpacing") OK
✓ bindVariable("paddingLeft") OK
✓ bindVariable("text") OK
✓ bindVariable("fontFamily") OK
✓ bindVariable("visible") OK
✓ bindVariable("fills/0/color") OK
✗ bindVariable("strokes/0/color") → Index 0 out of range for strokes (length 0)
✗ "fills/5/color"           → Index 5 out of range for fills (length 1)
✗ "fills/0/opacity"         → Unknown binding field "fills/0/opacity"
✗ "width" (绑 COLOR 变量)   → Cannot bind COLOR variable to scalar field "width"
✗ "text" (绑 FLOAT 变量)    → Cannot bind FLOAT variable to string field "text"
✗ "visible" (绑 FLOAT 变量) → Cannot bind FLOAT variable to boolean field "visible"
✗ "fills/0/color" (绑 FLOAT) → Cannot bind FLOAT variable to color field "fills/0/color"
✗ 变体路径 "fills.0.color"   → Unknown binding field "fills.0.color"
✗ 变体路径 "fills[0]/color"  → Unknown binding field "fills[0]/color"
✗ 变体路径 "fills/0/color "   → Unknown binding field "fills/0/color "   （尾随空格也不行）
? 变体路径 "fills/00/color" 被接受      ← 前导零等价于 00 == 0
```

三条结论：

1. **下标是位置下标，且绑定时校验越界**（`src/variables.ts:369-373`）。`fills/00/color` 被接受是因为 `parseInt('00') === 0`。
2. **数组重排会让绑定指错**。【实测】`src/` 里**没有任何重排/重映射 fills 的逻辑**；`removeStaleBindings`（`src/bindings.ts:5-20`，被 `src/index.ts:729-730` 调用）只在**新数组更短**时删掉越界下标的绑定。**同长度重排 → 绑定留在原下标，但指向了另一个画笔。**
3. **【实测】bindVariable 有副作用**：写 `boundVariables`（`src/variables.ts:404`）、`assignVariableBindingUnits`（`:405`）、`markBoundVariablesOverrideOnInstance`（`:406`）、emit `node:updated`（`:407-410`）。

**【实测】API 位置的坑**：`bindVariable` 等自由函数**不在包根导出里**。`node_modules/@open-pencil/scene-graph/dist/index.d.ts` 里 `bindVariable` 出现 **0** 次（`dist/types.d.ts` 的 5 次是 dts 打包的过度包含）。它们在**子路径导出** `@open-pencil/scene-graph/variables` 里。`dist/index.js` 根导出共 330 个，`bindVariable` 不在其中；`dist/variables.js` 有 25 个，含 `bindVariable`、`unbindVariable`、`createVariable`、`setActiveMode`、`resolveVariable` 等。
**SceneGraph 实例方法**则全都有：`graph.bindVariable(nodeId, field, variableId)`（`src/index.ts:405-407`）。**od-format 走实例方法即可**，别从根导入。

**【实测】还有一处 run 级绑定**：`styleRuns[].style.boundVariables`（`src/variables/bindings.ts:132-136`），绑的是 `fontSize` / `fontWeight` / `letterSpacing` / `lineHeight`（`src/variables/bindings.ts:121`）。这一层**不在** `node.boundVariables` 里，别漏。

### 4.4 变量往返可行性判断

**结论：变量可以无损往返，但有 3 个坑，其中 1 个是硬伤。**

| 坑 | 说明 | 依据 |
|---|---|---|
| **H1（硬伤）** | **fills / strokes 数组必须保序**。绑定路径带位置下标，同长度重排会让绑定静默指错，引擎自己不修 | `src/variables.ts:362`、`:369-373`；`src/bindings.ts:5-20` |
| **H2** | **两个 scale 字段不能无条件丢**。`variableBindingScales` 是绑定值 → 场景单位的乘数，scale ≠ 1 时丢掉，绑定会解出**不同的数** | `src/variables/bindings.ts:29-32`；解算 `src/variables/bindings.ts:51-52` |
| **H3** | **主题两层都要存**：`graph.activeMode` + 节点级 `variableModes` | `src/index.ts:191`；`src/types.ts:716`；解析 `src/variables.ts:145-160` |

H2 的处理方式有两条路，选一条：

- **路 A（推荐）**：**保留** `variableBindingScales` / `variableAssignmentScales`。**【实测】引擎自己的全图 round-trip 就是这么做的**——`core/src/kiwi/fig/parse/transfer.ts:85-86` 的 `normalizeImportedNode` 明确把这两个字段拷进去。
- **路 B**：丢弃，但**加载后强制重跑实例同步**。因为唯一的重算入口是 `scaleVariableBindingUnits`（`src/variables/units.ts:4-15`），它只被 `src/instances/sync.ts:120` 和 `src/scaling/tree.ts:44` 调用——**普通加载不会重算**。

**【推断】路 A 更安全。** 推断依据：`variableAssignmentScales` 只在 `node.type === 'INSTANCE'` 时被写（`src/variables/units.ts:11-12`），且只在缩放发生时；一旦丢弃且不同步，就再也回不来。

---

## 5. 图片资源

### 5.1 `graph.images` 的 key 是什么语义

**【实测】key = 字节的 SHA-1 hex 串。**

```ts
// src/images.ts:4-11
/**
 * The name an image's bytes are stored under: the hex SHA-1 of the bytes, as Figma names images,
 * so `.fig` files and the Figma clipboard can carry the name as it is. …
 */
export function computeImageHash(data: Uint8Array): string {
  return bytesToHex(sha1(data))
}
```

声明：`images = new Map<string, Uint8Array>()` —— `src/index.ts:188`。

**别和 `derivedAssetKey` 搞混**：`src/asset-keys.ts:9-11` 的 `derivedAssetKey(seed: string)` 是**从种子串派生的 40 位 hex 资产 key**，给**变量/集合**在剪贴板里命名用的，**不是**图片的 key。**【实测】没有 `assetKeyForBytes` 这个函数**——图片侧的helper 就叫 `computeImageHash`。

### 5.2 节点上引用图片的字段

**【实测】`Fill.imageHash?: string`** —— `src/types.ts:174`。`Stroke extends Fill`（`src/types.ts:220`），所以描边也有。

引用路径：
- `node.fills[i].imageHash`（画刷 `type: 'IMAGE'`，`FillType` 见 `src/types.ts:131`）
- `node.strokes[i].imageHash`

**【实测】`textPicture: Uint8Array \| null`（`src/types.ts:727`）不是图片引用**——它是缓存的 Skia Paragraph 快照（`src/text/picture.ts:6-9` 注释）。

配套：`imageMimeType(data): ImageMimeType`（`src/images.ts:19-25`）按文件头嗅探类型，值域 `'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'`（`src/images.ts:13`）。

### 5.3 base64 还是外置资产？

**结论：外置资产 + hash 引用，不 base64。**

依据：

1. **洁净室要求**：`docs/research.md` §5.1 第 4 条要求序列化保真且输出可读；base64 把二进制塞进 JSON 文本，diff 不可读、体积膨胀。
2. **引擎自己就是这么干的**：`core/src/kiwi/fig/parse/transfer.ts:17` 的 `images: [...graph.images]` 是**内存态**；真正落盘时 core 走 `serializedSceneGraphTransferList`（`core/src/kiwi/fig/parse/transfer.ts:29`）把 buffer 走 Transferable 单独搬，不进 JSON。
3. **key 已经是内容哈希**：SHA-1 hex 天生适合做文件名 —— `assets/<sha1-hex>.<ext>`，天然去重、幂等、跨文件可校验。

**建议的 od-format 形态**（本文只给形态，不越界设计 schema）：

```
assets/<sha1-hex>.<ext>     ← 字节本体
node.fills[i].imageHash      ← 引用，值就是 sha1-hex
```

`imageMimeType` 给出扩展名；哈希本身即校验和。

### 5.4 图片往返可行性判断

**结论：图片可以无损往返，且是最容易的一环。**

- 字节本体走外置文件，**SHA-1 天然校验完整性**（读回来 hash 对不上就是文件坏了）。
- 引用是纯字符串（`imageHash`），文本化零损耗。
- 唯一要小心的：**同 hash 不同字节不可能发生**（SHA-1 碰撞在实践中可忽略），但 `src/transfer/apply.ts:53-55` 仍做了冲突检查 —— od-format 加载时也该做同样的检查（hash 相同但字节不同 → 报错，不要静默覆盖）。

---

## 6. 派生缓存完整清单

### 6.1 判据

按任务要求，判据是「**有没有对应的 setter / 有没有重算入口**」。

### 6.2 清单

**节点级（`SceneNode` 上，共 5 个）**

| 字段 | 类型 | setter 位置 | 重算入口 | 序列化处理 |
|---|---|---|---|---|
| `derivedLayout` | `Partial<Rect> \| null`（`types.ts:537`） | scene-graph **只写 null**：`src/node-defaults.ts:71`（默认）、`src/text/picture.ts:38`（字形失效）、`src/instances/content-size.ts:62`（度量变化） | **scene-graph 内没有**。重算在 core：`applyEffectiveGeneratedTextLayout`（`core/src/layout/effective-generated-text.ts:274`）、`sizeAutoResizingText`（`core/src/layout/text-auto-resize.ts:58`） | **剔除**，加载后由 core 布局趟重算 |
| `derivedTextGlyphs` | `DerivedTextGlyph[] \| null`（`types.ts:728`） | `src/resize.ts:299`（缩放后重排字形）、`src/copy.ts:297-299`（拷贝） | 文本整形（core / 渲染侧）；失效逻辑 `src/text/picture.ts:25-53` | **剔除**，重算 |
| `textPicture` | `Uint8Array \| null`（`types.ts:727`） | `src/copy.ts:296` | Skia 段落快照；失效 `src/text/picture.ts:33-34` | **剔除**即可，**无需 base64**（它是缓存不是资产） |
| `variableBindingScales` | `Partial<Record<string, number>>`（`types.ts:711`） | `src/variables/bindings.ts:29-32`（绑定时）、`src/variables/units.ts:10`（缩放时） | **只有实例同步 / 树缩放会重算**：`src/instances/sync.ts:120`、`src/scaling/tree.ts:44` | **保留**（见 §6.3） |
| `variableAssignmentScales` | `Partial<Record<string, number>>`（`types.ts:713`） | `src/variables/units.ts:12`（只对 INSTANCE 写） | 同上 | **保留**（见 §6.3） |

**图级（`SceneGraph` 上）**

| 字段 | 类型 | setter | 重算/失效入口 | 序列化处理 |
|---|---|---|---|---|
| `absPosCache` | `Map<string, Vector>`，**private**（`src/index.ts:199`） | `src/index.ts:463` | `clearAbsPosCache()`（`src/index.ts:451-453`），调用点 `src/index.ts:705,749,804,826`、`src/checkpoint.ts:89` | **不可序列化**（private，且是纯缓存） |
| `instanceIndex` | `Map<string, Set<string>>`（`src/index.ts:209`） | `src/index.ts:514-521`、`:706-720` | **无全量重建函数**；靠 `createNodeWithId` 逐个注册时自动重建（实测） | **可丢弃**，加载时重建 |
| `positionPreviewVersion` | `number`（`src/index.ts:208`） | `src/preview.ts:77` 自增 | 无（版本戳，不是缓存） | **可丢弃** |

**【实测】scene-graph 里没有的东西**（都查过了）：没有测量尺寸缓存（`width`/`height` 是普通可变字段，`src/types.ts:532-533`）、没有网格轨道缓存（`GridTrack` 是纯数据，`src/types.ts:346-349`）、**`SceneNode` 上一个 `Map<` / `WeakMap<` 字段都没有**（对 `src/types.ts` grep 零命中）。

**【实测】module 级（按 graph 键，不在文档里）**：`syncingComponentsByGraph`（`src/instances.ts:147`，重入守卫）、`removedCopies`（`src/instances/copies.ts:124`）、`activeRemovals`（`src/instances/copies.ts:155`）——都是 `WeakMap<SceneGraph, ...>`，随图存活，**不进文档**。

### 6.3 结论修正：Phase 0 的两个「派生缓存」其实必留

**【实测】这是本次调研对 Phase 0 的一处修正。**

`docs/sdk-notes.md` §3 把 `variableBindingScales` / `variableAssignmentScales` 归进「D 类 · 派生缓存（序列化时丢弃，加载时重算）」。**按「有没有重算入口」这个判据复查后，这两个不满足「加载时重算」**：

- 它们的**唯一**写入口是 `scaleVariableBindingUnits`（`src/variables/units.ts:4-15`），只有两个调用方：`src/instances/sync.ts:120`（实例同步）和 `src/scaling/tree.ts:44`（用户缩放）。
- **普通加载不会触发任何一个。**
- 而 `variableBindingScales` 直接参与绑定解算：`const scale = node.variableBindingScales[field] ?? 1; const effective = value * scale`（`src/variables/bindings.ts:51-52`）。scale ≠ 1 时丢掉它，绑定解出的数就变了。

**【实测】独立佐证**：引擎自己的全图 round-trip **保留**这两个字段 —— `core/src/kiwi/fig/parse/transfer.ts:85-86`：

```ts
variableBindingScales: { ...node.variableBindingScales },
variableAssignmentScales: { ...node.variableAssignmentScales },
```

**所以 D 类要拆成两档**：

| 档 | 字段 | 处理 |
|---|---|---|
| **D1 · 必丢**（有明确重算入口） | `derivedLayout`、`derivedTextGlyphs`、`textPicture` | 序列化剔除，加载后重算 |
| **D2 · 必留**（无加载期重算入口） | `variableBindingScales`、`variableAssignmentScales` | **保留**；除非加载后强制重跑实例同步 |

`textPicture` 在 Phase 0 里被归成「C 类 · 直接二进制（需 base64 或外置资产）」——**这是误判**：它是缓存不是资产，**剔除即可，不该进 base64 分支**。

### 6.4 往返可行性判断（派生缓存部分）

**结论：剔除 3 个、保留 2 个，即可。** 没有死结。

---

## 7. 确定性 ID

### 7.1 `new SceneGraph(idGenerator?: () => string)` 的确切语义

**【实测】** 声明 `constructor(private readonly idGenerator: () => string = generateId)` —— `src/index.ts:211`。

**调用时机**：生成器**只在引擎需要铸新 id 时**被调用，且总是经由 `generateEntityId`（`src/index.ts:482-494`）：

```ts
private generateEntityId(issued?: Set<string>): string {
  let limit = Infinity
  for (let attempt = 0; attempt < limit; attempt++) {
    const id = (this.importedIdGenerator ?? this.idGenerator)()
    if (this.isEntityIdTaken(id) || issued?.has(id)) {
      if (limit === Infinity) limit = this.entityIdCount() + (issued?.size ?? 0) + 1
      continue
    }
    issued?.add(id)
    return id
  }
  throw new Error('The ID generator only returned IDs that are in use')
}
```

`isEntityIdTaken`（`src/index.ts:500-509`）检查 nodes / variables / variableCollections / 各 collection 的 modeId。**取到已占用的 id 会重试**；生成器一直返回已占用的 id 就抛上面那个错（**实测复现过**）。

**【实测】运行时探针的确切计数：**

```
1) 构造后生成器调用次数 = 2 调用序列 = [0,1]
   graph.nodes keys = ["probe:0","probe:1"]
   rootId = probe:0
2) createNode 后生成器调用 = [2] → 新节点 id = probe:2
3) createNodeWithId: id = probe:kept-id 生成器调用次数 = 0 （应为 0）
   g.getNode("probe:kept-id") 存在 = true
4) applyImportedStateDuring 期间新建的 id = ["imported:0"] （走 injected 生成器）
5) createNodeWithId 建 INSTANCE 后 instanceIndex = [["g2:2mzvi4h5",["g2:inst-1"]]]
```

即：

| 时机 | 生成器是否被调用 |
|---|---|
| `new SceneGraph(gen)` | **调用 2 次**——一次给根 FRAME（"Document"），一次给 "Page 1"（`src/index.ts:212-220`） |
| `graph.createNode(...)` | 调 1 次（`src/index.ts:531`） |
| `graph.createNodeWithId(id, ...)` | **0 次**——id 由参数给定（`src/index.ts:543-544`） |
| `graph.createVariable` / `createCollection` / `createMode` | 各调 1 次（`src/index.ts:293,304,310`） |
| `applyImportedStateDuring(fn, gen2)` 期间新建 | 调 `gen2` 而不是构造时的生成器（`src/index.ts:613-623`：`this.importedIdGenerator = idGenerator ?? previousGenerator`） |

**结论：生成器管的是「新铸的 id」，不管「从文档读进来的 id」。** 往返保 ID 跟生成器无关。

**【实测】默认生成器长这样**（`src/index.ts:169-171`）：

```ts
export function generateId(): string {
  return `${idSession}:${nextLocalID++}`
}
```

`setIdSession(sessionId)`（`src/index.ts:160-167`）改的是 `sessionID:localID` 里的 session 段。**这是给「同一个文件在编辑器 / CLI / MCP 三处各自加图层，ID 不撞」用的**，不是给往返用的。

### 7.2 让引擎在 od-format 往返后保持同一套 ID

**实现思路（四步，全部有引擎先例）：**

1. **加载时用 `createNodeWithId` 逐节点注册** —— `src/index.ts:537-551`。它把 id 原样写进节点（`:544`）、挂到父节点（`:546-549`）、并触发 `registerNode`（`:550`）从而**重建 instanceIndex**（`src/index.ts:514-521`）。
   **引擎自己的先例**：`core/src/kiwi/fig/parse/transfer.ts:91-106` 的 `deserializeSceneGraph` 是**直接替换整个 Map** 的（`graph.nodes = new Map(...)`，`:94`），连 `createNodeWithId` 都不用；`src/transfer/apply.ts:70` 走的才是 `createNodeWithId` 那条路。**两条路都能保 ID。**
2. **注册顺序：父先于子**。`createNodeWithId` 靠 `parent.childIds.push(id)` 挂载（`src/index.ts:546-549`），父不在则子挂不上去。`src/transfer/apply.ts:41-43` 就在校验这条。
3. **加载后重建派生状态**：
   - `instanceIndex` —— 走第 1 步自动重建（或按 `core/src/kiwi/fig/parse/transfer.ts:99` 那样直接灌回去）。
   - `absPosCache` —— 调 `graph.clearAbsPosCache()`（`src/index.ts:451-453`）。
4. **生成器只用来保证「新 id 不撞旧 id」**。因为 `isEntityIdTaken` 会查 nodes / variables / collections / modeId（`src/index.ts:500-509`），加载完之后生成器再铸新 id 天然避开了已加载的 id。**所以不需要为往返改生成器。**

**【实测】三条坑：**

- **`createNodeWithId` 不查重**。`src/index.ts:537-551` 直接 `this.nodes.set(node.id, node)`，**同名 id 会静默覆盖**。od-format 加载时必须自己查重并报错。
- **构造器已经消耗了 2 个 id**（根 + "Page 1"）。若要「加载后的图与保存前逐字节一致」，**不能**用 `new SceneGraph()` 再往里塞——得先 `graph.nodes.clear()` 清掉自动生成的两个，或者干脆走 `deserializeSceneGraph` 那条「整体替换 Map」的路（`core/src/kiwi/fig/parse/transfer.ts:92-103`）。
- **生成器必须单调**。返回重复 id 会撞上 `throw new Error('The ID generator only returned IDs that are in use')`（`src/index.ts:493`，实测复现）。这意味着**确定性生成器只能是计数器，不能是纯哈希**。

---

## 8. 现成的序列化 API

### 8.1 结论：**scene-graph 里没有**

**【实测】** `SceneGraph` 原型共 **85** 个方法，**零** 个 `toJSON` / `fromJSON` / `serialize` / `deserialize` / `export` / `import` / `load` / `save` / `parse` / `write` 方法。

全仓 grep `toJSON|fromJSON`（`src/` + `dist/`）**零命中**。运行时探针输出：

```
6) SceneGraph 原型上与 序列化 相关的成员 = ["applyImportedStateDuring","isApplyingImportedState"]
```

（那两个是 `import` 词根误匹配，不是序列化 API。）

**【实测】`src/export-format.ts` 跟文档序列化无关**——全文 12 行，只是「节点导出设置里可以填哪些格式」的常量表：

```ts
// src/export-format.ts:1-12
export const EXPORT_FORMAT_IDS = ['png', 'jpg', 'webp', 'svg', 'pdf', 'pptx'] as const
export type ExportFormatId = (typeof EXPORT_FORMAT_IDS)[number]
export function isExportFormatId(value: unknown): value is ExportFormatId { … }
```

### 8.2 最接近的四个（scene-graph 内）

| API | 位置 | 行为 | 能不能当 od-format 的基础 |
|---|---|---|---|
| `serializeInstanceOverrideState` / `deserializeInstanceOverrideState` | `src/instance-overrides.ts:52` / `:64` | **只**编解码 override 子状态；Map ↔ `[k,{defined,value}][]` | **能**——override 层直接复用 |
| `captureGraphCheckpoint(graph)` | `src/checkpoint.ts:6`（`src/index.ts:184` 再导出） | `structuredClone` 整个文档（`src/checkpoint.ts:10-21`）+ `restore()` | **不能**——是回滚快照，不是持久化格式；且它保留对象身份 |
| `prepareGraphTransfer` / `applyGraphTransfer` | `src/transfer/plan.ts:28` / `src/transfer/apply.ts:60` | 跨图复制（内存态剪贴板）。**`prepareGraphTransfer` 会重铸所有 id**（`src/transfer/plan.ts:57-64`，`namespace = crypto.randomUUID()`） | **不能直接用**（id 全变），但 **`applyGraphTransfer` 的加载逻辑可借鉴**（`src/transfer/apply.ts:66-70`：`addCollection` → `addVariable` → `activeMode.set` → `images.set` → `createNodeWithId`） |
| `serializeOkHCLPayload` / `parseOkHCLPayload` | `src/color/okhcl.ts:96` / 对应 parse | 只编解码颜色 payload | **不能**——范围太小 |

### 8.3 全图级的编解码在 **core**（不是 scene-graph）

**【实测】** 这才是「引擎自己的往返清单」的权威出处：

```ts
// shell/node_modules/@open-pencil/core/src/kiwi/fig/parse/transfer.ts:13-27
export function serializeSceneGraph(graph: SceneGraph): SerializedSceneGraph {
  return {
    rootId: graph.rootId,
    nodes: [...graph.nodes],
    images: [...graph.images],
    variables: [...graph.variables],
    variableCollections: [...graph.variableCollections],
    activeMode: [...graph.activeMode],
    instanceIndex: [...graph.instanceIndex].map(([id, nodeIds]) => [id, [...nodeIds]]),
    figKiwiVersion: graph.figKiwiVersion,
    figSchemaDeflated: graph.figSchemaDeflated,
    documentColorSpace: graph.documentColorSpace,
    enabledLibraries: [...graph.enabledLibraries]
  }
}
```

反向：`deserializeSceneGraph(data): SceneGraph` —— `core/src/kiwi/fig/parse/transfer.ts:91-106`。

**注意：core 里的这套是 .fig / kiwi 的解析产物，不是通用文本格式。** 它把 Map 摊平成 `[key, value]` 数组，但 `SceneNode` 内部**原样保留**（含 `Uint8Array`），所以它**不是** JSON 可序列化的。od-format 要文本化，还得自己做一层编码。

---

## 9. 往返时的隐藏状态

### 9.1 引擎自己的往返清单 —— 直接照抄

**【实测】** core 的 `serializeSceneGraph`（`core/src/kiwi/fig/parse/transfer.ts:13-27`）+ `deserializeSceneGraph`（`:91-106`）**恰好覆盖 11 项**，这就是「一个文档 = 什么」的权威答案：

| # | 项 | 类型 | 往返处理 | 依据 |
|---|---|---|---|---|
| 1 | `rootId` | `string` | **必须** | `transfer.ts:15` / `:93` |
| 2 | `nodes` | `Map<string, SceneNode>` | **必须**（主表） | `:16` / `:94` |
| 3 | `images` | `Map<string, Uint8Array>` | **必须**（二进制外置） | `:17` / `:95` |
| 4 | `variables` | `Map<string, Variable>` | **必须** | `:18` / `:96` |
| 5 | `variableCollections` | `Map<string, VariableCollection>` | **必须** | `:19` / `:97` |
| 6 | `activeMode` | `Map<string, string>` | **必须** | `:20` / `:98` |
| 7 | `documentColorSpace` | `DocumentColorSpace` | **必须** | `:24` / `:102` |
| 8 | `instanceIndex` | `Map<string, Set<string>>` | 保留（引擎保了） | `:21` / `:99` |
| 9 | `figKiwiVersion` | `number \| null` | 保留（引擎保了） | `:22` / `:100` |
| 10 | `figSchemaDeflated` | `Uint8Array \| null` | 保留（引擎保了） | `:23` / `:101` |
| 11 | `enabledLibraries` | `Map<string, EnabledLibraryBinding>` | 保留（引擎保了） | `:25` / `:103` |

`SerializedSceneGraph` 的完整声明：`core/src/kiwi/fig/parse/transfer.ts:6-11`，基类 `PortableSceneGraphData`：`core/src/kiwi/fig/parse/portable-data.ts:8-16`。

**注意：core 也把 `instanceIndex` 存了**（`transfer.ts:21`）——虽然它可重建。**存着不亏**（重建需要正确的加载顺序，重建反而更脆）。

### 9.2 可以安全丢弃的

| 项 | 为什么能丢 |
|---|---|
| `instanceIndex` | 派生索引，用 `createNodeWithId` 逐个注册即可重建（实测）。**但引擎自己存了，建议照抄** |
| `positionPreviewVersion` | 运行时计数（`src/index.ts:208`），只服务于预览订阅 |
| `figKiwiVersion` | .fig 导入溯源（`src/index.ts:193`），对 od-format 无意义。**引擎保留它只为 .fig 往返保真** |
| `figSchemaDeflated` | 同上，二进制的 .fig schema 溯源（`src/index.ts:195`） |
| `absPosCache` | private 纯缓存（`src/index.ts:199`），调 `clearAbsPosCache()` 即可（`src/index.ts:451-453`） |

### 9.3 私有状态 —— **一个必须知道的坑**

**【实测】TypeScript 的 `private` 是编译期的事，运行时照样可枚举。** 探针输出：

```
JSON.stringify(graph) 的顶层键 = ["nodes","images","variables","variableCollections","activeMode",
  "rootId","figKiwiVersion","figSchemaDeflated","documentColorSpace","enabledLibraries","emitter",
  "absPosCache","previewMutationDepth","previewObservers","changeObservers",
  "sourceMetadataPreservationDepth","importedStateApplicationDepth","layoutMutationDepth",
  "derivedLayoutDepth","positionPreviewVersion","instanceIndex"]
```

**所以 `JSON.stringify(graph)` 会把 `emitter`（事件总线）、`absPosCache`、`previewObservers`、`changeObservers` 全塞进文本。** 而且更糟：

```
nodes（Map）序列化后 = {} ← 节点全丢
variables（Map）序列化后 = {} ← 变量全丢
activeMode（Map）序列化后 = {} ← 模式全丢
images（Map）序列化后 = {} ← 图片全丢
instanceIndex（Map）序列化后 = {} ← 索引全丢
```

**结论：od-format 绝不能靠 `JSON.stringify(graph)`。** 必须**显式逐字段取**，且 Map 一律摊平成 `[k, v]` 数组（照抄 core `serializeSceneGraph` 的做法，`transfer.ts:15-26`）。

### 9.4 节点级还有哪些 Map 陷阱

**【实测】`SceneNode` 上一个 `Map<` / `WeakMap<` 字段都没有**（对 `src/types.ts` grep 零命中）——好消息。

**但 `instanceOverrides` 内部是两个 Map**（`src/instance-overrides.ts:3-6`），是唯一的节点级 Map 陷阱。用引擎自带的 `serializeInstanceOverrideState` 解决（§2.3）。

---

## 10. 机器生成的字段清单

> 本节由 `scripts/gen-engine-semantics.py` 从 `node_modules/@open-pencil/scene-graph/dist/types.d.ts` 解析生成。
> 字段名与类型**均从 .d.ts 解析，不是手抄**。
> 复核命令：`python3 scripts/gen-engine-semantics.py --check docs/engine-semantics.md`

<!-- BEGIN GENERATED: engine-semantics -->
### 10.1 SceneNode 字段全表（154 个）

来源：`node_modules/@open-pencil/scene-graph/dist/types.d.ts` 的 `interface SceneNode`，由 `scripts/gen-engine-semantics.py` 机器生成（字段名与类型均从 .d.ts 解析，非手抄）。

| 分类 | 字段数 | 序列化处理 |
|---|---|---|
| S 类 · 语义字段（JSON 原生标量 / 字面量联合） | 112 | 直接 JSON |
| O 类 · 对象字段（数组 / Record / 接口对象，需改名映射） | 35 | 结构映射（改名 + 字段级编码） |
| B 类 · 二进制（含 Uint8Array blob） | 3 | 外置资产 / base64 |
| D 类 · 派生缓存（引擎算出来的；处理见下表备注） | 4 | D1 必丢（重算）/ D2 必留（无重算入口）—— 见下表备注 |

#### S 类 · 语义字段（JSON 原生标量 / 字面量联合） —— 112 个

| 字段 | 类型 | 序列化处理 |
|---|---|---|
| `id` | `string` | 直接 JSON |
| `type` | `NodeType` | 直接 JSON |
| `name` | `string` | 直接 JSON |
| `parentId` | `string \| null` | 直接 JSON |
| `x` | `number` | 直接 JSON |
| `y` | `number` | 直接 JSON |
| `width` | `number` | 直接 JSON |
| `height` | `number` | 直接 JSON |
| `rotation` | `number` | 直接 JSON |
| `fillStyleId` | `string \| null` | 直接 JSON |
| `strokeStyleId` | `string \| null` | 直接 JSON |
| `textStyleId` | `string \| null` | 直接 JSON |
| `effectStyleId` | `string \| null` | 直接 JSON |
| `gridStyleId` | `string \| null` | 直接 JSON |
| `sharedStyleType` | `SharedStyleType \| null` | 直接 JSON |
| `opacity` | `number` | 直接 JSON |
| `cornerRadius` | `number` | 直接 JSON |
| `topLeftRadius` | `number` | 直接 JSON |
| `topRightRadius` | `number` | 直接 JSON |
| `bottomRightRadius` | `number` | 直接 JSON |
| `bottomLeftRadius` | `number` | 直接 JSON |
| `independentCorners` | `boolean` | 直接 JSON |
| `cornerSmoothing` | `number` | 直接 JSON |
| `visible` | `boolean` | 直接 JSON |
| `locked` | `boolean` | 直接 JSON |
| `clipsContent` | `boolean` | 直接 JSON |
| `blendMode` | `BlendMode` | 直接 JSON |
| `text` | `string` | 直接 JSON |
| `fontSize` | `number` | 直接 JSON |
| `fontFamily` | `string` | 直接 JSON |
| `fontWeight` | `number` | 直接 JSON |
| `italic` | `boolean` | 直接 JSON |
| `textAlignHorizontal` | `'LEFT' \| 'CENTER' \| 'RIGHT' \| 'JUSTIFIED'` | 直接 JSON |
| `textDirection` | `TextDirection` | 直接 JSON |
| `textLanguage` | `string \| null` | 直接 JSON |
| `textAlignVertical` | `TextAlignVertical` | 直接 JSON |
| `textAutoResize` | `TextAutoResize` | 直接 JSON |
| `textCase` | `TextCase` | 直接 JSON |
| `textDecoration` | `TextDecoration` | 直接 JSON |
| `textDecorationStyle` | `TextDecorationStyle` | 直接 JSON |
| `textDecorationThickness` | `number \| null` | 直接 JSON |
| `textDecorationSkipInk` | `boolean` | 直接 JSON |
| `textUnderlineOffset` | `number \| null` | 直接 JSON |
| `leadingTrim` | `LeadingTrim` | 直接 JSON |
| `lineHeight` | `number \| null` | 直接 JSON |
| `letterSpacing` | `number` | 直接 JSON |
| `maxLines` | `number \| null` | 直接 JSON |
| `listSpacing` | `number` | 直接 JSON |
| `paragraphSpacing` | `number` | 直接 JSON |
| `paragraphIndent` | `number` | 直接 JSON |
| `hangingList` | `boolean` | 直接 JSON |
| `horizontalConstraint` | `ConstraintType` | 直接 JSON |
| `verticalConstraint` | `ConstraintType` | 直接 JSON |
| `layoutMode` | `LayoutMode` | 直接 JSON |
| `layoutDirection` | `LayoutDirection` | 直接 JSON |
| `layoutWrap` | `LayoutWrap` | 直接 JSON |
| `primaryAxisAlign` | `LayoutAlign` | 直接 JSON |
| `counterAxisAlign` | `LayoutCounterAlign` | 直接 JSON |
| `primaryAxisSizing` | `AxisSizingMode` | 直接 JSON |
| `counterAxisSizing` | `AxisSizingMode` | 直接 JSON |
| `itemSpacing` | `number` | 直接 JSON |
| `counterAxisSpacing` | `number` | 直接 JSON |
| `paddingTop` | `number` | 直接 JSON |
| `paddingRight` | `number` | 直接 JSON |
| `paddingBottom` | `number` | 直接 JSON |
| `paddingLeft` | `number` | 直接 JSON |
| `layoutPositioning` | `'AUTO' \| 'ABSOLUTE'` | 直接 JSON |
| `layoutGrow` | `number` | 直接 JSON |
| `layoutAlignSelf` | `LayoutAlignSelf` | 直接 JSON |
| `handleMirroring` | `HandleMirroring` | 直接 JSON |
| `booleanOperation` | `'UNION' \| 'SUBTRACT' \| 'INTERSECT' \| 'EXCLUDE' \| undefined` | 直接 JSON |
| `strokeCap` | `StrokeCap` | 直接 JSON |
| `strokeJoin` | `StrokeJoin` | 直接 JSON |
| `borderTopWeight` | `number` | 直接 JSON |
| `borderRightWeight` | `number` | 直接 JSON |
| `borderBottomWeight` | `number` | 直接 JSON |
| `borderLeftWeight` | `number` | 直接 JSON |
| `independentStrokeWeights` | `boolean` | 直接 JSON |
| `strokeWeight` | `number` | 直接 JSON |
| `strokeMiterLimit` | `number` | 直接 JSON |
| `minWidth` | `number \| null` | 直接 JSON |
| `maxWidth` | `number \| null` | 直接 JSON |
| `minHeight` | `number \| null` | 直接 JSON |
| `maxHeight` | `number \| null` | 直接 JSON |
| `isMask` | `boolean` | 直接 JSON |
| `maskType` | `MaskType` | 直接 JSON |
| `maskIsOutline` | `boolean` | 直接 JSON |
| `gridColumnGap` | `number` | 直接 JSON |
| `gridRowGap` | `number` | 直接 JSON |
| `counterAxisAlignContent` | `'AUTO' \| 'SPACE_BETWEEN'` | 直接 JSON |
| `itemReverseZIndex` | `boolean` | 直接 JSON |
| `strokesIncludedInLayout` | `boolean` | 直接 JSON |
| `expanded` | `boolean` | 直接 JSON |
| `textTruncation` | `'DISABLED' \| 'ENDING'` | 直接 JSON |
| `autoRename` | `boolean` | 直接 JSON |
| `pointCount` | `number` | 直接 JSON |
| `starInnerRadius` | `number` | 直接 JSON |
| `componentId` | `string \| null` | 直接 JSON |
| `componentKey` | `string \| null` | 直接 JSON |
| `sourceLibraryKey` | `string \| null` | 直接 JSON |
| `publishId` | `string \| null` | 直接 JSON |
| `overrideKey` | `string \| null` | 直接 JSON |
| `sharedSymbolVersion` | `string \| null` | 直接 JSON |
| `publishedVersion` | `string \| null` | 直接 JSON |
| `isPublishable` | `boolean` | 直接 JSON |
| `isSymbolPublishable` | `boolean` | 直接 JSON |
| `isExposedInstance` | `boolean` | 直接 JSON |
| `symbolDescription` | `string` | 直接 JSON |
| `componentScale` | `number` | 直接 JSON |
| `internalOnly` | `boolean` | 直接 JSON |
| `flipX` | `boolean` | 直接 JSON |
| `flipY` | `boolean` | 直接 JSON |

#### O 类 · 对象字段（数组 / Record / 接口对象，需改名映射） —— 35 个

| 字段 | 类型 | 序列化处理 |
|---|---|---|
| `childIds` | `string[]` | 结构映射（改名 + 字段级编码） |
| `source` | `SourceMetadata` | 结构映射（改名 + 字段级编码） |
| `fills` | `Fill[]` | 结构映射（改名 + 字段级编码） |
| `strokes` | `Stroke[]` | 结构映射（改名 + 字段级编码） |
| `effects` | `Effect[]` | 结构映射（改名 + 字段级编码） |
| `layoutGrids` | `LayoutGrid[]` | 结构映射（改名 + 字段级编码） |
| `guides` | `CanvasGuide[]` | 结构映射（改名 + 字段级编码） |
| `textDecorationFills` | `Fill[]` | 结构映射（改名 + 字段级编码） |
| `textParagraphs` | `TextParagraphStyle[]` | 结构映射（改名 + 字段级编码） |
| `styleRuns` | `StyleRun[]` | 结构映射（改名 + 字段级编码） |
| `fontVariations` | `FontVariation[]` | 结构映射（改名 + 字段级编码） |
| `fontFeatures` | `FontFeature[]` | 结构映射（改名 + 字段级编码） |
| `vectorNetwork` | `VectorNetwork \| null` | 结构映射（改名 + 字段级编码） |
| `arcData` | `ArcData \| null` | 结构映射（改名 + 字段级编码） |
| `dashPattern` | `number[]` | 结构映射（改名 + 字段级编码） |
| `strokeAlign` | `Stroke['align']` | 结构映射（改名 + 字段级编码） |
| `targetAspectRatio` | `Vector \| null` | 结构映射（改名 + 字段级编码） |
| `gridTemplateColumns` | `GridTrack[]` | 结构映射（改名 + 字段级编码） |
| `gridTemplateRows` | `GridTrack[]` | 结构映射（改名 + 字段级编码） |
| `gridPosition` | `GridPosition \| null` | 结构映射（改名 + 字段级编码） |
| `instanceOverrides` | `InstanceOverrideState` | 结构映射（改名 + 字段级编码） |
| `componentPropertyDefinitions` | `ComponentPropertyDefinition[]` | 结构映射（改名 + 字段级编码） |
| `componentPropertyReferences` | `ComponentPropertyReference[]` | 结构映射（改名 + 字段级编码） |
| `componentPropertyAssignments` | `Record<string, string>` | 结构映射（改名 + 字段级编码） |
| `componentPropertyValues` | `Record<string, string>` | 结构映射（改名 + 字段级编码） |
| `librarySource` | `LibraryAssetSource \| null` | 结构映射（改名 + 字段级编码） |
| `symbolLinks` | `SymbolLink[]` | 结构映射（改名 + 字段级编码） |
| `variantPropSpecs` | `VariantPropSpec[]` | 结构映射（改名 + 字段级编码） |
| `boundVariables` | `Record<string, string>` | 结构映射（改名 + 字段级编码） |
| `variableModes` | `VariableModeMap` | 结构映射（改名 + 字段级编码） |
| `exportSettings` | `ExportSetting[]` | 结构映射（改名 + 字段级编码） |
| `pluginData` | `PluginDataEntry[]` | 结构映射（改名 + 字段级编码） |
| `pluginRelaunchData` | `PluginRelaunchDataEntry[]` | 结构映射（改名 + 字段级编码） |
| `textPathData` | `TextPathData \| null` | 结构映射（改名 + 字段级编码） |
| `textPathBox` | `Rect \| null` | 结构映射（改名 + 字段级编码） |

#### B 类 · 二进制（含 Uint8Array blob） —— 3 个

| 字段 | 类型 | 序列化处理 |
|---|---|---|
| `fillGeometry` | `GeometryPath[]` | 结构内嵌 blob，可无损转 SVG path 后入文本 |
| `strokeGeometry` | `GeometryPath[]` | 结构内嵌 blob，可无损转 SVG path 后入文本 |
| `textPicture` | `Uint8Array \| null` | **D1 必丢**：Skia 段落快照缓存，剔除即可，无需 base64 |

#### D 类 · 派生缓存（引擎算出来的；处理见下表备注） —— 4 个

| 字段 | 类型 | 序列化处理 |
|---|---|---|
| `derivedLayout` | `Partial<Rect> \| null` | **D1 必丢**：scene-graph 内无重算入口，重算在 core 的布局趟 |
| `variableBindingScales` | `Partial<Record<string, number>>` | **D2 必留**：只有实例同步/缩放会重算；scale≠1 时丢弃会让绑定解出不同的数 |
| `variableAssignmentScales` | `Partial<Record<string, number>>` | **D2 必留**：实例作用域的新声明单位；引擎自己的 round-trip 也保留（core transfer.ts:85-86） |
| `derivedTextGlyphs` | `DerivedTextGlyph[] \| null` | **D1 必丢**：文本整形重算（内含 commandsBlob 二进制） |

### 10.2 SceneGraph 实例级状态全表（23 个）

来源：同文件 `declare class SceneGraph` 的字段声明（`constructor` 之前），由 `scripts/gen-engine-semantics.py` 机器生成。

| 字段 | 类型 | 往返处理 |
|---|---|---|
| `idGenerator` | `（未在 .d.ts 标注）` | 私有（ID 生成器，构造期注入） |
| `nodes` | `Map<string, SceneNode>` | 必须往返（id → 节点，od-format 的主表） |
| `images` | `Map<string, Uint8Array<ArrayBufferLike>>` | **二进制**：外置 assets/ + hash 引用 |
| `variables` | `Map<string, Variable>` | 必须往返（变量声明） |
| `variableCollections` | `Map<string, VariableCollection>` | 必须往返（变量集合 + 模式表） |
| `activeMode` | `Map<string, string>` | 必须往返（collectionId → modeId） |
| `rootId` | `string` | 必须往返（文档根节点 id） |
| `figKiwiVersion` | `number \| null` | 可丢弃（.fig 导入溯源） |
| `figSchemaDeflated` | `Uint8Array \| null` | 可丢弃（二进制，.fig 导入溯源） |
| `documentColorSpace` | `DocumentColorSpace` | 必须往返（srgb / display-p3） |
| `enabledLibraries` | `Map<string, EnabledLibraryBinding>` | 必须往返（库启用绑定） |
| `emitter` | `BufferedSceneEmitter` | 私有（运行时事件总线） |
| `absPosCache` | `（未在 .d.ts 标注）` | 私有（绝对位置缓存，加载时清空） |
| `previewMutationDepth` | `（未在 .d.ts 标注）` | 私有（运行时深度计数） |
| `previewObservers` | `（未在 .d.ts 标注）` | 私有（运行时观察者） |
| `changeObservers` | `（未在 .d.ts 标注）` | 私有（运行时观察者） |
| `sourceMetadataPreservationDepth` | `（未在 .d.ts 标注）` | 私有（运行时深度计数） |
| `importedStateApplicationDepth` | `（未在 .d.ts 标注）` | 私有（运行时深度计数） |
| `importedIdGenerator` | `（未在 .d.ts 标注）` | 私有（导入期的 ID 生成器） |
| `layoutMutationDepth` | `（未在 .d.ts 标注）` | 私有（运行时深度计数） |
| `derivedLayoutDepth` | `（未在 .d.ts 标注）` | 私有（运行时深度计数） |
| `positionPreviewVersion` | `number` | 可丢弃（运行时计数） |
| `instanceIndex` | `Map<string, Set<string>>` | 可丢弃（派生索引，加载时由 registerNode 重建） |

### 10.3 计数摘要

SceneNode 共 154 个字段：S 112 / O 35 / B 3 / D 4；SceneGraph 实例级状态共 23 个。
<!-- END GENERATED: engine-semantics -->

---

## 11. 命门结论：组件 / 自动布局 / 变量 三类的往返可行性

`docs/research.md` §5.1 第 4 条：**组件 + 自动布局 + 变量 三者 round-trip 无损才算成立。**

### 11.1 逐类判断

| 类别 | 判断 | 依据（判据 = 「有 setter + 有重算入口」/「有可逆编解码」） |
|---|---|---|
| **组件** | **✅ 可无损往返** | override 有引擎自带可逆编解码（`src/instance-overrides.ts:52-78`，实测 JSON.stringify 会丢光）；组件定义/引用/赋值字段全是显式标量与简单结构（`src/types.ts:685-707`）。**前提**：override 用引擎编解码 + 主组件树与实例拷贝树一起存 + 用 `createNodeWithId` 加载 |
| **自动布局** | **⚠️ 意图可无损，结果不可靠** | 布局意图 30 余字段全是标量/字面量联合（`src/types.ts:605-676`），文本化零损耗。**但布局计算不在 scene-graph**（Yoga 在 core，`core/src/layout.ts:59`），几何结果（`x/y/width/height`）重算不保证逐位相同，且 Yoga flex 语义 ≠ Figma auto-layout |
| **变量** | **✅ 可无损往返**（有 3 个坑） | 变量/集合/模式全是显式结构（`src/types.ts:818-881`）；绑定编解码无损。**坑**：fills/strokes 必须保序（绑定路径带下标，`src/variables.ts:362`）；两个 scale 字段必须保留（`core/src/kiwi/fig/parse/transfer.ts:85-86` 佐证）；主题两层都要存（`activeMode` + `variableModes`） |

### 11.2 立项建议

**命门可以判定为「成立」**，但成立的方式要说清楚：

1. **组件与变量可以做到逐位无损**，前提是 od-format 严格遵守三件事：
   - override 用 `serializeInstanceOverrideState` 的 `[k, {defined, value}]` 三态数组编码；
   - `fills` / `strokes` 数组**保序**，绝不做「按类型归并」之类的重排；
   - `variableBindingScales` / `variableAssignmentScales` **保留**。
2. **自动布局只能保证「意图无损」**。若 Phase 1 的验收标准是「od-format 往返后节点几何与保存前逐位相同」，那就必须**照存几何**（`x/y/width/height` 原样往返），而不能指望重算——重算依赖 core 的 Yoga 趟，scene-graph 侧给不了保证。
3. **往返清单直接照抄 core 的 11 项**（§9.1），这是引擎自己对「什么算一个文档」的答案，比自己拍一套更可靠。

### 11.3 确认状态与未能确认的点

| 项 | 状态 |
|---|---|
| `enabledLibraries` 的键 | ✅ **已确认 = `libraryId`**（`core/src/library/materialize.ts:143`：全仓唯一写入处 `enabledLibraries.set(libraryId, { libraryId, revisionId, enabled: true })`）。初稿曾按「scene-graph 包内无写入方」标为未确认，经 core 侧追查后确认 |
| `publishId` / `overrideKey` / `sharedSymbolVersion` / `publishedVersion` / `isPublishable` / `isSymbolPublishable` / `symbolDescription` | ❌ **语义未确认**——在 `src/` 里**零读点**，只有声明 + 默认值。往返时原样保留即可，但别赋予含义 |
| `itemReverseZIndex` / `strokesIncludedInLayout` 是否影响布局 | ❌ **未确认**——core 的 `src/layout*` 里找不到消费方，只有 Figma-API 代理层暴露 |
| `instanceIndex` 的全量重建入口 | ❌ **无全量重建函数**——只有增量维护 + checkpoint 恢复。但用 `createNodeWithId` 逐个注册时**实测**会自动重建 |
| `derivedLayout` / `derivedTextGlyphs` 的重算时机 | ⚠️ **scene-graph 内无重算入口**，重算在 core（`core/src/layout/effective-generated-text.ts:274`）。本次调研**未实测** core 的重算行为（core 在 `shell/` 侧，本次只读） |
| Yoga flex 与 Figma auto-layout 的等价性 | ❌ **未实测**——需要构造用例对比 core 的布局输出，本次未做 |
