/**
 * `od inspect` 的摘要（规格 §8.3）。
 *
 * **只读**：不修改任何东西。
 *
 * `json` 输出形态是**给 agent 用**的，MUST 稳定 —— 字段名与形状都是契约。
 */
import type { OdDocument, OdNode } from './schema'

export interface InspectOptions {
  /** 树的最大深度（text 模式）。 */
  depth?: number
  /** 额外打印每个节点的派生路径。 */
  paths?: boolean
  /** 打印 odId → 引擎 id 的映射（恒等映射时没有信息量）。 */
  ids?: boolean
  /** 只打印统计。 */
  stats?: boolean
  /** 只看某个子树。 */
  select?: string
  /** 只保留 odId 或 name 匹配正则的节点。 */
  grep?: string
}

export interface InspectTreeNode {
  id: string
  type: string
  name: string
  path: string[]
  children: string[]
  width?: number
  height?: number
  text?: string
}

export interface InspectResult {
  ok: true
  command: 'inspect'
  format: string
  engine: string
  root: string
  counts: {
    nodes: number
    byType: Record<string, number>
    variables: number
    variableSets: number
    components: number
    instances: number
    assets: number
  }
  tree: InspectTreeNode[]
  variables: Array<{ id: string; name: string; type: string; set?: string }>
  variableSets: Array<{ id: string; name: string; modes: string[] }>
  assets: Array<{ id: string; file: string; mime: string; bytes: number }>
  warnings: string[]
}

/** 读 od 节点上的点分路径。 */
function readPath(node: Record<string, unknown>, path: string): unknown {
  let cur: unknown = node
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object' || Array.isArray(cur)) return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

export function inspect(doc: OdDocument, opts: InspectOptions = {}): InspectResult {
  const warnings: string[] = []
  const byId = new Map<string, Record<string, unknown>>()
  for (const node of doc.nodes) byId.set(node.id, node as unknown as Record<string, unknown>)

  // --- 统计 ---
  const byType: Record<string, number> = {}
  for (const node of doc.nodes) byType[node.type] = (byType[node.type] ?? 0) + 1
  let components = 0
  let instances = 0
  for (const node of doc.nodes) {
    if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') components++
    if (node.type === 'INSTANCE') instances++
  }

  // --- 树（扁平 + path 数组）---
  const tree: InspectTreeNode[] = []
  const rootId = doc.meta.root
  const childrenOf = (id: string): string[] => {
    const node = byId.get(id)
    if (!node) return []
    const children = node.children
    return Array.isArray(children) ? children.filter((c): c is string => typeof c === 'string') : []
  }

  const visit = (id: string, path: string[], depth: number): void => {
    const node = byId.get(id)
    if (!node) return
    if (opts.select && id !== opts.select && !path.includes(opts.select)) return
    if (opts.grep) {
      const re = new RegExp(opts.grep)
      if (!re.test(id) && !re.test(String(node.name ?? ''))) return
    }
    if (opts.depth !== undefined && depth > opts.depth) return

    const width = readPath(node, 'box.width')
    const height = readPath(node, 'box.height')
    const text = readPath(node, 'text.content')
    const entry: InspectTreeNode = {
      id,
      type: String(node.type ?? ''),
      name: String(node.name ?? ''),
      path: opts.paths ? [...path] : [],
      children: childrenOf(id),
    }
    if (typeof width === 'number') entry.width = width
    if (typeof height === 'number') entry.height = height
    if (typeof text === 'string') entry.text = text
    tree.push(entry)

    for (const childId of childrenOf(id)) {
      visit(childId, [...path, String(node.name ?? '')], depth + 1)
    }
  }
  visit(rootId, [], 0)

  return {
    ok: true,
    command: 'inspect',
    format: doc.version,
    engine: doc.meta.engine ?? '',
    root: rootId,
    counts: {
      nodes: doc.nodes.length,
      byType,
      variables: doc.variables.length,
      variableSets: doc.variableSets.length,
      components,
      instances,
      assets: Object.keys(doc.assets).length,
    },
    tree,
    variables: doc.variables.map((v) => ({
      id: v.id,
      name: v.name,
      type: v.type,
      ...(v.set ? { set: v.set } : {}),
    })),
    variableSets: doc.variableSets.map((s) => ({
      id: s.id,
      name: s.name,
      modes: s.modes.map((m) => m.id),
    })),
    assets: Object.entries(doc.assets).map(([id, asset]) => ({
      id,
      file: asset.file,
      mime: asset.mime,
      bytes: asset.bytes,
    })),
    warnings,
  }
}

/** `od inspect` 的人读输出（规格 §8.3 的形态）。 */
export function formatInspectText(result: InspectResult): string {
  const lines: string[] = []
  lines.push(`od-format ${result.format} · 引擎 ${result.engine}`)

  const byId = new Map(result.tree.map((n) => [n.id, n]))
  const childrenOf = (id: string): string[] => byId.get(id)?.children ?? []

  const render = (id: string, prefix: string, isLast: boolean, isRoot: boolean): void => {
    const node = byId.get(id)
    if (!node) return
    const connector = isRoot ? '' : isLast ? '└─ ' : '├─ '
    const detail: string[] = []
    if (node.width !== undefined && node.height !== undefined) {
      detail.push(`${node.width}×${node.height}`)
    }
    if (node.text !== undefined) detail.push(`"${node.text}"`)
    const suffix = detail.length > 0 ? `  ${detail.join('  ')}` : ''
    lines.push(`${prefix}${connector}${node.name} (${node.type})${suffix}`.padEnd(48) + node.id)

    const kids = childrenOf(id)
    kids.forEach((childId, index) => {
      const childPrefix = isRoot ? '' : `${prefix}${isLast ? '   ' : '│  '}`
      render(childId, childPrefix, index === kids.length - 1, false)
    })
  }
  render(result.root, '', true, true)

  const c = result.counts
  lines.push(
    `统计: 节点 ${c.nodes} · 变量 ${c.variables} · 集合 ${c.variableSets} · 组件 ${c.components} · 实例 ${c.instances} · 资源 ${c.assets}`
  )
  return lines.join('\n')
}

/** 未使用的类型引用（避免 TS 报未使用的导入）。 */
export type { OdNode }
