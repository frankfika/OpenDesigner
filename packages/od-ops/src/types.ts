/**
 * od-ops 的类型与 schema —— **面向 agent 的文档操作 DSL**。
 *
 * 设计前提（来自 docs/research.md §8 第 4 条）：
 * agent 不直接手写 od 文本，而是调用**带参操作**（insert / update / delete / move / set /
 * reorder / batch），由本层负责校验与应用。
 * 这既是**安全边界**（改坏了不会落盘），也是把「agent 能力」与「文件格式」解耦的接口设计。
 *
 * 三条硬约束：
 * 1. **op 作用在 od 文档上**（不是引擎文档）—— agent 面向的是 od 文本文件。
 * 2. **原子性**：任何一个 op 失败 → 整批不生效（见 apply.ts）。
 * 3. **纯函数**：applyOps 绝不修改传入的 doc。
 */
import { z } from 'zod'

import type { IdRegistry, OdDocument } from '@opendesigner/od-format'

// ---------------------------------------------------------------------------
// op 的类型（契约固定，下游 MCP server 照此调用）
// ---------------------------------------------------------------------------

/**
 * `insert` 用的新节点输入。
 *
 * 除 `type` / `name` 外的键**原样写进 od 节点**（od 形状），
 * 例如 `{ box: { width: 100 }, fills: [...] }`。
 * `id` / `parent` / `children` 是结构字段，**由 op 自己控制**，传了会被丢弃。
 */
export interface OpNodeInput {
  type: string
  name?: string
  [key: string]: unknown
}

/** 一条操作。 */
export type OdOp =
  | { op: 'insert'; parentId: string; node: OpNodeInput; index?: number }
  | { op: 'update'; nodeId: string; props: Record<string, unknown> }
  | { op: 'delete'; nodeId: string }
  | { op: 'move'; nodeId: string; newParentId: string; index?: number }
  | { op: 'set'; nodeId: string; path: string; value: unknown }
  | { op: 'reorder'; parentId: string; order: string[] }
  | { op: 'batch'; ops: OdOp[] }

// ---------------------------------------------------------------------------
// 结果与选项
// ---------------------------------------------------------------------------

/**
 * 一条问题（错误）。
 *
 * - `index`：op 在 `ops` 数组里的下标；**batch 内是 batch 内的相对下标**；
 *   `-1` 表示「与单个 op 无关」（例如整批应用后的文档校验失败）。
 * - `code`：大写错误码，见 {@link OP_CODES}。
 * - `path`：可选，出错的位置（op 字段路径 / od 节点路径 / 绑定路径）。
 */
export interface OpIssue {
  index: number
  code: string
  message: string
  path?: string
}

/**
 * 应用结果。
 *
 * - `ok`：全部成功才为 true。
 * - `applied`：成功应用的 op 数（batch 展开后按叶子 op 计）；失败时为 0（整批回滚）。
 * - `doc`：成功 = 新文档；失败 = **原文档未改动的深拷贝**。
 */
export interface OpApplyResult {
  ok: boolean
  applied: number
  issues: OpIssue[]
  doc: OdDocument
}

/** applyOps 的选项。 */
export interface ApplyOpsOptions {
  /**
   * 复用调用方的 registry —— 保持 odId 分配连续（判别器不跳号）。
   * 不传则内部建一个，并把文档里已有的 odId 全部登记进去。
   */
  registry?: IdRegistry
}

// ---------------------------------------------------------------------------
// 错误码
// ---------------------------------------------------------------------------

/** 错误码 → 中文说明。 */
export const OP_CODES: Readonly<Record<string, string>> = Object.freeze({
  OP_UNKNOWN_NODE: '目标节点不存在',
  OP_UNKNOWN_PARENT: '父节点不存在',
  OP_INVALID_TYPE: '节点类型非法',
  OP_INVALID_PATH: '绑定路径不在白名单内',
  OP_INVALID_ORDER: 'order 不是父节点现有子节点的排列',
  OP_CYCLE: '该操作会造成父子关系成环',
  OP_INVALID_VALUE: '值非法',
  OP_VALIDATION_FAILED: '应用后文档校验失败，已整批回滚',
  OP_INVALID_SHAPE: 'op 的形状非法',
})

// ---------------------------------------------------------------------------
// 节点类型白名单
// ---------------------------------------------------------------------------

/**
 * `insert` 允许的节点类型。
 *
 * 前 17 个是 `@open-pencil/scene-graph@0.16.0` 的 `NodeType` 全集；
 * 后面是任务书列出的扩展类型（od 格式的 `type` 是自由字符串，
 * 引擎尚未实现这些类型，但保留可写性 —— 不在这里拦住，交给下游决定）。
 */
