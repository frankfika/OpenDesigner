/**
 * 编码：引擎文档 → od 文档（规格 §2.8 / §3）。
 *
 * 核心机制：
 * - **恒等映射**：引擎 node id 直接当 odId 用。文件里不存映射表（规格 §2.6）。
 * - **省略规则 E1**：字段值等于该节点类型的引擎默认值 → 省略。
 *   默认值从引擎自己的 `createDefaultNode()` 取，**绝不手抄**（手抄的默认值表是 bug 温床）。
 * - **D1 必丢 / D2 必留**（规格 §3.1.4）：派生缓存剔除；两个 scale 字段必须往返保留。
 * - **引用重映射**：所有「值是 id」的字段在 od 侧一律换成 odId（规格 §3.4）。
 */
import {
  createDefaultNode,
  serializeInstanceOverrideState,
  type NodeType,
  type SceneGraph,
  type SceneNode,
} from '@open-pencil/scene-graph'

import { FIELD_MAP } from './field-map'
import { OdEncodeError } from './errors'
import { IdRegistry, kindOfNodeType, maxDiscriminatorOf, type OdIdKind } from './ids'
import { blobToSvgPath } from './geometry'
import { engineBindingPathToOd } from './paths'
import { OD_FORMAT_PACKAGE_VERSION, OD_FORMAT_VERSION } from './version'
import type { OdDocument, OdNode } from './schema'

/** 引擎包版本，写进 `meta.engine`。 */
const ENGINE_PACKAGE = '@open-pencil/scene-graph@0.16.0'

/** 结构字段（不参与「组」编码，由本文件单独处理）。 */
const STRUCTURAL_FIELDS: ReadonlySet<string> = new Set([
  'id',
  'type',
  'name',
  'parentId',
  'childIds',
])

/** 引擎默认值缓存（按节点类型）。 */
const defaultCache = new Map<string, SceneNode>()

function defaultOf(type: string): SceneNode {
  let d = defaultCache.get(type)
  if (!d) {
    d = createDefaultNode(() => 'x', type as NodeType)
    defaultCache.set(type, d)
  }
  return d
}

/** 编码过程中的 id 映射表。 */
export interface EncodeContext {
  readonly reg: IdRegistry
  /** engineId → odId（节点） */
  readonly nodeIds: Map<string, string>
  /** engineId → odId（变量） */
  readonly varIds: Map<string, string>
  /** engineId → odId（变量集合） */
  readonly colIds: Map<string, string>
  /** engineId → odId（集合模式） */
  readonly modeIds: Map<string, string>
  /** engineId → odId（组件属性） */
  readonly propIds: Map<string, string>
}

/** 深拷贝成 JSON 安全的普通值（保留对象键序，不排序 —— 排序交给写出版本）。 */
function toPlain(value: unknown): unknown {
  // 规则 F2：-0 归一化成 0（语义等价，但 JSON.stringify(-0) 与 0 不可区分，
  // 而 Object.is 会判不等 —— 不归一化就会在往返里变成一次假的「变化」）
  if (typeof value === 'number') return Object.is(value, -0) ? 0 : value
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(toPlain)
  if (value instanceof Uint8Array) {
    throw new OdEncodeError(
      'OD1100',
      '',
      '节点里出现了二进制字段，v0.1 没有这类用例',
      'textPicture 已改判为 D1 派生缓存并剔除；图片走 assets/ 外置'
    )
  }
  if (value instanceof Map) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of value) out[String(k)] = toPlain(v)
    return out
  }
  if (value instanceof Set) return [...value].map(toPlain)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = toPlain(v)
  }
  return out
}

/** 深比较（`Object.is` 语义 → 浮点逐位可比）。 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((x, i) => deepEqual(x, b[i]))
  }
  const ka = Object.keys(a as Record<string, unknown>)
  const kb = Object.keys(b as Record<string, unknown>)
  if (ka.length !== kb.length) return false
  return ka.every((k) =>
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])
  )
}

/** 把值写到 od 对象的点分路径上（自动建中间层）。 */
function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.')
  let cur = target
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!
    let next = cur[key]
    if (typeof next !== 'object' || next === null || Array.isArray(next)) {
      next = {}
      cur[key] = next
    }
    cur = next as Record<string, unknown>
  }
  cur[parts[parts.length - 1]!] = value
}

