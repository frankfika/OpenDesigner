/**
 * 解码：od 文档 → 引擎文档（规格 §2.7）。
 *
 * 加载路径：
 *  1. 建 SceneGraph，**清掉构造器自带的 root + "Page 1"**（否则文件里会多出两截内容）
 *  2. 第 1 遍：按文件顺序 `createNodeWithId(odId, ...)` —— 只写**非引用**字段
 *  3. 第 2 遍：所有节点建完后，写入全部**引用**字段（组件主组件、绑定、override）
 *  4. 文档层：variables / variableCollections / activeMode / images / enabledLibraries / colorSpace
 *  5. 恢复判别器计数器：`max(doc.meta.ordinal, 文件里出现过的最大判别器)`
 *
 * **两遍建图是必须的**：组件定义在根、实例在页面深处时，`component.main` 会指向
 * 还没建出来的节点（规格 §4.1.4）。
 */
import {
  deserializeInstanceOverrideState,
  SceneGraph,
  type SceneNode,
} from '@open-pencil/scene-graph'

import { FIELD_MAP } from './field-map'
import { OdDecodeError } from './errors'
import { IdRegistry, maxDiscriminatorOf } from './ids'
import { svgPathToBlob } from './geometry'
import { odBindingPathToEngine } from './paths'
import type { OdDocument, OdNode } from './schema'

/** 需要在**第 2 遍**写入的引用字段。 */
const PASS2_FIELDS: ReadonlySet<string> = new Set([
  'componentId',
  'instanceOverrides',
  'boundVariables',
  'variableModes',
])

/** od 路径 → 引擎字段名（FIELD_MAP 的反向索引）。 */
const OD_PATH_TO_ENGINE: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>()
  for (const mapping of FIELD_MAP) {
    if (mapping.od === null) continue
    if (!m.has(mapping.od)) m.set(mapping.od, mapping.engine)
  }
  return m
})()

export interface ToEngineOptions {
  /**
   * ID 策略。默认 `'od'` —— **恒等映射**：odId 直接当引擎 node id 用。
   * `'native'` 让引擎分配原生 id（为将来的 `.fig` 通路预留），odId 保留在 registry 里。
   */
  idStrategy?: 'od' | 'native'
  /**
   * 布局回调。od-format **不依赖 @open-pencil/core**，因此**不运行布局**。
   * 调用方（core 可用的环境）应注入 core 的布局函数。
   * 注意：这**不影响 od 文件** —— 几何是一律照存的（规则 G），文件里始终有正确几何。
   */
  layout?: (graph: SceneGraph) => void
  /** 外部资源（assets/ 目录里的图片字节）。od 文件只存引用，字节由调用方提供。 */
  assets?: ReadonlyMap<string, Uint8Array>
}

export interface ToEngineResult {
  graph: SceneGraph
  registry: IdRegistry
}

/** 把 od 节点里的点分路径读出来（返回 undefined 表示该路径不存在）。 */
function getPath(source: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.')
  let cur: unknown = source
  for (const part of parts) {
    if (cur === null || typeof cur !== 'object' || Array.isArray(cur)) return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

/** 引擎字段名 → od 路径（反向索引）。 */
const ENGINE_TO_OD_PATH: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>()
  for (const mapping of FIELD_MAP) {
    if (mapping.od === null) continue
    if (!m.has(mapping.engine)) m.set(mapping.engine, mapping.od)
  }
  return m
})()

/**
 * 把引擎文档从 od 文档还原出来。
 */
