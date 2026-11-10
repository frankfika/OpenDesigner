# P0 验收报告 · od-format 往返保真度

> **本报告的每条结论都有真实命令输出支撑。** 没有「应该可以」。
> 复现命令见 §5。

- **日期**：2026-11-10
- **对象**：`packages/od-format`（od-format v0.1）+ `packages/od-cli`（od CLI）
- **依据**：`docs/research.md` §5.1（序列化保真度是技术命门）、§6.4（P0 验收标准）
- **被验收的规格**：`docs/od-format-spec.md` v0.1

---

## 0. 一句话结论

**P0 验收标准逐条 PASS。** 三类命门（组件 / 自动布局 / 变量）实测**往返无损**，
第四类（资源）按设计**外置**、引用无损。测试 **305 个全绿**，`tsc` 零错误，
`od` 命令五个子命令的退出码契约逐条验证。

但有 **3 处规格自身的不自洽**（§4），实现按「更安全的一侧」处理并立了记录 ——
这些是**规格的问题，不是实现的问题**，需要规格同步修订。

---

## 1. 四类场景 × 往返是否无损

| # | 场景 | 往返是否无损 | 证据（测试名） | 损失的细节 |
| --- | --- | --- | --- | --- |
| 1 | **组件 / 实例 / override** | ✅ **无损** | `fidelity/components.test.ts` 6 tests：组件关系、实例关系、拷贝子节点与源子节点的关联（`componentId`）、`self` 覆盖、`descendants` 覆盖、三态语义（`defined:false` 不丢）全部往返一致；整树经通用判定器比对**零差异** | 无。代价是**体积**：组件被用 N 次，文件里就有 N 份拷贝子树（规格 §4.1 决策 I-1 明确接受的代价） |
| 2 | **自动布局** | ✅ **意图无损**，且**结果也逐位无损** | `fidelity/layout.test.ts` 6 tests：布局模式 / 方向 / 换行 / 间距 / 交叉间距 / 内边距 / 主副轴对齐 / 尺寸策略 / grow / alignSelf / 约束 全部往返一致；子节点几何 `x/y/width/height` 照存（规则 G） | 无。规格 §4.2 的原判「结果不可靠」指的是**依赖重算**的方案；本实现**照存几何**，不依赖重算 → 结果也逐位相同 |
| 3 | **变量 + 主题模式** | ✅ **无损** | `fidelity/variables.test.ts` 8 tests：变量定义 / 各模式的值 / **别名** / 集合模式定义 / `defaultMode` / **文档级 `themes.active`** / 节点级 `variableModes` / 绑定路径翻译 / **D2 两个 scale 保留** / **画笔保序** 全部往返一致 | 无 |
| 4 | **图片资源** | ✅ **引用无损**（字节外置） | `fidelity/assets.test.ts` 5 tests：`fills[].imageHash` ↔ `assets{}` 键一致；注入 `assets` 后字节**逐字节**还原；od 文件里**不含**图片字节 | **字节不在 od 文件里**（设计如此：规格 §1.4 / 坑 3）。加载时由调用方通过 `toEngine(doc, { assets })` 注入，CLI 从磁盘的 `assets/<hash>.png` 读 |

### 通用判定器

所有场景用**同一个**结构等价判定器（`packages/od-format/tests/fidelity/oracle.ts`），
不是每个场景各写一套 ad-hoc 断言。

判定器比的是**语义**，不是原始 id —— 因为 od-format 的**核心设计**就是
「引擎随机 id ↔ 语义 odId」的转换，**往返后引擎 id 变了是设计使然，不是信息丢失**。
所以它把 id 换成语义标签再比：

- 节点 → `类型 + 前序路径 + 同名序号`
- 变量 → `变量名 + 类型`
- 集合 → `集合名`；模式 → `集合名/模式名`
- 组件属性 → `属性名`

比的范围：节点数 / 树形结构 / 每个节点的**全部 154 个字段**（剔除 D1 派生缓存）
/ 变量 / 集合 / 主题状态 / 资源字节 / 库绑定 / 文档色彩空间。

---

## 2. research.md §6.4 的 P0 验收标准 · 逐条结论

| 标准 | 结论 | 依据 |
| --- | --- | --- |
| **一个 .json 设计文件能被读写往返** | ✅ **PASS** | `encoding.test.ts` 159 tests：154 个字段**逐个**单独往返（一次只让一个字段偏离默认值 → 往返后断言它还在、值相同）；`roundtrip.test.ts` 8 tests：树结构 / 父子关系 / odId 恒等 / 幂等 / 确定性 |
| **v1→v2 迁移有测试覆盖** | ✅ **PASS** | `migration.test.ts` 14 tests：M1 确定性 / M2 幂等 / M3 无损（白名单外深度相等）/ 纯函数（入参不被就地改）/ **绑定路径同步改写**（只改字段名不改绑定路径 = 绑定静默失效）/ 找不到路径抛错**不做有损降级** |
| **引擎可在 Node 里 headless 运行** | ✅ **PASS** | 整个验收套件都在 Node 里跑引擎 API（`@open-pencil/scene-graph@0.16.0`），**不需要** `@open-pencil/core`、不需要浏览器、不需要 wasm |

