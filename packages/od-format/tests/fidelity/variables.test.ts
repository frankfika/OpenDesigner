/**
 * 保真度验收 —— **变量 + 主题模式**（research.md §5.1 的第三类命门）。
 *
 * 规格 §4.3 的结论是「可无损」，但有三条硬前提：
 *  1. `fills` / `strokes` 必须**保序**（绑定按下标指向画笔，重排会让绑定静默指向另一个画笔）
 *  2. `variableBindingScales` / `variableAssignmentScales` **必须留**（没有重算入口）
 *  3. 主题的**两层**都要存（`variableSets[].modes` 定义 + `themes.active` 当前状态）
 */
import { describe, expect, it } from 'vitest'
import type { SceneGraph } from '@open-pencil/scene-graph'

import { fromEngine, toEngine } from '../../src/index.js'
import { newGraph } from '../fixtures.js'
import { assertEquivalent, compareGraphs } from './oracle.js'

const SOLID = { type: 'SOLID' as const, color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }

/** 造一个带变量 / 集合 / 模式 / 绑定的图。 */
function buildVariableGraph(): SceneGraph {
  const graph = newGraph()
  const root = graph.createNodeWithId('frame~document', 'FRAME', null, { name: 'Document' })
  graph.rootId = root.id
  const page = graph.createNodeWithId('canvas~page-1', 'CANVAS', root.id, { name: 'Page 1' })

  // 变量集合（一条主题轴）+ 两个模式
  graph.variableCollections.set('vcol~brand', {
    id: 'vcol~brand',
    name: 'Brand',
    modes: [
      { modeId: 'mode~light', name: 'Light' },
      { modeId: 'mode~dark', name: 'Dark' },
    ],
    defaultModeId: 'mode~light',
    variableIds: ['var~primary', 'var~accent'],
  } as never)

  // 两个变量
  graph.variables.set('var~primary', {
    id: 'var~primary',
    name: 'brand/primary',
    type: 'COLOR',
    collectionId: 'vcol~brand',
    valuesByMode: {
      'mode~light': { r: 0.058, g: 0.404, b: 0.902, a: 1 },
      'mode~dark': { r: 0.9, g: 0.9, b: 0.9, a: 1 },
    },
    description: '主色',
    hiddenFromPublishing: false,
  } as never)
  graph.variables.set('var~accent', {
    id: 'var~accent',
    name: 'brand/accent',
    type: 'COLOR',
    collectionId: 'vcol~brand',
    // 别名：指向另一个变量
    valuesByMode: { 'mode~light': { aliasId: 'var~primary' } },
    description: '',
    hiddenFromPublishing: false,
  } as never)

  // 文档级主题当前状态
  graph.activeMode.set('vcol~brand', 'mode~dark')

  // 节点上的绑定：颜色绑定（下标路径）+ 数值绑定
  const box = graph.createNodeWithId('frame~box', 'FRAME', page.id, {
    name: 'Box',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    fills: [SOLID, { ...SOLID, color: { r: 0, g: 1, b: 0, a: 1 } }],
    boundVariables: {
      'fills/0/color': 'var~primary',
      opacity: 'var~primary',
    },
    variableBindingScales: { opacity: 0.5 },
    variableModes: { 'vcol~brand': 'mode~light' },
  })
  void box

  return graph
}

