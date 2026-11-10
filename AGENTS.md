# AGENTS.md · OpenDesigner 协作约定

> 本文件是**导航 + 防错清单**，不是规格正文。
> 规格正文在 `docs/od-format-spec.md`（2816 行，已定稿）。**别改写、别复制它**——按它做即可。

## 1. od-format 的权威契约在哪

**规格正文 = `docs/od-format-spec.md`**（约 2800 行，已定稿，是唯一权威）。
**实现者的工作稿 = `docs/od-format-impl-guide.md`**（从规格机械抽取，非新规格，冲突时以规格为准）。

> ### ⚠️ 读法策略：不要整份 read
>
> 上一轮实现任务的失败根因就是**把 2815 行规格一次读完**（4.7 万输入 token），30 分钟耗在读文档上，一行代码没写。
>
> - **别整份 read 规格或施工手册。** 手册每节前有 `<!-- ===== 标题 ===== -->` 标记，用它定位、用 `sed -n '起,止p'` 只读需要的区间；**单次 read 不超过 300 行**。
> - 施工手册文末有**章节行号索引**，需要细节时定点回查规格原文。
> - 读完要写的那几节就**立刻开写**，别反复通读全文。

| 你要做的事 | 看哪一节 |
| --- | --- |
| 顶层结构 / 节点对象形状 | 规格 §1 |
| odId 文法、判别器、生命周期 | 规格 §2（文法 §2.2、判别器 §2.5、映射 §2.6、`IdRegistry` 契约 §2.11） |
| 引擎字段 → od 字段的**全量**映射 | 规格 §3.2（154/154） |
| 变量绑定路径双向翻译 | 规格 §3.5（36 条） |
| 组件 / 自动布局 / 变量 三类往返 | 规格 §4 |
| CLI 参数、退出码、错误码 | 规格 §8（校验项 §8.4） |
| 公开 API 签名 | 规格 §9.2 |
| 还没确认的 10 条 | 规格 §10.2 |

`packages/od-format/src/index.ts` 的文件头注释是**出口摘要**，契约以规格 §9.2 为准。
施工手册由 `python3 scripts/build-impl-guide.py` 从规格原文机械生成——**别手改手册**，改了会在下次生成时被覆盖。

## 2. 五条「照做，但别搞反」

这几条是被上游实测推翻过的直觉。**搞反了会静默丢数据**，且不一定报错。

1. **派生字段分两档，不是「全丢」。**
   `variableBindingScales` / `variableAssignmentScales` **必须保留**——它们没有加载期重算入口，且直接参与绑定解算（`scale ?? 1`）。丢掉 → 绑定的数就变了。
   只有 `derivedLayout` / `derivedTextGlyphs` / `textPicture` 是「可丢」那一档（3 节点 + 4 文档 = 7 个）。
   依据：`docs/engine-semantics.md` §6.3。
   ⚠️ `docs/sdk-notes.md` §4.3 坑 2 把这两个也归进「可丢」——**那一条已过时**，以 engine-semantics §6.3 为准。

2. **`textPicture` 是缓存不是资产。** 剔除即可，**不进 base64、不进 `assets/`**。Phase 0 把它归成「直接二进制」是误判。

3. **实例的拷贝树要写进文件。**
   主组件树 + 实例拷贝树**一起存**；拷贝子节点的 `component.main` 指向主组件里的源节点（源节点类型任意）。
   若只存主组件、加载时重新物化拷贝，则嵌套实例的关联（存在 `sourceComponentId` override 里）要额外处理，且 override 键要换语义。
   依据：`docs/engine-semantics.md` §2.4 的 P2。

4. **几何一律照存，不靠重算。**
   `box.x/y/width/height` 全部写出。布局计算在 core 的 Yoga 里，重算**不保证逐位相同**；且 od-format 只依赖 scene-graph、**不跑布局趟** → 省略几何会让「加载即可用」失效。
   依据：`docs/engine-semantics.md` §11.2。

5. **`meta.ordinal` 不能省。**
   odId 判别器取自这个**持久化的单调计数器**，删节点不回退 → 判别器跨会话不复用。用「第 N 个同名节点」会回退，旧引用会指向新对象。
   `fromEngine` 独立调用（不传 registry）时也必须用「文中已有 odId 的最大判别器」初始化计数器，否则写回 0 把计数器归零。

## 3. 同级产物在哪

