/**
 * od-ops 的应用逻辑 —— **安全边界的实现处**。
 *
 * 四条不变量（每条都有测试兜着）：
 *
 * 1. **原子性**：任何一个 op 失败 → 整批不生效，返回原文档的**深拷贝**。
 * 2. **纯函数**：绝不修改传入的 doc（先深拷贝再改）。
 * 3. **结构自洽**：`parent` 指针与父节点的 `children` 数组始终一致。
 * 4. **兜底校验**：全部 op 应用完后跑 `validate(doc)`；出现 error 级问题 → 整批回滚。
 *
 * op 作用在 **od 文档**上（不是引擎文档）—— agent 面向的是 od 文本文件。
 */
import {
  FIELD_VALUE_KINDS,
  IdRegistry,
  engineBindingPathToOd,
  isValidOdBindingPath,
  kindOfNodeType,
  maxDiscriminatorOf,
  odBindingPathToEngine,
  validate,
  type OdDocument,
  type OdNode,
} from '@opendesigner/od-format'

import {
  isContainerNodeType,
  isSupportedNodeType,
  STRUCTURAL_NODE_KEYS,
  type ApplyOpsOptions,
  type OdOp,
  type OpApplyResult,
  type OpIssue,
} from './types'

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

type Loose = Record<string, unknown>

/** 深拷贝（od 文档是纯 JSON 数据；structuredClone 更快，失败时退回 JSON 往返）。 */
function deepClone<T>(value: T): T {
  try {
    return structuredClone(value)
  } catch {
    return JSON.parse(JSON.stringify(value)) as T
  }
}

function isPlainObject(value: unknown): value is Loose {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 节点 id → 节点。 */
function indexNodes(doc: OdDocument): Map<string, OdNode> {
  const map = new Map<string, OdNode>()
  for (const node of doc.nodes) map.set(node.id, node)
  return map
}

/** 把 index 夹到 [0, len]。 */
function clampIndex(index: number | undefined, len: number): number {
  if (index === undefined || !Number.isFinite(index)) return len
  const i = Math.trunc(index)
  if (i < 0) return 0
  if (i > len) return len
  return i
}

/** 应用上下文（工作副本 + 索引 + registry）。 */
interface Ctx {
  doc: OdDocument
  byId: Map<string, OdNode>
  registry: IdRegistry
  /** 是否发生过 insert（决定要不要刷新 meta.ordinal）。 */
  inserted: boolean
}

/** 构造 registry：优先用调用方的；否则内部建一个并登记文档里已有的 odId。 */
function resolveRegistry(doc: OdDocument, provided: IdRegistry | undefined): IdRegistry {
  if (provided) return provided
  const registry = new IdRegistry()
  for (const node of doc.nodes) {
    try {
      registry.adopt(node.id)
    } catch {
      /* 重复 id —— 文档本身有问题，交给 validate 报 */
    }
  }
  registry.restoreOrdinal(Math.max(doc.meta.ordinal ?? 0, maxDiscriminatorOf(doc.nodes.map((n) => n.id))))
  return registry
}

/**
 * 铸造一个新 odId。
 *
 * 用 `registry.mint()`，保证判别器单调递增、base 不复用（od-format §2.5 / §2.9）。
 * 调用方的 registry 可能没登记文档里已有的 id —— 所以铸出来还要跟文档现有 id 查重。
 */
function allocateId(ctx: Ctx, type: string, name: string): string {
  const kind = kindOfNodeType(type)
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const id = ctx.registry.mint({ kind, name })
    if (!ctx.byId.has(id)) return id
  }
  throw new Error('od-ops: 无法分配唯一的 odId')
}

/** 收集整棵子树的 id（含自己），父在前。 */
function collectSubtree(byId: Map<string, OdNode>, rootId: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const stack: string[] = [rootId]
  while (stack.length > 0) {
    const id = stack.pop() as string
    if (seen.has(id)) continue
    seen.add(id)
    const node = byId.get(id)
    if (!node) continue
    out.push(id)
    for (const child of node.children ?? []) stack.push(child)
  }
  return out
}

/** `candidate` 是否是 `ancestorId` 的后代（含自己）。 */
function isDescendantOf(byId: Map<string, OdNode>, ancestorId: string, candidate: string): boolean {
  let cur: OdNode | undefined = byId.get(candidate)
  const seen = new Set<string>()
  while (cur && cur.parent) {
    if (cur.parent === ancestorId) return true
    if (seen.has(cur.parent)) return false
    seen.add(cur.parent)
    cur = byId.get(cur.parent)
  }
  return false
}

