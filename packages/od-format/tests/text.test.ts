/**
 * 文本形态的测试（规格 §6，MUST #13 / #14，以及幂等 #8 / 确定性 #9）。
 */
import { describe, expect, it } from 'vitest'

import {
  fromEngine,
  parseJsonc,
  parseOd,
  stringifyOd,
  stripJsonComments,
  toEngine,
} from '../src/index.js'
import { buildRichGraph } from './fixtures.js'

describe('MUST #13 · JSONC 注释容忍', () => {
  it('剥离 // 行注释', () => {
    expect(stripJsonComments('{"a":1} // 注释').trim()).toBe('{"a":1}')
    expect(stripJsonComments('// 头部\n{"a":1}').trim()).toBe('{"a":1}')
  })

  it('剥离 /* */ 块注释', () => {
    expect(stripJsonComments('{"a":/* 内嵌 */1}').trim()).toBe('{"a":1}')
    expect(stripJsonComments('/* 头\n部 */\n{"a":1}').trim()).toBe('{"a":1}')
  })

  it('字符串里的 // 和 /* 不算注释', () => {
    const text = '{"url":"https://example.com/a//b","note":"/* not a comment */"}'
    expect(stripJsonComments(text)).toBe(text)
    const parsed = parseJsonc(text) as { url: string; note: string }
    expect(parsed.url).toBe('https://example.com/a//b')
    expect(parsed.note).toBe('/* not a comment */')
  })

  it('转义引号不破坏字符串状态', () => {
    const text = '{"q":"say \\"hi\\" // not a comment","n":1}'
    const parsed = parseJsonc(text) as { q: string; n: number }
    expect(parsed.q).toBe('say "hi" // not a comment')
    expect(parsed.n).toBe(1)
  })

  it('含注释的 od 文档能被读进来', () => {
    const doc = fromEngine(buildRichGraph())
    const text = stringifyOd(doc)
    const withComments = `// 这是设计稿\n${text.replace(
      '"nodes":',
      '/* 节点都在下面 */\n  "nodes":'
    )}`
    const parsed = parseOd(withComments)
    expect(parsed.nodes).toHaveLength(doc.nodes.length)
  })

  it('块注释里的换行被保留（不破坏行号）', () => {
    expect(stripJsonComments('/* a\nb */x')).toBe('\nx')
  })
})

describe('MUST #14 · 键序固定', () => {
  it('顶层键序符合规格 §1.1', () => {
    const text = stringifyOd(fromEngine(buildRichGraph()))
    const order = Object.keys(JSON.parse(text) as Record<string, unknown>)
    expect(order).toEqual([
      'format',
      'version',
      'meta',
      'nodes',
      'assets',
      'variables',
      'variableSets',
      'themes',
      'libraries',
    ])
  })

  it('节点键序符合规格 §1.3', () => {
    const text = stringifyOd(fromEngine(buildRichGraph()))
    const doc = JSON.parse(text) as { nodes: Array<Record<string, unknown>> }
    const node = doc.nodes.find((n) => n.id === 'frame~hero')!
    const order = Object.keys(node)
    // 结构字段在前
    expect(order.slice(0, 5)).toEqual(['id', 'type', 'name', 'parent', 'children'])
    // 出现的组键必须按规范顺序（box < appearance < fills < text < layout）
    const canonical = [
      'box',
      'limits',
      'appearance',
      'corners',
      'flip',
      'constraints',
      'styles',
      'fills',
      'strokes',
      'effects',
      'geometry',
      'shape',
      'grid',
      'guides',
      'text',
      'layout',
      'stroke',
      'borders',
      'component',
      'bindings',
      'export',
      'pluginData',
      'pluginRelaunch',
      'source',
    ]
    const groupKeys = order.filter((k) => canonical.includes(k))
    const positions = groupKeys.map((k) => canonical.indexOf(k))
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    expect(groupKeys).toContain('box')
  })

  it('同一份文档序列化两次逐字节相同', () => {
    const doc = fromEngine(buildRichGraph())
    expect(stringifyOd(doc)).toBe(stringifyOd(doc))
  })

  it('自由格式对象的键按字典序', () => {
    const doc = fromEngine(buildRichGraph())
    const text = stringifyOd(doc)
    const parsed = JSON.parse(text) as { assets: Record<string, unknown> }
    const keys = Object.keys(parsed.assets)
    expect(keys).toEqual([...keys].sort())
  })
})

describe('MUST #8 / #9 · 幂等与确定性', () => {
  it('引擎 → od → 引擎 → od 逐字节相同（幂等）', () => {
    const graph = buildRichGraph()
    const once = stringifyOd(fromEngine(graph))
    const doc = parseOd(once)
    // 用 toEngine 重建，再存一次
    const back = toEngine(doc).graph
    expect(stringifyOd(fromEngine(back))).toBe(once)
  })

  it('同样的输入产生同样的输出（确定性）', () => {
    const a = stringifyOd(fromEngine(buildRichGraph()))
    const b = stringifyOd(fromEngine(buildRichGraph()))
    expect(a).toBe(b)
  })

  it('输出以单个 LF 结尾、无 BOM、无 CRLF', () => {
    const text = stringifyOd(fromEngine(buildRichGraph()))
    expect(text.endsWith('\n')).toBe(true)
    expect(text.endsWith('\n\n')).toBe(false)
    expect(text.includes('\r')).toBe(false)
    expect(text.charCodeAt(0)).not.toBe(0xfeff)
  })

  it('空对象写成 {}，空数组写成 []', () => {
    // 用一个最小文档（没有变量 / 资源 / 库）
    const graph = buildRichGraph()
    graph.variables.clear()
    graph.variableCollections.clear()
    graph.enabledLibraries.clear()
    const text = stringifyOd(fromEngine(graph))
    expect(text).toContain('"assets": {}')
    expect(text).toContain('"variables": []')
    expect(text).toContain('"variableSets": []')
    expect(text).toContain('"libraries": []')
  })
})