| 文件 | 是什么 |
| --- | --- |
| `docs/engine-semantics.md` | 引擎语义层实测（220 条 file:line 引用）。**冲突时它优先** |
| `docs/od-format-impl-guide.md` | 规格的机械抽取版（实现者用）。由 `scripts/build-impl-guide.py` 生成，**别手改** |
| `docs/sdk-notes.md` | Phase 0 实测（154 字段表、4 个坑、wasm 坑） |
| `docs/od-format-spec.md` | od-format 规格（本文的权威契约） |
| `docs/research.md` | 竞品调研（**只读**；§7 是洁净室红线） |
| `scripts/gen-engine-semantics.py` | 机器生成 engine-semantics 的字段表，支持 `--check` |

## 4. 本仓库的硬约束

- **洁净室**：不得复用 pen.dev 的代码/品牌/资源；od 格式的命名与结构**独立设计**。可借鉴设计思路（id+type 判别、子集化布局、变量绑定），**不得引用其字段名或结构**。不用 `.pen` 扩展名。
- **`packages/` 归实现任务**：规格/调研任务不要改 `packages/` 下的文件。
- **依赖已装好**：不要跑 `npm install`。`@open-pencil/core@0.16.0` 已在根 `node_modules`（Yoga 是 grid 分支 `@open-pencil/yoga-layout@3.3.0-grid.3`）。
- **上游打包 bug**：`@open-pencil/core` 的 worker 引用漏了 `.js` 后缀，`shell/vite.config.ts` 里有 alias 修，别改回去。
- **canvaskit-wasm 必须单一版本**：`shell/package.json` 的 `overrides` 别删。
- **别手抄字段表**：从 `.d.ts` 脚本生成，事实性断言要能被机器复核。

## 5. 提交与交付

沙箱里**没有 GitHub 凭证**，远程 push 要用户在自己机器上做；本机交付方式是 `git bundle`（命令细节见 `HANDOFF.md`）。

---

## 5. 实现状态（2026-11-10 更新）

**Phase 1 已经做完了** —— `packages/od-format`（序列化层）+ `packages/od-cli`（命令行）
已实现并通过验收：**305 个测试全绿**，`tsc` 零错误。

| 想知道什么 | 去哪看 |
| --- | --- |
| 公开 API 契约 | `docs/od-format-spec.md` §9.2（**权威**） |
| 实现落在哪 | `packages/od-format/src/`（`ids` / `paths` / `schema` / `encode` / `decode` / `migrate` / `text` / `geometry` / `inspect`） |
| 字段映射的单一事实源 | `packages/od-format/src/field-map.ts`（**自动生成**，改它要改 `scripts/gen-od-field-map.py`） |
| 验收结论 | `docs/p0-acceptance.md` |
| 怎么跑 | `npx vitest run` / `npm run od -- --help` |

### 5.1 改代码前必读的三条规格不自洽

实现过程中发现规格本身有 3 处矛盾（**不是实现的问题**）。改这块代码前先知道，
免得「按规格修」反而改错：

| # | 规格的问题 | 事实 | 现有实现怎么做的 |
| --- | --- | --- | --- |
| 1 | §3.4 说 `bindings.scales` 的值是变量 id | 值是 **number**（缩放乘数），键才是字段路径 | 按事实：值原样保留，键做路径翻译。**按规格改会让绑定静默算错** |
| 2 | §2.5 的铸造算法与 §2.9 的「删除后重建不复用」互相矛盾 | 单计数器 `meta.ordinal` 表达不了「某个 base 曾被用过」 | 取更安全的一侧：base 一旦用过就不再复用（`IdRegistry.usedBases`）。跨会话仍有残留缺口 |
| 3 | §2.9 的「实例 detach → 铸造 odId」在 §2.11 的 `IdRegistry` 契约里没有入口 | 契约表缺这条 | 用 `resolve(engineId, { kind, name })` 覆盖 |

**要改规格的话，在这三处立修正记录**（不许静默改）。

### 5.2 改代码的硬约束（还是那几条）

- `packages/od-format` 的运行时依赖**只有** `@open-pencil/scene-graph` + `zod`
- `@open-pencil/core` 只在根 devDependencies（测试用），**别写进包的 dependencies**
- **绝不能 `JSON.stringify(graph)`** —— TS 的 `private` 是编译期的事，
  会把 emitter/absPosCache 写进文本，并把所有 Map 变成 `{}`
- `instanceOverrides` 必须走引擎的三态编解码
- 字段清单**不许手抄** —— `scripts/gen-od-field-map.py --check` 会拦
- 改完跑：`npx tsc -p tsconfig.json --noEmit && npx vitest run`
