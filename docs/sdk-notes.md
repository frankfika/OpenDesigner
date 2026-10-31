# Phase 0 · SDK 摸底结论

> **这份文档是本机实测结论（2026-10-31），不是推演。**
> 字段清单由 `scripts/gen-field-list.py` 从 `@open-pencil/scene-graph@0.16.0` 的类型定义**机器生成**，不手抄。
> 云电脑那边的任务是**逐条核对**下面这些结论 + 补齐浏览器实测，不是从零重做一遍。

## 0. 一句话结论

**文本序列化可行，而且上游已经证明过一次。**

引擎的整个文档模型（`SceneGraph` + `SceneNode` 154 字段）能无损摊成 JSON——上游自己的剪贴板格式 `openpencil/v1` 就是这么干的（`core/src/clipboard/openpencil.ts`）。
真正要花力气的是四个细节：**ID 要另做语义层、派生字段要剔除、图片要外置、`undefined` 字段要用 `.optional()`**（详见 §4.3）。

PLAN v3 的风险 #2（文本序列化保真度）**不构成红线**，但它也不是零成本——细节见 §4。

---

## 1. 版本与环境（已锁定）

| 包 | 锁定版本 | 说明 |
|---|---|---|
| `@open-pencil/core` | `0.16.0` | 引擎，framework-agnostic，无 peer 依赖 |
| `@open-pencil/scene-graph` | `0.16.0` | 文档模型 |
| `@open-pencil/vue` | `0.16.0` | peer：`vue ^3.5.41`、`canvaskit-wasm >=0.41.1` |
| `canvaskit-wasm` | `0.42.0` | 渲染后端（Skia WASM） |
| `vue` | `3.5.44` | 满足 `^3.5.41` |

npm registry 实查（2026-10-31）：三个 `@open-pencil/*` 的 `latest` 均为 `0.16.0`，发布于 2026-10-14；版本历史 `0.13.2 → 0.14.0 → 0.15.0 → 0.15.1 → 0.16.0`。

官方文档三个 URL 实测均 **HTTP 200**：

- https://openpencil.dev/programmable/sdk/getting-started
- https://openpencil.dev/programmable/sdk/guides/custom-editor-shell
- https://openpencil.dev/programmable/sdk/architecture

---

## 2. 文档模型全貌

### 2.1 没有独立的 Document / Page 类型

这是最容易搞错、也是写 schema 前必须先搞清楚的一点：

| 层级 | 实际是什么 | 位置 |
|---|---|---|
| 文档层 | `SceneGraph` **实例**（不是独立类型） | `scene-graph/src/index.ts:186` |
| 页面层 | `SceneNode` 且 `type === 'CANVAS'`（**和普通节点同一套字段**） | `addPage()` → `createNode('CANVAS', rootId)` |
| 节点层 | `SceneNode`（154 字段） | `scene-graph/dist/types.d.ts:2366`（源码 `src/types.ts:523`） |

`new SceneGraph()` 自带一个 root FRAME（名字 `Document`）+ 一张 `Page 1`（`index.ts:211-222`），不用自己 addPage。

推论：**页面没有自己的字段表**——页面上的 x/y/width/height 走的是节点字段，页面的子节点通过 `childIds` 挂在 root 下。

### 2.2 SceneGraph 文档层字段

见 §3.2 表格。

### 2.3 SceneNode 154 字段

见 §3.1 表格。

---

## 3. 字段清单

### 3.1 SceneNode 字段全表（154 个）

来源：`node_modules/@open-pencil/scene-graph/dist/types.d.ts`，`interface SceneNode`（由 `scripts/gen-field-list.py` 机器生成）。

#### A 类 · JSON 原生（number/string/boolean/字面量联合） —— 115 个

