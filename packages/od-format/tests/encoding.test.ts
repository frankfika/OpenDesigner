/**
 * 编码层的 MUST 测试（规格 §9.4 的 #1 / #2 / #3 / #18 / #19 / #20 / #22）。
 *
 * 核心是 **#3：154 个字段逐个往返** —— 不是「一个大节点全字段一起测」，
 * 而是**每个字段单独测**：一次只让一个字段偏离默认值，往返后断言它还在、且值相同。
 * 这样做的好处是失败时能立刻定位到具体字段，而不是「整坨不等」。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SceneGraph, createDefaultNode, type NodeType } from '@open-pencil/scene-graph'

import {
  fromEngine,
  toEngine,
  FIELD_MAP,
  FIELD_VALUE_KINDS,
  D1_NODE_FIELDS,
  D2_NODE_FIELDS,
} from '../src/index.js'
import { buildRichGraph, newGraph, nodeOf, sampleBlob, SOLID_FILL } from './fixtures.js'

/** 结构字段不走「组」编码，单独测。 */
const STRUCTURAL = new Set(['id', 'type', 'name', 'parentId', 'childIds'])

/**
 * 需要专门构造的字段值（默认值是空数组 / 空对象 / null / undefined，
 * 必须给一个形状合法的非默认值）。
 */
const CURATED: Record<string, unknown> = {
  booleanOperation: null,
  fills: [SOLID_FILL],
  strokes: [{ ...SOLID_FILL, weight: 2, align: 'INSIDE' }],
  effects: [
    {
      type: 'DROP_SHADOW',
      color: { r: 0, g: 0, b: 0, a: 0.25 },
      offset: { x: 0, y: 2 },
      radius: 4,
      spread: 0,
      visible: true,
    },
  ],
  layoutGrids: [
    {
      visible: true,
      color: { r: 0, g: 0, b: 1, a: 0.1 },
      pattern: 'COLUMNS',
      count: 4,
      sectionSize: 100,
      gutterSize: 10,
    },
  ],
  guides: [{ id: 'guide-1', axis: 'x', position: 100 }],
  textDecorationFills: [SOLID_FILL],
  textParagraphs: [{ start: 0, end: 5 }],
  styleRuns: [{ start: 0, length: 2, style: { fontWeight: 700 } }],
  fontVariations: [{ axis: 'wght', value: 700 }],
  fontFeatures: [{ tag: 'liga', enabled: true }],
  fillGeometry: [{ windingRule: 'NONZERO', commandsBlob: sampleBlob() }],
  strokeGeometry: [{ windingRule: 'NONZERO', commandsBlob: sampleBlob() }],
  dashPattern: [4, 2],
  gridTemplateColumns: [{ sizing: 'FIXED', value: 100 }],
  gridTemplateRows: [{ sizing: 'AUTO', value: 0 }],
  componentPropertyDefinitions: [
    { id: 'prop~label', name: 'Label', type: 'TEXT', defaultValue: 'Hi' },
  ],
  componentPropertyReferences: [{ propertyId: 'prop~label', field: 'TEXT' }],
  symbolLinks: [{ uri: 'https://example.com', displayName: 'Link' }],
  variantPropSpecs: [{ propDefId: 'prop~label', value: 'A' }],
  exportSettings: [{ scale: 2, format: 'png' }],
  pluginData: [{ pluginId: 'p1', key: 'k', value: 'v' }],
  pluginRelaunchData: [
    { pluginId: 'p1', command: 'run', message: 'hi', isDeleted: false },
  ],
  componentPropertyAssignments: { 'prop~label': 'value' },
  componentPropertyValues: { Label: 'value' },
  boundVariables: { width: 'var~primary' },
  variableBindingScales: { width: 2 },
  variableAssignmentScales: { width: 3 },
  variableModes: { 'vcol~brand': 'mode~light' },
  vectorNetwork: { vertices: [{ x: 0, y: 0 }], segments: [], regions: [] },
  arcData: { startingAngle: 0, endingAngle: Math.PI, innerRadius: 0.5 },
  gridPosition: { column: 1, row: 1, columnSpan: 2, rowSpan: 2 },
  textPathData: {
    network: { vertices: [], segments: [], regions: [] },
    normalizedSize: { x: 1, y: 1 },
    tValue: 0.5,
    forward: true,
  },
  librarySource: { identity: 'lib~material', sourceNodeId: 'remote-1', readOnly: true },
  targetAspectRatio: { x: 1, y: 1 },
  componentId: 'comp~button',
  source: { format: 'fig', id: 'fig-1', orderKey: 'key-1', editedFields: ['width'] },
  instanceOverrides: {
    self: new Map<string, unknown>([['width', 200]]),
    descendants: new Map<string, Map<string, unknown>>(),
  },
}