// ---------------------------------------------------------------------------
// 值类型检查（set）
// ---------------------------------------------------------------------------

/** 带下标的颜色路径：`fills.0.color` / `strokes.1.color`。 */
const COLOR_PATH_RE = /^(?:fills|strokes)\.(\d+)\.color$/

/** 把 `#rgb` / `#rrggbb` / `#rrggbbaa` 转成引擎的 RGBA。 */
function hexToRgba(hex: string): { r: number; g: number; b: number; a: number } | undefined {
  const m = /^#([0-9a-f]{3,8})$/i.exec(hex.trim())
  if (!m) return undefined
  const body = m[1] as string
  const expand = (s: string): number => parseInt(s.length === 1 ? s + s : s, 16)
  if (body.length === 3 || body.length === 4) {
    const r = expand(body[0] as string)
    const g = expand(body[1] as string)
    const b = expand(body[2] as string)
    const a = body.length === 4 ? expand(body[3] as string) / 255 : 1
    return { r, g, b, a }
  }
  if (body.length === 6 || body.length === 8) {
    const r = parseInt(body.slice(0, 2), 16) / 255
    const g = parseInt(body.slice(2, 4), 16) / 255
    const b = parseInt(body.slice(4, 6), 16) / 255
    const a = body.length === 8 ? parseInt(body.slice(6, 8), 16) / 255 : 1
    return { r, g, b, a }
  }
  return undefined
}

/** 把值规整成引擎的 RGBA 形状；不成形状返回 undefined。 */
function toRgba(value: unknown): { r: number; g: number; b: number; a: number } | undefined {
  if (typeof value === 'string') return hexToRgba(value)
  if (!isPlainObject(value)) return undefined
  const r = value['r']
  const g = value['g']
  const b = value['b']
  const a = value['a']
  if (typeof r !== 'number' || typeof g !== 'number' || typeof b !== 'number') return undefined
  return { r, g, b, a: typeof a === 'number' ? a : 1 }
}

/**
 * 检查值是否符合该路径的预期类型；返回规整后的值。
 *
 * 预期类型来自 od-format 的字段表（`FIELD_VALUE_KINDS`），**不手抄**。
 */
function normalizeValue(
  odPath: string,
  value: unknown
): { ok: true; value: unknown } | { ok: false; message: string } {
  if (COLOR_PATH_RE.test(odPath)) {
    const rgba = toRgba(value)
    if (!rgba) {
      return {
        ok: false,
        message: `${odPath} 的值必须是 RGBA 对象 {r,g,b,a} 或十六进制字符串（如 "#ff0000"）`,
      }
    }
    return { ok: true, value: rgba }
  }

  const engineField = odBindingPathToEngine(odPath)
  const kind = engineField ? FIELD_VALUE_KINDS[engineField] : undefined
  switch (kind) {
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return { ok: false, message: `${odPath} 的值必须是有限数字，收到 ${JSON.stringify(value)}` }
      }
      return { ok: true, value }
    case 'string':
    case 'enum':
      if (typeof value !== 'string') {
        return { ok: false, message: `${odPath} 的值必须是字符串，收到 ${JSON.stringify(value)}` }
      }
      return { ok: true, value }
    case 'boolean':
      if (typeof value !== 'boolean') {
        return { ok: false, message: `${odPath} 的值必须是布尔，收到 ${JSON.stringify(value)}` }
      }
      return { ok: true, value }
    case 'literal-union':
      if (!['number', 'string', 'boolean'].includes(typeof value)) {
        return { ok: false, message: `${odPath} 的值必须是数字 / 字符串 / 布尔` }
      }
      return { ok: true, value }
    case 'null':
      if (value !== null) {
        return { ok: false, message: `${odPath} 的值必须是 null` }
      }
      return { ok: true, value }
    default:
      return { ok: true, value }
  }
}

/**
 * 把值写进 od 节点的指定路径（点分：`box.width` / `fills.0.color`）。
 *
 * 缺失的中间对象会被创建（`box` 不存在就建 `box`）；
 * 数组下标越界则报错（不臆造数组元素）。
 */
