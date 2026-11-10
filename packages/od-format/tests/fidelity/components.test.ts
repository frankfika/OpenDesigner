/**
 * 保真度验收 —— **组件 / 实例 / override**（research.md §5.1 的第一类命门）。
 *
 * 结论要靠**真实场景**说，不靠「应该可以」。
 */
import { describe, expect, it } from 'vitest'
import { setInstanceOverride, type SceneGraph } from '@open-pencil/scene-graph'

import { fromEngine, toEngine } from '../../src/index.js'
import { newGraph } from '../fixtures.js'
import { assertEquivalent, compareGraphs } from './oracle.js'

/** 造一个带组件 + 实例 + override 的图。 */
function buildComponentGraph(): { graph: SceneGraph; instanceId: string; copyChildId: string } {
  const graph = newGraph()
  const root = graph.createNodeWithId('frame~document', 'FRAME', null, { name: 'Document' })
  graph.rootId = root.id
  const page = graph.createNodeWithId('canvas~page-1', 'CANVAS', root.id, { name: 'Page 1' })

  // 主组件 + 它的子树
  const comp = graph.createNodeWithId('comp~button', 'COMPONENT', page.id, {
    name: 'Button',
    width: 120,
    height: 40,
  })
  const label = graph.createNodeWithId('text~button-label', 'TEXT', comp.id, {
    name: 'Label',
    x: 8,
    y: 8,
    width: 104,
    height: 24,
    text: 'Click me',
  })

  // 实例（引擎会自动克隆主组件的子树）
  const instance = graph.createInstance('comp~button', page.id, { name: 'Button 1' })
  if (!instance) throw new Error('createInstance 失败')
  const copyChild = instance.childIds
    .map((id) => graph.nodes.get(id))
    .find((n) => n?.type === 'TEXT')
  if (!copyChild) throw new Error('实例没有拷贝出子节点')

  // 覆盖：① 实例自身的宽；② 拷贝子节点的文字
  setInstanceOverride(instance.instanceOverrides, instance.id, instance.id, 'width', 200)
  setInstanceOverride(
    instance.instanceOverrides,
    instance.id,
    copyChild.id,
    'text',
    'Changed!'
  )

  // 拷贝子节点与源子节点的关联靠普通字段 componentId 承载
  expect(copyChild.componentId).toBe(label.id)

  return { graph, instanceId: instance.id, copyChildId: copyChild.id }
}

