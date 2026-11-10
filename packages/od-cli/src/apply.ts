/**
 * `od apply` 的实现 —— **agent 可直接 patch 文件**（研究文档 §5.1 第 2 条）。
 *
 * `od apply <input.od.json> <ops.json>` 把一串操作应用到文档上。
 * 操作 DSL 由 `@opendesigner/od-ops` 提供，本文件只做**胶水**：
 *   读文档 → 解析操作 → 应用 → 写回。
 *
 * ⚠️ 依赖是**动态导入**的：`@opendesigner/od-ops` 与本分支并行开发，
 * 落地之前这个包可能**还不存在**。此时 `od apply` 报「需要 @opendesigner/od-ops」
 * 并走**退出码 3**（缺依赖），而不是整个 CLI 起不来。
 * 这也是为什么这里用「变量形式的 specifier」—— TypeScript 不会去静态解析它，
 * 包没落地时 `tsc` 依然零错误；包落地后运行时会正常解析到它。
 */
import type { OdDocument } from '@opendesigner/od-format'
import type { OpIssue } from '@opendesigner/od-ops'

import { OdCliError, errorDetail } from './cli-error.js'

/** 变量形式的 specifier：TS 不做静态解析（包还没落地时也不报错）。 */
const OD_OPS_SPECIFIER = '@opendesigner/od-ops'

/** od-ops 的真实类型（类型导入 —— 不产生运行时依赖）。 */
type OdOpsApi = typeof import('@opendesigner/od-ops')

/** 操作脚本的原始内容：`OdOp[]` 或 `{ ops: OdOp[] }`。 */
export type OpsInput = unknown

export interface ApplyIssue {
  code: string
  path: string
  message: string
  hint?: string
  severity: 'error' | 'warning'
}

export interface ApplyOutcome {
  ok: boolean
  /** 实际应用（或将要应用）的操作数。 */
  applied: number
  issues: ApplyIssue[]
  /** 应用后的文档；`ok` 为 false 时可能是 undefined。 */
  doc: OdDocument | undefined
  dryRun: boolean
}

/** od-ops 的契约形状（由 od-ops 自己实现，这里只做类型兜底）。 */
interface ApplyOpsResult {
  ok?: boolean
  applied?: unknown
  issues?: unknown[]
  doc?: OdDocument
}

interface ParseOpsResult {
  ok?: boolean
  ops?: unknown[]
  issues?: unknown[]
}

/** 载入 od-ops；包不存在时抛「unsupported」（→ 退出码 3）。 */
export async function loadOdOps(): Promise<OdOpsApi> {
  let mod: OdOpsApi
  try {
    mod = (await import(OD_OPS_SPECIFIER)) as OdOpsApi
  } catch (error) {
    throw new OdCliError(
      'unsupported',
      '应用操作需要 @opendesigner/od-ops，当前环境没有安装',
      errorDetail(error),
      'npm i @opendesigner/od-ops'
    )
  }
  if (typeof mod.applyOps !== 'function' || typeof mod.parseOps !== 'function') {
    throw new OdCliError(
      'unsupported',
      '@opendesigner/od-ops 缺少 applyOps / parseOps',
      '装到的包版本不对',
      'npm i @opendesigner/od-ops'
    )
  }
  return mod
}

/** 把 od-ops 的 issue 归一成 CLI 能打印的形状（`OpIssue` = index / code / message / path）。 */
export function normalizeIssues(raw: unknown): ApplyIssue[] {
  if (!Array.isArray(raw)) return []
  const out: ApplyIssue[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      out.push({ code: 'OP0000', path: '', message: String(item), severity: 'error' })
      continue
    }
    const issue = item as OpIssue & { severity?: string }
    const index = typeof issue.index === 'number' ? issue.index : -1
    const path =
      typeof issue.path === 'string' && issue.path.length > 0
        ? issue.path
        : index >= 0
          ? `ops[${index}]`
          : ''
    out.push({
      code: typeof issue.code === 'string' ? issue.code : 'OP0000',
      path,
      message: typeof issue.message === 'string' ? issue.message : JSON.stringify(item),
      hint: undefined,
      severity: issue.severity === 'warning' ? 'warning' : 'error',
    })
  }
  return out
}

/** issue 列表 → 可打印的多行文本。 */
export function formatIssues(issues: readonly ApplyIssue[]): string {
  return issues
    .map((issue) => {
      const where = issue.path ? `${issue.code}  ${issue.path}` : issue.code
      const hint = issue.hint ? `\n          提示: ${issue.hint}` : ''
      return `  ${issue.severity === 'warning' ? '!' : '✗'} ${where}\n          ${issue.message}${hint}`
    })
    .join('\n')
}

/** `applied` 的形状由 od-ops 定（数字 / 数组 / undefined 都可能）。 */
function countApplied(applied: unknown, fallback: number): number {
  if (typeof applied === 'number' && Number.isFinite(applied)) return applied
  if (Array.isArray(applied)) return applied.length
  return fallback
}

/**
 * 把操作应用到文档上。
 *
 * - `parseOps` 不通过 → **校验错**（退出码 2），把它的 issues 原样带出来。
 * - `applyOps` 返回 `ok: false` → 同样是校验错（退出码 2）。
 * - `dryRun` 只报告「会应用什么」，**不写文件**（写回由调用方决定）。
 */
export async function applyOpsToDocument(
  doc: OdDocument,
  opsInput: OpsInput,
  options: { dryRun?: boolean } = {}
): Promise<ApplyOutcome> {
  const ops = await loadOdOps()
  const dryRun = options.dryRun === true

  let parsed = ops.parseOps!(opsInput)
  // `parseOps` 可能只认 `{ ops: [...] }` 这一种形状 —— 裸数组再试一次。
  if (parsed?.ok !== true && Array.isArray(opsInput)) {
    const retry = ops.parseOps!({ ops: opsInput })
    if (retry?.ok === true) parsed = retry
  }

  if (parsed?.ok !== true) {
    const issues = normalizeIssues(parsed?.issues)
    throw new OdCliError(
      'validation',
      '操作脚本不合法',
      issues.length > 0 ? formatIssues(issues) : 'parseOps 没有给出原因',
      '操作脚本是 OdOp[] 或 { ops: OdOp[] }'
    )
  }

  const opList = parsed.ops ?? []
  // 干跑也真的在内存里应用一遍 —— 这样「有哪些问题」是**真实**的问题，
  // 而不是「猜一猜」。只是不写文件。
  const result = await ops.applyOps!(doc, opList, {})
  const issues = normalizeIssues(result?.issues)
  const ok = result?.ok !== false

  if (!ok) {
    throw new OdCliError(
      'validation',
      '操作应用失败',
      issues.length > 0 ? formatIssues(issues) : 'applyOps 没有给出原因'
    )
  }

  return {
    ok: true,
    applied: countApplied(result?.applied, opList.length),
    issues,
    doc: result?.doc,
    dryRun,
  }
}
