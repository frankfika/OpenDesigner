/**
 * **v1.0 的 schema** —— 冻结。
 *
 * 与 v0.1 的差异（规格 §5.4 的示例迁移）：
 * - `appearance.*` → `style.*`
 * - `text.content` → `text.value`
 *
 * 其余结构与 v0.1 一致。
 */
import { buildOdDocumentSchema } from '../schema.js'

export const OdDocumentV10 = buildOdDocumentSchema((path) => {
  if (path === 'text.content') return 'text.value'
  if (path.startsWith('appearance.')) return `style.${path.slice('appearance.'.length)}`
  return path
})
