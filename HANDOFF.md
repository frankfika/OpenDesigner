# 移交说明（MiniMax 云电脑）

## 仓库

`https://github.com/frankfika/OpenDesigner.git`（main 分支）

---

## 本机怎么把 bundle 推上去（实测可用，别自己改写命令）

沙箱里没有 GitHub 凭证，所以改动是以 **git bundle** 的形式交付的。本机按下面这条走：

```bash
git clone https://github.com/frankfika/OpenDesigner.git
cd OpenDesigner
git pull /绝对路径/OpenDesigner-phase0.bundle main
git push origin main
```

推完远端 `main` 会从 `8dafba4` 走到 `200c68b`（快进 13 个 commit，不覆盖任何东西）。

> ⚠️ **别写成 `git fetch <bundle> main`**——那只更新 `FETCH_HEAD`，本地 `main` 没动，
> 后面 `git push origin main` 会推 0 个 commit，git 还会回 "Everything up-to-date" 看着像成功。
> 也别写 `git fetch <bundle> main:refs/heads/main`，那个直接报
> `refusing to fetch into branch 'refs/heads/main' checked out at ...`。
> 三种写法的实测对比见 `docs/sdk-notes.md` §7.1.1。

---

## 现在的状态：Phase 0 的分析本机已经做完了

**请先理解这一点再干活**——否则你会重复做已经做完的事，或者误以为仓库是空的：

| 文件 | 状态 | 说明 |
|---|---|---|
| `PLAN.md` | ✅ 定稿 | v3 产品定位与阶段计划 |
| `docs/competitive-review.md` | ✅ 定稿 | 竞品核查，划定边界 |
| `docs/EXECUTION_SPEC.md` | ⚠️ **已作废** | v2 自研画布方案留档，**整份都不要读、不要施工**（见下方警告） |
| `docs/sdk-notes.md` | ✅ **本机实测结论** | 154 个节点字段清单（机器生成）+ 文本序列化可行性结论 + 最小壳踩过的 7 个坑 |
| `shell/` | ✅ **可直接运行，已本机验证** | Vite + Vue3 + TS 最小壳；typecheck / build / render-check / serialize-probe / 浏览器渲染 五项全绿 |
| `scripts/gen-field-list.py` | ✅ 工具 | 从 `.d.ts` 机器生成字段清单 |

### Phase 1（od-format 序列化层）也做完了 —— **2026-11-10**

| 文件 | 状态 | 说明 |
|---|---|---|
| `packages/od-format/` | ✅ **已实现，305 测试全绿** | 引擎文档 ⇄ od 文本双向序列化，**154 字段全覆盖**；语义 ID 层（odId ↔ engineId 恒等映射） |
| `packages/od-cli/` | ✅ **已实现** | `od convert` / `inspect` / `validate` / `migrate` / `schema`，退出码契约逐条验证 |
| `docs/od-format-spec.md` | ✅ 定稿 | od-format 格式规格（2816 行） |
| `docs/od-format-impl-guide.md` | ✅ 工具 | 从规格机械抽取的施工手册（**别整份读**，用 `<!-- ===== -->` 标记定点读） |
| `docs/p0-acceptance.md` | ✅ **验收报告** | 四类场景 × 往返是否无损 × 证据 × 损失的细节 |
| `docs/engine-semantics.md` | ✅ 调研 | 引擎语义层实测（220 条 `file:line` 引用） |
| `scripts/gen-od-field-map.py` | ✅ 工具 | 从 `.d.ts` 机器生成字段映射表（**手抄的清单不许通过验证**） |

**三类命门的实测结论（research.md §5.1）**：组件 / 自动布局 / 变量 —— **三者 round-trip 全部无损**。
细节见 `docs/p0-acceptance.md`。

所以云电脑这趟**不是从零摸底，是核对 + 补浏览器取证 + 在新能力上做验证**。

### ⚠️ 关于 `docs/EXECUTION_SPEC.md`

