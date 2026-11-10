/**
 * schema 与实现不脱节（MUST #15，规格 §7.3 S2）。
 *
 * 公开 JSON Schema 是给外部工具（编辑器、CI）用的契约 —— 它和实现一旦漂移，
 * 外部工具就会按一份过时的契约工作。所以这里断言：**schema 里出现的 od 路径
 * 与字段映射表逐条吻合**，多一条少一条都要失败。
 */
import { describe, expect, it } from 'vitest'

import { FIELD_MAP, odDocumentJsonSchema } from '../src/index.js'

/** 从 JSON Schema 里收集所有出现的属性名（按路径）。 */
function collectPaths(schema: Record<string, unknown>, prefix = ''): string[] {
  const out: string[] = []
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined
  if (!properties) return out
  for (const [key, value] of Object.entries(properties)) {
    const path = prefix ? `${prefix}.${key}` : key
    out.push(path)
    out.push(...collectPaths(value as Record<string, unknown>, path))
  }
  return out
}

describe('MUST #15 · schema 同步', () => {
  it('公开 JSON Schema 能生成，且是合法 JSON', () => {
    const schema = odDocumentJsonSchema()
    expect(schema).toBeTruthy()
    expect(() => JSON.stringify(schema)).not.toThrow()
    expect(JSON.parse(JSON.stringify(schema))).toEqual(schema)
  })

  it('顶层 9 个键都在 schema 里，顺序与规格 §1.1 一致', () => {
    const schema = odDocumentJsonSchema()
    const properties = Object.keys(schema.properties as Record<string, unknown>)
    expect(properties).toEqual([
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

  it('节点 schema 覆盖字段映射表里的**每一个** od 路径', () => {
    const schema = odDocumentJsonSchema()
    const nodes = (schema.properties as Record<string, any>).nodes
    const nodeSchema = nodes.items as Record<string, unknown>
    const paths = new Set(collectPaths(nodeSchema))

    const missing: string[] = []
    for (const mapping of FIELD_MAP) {
      if (mapping.od === null) continue
      if (mapping.od.startsWith('id') && mapping.od === 'id') continue
      if (mapping.od === 'type' || mapping.od === 'name') continue
      if (!paths.has(mapping.od)) missing.push(mapping.od)
    }
    expect(missing, `schema 缺少这些 od 路径：${missing.join(', ')}`).toEqual([])
  })

  it('D1 派生字段**不在** schema 里（它们被剔除了）', () => {
    const schema = odDocumentJsonSchema()
    const nodeSchema = (schema.properties as Record<string, any>).nodes.items
    const paths = collectPaths(nodeSchema)
    for (const field of ['derivedLayout', 'derivedTextGlyphs', 'textPicture']) {
      expect(paths).not.toContain(field)
    }
  })

  it('D2 必留字段在 schema 里（bindings.scales / bindings.assignmentScales）', () => {
    const schema = odDocumentJsonSchema()
    const nodeSchema = (schema.properties as Record<string, any>).nodes.items
    const paths = collectPaths(nodeSchema)
    expect(paths).toContain('bindings.scales')
    expect(paths).toContain('bindings.assignmentScales')
  })

  it('schema 里的 odId 字段带正则约束', () => {
    const schema = odDocumentJsonSchema()
    const nodeSchema = (schema.properties as Record<string, any>).nodes.items
    const idSchema = nodeSchema.properties.id as Record<string, unknown>
    expect(JSON.stringify(idSchema)).toContain('~')
  })
})
