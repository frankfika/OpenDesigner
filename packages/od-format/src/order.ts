/**
 * od 文档的**键序**（规格 §1.3 / §6.2）。
 *
 * 固定键序是硬要求：JSON 对象的键序在文本里可见，不固定 → 两次保存同一份文档可能键序不同
 * → diff 全是噪音 → **C2（diff 友好）破**。JSON 本身不保证键序，所以必须由写出版本主动保证。
 *
 * 顶层与结构键序来自规格 §1.1 / §1.3；**组内的叶子键序**从 `field-map.ts` 派生 ——
 * 那是引擎字段的声明顺序，经规格复核过，比手抄一份更可靠。
 */
import { FIELD_MAP } from './field-map'

/** od 文档顶层键的规范顺序（规格 §1.1）。 */
export const TOP_LEVEL_KEY_ORDER: readonly string[] = [
  'format',
  'version',
  'meta',
  'nodes',
  'assets',
  'variables',
  'variableSets',
  'themes',
  'libraries',
]

/** `meta` 对象的键序（规格 §1.2）。 */
export const META_KEY_ORDER: readonly string[] = [
  'generator',
  'engine',
  'colorSpace',
  'root',
  'ordinal',
]

/**
 * 节点对象的键序（规格 §1.3）：
 * 结构 → 几何 → 外观 → 画笔 → 矢量 → 栅格 → 文本 → 布局 → 描边 → 组件 → 变量 → 杂项。
 */
export const NODE_KEY_ORDER: readonly string[] = [
  'id',
  'type',
  'name',
  'parent',
  'children',
  'box',
  'limits',
  'appearance',
  'corners',
  'flip',
  'constraints',
  'styles',
  'fills',
  'strokes',
  'effects',
  'geometry',
  'shape',
  'grid',
  'guides',
  'text',
  'layout',
  'stroke',
  'borders',
  'component',
  'bindings',
  'export',
  'pluginData',
  'pluginRelaunch',
  'source',
]

/** `variables[]` 元素的键序（规格 §1.5）。 */
export const VARIABLE_KEY_ORDER: readonly string[] = [
  'id',
  'name',
  'type',
  'set',
  'values',
  'description',
  'hidden',
  'scopes',
  'unit',
  'expressions',
  'codeSyntax',
  'pluginData',
  'key',
  'version',
]

/** `variableSets[]` 元素的键序（规格 §1.5）。 */
export const VARIABLE_SET_KEY_ORDER: readonly string[] = [
  'id',
  'name',
  'defaultMode',
  'modeAttribute',
  'modes',
  'variables',
  'pluginData',
  'key',
  'version',
]

/** `variableSets[].modes[]` 元素的键序。 */
export const MODE_KEY_ORDER: readonly string[] = ['id', 'name', 'condition', 'sortPosition']

/** `libraries[]` 元素的键序（规格 §1.7）。 */
export const LIBRARY_KEY_ORDER: readonly string[] = ['id', 'revision', 'enabled']

/** `assets{}` 元素的键序（规格 §1.4）。 */
export const ASSET_KEY_ORDER: readonly string[] = ['file', 'mime', 'bytes']

/**
 * 组内的叶子键序表：`GROUP_CHILD_ORDER['text.font']` → `['size','family','weight',...]`。
 *
 * 键是组路径（含顶层组，如 `'box'`、`'text'`、`'text.font'`）。
 * 由 `FIELD_MAP` 的 od 路径派生 —— 顺序即引擎字段声明顺序。
 */
export const GROUP_CHILD_ORDER: ReadonlyMap<string, readonly string[]> = (() => {
  const order = new Map<string, string[]>()
  for (const mapping of FIELD_MAP) {
    if (mapping.od === null) continue
    const parts = mapping.od.split('.')
    // 每一层前缀都登记一次
    for (let depth = 1; depth <= parts.length; depth++) {
      const prefix = parts.slice(0, depth).join('.')
      const key = parts[depth - 1]!
      if (depth === parts.length) {
        // 叶子
        const list = order.get(prefix) ?? []
        if (!list.includes(key)) list.push(key)
        order.set(prefix, list)
      } else {
        // 中间层：登记为子对象
        const list = order.get(prefix) ?? []
        if (!list.includes(key)) list.push(key)
        order.set(prefix, list)
      }
    }
  }
  return order
})()

/** 该 od 路径是否是一个「组」（有已知的叶子键序）。 */
export function isGroupPath(path: string): boolean {
  return GROUP_CHILD_ORDER.has(path)
}