| 字段 | 类型 |
|---|---|
| `id` | `string` |
| `type` | `NodeType` |
| `name` | `string` |
| `parentId` | `string | null` |
| `x` | `number` |
| `y` | `number` |
| `width` | `number` |
| `height` | `number` |
| `rotation` | `number` |
| `fillStyleId` | `string | null` |
| `strokeStyleId` | `string | null` |
| `textStyleId` | `string | null` |
| `effectStyleId` | `string | null` |
| `gridStyleId` | `string | null` |
| `sharedStyleType` | `SharedStyleType | null` |
| `opacity` | `number` |
| `cornerRadius` | `number` |
| `topLeftRadius` | `number` |
| `topRightRadius` | `number` |
| `bottomRightRadius` | `number` |
| `bottomLeftRadius` | `number` |
| `independentCorners` | `boolean` |
| `cornerSmoothing` | `number` |
| `visible` | `boolean` |
| `locked` | `boolean` |
| `clipsContent` | `boolean` |
| `blendMode` | `BlendMode` |
| `text` | `string` |
| `fontSize` | `number` |
| `fontFamily` | `string` |
| `fontWeight` | `number` |
| `italic` | `boolean` |
| `textAlignHorizontal` | `'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED'` |
| `textDirection` | `TextDirection` |
| `textLanguage` | `string | null` |
| `textAlignVertical` | `TextAlignVertical` |
| `textAutoResize` | `TextAutoResize` |
| `textCase` | `TextCase` |
| `textDecoration` | `TextDecoration` |
| `textDecorationStyle` | `TextDecorationStyle` |
| `textDecorationThickness` | `number | null` |
| `textDecorationSkipInk` | `boolean` |
| `textUnderlineOffset` | `number | null` |
| `leadingTrim` | `LeadingTrim` |
| `lineHeight` | `number | null` |
| `letterSpacing` | `number` |
| `maxLines` | `number | null` |
| `listSpacing` | `number` |
| `paragraphSpacing` | `number` |
| `paragraphIndent` | `number` |
| `hangingList` | `boolean` |
| `horizontalConstraint` | `ConstraintType` |
| `verticalConstraint` | `ConstraintType` |
| `layoutMode` | `LayoutMode` |
| `layoutDirection` | `LayoutDirection` |
| `layoutWrap` | `LayoutWrap` |
| `primaryAxisAlign` | `LayoutAlign` |
| `counterAxisAlign` | `LayoutCounterAlign` |
| `primaryAxisSizing` | `AxisSizingMode` |
| `counterAxisSizing` | `AxisSizingMode` |
| `itemSpacing` | `number` |
| `counterAxisSpacing` | `number` |
| `paddingTop` | `number` |
| `paddingRight` | `number` |
| `paddingBottom` | `number` |
| `paddingLeft` | `number` |
| `layoutPositioning` | `'AUTO' | 'ABSOLUTE'` |
| `layoutGrow` | `number` |
| `layoutAlignSelf` | `LayoutAlignSelf` |
| `handleMirroring` | `HandleMirroring` |
| `arcData` | `ArcData | null` |
| `strokeCap` | `StrokeCap` |
| `strokeJoin` | `StrokeJoin` |
| `borderTopWeight` | `number` |
| `borderRightWeight` | `number` |
| `borderBottomWeight` | `number` |
| `borderLeftWeight` | `number` |
| `independentStrokeWeights` | `boolean` |
| `strokeWeight` | `number` |
| `strokeMiterLimit` | `number` |
| `minWidth` | `number | null` |
| `maxWidth` | `number | null` |
| `minHeight` | `number | null` |
| `maxHeight` | `number | null` |
| `targetAspectRatio` | `Vector | null` |
| `isMask` | `boolean` |
| `maskIsOutline` | `boolean` |
| `gridColumnGap` | `number` |
| `gridRowGap` | `number` |
| `gridPosition` | `GridPosition | null` |
| `counterAxisAlignContent` | `'AUTO' | 'SPACE_BETWEEN'` |
| `itemReverseZIndex` | `boolean` |
| `strokesIncludedInLayout` | `boolean` |
| `expanded` | `boolean` |
| `textTruncation` | `'DISABLED' | 'ENDING'` |
| `autoRename` | `boolean` |
| `pointCount` | `number` |
| `starInnerRadius` | `number` |
| `componentId` | `string | null` |
| `componentKey` | `string | null` |
| `sourceLibraryKey` | `string | null` |
| `publishId` | `string | null` |
| `overrideKey` | `string | null` |
| `sharedSymbolVersion` | `string | null` |
| `publishedVersion` | `string | null` |
| `librarySource` | `LibraryAssetSource | null` |
| `isPublishable` | `boolean` |
| `isSymbolPublishable` | `boolean` |
| `isExposedInstance` | `boolean` |
| `symbolDescription` | `string` |
| `componentScale` | `number` |
| `internalOnly` | `boolean` |
| `flipX` | `boolean` |
| `flipY` | `boolean` |
| `textPathBox` | `Rect | null` |

#### B 类 · 纯对象结构（改名映射即可，不含二进制） —— 32 个

