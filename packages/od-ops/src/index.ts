/**
 * od-ops —— **面向 agent 的文档操作 DSL**。
 *
 * 这是 od 格式的**安全边界**：agent 不直接手写 od 文本，而是调用带参操作
 * （insert / update / delete / move / set / reorder / batch），
 * 由本层负责校验与应用 —— 改坏了不会落盘。
 *
 * 用法（下游 MCP server 的 `apply_ops` 工具照此调）：
 *
 * ```ts
 * import { parseOps, applyOps } from '@opendesigner/od-ops'
 *
 * const parsed = parseOps(untrustedJson)
 * if (!parsed.ok) return { error: parsed.issues }
 *
 * const result = applyOps(doc, parsed.ops, { registry })
 * if (!result.ok) return { error: result.issues }
 * await writeFile(file, stringifyOd(result.doc))
 * ```
 *
 * 公开 API：
 *   - `OdOp` / `OpNodeInput`                    —— op 的类型
 *   - `OpIssue` / `OpApplyResult` / `ApplyOpsOptions`
 *   - `applyOps(doc, ops, opts?)`               —— 应用（原子性 + 兜底校验）
 *   - `parseOps(input)`                         —— 校验 agent 给的 JSON
 *   - `OP_CODES`                                —— 错误码 → 中文说明
 *   - `OdOpSchema` 等 zod schema                —— 需要自己接校验时用
 */
import { OdOpSchema } from './types'
import type { OdOp, OpIssue } from './types'

export { applyOps } from './apply'

export {
  OP_CODES,
  SUPPORTED_NODE_TYPES,
  CONTAINER_NODE_TYPES,
  STRUCTURAL_NODE_KEYS,
  OdOpSchema,
  OpNodeInputSchema,
  InsertOpSchema,
  UpdateOpSchema,
  DeleteOpSchema,
  MoveOpSchema,
  SetOpSchema,
  ReorderOpSchema,
  BatchOpSchema,
  isSupportedNodeType,
  isContainerNodeType,
} from './types'

export type {
  OdOp,
  OpNodeInput,
  OpIssue,
  OpApplyResult,
  ApplyOpsOptions,
} from './types'

/**
 * 校验 agent 给的 op 列表。
 *
 * 接受两种形状：
 * - `[{ op: 'insert', ... }, ...]`
 * - `{ ops: [{ op: 'insert', ... }, ...] }`
 *
 * **不抛异常** —— 返回 `{ ok: false, issues }`，让调用方决定怎么回给 agent。
 * 形状非法的问题一律是 `OP_INVALID_SHAPE`。
 */
export function parseOps(
  input: unknown
): { ok: true; ops: OdOp[] } | { ok: false; issues: OpIssue[] } {
  const list = extractOpList(input)
  if (!list) {
    return {
      ok: false,
      issues: [
        {
          index: -1,
          code: 'OP_INVALID_SHAPE',
          message: 'ops 必须是一个数组，或 { ops: [...] } 形状的对象',
        },
      ],
    }
  }

  const issues: OpIssue[] = []
  const ops: OdOp[] = []
  list.forEach((item, index) => {
    const parsed = OdOpSchema.safeParse(item)
    if (!parsed.success) {
      for (const issue of parsed.error.issues.slice(0, 3)) {
        const path = issue.path.map((segment) => String(segment)).join('.')
        issues.push({
          index,
          code: 'OP_INVALID_SHAPE',
          message: `${path || '(root)'}: ${issue.message}`,
          path: path || undefined,
        })
      }
      return
    }
    ops.push(parsed.data)
  })

  if (issues.length > 0) return { ok: false, issues }
  return { ok: true, ops }
}

/** 从输入里取出 op 数组；形状不对返回 undefined。 */
function extractOpList(input: unknown): unknown[] | undefined {
  if (Array.isArray(input)) return input
  if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
    const ops = (input as { ops?: unknown }).ops
    if (Array.isArray(ops)) return ops
  }
  return undefined
}