/** 引擎字段值 → od 值（引用重映射在这里发生）。 */
function encodeField(
  field: string,
  value: unknown,
  ctx: EncodeContext,
  node: SceneNode
): unknown {
  switch (field) {
    case 'source': {
      // 只保留 4 个字段，丢弃 .fig 载荷（规格 §3.3）
      const s = value as Record<string, unknown>
      return {
        format: s.format ?? null,
        id: s.id ?? null,
        orderKey: s.orderKey ?? null,
        editedFields: Array.isArray(s.editedFields) ? [...s.editedFields] : [],
      }
    }

    case 'boundVariables': {
      // Record<引擎字段路径, 变量 engineId> → Record<od 绑定路径, 变量 odId>
      const out: Record<string, unknown> = {}
      const src = value as Record<string, string>
      for (const key of Object.keys(src).sort()) {
        const odPath = engineBindingPathToOd(key) ?? key
        out[odPath] = ctx.varIds.get(src[key]!) ?? src[key]
      }
      return out
    }

    case 'variableBindingScales':
    case 'variableAssignmentScales': {
      // Partial<Record<引擎字段路径, number>> —— 值是**缩放乘数**（不是变量 id）
      const out: Record<string, unknown> = {}
      const src = value as Record<string, number>
      for (const key of Object.keys(src).sort()) {
        const odPath = engineBindingPathToOd(key) ?? key
        out[odPath] = src[key]
      }
      return out
    }

    case 'variableModes': {
      // Record<集合 engineId, 模式 engineId> → odId → odId
      const out: Record<string, unknown> = {}
      const src = value as Record<string, string>
      for (const key of Object.keys(src).sort()) {
        out[ctx.colIds.get(key) ?? key] = ctx.modeIds.get(src[key]!) ?? src[key]
      }
      return out
    }

    case 'componentId': {
      if (value === null || value === undefined) return null
      return ctx.nodeIds.get(value as string) ?? (value as string)
    }

    case 'componentPropertyDefinitions': {
      return (value as Array<Record<string, unknown>>).map((def) => {
        const out = toPlain(def) as Record<string, unknown>
        out.id = ctx.propIds.get(def.id as string) ?? def.id
        return out
      })
    }

    case 'componentPropertyReferences': {
      return (value as Array<Record<string, unknown>>).map((ref) => {
        const out = toPlain(ref) as Record<string, unknown>
        out.propertyId = ctx.propIds.get(ref.propertyId as string) ?? ref.propertyId
        return out
      })
    }

    case 'componentPropertyAssignments': {
      // Record<属性 engineId, 值> —— 键是 odId
      const out: Record<string, unknown> = {}
      const src = value as Record<string, string>
      for (const key of Object.keys(src).sort()) {
        out[ctx.propIds.get(key) ?? key] = src[key]
      }
      return out
    }

    case 'componentPropertyValues': {
      // Record<属性**名称**, 值> —— 键是名称，**不重映射**（引擎语义）
      return toPlain(value)
    }

    case 'variantPropSpecs': {
      return (value as Array<Record<string, unknown>>).map((spec) => {
        const out = toPlain(spec) as Record<string, unknown>
        out.propDefId = ctx.propIds.get(spec.propDefId as string) ?? spec.propDefId
        return out
      })
    }

    case 'fillGeometry':
    case 'strokeGeometry': {
      return (value as Array<Record<string, unknown>>).map((path) => {
        const out: Record<string, unknown> = { windingRule: path.windingRule }
        out.d = blobToSvgPath(path.commandsBlob as Uint8Array)
        if (path.fills !== undefined) out.fills = toPlain(path.fills)
        if (path.fillStyleId !== undefined) out.fillStyleId = path.fillStyleId
        return out
      })
    }

    case 'instanceOverrides': {
      return encodeInstanceOverrides(value as never, ctx)
    }

    default:
      return toPlain(value)
  }
}

