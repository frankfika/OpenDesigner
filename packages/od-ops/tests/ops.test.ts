/**
 * od-ops 的行为测试。
 *
 * 覆盖：每个 op 各至少一个 + 原子性 / move 环检测 / 非法 binding path /
 * 非法 reorder / validate 失败回滚 / delete 级联 / 纯函数性。
 */
import { describe, expect, it } from 'vitest'

import { IdRegistry, validate, type OdDocument } from '@opendesigner/od-format'

import { applyOps, OP_CODES, parseOps } from '../src/index'
import type { OdOp } from '../src/index'

import { childrenOf, makeDoc, nodeOf } from './fixtures'

describe('夹具本身', () => {
  it('makeDoc 是一份合法文档（无 error 级问题）', () => {
    const result = validate(makeDoc())
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
  })
})

describe('insert', () => {
  it('新节点分配 odId、挂到父节点下、parent/children 一致', () => {
    const doc = makeDoc()
    const result = applyOps(doc, [
      { op: 'insert', parentId: 'frame~a', node: { type: 'RECTANGLE', name: 'New' } },
    ])

    expect(result.ok).toBe(true)
    expect(result.applied).toBe(1)
    expect(result.issues).toEqual([])

    const inserted = result.doc.nodes.find((node) => node.name === 'New')
    expect(inserted).toBeDefined()
    expect(inserted?.id).toMatch(/^rect~new$/)
    expect(inserted?.parent).toBe('frame~a')
    expect(inserted?.children).toEqual([])
    expect(childrenOf(result.doc, 'frame~a')).toEqual(['rect~a1', inserted?.id])
  })

  it('index 缺省 = 追加到末尾', () => {
    const doc = makeDoc()
    const result = applyOps(doc, [
      { op: 'insert', parentId: 'frame~root', node: { type: 'FRAME', name: 'Tail' } },
    ])
    expect(result.ok).toBe(true)
    expect(childrenOf(result.doc, 'frame~root')).toEqual(['frame~a', 'frame~b', 'frame~tail'])
  })

  it('index 指定插入位置', () => {
    const doc = makeDoc()
    const result = applyOps(doc, [
      { op: 'insert', parentId: 'frame~root', node: { type: 'FRAME', name: 'Head' }, index: 0 },
    ])
    expect(result.ok).toBe(true)
    expect(childrenOf(result.doc, 'frame~root')).toEqual(['frame~head', 'frame~a', 'frame~b'])
  })

  it('node 的其他字段按 od 形状原样写入', () => {
    const doc = makeDoc()
    const result = applyOps(doc, [
      {
        op: 'insert',
        parentId: 'frame~a',
        node: { type: 'RECTANGLE', name: 'Sized', box: { x: 1, y: 2, width: 30, height: 40 } },
      },
    ])
    expect(result.ok).toBe(true)
    const inserted = result.doc.nodes.find((node) => node.name === 'Sized')
    expect(nodeOf(result.doc, inserted?.id as string)?.['box']).toEqual({
      x: 1,
      y: 2,
      width: 30,
      height: 40,
    })
  })

  it('不支持的节点类型 → OP_INVALID_TYPE', () => {
    const doc = makeDoc()
    const result = applyOps(doc, [
      { op: 'insert', parentId: 'frame~a', node: { type: 'NOT_A_TYPE' } },
    ])
    expect(result.ok).toBe(false)
    expect(result.applied).toBe(0)
    expect(result.issues[0]?.code).toBe('OP_INVALID_TYPE')
  })

  it('父节点不存在 → OP_UNKNOWN_PARENT', () => {
    const doc = makeDoc()
    const result = applyOps(doc, [
      { op: 'insert', parentId: 'frame~nope', node: { type: 'RECTANGLE' } },
    ])
    expect(result.ok).toBe(false)
    expect(result.issues[0]?.code).toBe('OP_UNKNOWN_PARENT')
  })

  it('父节点不能容纳子节点（TEXT）→ OP_INVALID_TYPE', () => {
    const doc = makeDoc()
    const result = applyOps(doc, [
      { op: 'insert', parentId: 'rect~a1', node: { type: 'RECTANGLE' } },
    ])
    expect(result.ok).toBe(false)
    expect(result.issues[0]?.code).toBe('OP_INVALID_TYPE')
  })
})