### research.md §5.1 第 4 条（技术命门）

> 「组件 + 自动布局 + 变量 三者 round-trip 无损才算成立，必须先实测再立项」

✅ **实测成立**（见 §1 的第 1–3 行）。三条硬前提全部落地并有测试：

1. `instanceOverrides` 用引擎自带三态编解码（`serializeInstanceOverrideState` / `deserializeInstanceOverrideState`）——「键存在但值为 undefined」不丢
2. `variableBindingScales` / `variableAssignmentScales` **必留**（没有加载期重算入口）
3. `fills` / `strokes` **保序**（绑定按下标指向画笔，重排会让绑定静默指向另一个画笔）

---

## 3. 规格 §9.4 的 22 条 MUST 测试 · 覆盖情况

| # | MUST 测试 | 状态 | 在哪 |
| --- | --- | --- | --- |
| 1 | 154 字段全覆盖（**脚本生成，不手抄**） | ✅ | `encoding.test.ts` —— 测试里直接解析 `.d.ts`，断言零漏项零幽灵 |
| 2 | D1 派生字段 7 个都不出现 | ✅ | `encoding.test.ts` |
| 3 | 纯字段往返 | ✅ | `encoding.test.ts` —— 逐字段单独测（146 个用例） |
| 4 | 组件往返 | ✅ | `fidelity/components.test.ts` |
| 5 | 实例不膨胀 | ✅ | `fidelity/components.test.ts` |
| 6 | 自动布局往返 | ✅ | `fidelity/layout.test.ts` |
| 7 | 变量往返 | ✅ | `fidelity/variables.test.ts` |
| 8 | 幂等 | ✅ | `text.test.ts` + `roundtrip.test.ts` |
| 9 | 确定性 | ✅ | `text.test.ts` |
| 10 | odId 恒等 | ✅ | `roundtrip.test.ts` + `encoding.test.ts` |
| 11 | 复制 / 删除 / 改名 / 移动 | ✅ | `ids.test.ts`（改名、移动、复制各一例；删除见 §4.3） |
| 12 | blob 逐字节 | ✅ | `geometry.test.ts` —— **1000 条随机 blob → d → blob 逐字节相同** |
| 13 | JSONC 注释 | ✅ | `text.test.ts` —— 含「字符串里的 `//`」「转义引号」「块注释里的换行」 |
| 14 | 键序固定 | ✅ | `text.test.ts` —— 顶层 9 键 + 节点键序 + 自由对象字典序 + 两次序列化逐字节相同 |
| 15 | schema 同步 | ✅ | `schema.test.ts` —— 公开 JSON Schema 覆盖**每一个** od 路径；D1 不在、D2 必须在 |
| 16 | 迁移（6 条） | ✅ | `migration.test.ts` |
| 17 | CLI 退出码 | ✅ | `cli.test.ts` —— 0 / 1 / 2 / 3 / 4 每个码都有用例 |
| 18 | 建图三坑 | ✅ | `encoding.test.ts` —— 重复 id 报 OD1103 / 构造器自带节点不出现 / 新 id 来自单调计数器 |
| 19 | 派生字段两档 | ✅ | `encoding.test.ts` —— D1 不出现 + **D2 有值时一定出现且数值相同** |
| 20 | 画笔保序 | ✅ | `encoding.test.ts` + `fidelity/variables.test.ts` |
| 21 | 绑定路径翻译（36 条） | ✅ | `paths.test.ts` —— 对齐引擎 `variables/fields.ts` 白名单逐条双向；前导零被拒 |
| 22 | 几何逐位相同 | ✅ | `encoding.test.ts` —— 用 `Object.is` 断言（含 `0.1+0.2` 这种唯一精确值） |

---

## 4. 发现的规格不自洽（3 处）

> 规格是「已定稿」的文档。这里的问题**不修改**规格正文 —— 记在此处，
> 供后续修订规格时采纳。实现一律按**更安全的一侧**处理。

### 4.1 规格 §3.4 把 `bindings.scales` 的值说成了「变量 id」—— **事实是缩放乘数**

| | |
| --- | --- |
| 规格说 | `nodes[].bindings.scales{}` 的**值**是变量，engineId → odId |
| 事实 | `SceneNode.variableBindingScales: Partial<Record<string, number>>` —— **值是 number**（缩放乘数），键才是引擎字段路径 |
| 证据 | `scene-graph/src/variables/bindings.ts:51-52`：`const scale = node.variableBindingScales[field] ?? 1; const effective = value * scale` |
| 按规格实现的后果 | scale 会被当成变量 id 去重映射 → **绑定会静默解出不同的数**（最危险的一类 bug） |
| 本实现的处理 | 按引擎事实：值原样保留（number），键做路径翻译 |

