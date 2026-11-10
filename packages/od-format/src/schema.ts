/**
 * od 文档的 zod schema（规格 §7）。
 *
 * 设计要点：
 *
 * 1. **一律用 `looseObject`** —— zod 默认的 `object` 会**剥掉**未知键。
 *    od 格式要能承载引擎的全部字段（未来引擎加字段，旧版 od-format 也不该把数据吃掉）。
 *    未知键的处置交给 `od validate`（OD1103 warning / OD1303 warning），不在 schema 层拒绝。
 *
 * 2. **一切字段 optional** —— 省略 = 等于引擎默认值（规则 E1）。schema 不表达默认值语义。
 *
 * 3. **节点的组 schema 从 `field-map.ts` 派生** —— schema 与字段映射表**同源**，
 *    不会互相漂移（MUST 测试 #15「schema 同步」就是断言这一点）。
 */
import { z } from 'zod'

import { FIELD_MAP, FIELD_VALUE_KINDS, type ValueKind } from './field-map'
import { OD_ID_PATTERN } from './ids'

/** odId 的 schema（规格 §2.2 的完整正则）。 */
export const OdIdSchema = z.string().regex(OD_ID_PATTERN, '不是合法的 odId')

/** 自由格式对象（引擎的 `Record<string, X>` / `Map<string, X>` 编码后）。 */
const FreeObjectSchema = z.record(z.string(), z.unknown())

/** 自由格式数组。 */
const FreeArraySchema = z.array(z.unknown())

/** 值类别 → zod 叶子类型。 */
function leafSchema(kind: ValueKind): z.ZodType {
  switch (kind) {
    case 'number':
      return z.number()
    case 'string':
      return z.string()
    case 'boolean':
      return z.boolean()
    case 'enum':
      return z.string()
    case 'literal-union':
      return z.union([z.number(), z.string(), z.boolean()])
    case 'array':
      return FreeArraySchema
    case 'binary':
      return z.string()
    case 'null':
      return z.null()
    case 'object':
    case 'unknown':
    default:
      return FreeObjectSchema
  }
}

/** od 路径 → 引擎字段名（FIELD_MAP 的反向索引）。 */
export const OD_PATH_TO_ENGINE: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>()
  for (const mapping of FIELD_MAP) {
    if (mapping.od === null) continue
    if (!m.has(mapping.od)) m.set(mapping.od, mapping.engine)
  }
  return m
})()

// ---------------------------------------------------------------------------
// 特殊形状的 override（这些字段不能只靠「引擎类型」推出 schema）
// ---------------------------------------------------------------------------

/** `source` —— 只保留 4 个字段，丢弃 `.fig` 载荷（规格 §3.3）。 */
const SourceSchema = z.looseObject({
  format: z.string().nullable().optional(),
  id: z.string().nullable().optional(),
  orderKey: z.string().nullable().optional(),
  editedFields: z.array(z.string()).optional(),
})

/** override 的三态值：`{ defined: false }` 表示「键存在但值为 undefined」。 */
const OverrideValueSchema = z.looseObject({
  defined: z.boolean(),
  value: z.unknown().optional(),
})

/** `component.overrides` —— 直接采用上游 `SerializedInstanceOverrideState` 的形状。 */
const OverridesSchema = z.looseObject({
  self: z.array(z.tuple([z.string(), OverrideValueSchema])),
  descendants: z.array(
    z.tuple([z.string(), z.array(z.tuple([z.string(), OverrideValueSchema]))])
  ),
})

/** 几何路径项：`commandsBlob` 已编码成 SVG path `d`。 */
const GeometryPathSchema = z.looseObject({
  windingRule: z.string(),
  d: z.string(),
  fills: FreeArraySchema.optional(),
  fillStyleId: z.string().nullable().optional(),
})

