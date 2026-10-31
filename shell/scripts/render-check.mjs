/**
 * 无浏览器渲染自检。
 *
 * 为什么需要它：画布走的是 WebGL2（CanvasSurface 里 surfaceError="webgl"），
 * 无头机器上跑浏览器壳容易因为没有 GPU 而失败。这个脚本走引擎自带的
 * headless 渲染路径（Node + CanvasKit WASM），不碰浏览器就能证明
 * 「页面 + 矩形」确实能画出来。
 *
 * 用法：npm run render-check
 * 产物：shell/out/render-check.png
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { headlessRenderNodes } from '@open-pencil/core'
import { SceneGraph } from '@open-pencil/scene-graph'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(here, '..', 'out')

function buildScene() {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  if (!page) throw new Error('Expected an initial page')

  const rect = graph.createNode('RECTANGLE', page.id, {
    name: '矩形 1',
    x: 80,
    y: 80,
    width: 240,
    height: 160,
    fills: [
      {
        type: 'SOLID',
        color: { r: 0.29, g: 0.56, b: 0.94, a: 1 },
        opacity: 1,
        visible: true
      }
    ]
  })

  return { graph, page, rect }
}

const { graph, page, rect } = buildScene()

console.log(`[render-check] graph 节点数: ${[...graph.getAllNodes()].length}`)
console.log(`[render-check] 页面: ${page.name} (${page.id})`)
console.log(`[render-check] 矩形: ${rect.name} (${rect.id}) ${rect.width}x${rect.height}`)

const png = await headlessRenderNodes(graph, page.id, [rect.id], { format: 'PNG' })

if (!png || png.byteLength === 0) {
  console.error('[render-check] FAIL: 渲染结果为空')
  process.exit(1)
}

mkdirSync(outDir, { recursive: true })
const outPath = resolve(outDir, 'render-check.png')
writeFileSync(outPath, png)

// PNG magic number 校验，避免把损坏的字节当成成功
const isPng = png[0] === 0x89 && png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47
if (!isPng) {
  console.error('[render-check] FAIL: 输出不是合法 PNG')
  process.exit(1)
}

console.log(`[render-check] PASS: ${outPath} (${png.byteLength} bytes)`)