describe('update', () => {
  it('浅合并：只改出现的顶层键，其他字段不动', () => {
    const doc = makeDoc()
    const result = applyOps(doc, [
      { op: 'update', nodeId: 'frame~a', props: { name: 'Renamed' } },
    ])
    expect(result.ok).toBe(true)
    const node = nodeOf(result.doc, 'frame~a')
    expect(node?.['name']).toBe('Renamed')
    expect(node?.['box']).toEqual({ x: 0, y: 0, width: 100, height: 100 })
    expect(node?.['children']).toEqual(['rect~a1'])
  })

  it('节点不存在 → OP_UNKNOWN_NODE', () => {
    const doc = makeDoc()
    const result = applyOps(doc, [{ op: 'update', nodeId: 'frame~nope', props: { name: 'x' } }])
    expect(result.ok).toBe(false)
    expect(result.issues[0]?.code).toBe('OP_UNKNOWN_NODE')
  })

  it('不许改结构字段（id/parent/children）→ OP_INVALID_VALUE', () => {
    const doc = makeDoc()
    const result = applyOps(doc, [
      { op: 'update', nodeId: 'frame~a', props: { parent: 'frame~root' } },
    ])
    expect(result.ok).toBe(false)
    expect(result.issues[0]?.code).toBe('OP_INVALID_VALUE')
  })

  it('点分键按路径写（不会静默写进一个没人读的键）', () => {
    const doc = makeDoc()
    const result = applyOps(doc, [
      { op: 'update', nodeId: 'rect~a1', props: { 'box.width': 55 } },
    ])
    expect(result.ok).toBe(true)
    expect(nodeOf(result.doc, 'rect~a1')?.['box']).toEqual({ x: 0, y: 0, width: 55, height: 10 })
  })

  it('点分键不在白名单 → OP_INVALID_PATH', () => {
    const doc = makeDoc()
    const result = applyOps(doc, [
      { op: 'update', nodeId: 'rect~a1', props: { 'box.nope': 1 } },
    ])
    expect(result.ok).toBe(false)
    expect(result.issues[0]?.code).toBe('OP_INVALID_PATH')
  })
})

describe('delete', () => {
  it('级联删除整棵子树，并从父节点 children 里移除', () => {
    const doc = makeDoc()
    const result = applyOps(doc, [{ op: 'delete', nodeId: 'frame~a' }])
    expect(result.ok).toBe(true)
    expect(result.doc.nodes.map((node) => node.id)).toEqual(['frame~root', 'frame~b'])
    expect(childrenOf(result.doc, 'frame~root')).toEqual(['frame~b'])
    expect(childrenOf(result.doc, 'frame~a')).toEqual([])
  })

  it('节点不存在 → OP_UNKNOWN_NODE', () => {
    const doc = makeDoc()
    const result = applyOps(doc, [{ op: 'delete', nodeId: 'frame~nope' }])
    expect(result.ok).toBe(false)
    expect(result.issues[0]?.code).toBe('OP_UNKNOWN_NODE')
  })

  it('不能删根节点 → OP_INVALID_VALUE', () => {
    const doc = makeDoc()
    const result = applyOps(doc, [{ op: 'delete', nodeId: 'frame~root' }])
    expect(result.ok).toBe(false)
    expect(result.issues[0]?.code).toBe('OP_INVALID_VALUE')
  })
})

describe('move', () => {
  it('更新 parent 指针 + 两边的子节点顺序', () => {
    const doc = makeDoc()
    const result = applyOps(doc, [
      { op: 'move', nodeId: 'rect~a1', newParentId: 'frame~b', index: 0 },
    ])
    expect(result.ok).toBe(true)
    expect(nodeOf(result.doc, 'rect~a1')?.['parent']).toBe('frame~b')
    expect(childrenOf(result.doc, 'frame~a')).toEqual([])
    expect(childrenOf(result.doc, 'frame~b')).toEqual(['rect~a1'])
  })

  it('移到自己的后代下 → OP_CYCLE', () => {
    const doc = makeDoc()
    const result = applyOps(doc, [
      { op: 'move', nodeId: 'frame~a', newParentId: 'rect~a1' },
    ])
    expect(result.ok).toBe(false)
    expect(result.issues[0]?.code).toBe('OP_CYCLE')
  })

  it('移到自己下面 → OP_CYCLE', () => {
    const doc = makeDoc()
    const result = applyOps(doc, [
      { op: 'move', nodeId: 'frame~a', newParentId: 'frame~a' },
    ])
    expect(result.ok).toBe(false)
    expect(result.issues[0]?.code).toBe('OP_CYCLE')
  })

  it('父节点不存在 → OP_UNKNOWN_PARENT', () => {
    const doc = makeDoc()
    const result = applyOps(doc, [
      { op: 'move', nodeId: 'rect~a1', newParentId: 'frame~nope' },
    ])
    expect(result.ok).toBe(false)
    expect(result.issues[0]?.code).toBe('OP_UNKNOWN_PARENT')
  })
})