/** 组件属性定义。 */
const ComponentPropertySchema = z.looseObject({
  id: OdIdSchema,
  name: z.string(),
  type: z.string(),
  defaultValue: z.string(),
  variantOptions: z.array(z.string()).optional(),
  preferredValues: z.array(z.string()).optional(),
  description: z.string().optional(),
  slotSettings: z.unknown().optional(),
})

/** 组件属性引用。 */
const ComponentPropertyRefSchema = z.looseObject({
  propertyId: OdIdSchema,
  field: z.string(),
})

/** 变体属性。 */
const VariantPropSchema = z.looseObject({
  propDefId: OdIdSchema,
  value: z.string(),
})

/** od 路径 → 覆盖用的 schema。 */
const OD_PATH_OVERRIDES: ReadonlyMap<string, z.ZodType> = new Map<string, z.ZodType>([
  ['source', SourceSchema],
  ['bindings.fields', z.record(z.string(), z.string())],
  ['bindings.scales', z.record(z.string(), z.number())],
  ['bindings.assignmentScales', z.record(z.string(), z.number())],
  ['bindings.modes', z.record(z.string(), z.string())],
  ['component.overrides', OverridesSchema],
  ['geometry.fill', z.array(GeometryPathSchema)],
  ['geometry.stroke', z.array(GeometryPathSchema)],
  ['component.properties', z.array(ComponentPropertySchema)],
  ['component.propertyRefs', z.array(ComponentPropertyRefSchema)],
  ['component.variants', z.array(VariantPropSchema)],
  ['component.assignments', FreeObjectSchema],
  ['component.values', FreeObjectSchema],
])

/** 结构字段不参与「组」schema（单独定义）。 */
const STRUCTURAL_OD_PATHS: ReadonlySet<string> = new Set(['id', 'type', 'name', 'parent', 'children'])

// ---------------------------------------------------------------------------
// 节点组的 schema：从 FIELD_MAP 派生
// ---------------------------------------------------------------------------

interface SchemaTreeNode {
  readonly children: Map<string, SchemaTreeNode>
  leaf?: boolean
}

function buildTree(paths: readonly string[]): SchemaTreeNode {
  const root: SchemaTreeNode = { children: new Map() }
  for (const path of paths) {
    const parts = path.split('.')
    let cur = root
    for (const part of parts) {
      let next = cur.children.get(part)
      if (!next) {
        next = { children: new Map() }
        cur.children.set(part, next)
      }
      cur = next
    }
    cur.leaf = true
  }
  return root
}

/**
 * 把一棵 schema 树编译成 zod 对象 schema。
 *
 * `originalOf` 把**当前版本的相对路径**映射回**v0.1 的相对路径** ——
 * 叶子类型必须按 v0.1 的字段查（引擎字段表是按 v0.1 的 od 路径建的），
 * 否则新版本的字段会退化成「未知类型」。
 */
function treeToSchema(
  node: SchemaTreeNode,
  prefix: string,
  relPrefix: string,
  originalOf: (rel: string) => string
): z.ZodType {
  const shape: Record<string, z.ZodType> = {}
  for (const [key, child] of node.children) {
    const rel = relPrefix ? `${relPrefix}.${key}` : key
    const path = prefix ? `${prefix}.${key}` : key
    if (child.leaf) {
      const original = originalOf(rel)
      const override = OD_PATH_OVERRIDES.get(original)
      if (override) {
        shape[key] = override.optional()
        continue
      }
      const engineField = OD_PATH_TO_ENGINE.get(original)
      const kind = engineField ? (FIELD_VALUE_KINDS[engineField] ?? 'unknown') : 'unknown'
      shape[key] = leafSchema(kind).optional()
    } else {
      shape[key] = treeToSchema(child, path, rel, originalOf).optional()
    }
  }
  return z.looseObject(shape)
}

