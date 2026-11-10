/**
 * od-ops 的测试夹具 —— 手写一份**合法的 od 文档**。
 *
 * 结构（扁平 nodes 数组 + parent 指针）：
 *
 * ```
 * frame~root
 * ├── frame~a
 * │   └── rect~a1
 * └── frame~b
 * ```
 *
 * 这份文档能通过 `validate()`（无 error 级问题），
 * 所以「op 应用后校验失败 → 回滚」的测试可以精确地指向 op 本身造成的问题。
 */
import type { OdDocument } from '@opendesigner/od-format'

export function makeDoc(): OdDocument {
  return {
    format: 'od',
    version: '0.1',
    meta: {
      generator: 'od-ops test',
      engine: 'opendesigner',
      colorSpace: 'srgb',
      root: 'frame~root',
      ordinal: 0,
    },
    nodes: [
      {
        id: 'frame~root',
        type: 'FRAME',
        name: 'Root',
        children: ['frame~a', 'frame~b'],
        box: { x: 0, y: 0, width: 800, height: 600 },
      },
      {
        id: 'frame~a',
        type: 'FRAME',
        name: 'A',
        parent: 'frame~root',
        children: ['rect~a1'],
        box: { x: 0, y: 0, width: 100, height: 100 },
      },
      {
        id: 'rect~a1',
        type: 'RECTANGLE',
        name: 'A1',
        parent: 'frame~a',
        children: [],
        box: { x: 0, y: 0, width: 10, height: 10 },
        fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }],
      },
      {
        id: 'frame~b',
        type: 'FRAME',
        name: 'B',
        parent: 'frame~root',
        children: [],
        box: { x: 0, y: 0, width: 100, height: 100 },
      },
    ],
    assets: {},
    variables: [],
    variableSets: [],
    themes: {},
    libraries: [],
  }
}

/** 取节点（测试里省事用）。 */
export function nodeOf(doc: OdDocument, id: string): Record<string, unknown> | undefined {
  const node = doc.nodes.find((candidate) => candidate.id === id)
  return node as unknown as Record<string, unknown> | undefined
}

/** 取节点的子节点 id 列表。 */
export function childrenOf(doc: OdDocument, id: string): string[] {
  const node = nodeOf(doc, id)
  const children = node?.['children']
  return Array.isArray(children) ? (children as string[]) : []
}
