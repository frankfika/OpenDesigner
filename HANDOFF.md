# 移交流程（MiniMax 云电脑）

## 仓库

`https://github.com/frankfika/OpenDesigner.git`（main 分支）

## 移交三步

1. 云电脑里 `git clone https://github.com/frankfika/OpenDesigner.git && cd OpenDesigner`
2. 把下面「启动 prompt」整段粘给云电脑的 agent
3. 验收只看 `docs/sdk-notes.md` 和 git 提交记录，不用看聊天

## 启动 prompt（复制即用）

````
你是 OpenDesigner 的执行 AI。仓库已 clone 在当前目录，只允许改这个目录内的文件。

【必读，按顺序，读完后用三句话向我复述产品定位】
1. PLAN.md —— 产品战略、范围、风险
2. docs/competitive-review.md —— OpenPencil 已有什么，不许重造
3. docs/EXECUTION_SPEC.md 仅读 §0「执行总则」，其余是作废方案，禁止施工

【环境自检】
- node -v 必须 ≥ 20，否则先装 Node 20 再继续
- git 配置好 user.name / user.email

【唯一任务：Phase 0 SDK 摸底】
严格按步骤执行，每步的命令和真实输出追加到 docs/sdk-notes.md（不许写"应该可以"）：
1. 读 https://openpencil.dev/programmable/sdk/getting-started 与
   https://openpencil.dev/programmable/sdk/guides/custom-editor-shell
2. 在 shell/ 目录建 Vite + Vue3 + TS 项目（npm create vite@latest shell -- --template vue-ts）
3. npm i @open-pencil/core @open-pencil/scene-graph @open-pencil/vue canvaskit-wasm，
   把装上的确切版本号记录到 sdk-notes.md，package.json 里锁死（去掉 ^）
4. 按官方 getting-started 实现最小壳：打开页面、创建空文档、画一个矩形
5. 摸清并记录 scene-graph 文档模型：文档/页面/节点的完整字段清单（从
   node_modules/@open-pencil/scene-graph 的类型定义里抄，附文件路径）
6. 评估并写下：哪些字段能无损序列化为文本 JSON，哪些不能（这是 PLAN.md
   v3 的核心风险点，必须给出字段级结论）

【验收（全部 PASS 才算完成）】
- cd shell && npm run dev 能打开页面并画出矩形（贴启动日志）
- docs/sdk-notes.md 含：版本号、字段清单（附来源路径）、序列化可行性结论
- git 提交：每个大步骤一个 commit，message 用中文写清做了什么

【禁止事项】
- 禁止自己写 EXECUTION_SPEC 或新规划——Phase 0 完成后停下报告
- 禁止实现 PLAN.md 里 Phase 1 及以后的任何功能
- 禁止装上述以外的依赖；禁止 push（你没有凭据，本地 commit 即可）

完成后输出：PASS/FAIL 清单 + sdk-notes.md 摘要。
````

## 云电脑注意事项

- **mmx CLI 不在云上**：mmx 是本机的，素材生成类任务别派给云电脑；MiniMax API key 也不要写进仓库
- **push 权限**：云电脑默认推不了 frankfika 的仓库。要它推，给它一个只授权这一个 repo 的 fine-grained PAT（设过期时间），或让它产出 patch/分支由你本机推
- **它干不完的别硬塞**：Phase 0 是摸底任务，机械化程度高所以适合云电脑；写 v3 执行手册是判断型工作，拿回本机做

## 拿回来之后

云电脑产出的 docs/sdk-notes.md 是写 EXECUTION_SPEC v3（移交级施工手册）的输入。
