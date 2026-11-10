/**
 * CLI 的错误类型 —— 让新的子命令（export / apply / mcp）能表达
 * 「这是用法错 / 校验错 / 不支持 / IO 错」，而**不直接 `process.exit`**。
 *
 * 为什么要这一层：退出码是契约（`cli.ts` 的 EXIT_* 常量），但导出 / 应用操作
 * 的实现逻辑要能被单测直接调用。实现层 `throw`，命令层 `catch` → `fail(code, ...)`，
 * 两边职责分开，退出码仍然只有一处定义。
 */

/** 错误类别 → 退出码的映射由 `cli.ts` 持有（退出码契约的唯一事实源）。 */
export type CliErrorKind = 'usage' | 'validation' | 'unsupported' | 'io' | 'internal'

export class OdCliError extends Error {
  readonly kind: CliErrorKind
  readonly detail?: string
  readonly hint?: string

  constructor(kind: CliErrorKind, message: string, detail?: string, hint?: string) {
    super(message)
    this.name = 'OdCliError'
    this.kind = kind
    this.detail = detail
    this.hint = hint
  }
}

/**
 * 把异常压成**一行**摘要。
 *
 * 为什么：模块找不到时 Node 的 `error.message` 是一长串绝对路径，
 * 直接打给用户既吵又没用（真正有用的信息是「哪个模块」）。
 */
export function errorDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const firstLine = message.split('\n')[0] ?? message
  return firstLine.length > 160 ? `${firstLine.slice(0, 157)}…` : firstLine
}