function writeAtPath(
  node: Loose,
  segments: string[],
  value: unknown
): { ok: true } | { ok: false; message: string } {
  let container: Loose | unknown[] = node

  for (let i = 0; i < segments.length - 1; i += 1) {
    const seg = segments[i] as string
    const next = segments[i + 1] as string
    if (Array.isArray(container)) {
      const index = Number(seg)
      if (!Number.isInteger(index) || index < 0 || index >= container.length) {
        return { ok: false, message: `路径 "${segments.join('.')}" 的数组下标 ${seg} 越界` }
      }
      container = container[index] as Loose
      continue
    }
    if (!isPlainObject(container)) {
      return { ok: false, message: `路径 "${segments.join('.')}" 的中间层不是对象` }
    }
    const current = container[seg]
    if (current === undefined || current === null) {
      if (/^\d+$/.test(next)) {
        return {
          ok: false,
          message: `路径 "${segments.join('.')}" 指向的数组 "${seg}" 不存在，无法定位第 ${next} 项`,
        }
      }
      container[seg] = {}
    }
    container = container[seg] as Loose | unknown[]
  }

  const last = segments[segments.length - 1] as string
  if (Array.isArray(container)) {
    const index = Number(last)
    if (!Number.isInteger(index) || index < 0 || index >= container.length) {
      return { ok: false, message: `路径 "${segments.join('.')}" 的数组下标 ${last} 越界` }
    }
    container[index] = value
    return { ok: true }
  }
  if (!isPlainObject(container)) {
    return { ok: false, message: `路径 "${segments.join('.')}" 的中间层不是对象` }
  }
  container[last] = value
  return { ok: true }
}

// ---------------------------------------------------------------------------
// 单个 op 的实现
// ---------------------------------------------------------------------------

function fail(code: string, message: string, path?: string): OpIssue {
  return path === undefined ? { index: -1, code, message } : { index: -1, code, message, path }
}

/** `insert` —— 新节点分配 odId，挂到父节点下。 */
function applyInsert(ctx: Ctx, op: Extract<OdOp, { op: 'insert' }>): OpIssue | undefined {
  const type = op.node?.type
  if (typeof type !== 'string' || type.length === 0) {
    return fail('OP_INVALID_TYPE', 'insert 的 node.type 不能为空')
  }
  if (!isSupportedNodeType(type)) {
    return fail('OP_INVALID_TYPE', `不支持的节点类型 "${type}"`, 'node.type')
  }

  const parent = ctx.byId.get(op.parentId)
  if (!parent) {
    return fail('OP_UNKNOWN_PARENT', `父节点 "${op.parentId}" 不存在`, 'parentId')
  }
  if (!isContainerNodeType(parent.type)) {
    return fail(
      'OP_INVALID_TYPE',
      `父节点类型 "${parent.type}" 不能容纳子节点`,
      'parentId'
    )
  }

  const rawName = op.node.name
  const name = typeof rawName === 'string' && rawName.length > 0 ? rawName : type
  const id = allocateId(ctx, type, name)

  const props: Loose = {}
  for (const [key, value] of Object.entries(op.node)) {
    if (key === 'id' || key === 'parent' || key === 'children') continue
    if (key === 'type' || key === 'name') continue
    props[key] = deepClone(value)
  }

  const node: Loose = { id, type, name }
  node['parent'] = parent.id
  node['children'] = []
  for (const [key, value] of Object.entries(props)) node[key] = value

  const children = Array.isArray(parent.children) ? parent.children : []
  const at = clampIndex(op.index, children.length)
  children.splice(at, 0, id)
  parent.children = children

  ctx.doc.nodes.push(node as unknown as OdNode)
  ctx.byId.set(id, node as unknown as OdNode)
  ctx.inserted = true
  return undefined
}

/** `update` —— props 只做浅合并（只改出现的顶层键）。 */
function applyUpdate(ctx: Ctx, op: Extract<OdOp, { op: 'update' }>): OpIssue | undefined {
  const node = ctx.byId.get(op.nodeId)
  if (!node) {
    return fail('OP_UNKNOWN_NODE', `节点 "${op.nodeId}" 不存在`, 'nodeId')
  }
  if (!isPlainObject(op.props)) {
    return fail('OP_INVALID_SHAPE', 'update 的 props 必须是对象', 'props')
  }
  const target = node as unknown as Loose
  for (const [key, value] of Object.entries(op.props)) {
    if (STRUCTURAL_NODE_KEYS.includes(key)) {
      return fail(
        'OP_INVALID_VALUE',
        `不允许用 update 修改结构字段 "${key}"（用 move / reorder / insert / delete）`,
        `props.${key}`
      )
    }
    // 带点的键不是 od 节点的顶层字段 —— 当成路径处理（否则会静默写进一个没人读的键）
    if (key.includes('.')) {
      const issue = writePathValue(target, key, value, `props.${key}`)
      if (issue) return issue
      continue
    }
    target[key] = deepClone(value)
  }
  return undefined
}

