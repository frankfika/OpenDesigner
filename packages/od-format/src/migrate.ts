/**
 * 版本策略与迁移框架（规格 §5）。
 *
 * - `version` 是**格式版本**（MAJOR.MINOR），工具版本在 `meta.generator`。
 * - 迁移器是**纯函数**：同样的输入 → 同样的输出，**不得就地改入参**。
 * - 每个历史版本**冻结**一份 zod schema，永不修改。
 * - 找不到迁移路径 → 抛 `OdMigrationError`，**不做有损降级**（悄悄丢字段比报错更糟）。
 */
import { z } from 'zod'

import { OdMigrationError } from './errors'
import type { OdDocument } from './schema'
import { OdDocumentV01 } from './versions/v0.1.js'
import { OdDocumentV10 } from './versions/v1.0.js'

export type OdVersion = `${number}.${number}`

export interface OdMigration {
  /** 源版本（精确匹配）。 */
  readonly from: OdVersion
  /** 目标版本（精确匹配）。 */
  readonly to: OdVersion
  /** 一句话说明，写进 CLI 的迁移日志。 */
  readonly description: string
  /** 是否是破坏性迁移（破坏性迁移 MUST 在 CHANGELOG 记录）。 */
  readonly breaking: boolean
  /** 执行迁移。 */
  migrate(doc: OdDocument): OdDocument
}

/**
 * v0.1 → v1.0 的迁移（规格 §5.4 的参考实现）。
 *
 * 两处破坏性改名 + **绑定路径同步改写**（只改字段名不改绑定路径 = 绑定静默失效，
 * 这是最危险的迁移 bug）。
 */
export const migrate_0_1_to_1_0: OdMigration = {
  from: '0.1',
  to: '1.0',
  description: 'appearance.* → style.*；text.content → text.value；绑定路径同步改写',
  breaking: true,
  migrate(doc: OdDocument): OdDocument {
    const next = structuredClone(doc) as unknown as Record<string, unknown>
    next.version = '1.0'

    const renamePath = (path: string): string =>
      path.replace(/^appearance\./, 'style.').replace(/^text\.content$/, 'text.value')

    const nodes = (next.nodes ?? []) as Array<Record<string, unknown>>
    for (const node of nodes) {
      if (node.appearance) {
        node.style = node.appearance
        delete node.appearance
      }
      const text = node.text as Record<string, unknown> | undefined
      if (text && 'content' in text) {
        text.value = text.content
        delete text.content
      }
      const bindings = node.bindings as Record<string, unknown> | undefined
      if (bindings) {
        for (const key of ['fields', 'scales', 'assignmentScales']) {
          const map = bindings[key] as Record<string, unknown> | undefined
          if (!map) continue
          const rewritten: Record<string, unknown> = {}
          for (const [path, value] of Object.entries(map)) rewritten[renamePath(path)] = value
          bindings[key] = rewritten
        }
      }
    }

    return next as unknown as OdDocument
  },
}

/** 迁移器注册表（按 from 升序）。 */
export const migrations: readonly OdMigration[] = [migrate_0_1_to_1_0]

/**
 * 每个历史版本保留一份**冻结**的 zod schema。
 *
 * v0.1 的 schema 就是当前的 `OdDocumentSchema`（v0.1 是当前格式版本）。
 * 一旦发布 v1.0，必须把 v0.1 的 schema **快照**冻结到 `versions/v0.1.ts`，永不修改。
 */
export const schemas: Readonly<Record<string, z.ZodType>> = {
  '0.1': OdDocumentV01,
  '1.0': OdDocumentV10,
}

/** 本工具支持的格式版本。 */
export const SUPPORTED_VERSIONS: readonly OdVersion[] = ['0.1', '1.0']

/** 本工具能读到的最高格式版本。 */
export const latestVersion = (): OdVersion => '0.1'

/** 该版本是否被本工具支持。 */
export function isSupportedVersion(version: string): boolean {
  return (SUPPORTED_VERSIONS as readonly string[]).includes(version)
}

/** 在迁移链里找一条从 `from` 到 `to` 的路径（每步恰好升/降一个版本）。 */
function findChain(from: OdVersion, to: OdVersion): OdMigration[] {
  if (from === to) return []
  const chain: OdMigration[] = []
  const visited = new Set<string>([from])
  let current: string = from

  for (;;) {
    const step = migrations.find(
      (m) => m.from === current && !visited.has(m.to) && (m.to === to || reachable(m.to, to))
    )
    if (!step) {
      throw new OdMigrationError(
        'OD1003',
        'version',
        `没有从 "${from}" 到 "${to}" 的迁移路径`,
        'MUST NOT 做有损降级 —— 找不到迁移器就报错'
      )
    }
    chain.push(step)
    visited.add(step.to)
    current = step.to
    if (current === to) break
  }
  return chain
}

/** `to` 是否能从 `from` 到达（粗判：注册表里存在一条边链）。 */
function reachable(from: string, to: string): boolean {
  if (from === to) return true
  const seen = new Set<string>()
  const stack = [from]
  while (stack.length > 0) {
    const current = stack.pop()!
    if (current === to) return true
    if (seen.has(current)) continue
    seen.add(current)
    for (const m of migrations) {
      if (m.from === current) stack.push(m.to)
    }
  }
  return false
}

/**
 * 把文档从 `from` 版本迁移到 `to` 版本。
 *
 * - `from === to` → 原样返回（但仍会校验）
 * - 找不到路径 → 抛 `OdMigrationError`
 * - 迁移器改完 MUST 能被目标版本的 schema 校验通过
 */
export function migrate(doc: unknown, from: OdVersion, to: OdVersion): OdDocument {
  const chain = findChain(from, to)
  let current = doc as OdDocument

  for (const step of chain) {
    // 迁移器 MUST 是纯函数：快照入参，迁移后确认入参对象本身没被改
    const inputSnapshot = JSON.stringify(current)
    const output = step.migrate(current)
    if (JSON.stringify(current) !== inputSnapshot) {
      throw new OdMigrationError(
        'OD1003',
        'version',
        `迁移器 ${step.from}→${step.to} 原地修改了入参`
      )
    }
    current = output
  }

  // 用目标版本的 schema 校验
  const schema = schemas[to]
  if (schema) {
    const result = schema.safeParse(current)
    if (!result.success) {
      throw new OdMigrationError(
        'OD1100',
        'version',
        `迁移结果不满足 ${to} 的 schema：${result.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join('.')} ${i.message}`)
          .join('; ')}`
      )
    }
  }

  return current
}
