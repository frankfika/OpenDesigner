/**
 * 模板能不能真被引擎打开 —— schema 合法不代表能渲染。
 *
 * 走完整链路：读文件 → parseOd → toEngine → renderNodesToSVG。
 * 出不来 SVG 的模板不算能用。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { renderNodesToSVG } from '@open-pencil/core'
import { parseOd, toEngine } from '@opendesigner/od-format'

const dir = resolve('templates')
const files = readdirSync(dir).filter((f) => f.endsWith('.od.json')).sort()
let ok = 0
for (const file of files) {
  try {
    const doc = parseOd(readFileSync(resolve(dir, file), 'utf8'))
    const { graph } = toEngine(doc)
    const rootId = graph.rootId
    const svg = renderNodesToSVG(graph, rootId, [rootId], {})
    const len = svg?.length ?? 0
    if (len > 0) {
      ok += 1
      console.log(`✓ ${file.padEnd(38)} ${String(len).padStart(6)} 字符 SVG`)
    } else {
      console.log(`✗ ${file.padEnd(38)} SVG 为空`)
    }
  } catch (e) {
    console.log(`✗ ${file.padEnd(38)} ${e instanceof Error ? e.message : String(e)}`)
  }
}
console.log(`\n${ok}/${files.length} 个模板能渲染成 SVG`)
process.exit(ok === files.length ? 0 : 1)