/** 组路径 → 该组的 od 路径列表（不含结构字段）。 */
const GROUP_PATHS: readonly string[] = (() => {
  const seen = new Set<string>()
  for (const mapping of FIELD_MAP) {
    if (mapping.od === null) continue
    if (STRUCTURAL_OD_PATHS.has(mapping.od)) continue
    seen.add(mapping.od)
  }
  return [...seen]
})()

/** 顶层组名（如 `box` / `text` / `text.font` 的顶层 `text`）。 */
const TOP_GROUPS: readonly string[] = (() => {
  const seen = new Set<string>()
  for (const p of GROUP_PATHS) seen.add(p.split('.')[0]!)
  return [...seen]
})()

/**
 * od 路径变换 —— 用来派生**新版本**的 schema（每个历史版本的 schema 必须冻结）。
 *
 * 返回新路径；返回 null 表示该字段在新版本里不存在（被删掉）。
 */
export type OdPathTransform = (odPath: string) => string | null

/** 按（可能变换过的）od 路径构建各组的 schema。 */
function buildGroupShapes(transform?: OdPathTransform): Record<string, z.ZodType> {
  // 先算出每个引擎字段的新路径
  const entries: Array<{ original: string; current: string }> = []
  for (const mapping of FIELD_MAP) {
    if (mapping.od === null) continue
    if (STRUCTURAL_OD_PATHS.has(mapping.od)) continue
    const next = transform ? transform(mapping.od) : mapping.od
    if (next === null) continue
    entries.push({ original: mapping.od, current: next })
  }

  const groups = new Set<string>()
  for (const e of entries) groups.add(e.current.split('.')[0]!)

  const out: Record<string, z.ZodType> = {}
  for (const group of groups) {
    const paths = entries.filter((e) => e.current === group || e.current.startsWith(`${group}.`))
    // 「单路径组」的值本身就是那个值（fills/strokes/effects/guides/export/source…），
    // 不是包一层对象。只有多路径组才是 `{ 叶子: 值 }` 的嵌套结构。
    if (paths.length === 1 && paths[0]!.current === group) {
      const original = paths[0]!.original
      const override = OD_PATH_OVERRIDES.get(original)
      if (override) {
        out[group] = override.optional()
      } else {
        const engineField = OD_PATH_TO_ENGINE.get(original)
        const kind = engineField ? (FIELD_VALUE_KINDS[engineField] ?? 'unknown') : 'unknown'
        out[group] = leafSchema(kind).optional()
      }
      continue
    }
    // 树要用**相对组名**的路径（否则每个组里会多嵌一层组名）
    const relative = paths.map((e) => e.current.slice(group.length + 1))
    // 当前版本的相对路径 → **原始（v0.1）的完整路径**。
    // 注意：原始路径的首段可能与当前组名不同（v1.0 把 appearance.* 改名成 style.*），
    // 所以查表必须用原始的完整路径 —— 引擎字段表是按 v0.1 的 od 路径建的。
    const originalFull = new Map<string, string>()
    paths.forEach((e, i) => {
      originalFull.set(relative[i]!, e.original)
    })
    out[group] = treeToSchema(buildTree(relative), group, '', (rel) => {
      return originalFull.get(rel) ?? `${group}.${rel}`
    }).optional()
  }
  return out
}

/** 构建某个版本的节点 schema。 */
export function buildOdNodeSchema(transform?: OdPathTransform): z.ZodType {
  return z.looseObject({
    id: OdIdSchema,
    type: z.string(),
    name: z.string(),
    parent: OdIdSchema.optional(),
    children: z.array(OdIdSchema),
    ...buildGroupShapes(transform),
  })
}

/** od 节点对象的 schema（当前版本 = v0.1）—— **冻结**，历史版本不再修改。 */
export const OdNodeSchema = z.looseObject({
  id: OdIdSchema,
  type: z.string(),
  name: z.string(),
  parent: OdIdSchema.optional(),
  children: z.array(OdIdSchema),
  ...buildGroupShapes(),
})