这份文件整体标注了「已作废」，**整份都不要读、不要施工**。

特别提醒：它的 §0「执行总则」看起来像通用守则，但里面埋着 v2 时代的指令——§0.2 要求派 implementer/verifier 多 agent、§0.3 要求跑 `scripts/e2e.sh`（这个脚本属于作废方案，不存在）、§0.4 要求用 `mmx image generate`（**mmx 在本机，不在云电脑上**）。照做会白白绕路甚至卡死。

---

## 移交三步

1. 云电脑里 `git clone https://github.com/frankfika/OpenDesigner.git && cd OpenDesigner`
2. 把下面「启动 prompt」整段粘给云电脑的 agent
3. 验收只看 `docs/sdk-notes.md`（核对结果）和 git 提交记录，不用看聊天

---

## 启动 prompt（复制即用）

````
你是 OpenDesigner 的执行 AI。仓库已 clone 在当前目录，只允许改这个目录内的文件。

【必读，按顺序，读完后用三句话向我复述产品定位】
1. PLAN.md —— 产品战略、范围、风险、阶段计划（注意：Phase 0 / Phase 1 已完成，现在轮到 Phase 2）
2. docs/competitive-review.md —— OpenPencil 已有什么，不许重造
3. docs/sdk-notes.md —— **既有实测结论**：154 个节点字段清单 + 文本序列化可行性 + §9 是 Phase 1 的兑现情况
4. docs/p0-acceptance.md —— Phase 1 的验收报告（四类场景的往返保真度结论）
   ⚠️ docs/EXECUTION_SPEC.md 是作废方案，整份都不要读、不要施工

【重要：Phase 0 的分析、Phase 1 的 od-format 实现，本机都已经做完了】
- 字段清单和序列化结论在 docs/sdk-notes.md 里，是实测的，不要重做
- packages/od-format（序列化层）+ packages/od-cli（od 命令行）**已经实现并验收**（305 测试全绿）
- shell/ 是可直接运行的最小壳骨架
- 你的活是【核对 + 浏览器取证 + 在新能力上做验证 + Phase 2 的机械化准备】，不是从零实现

【环境自检】
- node -v 必须 ≥ 20，否则先装 Node 20 再继续
- git 配置好 user.name / user.email
- 根目录 npm install（依赖已锁：zod 4.6.7 / vitest 5.1.0 / typescript 5.9.3；
  @open-pencil/core 0.16.0 只在根 devDependencies，别装进 packages/）

【任务 A · 核对 od-format 层（先做这个，它决定后面能不能信自己的机器）】
在仓库根目录逐条跑，每条把**真实命令和真实输出**贴出来：
1. npx tsc -p tsconfig.json --noEmit      —— 期望无错误
2. npx vitest run                          —— 期望 15 个文件 / 305 个测试全绿
3. npm run od -- --help                    —— 期望打印五个子命令
4. python3 scripts/gen-od-field-map.py --check
   —— 期望 "engine fields: 154  mapped: 154" + "OK: ... 与生成器输出一致"
5. npm run od -- validate <某个 od 文件>    —— 期望 "✓ ... 校验通过"
   仓库里没有现成的 od 文件，你可以自己造一个：
     node --import tsx -e "
       import {fromEngine,stringifyOd} from './packages/od-format/src/index.ts'
       import {SceneGraph} from '@open-pencil/scene-graph'
       let i=0; const g=new SceneGraph(()=>'a'+(++i)); g.nodes.clear()
       const r=g.createNodeWithId('frame~document','FRAME',null,{name:'Document'}); g.rootId=r.id
       console.log(stringifyOd(fromEngine(g)))" > /tmp/t.od.json
   然后 npm run od -- inspect /tmp/t.od.json 看结构摘要