export const SUPPORTED_NODE_TYPES: readonly string[] = Object.freeze([
  'CANVAS',
  'FRAME',
  'RECTANGLE',
  'ROUNDED_RECTANGLE',
  'ELLIPSE',
  'TEXT',
  'LINE',
  'STAR',
  'POLYGON',
  'VECTOR',
  'BOOLEAN_OPERATION',
  'GROUP',
  'SECTION',
  'COMPONENT',
  'COMPONENT_SET',
  'INSTANCE',
  'CONNECTOR',
  'SHAPE_WITH_TEXT',
  'SLICE',
  'STICKY',
  'WIDGET',
  'SHAPE',
  'BRUSH',
  'IMAGE',
  'TABLE',
  'TABLE_CELL',
  'SLIDE',
  'SLIDE_ROW',
])

const SUPPORTED_NODE_TYPE_SET: ReadonlySet<string> = new Set(SUPPORTED_NODE_TYPES)

/** 该节点类型是否可被 insert。 */
export function isSupportedNodeType(type: string): boolean {
  return SUPPORTED_NODE_TYPE_SET.has(type)
}

/**
 * 可以容纳子节点的父节点类型。
 *
 * 注意：`GROUP` 在引擎里是「几何分组」，但 od 格式照样用 parent/children 表达层级，
 * 所以这里放行。
 */
export const CONTAINER_NODE_TYPES: readonly string[] = Object.freeze([
  'CANVAS',
  'FRAME',
  'GROUP',
  'COMPONENT',
  'COMPONENT_SET',
  'INSTANCE',
  'SECTION',
])

const CONTAINER_NODE_TYPE_SET: ReadonlySet<string> = new Set(CONTAINER_NODE_TYPES)

/** 该节点类型能否作为子节点的父节点。 */
export function isContainerNodeType(type: string): boolean {
  return CONTAINER_NODE_TYPE_SET.has(type)
}

/** `update` 不许碰的结构字段（改它们要走 move / reorder / insert / delete）。 */
export const STRUCTURAL_NODE_KEYS: readonly string[] = Object.freeze(['id', 'parent', 'children'])

// ---------------------------------------------------------------------------
// zod schema（parseOps 用）
// ---------------------------------------------------------------------------

/** `insert` 的新节点输入 —— 自由形状（od 节点字段）。 */
export const OpNodeInputSchema = z.looseObject({
  type: z.string().min(1, 'type 不能为空'),
  name: z.string().optional(),
})

export const InsertOpSchema = z.strictObject({
  op: z.literal('insert'),
  parentId: z.string().min(1, 'parentId 不能为空'),
  node: OpNodeInputSchema,
  index: z.number().int('index 必须是整数').optional(),
})

export const UpdateOpSchema = z.strictObject({
  op: z.literal('update'),
  nodeId: z.string().min(1, 'nodeId 不能为空'),
  props: z.record(z.string(), z.unknown()),
})

export const DeleteOpSchema = z.strictObject({
  op: z.literal('delete'),
  nodeId: z.string().min(1, 'nodeId 不能为空'),
})

export const MoveOpSchema = z.strictObject({
  op: z.literal('move'),
  nodeId: z.string().min(1, 'nodeId 不能为空'),
  newParentId: z.string().min(1, 'newParentId 不能为空'),
  index: z.number().int('index 必须是整数').optional(),
})

export const SetOpSchema = z.strictObject({
  op: z.literal('set'),
  nodeId: z.string().min(1, 'nodeId 不能为空'),
  path: z.string().min(1, 'path 不能为空'),
  value: z.unknown(),
})

export const ReorderOpSchema = z.strictObject({
  op: z.literal('reorder'),
  parentId: z.string().min(1, 'parentId 不能为空'),
  order: z.array(z.string().min(1), 'order 的每一项必须是非空字符串'),
})

/**
 * `batch` —— 子 op 的形状由 {@link OdOpSchema} 递归定义（用 `z.lazy` 打破循环）。
 */
export const BatchOpSchema = z.strictObject({
  op: z.literal('batch'),
  ops: z.array(z.lazy((): z.ZodType<OdOp> => OdOpSchema)),
})

/** 一条 op 的 schema。 */
export const OdOpSchema: z.ZodType<OdOp, unknown> = z.lazy(() =>
  z.discriminatedUnion('op', [
    InsertOpSchema,
    UpdateOpSchema,
    DeleteOpSchema,
    MoveOpSchema,
    SetOpSchema,
    ReorderOpSchema,
    BatchOpSchema,
  ])
)