describe('保真度 · 变量 + 主题模式', () => {
  it('变量定义（名字 / 类型 / 集合 / 各模式的值）往返后不变', () => {
    const graph = buildVariableGraph()
    const doc = fromEngine(graph)
    const odPrimary = doc.variables.find((v) => v.id === 'var~primary')!
    expect(odPrimary.name).toBe('brand/primary')
    expect(odPrimary.type).toBe('COLOR')
    expect(odPrimary.set).toBe('vcol~brand')
    expect(odPrimary.values).toEqual({
      'mode~light': { r: 0.058, g: 0.404, b: 0.902, a: 1 },
      'mode~dark': { r: 0.9, g: 0.9, b: 0.9, a: 1 },
    })

    const { graph: back } = toEngine(doc)
    const backPrimary = back.variables.get('var~primary')!
    expect(backPrimary.name).toBe('brand/primary')
    expect(backPrimary.collectionId).toBe('vcol~brand')
    expect(backPrimary.valuesByMode['mode~light']).toEqual({
      r: 0.058,
      g: 0.404,
      b: 0.902,
      a: 1,
    })
  })

  it('变量别名往返后仍指向同一个变量', () => {
    const graph = buildVariableGraph()
    const doc = fromEngine(graph)
    const odAccent = doc.variables.find((v) => v.id === 'var~accent')!
    expect(odAccent.values).toEqual({ 'mode~light': { alias: 'var~primary' } })

    const { graph: back } = toEngine(doc)
    const backAccent = back.variables.get('var~accent')!
    expect(backAccent.valuesByMode['mode~light']).toEqual({ aliasId: 'var~primary' })
  })

  it('主题的两层都在：集合里的模式定义 + 文档当前状态', () => {
    const graph = buildVariableGraph()
    const doc = fromEngine(graph)
    const odSet = doc.variableSets.find((s) => s.id === 'vcol~brand')!
    expect(odSet.modes.map((m) => m.id)).toEqual(['mode~light', 'mode~dark'])
    expect(odSet.defaultMode).toBe('mode~light')
    expect(odSet.variables).toEqual(['var~primary', 'var~accent'])
    expect(doc.themes.active).toEqual({ 'vcol~brand': 'mode~dark' })

    const { graph: back } = toEngine(doc)
    const backSet = back.variableCollections.get('vcol~brand')!
    expect(backSet.modes.map((m) => m.modeId)).toEqual(['mode~light', 'mode~dark'])
    expect(backSet.defaultModeId).toBe('mode~light')
    expect(backSet.variableIds).toEqual(['var~primary', 'var~accent'])
    expect(back.activeMode.get('vcol~brand')).toBe('mode~dark')
  })

  it('节点级变量绑定往返后不变（路径翻译正确）', () => {
    const graph = buildVariableGraph()
    const doc = fromEngine(graph)
    const odBox = doc.nodes.find((n) => n.id === 'frame~box')!
    const bindings = odBox.bindings as Record<string, Record<string, unknown>>
    // 引擎路径 fills/0/color → od 路径 fills.0.color
    expect(bindings.fields).toEqual({
      'fills.0.color': 'var~primary',
      'appearance.opacity': 'var~primary',
    })

    const { graph: back } = toEngine(doc)
    const backBox = back.nodes.get('frame~box')!
    expect(backBox.boundVariables).toEqual({
      'fills/0/color': 'var~primary',
      opacity: 'var~primary',
    })
  })

  it('D2 · variableBindingScales 往返保留（丢了绑定会静默算错）', () => {
    const graph = buildVariableGraph()
    const doc = fromEngine(graph)
    const odBox = doc.nodes.find((n) => n.id === 'frame~box')!
    const bindings = odBox.bindings as Record<string, Record<string, number>>
    expect(bindings.scales).toEqual({ 'appearance.opacity': 0.5 })

    const { graph: back } = toEngine(doc)
    expect(back.nodes.get('frame~box')!.variableBindingScales).toEqual({ opacity: 0.5 })
  })

  it('MUST #20 · 画笔保序：绑定仍指向同一个画笔', () => {
    const graph = buildVariableGraph()
    const { graph: back } = toEngine(fromEngine(graph))
    const backBox = back.nodes.get('frame~box')!
    expect(backBox.fills).toHaveLength(2)
    expect(backBox.fills[0]!.color).toEqual({ r: 1, g: 0, b: 0, a: 1 })
    expect(backBox.fills[1]!.color).toEqual({ r: 0, g: 1, b: 0, a: 1 })
    expect(backBox.boundVariables['fills/0/color']).toBe('var~primary')
  })

  it('节点级主题覆盖（variableModes）往返后不变', () => {
    const graph = buildVariableGraph()
    const doc = fromEngine(graph)
    const odBox = doc.nodes.find((n) => n.id === 'frame~box')!
    const bindings = odBox.bindings as Record<string, Record<string, string>>
    expect(bindings.modes).toEqual({ 'vcol~brand': 'mode~light' })

    const { graph: back } = toEngine(doc)
    expect(back.nodes.get('frame~box')!.variableModes).toEqual({ 'vcol~brand': 'mode~light' })
  })

  it('整棵文档语义等价（通用判定器）', () => {
    const graph = buildVariableGraph()
    const { graph: back } = toEngine(fromEngine(graph))
    const result = compareGraphs(graph, back)
    if (!result.equal) console.error(JSON.stringify(result.differences, null, 2))
    assertEquivalent(graph, back)
  })
})
