/**
 * 文档模型 → JSON 的序列化探针。
 *
 * 这是 docs/sdk-notes.md 里「文本序列化可行性」结论的**可执行证据**：
 * 它按上游剪贴板格式（core/src/clipboard/openpencil.ts）的路子，把整个 SceneGraph
 * 摊成 JSON，再解析回来做字段级比对。
 *
 * 用法：npm run serialize-probe
 * 产物：shell/out/sample.od.json
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SceneGraph, serializeInstanceOverrideState } from '@open-pencil/scene-graph'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(here, '..', 'out')

/** 上游剪贴板格式就是这么处理二进制的：base64 字符串。 */
function toBase64(bytes) {
  return Buffer.from(bytes).toString('base64')
}

/** Uint8Array 的原生 JSON 形态是 {"0":1,"1":2,...}，上游靠这个无损往返。 */
function blobToJsonRecord(blob) {
  return Object.fromEntries(Array.from(blob, (byte, index) => [String(index), byte]))
}

function buildScene() {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  if (!page) throw new Error('Expected an initial page')

  const frame = graph.createNode('FRAME', page.id, {
    name: '封面',
    x: 0,
    y: 0,
    width: 900,
    height: 383,
    layoutMode: 'HORIZONTAL',
    itemSpacing: 16,
    paddingTop: 24,
    paddingRight: 24,
    paddingBottom: 24,
    paddingLeft: 24,
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }]
  })

  const title = graph.createNode('TEXT', frame.id, {
    name: '标题',
    x: 0,
    y: 0,
    width: 400,
    height: 48,
    text: 'OpenDesigner',
    fontSize: 32,
    fontWeight: 700,
    fills: [{ type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.12, a: 1 }, opacity: 1, visible: true }]
  })

  const rect = graph.createNode('RECTANGLE', frame.id, {
    name: '色块',
    x: 0,
    y: 0,
    width: 120,
    height: 120,
    cornerRadius: 16,
    fills: [{ type: 'SOLID', color: { r: 0.29, g: 0.56, b: 0.94, a: 1 }, opacity: 1, visible: true }]
  })

  // 变量 + 变量集合，走文档级 Map
  // 绑定字段路径的合法格式（scene-graph/src/variables.ts）：
  //   数值：opacity / width / height / x / y / cornerRadius / fontSize / itemSpacing …
  //   字符串：text / fontFamily
  //   布尔：visible
  //   颜色：fills/<索引>/color 或 strokes/<索引>/color
  // 注意：0.16.0 的 createCollection 只收一个 name 参数，变量集合**没有类型字段**，
  // 变量类型由 createVariable 的 type 参数决定。别多传参数。
  const collection = graph.createCollection('主题色')
  const colorVar = graph.createVariable('主色', 'COLOR', collection.id, {
    r: 0.29,
    g: 0.56,
    b: 0.94,
    a: 1
  })
  graph.bindVariable(rect.id, 'fills/0/color', colorVar.id)

  const numericCollection = graph.createCollection('尺寸')
  const numericVar = graph.createVariable('不透明度', 'FLOAT', numericCollection.id, 0.8)
  graph.bindVariable(rect.id, 'opacity', numericVar.id)

  return { graph, page, frame, title, rect, collection, colorVar, numericVar }
}

const { graph, page, frame, title, rect, collection, colorVar, numericVar } = buildScene()

// ---------- 序列化：文档层 ----------
const doc = {
  format: 'opendesigner/od.v1',
  generator: 'serialize-probe',
  rootId: graph.rootId,
  documentColorSpace: graph.documentColorSpace,
  pages: graph.getPages().map((p) => p.id),
  nodes: Object.fromEntries(
    Array.from(graph.getAllNodes()).map((node) => [
      node.id,
      {
        ...node,
        instanceOverrides: serializeInstanceOverrideState(node.instanceOverrides),
        // 二进制：base64
        textPicture: node.textPicture ? toBase64(node.textPicture) : null,
        // 几何 blob：字节记录
        fillGeometry: node.fillGeometry.map((g) => ({
          ...g,
          commandsBlob: blobToJsonRecord(g.commandsBlob)
        })),
        strokeGeometry: node.strokeGeometry.map((g) => ({
          ...g,
          commandsBlob: blobToJsonRecord(g.commandsBlob)
        }))
      }
    ])
  ),
  variables: Object.fromEntries(Array.from(graph.variables).map(([k, v]) => [k, v])),
  variableCollections: Object.fromEntries(
    Array.from(graph.variableCollections).map(([k, v]) => [k, v])
  ),
  activeMode: Object.fromEntries(Array.from(graph.activeMode).map(([k, v]) => [k, v])),
  images: Object.fromEntries(
    Array.from(graph.images).map(([hash, bytes]) => [hash, toBase64(bytes)])
  )
}