/**
 * 按绑定路径写一个值（`set` 与 `update` 的点分键共用）。
 *
 * 路径白名单 36 条（od-format §3.5），同时接受引擎写法（`width` / `fills/0/color`），
 * 统一换算成 od 路径（`box.width` / `fills.0.color`）。
 */
function writePathValue(
  node: Loose,
  path: string,
  value: unknown,
  reportedPath: string
): OpIssue | undefined {
  const odPath = isValidOdBindingPath(path)
    ? path
    : (engineBindingPathToOd(path) ?? undefined)
  if (!odPath) {
    return fail('OP_INVALID_PATH', `绑定路径 "${path}" 不在白名单内`, reportedPath)
  }
  const normalized = normalizeValue(odPath, value)
  if (!normalized.ok) {
    return fail('OP_INVALID_VALUE', normalized.message, reportedPath)
  }
  const written = writeAtPath(node, odPath.split('.'), normalized.value)
  if (!written.ok) {
    return fail('OP_INVALID_VALUE', written.message, reportedPath)
  }
  return undefined
}

/** `delete` —— 级联删除整棵子树。 */
function applyDelete(ctx: Ctx, op: Extract<OdOp, { op: 'delete' }>): OpIssue | undefined {
  const node = ctx.byId.get(op.nodeId)
  if (!node) {
    return fail('OP_UNKNOWN_NODE', `节点 "${op.nodeId}" 不存在`, 'nodeId')
  }
  if (node.id === ctx.doc.meta.root) {
    return fail('OP_INVALID_VALUE', '不能删除根节点（文档必须有一个根）', 'nodeId')
  }

  const subtree = collectSubtree(ctx.byId, node.id)
  const subtreeSet = new Set(subtree)

  const parent = node.parent ? ctx.byId.get(node.parent) : undefined
  if (parent && Array.isArray(parent.children)) {
    parent.children = parent.children.filter((child) => !subtreeSet.has(child))
  }

  ctx.doc.nodes = ctx.doc.nodes.filter((candidate) => !subtreeSet.has(candidate.id))
  for (const id of subtree) ctx.byId.delete(id)
  return undefined
}

/** `move` —— 换父节点 + 调顺序；不许移到自己或自己的后代下。 */
function applyMove(ctx: Ctx, op: Extract<OdOp, { op: 'move' }>): OpIssue | undefined {
  const node = ctx.byId.get(op.nodeId)
  if (!node) {
    return fail('OP_UNKNOWN_NODE', `节点 "${op.nodeId}" 不存在`, 'nodeId')
  }
  const newParent = ctx.byId.get(op.newParentId)
  if (!newParent) {
    return fail('OP_UNKNOWN_PARENT', `父节点 "${op.newParentId}" 不存在`, 'newParentId')
  }
  if (op.newParentId === op.nodeId) {
    return fail('OP_CYCLE', '不能把节点移到它自己下面', 'newParentId')
  }
  if (isDescendantOf(ctx.byId, node.id, newParent.id)) {
    return fail(
      'OP_CYCLE',
      `不能把节点 "${op.nodeId}" 移到自己的后代 "${op.newParentId}" 下`,
      'newParentId'
    )
  }
  if (!isContainerNodeType(newParent.type)) {
    return fail('OP_INVALID_TYPE', `父节点类型 "${newParent.type}" 不能容纳子节点`, 'newParentId')
  }

  const oldParent = node.parent ? ctx.byId.get(node.parent) : undefined
  if (oldParent && Array.isArray(oldParent.children)) {
    oldParent.children = oldParent.children.filter((child) => child !== node.id)
  }

  const children = Array.isArray(newParent.children) ? [...newParent.children] : []
  const at = clampIndex(op.index, children.length)
  children.splice(at, 0, node.id)
  newParent.children = children
  node.parent = newParent.id
  return undefined
}

