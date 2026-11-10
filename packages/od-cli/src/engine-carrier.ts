/**
 * `engine` 载体 —— **引擎文档模型的无损 JSON 转储**（规格 §8.2）。
 *
 * 用**引擎自己的字段名**（不做任何重命名 / 分组），供「已经持有引擎文档」的场景使用，
 * 也是往返测试的对照组。
 *
 * 为什么需要它：CLI 契约要求「引擎文档 ⇄ od 文本」双向可转。`engine` 载体让这条链路
 * **只依赖 `@open-pencil/scene-graph`**（不需要 core），因此 v0.1 就能完整实现并测试。
 * `.fig` 是后续增强。
 *
 * 编码规则：
 * - `nodes`：引擎 `SceneNode` 的**完整展开**（154 字段，`undefined` 的键不写）
 * - `Map` → 对象；`Set` → 数组
 * - `Uint8Array` → `{"0":137,"1":80,...}`（JS 原生 JSON 形态）
 * - **派生字段保留**（这是引擎文档的忠实转储，不是 od 格式）
 * - `instanceOverrides` 用引擎自带的三态编解码（`undefined` 值在 JSON 里会消失）
 */
import {
  createDefaultNode,
  deserializeInstanceOverrideState,
  serializeInstanceOverrideState,
  SceneGraph,
  type NodeType,
  type SceneNode,
} from '@open-pencil/scene-graph'

export const ENGINE_CARRIER_KIND = 'openpencil-scene-graph'
export const ENGINE_CARRIER_VERSION = 1

/** 二进制 → JS 原生 JSON 形态（`{"0":137,...}`）。 */
function binaryToJson(bytes: Uint8Array): Record<string, number> {
  const out: Record<string, number> = {}
  for (let i = 0; i < bytes.length; i++) out[String(i)] = bytes[i]!
  return out
}

/** JS 原生 JSON 形态 → 二进制。 */
function jsonToBinary(value: unknown): Uint8Array {
  if (!value || typeof value !== 'object') return new Uint8Array(0)
  const keys = Object.keys(value as Record<string, unknown>)
    .map((k) => Number(k))
    .filter((n) => Number.isInteger(n) && n >= 0)
    .sort((a, b) => a - b)
  const out = new Uint8Array(keys.length)
  keys.forEach((n, i) => {
    out[i] = Number((value as Record<string, unknown>)[String(n)])
  })
  return out
}

/** 任意值 → JSON 安全的普通值（保留引擎字段名）。 */
function toCarrierValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (value instanceof Uint8Array) return binaryToJson(value)
  if (Array.isArray(value)) return value.map(toCarrierValue)
  if (value instanceof Map) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of value) out[String(k)] = toCarrierValue(v)
    return out
  }
  if (value instanceof Set) return [...value].map(toCarrierValue)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined) continue
    out[k] = toCarrierValue(v)
  }
  return out
}

export interface EngineCarrierNode {
  id: string
  type: string
  [key: string]: unknown
}

export interface EngineCarrier {
  kind: typeof ENGINE_CARRIER_KIND
  version: number
  rootId: string
  nodes: EngineCarrierNode[]
  images: Record<string, Record<string, number>>
  variables: Array<Record<string, unknown>>
  variableCollections: Array<Record<string, unknown>>
  activeMode: Record<string, string>
  documentColorSpace: string
  enabledLibraries: Array<Record<string, unknown>>
}

/** 引擎文档 → `engine` 载体。 */
export function dumpEngine(graph: SceneGraph): EngineCarrier {
  const nodes: EngineCarrierNode[] = []
  for (const node of graph.nodes.values()) {
    const plain = toCarrierValue(node) as Record<string, unknown>
    // instanceOverrides 用引擎的三态编解码 —— 普通对象化会丢掉 undefined 值
    plain.instanceOverrides = serializeInstanceOverrideState(node.instanceOverrides)
    nodes.push(plain as EngineCarrierNode)
  }

  const images: Record<string, Record<string, number>> = {}
  for (const [hash, bytes] of graph.images) images[hash] = binaryToJson(bytes)

  return {
    kind: ENGINE_CARRIER_KIND,
    version: ENGINE_CARRIER_VERSION,
    rootId: graph.rootId,
    nodes,
    images,
    variables: [...graph.variables.values()].map((v) => toCarrierValue(v) as Record<string, unknown>),
    variableCollections: [...graph.variableCollections.values()].map(
      (c) => toCarrierValue(c) as Record<string, unknown>
    ),
    activeMode: Object.fromEntries(graph.activeMode),
    documentColorSpace: graph.documentColorSpace,
    enabledLibraries: [...graph.enabledLibraries.values()].map(
      (l) => toCarrierValue(l) as Record<string, unknown>
    ),
  }
}

/** `engine` 载体 → 引擎文档。 */
export function loadEngine(carrier: EngineCarrier): SceneGraph {
  let counter = 0
  const graph = new SceneGraph(() => `carrier-${++counter}`)
  graph.nodes.clear()

  for (const node of carrier.nodes) {
    const { id, type, ...rest } = node
    const overrides: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(rest)) {
      if (v === undefined) continue
      overrides[k] = k === 'instanceOverrides' ? deserializeInstanceOverrideState(v) : v
    }
    // 用引擎自己的默认节点补齐没写出来的字段
    const base = createDefaultNode(() => id, type as NodeType)
    for (const [k, v] of Object.entries(base as unknown as Record<string, unknown>)) {
      if (v !== undefined && !(k in overrides)) overrides[k] = v
    }
    graph.createNodeWithId(id, type as NodeType, null, overrides as never)
  }

  // `registerNode` 会把 `node.parentId` 覆盖成 null（我们建节点时传的是 null），
  // `childIds` 也不会被填充 —— 所以父子关系必须在建完之后按载体还原。
  for (const node of carrier.nodes) {
    const created = graph.nodes.get(node.id)
    if (!created) continue
    if (typeof node.parentId === 'string') created.parentId = node.parentId
  }
  for (const node of graph.nodes.values()) node.childIds = []
  for (const node of carrier.nodes) {
    const created = graph.nodes.get(node.id)
    if (!created) continue
    if (Array.isArray(node.childIds)) {
      created.childIds = node.childIds.filter((c): c is string => typeof c === 'string')
    }
  }

  for (const [hash, bytes] of Object.entries(carrier.images ?? {})) {
    graph.images.set(hash, jsonToBinary(bytes))
  }
  for (const variable of carrier.variables ?? []) {
    graph.variables.set(variable.id as string, variable as never)
  }
  for (const collection of carrier.variableCollections ?? []) {
    graph.variableCollections.set(collection.id as string, collection as never)
  }
  for (const [collectionId, modeId] of Object.entries(carrier.activeMode ?? {})) {
    graph.activeMode.set(collectionId, modeId)
  }
  for (const library of carrier.enabledLibraries ?? []) {
    graph.enabledLibraries.set(library.libraryId as string, library as never)
  }
  if (carrier.documentColorSpace) {
    graph.documentColorSpace = carrier.documentColorSpace as never
  }
  graph.rootId = carrier.rootId

  return graph
}

/** 判断一个 JSON 值是不是 `engine` 载体。 */
export function isEngineCarrier(value: unknown): value is EngineCarrier {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return obj.kind === ENGINE_CARRIER_KIND && typeof obj.rootId === 'string'
}

/** 取引擎节点（供测试用）。 */
export function nodeOf(graph: SceneGraph, id: string): SceneNode | undefined {
  return graph.nodes.get(id)
}
