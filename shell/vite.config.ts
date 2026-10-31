import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * @open-pencil/core 的 getCanvasKit() 在浏览器里按 `${BASE_URL}/${file}` 找 wasm，
 * 也就是 canvaskit.wasm 必须位于站点根目录。Vite 默认不会把 node_modules 里的
 * wasm 复制到根，所以这里补一个插件：dev 用中间件直接吐，build 把它写进产物根。
 */
function canvaskitWasm(): Plugin {
  const wasmPath = resolve(here, 'node_modules/canvaskit-wasm/bin/canvaskit.wasm')
  return {
    name: 'canvaskit-wasm-at-root',
    configureServer(server) {
      server.middlewares.use('/canvaskit.wasm', (_req, res) => {
        if (!existsSync(wasmPath)) {
          res.statusCode = 404
          res.end('canvaskit.wasm not installed')
          return
        }
        res.setHeader('Content-Type', 'application/wasm')
        createReadStream(wasmPath).pipe(res)
      })
    },
    generateBundle() {
      if (!existsSync(wasmPath)) return
      this.emitFile({
        type: 'asset',
        fileName: 'canvaskit.wasm',
        source: readFileSync(wasmPath)
      })
    }
  }
}

export default defineConfig({
  plugins: [vue(), canvaskitWasm()],
  resolve: {
    alias: [
      /**
       * 上游 @open-pencil/core@0.16.0 的打包 bug：
       * dist 里有 .js 文件，但引用时漏改了扩展名，于是 `new Worker(new URL(...))`
       * 指向一个不存在的 .ts，构建直接失败。core 的 dist 全量扫过，只有两处：
       *   dist/io/formats/fig/export.js      → "./export-worker.ts"
       *   dist/kiwi/fig/session/client.js    → "./worker.ts"
       *
       * alias 走 Vite 的 pre 阶段，能拦住 vite:worker-import-meta-url。
       * replacement 用相对路径：worker 插件会把它按 importer 目录再拼一次。
       *
       * 规则只认 worker 文件名，别写成 /\.ts$/ —— 那会连 SFC 的 lang.ts 一起改掉。
       */
      {
        find: /(export-worker|worker)\.ts$/,
        replacement: '$1.js'
      }
    ]
  },
  // 依赖里有 top-level await，Vite 默认的 esbuild target（es2020）不认，
  // dev server 会直接报错挂掉。统一提到 es2022。
  esbuild: {
    target: 'es2022'
  },
  optimizeDeps: {
    // ⚠️ 不要把 canvaskit-wasm 放进 optimizeDeps.exclude。
    // 它是 CJS（module.exports = CanvasKitInit），被排除后 Vite 会原样当 ESM 送出去，
    // dev server 直接报 "does not provide an export named 'default'"，页面全白。
    // 排除它只对 build 成立，dev 必须让 Vite 正常预打包（esbuild 会补好 default 导出）。
    esbuildOptions: {
      target: 'es2022'
    }
  },
  build: {
    target: 'es2022'
  }
})
