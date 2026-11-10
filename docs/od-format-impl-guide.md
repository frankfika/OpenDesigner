# od-format 实现施工手册（从规格压缩而来）

> **这份是给实现者用的工作稿**，不是新规格——与 `docs/od-format-spec.md` 冲突时**以规格为准**。
> 生成方式：`python3 scripts/build-impl-guide.py`（从规格原文抽取，未改写内容）。
> 规格全文 2815 行，实现者不必通读；本手册已包含写代码所需的全部内容。
> 需要细节时用文末的**章节行号索引**定点读规格原文。
>
> ### ⚠️ 读法策略（上一轮就是死在这）
>
> **不要整份 `read` 本手册或规格。** 手册每节前面有 `<!-- ===== 标题 ===== -->` 标记，
> 用它定位、用 `sed -n '起,止p'` 只读需要的区间；单次 read 不要超过 300 行。
> 先花 5 分钟读懂你要写的那几节，**立刻开始写代码**，不要反复通读全文。
> 上一轮的执行者把整份 2815 行规格一次读完（4.7 万输入 token），30 分钟全部耗在读文档上，
> 一行代码都没写。

## 三条硬约束（违反即错，来自实测调研）

1. **`variableBindingScales` / `variableAssignmentScales` 必须往返保留** ——
   它们没有加载期重算入口（唯一写入口是实例同步/树缩放），且直接参与绑定解算
   `value * scale`。scale ≠ 1 时丢掉会**静默算出不同的数**。引擎自己的全图 round-trip
   也保留它们。
2. **`textPicture` 是派生缓存，剔除** —— 它是 Skia 段落快照，不是资产，不要走 base64 分支。
3. **`instanceOverrides` 必须用引擎自带的三态编解码**
   （`serializeInstanceOverrideState` / `deserializeInstanceOverrideState`，
   `scene-graph/src/instance-overrides.ts`）。直接 `JSON.stringify` 会丢光。
   同理**绝不能 `JSON.stringify(graph)`** —— TS 的 `private` 是编译期的事，
   会把 `emitter`/`absPosCache` 写进文本并把所有 `Map` 变成 `{}`。

## 依赖与版本（已锁定，别自己改）

- zod **4.6.7**：`z.record()` 要两个参数 `z.record(z.string(), z.unknown())`
- vitest **5.1.0**、typescript **5.9.3**（strict + noUncheckedIndexedAccess）
- `packages/od-format` 运行时依赖**只有** `@open-pencil/scene-graph@0.16.0` + `zod`
- `@open-pencil/core@0.16.0` 只在**根** devDependencies，可在测试里用它做渲染比对 /
  跑布局，但**不要**写进 od-format 的 dependencies
- JSON 字节数用 `Buffer.byteLength`（不是 `json.length`，那是 UTF-16 码元数）
- od-format **不跑布局**；规格 §9.2 有 `opts.layout` 注入点，调用方传 core 的布局函数

---

<!-- ===== 0.2 三条不可协商的约束 ===== -->

### 0.2 三条不可协商的约束

下面三条按优先级排序。任何设计冲突都按这个顺序裁决。

| # | 约束 | 含义 | 违反后果 |
| --- | --- | --- | --- |
| **C1** | **往返无损** | `toEngine(fromEngine(g))` 必须逐字段还原 `g`（派生字段除外，见 §3.1） | 组件/自动布局/变量三类命门直接塌，Phase 1 验收不通过 |
| **C2** | **diff 友好** | 只改一个属性，文件里只应出现一处改动；同一份设计保存两次，文件应逐字节相同 | agent 无法可靠 patch，人无法 review |
| **C3** | **agent 可直接读写** | 文本里出现的每个 id 都能被 agent 读懂并复述；没有需要外部查表才能解释的引用 | 「agent 直接编辑文本」的产品叙事落空 |

<!-- ===== 1.1 顶层键总表（规范顺序） ===== -->

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

<!-- ===== 1.2 `meta` — 文档元信息 ===== -->

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

<!-- ===== 1.4 `assets` — 外部二进制资源 ===== -->

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

<!-- ===== 2.2 odId 语法（正式文法） ===== -->

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

<!-- ===== 2.3 kind 前缀表 ===== -->

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

<!-- ===== 2.4 slug 生成算法（规范性） ===== -->

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