| 字段 | 类型 |
|---|---|
| `childIds` | `string[]` |
| `source` | `SourceMetadata` |
| `fills` | `Fill[]` |
| `strokes` | `Stroke[]` |
| `effects` | `Effect[]` |
| `layoutGrids` | `LayoutGrid[]` |
| `guides` | `CanvasGuide[]` |
| `textDecorationFills` | `Fill[]` |
| `textParagraphs` | `TextParagraphStyle[]` |
| `styleRuns` | `StyleRun[]` |
| `fontVariations` | `FontVariation[]` |
| `fontFeatures` | `FontFeature[]` |
| `vectorNetwork` | `VectorNetwork | null` |
| `booleanOperation` | `'UNION' | 'SUBTRACT' | 'INTERSECT' | 'EXCLUDE' | undefined` |
| `dashPattern` | `number[]` |
| `strokeAlign` | `Stroke['align']` |
| `maskType` | `MaskType` |
| `gridTemplateColumns` | `GridTrack[]` |
| `gridTemplateRows` | `GridTrack[]` |
| `instanceOverrides` | `InstanceOverrideState` |
| `componentPropertyDefinitions` | `ComponentPropertyDefinition[]` |
| `componentPropertyReferences` | `ComponentPropertyReference[]` |
| `componentPropertyAssignments` | `Record<string, string>` |
| `componentPropertyValues` | `Record<string, string>` |
| `symbolLinks` | `SymbolLink[]` |
| `variantPropSpecs` | `VariantPropSpec[]` |
| `boundVariables` | `Record<string, string>` |
| `variableModes` | `VariableModeMap` |
| `exportSettings` | `ExportSetting[]` |
| `pluginData` | `PluginDataEntry[]` |
| `pluginRelaunchData` | `PluginRelaunchDataEntry[]` |
| `textPathData` | `TextPathData | null` |

#### B2 类 · 结构内嵌二进制 blob（可无损编码成文本） —— 2 个

| 字段 | 类型 |
|---|---|
| `fillGeometry` | `GeometryPath[]` |
| `strokeGeometry` | `GeometryPath[]` |

#### C 类 · 直接二进制（需 base64 或外置资产） —— 1 个

| 字段 | 类型 |
|---|---|
| `textPicture` | `Uint8Array | null` |

#### D 类 · 派生缓存（序列化时丢弃，加载时重算） —— 4 个

| 字段 | 类型 |
|---|---|
| `derivedLayout` | `Partial<Rect> | null` |
| `variableBindingScales` | `Partial<Record<string, number>>` |
| `variableAssignmentScales` | `Partial<Record<string, number>>` |
| `derivedTextGlyphs` | `DerivedTextGlyph[] | null` |

### 3.2 SceneGraph 文档层字段

| 字段 | 类型 | 序列化处理 |
|---|---|---|
| `nodes` | `Map<string, SceneNode>` | 对象数组（id → 节点） |
| `images` | `Map<string, Uint8Array<ArrayBufferLike>>` | **二进制**：外置 assets/ + hash 引用 |
| `variables` | `Map<string, Variable>` | 直接 JSON |
| `variableCollections` | `Map<string, VariableCollection>` | 直接 JSON |
| `activeMode` | `Map<string, string>` | 直接 JSON |
| `rootId` | `string` | 直接 JSON |
| `figKiwiVersion` | `number | null` | .fig 导入溯源，丢弃 |
| `figSchemaDeflated` | `Uint8Array | null` | **二进制**，.fig 导入溯源，丢弃 |
| `documentColorSpace` | `DocumentColorSpace` | 直接 JSON |
| `enabledLibraries` | `Map<string, EnabledLibraryBinding>` | 直接 JSON |
| `positionPreviewVersion` | `number` | 运行时计数，丢弃 |
| `instanceIndex` | `Map<string, Set<string>>` | 派生索引，丢弃后重算 |


---

## 4. 文本序列化可行性结论（字段级）

### 4.1 上游已经有一个现成参照：`openpencil/v1` 剪贴板格式

`core/src/clipboard/openpencil.ts` 的 `buildOpenPencilClipboardHTML()`，核心就一句：

```js
const serialized = { ...node, instanceOverrides: serializeInstanceOverrideState(node.instanceOverrides) }
```

**整个 SceneNode（全部 154 字段）直接摊进 JSON**，然后 `JSON.stringify` → `deflate` → base64 塞进 HTML 注释。粘贴时反向还原。

它处理四类麻烦的方式（**od-format 直接照抄这张表**）：

| 问题 | 上游做法 | 位置 |
|---|---|---|
| `instanceOverrides` 用 `Map` 存 | `serializeInstanceOverrideState()` → 数组 of `[key, value]` tuples | `scene-graph/src/instance-overrides.ts` |
| `textPicture`（`Uint8Array`） | base64 字符串 | `openpencil.ts` 的 `collectNodeTree` |
| 几何 `commandsBlob`（`Uint8Array`） | 靠 `Uint8Array` 的**原生 JSON 形态** `{"0":1,"1":2,…}`，还原时 `Uint8Array.from(Object.values(...))` | `restoreGeometry()` |
| 图片资产 | `images: Record<hash, base64>` | `buildOpenPencilClipboardHTML()` |

> 注意第三条：这不是巧合，是 `Uint8Array` 在 `JSON.stringify` 下的天然行为。**几何 blob 无损往返是上游已经在跑的生产代码，不是推测。**