describe('set', () => {
  it('按 od 绑定路径写字段（box.width）', () => {
    const doc = makeDoc()
    const result = applyOps(doc, [
      { op: 'set', nodeId: 'rect~a1', path: 'box.width', value: 42 },
    ])
    expect(result.ok).toBe(true)
    expect(nodeOf(result.doc, 'rect~a1')?.['box']).toEqual({
      x: 0,
      y: 0,
      width: 42,
      height: 10,
    })
  })

  it('引擎写法（width / opacity）也认，归一化到 od 路径', () => {
    const doc = makeDoc()
    const result = applyOps(doc, [
      { op: 'set', nodeId: 'rect~a1', path: 'width', value: 42 },
      { op: 'set', nodeId: 'rect~a1', path: 'opacity', value: 0.5 },
    ])
    expect(result.ok).toBe(true)
    expect(nodeOf(result.doc, 'rect~a1')?.['box']).toMatchObject({ width: 42 })
    expect(nodeOf(result.doc, 'rect~a1')?.['appearance']).toMatchObject({ opacity: 0.5 })
  })

  it('非法 binding path → OP_INVALID_PATH（不静默忽略）', () => {
    const doc = makeDoc()
    const result = applyOps(doc, [
      { op: 'set', nodeId: 'rect~a1', path: 'box.nope', value: 1 },
    ])
    expect(result.ok).toBe(false)
    expect(result.issues[0]?.code).toBe('OP_INVALID_PATH')
    expect(result.issues[0]?.path).toBe('path')
  })

  it('值类型不对 → OP_INVALID_VALUE', () => {
    const doc = makeDoc()
    const result = applyOps(doc, [
      { op: 'set', nodeId: 'rect~a1', path: 'box.width', value: 'wide' },
    ])
    expect(result.ok).toBe(false)
    expect(result.issues[0]?.code).toBe('OP_INVALID_VALUE')
  })

  it('节点不存在 → OP_UNKNOWN_NODE', () => {
    const doc = makeDoc()
    const result = applyOps(doc, [
      { op: 'set', nodeId: 'frame~nope', path: 'box.width', value: 1 },
    ])
    expect(result.ok).toBe(false)
    expect(result.issues[0]?.code).toBe('OP_UNKNOWN_NODE')
  })
})

describe('reorder', () => {
  it('order 是排列 → 改写 children 顺序', () => {
    const doc = makeDoc()
    const result = applyOps(doc, [
      { op: 'reorder', parentId: 'frame~root', order: ['frame~b', 'frame~a'] },
    ])
    expect(result.ok).toBe(true)
    expect(childrenOf(result.doc, 'frame~root')).toEqual(['frame~b', 'frame~a'])
  })

  it('order 漏一项 → OP_INVALID_ORDER', () => {
    const doc = makeDoc()
    const result = applyOps(doc, [
      { op: 'reorder', parentId: 'frame~root', order: ['frame~a'] },
    ])
    expect(result.ok).toBe(false)
    expect(result.issues[0]?.code).toBe('OP_INVALID_ORDER')
  })

  it('order 有重复项 → OP_INVALID_ORDER', () => {
    const doc = makeDoc()
    const result = applyOps(doc, [
      { op: 'reorder', parentId: 'frame~root', order: ['frame~a', 'frame~a'] },
    ])
    expect(result.ok).toBe(false)
    expect(result.issues[0]?.code).toBe('OP_INVALID_ORDER')
  })

  it('order 含未知节点 → OP_INVALID_ORDER', () => {
    const doc = makeDoc()
    const result = applyOps(doc, [
      { op: 'reorder', parentId: 'frame~root', order: ['frame~b', 'frame~ghost'] },
    ])
    expect(result.ok).toBe(false)
    expect(result.issues[0]?.code).toBe('OP_INVALID_ORDER')
  })

  it('父节点不存在 → OP_UNKNOWN_PARENT', () => {
    const doc = makeDoc()
    const result = applyOps(doc, [
      { op: 'reorder', parentId: 'frame~nope', order: [] },
    ])
    expect(result.ok).toBe(false)
    expect(result.issues[0]?.code).toBe('OP_UNKNOWN_PARENT')
  })
})