<!-- ===== 2.5 唯一性与判别器 ===== -->

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

<!-- ===== 2.6 odId ↔ engineId 映射：**文件里不存映射表** ===== -->

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

<!-- ===== 2.7 加载路径：`toEngine(doc)` ===== -->

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

<!-- ===== 2.8 保存路径：`fromEngine(graph, registry?)` ===== -->

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

<!-- ===== 2.11 `IdRegistry` API（实现契约） ===== -->

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

<!-- ===== 3.1 编码总则 ===== -->

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

<!-- ===== 3.2 节点字段映射全表（154/154） ===== -->

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

<!-- ===== 3.3 文档层字段映射（SceneGraph 12 字段） ===== -->

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

<!-- ===== 3.4 哪些字段的值是「引用」（需要重映射） ===== -->

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

<!-- ===== 3.5 变量绑定路径的翻译表（规范性） ===== -->

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

<!-- ===== 3.6 自由格式 Map 的编码（`Map` → 对象） ===== -->

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

<!-- ===== 3.7 `instanceOverrides` 的值编码 ===== -->

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

<!-- ===== 6.2 键顺序策略 ===== -->

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

<!-- ===== 6.3 缩进、换行、编码 ===== -->

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

<!-- ===== 6.4 浮点精度 ===== -->

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

<!-- ===== 8.1 全局约定 ===== -->

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

<!-- ===== 8.2 `od convert` ===== -->

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

<!-- ===== 8.3 `od inspect` ===== -->

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

<!-- ===== 8.4 `od validate` ===== -->

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

<!-- ===== 8.5 `od migrate` 与 `od schema` ===== -->

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

<!-- ===== 8.6 退出码 ===== -->

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

<!-- ===== 8.7 错误信息格式 ===== -->

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

<!-- ===== 9.1 包结构建议 ===== -->

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

<!-- ===== 9.2 公开 API（与 `packages/od-format/src/index.ts` 的现有注释对齐） ===== -->

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

<!-- ===== 9.3 实现顺序建议（每步都可独立验证） ===== -->

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

<!-- ===== 9.4 MUST 写的测试清单 ===== -->

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

<!-- ===== 章节行号索引（需要细节时定点读规格原文） ===== -->