### 4.2 结论：可行

- **154 个节点字段**：115 个 JSON 原生 + 32 个纯对象结构（改名即可）+ 2 个内嵌二进制 blob（可无损编码成文本）+ 1 个 base64 + 4 个派生（丢弃重算）→ **100% 可表达**
- **几何 blob**：可无损编码（见 §6.4）
- **图片**：可外置为 `assets/`
- **文档层 Map**：`variables` / `variableCollections` / `activeMode` / `enabledLibraries` 全是纯对象，直接 JSON

### 4.3 但有三个坑（Phase 1 必须处理）

#### 坑 1：ID 不语义化 —— 直接影响「git diff 友好」

`generateId()` 的实现（`scene-graph/src/index.ts:147-171`）：

```js
let idSession = randomIdSession()          // 每个进程随机
let nextLocalID = 1
export function generateId(): string {
  return `${idSession}:${nextLocalID++}`
}
```

即节点 ID 形如 `48213:57`。

- ✅ **好消息**：已有节点的 ID 在多次保存之间不变 → 字段级 diff 不会全量抖动
- ❌ **坏消息**：新节点 ID 带随机进程前缀，不可读不可预测；同一份设计导入两次会得到两套完全不同的 ID

**结论**：`od-format` 必须自己维护一层语义 ID（`odId ↔ engineId` 映射），否则「agent 直接编辑文本」和「人读得懂」两个目标都达不到。这是 Phase 1 的**首要设计项**，不是优化项。

#### 坑 2：派生字段必须剔除，否则 diff 全是噪音

| 位置 | 字段 | 处理 |
|---|---|---|
| 节点 | `derivedLayout` | 丢弃，加载时重算 |
| 节点 | `derivedTextGlyphs` | 丢弃，字形重排时重算 |
| 节点 | `variableBindingScales` | 丢弃，派生量 |
| 节点 | `variableAssignmentScales` | 丢弃，派生量 |
| 文档 | `instanceIndex` | 丢弃，实例索引重算 |
| 文档 | `positionPreviewVersion` | 丢弃，运行时计数 |

不剔除的后果：diff 里全是布局噪音；且可能把**过期缓存**写回文件，污染下游。

#### 坑 3：图片别内联 base64

`graph.images: Map<string, Uint8Array>`，由 `Fill.imageHash` 引用。base64 内联进 `.od.json` 会让文件完全不可读、diff 变成天书。

**建议**：`assets/<hash>.png` + 文档里只留 hash 引用。`Fill.imageHash` 本来就是引用，改造量很小。

#### 坑 4：`undefined` 值的字段在 JSON 里会消失

`JSON.stringify` 会丢掉值为 `undefined` 的键。实测：`booleanOperation: 'UNION' | ... | undefined`
这类字段在序列化后直接没了（5 个节点共丢了 5 个字段）。

**对 schema 的影响**：可空字段要用 `.optional()`，不能用 `.nullable()`。
- `.nullable()` = 键必须在，值可以是 `null`
- `.optional()` = 键可以整个不存在

引擎里有不少字段是 `T | undefined`（不是 `T | null`），照抄类型定义写 schema 时要分清这两者。

### 4.4 上游的 `.pen` 格式：只读，但值得抄

`core/dist/io/formats.js` 里的 `penFormat`：

```js
role: "interchange-document",
support: { readDocument: true },   // ← 只有读，没有 exportContent
```

→ **上游确实没有可写的文本格式**，PLAN v3「上游走 .fig 二进制兼容路线」的前提**成立**，差异化叙事站得住。

但 `@open-pencil/pen` 的解析器仍是一份现成的「文档模型 → JSON」实现参考（`PenDocument` / `PenNode`，42 字段的**紧凑有损子集**）。它的取舍反过来告诉我们：**.od.json 要无损，就得自己扛全部 154 个字段**——没有捷径。

---

## 5. 最小壳：怎么跑，无头环境会踩什么

`shell/` 是可直接运行的骨架（`npm run build` 已通过 `vue-tsc` 类型检查）。

### 坑 A：wasm 必须在站点根目录

`core/src/canvaskit.ts` 的 `getCanvasKit()` 浏览器分支：

```js
const base = 'env' in import.meta ? import.meta.env.BASE_URL : '/'
return `${prefix}/${file}`       // → /canvaskit.wasm
```

Vite 默认不会把 `node_modules` 里的 wasm 复制到站点根 → **必然 404**。
`shell/vite.config.ts` 里加了一个插件，dev 用中间件直吐、build 时把 `node_modules/canvaskit-wasm/bin/canvaskit.wasm` 写进产物根。