export function toEngine(doc: OdDocument, opts: ToEngineOptions = {}): ToEngineResult {
  const strategy = opts.idStrategy ?? 'od'
  const registry = new IdRegistry()

  // --- 0. 收集所有 odId，恢复判别器计数器 ---
  const allOdIds: string[] = []
  for (const node of doc.nodes) allOdIds.push(node.id)
  for (const variable of doc.variables) allOdIds.push(variable.id)
  for (const set of doc.variableSets) {
    allOdIds.push(set.id)
    for (const mode of set.modes) allOdIds.push(mode.id)
  }
  for (const node of doc.nodes) {
    const props = (node.component as { properties?: Array<{ id?: unknown }> } | undefined)
      ?.properties
    for (const def of props ?? []) {
      if (typeof def?.id === 'string') allOdIds.push(def.id)
    }
  }
  registry.restoreOrdinal(Math.max(doc.meta.ordinal ?? 0, maxDiscriminatorOf(allOdIds)))

  // --- 1. 建图 ---
  let nativeCounter = 0
  const graph = new SceneGraph(() => `n${++nativeCounter}`)
  // 构造器已经消耗了 2 个 id（root FRAME + "Page 1"）—— MUST 清掉
  graph.nodes.clear()

  // odId → 引擎 node id。'od' 策略是恒等映射；'native' 策略分配原生 id。
  const engineIdOf = new Map<string, string>()
  for (const odId of allOdIds) {
    const engineId = strategy === 'od' ? odId : `n${++nativeCounter}`
    engineIdOf.set(odId, engineId)
    registry.bind(engineId, odId)
  }

  const engineIdFor = (odId: string): string => engineIdOf.get(odId) ?? odId

  // --- 2. 第 1 遍：建节点（只写非引用字段）---
  const seen = new Set<string>()
  for (const odNode of doc.nodes) {
    if (seen.has(odNode.id)) {
      throw new OdDecodeError(
        'OD1103',
        `nodes[${doc.nodes.indexOf(odNode)}].id`,
        `odId 重复："${odNode.id}"`,
        'createNodeWithId 不查重，重复 id 会静默覆盖 —— od-format 必须自己查重'
      )
    }
    seen.add(odNode.id)

    const props = decodeNodeProps(odNode, engineIdFor)
    const engineId = engineIdFor(odNode.id)
    try {
      graph.createNodeWithId(engineId, odNode.type as never, null, props)
    } catch (error) {
      throw new OdDecodeError(
        'OD1100',
        `nodes[${doc.nodes.indexOf(odNode)}]`,
        `建节点失败：${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  // --- 3. 补父子关系（以文件里的 children 数组为权威顺序）---
  for (const odNode of doc.nodes) {
    const node = graph.nodes.get(engineIdFor(odNode.id))
    if (!node) continue
    const parentOd = odNode.parent
    node.parentId = parentOd ? engineIdFor(parentOd) : null
  }
  // 重建 childIds：按文件里 children 的顺序
  for (const node of graph.nodes.values()) node.childIds = []
  for (const odNode of doc.nodes) {
    const node = graph.nodes.get(engineIdFor(odNode.id))
    if (!node) continue
    for (const childOd of odNode.children) {
      const child = graph.nodes.get(engineIdFor(childOd))
      if (child) node.childIds.push(child.id)
    }
  }

  // --- 4. 第 2 遍：写引用字段 ---
  for (const odNode of doc.nodes) {
    const node = graph.nodes.get(engineIdFor(odNode.id))
    if (!node) continue
    const path = `nodes[${doc.nodes.indexOf(odNode)}]`
    decodeReferenceFields(node, odNode, engineIdFor, path, graph)
  }

  // --- 5. 文档层 ---
  decodeDocumentLayer(doc, graph, engineIdFor, opts.assets)

  // 根节点
  graph.rootId = engineIdFor(doc.meta.root)

  // 布局趟（由调用方注入 —— od-format 自己不跑布局）
  opts.layout?.(graph)

  return { graph, registry }
}

/** 解码节点的**非引用**字段（作为 createNodeWithId 的 overrides）。 */
function decodeNodeProps(
  odNode: OdNode,
  engineIdFor: (odId: string) => string
): Record<string, unknown> {
  const props: Record<string, unknown> = {}
  for (const mapping of FIELD_MAP) {
    const field = mapping.engine
    // id 由 createNodeWithId 决定、type 是参数 —— 但 name 必须在 overrides 里带上，
    // 否则节点名会退回引擎默认值（'Frame' 而不是作者写的 'Document'）
    if (field === 'id' || field === 'type') continue
    if (field === 'parentId' || field === 'childIds') continue
    if (mapping.od === null) continue // D1：不重建，重算
    if (PASS2_FIELDS.has(field)) continue

    const raw = getPath(odNode as unknown as Record<string, unknown>, mapping.od)
    if (raw === undefined) continue

    props[field] = decodeField(field, raw, engineIdFor)
  }
  return props
}

/** 解码引用字段（第 2 遍）。 */
function decodeReferenceFields(
  node: SceneNode,
  odNode: OdNode,
  engineIdFor: (odId: string) => string,
  path: string,
  graph: SceneGraph
): void {
  const src = odNode as unknown as Record<string, unknown>

  // component.main → componentId
  const componentMain = getPath(src, 'component.main')
  if (componentMain !== undefined) {
    if (componentMain === null) {
      node.componentId = null
    } else if (typeof componentMain === 'string') {
      const target = engineIdFor(componentMain)
      if (!graph.nodes.has(target)) {
        // 目标不在本文档里（跨文档引用，v0.1 不支持）—— 保留原值，交给 validate 报错
        node.componentId = componentMain
      } else {
        node.componentId = target
        registerInstance(graph, node, target)
      }
    }
  }

  // bindings.fields → boundVariables
  const bindingsFields = getPath(src, 'bindings.fields')
  if (bindingsFields && typeof bindingsFields === 'object') {
    const out: Record<string, string> = {}
    for (const [odPath, varId] of Object.entries(bindingsFields as Record<string, unknown>)) {
      const enginePath = odBindingPathToEngine(odPath) ?? odPath
      out[enginePath] = typeof varId === 'string' ? engineIdFor(varId) : String(varId)
    }
    node.boundVariables = out
  }

  // bindings.scales → variableBindingScales（D2 必留）
  const scales = getPath(src, 'bindings.scales')
  if (scales && typeof scales === 'object') {
    const out: Record<string, number> = {}
    for (const [odPath, scale] of Object.entries(scales as Record<string, unknown>)) {
      const enginePath = odBindingPathToEngine(odPath) ?? odPath
      out[enginePath] = Number(scale)
    }
    node.variableBindingScales = out
  }

  // bindings.assignmentScales → variableAssignmentScales（D2 必留）
  const assignmentScales = getPath(src, 'bindings.assignmentScales')
  if (assignmentScales && typeof assignmentScales === 'object') {
    const out: Record<string, number> = {}
    for (const [odPath, scale] of Object.entries(assignmentScales as Record<string, unknown>)) {
      const enginePath = odBindingPathToEngine(odPath) ?? odPath
      out[enginePath] = Number(scale)
    }
    node.variableAssignmentScales = out
  }

  // bindings.modes → variableModes
  const modes = getPath(src, 'bindings.modes')
  if (modes && typeof modes === 'object') {
    const out: Record<string, string> = {}
    for (const [colOd, modeOd] of Object.entries(modes as Record<string, unknown>)) {
      out[engineIdFor(colOd)] = engineIdFor(String(modeOd))
    }
    node.variableModes = out
  }

  // component.overrides → instanceOverrides
  const overrides = getPath(src, 'component.overrides')
  if (overrides !== undefined) {
    node.instanceOverrides = decodeInstanceOverrides(overrides, engineIdFor, path)
  }
}

/**
 * 把实例登记进 `instanceIndex`（镜像引擎 `registerNode` 的行为）。
 *
 * 为什么需要手工补：引擎只在 `createNodeWithId` 的那一刻登记实例，而那时主组件
 * 可能还没建出来（两遍建图）。不补这一笔，`getInstances(componentId)` 会漏掉实例。
 */
function registerInstance(graph: SceneGraph, node: SceneNode, componentId: string): void {
  let set = graph.instanceIndex.get(componentId)
  if (!set) {
    set = new Set<string>()
    graph.instanceIndex.set(componentId, set)
  }
  set.add(node.id)
}

/** 解码 `instanceOverrides`（规格 §3.7 / §4.1）。 */
function decodeInstanceOverrides(
  raw: unknown,
  engineIdFor: (odId: string) => string,
  _path: string
): ReturnType<typeof deserializeInstanceOverrideState> {
  const src = (raw ?? {}) as {
    self?: Array<[string, { defined: boolean; value?: unknown }]>
    descendants?: Array<[string, Array<[string, { defined: boolean; value?: unknown }]>]>
    external?: Array<[string, Array<[string, { defined: boolean; value?: unknown }]>]>
  }

  // 必须还原成上游的三态形状 `{ defined, value }` ——
  // `deserializeOverrideValue` 认这个形状，直接传裸值会被判 invalid 而**整条丢弃**。
  const entries = (list: Array<[string, { defined: boolean; value?: unknown }]> | undefined) =>
    (list ?? []).map(
      ([field, holder]) =>
        [
          field,
          holder?.defined ? { defined: true, value: holder.value } : { defined: false },
        ] as [string, unknown]
    )

  const self = entries(src.self)
  const descendants: Array<[string, unknown]> = []
  for (const [key, list] of src.descendants ?? []) {
    descendants.push([engineIdFor(key), entries(list)])
  }
  // `external`（库组件的远端 id）原样保留 —— 引擎的 state 只有 self + descendants，
  // 放进 descendants 后，编码时因为解析不到本地节点，会自动回到 external。
  for (const [key, list] of src.external ?? []) {
    descendants.push([key, entries(list)])
  }

  return deserializeInstanceOverrideState({ self, descendants })
}

/** 解码单个字段值。 */
function decodeField(
  field: string,
  raw: unknown,
  engineIdFor: (odId: string) => string
): unknown {
  switch (field) {
    case 'source': {
      const s = raw as Record<string, unknown>
      return {
        format: (s.format ?? null) as never,
        id: (s.id ?? null) as never,
        orderKey: (s.orderKey ?? null) as never,
        editedFields: Array.isArray(s.editedFields) ? [...s.editedFields] : [],
        fig: (s as { fig?: unknown }).fig ?? { type: 'NONE' },
      } as unknown
    }

    case 'boundVariables': {
      const out: Record<string, string> = {}
      for (const [odPath, varId] of Object.entries(raw as Record<string, unknown>)) {
        const enginePath = odBindingPathToEngine(odPath) ?? odPath
        out[enginePath] = engineIdFor(String(varId))
      }
      return out
    }

    case 'variableBindingScales':
    case 'variableAssignmentScales': {
      const out: Record<string, number> = {}
      for (const [odPath, scale] of Object.entries(raw as Record<string, unknown>)) {
        const enginePath = odBindingPathToEngine(odPath) ?? odPath
        out[enginePath] = Number(scale)
      }
      return out
    }

    case 'variableModes': {
      const out: Record<string, string> = {}
      for (const [colOd, modeOd] of Object.entries(raw as Record<string, unknown>)) {
        out[engineIdFor(colOd)] = engineIdFor(String(modeOd))
      }
      return out
    }

    case 'componentId':
      return raw === null ? null : engineIdFor(String(raw))

    case 'componentPropertyDefinitions': {
      return (raw as Array<Record<string, unknown>>).map((def) => ({
        ...def,
        id: engineIdFor(String(def.id)),
      }))
    }

    case 'componentPropertyReferences': {
      return (raw as Array<Record<string, unknown>>).map((ref) => ({
        ...ref,
        propertyId: engineIdFor(String(ref.propertyId)),
      }))
    }

    case 'componentPropertyAssignments': {
      const out: Record<string, string> = {}
      for (const [propOd, value] of Object.entries(raw as Record<string, unknown>)) {
        out[engineIdFor(propOd)] = String(value)
      }
      return out
    }

    case 'componentPropertyValues':
      return raw

    case 'variantPropSpecs': {
      return (raw as Array<Record<string, unknown>>).map((spec) => ({
        ...spec,
        propDefId: engineIdFor(String(spec.propDefId)),
      }))
    }

    case 'fillGeometry':
    case 'strokeGeometry': {
      return (raw as Array<Record<string, unknown>>).map((path) => {
        const out: Record<string, unknown> = {
          windingRule: path.windingRule,
          commandsBlob: svgPathToBlob(String(path.d ?? '')),
        }
        if (path.fills !== undefined) out.fills = path.fills
        if (path.fillStyleId !== undefined) out.fillStyleId = path.fillStyleId
        return out
      })
    }

    default:
      return raw
  }
}

/** 解码文档层。 */
function decodeDocumentLayer(
  doc: OdDocument,
  graph: SceneGraph,
  engineIdFor: (odId: string) => string,
  assets?: ReadonlyMap<string, Uint8Array>
): void {
  // 变量
  for (const variable of doc.variables) {
    const valuesByMode: Record<string, unknown> = {}
    for (const [modeOd, value] of Object.entries(variable.values ?? {})) {
      valuesByMode[engineIdFor(modeOd)] = decodeVariableValue(value, engineIdFor)
    }
    graph.variables.set(engineIdFor(variable.id), {
      id: engineIdFor(variable.id),
      name: variable.name,
      type: variable.type as never,
      collectionId: variable.set ? engineIdFor(variable.set) : '',
      valuesByMode: valuesByMode as never,
      description: variable.description ?? '',
      hiddenFromPublishing: variable.hidden ?? false,
      ...(variable.scopes ? { scopes: variable.scopes as never } : {}),
      ...(variable.unit ? { unit: variable.unit as never } : {}),
      ...(variable.expressions ? { expressions: variable.expressions as never } : {}),
      ...(variable.codeSyntax ? { codeSyntax: variable.codeSyntax as never } : {}),
      ...(variable.pluginData ? { pluginData: variable.pluginData as never } : {}),
      ...(variable.key ? { key: variable.key } : {}),
      ...(variable.version ? { version: variable.version } : {}),
    } as never)
  }

  // 变量集合
  for (const set of doc.variableSets) {
    graph.variableCollections.set(engineIdFor(set.id), {
      id: engineIdFor(set.id),
      name: set.name,
      modes: set.modes.map((mode) => ({
        modeId: engineIdFor(mode.id),
        name: mode.name,
        ...(mode.condition !== undefined ? { condition: mode.condition } : {}),
        ...(mode.sortPosition !== undefined ? { sortPosition: mode.sortPosition } : {}),
      })),
      defaultModeId: set.defaultMode ? engineIdFor(set.defaultMode) : '',
      variableIds: (set.variables ?? []).map((v) => engineIdFor(v)),
      ...(set.modeAttribute ? { modeAttribute: set.modeAttribute } : {}),
      ...(set.pluginData ? { pluginData: set.pluginData as never } : {}),
      ...(set.key ? { key: set.key } : {}),
      ...(set.version ? { version: set.version } : {}),
    } as never)
  }

  // 主题当前状态
  for (const [colOd, modeOd] of Object.entries(doc.themes?.active ?? {})) {
    graph.activeMode.set(engineIdFor(colOd), engineIdFor(modeOd))
  }

  // 外部库绑定
  for (const library of doc.libraries) {
    graph.enabledLibraries.set(library.id, {
      libraryId: library.id,
      revisionId: library.revision,
      enabled: library.enabled,
    })
  }

  // 图片资源（字节由调用方提供 —— od 文件只存引用）
  if (assets) {
    for (const [hash, bytes] of assets) {
      graph.images.set(hash, bytes)
    }
  }

  // 文档色彩空间
  if (doc.meta.colorSpace) {
    graph.documentColorSpace = doc.meta.colorSpace as never
  }
}

/** 变量值的判别联合解码（规格 §1.5.1）。 */
function decodeVariableValue(value: unknown, engineIdFor: (odId: string) => string): unknown {
  if (value === null || value === undefined) return value
  if (typeof value !== 'object') return value
  const obj = value as Record<string, unknown>
  if ('alias' in obj && typeof obj.alias === 'string') {
    return { aliasId: engineIdFor(obj.alias) }
  }
  if ('r' in obj && 'g' in obj && 'b' in obj && 'a' in obj) {
    return { r: obj.r, g: obj.g, b: obj.b, a: obj.a }
  }
  return value
}