describe('保真度 · 组件 / 实例 / override', () => {
  it('场景能造出来（引擎支持，不是 od-format 的锅）', () => {
    const { graph, instanceId, copyChildId } = buildComponentGraph()
    const instance = graph.nodes.get(instanceId)!
    expect(instance.type).toBe('INSTANCE')
    expect(instance.componentId).toBe('comp~button')
    expect(instance.instanceOverrides.self.get('width')).toBe(200)
    expect(instance.instanceOverrides.descendants.get(copyChildId)?.get('text')).toBe('Changed!')
  })

  it('往返后组件关系、实例关系、覆盖值全部还在且指向正确', () => {
    const { graph } = buildComponentGraph()
    const doc = fromEngine(graph)

    // 引擎给的随机 id 在落盘时变成语义 odId —— 这是 od-format 的设计，不是信息丢失
    const odInstance = doc.nodes.find((n) => n.type === 'INSTANCE')!
    const odCopyChild = doc.nodes.find(
      (n) => n.type === 'TEXT' && n.id !== 'text~button-label'
    )!
    expect(odInstance.id).toMatch(/^inst~/)
    expect(odCopyChild.id).toMatch(/^text~/)

    const { graph: back } = toEngine(doc)

    // 组件关系
    const comp = back.nodes.get('comp~button')!
    expect(comp.type).toBe('COMPONENT')
    expect(comp.childIds).toContain('text~button-label')

    // 实例关系
    const instance = back.nodes.get(odInstance.id)!
    expect(instance.type).toBe('INSTANCE')
    expect(instance.componentId).toBe('comp~button')

    // 拷贝子节点还在，且与源子节点的关联（componentId）保留
    const copyChild = back.nodes.get(odCopyChild.id)!
    expect(copyChild.type).toBe('TEXT')
    expect(copyChild.componentId).toBe('text~button-label')

    // 覆盖值还在
    expect(instance.instanceOverrides.self.get('width')).toBe(200)
    expect(instance.instanceOverrides.descendants.get(odCopyChild.id)?.get('text')).toBe(
      'Changed!'
    )
  })

  it('整棵文档语义等价（通用判定器）', () => {
    const { graph } = buildComponentGraph()
    const { graph: back } = toEngine(fromEngine(graph))
    const result = compareGraphs(graph, back)
    if (!result.equal) {
      console.error(JSON.stringify(result.differences, null, 2))
    }
    assertEquivalent(graph, back)
  })

  it('od 文档里 overrides 的键是拷贝子节点自己的 odId（决策 I-2）', () => {
    const { graph } = buildComponentGraph()
    const doc = fromEngine(graph)
    const odInstance = doc.nodes.find((n) => n.type === 'INSTANCE')!
    const odCopyChild = doc.nodes.find(
      (n) => n.type === 'TEXT' && n.id !== 'text~button-label'
    )!
    const overrides = (odInstance.component as { overrides?: unknown } | undefined)?.overrides as
      | { self: Array<[string, unknown]>; descendants?: Array<[string, unknown]> }
      | undefined
    expect(overrides).toBeDefined()
    expect(overrides!.self.map(([field]) => field)).toContain('width')
    const descendantKeys = (overrides!.descendants ?? []).map(([key]) => key)
    expect(descendantKeys).toContain(odCopyChild.id)
  })

  it('MUST #5 · 实例不膨胀：往返两次，拷贝子节点数量不变', () => {
    const { graph } = buildComponentGraph()
    const doc = fromEngine(graph)
    const instanceId = doc.nodes.find((n) => n.type === 'INSTANCE')!.id
    const first = toEngine(doc).graph
    const second = toEngine(fromEngine(first)).graph

    // 原图里实例的 id 是引擎随机 id，往返后才是 odId —— 按「INSTANCE 节点」找
    const countCopies = (g: SceneGraph): number =>
      [...g.nodes.values()].find((n) => n.type === 'INSTANCE')!.childIds.length
    expect(countCopies(first)).toBe(countCopies(graph))
    expect(countCopies(second)).toBe(countCopies(graph))
    // odId 在往返之间保持稳定
    expect(first.nodes.has(instanceId)).toBe(true)
    expect(second.nodes.has(instanceId)).toBe(true)
    // 节点总数也不能变
    expect(first.nodes.size).toBe(graph.nodes.size)
    expect(second.nodes.size).toBe(graph.nodes.size)
  })

  it('override 的三态语义保留：「键存在但值为 undefined」不丢', () => {
    const { graph } = buildComponentGraph()
    const instance = graph.nodes.get(
      [...graph.nodes.values()].find((n) => n.type === 'INSTANCE')!.id
    )!
    // 显式写一个 undefined 值（引擎允许 Map 里存 undefined）
    instance.instanceOverrides.self.set('brandNewProp', undefined)

    const doc = fromEngine(graph)
    const odInstance = doc.nodes.find((n) => n.type === 'INSTANCE')!
    const overrides = (odInstance.component as { overrides?: unknown } | undefined)?.overrides as
      | { self: Array<[string, { defined: boolean; value?: unknown }]> }
      | undefined
    const entry = overrides!.self.find(([field]) => field === 'brandNewProp')
    expect(entry).toBeDefined()
    expect(entry![1].defined).toBe(false)

    const { graph: back } = toEngine(doc)
    const backInstance = back.nodes.get(odInstance.id)!
    expect(backInstance.instanceOverrides.self.has('brandNewProp')).toBe(true)
    expect(backInstance.instanceOverrides.self.get('brandNewProp')).toBeUndefined()
  })
})
