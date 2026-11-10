/**
 * 资源文件的本地校验（V24 / V25 / V26）。
 *
 * **为什么单独拆一个文件**：这三条规则要读磁盘上的资源文件、算 sha1，
 * 用的是 Node 内置模块（node:fs / node:crypto / node:path）。
 * 而 od-format 的主入口 `index.ts` 必须能在**浏览器**里 import
 * （编辑器直接用它读写 .od.json），静态 import node:* 会让浏览器直接崩。
 *
 * 所以：
 * - 主入口 **不** 引用本文件。
 * - Node 端（CLI）通过包���子路径 `@opendesigner/od-format/node-assets` 显式引入，
 *   并把校验函数注入 `validate(doc, { checkAssets })`。
 *
 * 浏览器端没有 assets 目录的概念，跳过这三条规则是对的，不是降级。
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'

import type { OdIssue } from './errors'

type Loose = Record<string, unknown>

const asLoose = (value: unknown): Loose =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Loose) : {}

/**
 * 校验 od 文档引用的资源文件。
 *
 * - **V25 路径逃逸**：资源的相对路径不能跑出 od 文件所在目录。
 * - **V24 文件存在**：文件必须在。
 * - **V26 sha1 一致**：文件内容的 sha1 必须等于 assets 的键。
 *
 * @param doc od 文档（要能读出 `assets`）
 * @param assetsDir od 文件所在目录
 */
export function validateAssetFiles(doc: unknown, assetsDir: string): OdIssue[] {
  const issues: OdIssue[] = []
  const assets = asLoose(asLoose(doc).assets)
  const base = resolve(assetsDir)

  for (const [key, value] of Object.entries(assets)) {
    const asset = asLoose(value)
    const file = typeof asset.file === 'string' ? asset.file : ''
    const full = resolve(base, file)

    // --- V25：路径逃逸 ---
    if (!full.startsWith(base + sep) && full !== base) {
      issues.push({
        code: 'OD1202',
        path: `assets["${key}"].file`,
        message: `资源路径逃逸出 od 文件所在目录："${file}"`,
        severity: 'error'
      })
      continue
    }

    // --- V24：文件存在 ---
    if (!existsSync(full)) {
      issues.push({
        code: 'OD1201',
        path: `assets["${key}"].file`,
        message: `资源文件不存在："${file}"`,
        severity: 'error'
      })
      continue
    }

    // --- V26：sha1 一致 ---
    try {
      const bytes = readFileSync(full)
      const sha1 = createHash('sha1').update(bytes).digest('hex')
      if (sha1 !== key) {
        issues.push({
          code: 'OD1203',
          path: `assets["${key}"]`,
          message: `资源文件的 sha1 是 ${sha1}，与键 "${key}" 不一致`,
          severity: 'error'
        })
      }
    } catch (error) {
      issues.push({
        code: 'OD1201',
        path: `assets["${key}"].file`,
        message: `资源文件读取失败：${error instanceof Error ? error.message : String(error)}`,
        severity: 'error'
      })
    }
  }

  return issues
}