describe('batch', () => {
  it('子 op 按序应用', () => {
    const doc = makeDoc()
    const result = applyOps(doc, [
      {
        op: 'batch',
        ops: [
          { op: 'insert', parentId: 'frame~a', node: { type: 'TEXT', name: 'Label' } },
          { op: 'set', nodeId: 'frame~a', path: 'box.width', value: 200 },
        ],
      },
    ])
    expect(result.ok).toBe(true)
    expect(result.applied).toBe(2)
    expect(childrenOf(result.doc, 'frame~a')).toEqual(['rect~a1', 'text~label'])
    expect(nodeOf(result.doc, 'frame~a')?.['box']).toMatchObject({ width: 200 })
  })

  it('子 op 失败 → index 是 batch 内的相对下标，且整批不生效', () => {
    const doc = makeDoc()
    const result = applyOps(doc, [
      {
        op: 'batch',
        ops: [
          { op: 'set', nodeId: 'frame~a', path: 'box.width', value: 200 },
          { op: 'set', nodeId: 'frame~nope', path: 'box.width', value: 1 },
        ],
      },
    ])
    expect(result.ok).toBe(false)
    expect(result.applied).toBe(0)
    expect(result.issues[0]?.index).toBe(1)
    expect(result.issues[0]?.code).toBe('OP_UNKNOWN_NODE')
    expect(childrenOf(result.doc, 'frame~a')).toEqual(['rect~a1'])
  })
})

describe('原子性与纯函数性', () => {
  it('一个 op 失败 → 全部不生效，返回原文档的深拷贝', () => {
    const doc = makeDoc()
    const before = JSON.parse(JSON.stringify(doc)) as OdDocument

    const result = applyOps(doc, [
      { op: 'insert', parentId: 'frame~a', node: { type: 'RECTANGLE', name: 'Ghost' } },
      { op: 'set', nodeId: 'frame~a', path: 'box.width', value: 999 },
      { op: 'delete', nodeId: 'frame~b' },
      { op: 'set', nodeId: 'frame~nope', path: 'box.width', value: 1 },
    ])

    expect(result.ok).toBe(false)
    expect(result.applied).toBe(0)
    expect(result.issues[0]?.index).toBe(3)
    expect(result.issues[0]?.code).toBe('OP_UNKNOWN_NODE')

    // 返回的 doc = 原文档（未改动）
    expect(result.doc).toEqual(before)
    // 传入的 doc 也没被动过
    expect(doc).toEqual(before)
  })

  it('失败时返回的是深拷贝（改返回值不会污染原文档）', () => {
    const doc = makeDoc()
    const result = applyOps(doc, [{ op: 'delete', nodeId: 'frame~nope' }])
    expect(result.ok).toBe(false)
    const node = result.doc.nodes[0] as unknown as Record<string, unknown>
    node['name'] = 'Mutated'
    expect((doc.nodes[0] as unknown as Record<string, unknown>)['name']).toBe('Root')
  })

  it('成功时也不修改传入的 doc（纯函数）', () => {
    const doc = makeDoc()
    const before = JSON.parse(JSON.stringify(doc)) as OdDocument
    const result = applyOps(doc, [
      { op: 'insert', parentId: 'frame~a', node: { type: 'RECTANGLE', name: 'New' } },
      { op: 'set', nodeId: 'rect~a1', path: 'box.width', value: 77 },
    ])
    expect(result.ok).toBe(true)
    expect(doc).toEqual(before)
    expect(result.doc).not.toBe(doc)
  })

  it('validate 失败 → 整批回滚 + OP_VALIDATION_FAILED', () => {
    const doc = makeDoc()
    const before = JSON.parse(JSON.stringify(doc)) as OdDocument
    // box.width 在 od schema 里必须是 number —— 塞个字符串让校验失败
    const result = applyOps(doc, [
      { op: 'insert', parentId: 'frame~a', node: { type: 'RECTANGLE', name: 'Bad', box: { width: 'wide' } } },
    ])
    expect(result.ok).toBe(false)
    expect(result.applied).toBe(0)
    expect(result.issues[0]?.code).toBe('OP_VALIDATION_FAILED')
    expect(result.doc).toEqual(before)
    expect(doc).toEqual(before)
  })
})

