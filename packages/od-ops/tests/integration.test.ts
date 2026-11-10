/**
 * od-ops 与 od-format 的衔接测试。
 *
 * 证明「applyOps 的产物」是一个**真的 od 文件**（能序列化、能解析、能进引擎），
 * 而不只是内存里的一个对象。
 */
import { describe, expect, it } from 'vitest'

import { parseOd, stringifyOd, toEngine, validate } from '@opendesigner/od-format'

import { applyOps } from '../src/index'

import { makeDoc, nodeOf } from './fixtures'

describe('applyOps 的产物', () => {
  it('能写成 od 文本、解析回来、校验通过', () => {
    const result = applyOps(makeDoc(), [
      { op: 'insert', parentId: 'frame~a', node: { type: 'TEXT', name: 'Label' } },
      { op: 'set', nodeId: 'rect~a1', path: 'box.width', value: 64 },
    ])
    expect(result.ok).toBe(true)

    const text = stringifyOd(result.doc)
    expect(text.startsWith('{')).toBe(true)
    expect(text).toContain('"text~label"')

    const reparsed = parseOd(text)
    expect(reparsed.nodes.map((node) => node.id)).toEqual(
      result.doc.nodes.map((node) => node.id)
    )
    expect(validate(reparsed).ok).toBe(true)
  })

  it('能进引擎（toEngine 不抛）', () => {
    const result = applyOps(makeDoc(), [
      { op: 'insert', parentId: 'frame~a', node: { type: 'RECTANGLE', name: 'Box' } },
    ])
    expect(result.ok).toBe(true)

    const engine = toEngine(result.doc)
    expect(engine.graph.nodes.size).toBe(result.doc.nodes.length)
  })
})

describe('set 的边界', () => {
  it('颜色路径接受 RGBA 对象与十六进制字符串', () => {
    const rgba = applyOps(makeDoc(), [
      { op: 'set', nodeId: 'rect~a1', path: 'fills.0.color', value: { r: 0, g: 1, b: 0, a: 1 } },
    ])
    expect(rgba.ok).toBe(true)
    const fills = nodeOf(rgba.doc, 'rect~a1')?.['fills'] as Array<{ color: unknown }>
    expect(fills[0]?.color).toEqual({ r: 0, g: 1, b: 0, a: 1 })

    const hex = applyOps(makeDoc(), [
      { op: 'set', nodeId: 'rect~a1', path: 'fills/0/color', value: '#ff0000' },
    ])
    expect(hex.ok).toBe(true)
    const hexFills = nodeOf(hex.doc, 'rect~a1')?.['fills'] as Array<{ color: unknown }>
    expect(hexFills[0]?.color).toMatchObject({ r: 1, g: 0, b: 0 })
  })

  it('颜色值形状不对 → OP_INVALID_VALUE', () => {
    const result = applyOps(makeDoc(), [
      { op: 'set', nodeId: 'rect~a1', path: 'fills.0.color', value: 42 },
    ])
    expect(result.ok).toBe(false)
    expect(result.issues[0]?.code).toBe('OP_INVALID_VALUE')
  })

  it('数组下标越界 → OP_INVALID_VALUE', () => {
    const result = applyOps(makeDoc(), [
      { op: 'set', nodeId: 'rect~a1', path: 'fills.5.color', value: '#ffffff' },
    ])
    expect(result.ok).toBe(false)
    expect(result.issues[0]?.code).toBe('OP_INVALID_VALUE')
  })
})

describe('边界输入', () => {
  it('空 op 列表 → ok，返回原文档的深拷贝', () => {
    const doc = makeDoc()
    const result = applyOps(doc, [])
    expect(result.ok).toBe(true)
    expect(result.applied).toBe(0)
    expect(result.doc).toEqual(doc)
    expect(result.doc).not.toBe(doc)
  })

  it('嵌套 batch 的下标是相对最内层 batch 的', () => {
    const result = applyOps(makeDoc(), [
      {
        op: 'batch',
        ops: [
          { op: 'set', nodeId: 'frame~a', path: 'box.width', value: 1 },
          {
            op: 'batch',
            ops: [
              { op: 'set', nodeId: 'frame~a', path: 'box.height', value: 2 },
              { op: 'delete', nodeId: 'frame~nope' },
            ],
          },
        ],
      },
    ])
    expect(result.ok).toBe(false)
    expect(result.issues[0]?.code).toBe('OP_UNKNOWN_NODE')
    expect(result.issues[0]?.index).toBe(1)
  })

  it('move 不动子树的内部结构', () => {
    const result = applyOps(makeDoc(), [
      { op: 'move', nodeId: 'frame~a', newParentId: 'frame~b' },
    ])
    expect(result.ok).toBe(true)
    expect(nodeOf(result.doc, 'rect~a1')?.['parent']).toBe('frame~a')
    expect(nodeOf(result.doc, 'frame~a')?.['children']).toEqual(['rect~a1'])
  })

  it('同一批里连续 insert 同名节点 → odId 不复用', () => {
    const result = applyOps(makeDoc(), [
      { op: 'insert', parentId: 'frame~root', node: { type: 'FRAME', name: 'Card' } },
      { op: 'insert', parentId: 'frame~root', node: { type: 'FRAME', name: 'Card' } },
    ])
    expect(result.ok).toBe(true)
    const ids = result.doc.nodes.filter((node) => node.name === 'Card').map((node) => node.id)
    expect(ids).toEqual(['frame~card', 'frame~card~1'])
    expect(new Set(ids).size).toBe(2)
  })
})
