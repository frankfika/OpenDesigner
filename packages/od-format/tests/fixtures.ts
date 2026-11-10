/**
 * 测试夹具 —— 引擎文档的构造器。
 *
 * 约定：所有实体的 id 都用**odId 形态**（`frame~x` / `var~x` / `mode~x` …），
 * 这样「odId ↔ engineId 恒等映射」在测试里是显然的，断言可以直接比字符串。
 */
import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import { svgPathToBlob } from '../src/geometry.js'

/** 造一个空的图（构造器自带的两个节点已清掉）。 */
export function newGraph(): SceneGraph {
  let counter = 0
  const g = new SceneGraph(() => `auto-${++counter}`)
  g.nodes.clear()
  return g
}

export const SOLID_FILL = {
  type: 'SOLID' as const,
  color: { r: 1, g: 0, b: 0, a: 1 },
  opacity: 1,
  visible: true,
}

/**
 * 一个「什么都有」的图：根 → 页面 → 组件 → 文本，外加变量 / 集合 / 模式 / 库绑定。
 *
 * 覆盖 research.md §5.1 说的三类命门（组件 / 自动布局 / 变量）里的前两类载体。
 */
export function buildRichGraph(): SceneGraph {
  const g = newGraph()

  const root = g.createNodeWithId('frame~document', 'FRAME', null, {
    name: 'Document',
    width: 800,
    height: 600,
  })
  g.rootId = root.id

  const page = g.createNodeWithId('canvas~page-1', 'CANVAS', root.id, { name: 'Page 1' })

  // 组件（含一个子节点，主组件树）
  const comp = g.createNodeWithId('comp~button', 'COMPONENT', page.id, {
    name: 'Button',
    width: 120,
    height: 40,
  })
  g.createNodeWithId('text~button-label', 'TEXT', comp.id, {
    name: 'Label',
    x: 8,
    y: 8,
    width: 104,
    height: 24,
    text: 'Click me',
  })

  // 实例（拷贝子节点）
  const inst = g.createNodeWithId('inst~button-1', 'INSTANCE', page.id, {
    name: 'Button Instance',
    componentId: 'comp~button',
    width: 120,
    height: 40,
  })
  g.createNodeWithId('text~button-1-label', 'TEXT', inst.id, {
    name: 'Label',
    x: 8,
    y: 8,
    width: 104,
    height: 24,
    text: 'Click me',
    componentId: 'text~button-label',
  })

  // 普通 frame（几何 / 画笔测试用）
  g.createNodeWithId('frame~hero', 'FRAME', page.id, {
    name: 'Hero',
    x: 0,
    y: 0,
    width: 375,
    height: 200,
  })

  // 自动布局
  g.createNodeWithId('frame~auto', 'FRAME', page.id, {
    name: 'Auto',
    x: 0,
    y: 200,
    width: 300,
    height: 100,
    layoutMode: 'HORIZONTAL',
    itemSpacing: 8,
    paddingTop: 4,
    paddingLeft: 4,
    primaryAxisAlign: 'MIN',
  })

  // 变量 / 集合 / 模式
  g.variableCollections.set('vcol~brand', {
    id: 'vcol~brand',
    name: 'Brand',
    modes: [
      { modeId: 'mode~light', name: 'Light' },
      { modeId: 'mode~dark', name: 'Dark' },
    ],
    defaultModeId: 'mode~light',
    variableIds: ['var~primary'],
  } as never)
  g.variables.set('var~primary', {
    id: 'var~primary',
    name: 'primary',
    type: 'COLOR',
    collectionId: 'vcol~brand',
    valuesByMode: {
      'mode~light': { r: 0.058, g: 0.404, b: 0.902, a: 1 },
      'mode~dark': { r: 0.1, g: 0.1, b: 0.1, a: 1 },
    },
    description: '主色',
    hiddenFromPublishing: false,
  } as never)
  g.activeMode.set('vcol~brand', 'mode~dark')

  // 库绑定
  g.enabledLibraries.set('lib~material', {
    libraryId: 'lib~material',
    revisionId: 'rev-7',
    enabled: true,
  })

  return g
}

/** 取引擎节点。 */
export function nodeOf(graph: SceneGraph, id: string): SceneNode {
  const node = graph.nodes.get(id)
  if (!node) throw new Error(`节点不存在：${id}`)
  return node
}

/** 一个真实的几何 blob（走一遍 SVG path → float32 的转换）。 */
export function sampleBlob(): Uint8Array {
  return svgPathToBlob('M 0 0 L 10 0 L 10 10 Z')
}
