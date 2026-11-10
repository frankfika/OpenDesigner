/**
 * od-format 的错误码与异常类型。
 *
 * 错误码来自 `docs/od-format-spec.md` §8.4 的 V1–V30 校验规则表（31 个码）。
 * 码的语义分组：
 *
 * | 前缀 | 含义 |
 * | --- | --- |
 * | `OD1xxx` | 文档结构 / 引用完整性 |
 * | `OD12xx` | 外部资源（assets） |
 * | `OD13xx` | 派生字段两档（D1 必丢 / D2 必留）与文档元信息 |
 */
export const OD_ERROR_CODES = [
  'OD1001', // JSONC 不可解析
  'OD1003', // version 不支持
  'OD1004', // format !== 'od'
  'OD1100', // zod schema 校验失败
  'OD1101', // 顶层键顺序 / 未知键
  'OD1102', // odId 语法非法
  'OD1103', // odId 重复
  'OD1104', // parent 指向不存在的节点
  'OD1105', // children 与对方的 parent 不一致
  'OD1106', // 父子关系成环
  'OD1107', // meta.root 不是唯一存在的根
  'OD1108', // 绑定路径不在白名单内
  'OD1109', // 绑定指向的变量不存在
  'OD1110', // 变量别名指向的变量不存在
  'OD1111', // 变量值的形状非法
  'OD1112', // 模式 id 不存在
  'OD1113', // variableSets[].variables[] 指向的变量不存在
  'OD1114', // component.main 指向的节点不存在
  'OD1115', // overrides.descendants 的键指向不存在的节点
  'OD1116', // overrides 里的引用不存在
  'OD1117', // 组件属性 id 不唯一 / assignments 键不存在
  'OD1118', // 资源未被任何 fills[].imageHash 引用（warning）
  'OD1119', // fills[].imageHash 引用的资源不在 assets 里
  'OD1120', // INSTANCE 的 component.main 指向的不是 COMPONENT
  'OD1201', // 资源文件在磁盘上不存在
  'OD1202', // 资源文件路径逃逸出 od 文件所在目录
  'OD1203', // 资源文件的 sha1 与 assets 的键不一致
  'OD1301', // D1 派生字段出现在了 od 里
  'OD1302', // D2 必留字段在图里有值但 od 里没有
  'OD1303', // 未知顶层键（warning）
  'OD1304', // meta.generator 缺失（warning）
  'OD1321' // meta.ordinal 小于文中出现过的最大判别器（warning）
] as const

export type OdErrorCode = (typeof OD_ERROR_CODES)[number]

export type OdSeverity = 'error' | 'warning'

/** 一条校验结果。`path` 是 od 文档里的定位路径（形如 `nodes[7].component.main`）。 */
export interface OdIssue {
  readonly code: OdErrorCode
  readonly path: string
  readonly message: string
  readonly hint?: string
  readonly severity: OdSeverity
}

/** od-format 的基础异常。所有 od-format 抛出的异常都是它的子类。 */
export class OdError extends Error {
  readonly code: OdErrorCode
  readonly path: string
  readonly hint: string | undefined

  constructor(code: OdErrorCode, path: string, message: string, hint?: string) {
    super(`${code} ${path}: ${message}`)
    this.name = 'OdError'
    this.code = code
    this.path = path
    this.hint = hint
  }
}

/** 编码（引擎 → od）失败。 */
export class OdEncodeError extends OdError {
  constructor(code: OdErrorCode, path: string, message: string, hint?: string) {
    super(code, path, message, hint)
    this.name = 'OdEncodeError'
  }
}

/** 解码（od → 引擎）失败。 */
export class OdDecodeError extends OdError {
  constructor(code: OdErrorCode, path: string, message: string, hint?: string) {
    super(code, path, message, hint)
    this.name = 'OdDecodeError'
  }
}

/** 版本迁移失败。 */
export class OdMigrationError extends OdError {
  constructor(code: OdErrorCode, path: string, message: string, hint?: string) {
    super(code, path, message, hint)
    this.name = 'OdMigrationError'
  }
}

/** 校验失败（严格模式下抛）。 */
export class OdValidationError extends OdError {
  readonly issues: readonly OdIssue[]

  constructor(issues: readonly OdIssue[]) {
    const first = issues[0]
    super(
      first?.code ?? 'OD1100',
      first?.path ?? '',
      first?.message ?? '校验失败',
      first?.hint
    )
    this.name = 'OdValidationError'
    this.issues = issues
  }
}