/** `meta` 的 schema。 */
export const OdMetaSchema = z.looseObject({
  generator: z.string().optional(),
  engine: z.string().optional(),
  colorSpace: z.string().optional(),
  root: OdIdSchema,
  ordinal: z.number().int().nonnegative().optional(),
})

/** `assets{}` 元素的 schema（外部二进制资源，规格 §1.4）。 */
export const OdAssetSchema = z.looseObject({
  file: z.string(),
  mime: z.string(),
  bytes: z.number().int().nonnegative(),
})

/** `variables[]` 元素的 schema（规格 §1.5）。 */
export const OdVariableSchema = z.looseObject({
  id: OdIdSchema,
  name: z.string(),
  type: z.string(),
  set: OdIdSchema.optional(),
  values: z.record(z.string(), z.unknown()).optional(),
  description: z.string().optional(),
  hidden: z.boolean().optional(),
  scopes: z.array(z.string()).optional(),
  unit: z.string().optional(),
  expressions: z.record(z.string(), z.unknown()).optional(),
  codeSyntax: z.record(z.string(), z.string()).optional(),
  pluginData: FreeArraySchema.optional(),
  key: z.string().optional(),
  version: z.string().optional(),
})

/** `variableSets[].modes[]` 元素的 schema。 */
export const OdModeSchema = z.looseObject({
  id: OdIdSchema,
  name: z.string(),
  condition: z.string().optional(),
  sortPosition: z.string().optional(),
})

/** `variableSets[]` 元素的 schema。 */
export const OdVariableSetSchema = z.looseObject({
  id: OdIdSchema,
  name: z.string(),
  defaultMode: OdIdSchema.optional(),
  modeAttribute: z.string().optional(),
  modes: z.array(OdModeSchema),
  variables: z.array(OdIdSchema).optional(),
  pluginData: FreeArraySchema.optional(),
  key: z.string().optional(),
  version: z.string().optional(),
})

/** `themes` 的 schema（规格 §1.6）。 */
export const OdThemesSchema = z.looseObject({
  active: z.record(z.string(), z.string()).optional(),
})

/** `libraries[]` 元素的 schema（规格 §1.7）。 */
export const OdLibrarySchema = z.looseObject({
  id: z.string(),
  revision: z.string(),
  enabled: z.boolean(),
})

/** 构建某个版本的文档 schema（规格 §1.1 的 9 个顶层键）。 */
export function buildOdDocumentSchema(transform?: OdPathTransform): z.ZodType {
  return z.looseObject({
    format: z.literal('od'),
    version: z.string(),
    meta: OdMetaSchema,
    nodes: z.array(buildOdNodeSchema(transform)),
    assets: z.record(z.string(), OdAssetSchema),
    variables: z.array(OdVariableSchema),
    variableSets: z.array(OdVariableSetSchema),
    themes: OdThemesSchema,
    libraries: z.array(OdLibrarySchema),
  })
}

/** od 文档的 schema（当前版本 = v0.1）—— **冻结**，历史版本不再修改。 */
export const OdDocumentSchema = z.looseObject({
  format: z.literal('od'),
  version: z.string(),
  meta: OdMetaSchema,
  nodes: z.array(OdNodeSchema),
  assets: z.record(z.string(), OdAssetSchema),
  variables: z.array(OdVariableSchema),
  variableSets: z.array(OdVariableSetSchema),
  themes: OdThemesSchema,
  libraries: z.array(OdLibrarySchema),
})

export type OdDocument = z.infer<typeof OdDocumentSchema>
export type OdNode = z.infer<typeof OdNodeSchema>
export type OdVariable = z.infer<typeof OdVariableSchema>
export type OdVariableSet = z.infer<typeof OdVariableSetSchema>
export type OdMeta = z.infer<typeof OdMetaSchema>
export type OdAsset = z.infer<typeof OdAssetSchema>
export type OdLibrary = z.infer<typeof OdLibrarySchema>
export type OdMode = z.infer<typeof OdModeSchema>
