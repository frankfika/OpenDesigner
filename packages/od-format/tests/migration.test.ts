/**
 * 迁移框架的测试（规格 §5.6，MUST #16）。
 *
 * 测的是三条可测的不变式：
 * - **M1 确定性**：同一输入永远得到同一输出
 * - **M2 幂等**：`migrate(migrate(x, a, b), a, b) ≡ migrate(x, a, b)`
 * - **M3 无损**：迁移只改「迁移器声明要改的字段」
 */
import { describe, expect, it } from 'vitest'

import {
  migrate,
  migrate_0_1_to_1_0,
  migrations,
  schemas,
  isSupportedVersion,
  SUPPORTED_VERSIONS,
} from '../src/index.js'
import { buildRichGraph } from './fixtures.js'
import { fromEngine } from '../src/index.js'

function fixture() {
  const doc = fromEngine(buildRichGraph()) as unknown as Record<string, unknown>
  return doc
}

describe('MUST #16 · 迁移', () => {
  it('注册表非空，且每条迁移的 from/to 精确匹配', () => {
    expect(migrations.length).toBeGreaterThan(0)
    for (const m of migrations) {
      expect(m.from).toMatch(/^\d+\.\d+$/)
      expect(m.to).toMatch(/^\d+\.\d+$/)
      expect(m.from).not.toBe(m.to)
      expect(typeof m.description).toBe('string')
      expect(typeof m.breaking).toBe('boolean')
    }
  })

  it('每个已发布版本都有冻结的 schema', () => {
    for (const version of SUPPORTED_VERSIONS) {
      expect(schemas[version], version).toBeDefined()
    }
  })

  it('from === to → 原样返回（但仍校验）', () => {
    const doc = fixture()
    const out = migrate(doc, '0.1', '0.1')
    expect(out).toEqual(doc)
  })

  it('把 appearance.* 改名为 style.*', () => {
    const doc = fixture()
    const node = (doc.nodes as Array<Record<string, unknown>>).find(
      (n) => n.id === 'frame~hero'
    )!
    ;(node as Record<string, unknown>).appearance = { opacity: 0.5 }
    const out = migrate(doc, '0.1', '1.0') as unknown as Record<string, unknown>
    const moved = (out.nodes as Array<Record<string, unknown>>).find(
      (n) => n.id === 'frame~hero'
    )!
    expect(moved.appearance).toBeUndefined()
    expect(moved.style).toEqual({ opacity: 0.5 })
    expect(out.version).toBe('1.0')
  })

  it('把 text.content 改名为 text.value', () => {
    const doc = fixture()
    const node = (doc.nodes as Array<Record<string, unknown>>).find(
      (n) => n.id === 'text~button-label'
    )!
    ;(node as Record<string, unknown>).text = { content: 'Click me' }
    const out = migrate(doc, '0.1', '1.0') as unknown as Record<string, unknown>
    const moved = (out.nodes as Array<Record<string, unknown>>).find(
      (n) => n.id === 'text~button-label'
    )!
    const text = moved.text as Record<string, unknown>
    expect(text.content).toBeUndefined()
    expect(text.value).toBe('Click me')
  })

  it('**同步改写变量绑定路径**（只改字段名不改绑定路径 = 绑定静默失效）', () => {
    const doc = fixture()
    const node = (doc.nodes as Array<Record<string, unknown>>).find(
      (n) => n.id === 'frame~hero'
    )!
    ;(node as Record<string, unknown>).appearance = { opacity: 0.5 }
    ;(node as Record<string, unknown>).bindings = {
      fields: { 'appearance.opacity': 'var~primary' },
      scales: { 'appearance.opacity': 2 },
    }
    const out = migrate(doc, '0.1', '1.0') as unknown as Record<string, unknown>
    const moved = (out.nodes as Array<Record<string, unknown>>).find(
      (n) => n.id === 'frame~hero'
    )!
    const bindings = moved.bindings as Record<string, Record<string, unknown>>
    expect(bindings.fields).toEqual({ 'style.opacity': 'var~primary' })
    expect(bindings.scales).toEqual({ 'style.opacity': 2 })
  })

  it('迁移后能被目标版本的 schema 校验', () => {
    const doc = fixture()
    const out = migrate(doc, '0.1', '1.0')
    expect(schemas['1.0']).toBeDefined()
    expect(() => schemas['1.0']!.parse(out)).not.toThrow()
  })

  it('M1 确定性：同一输入迁移两次，结果逐字节相同', () => {
    const a = migrate(fixture(), '0.1', '1.0')
    const b = migrate(fixture(), '0.1', '1.0')
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('M2 幂等', () => {
    const once = migrate(fixture(), '0.1', '1.0')
    const twice = migrate(JSON.parse(JSON.stringify(once)), '0.1', '1.0')
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once))
  })

  it('M3 无损：除白名单外深度相等', () => {
    const doc = fixture()
    const before = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>
    const after = migrate(doc, '0.1', '1.0') as unknown as Record<string, unknown>

    // 白名单：version + 节点里的 appearance→style / text.content→text.value
    expect(after.version).toBe('1.0')
    delete (after as Record<string, unknown>).version
    delete (before as Record<string, unknown>).version

    const beforeNodes = before.nodes as Array<Record<string, unknown>>
    const afterNodes = after.nodes as Array<Record<string, unknown>>
    expect(afterNodes).toHaveLength(beforeNodes.length)
    for (const [i, node] of beforeNodes.entries()) {
      const moved = afterNodes[i]!
      for (const [key, value] of Object.entries(node)) {
        if (key === 'appearance' || key === 'text') continue // 声明要改的
        expect(moved[key], `${node.id}.${key}`).toEqual(value)
      }
    }
  })

  it('迁移是纯函数：入参不被就地修改', () => {
    const doc = fixture()
    const snapshot = JSON.stringify(doc)
    migrate(doc, '0.1', '1.0')
    expect(JSON.stringify(doc)).toBe(snapshot)
  })

  it('找不到路径 → 抛 OdMigrationError，**不做有损降级**', () => {
    expect(() => migrate(fixture(), '1.0', '0.1')).toThrowError(/没有从/)
  })

  it('isSupportedVersion', () => {
    expect(isSupportedVersion('0.1')).toBe(true)
    expect(isSupportedVersion('9.9')).toBe(false)
  })

  it('迁移器的描述里说明了改了什么', () => {
    expect(migrate_0_1_to_1_0.description).toContain('appearance')
    expect(migrate_0_1_to_1_0.breaking).toBe(true)
  })
})
