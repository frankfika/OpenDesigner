/**
 * od-format 包入口。
 *
 * ⚠️ **完整 API 契约以 `docs/od-format-spec.md` §9 为准**（本文件只做导出汇总，
 * 不复制规格，避免两边漂移）。实现前先读规格 §9.2 的 API 清单。
 *
 * 预期公开 API（规格 §9.2）：
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
export const OD_FORMAT_VERSION = '0.1'
export const OD_FORMAT_PACKAGE_VERSION = '0.1.0'