/**
 * `instanceOverrides` 的编码（规格 §3.7 / §4.1）。
 *
 * 直接采用上游 `serializeInstanceOverrideState()` 的形状（数组 of tuples + 三态值），
 * **不自创格式** —— 上游已经解决了「Map 里存了 undefined 值在 JSON 里会消失」的问题。
 *
 * 决策 I-2：`descendants` 的键是**拷贝子节点自己的 odId**（与其它节点引用同一套规则）。
 * 决策 I-3：解析不到本地节点的键（库组件的远端 id）单独放进 `external`，**原样保留**。
 */
function encodeInstanceOverrides(
  state: { self: Map<string, unknown>; descendants: Map<string, Map<string, unknown>> },
  ctx: EncodeContext
): Record<string, unknown> {
  const serialized = serializeInstanceOverrideState(state as never)

  const remapValue = (field: string, value: unknown): unknown => {
    if (typeof value !== 'string') return toPlain(value)
    if (field === 'componentId' || field === 'sourceComponentId') {
      return ctx.nodeIds.get(value) ?? value
    }
    if (field.startsWith('boundVariables/')) {
      return ctx.varIds.get(value) ?? value
    }
    return value
  }

  const encodeEntries = (entries: Array<[string, { defined: boolean; value?: unknown }]>) =>
    entries
      .map(([field, holder]) => {
        const value = holder.defined
          ? remapValue(field, holder.value)
          : undefined
        return [field, holder.defined ? { defined: true, value } : { defined: false }] as const
      })
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))

  const self = encodeEntries(serialized.self as never)

  const local: Array<[string, unknown]> = []
  const external: Array<[string, unknown]> = []
  for (const [nodeId, entries] of serialized.descendants as never as Array<
    [string, Array<[string, { defined: boolean; value?: unknown }]>]
  >) {
    const odId = ctx.nodeIds.get(nodeId)
    const encoded = encodeEntries(entries)
    if (odId !== undefined) local.push([odId, encoded])
    else external.push([nodeId, encoded])
  }
  local.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  external.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))

  const out: Record<string, unknown> = { self }
  if (local.length > 0) out.descendants = local
  if (external.length > 0) out.external = external
  return out
}

/** 铸造一个 odId 并登记到 context 的某个命名空间。 */
function mintFor(
  ctx: EncodeContext,
  table: Map<string, string>,
  engineId: string,
  kind: OdIdKind,
  name: string
): string {
  const existing = table.get(engineId)
  if (existing !== undefined) return existing
  const odId = ctx.reg.resolve(engineId, { kind, name })
  table.set(engineId, odId)
  return odId
}

/** 从 rootId 起做前序遍历；孤儿节点按 id 字典序追加在后面（不丢数据）。 */
function preOrderWalk(graph: SceneGraph): SceneNode[] {
  const out: SceneNode[] = []
  const seen = new Set<string>()
  const walk = (id: string): void => {
    if (seen.has(id)) return
    const node = graph.nodes.get(id)
    if (!node) return
    seen.add(id)
    out.push(node)
    for (const childId of node.childIds) walk(childId)
  }
  walk(graph.rootId)
  for (const id of [...graph.nodes.keys()].sort()) walk(id)
  return out
}

/**
 * 把引擎文档编码成 od 文档。
 *
 * @param graph    引擎文档
 * @param registry 可选的语义 ID 注册表（编辑器运行期复用同一个 registry 可保持 odId 稳定）
 */