6. 往返一致性自测（最关键的一条）：
     node --import tsx -e "
       import {fromEngine,toEngine,stringifyOd} from './packages/od-format/src/index.ts'
       import {SceneGraph} from '@open-pencil/scene-graph'
       let i=0; const g=new SceneGraph(()=>'a'+(++i)); g.nodes.clear()
       const r=g.createNodeWithId('frame~document','FRAME',null,{name:'Document'}); g.rootId=r.id
       const a=stringifyOd(fromEngine(g))
       const b=stringifyOd(fromEngine(toEngine(fromEngine(g)).graph))
       console.log(a===b ? 'ROUNDTRIP OK' : 'ROUNDTRIP MISMATCH')"
   —— 期望 ROUNDTRIP OK
任何一条不符就报 ❌ 并贴完整输出，**不许改测试让它变绿**。

【任务 B · Phase 0 的浏览器取证（补上一直缺的那块）】
照 docs/sdk-notes.md §8 的待核对项逐条执行，每条把真实命令和真实输出追加到 docs/sdk-notes.md：
1. 核对版本：npm ls @open-pencil/core @open-pencil/scene-graph @open-pencil/vue canvaskit-wasm vue
   —— 期望 0.16.0 / 0.16.0 / 0.16.0 / 0.42.0 / 3.5.44；不一致就报 ❌ 并说明
   —— 另外跑 `npm ls canvaskit-wasm`，期望**只有 0.42.0 一个版本**
2. cd shell && npm install
3. cd shell && npm run typecheck     贴完整输出
4. cd shell && npm run build         贴完整输出（wasm 要落到产物根 dist/canvaskit.wasm）
5. cd shell && npm run render-check  必须出 PNG 且非空，报告字节数
6. cd shell && npm run serialize-probe  必须往返无字段丢失，贴输出
7. 浏览器取证：cd shell && npm run dev -- --port 5300，
   然后 node scripts/browser-check.mjs http://localhost:5300/ out/browser-shot.png
   - 实测无头 Chromium（SwiftShader）的 WebGL2 可用
   - 脚本会打印 canvasCount / webgl2 / surfaceError 三项，全对就是 BROWSER CHECK: PASS
   - 没装 Playwright 就跳过本项，用第 5 项顶上
   - 如果是**白页** + console 报 "does not provide an export named 'default'"，
     那是 vite.config.ts 里 optimizeDeps.exclude 的问题，**不是** GPU 问题（本仓库已修好，别改回去）
   - 不许伪造截图、不许用别的东西冒充画布
8. 核对字段数：python3 scripts/gen-field-list.py \
     shell/node_modules/@open-pencil/scene-graph/dist /tmp/field-list.md
   —— 期望 154 个节点字段；不一致就报 ❌ 并 diff 差异

【任务 C · Phase 2 的机械化准备：社媒尺寸模板表】
Phase 2 要做「社媒模板库 v1（6-8 个尺寸模板）+ 一键多尺寸派生」。
od-format 已经能用了，所以模板可以直接用**脚本生成 .od.json**，这是机械活，适合你做。

1. 先定尺寸表（每个一行：用途 / 宽 / 高 / 建议文件名），落成
   `docs/templates/sizes.md`。至少覆盖：
   公众号封面（900×383）、公众号长图（900×1200）、小红书竖版（1242×1660）、
   小红书方版（1080×1080）、微博横版（1200×675）、知乎封面（1200×675）、
   抖音竖版（1080×1920）、B 站封面（1920×1080）
   —— 尺寸不对就按各平台的公开规范改，并在文件里注明依据
2. 写一个**可复跑的生成脚本** `scripts/gen-templates.ts`：
   用 `@open-pencil/scene-graph` 造每个尺寸的空白画布（一个 FRAME 根 + 一个 CANVAS 页），
   经 `packages/od-format` 的 `fromEngine` + `stringifyOd` 写成
   `templates/<用途>.od.json`。
   **必须走 od-format 的公开 API**，不要手拼 JSON。
3. 生成后逐个跑 `npm run od -- validate templates/<用途>.od.json`，全部要过。
4. 脚本要幂等：跑两次产出的文件逐字节相同（`git diff` 为空）。
5. 把命令和输出贴出来。