describe('registry', () => {
  it('复用调用方的 registry → odId 分配连续', () => {
    const doc = makeDoc()
    const registry = new IdRegistry()
    for (const node of doc.nodes) registry.adopt(node.id)

    const result = applyOps(
      doc,
      [
        { op: 'insert', parentId: 'frame~a', node: { type: 'RECTANGLE', name: 'Box' } },
        { op: 'insert', parentId: 'frame~a', node: { type: 'RECTANGLE', name: 'Box' } },
      ],
      { registry }
    )
    expect(result.ok).toBe(true)
    const ids = result.doc.nodes.filter((node) => node.name === 'Box').map((node) => node.id)
    expect(ids).toEqual(['rect~box', 'rect~box~1'])
    expect(registry.ordinal()).toBeGreaterThan(0)
  })

  it('不传 registry 时也不会与文档里已有的 id 撞车', () => {
    const doc = makeDoc()
    const result = applyOps(doc, [
      { op: 'insert', parentId: 'frame~a', node: { type: 'FRAME', name: 'a' } },
    ])
    expect(result.ok).toBe(true)
    const inserted = result.doc.nodes.find((node) => node.name === 'a')
    expect(inserted?.id).not.toBe('frame~a')
    expect(result.doc.nodes.map((node) => node.id)).toHaveLength(
      new Set(result.doc.nodes.map((node) => node.id)).size
    )
  })
})

describe('parseOps', () => {
  it('合法 op 列表 → ok', () => {
    const parsed = parseOps([
      { op: 'insert', parentId: 'frame~a', node: { type: 'RECTANGLE' } },
      { op: 'set', nodeId: 'rect~a1', path: 'box.width', value: 10 },
    ])
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.ops).toHaveLength(2)
  })

  it('{ ops: [...] } 包装也认', () => {
    const parsed = parseOps({ ops: [{ op: 'delete', nodeId: 'frame~a' }] })
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.ops[0]?.op).toBe('delete')
  })

  it('形状非法 → OP_INVALID_SHAPE + 下标', () => {
    const parsed = parseOps([{ op: 'insert' }])
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.issues[0]?.code).toBe('OP_INVALID_SHAPE')
      expect(parsed.issues[0]?.index).toBe(0)
    }
  })

  it('不是数组 → OP_INVALID_SHAPE', () => {
    const parsed = parseOps('nope')
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.issues[0]?.code).toBe('OP_INVALID_SHAPE')
  })

  it('parseOps 出来的 op 能直接喂给 applyOps', () => {
    const parsed = parseOps([{ op: 'set', nodeId: 'rect~a1', path: 'box.width', value: 12 }])
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const result = applyOps(makeDoc(), parsed.ops)
    expect(result.ok).toBe(true)
    expect(nodeOf(result.doc, 'rect~a1')?.['box']).toMatchObject({ width: 12 })
  })
})

describe('错误码表', () => {
  it('覆盖所有用到的错误码，且都有中文说明', () => {
    const used = [
      'OP_UNKNOWN_NODE',
      'OP_UNKNOWN_PARENT',
      'OP_INVALID_TYPE',
      'OP_INVALID_PATH',
      'OP_INVALID_ORDER',
      'OP_CYCLE',
      'OP_INVALID_VALUE',
      'OP_VALIDATION_FAILED',
      'OP_INVALID_SHAPE',
    ]
    for (const code of used) {
      expect(OP_CODES[code]).toBeTruthy()
    }
  })

  it('每个 op 都有对应的错误码路径', () => {
    const cases: Array<[OdOp, string]> = [
      [{ op: 'delete', nodeId: 'nope' }, 'OP_UNKNOWN_NODE'],
      [{ op: 'insert', parentId: 'nope', node: { type: 'RECTANGLE' } }, 'OP_UNKNOWN_PARENT'],
      [{ op: 'insert', parentId: 'frame~a', node: { type: 'NOPE' } }, 'OP_INVALID_TYPE'],
      [{ op: 'set', nodeId: 'frame~a', path: 'nope', value: 1 }, 'OP_INVALID_PATH'],
      [{ op: 'reorder', parentId: 'frame~root', order: [] }, 'OP_INVALID_ORDER'],
      [{ op: 'move', nodeId: 'frame~a', newParentId: 'frame~a' }, 'OP_CYCLE'],
    ]
    for (const [op, code] of cases) {
      const result = applyOps(makeDoc(), [op])
      expect(result.ok).toBe(false)
      expect(result.issues[0]?.code).toBe(code)
    }
  })
})
