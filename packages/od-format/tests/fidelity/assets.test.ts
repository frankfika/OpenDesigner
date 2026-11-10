/**
 * 保真度验收 —— **图片资源**（research.md §5.1 的第四类）。
 *
 * od 文件**不内联图片字节**（规格 §1.4 / §4.3 坑 3）：
 * 文件里只留 `assets/<hash>` 的引用，字节在磁盘上的资源文件里。
 * 所以「往返」分两层：
 *  1. **引用层**：`fills[].imageHash` ↔ `assets{}` 的键，往返必须一致
 *  2. **字节层**：由调用方通过 `toEngine(doc, { assets })` 注入（CLI 会从磁盘读）
 */
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import type { SceneGraph } from '@open-pencil/scene-graph'

import { fromEngine, toEngine } from '../../src/index.js'
import { newGraph } from '../fixtures.js'
import { assertEquivalent, compareGraphs } from './oracle.js'

/** 一段假的 PNG 字节（内容不重要，hash 重要）。 */
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])

function hashOf(bytes: Uint8Array): string {
  return createHash('sha1').update(bytes).digest('hex')
}

function buildAssetGraph(): { graph: SceneGraph; hash: string } {
  const graph = newGraph()
  const root = graph.createNodeWithId('frame~document', 'FRAME', null, { name: 'Document' })
  graph.rootId = root.id
  const page = graph.createNodeWithId('canvas~page-1', 'CANVAS', root.id, { name: 'Page 1' })

  const hash = hashOf(PNG_BYTES)
  graph.images.set(hash, PNG_BYTES)

  graph.createNodeWithId('rect~avatar', 'RECTANGLE', page.id, {
    name: 'Avatar',
    x: 0,
    y: 0,
    width: 64,
    height: 64,
    fills: [
      {
        type: 'IMAGE',
        color: { r: 0, g: 0, b: 0, a: 1 },
        opacity: 1,
        visible: true,
        imageHash: hash,
      },
    ],
  })

  return { graph, hash }
}

describe('保真度 · 图片资源', () => {
  it('资源不进 od 文件的字节（只留引用）—— 文件保持可读、diff 友好', () => {
    const { graph, hash } = buildAssetGraph()
    const doc = fromEngine(graph)
    const assets = doc.assets as Record<string, { file: string; mime: string; bytes: number }>
    expect(assets[hash]).toBeDefined()
    expect(assets[hash]!.file).toBe(`assets/${hash}.png`)
    expect(assets[hash]!.bytes).toBe(PNG_BYTES.byteLength)
    // od 文档里**不含**图片字节
    expect(JSON.stringify(doc)).not.toContain('PNG')
  })

  it('引用层往返一致：fills[].imageHash ↔ assets{} 的键', () => {
    const { graph, hash } = buildAssetGraph()
    const doc = fromEngine(graph)
    const odRect = doc.nodes.find((n) => n.id === 'rect~avatar')!
    const fills = odRect.fills as Array<{ imageHash?: string }>
    expect(fills[0]!.imageHash).toBe(hash)

    const { graph: back } = toEngine(doc)
    const backRect = back.nodes.get('rect~avatar')!
    expect(backRect.fills[0]!.imageHash).toBe(hash)
  })

  it('字节层：注入 assets 后图片能被完整还原', () => {
    const { graph, hash } = buildAssetGraph()
    const doc = fromEngine(graph)
    const assets = new Map([[hash, PNG_BYTES]])
    const { graph: back } = toEngine(doc, { assets })
    expect(back.images.has(hash)).toBe(true)
    expect([...back.images.get(hash)!]).toEqual([...PNG_BYTES])
  })

  it('不注入 assets 时图片为空（字节在磁盘上，由调用方负责）', () => {
    const { graph } = buildAssetGraph()
    const { graph: back } = toEngine(fromEngine(graph))
    expect(back.images.size).toBe(0)
  })

  it('整棵文档语义等价（通用判定器，注入 assets 后）', () => {
    const { graph, hash } = buildAssetGraph()
    const doc = fromEngine(graph)
    const assets = new Map([[hash, PNG_BYTES]])
    const { graph: back } = toEngine(doc, { assets })
    const result = compareGraphs(graph, back)
    if (!result.equal) console.error(JSON.stringify(result.differences, null, 2))
    assertEquivalent(graph, back)
  })
})