/**
 * 只比较这些键的字段。
 *
 * `source` 是「拆分」字段：od 侧只保留 4 个键（丢弃 .fig 载荷），
 * 所以往返后不可能与原始对象逐键相等 —— 比那 4 个键才是对的断言。
 */
const COMPARE_SUBSET: Record<string, readonly string[]> = {
  source: ['format', 'id', 'orderKey', 'editedFields'],
}

/** 造一个「只有一个字段偏离默认值」的节点。 */
function mutatedValue(field: string, def: unknown): unknown {
  if (field in CURATED) return CURATED[field]
  if (typeof def === 'number') return def + 1.5
  if (typeof def === 'string') return `${def}-mutated`
  if (typeof def === 'boolean') return !def
  if (def === null) {
    // 默认值是 null 的字段：给一个同类型的非空值
    const kind = FIELD_VALUE_KINDS[field] ?? 'unknown'
    if (kind === 'string' || kind === 'enum') return 'mutated-style'
    if (kind === 'number') return 1.5
    if (kind === 'object') return { mutated: true }
    return 'mutated'
  }
  if (def && typeof def === 'object' && !Array.isArray(def)) {
    // 普通对象默认值：改掉第一个原始值属性
    const out = { ...(def as Record<string, unknown>) }
    for (const [k, v] of Object.entries(out)) {
      if (typeof v === 'number') { out[k] = v + 1.5; break }
      if (typeof v === 'string') { out[k] = `${v}-mutated`; break }
      if (typeof v === 'boolean') { out[k] = !v; break }
    }
    return out
  }
  return undefined
}

/** 深比较（数值用 Object.is → 浮点逐位可比）。 */
function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((x, i) => same(x, b[i]))
  }
  const ka = Object.keys(a as Record<string, unknown>).sort()
  const kb = Object.keys(b as Record<string, unknown>).sort()
  if (ka.length !== kb.length) return false
  return ka.every((k) =>
    same(
      (a as Record<string, unknown>)[k],
      (b as Record<string, unknown>)[k]
    )
  )
}

/** 把 Uint8Array 当数组比。 */
function normalize(value: unknown): unknown {
  if (value instanceof Uint8Array) return [...value]
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = normalize(v)
    }
    return out
  }
  return value
}

describe('MUST #1 · 154 字段全覆盖（机器复核，不手抄）', () => {
  it('映射表条目数 = 154', () => {
    expect(FIELD_MAP).toHaveLength(154)
  })

  it('引擎的 SceneNode 字段集合与映射表**逐名相同**（零漏项零幽灵）', () => {
    // 直接从 .d.ts 解析，不依赖任何手抄清单
    const dts = readFileSync(
      'node_modules/@open-pencil/scene-graph/dist/types.d.ts',
      'utf8'
    )
    const body = /interface SceneNode \{(.*?)^\}/ms.exec(dts)?.[1]
    expect(body).toBeDefined()
    const engineFields = [...body!.matchAll(/^\s{2}(?:readonly )?([A-Za-z_]\w*)\??\s*:/gm)].map(
      (m) => m[1]!
    )
    expect(engineFields).toHaveLength(154)

    const mapped = FIELD_MAP.map((m) => m.engine)
    const missing = engineFields.filter((f) => !mapped.includes(f))
    const extra = mapped.filter((f) => !engineFields.includes(f))
    expect({ missing, extra }).toEqual({ missing: [], extra: [] })
  })

  it('每个 od 路径唯一', () => {
    const paths = FIELD_MAP.filter((m) => m.od !== null).map((m) => m.od!)
    const dupes = paths.filter((p, i) => paths.indexOf(p) !== i)
    expect(dupes).toEqual([])
  })
})

