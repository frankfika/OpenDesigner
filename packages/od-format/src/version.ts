/**
 * od-format 的版本常量。
 *
 * - `OD_FORMAT_VERSION` 是**格式版本**（MAJOR.MINOR），写在 od 文档的 `version` 字段里。
 * - `OD_FORMAT_PACKAGE_VERSION` 是**包版本**，写在 `meta.generator` 里。
 *
 * 两者推进节奏不同：格式版本只在**破坏性**变更时 +1（迁移器负责把老文档升上来）；
 * 包版本跟随每次发版（含 bug 修复），它只影响 `meta.generator` 那一行的 diff。
 */
export const OD_FORMAT_VERSION = '0.1'
export const OD_FORMAT_PACKAGE_VERSION = '0.1.0'

/** od 文档的格式标识，固定字面量。 */
export const OD_FORMAT_ID = 'od'

/** od 文档的 MIME / 文件扩展名约定。 */
export const OD_FILE_EXTENSION = '.od.json'