| 行号 | 标题 |
|---|---|
| 11 | 0. 总则 |
| 13 | 0.1 一句话 |
| 17 | 0.2 三条不可协商的约束 |
| 27 | 0.3 目标 / 非目标 |
| 43 | 0.4 命名与排版约定（本文自身） |
| 52 | 0.5 上游事实核对表（本规格赖以成立的事实） |
| 76 | 0.6 core 侧已核实事实（`@open-pencil/core@0.16.0`） |
| 88 | 0.7 本文采信 `docs/engine-semantics.md` 的修正清单 |
| 104 | 1. od 文档顶层结构 |
| 106 | 1.1 顶层键总表（规范顺序） |
| 126 | 1.2 `meta` — 文档元信息 |
| 157 | 1.3 `nodes` — 节点集合 |
| 226 | 1.4 `assets` — 外部二进制资源 |
| 254 | 1.5 `variables` / `variableSets` — 变量与集合 |
| 340 | 1.6 `themes` — 主题模式 |
| 364 | 1.7 `libraries` — 外部库绑定 |
| 382 | 1.8 顶层完整示例 |
| 388 | 2. 语义 ID 层 |
| 392 | 2.1 问题陈述 |
| 408 | 2.2 odId 语法（正式文法） |
| 437 | 2.3 kind 前缀表 |
| 463 | 2.4 slug 生成算法（规范性） |
| 494 | 2.5 唯一性与判别器 |
| 532 | 2.6 odId ↔ engineId 映射：**文件里不存映射表** |
| 558 | 2.7 加载路径：`toEngine(doc)` |
| 582 | 2.8 保存路径：`fromEngine(graph, registry?)` |
| 612 | 2.9 odId 生命周期规则 |
| 633 | 2.10 非节点 id 的 odId |
| 648 | 2.11 `IdRegistry` API（实现契约） |
| 682 | 2.12 `idStrategy`：为 `.fig` 预留的口子 |
| 714 | 3. 字段映射表 |
| 716 | 3.1 编码总则 |
| 820 | 3.2 节点字段映射全表（154/154） |
| 1069 | 3.3 文档层字段映射（SceneGraph 12 字段） |
| 1088 | 3.4 哪些字段的值是「引用」（需要重映射） |
| 1122 | 3.5 变量绑定路径的翻译表（规范性） |
| 1190 | 3.6 自由格式 Map 的编码（`Map` → 对象） |
| 1215 | 3.7 `instanceOverrides` 的值编码 |
| 1255 | 4. 三类硬骨头 |
| 1260 | 4.0 结论速览 |
| 1270 | 4.1 组件 / 实例 / override |
| 1427 | 4.2 自动布局 |
| 1514 | 4.3 变量 + 主题模式 |
| 1614 | 4.4 已知信息损失总表（诚实清单） |
| 1635 | 4.5 三类骨头的验收红线（写进 Phase 1 的验收标准） |
| 1652 | 5. 版本策略与迁移框架 |
| 1654 | 5.1 `version` 字段的语义 |
| 1671 | 5.2 迁移器接口 |
| 1708 | 5.3 迁移器注册表与版本 schema 留存 |
| 1719 | 5.4 v0.1 → v1 的迁移怎么写（完整示例） |
| 1765 | 5.5 未知字段策略（向前兼容） |
| 1779 | 5.6 迁移的可测性 |
| 1816 | 5.7 版本策略表 |
| 1831 | 6. 文本形态 |
| 1833 | 6.1 JSONC 注释容忍 |
| 1862 | 6.2 键顺序策略 |
| 1885 | 6.3 缩进、换行、编码 |
| 1897 | 6.4 浮点精度 |
| 1946 | 6.5 Unicode 转义策略 |
| 1962 | 6.6 短数组的单行输出 |
| 1995 | 6.7 完整文本样例 |
| 2001 | 7. 公开 JSON Schema |
| 2003 | 7.1 生成方式 |
| 2037 | 7.2 产物位置 |
| 2052 | 7.3 防脱节机制 |
| 2077 | 7.4 Schema 的覆盖面 |
| 2091 | 8. CLI 契约 |
| 2093 | 8.1 全局约定 |
| 2122 | 8.2 `od convert` |
| 2192 | 8.3 `od inspect` |
| 2248 | 8.4 `od validate` |
| 2337 | 8.5 `od migrate` 与 `od schema` |
| 2351 | 8.6 退出码 |
| 2364 | 8.7 错误信息格式 |
| 2419 | 8.8 典型会话 |
| 2445 | 9. 实现清单（交给 `packages/od-format` 实现任务） |
| 2447 | 9.1 包结构建议 |
| 2489 | 9.2 公开 API（与 `packages/od-format/src/index.ts` 的现有注释对齐） |
| 2524 | 9.3 实现顺序建议（每步都可独立验证） |
| 2540 | 9.4 MUST 写的测试清单 |
| 2567 | 9.5 明确的「不做」清单（v0.1） |
| 2582 | 10. 待核实清单 |
| 2587 | 10.1 已关闭（engine-semantics 或本文直接核实） |
| 2598 | 10.2 仍未确认 |
| 2615 | 附录 A · odId 示例 |
| 2644 | 附录 B · 完整 od 文档样例 |
| 2796 | 附录 C · 术语对照 |

---

## 规格里**没有**收录、但你需要知道的

- §0.5 / §0.6 上游事实核对表（core 侧已核实事实）—— 想知道某条引擎行为是否已核实，看规格对应行号
- §1.3 `nodes` 集合（扁平数组 + parent 指针 + 前序遍历规则 + 节点键顺序）
- §1.5 变量与集合、§1.6 主题模式、§1.7 外部库绑定 —— 需要时按索引读规格
- §1.8 顶层完整示例 —— 实现完成后拿它当 fixture
- §3.1.1 省略规则（默认即省略）、§3.1.2 几何字段特殊省略（G1/G2）—— **在 §3.1 里**
- §4 三类硬骨头的完整讨论与验收红线（T1–T8）—— §4.5 有验收红线
- §5 版本策略与迁移框架（v0.1 → v1 的完整示例）
- §6.1 JSONC 注释容忍、§6.5 Unicode 转义、§6.6 短数组单行输出、§6.7 完整文本样例
- §7 公开 JSON Schema 的生成方式与防脱节机制
- §10 待核实清单