**已验证**：dev server 的 `/canvaskit.wasm` 返回 `200`、`Content-Type: application/wasm`、7317345 字节、魔数 `00 61 73 6d`（合法 WASM）；`npm run build` 产物里 `dist/canvaskit.wasm` 落在根目录。

### 坑 B：上游 @open-pencil/core@0.16.0 的打包 bug（必踩）

core 的 dist 里有 `.js` 文件，但引用时**漏改了扩展名**：

| 文件 | 引用 | 实际存在的文件 |
|---|---|---|
| `dist/io/formats/fig/export.js` | `new Worker(new URL("./export-worker.ts", import.meta.url))` | `export-worker.js` |
| `dist/kiwi/fig/session/client.js` | `new Worker(new URL("./worker.ts", import.meta.url))` | `worker.js` |

全量扫过三个包的 dist，**只有 core 这两处**（`scene-graph` 和 `vue` 的 dist 没有同类问题）。
但只要构建引到 core 根导出，就必然在这一步挂：
`Could not resolve entry module ".../export-worker.ts"`。

**解法**（已写进 `shell/vite.config.ts`）：用 Vite 的 `resolve.alias` 在 pre 阶段把 worker 的 `.ts` 改回 `.js`：

```js
{ find: /(export-worker|worker)\.ts$/, replacement: '$1.js' }
```

⚠️ **别写成 `/\.ts$/`** —— 那会连 SFC 的 `?vue&type=script&lang.ts` 一起改掉，构建会以
`Expected ',', got ':'` 挂在编译产物上。规则只认 worker 文件名。

> 这是一个**上游 bug**，值得给 open-pencil/open-pencil 提个 PR（改动就是发布时把 `.ts` 后缀 rewrite 掉）。

### 坑 C：Top-level await，dev server 会直接挂

依赖里有 top-level await，Vite 默认的 esbuild target（es2020）不认：

```
✘ [ERROR] Top-level await is not available in the configured target environment ("chrome87", "edge88", "es2020", ...)
```

`npm run dev` 会带着这个错误启动然后死掉。**解法**：`esbuild.target` 和 `optimizeDeps.esbuildOptions.target` 都设 `es2022`。

### 坑 D：画布要 WebGL2 —— 但无头浏览器通常有

`CanvasSurface` 用 WebGL2 建 surface，失败时会在 canvas 上标 `data-surface-error="webgl"`
（`@open-pencil/vue/dist/canvas/CanvasRoot.js`：`canvas.dataset.surfaceError = "webgl"`；
主 surface 是 `canvas.getContext("webgl2") ?? null`，**没有 webgl1 兜底**）。

**实测结论（推翻「无 GPU 就一定挂」的悲观预期）**：无头 Chromium 走 SwiftShader 软件光栅化，
**WebGL2 是可用的**（`glRenderer: "WebKit WebGL"`），画布正常渲染，蓝色矩形像素级正确。
所以「浏览器渲染取不到证」通常不是 GPU 的锅，先查配置（见坑 E）。

### 坑 E：dev server 白屏 —— `optimizeDeps.exclude` 不能排除 canvaskit-wasm

**这个坑最坑**：dev server 能起来、`/` 返回 200、wasm 也发得出去，但**页面全白**，console 报：

```
The requested module '/node_modules/canvaskit-wasm/bin/canvaskit.js'
does not provide an export named 'default'
```

原因：`canvaskit-wasm` 是 CJS（`module.exports = CanvasKitInit`）。
一旦写进 `optimizeDeps.exclude`，Vite 就不再预打包它，直接把原始 CJS 当 ESM 送出去 → 没有 default 导出。

**症状迷惑性极强**：build 出来是好的（Rollup 自己处理 CJS），只有 dev 白屏。
很容易误判成「云电脑环境问题」或「GPU 问题」，实际是自己配的。

**解法**：**不要排除它**，让 Vite 正常预打包（esbuild 会补好 default 导出）。
本仓库的 `shell/vite.config.ts` 已按此修正——**别改回去**。

> 若用 `npm run preview`（先 build 再 preview）取证，则完全绕过这个坑：
> 生产产物里 canvaskit 已被 Rollup 正确处理，preview 路径本来就能正常渲染。
> **两条路都验过了**：修复后的 dev 与 preview 均渲染出正确的蓝色矩形。

### 解法：Node 侧无头渲染，不需要浏览器

`npm run render-check` 走引擎自带的 `headlessRenderNodes()`（`core/src/io/formats/raster/headless.ts`），Node + CanvasKit WASM 直接出 PNG，产物在 `shell/out/render-check.png`。

**云电脑先跑这个**——它能证明「引擎能画」且完全绕开 GPU 问题；浏览器壳（`npm run dev`）作为第二道验证。

### 坑 E：Vue 版本