### 4.2 规格 §2.5 的铸造算法与 §2.9 的「删除后重建不复用」互相矛盾

| | |
| --- | --- |
| 规格 §2.5 说 | 冲突判定看「文档里已用的 odId 集合」→ 删掉唯一的 `frame~hero` 后再建同名，会**复用** `frame~hero` |
| 规格 §2.9 说 | 「删除后重建同名节点 → 获得**新** odId（判别器继续递增），**不复用**旧 odId」 |
| 矛盾点 | 单计数器 `meta.ordinal` 表达不了「某个 base 曾被用过」—— 两个说法不可能同时满足 |
| 本实现的处理 | 取**更安全的一侧**：base 一旦用过就不再复用（`IdRegistry.usedBases`）。会话内 + 重新加载（节点还在）都正确 |
| **残留缺口（诚实记录）** | 节点在**上一次会话**就被删掉并落盘的话，它的 base 不在文件里 → 跨会话仍可能被复用。堵这个缺口需要额外的持久化状态（例如把「用过的 base 集合」写进文件），与规格 §1.1「顶层不允许表外键」冲突 → **需要规格决策** |

### 4.3 规格 §2.9 的「实例 detach」与 §2.11 的 `IdRegistry` 契约对不上

规格 §2.9 说「实例 detach → 被 detach 的子节点首次进入文件 → 此时铸造 odId」，
但 §2.11 的 `IdRegistry` 契约里**没有**「给已存在的节点补铸 odId」的入口
（`resolve(engineId, seed)` 需要 seed，`bind` 只登记已有映射）。
本实现用 `resolve(engineId, { kind, name })` 覆盖了这个场景 —— 规格的契约表应补这一条。

---

## 5. 复现命令

```bash
cd /workspace/OpenDesigner
npm install                      # 依赖已锁：zod 4.6.7 / vitest 5.1.0 / typescript 5.9.3
npx tsc -p tsconfig.json --noEmit   # 无错误
npx vitest run                      # 305 passed (15)
npm run od -- --help
```

验收套件单独跑：

```bash
npx vitest run packages/od-format/tests/fidelity/
# ✓ packages/od-format/tests/fidelity/variables.test.ts (8 tests)
# ✓ packages/od-format/tests/fidelity/components.test.ts (6 tests)
# ✓ packages/od-format/tests/fidelity/layout.test.ts (6 tests)
# ✓ packages/od-format/tests/fidelity/assets.test.ts (5 tests)
```

字段映射的机器自检（映射表与引擎 `.d.ts` 逐条吻合）：

```bash
python3 scripts/gen-od-field-map.py --check
# engine fields: 154  mapped: 154  treatments: {'改名': 133, '原样': 8, '合并': 9, '拆分': 1, '剔除': 3}
# OK: packages/od-format/src/field-map.ts 与生成器输出一致
```

---

## 6. 端到端演示（真实输出）

```console
$ npm run od -- convert --from od --to engine design.od.json design.odgraph.json
$ npm run od -- convert --from engine --to od design.odgraph.json design2.od.json
$ diff design.od.json design2.od.json && echo "逐字节一致"
逐字节一致
```

```console
$ npm run od -- validate design.od.json
✓ design.od.json 校验通过

$ npm run od -- inspect design.od.json
od-format 0.1 · 引擎 @open-pencil/scene-graph@0.16.0
Document (FRAME)  800×600                       frame~document
└─ Page 1 (CANVAS)                              canvas~page-1
   └─ Hero (FRAME)  375×200                     frame~hero
      └─ 标题 (TEXT)  327×48  "你好，世界"             text~hero-title
统计: 节点 4 · 变量 0 · 集合 0 · 组件 0 · 实例 0 · 资源 0
```

---

## 7. 还没做的（诚实清单）

| 项 | 状态 | 说明 |
| --- | --- | --- |
| `.fig` 载体 | ❌ 未做 | `od convert --to fig` 退出码 3（需要 `@open-pencil/core` 的 fig 读写）。规格 §8.2 已把 `.fig` 定位为后续增强；v0.1 的双向链路走 `engine` 载体，**只依赖 scene-graph** |
| 跨文档组件引用 | ❌ 不支持 | 规格 §4.1 明确排除；`od validate` 报 `OD1114` |
| 库组件的远端 override | ⚠️ 有条件 | 进 `component.overrides.external`，**原样保留**远端 id（规格 §4.1 决策 I-3）。本轮未构造库组件场景实测 —— 需要一个真实的库文件 |
| 行号 / 列号定位 | ❌ 未做 | 规格 §8.7 说 SHOULD。校验输出退回 JSON 路径（仍可用） |
| 渲染级像素比对 | ❌ 未做 | 本轮验收是**结构级**的（引擎文档树语义等价）。渲染比对需要 `@open-pencil/core` 的 headless 渲染，属于「证明视觉无损」的下一层，不在 od-format 这一层 |
| `meta.ordinal` 跨会话复用 base 的缺口 | ⚠️ 残留 | 见 §4.2 |
