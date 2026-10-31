# 移交说明（MiniMax 云电脑）

## 仓库

`https://github.com/frankfika/OpenDesigner.git`（main 分支）

---

## 现在的状态：Phase 0 的分析本机已经做完了

**请先理解这一点再干活**——否则你会重复做已经做完的事，或者误以为仓库是空的：

| 文件 | 状态 | 说明 |
|---|---|---|
| `PLAN.md` | ✅ 定稿 | v3 产品定位与阶段计划 |
| `docs/competitive-review.md` | ✅ 定稿 | 竞品核查，划定边界 |
| `docs/EXECUTION_SPEC.md` | ⚠️ **已作废** | v2 自研画布方案留档，**整份都不要读、不要施工**（见下方警告） |
| `docs/sdk-notes.md` | ✅ **本机实测结论** | 154 个节点字段清单（机器生成）+ 文本序列化可行性结论 + 最小壳踩过的 7 个坑 |
| `shell/` | ✅ **可直接运行，已本机验证** | Vite + Vue3 + TS 最小壳；typecheck / build / render-check / serialize-probe 四项全绿 |
| `scripts/gen-field-list.py` | ✅ 工具 | 从 `.d.ts` 机器生成字段清单 |

所以云电脑这趟**不是从零摸底，是核对 + 补浏览器取证**。`docs/sdk-notes.md` §8 已经列好 8 条待核对项，照着跑就行。

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
1. PLAN.md —— 产品战略、范围、风险
2. docs/competitive-review.md —— OpenPencil 已有什么，不许重造
3. docs/sdk-notes.md —— Phase 0 的**既有实测结论**：154 个节点字段清单 + 文本序列化可行性结论
   ⚠️ docs/EXECUTION_SPEC.md 是作废方案，整份都不要读、不要施工

【重要：Phase 0 的分析和最小壳本机已经做完了】
- 字段清单和序列化结论在 docs/sdk-notes.md 里，是实测的，不要重做
- shell/ 是可直接运行的最小壳骨架，已装好依赖配置
- 你的活是【逐条核对 + 补浏览器取证】，不是从零实现

【环境自检】
- node -v 必须 ≥ 20，否则先装 Node 20 再继续
- git 配置好 user.name / user.email

【唯一任务：Phase 0 核对与浏览器取证】
照 docs/sdk-notes.md §8 的待核对项逐条执行（§8 是准，下面是执行清单），
每条把**真实命令和真实输出**追加到 docs/sdk-notes.md
（不许写「应该可以」，不许静默改写已核实的结论）：

1. 核对版本：npm ls @open-pencil/core @open-pencil/scene-graph @open-pencil/vue canvaskit-wasm vue
   —— 期望 0.16.0 / 0.16.0 / 0.16.0 / 0.42.0 / 3.5.44；不一致就报 ❌ 并说明
2. cd shell && npm install
3. cd shell && npm run typecheck     贴完整输出
4. cd shell && npm run build         贴完整输出（wasm 要落到产物根 dist/canvaskit.wasm）
5. cd shell && npm run render-check  必须出 PNG 且非空，报告字节数
6. cd shell && npm run serialize-probe  必须往返无字段丢失，贴输出
7. 浏览器取证：cd shell && npm run dev，打开页面，截图证明画出了矩形。
   - 实测无头 Chromium（SwiftShader）的 WebGL2 是可用的，正常应该能画出来
   - 如果出来是**白页** + console 报 "does not provide an export named 'default'"，
     那是 vite.config.ts 里 optimizeDeps.exclude 的问题，**不是** GPU 问题
     （本仓库已修好，别改回去；细节见 docs/sdk-notes.md §5 坑 E）
   - 兜底路径：npm run build && npm run preview，这条不过 dev 的依赖预打包
   - 还是不行就如实报告，把 console 报错贴出来，标 ❌ + 原因
   - 不许伪造截图、不许用别的东西冒充画布
   - 注意 5 号（Node 无头渲染）不依赖 GPU，它通过就说明引擎本身能画
8. 核对字段数：python3 scripts/gen-field-list.py \
     shell/node_modules/@open-pencil/scene-graph/dist /tmp/field-list.md
   —— 期望 154 个节点字段；不一致就报 ❌ 并 diff 差异
9. 核对官方文档可达（对应 sdk-notes.md §8 第 8 条）：
   for u in getting-started guides/custom-editor-shell architecture; do
     curl -sS -o /dev/null -w "%{http_code} $u\n" "https://openpencil.dev/programmable/sdk/$u"
   done
   —— 期望三个都是 200；不是 200 就报 ❌

【如果构建挂了】
大概率是 vite.config.ts 里的配置被动了或被删了：
wasm 落根 / 上游 worker .ts 后缀 / esbuild target es2022 /
**别把 canvaskit-wasm 加回 optimizeDeps.exclude**。
这几个坑的详细说明在 docs/sdk-notes.md §5，**不要删配置**，改之前先读那一节。
还是挂就把完整报错贴出来。

【验收】
- docs/sdk-notes.md 里 §8 的待核对项每条都有 ✅/❌ + 真实输出
- git 提交：每个大步骤一个 commit，message 用中文写清做了什么
- 最后输出 PASS/FAIL 清单

【禁止事项】
- 禁止自己写新的规划或执行手册
- 禁止实现 PLAN.md 里 Phase 1 及以后的功能（od-format、模板库、mmx 面板都不许动）
- 禁止修改 docs/sdk-notes.md 里已核实的结论（可以补充、可以标 ❌ 并附证据，但不许静默改写）
- 禁止装 deps 里没列的依赖；禁止改 PLAN.md / competitive-review.md

【关于 push】
默认你没有 frankfika 仓库的推送权限。
- 如果你被授予了 fine-grained PAT（只授权这一个仓库、带过期时间）：直接 push 到 main
- 如果没有：本地 commit 即可，然后运行
    git format-patch -1 HEAD -o /tmp/patch
  把补丁文件路径报告给我，不要尝试 push

完成后输出：PASS/FAIL 清单 + sdk-notes.md 摘要。
````

---

## 云电脑注意事项

- **mmx CLI 不在云上**：mmx 是本机的。素材生成类任务（生图/语音/视频）别派给云电脑；MiniMax API key 也不要写进仓库
- **push 权限**：云电脑默认推不了 frankfika 的仓库。要它推，给它一个只授权这一个 repo 的 fine-grained PAT（设过期时间），或让它产出 patch 由你本机推
- **没有 GPU 不是问题**：实测无头 Chromium（SwiftShader）的 WebGL2 可用，浏览器渲染能取证。
  真出问题多半是 `vite.config.ts` 被改坏了（见 docs/sdk-notes.md §5 坑 E），不是环境
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