`@open-pencil/vue@0.16.0` 要求 `vue ^3.5.41`。Vite 的 `vue-ts` 模板给的版本可能偏低，装完先 `npm ls vue` 看一眼。

### 坑 F：`Color` 必带 `a`

`Color` 是 `{ r, g, b, a }`，四个字段全是必填。少写 `a` 会被 `vue-tsc` 拦下：
`Property 'a' is missing ... but required in type 'Color'`。

### 坑 G：变量绑定的字段路径有固定格式

`graph.bindVariable(nodeId, field, variableId)` 的 `field` 不是随便一个节点字段名：

| 类型 | 合法字段 |
|---|---|
| 数值 | `opacity` `width` `height` `minWidth` `maxWidth` `minHeight` `maxHeight` `x` `y` `rotation` `cornerRadius` `topLeftRadius` `topRightRadius` `bottomLeftRadius` `bottomRightRadius` `strokeWeight` `borderTopWeight` `borderBottomWeight` `borderLeftWeight` `borderRightWeight` `fontSize` `letterSpacing` `lineHeight` `paddingLeft` `paddingRight` `paddingTop` `paddingBottom` `itemSpacing` `counterAxisSpacing` `gridRowGap` `gridColumnGap` |
| 字符串 | `text` `fontFamily` |
| 布尔 | `visible` |
| 颜色 | `fills/<索引>/color`、`strokes/<索引>/color` |

写 `fills` 会直接抛 `Unknown binding field "fills"`。
来源：字段集合在 `scene-graph/src/variables/fields.ts`，校验与颜色路径解析在 `scene-graph/src/variables.ts` 的 `bindVariable()`。

### 其它已确认的 API 事实

- `createEditor` 出自 `@open-pencil/core/editor`（不是包根），`createDefaultEditorState(page.id)` 同源
- `state` 必须包 `reactive()`，Vue 侧才观察得到变化
- `getViewportSize` 返回的是**画布容器**尺寸，不是窗口尺寸
- `provideEditor(editor)` 在壳的顶层调一次；`CanvasRoot` 自己会初始化 CanvasKit 并创建 renderer
- 官方示例用了 Tailwind 的 `size-full`；`shell/src/style.css` 里手写了等价类，不引 Tailwind
- **`createCollection(name)` 只收一个参数**——0.16.0 的变量集合**没有类型字段**，
  变量类型由 `createVariable(name, type, collectionId, value?)` 的 `type` 参数决定。
  多传一个 `'color'` 不会报错，但会被静默忽略（JS 允许多余实参），
  而 `shell/scripts/*.mjs` 是纯 JS、不在 tsconfig 里，**类型检查抓不到这种错**——
  Phase 1 改写成 TS 时才会暴露。

---

## 6. 给 Phase 1（od-format）的输入

1. **格式骨架**照抄 `openpencil/v1` 的思路，但要加：版本号字段、固定键序、语义 ID 层（坑 1）
2. **派生字段黑名单**（坑 2）写进 schema 的 exclude 列表，并写一条单测断言这些字段不在输出里
3. **图片**走 `assets/` + hash 引用（坑 3）
4. **几何 blob** 二选一：
   - SVG path `d` 字符串 —— 人类可读、diff 友好
   - 字节记录 —— 无损但不可读

   **建议用 `d` 字符串**。blob 格式本身就是「1 字节 opcode + float32 小端坐标对」（`0=close, 1=move, 2=line, 3=quad, 4=cubic`，见 `scene-graph/src/geometry.ts:319-327`），与 SVG path 的 `Z/M/L/Q/C` 一一对应，可无损互转。上游两个方向都有现成实现：
   - blob → path：`core/src/io/formats/svg/paths.ts` 的 `geometryBlobToSVGPath()`
   - path → blob：`core/src/vector/fill-geometry.ts` 的 `PathSink.toBlob()`
5. **文档层 Map 要补齐**：`variables` / `variableCollections` / `activeMode` / `enabledLibraries` 必须进格式（上游剪贴板没带这些，因为它只复制选中子树；我们存的是整份文档）
6. **共享样式不用单独存**：`getSharedStyles()` 是从节点的 `sharedStyleType` + `source.id` **派生**出来的，节点存了就有
7. **评论和交互行为不用单独存**：它们在 `pluginData` 里（`PluginDataField`），值是字符串，JSON 安全

---

## 7. 复现命令

```bash
cd shell
npm install
npm run typecheck        # vue-tsc 严格类型检查
npm run build            # vite build（含 wasm 落到产物根）
npm run render-check     # Node 无头渲染 → shell/out/render-check.png
npm run serialize-probe  # 文档模型 → JSON 往返 → shell/out/sample.od.json
```

