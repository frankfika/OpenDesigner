/**
 * od-format 包入口。
 *
 * **完整 API 契约以 `docs/od-format-spec.md` §9 为准**（本文件只做导出汇总，
 * 不复制规格，避免两边漂移）。
 *
 * 公开 API（规格 §9.2）：
 *   - OD_FORMAT_VERSION / OD_FORMAT_PACKAGE_VERSION —— 版本常量
 *   - OdDocumentSchema / OdDocument              —— od 文档模型（zod）
 *   - fromEngine(graph, registry?)               —— 引擎文档 → od 文档
 *   - toEngine(doc, opts?)                        —— od 文档 → 引擎文档
 *   - parseOd(text) / stringifyOd(doc)            —— 文本 ⇄ od 文档（JSONC 注释容忍）
 *   - migrate(doc, from, to)                     —— 版本迁移
 *   - validate(doc)                              —— 校验 + 错误码（规格 §8.4）
 *   - odDocumentJsonSchema()                     —— 公开 JSON Schema
 *   - IdRegistry                                 —— 语义 ID 注册表（规格 §2.11）
 *
 * 硬约束（来自 docs/engine-semantics.md 实测，违反即错）：
 *   1. `variableBindingScales` / `variableAssignmentScales` **必须往返保留**
 *      ——普通加载不重算，丢了绑定会静默解出不同的数。
 *   2. `textPicture` 是派生缓存，**剔除**，不要走 base64 分支。
 *   3. `instanceOverrides` 必须用引擎自带的三态编解码
 *      （serializeInstanceOverrideState / deserializeInstanceOverrideState）。
 *      直接 JSON.stringify 会丢光。
 *   4. 绝不能 `JSON.stringify(graph)` ——TS 的 private 是编译期的事，
 *      会把 emitter/absPosCache 写进文本，并把所有 Map 变成 {}。
 *
 * 本包的运行时依赖只有 `@open-pencil/scene-graph` + `zod`，
 * **不依赖 @open-pencil/core**（core 只在根 devDependencies 里，供测试做渲染/布局比对）。
 */
import { z } from 'zod'

import { OdDocumentSchema, type OdDocument } from './schema'
import { parseJsonc, stringifyOd } from './text'
import { OdDecodeError } from './errors'

export { OD_FORMAT_VERSION, OD_FORMAT_PACKAGE_VERSION, OD_FORMAT_ID, OD_FILE_EXTENSION } from './version'
export {
  OdError,
  OdEncodeError,
  OdDecodeError,
  OdMigrationError,
  OdValidationError,
  OD_ERROR_CODES,
  type OdErrorCode,
  type OdIssue,
  type OdSeverity,
} from './errors'

export {
  OdDocumentSchema,
  OdNodeSchema,
  OdMetaSchema,
  OdVariableSchema,
  OdVariableSetSchema,
  OdAssetSchema,
  OdLibrarySchema,
  OdModeSchema,
  OdThemesSchema,
  type OdDocument,
  type OdNode,
  type OdMeta,
  type OdVariable,
  type OdVariableSet,
  type OdAsset,
  type OdLibrary,
  type OdMode,
} from './schema'

export { fromEngine, type EncodeContext } from './encode'
export { toEngine, type ToEngineOptions, type ToEngineResult } from './decode'
export { validate, assertValid, type ValidationResult, type ValidateOptions } from './validate'
export {
  inspect,
  formatInspectText,
  type InspectOptions,
  type InspectResult,
  type InspectTreeNode,
} from './inspect'
export {
  migrate,
  migrations,
  schemas,
  isSupportedVersion,
  latestVersion,
  SUPPORTED_VERSIONS,
  migrate_0_1_to_1_0,
  type OdVersion,
  type OdMigration,
} from './migrate'

export {
  IdRegistry,
  isOdId,
  odIdKind,
  odIdSlug,
  odIdDiscriminator,
  slugify,
  kindOfNodeType,
  maxDiscriminatorOf,
  OD_ID_KINDS,
  OD_ID_PATTERN,
  NODE_TYPE_KINDS,
  type OdIdKind,
} from './ids'

export {
  BINDING_PATH_SCALARS,
  BINDING_PATH_INDEXED,
  BINDING_PATH_COUNT,
  engineBindingPathToOd,
  odBindingPathToEngine,
  isValidOdBindingPath,
} from './paths'

export { blobToSvgPath, svgPathToBlob, encodeCoord } from './geometry'
export { stripJsonComments, parseJsonc, orderKeys } from './text'
export { FIELD_MAP, ENGINE_FIELD_NAMES, FIELD_VALUE_KINDS, D1_NODE_FIELDS, D2_NODE_FIELDS } from './field-map'
export type { FieldMapping, FieldTreatment, ValueKind } from './field-map'

/**
 * 解析 od 文本 → od 文档。
 *
 * - **JSONC 注释容忍**（规格 §6.1）：`//` 与 `/* *\/` 注释被剥离；字符串里的不算。
 * - **zod 校验**：结构不合法直接抛 `OdDecodeError`。
 */
export function parseOd(text: string): OdDocument {
  const raw = parseJsonc(text)
  const result = OdDocumentSchema.safeParse(raw)
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')
    throw new OdDecodeError(
      'OD1100',
      '',
      `od 文档不合法：${issues}`,
      `共 ${result.error.issues.length} 处问题`
    )
  }
  return result.data
}

/** 把 od 文档规范化写出（固定键序、2 空格缩进、LF、末尾单个换行）。 */
export { stringifyOd }

/** 公开的 JSON Schema（规格 §7）。 */
export function odDocumentJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(OdDocumentSchema, { io: 'input' }) as Record<string, unknown>
}
