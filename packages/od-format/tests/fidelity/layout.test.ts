/**
 * 保真度验收 —— **自动布局**（research.md §5.1 的第二类命门）。
 *
 * 规格 §4.2 的结论是「**意图无损，但结果不可靠**」：
 * 布局计算不在 scene-graph（在 core 的 Yoga），重算不保证逐位相同。
 * 因此 od-format 的策略是「**几何一律照存**」（规则 G）——
 * 布局**意图**（布局模式、间距、内边距、对齐）与布局**结果**（x/y/width/height）
 * 都必须原样往返。
 */
import { describe, expect, it } from 'vitest'
import type { SceneGraph } from '@open-pencil/scene-graph'

import { fromEngine, toEngine } from '../../src/index.js'
import { newGraph } from '../fixtures.js'
import { assertEquivalent, compareGraphs } from './oracle.js'

/** 造一个带自动布局的节点树。 */
function buildLayoutGraph(): SceneGraph {
  const graph = newGraph()
  const root = graph.createNodeWithId('frame~document', 'FRAME', null, { name: 'Document' })
  graph.rootId = root.id
  const page = graph.createNodeWithId('canvas~page-1', 'CANVAS', root.id, { name: 'Page 1' })

  const auto = graph.createNodeWithId('frame~auto', 'FRAME', page.id, {
    name: 'Auto',
    x: 0,
    y: 200,
    width: 300,
    height: 100,
    layoutMode: 'HORIZONTAL',
    layoutWrap: 'WRAP',
    layoutDirection: 'LTR',
    itemSpacing: 8,
    counterAxisSpacing: 12,
    paddingTop: 4,
    paddingRight: 6,
    paddingBottom: 8,
    paddingLeft: 10,
    primaryAxisAlign: 'CENTER',
    counterAxisAlign: 'CENTER',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'HUG',
    layoutGrow: 1,
    layoutAlignSelf: 'STRETCH',
    layoutPositioning: 'AUTO',
    horizontalConstraint: 'STRETCH',
    verticalConstraint: 'SCALE',
  })

  graph.createNodeWithId('frame~auto-a', 'FRAME', auto.id, {
    name: 'A',
    x: 10,
    y: 4,
    width: 50,
    height: 30,
  })
  graph.createNodeWithId('frame~auto-b', 'FRAME', auto.id, {
    name: 'B',
    x: 68,
    y: 4,
    width: 50,
    height: 30,
  })
  graph.createNodeWithId('frame~auto-c', 'FRAME', auto.id, {
    name: 'C',
    x: 126,
    y: 4,
    width: 50,
    height: 30,
  })

  return graph
}

describe('保真度 · 自动布局', () => {
  it('布局意图（模式 / 间距 / 内边距 / 对齐 / 尺寸策略）往返后不变', () => {
    const graph = buildLayoutGraph()
    const doc = fromEngine(graph)
    const odAuto = doc.nodes.find((n) => n.id === 'frame~auto')!
    const layout = odAuto.layout as Record<string, unknown>

    expect(layout.mode).toBe('HORIZONTAL')
    expect(layout.direction).toBe('LTR')
    expect(layout.wrap).toBe('WRAP')
    expect(layout.gap).toBe(8)
    expect(layout.crossGap).toBe(12)
    expect(layout.padding).toEqual({ top: 4, right: 6, bottom: 8, left: 10 })
    expect(layout.align).toEqual({ primary: 'CENTER', counter: 'CENTER' })
    expect(layout.sizing).toEqual({ primary: 'HUG', counter: 'HUG' })
    expect(layout.grow).toBe(1)
    expect(layout.alignSelf).toBe('STRETCH')

    const { graph: back } = toEngine(doc)
    const backAuto = back.nodes.get('frame~auto')!
    expect(backAuto.layoutMode).toBe('HORIZONTAL')
    expect(backAuto.itemSpacing).toBe(8)
    expect(backAuto.counterAxisSpacing).toBe(12)
    expect(backAuto.paddingTop).toBe(4)
    expect(backAuto.paddingLeft).toBe(10)
    expect(backAuto.primaryAxisAlign).toBe('CENTER')
    expect(backAuto.counterAxisAlign).toBe('CENTER')
    expect(backAuto.layoutGrow).toBe(1)
  })

  it('布局结果（几何）照存 —— 不靠重算（规则 G）', () => {
    const graph = buildLayoutGraph()
    const doc = fromEngine(graph)
    // 子节点的位置是布局算出来的，但 od 侧一律照存
    const odA = doc.nodes.find((n) => n.id === 'frame~auto-a')!
    expect(odA.box).toEqual({ x: 10, y: 4, width: 50, height: 30 })

    const { graph: back } = toEngine(doc)
    const backA = back.nodes.get('frame~auto-a')!
    expect(backA.x).toBe(10)
    expect(backA.y).toBe(4)
    expect(backA.width).toBe(50)
    expect(backA.height).toBe(30)
  })

  it('层级关系不变（布局子节点仍是同一个父节点的孩子）', () => {
    const graph = buildLayoutGraph()
    const { graph: back } = toEngine(fromEngine(graph))
    const auto = back.nodes.get('frame~auto')!
    expect(auto.childIds).toEqual(['frame~auto-a', 'frame~auto-b', 'frame~auto-c'])
    expect(back.nodes.get('frame~auto-a')!.parentId).toBe('frame~auto')
  })

  it('整棵文档语义等价（通用判定器）', () => {
    const graph = buildLayoutGraph()
    const { graph: back } = toEngine(fromEngine(graph))
    const result = compareGraphs(graph, back)
    if (!result.equal) console.error(JSON.stringify(result.differences, null, 2))
    assertEquivalent(graph, back)
  })

  it('等于引擎默认值的字段被省略（规则 E1）', () => {
    // layoutPositioning 的引擎默认值是 'AUTO' → od 侧省略
    const graph = buildLayoutGraph()
    const doc = fromEngine(graph)
    const odAuto = doc.nodes.find((n) => n.id === 'frame~auto')!
    const layout = odAuto.layout as Record<string, unknown>
    expect(layout.positioning).toBeUndefined()
    // 省略 = 默认值，往返后仍是默认值
    const { graph: back } = toEngine(doc)
    expect(back.nodes.get('frame~auto')!.layoutPositioning).toBe('AUTO')
  })

  it('约束（horizontal / vertical）往返后不变', () => {
    const graph = buildLayoutGraph()
    const doc = fromEngine(graph)
    const odAuto = doc.nodes.find((n) => n.id === 'frame~auto')!
    expect(odAuto.constraints).toEqual({ horizontal: 'STRETCH', vertical: 'SCALE' })
  })
})
