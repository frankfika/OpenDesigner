# OpenDesigner Shell（Phase 0 最小壳）

基于 OpenPencil 引擎的最小可运行外壳。**这是 Phase 0 的摸底工具，不是产品形态。**
产品形态的定义在 `PLAN.md`，施工规格等 Phase 0 验收后另写。

## 跑起来

```bash
npm install
npm run dev        # 浏览器壳 → http://localhost:5173
```

## 四条验证命令

| 命令 | 验什么 | 期望 |
|---|---|---|
| `npm run typecheck` | `vue-tsc` 严格类型检查 | 无输出、退出码 0 |
| `npm run build` | 生产构建 | 成功，且 `dist/canvaskit.wasm` 落在**产物根目录** |
| `npm run render-check` | Node 侧无头渲染（**不依赖 GPU**） | `shell/out/render-check.png` 非空 |
| `npm run serialize-probe` | 文档模型 → JSON 往返 | 字段零丢失，产出 `shell/out/sample.od.json` |

`render-check` 走引擎自带的 `headlessRenderNodes()`（Node + CanvasKit WASM），绕开浏览器和 WebGL2。
无头机器上判断「引擎能不能画」，**以它为准**，浏览器截图只是加分项。

## 这个壳里已经踩平的坑

不要删 `vite.config.ts` 里的这几处配置，删了构建/启动就会挂（详见 `docs/sdk-notes.md` §5）：

1. **wasm 必须在站点根** —— `getCanvasKit()` 按 `${BASE_URL}/${file}` 找 `canvaskit.wasm`，
   Vite 默认不复制 `node_modules` 里的 wasm → 自定义插件处理
2. **上游 core@0.16.0 的打包 bug** —— dist 里 `new Worker(new URL("./xxx.ts", ...))` 漏改扩展名
   → `resolve.alias` 把 worker 的 `.ts` 改回 `.js`（规则只认 worker 文件名，别写成 `/\.ts$/`）
3. **top-level await** —— Vite 默认 esbuild target 是 es2020，不认 → target 提到 es2022

## 目录

```
src/editor.ts            建 SceneGraph + Editor 的最小逻辑（页面 + 一个矩形）
src/App.vue              provideEditor + CanvasRoot/CanvasSurface
src/style.css            基础样式（手写了 size-full，没引 Tailwind）
scripts/render-check.mjs Node 侧无头渲染自检
scripts/serialize-probe.mjs  文档模型 → JSON 往返自检
vite.config.ts           三个坑的修复都在这
```