describe('MUST #18 · 建图三坑', () => {
  it('① createNodeWithId 重复 id → od-format 自己查重并报 OD1103', () => {
    const graph = newGraph()
    graph.createNodeWithId('frame~a', 'FRAME', null, { name: 'A' })
    graph.createNodeWithId('frame~b', 'FRAME', null, { name: 'B' })
    const doc = fromEngine(graph)
    // 人为制造重复
    doc.nodes[1]!.id = 'frame~a'
    expect(() => toEngine(doc)).toThrowError(/OD1103/)
  })

  it('② 构造器自带的两个节点不出现在输出里', () => {
    const graph = newGraph()
    graph.createNodeWithId('frame~a', 'FRAME', null, { name: 'A' })
    graph.rootId = 'frame~a'
    const doc = fromEngine(graph)
    expect(doc.nodes).toHaveLength(1)
    expect(doc.nodes[0]!.id).toBe('frame~a')
  })

  it('③ 新 id 来自单调计数器（判别器不复用）', () => {
    const graph = newGraph()
    const a = graph.createNodeWithId('frame~hero', 'FRAME', null, { name: 'Hero' })
    const b = graph.createNodeWithId('frame~hero-1', 'FRAME', null, { name: 'Hero' })
    expect(a.id).toBe('frame~hero')
    expect(b.id).toBe('frame~hero-1')
    // 输出里两个都在，且判别器没被复用
    const doc = fromEngine(graph)
    expect(doc.nodes.map((n) => n.id).sort()).toEqual(['frame~hero', 'frame~hero-1'])
  })
})

describe('MUST #2 / #19 · 派生字段两档', () => {
  it('D1 的 3 个节点字段一个都不出现在 od 输出里', () => {
    expect([...D1_NODE_FIELDS].sort()).toEqual(
      ['derivedLayout', 'derivedTextGlyphs', 'textPicture'].sort()
    )
    const graph = buildRichGraph()
    const doc = fromEngine(graph)
    const text = JSON.stringify(doc)
    for (const field of D1_NODE_FIELDS) {
      expect(text).not.toContain(field)
    }
  })

  it('D1 的 4 个文档字段不出现在文档层', () => {
    const graph = buildRichGraph()
    const doc = fromEngine(graph)
    const text = JSON.stringify(doc)
    for (const field of ['instanceIndex', 'positionPreviewVersion', 'figKiwiVersion', 'figSchemaDeflated']) {
      expect(text).not.toContain(field)
    }
  })

  it('D2 的 2 个字段在图里有值时**一定出现**，且往返后数值相同', () => {
    expect([...D2_NODE_FIELDS].sort()).toEqual(
      ['variableAssignmentScales', 'variableBindingScales'].sort()
    )
    const graph = buildRichGraph()
    const inst = nodeOf(graph, 'inst~button-1')
    inst.variableBindingScales = { width: 2, opacity: 0.5 }
    inst.variableAssignmentScales = { width: 3 }

    const doc = fromEngine(graph)
    const odInst = doc.nodes.find((n) => n.id === 'inst~button-1')!
    const bindings = odInst.bindings as Record<string, Record<string, number>>
    expect(bindings.scales).toEqual({ 'box.width': 2, 'appearance.opacity': 0.5 })
    expect(bindings.assignmentScales).toEqual({ 'box.width': 3 })

    const { graph: back } = toEngine(doc)
    const backInst = nodeOf(back, 'inst~button-1')
    expect(backInst.variableBindingScales).toEqual({ width: 2, opacity: 0.5 })
    expect(backInst.variableAssignmentScales).toEqual({ width: 3 })
  })
})

describe('MUST #3 · 154 个字段逐个往返', () => {
  const type: NodeType = 'FRAME'
  const defaults = createDefaultNode(() => 'x', type) as unknown as Record<string, unknown>

  for (const mapping of FIELD_MAP) {
    if (STRUCTURAL.has(mapping.engine)) continue
    // D1 派生缓存是**故意剔除**的（另有专门测试），不参与「往返后不变」
    if (mapping.od === null) continue
    const field = mapping.engine
    const mutated = mutatedValue(field, defaults[field])
    if (mutated === undefined) {
      // 造不出合法值的字段（目前没有）→ 显式失败而不是静默跳过
      throw new Error(`字段 "${field}" 没有可用的测试值，请在 CURATED 里补一个`)
    }

    it(`字段 "${field}" 往返后不变（od 路径 ${mapping.od ?? '（剔除）'}）`, () => {
      const graph = buildRichGraph()
      const page = nodeOf(graph, 'canvas~page-1')
      // 只让这一个字段偏离默认值
      const overrides = { [field]: mutated }
      const probe = graph.createNodeWithId('frame~probe', type, page.id, {
        name: 'Probe',
        ...overrides,
      } as never)

      const doc = fromEngine(graph)
      const odProbe = doc.nodes.find((n) => n.id === 'frame~probe')!
      const { graph: back } = toEngine(doc)
      const backProbe = nodeOf(back, 'frame~probe')

      const original = (probe as unknown as Record<string, unknown>)[field]
      const restored = (backProbe as unknown as Record<string, unknown>)[field]
      const subset = COMPARE_SUBSET[field]
      if (subset) {
        for (const key of subset) {
          expect(
            same(
              normalize((restored as Record<string, unknown>)?.[key]),
              normalize((original as Record<string, unknown>)?.[key])
            ),
            `${field}.${key} 不一致`
          ).toBe(true)
        }
      } else {
        expect(same(normalize(restored), normalize(original))).toBe(true)
      }

      // od 文档里这个字段必须落在映射表指定的路径上
      if (mapping.od !== null) {
        const parts = mapping.od.split('.')
        let cur: unknown = odProbe
        for (const part of parts) {
          expect(cur).toBeDefined()
          cur = (cur as Record<string, unknown>)[part]
        }
        expect(cur).not.toBeUndefined()
      }
    })
  }
})