// ---------- 统计 ----------
const nodeIds = Object.keys(doc.nodes)
const fieldCounts = nodeIds.map((id) => Object.keys(doc.nodes[id]).length)
const totalFields = fieldCounts.reduce((a, b) => a + b, 0)

console.log(`[serialize-probe] 文档节点数: ${nodeIds.length}`)
console.log(`[serialize-probe] 单节点字段数: ${fieldCounts.join(', ')}`)
console.log(`[serialize-probe] 字段总计: ${totalFields}`)
console.log(`[serialize-probe] 变量: ${Object.keys(doc.variables).length} 个`)
console.log(`[serialize-probe] 变量集合: ${Object.keys(doc.variableCollections).length} 个`)

// ---------- 往返校验 ----------
const json = JSON.stringify(doc, null, 2)
const back = JSON.parse(json)

let mismatches = 0
let droppedByUndefined = 0

for (const id of nodeIds) {
  const before = doc.nodes[id]
  const after = back.nodes[id]

  // 注意：JSON.stringify 会丢掉值为 undefined 的键（比如 booleanOperation:
  // 'UNION' | ... | undefined）。所以要比的是「序列化后仍然存在的键」，
  // 而不是内存对象的原始键集合。
  const definedKeys = Object.keys(before)
    .filter((k) => before[k] !== undefined)
    .sort()
  const afterKeys = Object.keys(after).sort()

  const missing = definedKeys.filter((k) => !afterKeys.includes(k))
  const extra = afterKeys.filter((k) => !definedKeys.includes(k))

  if (missing.length || extra.length) {
    console.error(`[serialize-probe] FAIL: 节点 ${id} 字段集合不一致`)
    if (missing.length) console.error(`  丢失: ${missing.join(', ')}`)
    if (extra.length) console.error(`  多出: ${extra.join(', ')}`)
    mismatches++
  }

  droppedByUndefined += Object.keys(before).length - definedKeys.length
}

// 值的往返校验（抽样比对全部标量字段）
for (const id of nodeIds) {
  const before = doc.nodes[id]
  const after = back.nodes[id]
  for (const key of Object.keys(before)) {
    if (before[key] === undefined) continue
    if (typeof before[key] === 'object' && before[key] !== null) continue
    if (before[key] !== after[key]) {
      console.error(
        `[serialize-probe] FAIL: 节点 ${id} 字段 ${key} 往返后值变了: ` +
          `${JSON.stringify(before[key])} → ${JSON.stringify(after[key])}`
      )
      mismatches++
    }
  }
}

if (mismatches > 0) {
  console.error(`[serialize-probe] FAIL: ${mismatches} 处往返不一致`)
  process.exit(1)
}

mkdirSync(outDir, { recursive: true })
const outPath = resolve(outDir, 'sample.od.json')
writeFileSync(outPath, json)

// 注意：json.length 是 UTF-16 码元数，不是字节数。要字节数用 Buffer.byteLength。
const byteLength = Buffer.byteLength(json, 'utf8')
console.log(`[serialize-probe] JSON 体积: ${byteLength} bytes`)
console.log(
  `[serialize-probe] 因值为 undefined 被 JSON 丢弃的字段数: ${droppedByUndefined} ` +
    `（→ schema 该用 .optional()，不是 .nullable()）`
)
console.log(`[serialize-probe] PASS: ${outPath}`)
console.log(`[serialize-probe] 样本节点: ${frame.name}/${title.name}/${rect.name}`)
console.log(`[serialize-probe] 变量集合: ${collection.name}`)
console.log(`[serialize-probe] 变量: ${colorVar.name} (${colorVar.type}), ${numericVar.name} (${numericVar.type})`)
console.log(`[serialize-probe] 绑定字段: ${JSON.stringify(rect.boundVariables)}`)