export function fromEngine(graph: SceneGraph, registry?: IdRegistry): OdDocument {
  const reg = registry ?? new IdRegistry()
  const ctx: EncodeContext = {
    reg,
    nodeIds: new Map(),
    varIds: new Map(),
    colIds: new Map(),
    modeIds: new Map(),
    propIds: new Map(),
  }

  const nodes = preOrderWalk(graph)

  // --- 1. 先把已有的 odId 形态的 id 扫一遍，抬高判别器计数器 ---
  // （否则一个不带 registry 的保存会把 meta.ordinal 写回 0，判别器就会被复用）
  const existingOdIds: string[] = []
  for (const node of nodes) existingOdIds.push(node.id)
  for (const id of graph.variables.keys()) existingOdIds.push(id)
  for (const id of graph.variableCollections.keys()) existingOdIds.push(id)
  for (const collection of graph.variableCollections.values()) {
    for (const mode of collection.modes) existingOdIds.push(mode.modeId)
  }
  reg.restoreOrdinal(maxDiscriminatorOf(existingOdIds))

  // --- 2. 铸造所有实体的 odId（顺序确定 → 同样的输入产生同样的 odId 集合）---
  for (const node of nodes) {
    mintFor(ctx, ctx.nodeIds, node.id, kindOfNodeType(node.type), node.name)
  }
  for (const [id, variable] of graph.variables) {
    mintFor(ctx, ctx.varIds, id, 'var', variable.name)
  }
  for (const [id, collection] of graph.variableCollections) {
    mintFor(ctx, ctx.colIds, id, 'vcol', collection.name)
    for (const mode of collection.modes) {
      mintFor(ctx, ctx.modeIds, mode.modeId, 'mode', mode.name)
    }
  }
  for (const node of nodes) {
    for (const def of node.componentPropertyDefinitions ?? []) {
      mintFor(ctx, ctx.propIds, def.id, 'prop', def.name)
    }
  }

  // --- 3. 编码节点 ---
  const odNodes: OdNode[] = []
  for (const node of nodes) {
    odNodes.push(encodeNode(node, ctx))
  }

  // --- 4. 文档层 ---
  const variables = [...graph.variables.entries()]
    .map(([id, variable]) => {
      const out: Record<string, unknown> = {
        id: ctx.varIds.get(id) ?? id,
        name: variable.name,
        type: variable.type,
      }
      if (variable.collectionId) out.set = ctx.colIds.get(variable.collectionId) ?? variable.collectionId
      if (variable.valuesByMode && Object.keys(variable.valuesByMode).length > 0) {
        const values: Record<string, unknown> = {}
        for (const modeId of Object.keys(variable.valuesByMode).sort()) {
          values[ctx.modeIds.get(modeId) ?? modeId] = encodeVariableValue(
            variable.valuesByMode[modeId],
            ctx
          )
        }
        out.values = values
      }
      if (variable.description) out.description = variable.description
      if (variable.hiddenFromPublishing) out.hidden = true
      if (variable.scopes) out.scopes = [...variable.scopes]
      if (variable.unit) out.unit = variable.unit
      if (variable.expressions && Object.keys(variable.expressions).length > 0) {
        const expressions: Record<string, unknown> = {}
        for (const modeId of Object.keys(variable.expressions).sort()) {
          expressions[ctx.modeIds.get(modeId) ?? modeId] = toPlain(variable.expressions[modeId])
        }
        out.expressions = expressions
      }
      if (variable.codeSyntax) out.codeSyntax = { ...variable.codeSyntax }
      if (variable.pluginData) out.pluginData = toPlain(variable.pluginData)
      if (variable.key) out.key = variable.key
      if (variable.version) out.version = variable.version
      return out
    })
    .sort((a, b) => (a.id as string).localeCompare(b.id as string))

  const variableSets = [...graph.variableCollections.entries()]
    .map(([id, collection]) => {
      const out: Record<string, unknown> = {
        id: ctx.colIds.get(id) ?? id,
        name: collection.name,
        modes: collection.modes.map((mode) => {
          const m: Record<string, unknown> = {
            id: ctx.modeIds.get(mode.modeId) ?? mode.modeId,
            name: mode.name,
          }
          if (mode.condition !== undefined) m.condition = mode.condition
          if (mode.sortPosition !== undefined) m.sortPosition = mode.sortPosition
          return m
        }),
      }
      if (collection.defaultModeId) {
        out.defaultMode = ctx.modeIds.get(collection.defaultModeId) ?? collection.defaultModeId
      }
      if (collection.modeAttribute) out.modeAttribute = collection.modeAttribute
      if (collection.variableIds && collection.variableIds.length > 0) {
        out.variables = collection.variableIds.map((vid) => ctx.varIds.get(vid) ?? vid)
      }
      if (collection.pluginData) out.pluginData = toPlain(collection.pluginData)
      if (collection.key) out.key = collection.key
      if (collection.version) out.version = collection.version
      return out
    })
    .sort((a, b) => (a.id as string).localeCompare(b.id as string))

  const themes: Record<string, unknown> = {}
  const active: Record<string, string> = {}
  for (const collectionId of [...graph.activeMode.keys()].sort()) {
    const modeId = graph.activeMode.get(collectionId)!
    active[ctx.colIds.get(collectionId) ?? collectionId] = ctx.modeIds.get(modeId) ?? modeId
  }
  themes.active = active

  const libraries = [...graph.enabledLibraries.entries()]
    .map(([libraryId, binding]) => ({
      id: binding.libraryId ?? libraryId,
      revision: binding.revisionId,
      enabled: binding.enabled,
    }))
    .sort((a, b) => a.id.localeCompare(b.id))

  // --- 5. assets：图片外置，文件里只留引用 ---
  const assets: Record<string, { file: string; mime: string; bytes: number }> = {}
  for (const hash of [...graph.images.keys()].sort()) {
    const bytes = graph.images.get(hash)!
    assets[hash] = {
      file: `assets/${hash}.png`,
      mime: 'image/png',
      bytes: bytes.byteLength,
    }
  }

  const rootOdId = ctx.nodeIds.get(graph.rootId) ?? graph.rootId

  const doc: OdDocument = {
    format: 'od',
    version: OD_FORMAT_VERSION,
    meta: {
      generator: `od-format@${OD_FORMAT_PACKAGE_VERSION}`,
      engine: ENGINE_PACKAGE,
      colorSpace: graph.documentColorSpace,
      root: rootOdId,
      ordinal: reg.ordinal(),
    },
    nodes: odNodes,
    assets,
    variables: variables as never,
    variableSets: variableSets as never,
    themes: themes as never,
    libraries,
  }

  return doc
}