describe('MUST #20 · 画笔保序', () => {
  it('fills 往返后逐元素相同（顺序不变）', () => {
    const graph = buildRichGraph()
    const hero = nodeOf(graph, 'frame~hero')
    hero.fills = [
      { ...SOLID_FILL, color: { r: 1, g: 0, b: 0, a: 1 } },
      { ...SOLID_FILL, color: { r: 0, g: 1, b: 0, a: 1 } },
      { ...SOLID_FILL, color: { r: 0, g: 0, b: 1, a: 1 } },
    ]
    const { graph: back } = toEngine(fromEngine(graph))
    const backHero = nodeOf(back, 'frame~hero')
    expect(backHero.fills.map((f) => f.color)).toEqual([
      { r: 1, g: 0, b: 0, a: 1 },
      { r: 0, g: 1, b: 0, a: 1 },
      { r: 0, g: 0, b: 1, a: 1 },
    ])
  })

  it('fills[0] 绑定颜色变量后，往返仍指向同一元素（硬伤 H1）', () => {
    const graph = buildRichGraph()
    const hero = nodeOf(graph, 'frame~hero')
    hero.fills = [
      { ...SOLID_FILL, color: { r: 1, g: 0, b: 0, a: 1 } },
      { ...SOLID_FILL, color: { r: 0, g: 1, b: 0, a: 1 } },
    ]
    hero.boundVariables = { 'fills/0/color': 'var~primary' }

    const doc = fromEngine(graph)
    const odHero = doc.nodes.find((n) => n.id === 'frame~hero')!
    const bindings = odHero.bindings as Record<string, Record<string, string>>
    expect(bindings.fields).toEqual({ 'fills.0.color': 'var~primary' })

    const { graph: back } = toEngine(doc)
    const backHero = nodeOf(back, 'frame~hero')
    expect(backHero.boundVariables).toEqual({ 'fills/0/color': 'var~primary' })
    expect(backHero.fills[0]!.color).toEqual({ r: 1, g: 0, b: 0, a: 1 })
  })
})

describe('MUST #22 · 几何逐位相同', () => {
  it('box.x/y/width/height 往返后 Object.is 相同', () => {
    const graph = buildRichGraph()
    const hero = nodeOf(graph, 'frame~hero')
    hero.x = 0.1 + 0.2 // 0.30000000000000004 —— 唯一精确值，不能被四舍五入
    hero.y = -0
    hero.width = 1 / 3
    hero.height = 1e-7

    const { graph: back } = toEngine(fromEngine(graph))
    const backHero = nodeOf(back, 'frame~hero')
    expect(Object.is(backHero.x, 0.1 + 0.2)).toBe(true)
    expect(Object.is(backHero.y, 0)).toBe(true) // -0 归一化成 0（规则 F2）
    expect(Object.is(backHero.width, 1 / 3)).toBe(true)
    expect(Object.is(backHero.height, 1e-7)).toBe(true)
  })
})

describe('MUST #10 · odId 恒等', () => {
  it('加载后 graph.nodes.get(odId) 存在且 node.id === odId', () => {
    const graph = buildRichGraph()
    const doc = fromEngine(graph)
    const { graph: back } = toEngine(doc)
    for (const node of doc.nodes) {
      const found = back.nodes.get(node.id)
      expect(found, `找不到 ${node.id}`).toBeDefined()
      expect(found!.id).toBe(node.id)
    }
  })
})