【禁止事项】
- 禁止自己写新的规划或执行手册
- 禁止修改 PLAN.md / docs/research.md / docs/competitive-review.md
- 禁止静默改写 docs/sdk-notes.md / docs/od-format-spec.md 里已核实的结论
  （可以补充、可以标 ❌ 并附证据；**改结论必须在 §0.0 修正记录里立条目**）
- 禁止改 packages/od-format/src/ 下的实现（那是已验收的资产）——
  发现实现有问题就**报告**，不要自己去修
- 禁止装 deps 里没列的依赖；禁止跑 `npm audit fix --force`（会把引擎降级到 0.13.2，毁掉前提）
- 禁止把 MiniMax API key 写进仓库（mmx 在本机，不在云电脑上）

【关于 push】
默认你没有 frankfika 仓库的推送权限。
- 如果你被授予了 fine-grained PAT（只授权这一个仓库、带过期时间）：直接 push 到 main
- 如果没有：本地 commit 即可，然后运行
    git format-patch -1 HEAD -o /tmp/patch
  把补丁文件路径报告给我，不要尝试 push

完成后输出：任务 A/B/C 的 PASS/FAIL 清单 + 真实输出。
````

---

## 云电脑注意事项

- **mmx CLI 不在云上**：mmx 是本机的。素材生成类任务（生图/语音/视频）别派给云电脑；MiniMax API key 也不要写进仓库
- **push 权限**：云电脑默认推不了 frankfika 的仓库。要它推，给它一个只授权这一个 repo 的 fine-grained PAT（设过期时间），或让它产出 patch 由你本机推
- **没有 GPU 不是问题**：实测无头 Chromium（SwiftShader）的 WebGL2 可用，浏览器渲染能取证。
  真出问题多半是 `vite.config.ts` 被改坏了（见 docs/sdk-notes.md §5 坑 E），不是环境
- **别跑 `npm audit fix --force`**：`npm install` 会报 7 条公告（3 moderate / 4 high），
  `--force` 建议把 `@open-pencil/core` 降级到 0.13.2（跨 major），会直接毁掉 Phase 0 的前提。
  已修的那条（vite 6.3.5）本机已升到 6.4.5；剩下的都是上游传递依赖，
  处置理由见 docs/sdk-notes.md §7.1.2。**看到 audit 报警不要慌，也不要动依赖版本。**
- **它干不完的别硬塞**：Phase 0 核对是机械活，适合云电脑；**写 v3 执行手册（EXECUTION_SPEC v3）是判断型工作，拿回本机做**

---

## 成果怎么带回来

两条路，二选一：

**A. 给了 PAT（推荐）** —— 云电脑直接 push 到 main。你回来直接看 `git log` 就行。

**B. 没给 PAT** —— 云电脑在本地 commit，并跑：

```bash
git format-patch -1 HEAD -o /tmp/patch
```

把 `/tmp/patch` 里的 `.patch` 文件拿回本机，在仓库根目录执行：

```bash
git am /tmp/patch/*.patch
git push origin main
```

---

## 拿回来之后

云电脑产出的 `docs/sdk-notes.md` 核对结果，是写 **EXECUTION_SPEC v3**（移交级施工手册）的输入。

那份手册要覆盖四块内容，格式和 Phase 0 这份保持一致：

1. **od-format 规格** —— schema（zod）、`.od.json` 结构、语义 ID 层的具体设计（`docs/sdk-notes.md` §4.3 坑 1）
2. **`od convert` CLI 规格** —— `.od.json ⇄ .fig` 双向，注明借上游 `@open-pencil/cli` 的 import/convert 能力
3. **Shell 施工规格** —— 中文 UI、模板面板、属性栏裁剪的组件划分与验收命令
4. **mmx 面板规格** —— 生图/语音/视频入画布的调用链、凭据 0600 处理、素材落盘路径

写之前先确认两件事：**Phase 0 的 8 条核对项全绿**，以及 **§4.3 三个坑各有明确方案**。
