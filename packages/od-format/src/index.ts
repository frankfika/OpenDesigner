/**
 * od-format 包入口（骨架占位，实现由 od-format 实现任务补齐）。
 *
 * 预期公开 API（见 docs/od-format-spec.md）：
 *   - OdDocumentSchema / OdDocument：od-format 文档模型（zod）
 *   - fromEngine(graph): OdDocument        引擎文档 → od 文档
 *   - toEngine(doc, opts): SceneGraph      od 文档 → 引擎文档
 *   - parseOd(text): OdDocument            文本 → od 文档（含 JSONC 注释容忍）
 *   - stringifyOd(doc): string             od 文档 → 文本
 *   - migrate(doc, from, to): OdDocument   版本迁移
 */
export const OD_FORMAT_VERSION = '0.1.0'

export {}