浏览器取证（需要 Playwright，没装就跳过，用 `render-check` 顶上）：

```bash
cd shell
npm run dev -- --port 5300 &
node scripts/browser-check.mjs http://localhost:5300/ out/browser-shot.png
```

`browser-check.mjs` 会打印 `canvasCount` / `webgl2` / `surfaceError` 三项并截图，
全对就打印 `BROWSER CHECK: PASS`。

字段清单重新生成：

```bash
python3 scripts/gen-field-list.py \
  shell/node_modules/@open-pencil/scene-graph/dist \
  /tmp/field-list.md
```

### 7.1 本机验证结果（2026-10-31，真实输出）

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | ✅ PASS（首次报 `Property 'a' is missing in type 'Color'`，已修，见坑 F） |
| `npm run build` | ✅ PASS，`dist/canvaskit.wasm` 落在产物根（7,317.35 kB） |
| `npm run render-check` | ✅ PASS，`shell/out/render-check.png`，582 bytes，矩形 240×160 已实际渲染出蓝色块 |
| `npm run serialize-probe` | ✅ PASS，5 节点 × 154 字段 = 770 字段，往返零丢失，`sample.od.json` 26,953 bytes |
| dev server `/canvaskit.wasm` | ✅ 200 / `application/wasm` / 7,317,345 bytes / 魔数 `00 61 73 6d` |
| dev server `/` 与 `/src/main.ts` | ✅ 200 |
| **浏览器实际渲染（无头 Chromium）** | ✅ **已验证**：canvas 1280×752、WebGL2 可用（SwiftShader）、`surfaceError` 为 null，截图里蓝色矩形 38,400 像素、bbox x 80–319 / y 128–287 = 正好 240×160（y 偏移 48 是顶栏） |
| 浏览器取证的两条路 | ✅ 都通：`npm run dev`（修复后）与 `npm run preview`（先 build） |
| 去掉 exclude 之后的 build | ✅ PASS（2m21s），产物哈希与之前完全一致，`dist/canvaskit.wasm` 仍在根目录 |
| **从 git bundle 全新 clone 后重跑** | ✅ **全链路 PASS**：clone → `npm install` → typecheck → build → render-check → serialize-probe → dev → 浏览器，全部通过，且 build 产物哈希与原仓库逐字节一致 |
| 字段清单脚本在干净环境的重生成结果 | ✅ 与仓库已提交文档**逐条零漂移**：§3.1 = 154 行（115+32+2+1+4），§3.2 = 12 行，字段名与类型全部一致 |

### 7.1.1 从 bundle 全新 clone 的验证（2026-10-31）

不信任"我这边能跑"，专门从交付用的 bundle 重新 clone 一遍跑全流程：

```bash
git clone -b main /path/to/OpenDesigner-phase0.bundle repo
cd repo/shell && npm install && npm run typecheck && npm run build && npm run render-check && npm run serialize-probe
```

> ⚠️ **`git clone <bundle>` 不加 `-b main` 会克隆出空仓库**：
> bundle 的 HEAD 指向 `refs/heads/main`，而 `git clone` 默认找 `refs/heads/master`，
> 会打印 `warning: remote HEAD refers to nonexistent ref, unable to checkout` 然后给你一个空壳。
> **要么加 `-b main`，要么在已 clone 的仓库里 `git fetch <bundle> main:refs/heads/main`。**

实测结果：20 个受版本控制的文件全部到位，无 `node_modules` 误提交，四个 npm 脚本全绿，
`gen-field-list.py` 在干净环境重新生成仍是 154 字段且与文档零漂移。

### 7.1.2 依赖安全（`npm audit`）

`npm install` 会报 7 条公告（3 moderate / 4 high）。**不要跑 `npm audit fix --force`**——
它建议的"修复"是把 `@open-pencil/core` 降级到 0.13.2（跨 major），会直接毁掉本次摸底的前提。

| 公告 | 来源 | 处置 |
|---|---|---|
| Vite `server.fs` 未应用到 HTML / public 同名文件可被中间件读到 | **直接依赖 vite 6.3.5** | ✅ **已修**：升到 6.4.5（同 major，无破坏性变更），复验 build 产物哈希不变、dev 浏览器渲染仍 PASS |
| `pptxgenjs` → `image-size` 畸形 JXL/HEIF/ICNS 解析死循环 | 传递依赖，经 `@open-pencil/core` | **保留**：npm 给的"修复"是引擎降级，不接受。触发条件是喂畸形图片，属引擎上游问题；dev 壳不处理外部图片 |
| `minimatch` globparts 放大导致 ReDoS | 传递依赖，经 `vue-tsc` → `@vue/language-core` | **保留**：修复需 `vue-tsc` 升到 3.x（跨 major）。仅 dev 期类型检查用，不进产物 |