/** `set` —— 按绑定路径写单个字段。 */
function applySet(ctx: Ctx, op: Extract<OdOp, { op: 'set' }>): OpIssue | undefined {
  const node = ctx.byId.get(op.nodeId)
  if (!node) {
    return fail('OP_UNKNOWN_NODE', `节点 "${op.nodeId}" 不存在`, 'nodeId')
  }
  if (typeof op.path !== 'string' || op.path.length === 0) {
    return fail('OP_INVALID_PATH', 'path 不能为空', 'path')
  }
  return writePathValue(node as unknown as Loose, op.path, op.value, 'path')
}

/** `reorder` —— order 必须恰好是现有子节点的一个排列。 */
function applyReorder(ctx: Ctx, op: Extract<OdOp, { op: 'reorder' }>): OpIssue | undefined {
  const parent = ctx.byId.get(op.parentId)
  if (!parent) {
    return fail('OP_UNKNOWN_PARENT', `父节点 "${op.parentId}" 不存在`, 'parentId')
  }
  const children = Array.isArray(parent.children) ? parent.children : []
  const order = Array.isArray(op.order) ? op.order : []

  const sameLength = order.length === children.length
  const unique = new Set(order).size === order.length
  const sameSet =
    sameLength &&
    unique &&
    order.every((id) => children.includes(id))
  if (!sameSet) {
    return fail(
      'OP_INVALID_ORDER',
      `order 必须是父节点现有 ${children.length} 个子节点的排列，收到 ${order.length} 项`,
      'order'
    )
  }
  parent.children = [...order]
  return undefined
}

/** 应用一条（非 batch）op；返回 undefined 表示成功。 */
function applyOne(ctx: Ctx, op: OdOp): OpIssue | undefined {
  switch (op.op) {
    case 'insert':
      return applyInsert(ctx, op)
    case 'update':
      return applyUpdate(ctx, op)
    case 'delete':
      return applyDelete(ctx, op)
    case 'move':
      return applyMove(ctx, op)
    case 'set':
      return applySet(ctx, op)
    case 'reorder':
      return applyReorder(ctx, op)
    default:
      return fail('OP_INVALID_SHAPE', `未知的 op "${(op as { op: string }).op}"`)
  }
}

/** 展开 batch：子 op 的 index 是 batch 内的相对下标。 */
interface FlatOp {
  op: OdOp
  index: number
}

function flattenOps(ops: OdOp[]): FlatOp[] {
  const out: FlatOp[] = []
  ops.forEach((op, index) => {
    if (op.op === 'batch') {
      for (const child of flattenOps(op.ops)) out.push({ op: child.op, index: child.index })
    } else {
      out.push({ op, index })
    }
  })
  return out
}

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

/**
 * 应用一批 op 到 od 文档上。
 *
 * **原子性**：任何一个 op 失败 → 整批不生效。
 * 失败时返回的 `doc` 是**原文档的深拷贝**（调用方传进来的 doc 一个字节都不变）。
 *
 * **兜底校验**：全部 op 应用完后跑 `validate(doc)`；出现 error 级问题 → 整批回滚
 * （返回原文档 + `OP_VALIDATION_FAILED` 问题）。
 *
 * @param doc   od 文档（不会被修改）
 * @param ops   操作列表
 * @param opts  可传 `registry` 复用调用方的 odId 分配器
 */
export function applyOps(
  doc: OdDocument,
  ops: OdOp[],
  opts: ApplyOpsOptions = {}
): OpApplyResult {
  const work = deepClone(doc)
  const ctx: Ctx = {
    doc: work,
    byId: indexNodes(work),
    registry: resolveRegistry(doc, opts.registry),
    inserted: false,
  }

  const flat = flattenOps(Array.isArray(ops) ? ops : [])
  for (const { op, index } of flat) {
    const issue = applyOne(ctx, op)
    if (issue) {
      return {
        ok: false,
        applied: 0,
        issues: [{ ...issue, index }],
        doc: deepClone(doc),
      }
    }
  }

  if (ctx.inserted) {
    const ordinal = Math.max(
      work.meta.ordinal ?? 0,
      ctx.registry.ordinal(),
      maxDiscriminatorOf(work.nodes.map((n) => n.id))
    )
    work.meta.ordinal = ordinal
  }

  const validation = validate(work)
  if (!validation.ok) {
    const issues: OpIssue[] = validation.errors.map((error) => ({
      index: -1,
      code: 'OP_VALIDATION_FAILED',
      message: `${error.code} ${error.path}: ${error.message}`,
      path: error.path,
    }))
    return { ok: false, applied: 0, issues, doc: deepClone(doc) }
  }

  return { ok: true, applied: flat.length, issues: [], doc: work }
}
