/**
 * 校验器的测试（规格 §8.4 的 V1–V30）。
 *
 * 每个错误码至少有一个用例 —— 错误码是契约（CLI 的退出码和机器可读输出都依赖它）。
 */
import { describe, expect, it } from 'vitest'

import { parseJsonc, validate, OD_ERROR_CODES } from '../src/index.js'
import { buildRichGraph } from './fixtures.js'
import { fromEngine } from '../src/index.js'

function baseDoc(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(fromEngine(buildRichGraph()))) as Record<string, unknown>
}

function codes(result: ReturnType<typeof validate>): string[] {
  return result.issues.map((i) => i.code)
}

describe('校验器', () => {
  it('健康文档没有 error', () => {
    const result = validate(baseDoc())
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('V2 · 不支持的版本 → OD1003', () => {
    const doc = baseDoc()
    doc.version = '9.9'
    const result = validate(doc)
    expect(codes(result)).toContain('OD1003')
  })

  it('V3 · format 不是 "od" → OD1004', () => {
    const doc = baseDoc()
    doc.format = 'xx'
    expect(codes(validate(doc))).toContain('OD1004')
  })

  it('V5 · 顶层键顺序不对 → OD1101（warning）', () => {
    const doc = baseDoc()
    const reordered = {
      nodes: doc.nodes,
      format: doc.format,
      version: doc.version,
      meta: doc.meta,
      assets: doc.assets,
      variables: doc.variables,
      variableSets: doc.variableSets,
      themes: doc.themes,
      libraries: doc.libraries,
    }
    const result = validate(reordered)
    expect(codes(result)).toContain('OD1101')
    expect(result.warnings.some((i) => i.code === 'OD1101')).toBe(true)
  })

  it('V5 · --strict 把未知顶层键从 warning 升为 error', () => {
    const doc = baseDoc()
    doc.unknownTop = 1
    const loose = validate(doc)
    expect(loose.ok).toBe(true)
    expect(loose.warnings.some((i) => i.code === 'OD1303')).toBe(true)

    const strict = validate(doc, { strict: true })
    expect(strict.ok).toBe(false)
    expect(strict.errors.some((i) => i.code === 'OD1303')).toBe(true)
  })

  it('V6 · odId 语法非法 → OD1102', () => {
    const doc = baseDoc()
    ;(doc.nodes as Array<Record<string, unknown>>)[0]!.id = 'NotAnOdId'
    expect(codes(validate(doc))).toContain('OD1102')
  })

  it('V7 · odId 重复 → OD1103', () => {
    const doc = baseDoc()
    const nodes = doc.nodes as Array<Record<string, unknown>>
    nodes[1]!.id = nodes[0]!.id
    expect(codes(validate(doc))).toContain('OD1103')
  })

  it('V7b · meta.ordinal 小于文中最大判别器 → OD1321（warning）', () => {
    const doc = baseDoc()
    ;(doc.nodes as Array<Record<string, unknown>>)[0]!.id = 'frame~document~5'
    const result = validate(doc)
    expect(result.warnings.some((i) => i.code === 'OD1321')).toBe(true)
  })

  it('V8 · parent 指向不存在的节点 → OD1104', () => {
    const doc = baseDoc()
    ;(doc.nodes as Array<Record<string, unknown>>)[1]!.parent = 'frame~missing'
    expect(codes(validate(doc))).toContain('OD1104')
  })

  it('V10 · 父子关系成环 → OD1106', () => {
    const doc = baseDoc()
    const nodes = doc.nodes as Array<Record<string, unknown>>
    nodes[0]!.parent = nodes[2]!.id
    nodes[2]!.parent = nodes[0]!.id
    expect(codes(validate(doc))).toContain('OD1106')
  })

  it('V11 · meta.root 不是唯一的根 → OD1107', () => {
    const doc = baseDoc()
    ;(doc.meta as Record<string, unknown>).root = 'frame~nope'
    expect(codes(validate(doc))).toContain('OD1107')
  })

  it('V12 · 绑定路径不在白名单 → OD1108', () => {
    const doc = baseDoc()
    const node = (doc.nodes as Array<Record<string, unknown>>).find(
      (n) => n.id === 'frame~hero'
    )!
    node.bindings = { fields: { 'appearance.bogus': 'var~primary' } }
    expect(codes(validate(doc))).toContain('OD1108')
  })

  it('V12 · 前导零下标 → OD1108', () => {
    const doc = baseDoc()
    const node = (doc.nodes as Array<Record<string, unknown>>).find(
      (n) => n.id === 'frame~hero'
    )!
    node.bindings = { fields: { 'fills.00.color': 'var~primary' } }
    expect(codes(validate(doc))).toContain('OD1108')
  })

  it('V13 · 绑定指向的变量不存在 → OD1109', () => {
    const doc = baseDoc()
    const node = (doc.nodes as Array<Record<string, unknown>>).find(
      (n) => n.id === 'frame~hero'
    )!
    node.bindings = { fields: { 'appearance.opacity': 'var~missing' } }
    expect(codes(validate(doc))).toContain('OD1109')
  })

  it('V14 · 变量别名指向的变量不存在 → OD1110', () => {
    const doc = baseDoc()
    const variables = doc.variables as Array<Record<string, unknown>>
    variables[0]!.values = { 'mode~light': { alias: 'var~missing' } }
    expect(codes(validate(doc))).toContain('OD1110')
  })

  it('V15 · 变量值形状非法 → OD1111', () => {
    const doc = baseDoc()
    const variables = doc.variables as Array<Record<string, unknown>>
    variables[0]!.values = { 'mode~light': { bogus: 1 } }
    expect(codes(validate(doc))).toContain('OD1111')
  })

  it('V16 · 模式 id 不存在 → OD1112', () => {
    const doc = baseDoc()
    const variables = doc.variables as Array<Record<string, unknown>>
    variables[0]!.values = { 'mode~missing': { r: 1, g: 0, b: 0, a: 1 } }
    expect(codes(validate(doc))).toContain('OD1112')
  })

  it('V17 · 集合里的变量不存在 → OD1113', () => {
    const doc = baseDoc()
    const sets = doc.variableSets as Array<Record<string, unknown>>
    sets[0]!.variables = ['var~missing']
    expect(codes(validate(doc))).toContain('OD1113')
  })

  it('V18 · component.main 指向不存在的节点 → OD1114', () => {
    const doc = baseDoc()
    const node = (doc.nodes as Array<Record<string, unknown>>).find(
      (n) => n.id === 'inst~button-1'
    )!
    node.component = { main: 'comp~missing' }
    expect(codes(validate(doc))).toContain('OD1114')
  })

  it('V18b · INSTANCE 的主组件不是 COMPONENT → OD1120', () => {
    const doc = baseDoc()
    const node = (doc.nodes as Array<Record<string, unknown>>).find(
      (n) => n.id === 'inst~button-1'
    )!
    node.component = { main: 'text~button-label' }
    expect(codes(validate(doc))).toContain('OD1120')
  })

  it('V23 · fills 引用的图片不在 assets 里 → OD1119', () => {
    const doc = baseDoc()
    const node = (doc.nodes as Array<Record<string, unknown>>).find(
      (n) => n.id === 'frame~hero'
    )!
    node.fills = [
      { type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1, visible: true, imageHash: 'deadbeef' },
    ]
    expect(codes(validate(doc))).toContain('OD1119')
  })

  it('V22 · 资源没被引用 → OD1118（warning）', () => {
    const doc = baseDoc()
    doc.assets = {
      deadbeef: { file: 'assets/deadbeef.png', mime: 'image/png', bytes: 10 },
    }
    const result = validate(doc)
    expect(result.warnings.some((i) => i.code === 'OD1118')).toBe(true)
  })

  it('V30 · meta.generator 缺失 → OD1304（warning）', () => {
    const doc = baseDoc()
    delete (doc.meta as Record<string, unknown>).generator
    const result = validate(doc)
    expect(result.warnings.some((i) => i.code === 'OD1304')).toBe(true)
  })

  it('所有错误码都是已登记的（不拼错）', () => {
    const result = validate(baseDoc())
    for (const issue of result.issues) {
      expect(OD_ERROR_CODES).toContain(issue.code)
    }
  })

  it('JSONC 不可解析 → 抛 OD1001', () => {
    expect(() => parseJsonc('{ not json')).toThrowError(/OD1001/)
  })
})