升 vite 后复验：`typecheck` ✅ / `build` ✅（产物哈希不变）/ `render-check` ✅ /
`serialize-probe` ✅ / dev server ✅ / **浏览器渲染 ✅ BROWSER CHECK: PASS**。

> **浏览器 console 里的 404 和字体警告是已知噪音，不是故障**：
> `Failed to load resource: 404` 与 `OTS parsing error: invalid sfntVersion` /
> `Failed to load font "Inter"` —— 都是字体资源没取到，**不影响画布渲染**，
> 矩形照样画出来。判断是否成功请看 `canvasCount` / `webgl2` / `surfaceError` 三项。

serialize-probe 的实际输出：

```
[serialize-probe] 文档节点数: 5
[serialize-probe] 单节点字段数: 154, 154, 154, 154, 154
[serialize-probe] 字段总计: 770
[serialize-probe] 变量: 2 个
[serialize-probe] 变量集合: 2 个
[serialize-probe] JSON 体积: 26953 bytes
[serialize-probe] 因值为 undefined 被 JSON 丢弃的字段数: 5 （→ schema 该用 .optional()，不是 .nullable()）
[serialize-probe] PASS: .../shell/out/sample.od.json
[serialize-probe] 绑定字段: {"fills/0/color":"2023314381:8","opacity":"2023314381:11"}
```

> **别拿字节数当验收标准。** 节点 ID 是 `${随机会话号}:${计数器}`，会话号位数会变，
> 所以 JSON 体积每次跑会差几十字节（实测 26,875–26,953）。**验收看「字段总数 770」和「PASS」**。
> 绑定字段里的 ID 同理，每次都不一样。

---

## 8. 待云电脑核对项

云电脑**只需核对下面这些**，不需要重做分析。每条都要在 `docs/sdk-notes.md` 里标 ✅/❌ 并附真实输出。

**已在本机验证过的（1–8 全部）**：云电脑重跑一遍确认在自己机器上也成立即可，重点是贴真实输出。

| # | 待核对 | 怎么验 | 本机结果 |
|---|---|---|---|
| 1 | 四个包版本与 §1 一致 | `npm ls @open-pencil/core @open-pencil/scene-graph @open-pencil/vue canvaskit-wasm vue` | ✅ 0.16.0 / 0.16.0 / 0.16.0 / 0.42.0 / 3.5.44 |
| 2 | `npm run typecheck` 通过 | 贴完整输出 | ✅ PASS |
| 3 | `npm run build` 通过，wasm 落根 | 贴完整输出，确认 `dist/canvaskit.wasm` 在根目录 | ✅ PASS |
| 4 | `npm run render-check` 出 PNG | 贴输出 + 报告 PNG 字节数 | ✅ PASS，582 bytes |
| 5 | `npm run serialize-probe` 往返无丢失 | 贴输出 | ✅ PASS，770 字段零丢失 |
| 6 | **浏览器壳能打开并画出矩形** | `npm run dev` + 截图 | ✅ **已验证**，见 §7.1 |
| 7 | 字段数是 154 | `python3 scripts/gen-field-list.py shell/node_modules/@open-pencil/scene-graph/dist /tmp/field-list.md` | ✅ 154 |
| 8 | 官方文档三个 URL 可达 | `curl -o /dev/null -w '%{http_code}'` | ✅ 全 200 |

### 6 号（浏览器渲染）的注意事项

- 画布走 **WebGL2**；实测无头 Chromium（SwiftShader）**可用**，不要预设「无 GPU 就一定失败」
- **白屏先查配置，不是查环境**：如果 `npm run dev` 出来是白页 + console 报
  `does not provide an export named 'default'`，那是 `vite.config.ts` 里的
  `optimizeDeps.exclude` 把 canvaskit-wasm 排除掉了，**不是** GPU 问题。
  本仓库已修好，别改回去（见 §5 坑 E）
- 兜底取证路径：`npm run build && npm run preview`，这条不经过 dev 的依赖预打包
- 取不到就**如实报告**，把 console 报错贴出来，标 ❌ + 原因
- **不许伪造截图**，不许用别的东西冒充画布
- `npm run render-check`（Node 侧无头渲染）完全不依赖 GPU，是最可靠的兜底证据

### 如果云电脑上构建挂了

大概率是 §5 坑 B（上游 worker `.ts` 后缀）和坑 C（top-level await）的配置问题——
`shell/vite.config.ts` 里已经都修了，**不要删那两个配置**。如果还是挂，把完整报错贴出来。

**不许做的事**：改 `docs/sdk-notes.md` 里已核实的结论（可以补充、可以标 ❌ 并附证据，但不许静默改写）、写新规划、实现 Phase 1 及以后的功能。

