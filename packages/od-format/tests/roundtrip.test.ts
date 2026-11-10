import { describe, expect, it } from 'vitest'
import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import { fromEngine, toEngine, stringifyOd, parseOd, validate } from '../src/index.js'

/** 造一个最小的文档：根 → 页面 → frame → text。 */
function buildGraph(): SceneGraph {
  // id 生成器必须单调 —— 引擎会对重复 id 直接抛错
  let counter = 0
  const g = new SceneGraph(() => `auto-${++counter}`)
  g.nodes.clear()
  const root = g.createNodeWithId('frame~document', 'FRAME', null, {
    name: 'Document',
    width: 800,
    height: 600,
  })
  g.rootId = root.id
  const page = g.createNodeWithId('canvas~page-1', 'CANVAS', root.id, { name: 'Page 1' })
  g.createNodeWithId('frame~hero', 'FRAME', page.id, {
    name: 'Hero',
    x: 10,
    y: 20,
    width: 375,
    height: 200,
    opacity: 0.5,
  })
  g.createNodeWithId('text~hero-title', 'TEXT', 'frame~hero', {
    name: '标题',
    x: 24,
    y: 40,
    width: 327,
    height: 48,
    text: '你好，世界',
    fontSize: 32,
    fontWeight: 700,
  })
  return g
}

describe('往返冒烟', () => {
  it('引擎 → od → 引擎，节点与关键字段不变', () => {
    const graph = buildGraph()
    const doc = fromEngine(graph)

    expect(doc.format).toBe('od')
    expect(doc.version).toBe('0.1')
    expect(doc.meta.root).toBe('frame~document')
    expect(doc.nodes).toHaveLength(4)

    const { graph: back } = toEngine(doc)
    expect([...back.nodes.keys()].sort()).toEqual([...graph.nodes.keys()].sort())

    const title = back.nodes.get('text~hero-title') as SceneNode
    expect(title.text).toBe('你好，世界')
    expect(title.fontSize).toBe(32)
    expect(title.fontWeight).toBe(700)
    expect(title.x).toBe(24)
    expect(title.y).toBe(40)

    const hero = back.nodes.get('frame~hero') as SceneNode
    expect(hero.opacity).toBe(0.5)
    expect(hero.width).toBe(375)
  })

  it('父子关系往返后不变', () => {
    const graph = buildGraph()
    const { graph: back } = toEngine(fromEngine(graph))

    const hero = back.nodes.get('frame~hero') as SceneNode
    expect(hero.parentId).toBe('canvas~page-1')
    expect(hero.childIds).toEqual(['text~hero-title'])

    const page = back.nodes.get('canvas~page-1') as SceneNode
    expect(page.childIds).toEqual(['frame~hero'])
    expect(back.rootId).toBe('frame~document')
  })

  it('odId 恒等：加载后 node.id === odId', () => {
    const graph = buildGraph()
    const doc = fromEngine(graph)
    const { graph: back } = toEngine(doc)
    for (const node of doc.nodes) {
      expect(back.nodes.has(node.id)).toBe(true)
      expect(back.nodes.get(node.id)!.id).toBe(node.id)
    }
  })

  it('两次序列化逐字节相同（幂等 + 确定性）', () => {
    const graph = buildGraph()
    const doc = fromEngine(graph)
    const once = stringifyOd(doc)
    const twice = stringifyOd(doc)
    expect(twice).toBe(once)

    // 引擎 → od → 引擎 → od，结果也必须相同
    const { graph: back } = toEngine(doc)
    expect(stringifyOd(fromEngine(back))).toBe(once)
  })

  it('写出的文本能被 parseOd 读回来', () => {
    const graph = buildGraph()
    const doc = fromEngine(graph)
    const parsed = parseOd(stringifyOd(doc))
    expect(parsed.nodes).toHaveLength(doc.nodes.length)
    expect(parsed.meta.root).toBe(doc.meta.root)
  })

  it('校验通过（无 error）', () => {
    const doc = fromEngine(buildGraph())
    const result = validate(doc)
    if (!result.ok) {
      console.error(result.errors)
    }
    expect(result.errors).toEqual([])
  })

  it('默认值被省略（E1）', () => {
    const doc = fromEngine(buildGraph())
    const hero = doc.nodes.find((n) => n.id === 'frame~hero')!
    // opacity 0.5 不是默认值 → 保留
    expect((hero.appearance as Record<string, unknown>).opacity).toBe(0.5)
    // visible/locked 等默认值 → 省略
    expect((hero.appearance as Record<string, unknown>).visible).toBeUndefined()
  })

  it('几何一律照存（规则 G）', () => {
    const doc = fromEngine(buildGraph())
    const hero = doc.nodes.find((n) => n.id === 'frame~hero')!
    expect(hero.box).toEqual({ x: 10, y: 20, width: 375, height: 200 })
  })
})