/** 变量值的判别联合编码（规格 §1.5.1）：别名 / 颜色 / 原始值。 */
function encodeVariableValue(value: unknown, ctx: EncodeContext): unknown {
  if (value === null || value === undefined) return value
  if (typeof value !== 'object') return value
  const obj = value as Record<string, unknown>
  if ('aliasId' in obj && typeof obj.aliasId === 'string') {
    return { alias: ctx.varIds.get(obj.aliasId) ?? obj.aliasId }
  }
  if ('r' in obj && 'g' in obj && 'b' in obj && 'a' in obj) {
    return { r: obj.r, g: obj.g, b: obj.b, a: obj.a }
  }
  return toPlain(value)
}

/** 编码单个节点。 */
function encodeNode(node: SceneNode, ctx: EncodeContext): OdNode {
  const odId = ctx.nodeIds.get(node.id) ?? node.id
  const out: Record<string, unknown> = {
    id: odId,
    type: node.type,
    name: node.name,
  }

  // parent：根节点省略
  if (node.parentId) {
    const parentOd = ctx.nodeIds.get(node.parentId)
    if (parentOd !== undefined) out.parent = parentOd
  }

  // children：按绘制顺序，拷贝子节点照常写入（决策 I-1）
  const children: string[] = []
  for (const childId of node.childIds) {
    const childOd = ctx.nodeIds.get(childId)
    if (childOd !== undefined) children.push(childOd)
  }
  out.children = children

  const defaults = defaultOf(node.type)

  for (const mapping of FIELD_MAP) {
    const field = mapping.engine
    if (STRUCTURAL_FIELDS.has(field)) continue
    if (mapping.od === null) continue // D1 派生缓存，剔除

    const raw = (node as unknown as Record<string, unknown>)[field]
    if (raw === undefined) continue

    const encoded = encodeField(field, raw, ctx, node)
    if (encoded === undefined) continue

    // 省略规则 E1：等于引擎默认值 → 省略
    const defaultRaw = (defaults as unknown as Record<string, unknown>)[field]
    if (defaultRaw !== undefined) {
      const defaultEncoded = encodeField(field, defaultRaw, ctx, node)
      if (deepEqual(encoded, defaultEncoded)) continue
    }

    setPath(out, mapping.od, encoded)
  }

  return out as unknown as OdNode
}
