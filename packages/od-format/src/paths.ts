/**
 * 变量绑定路径的双向翻译表（规格 §3.5，规范性）。
 *
 * 引擎的 `bindVariable(nodeId, field, variableId)` **只接受白名单字段名**，
 * 写错会抛 `Unknown binding field`。od 侧改了路径，所以必须有一张双向翻译表。
 *
 * - 引擎侧路径用**斜杠**分隔数组下标：`fills/0/color`（不是点号）
 * - od 侧路径用**点分**：`fills.0.color`
 *
 * 引擎的白名单在 `scene-graph/src/variables/fields.ts`：
 * `NUMERIC_FIELDS`（31 个）+ `STRING_BINDING_FIELDS`（text / fontFamily）
 * + `BOOLEAN_BINDING_FIELDS`（visible）+ 两个带下标的颜色路径 = **36 条**。
 *
 * ⚠️ 引擎接受前导零（`fills/00/color` 等价于 `fills/0/color`，因为 `parseInt('00') === 0`），
 * 但 od 侧 **MUST NOT** 有前导零（`fills.00.color` 非法 → `od validate` 报 OD1108）。
 */

/** 标量绑定路径：引擎字段名 → od 路径。 */
export const BINDING_PATH_SCALARS: ReadonlyMap<string, string> = new Map([
  // 数值（31 条）
  ['opacity', 'appearance.opacity'],
  ['width', 'box.width'],
  ['height', 'box.height'],
  ['minWidth', 'limits.minWidth'],
  ['maxWidth', 'limits.maxWidth'],
  ['minHeight', 'limits.minHeight'],
  ['maxHeight', 'limits.maxHeight'],
  ['x', 'box.x'],
  ['y', 'box.y'],
  ['rotation', 'box.rotation'],
  ['cornerRadius', 'corners.radius'],
  ['topLeftRadius', 'corners.topLeft'],
  ['topRightRadius', 'corners.topRight'],
  ['bottomLeftRadius', 'corners.bottomLeft'],
  ['bottomRightRadius', 'corners.bottomRight'],
  ['strokeWeight', 'stroke.weight'],
  ['borderTopWeight', 'borders.top'],
  ['borderBottomWeight', 'borders.bottom'],
  ['borderRightWeight', 'borders.right'],
  ['borderLeftWeight', 'borders.left'],
  ['fontSize', 'text.font.size'],
  ['letterSpacing', 'text.leading.letterSpacing'],
  ['lineHeight', 'text.leading.lineHeight'],
  ['paddingLeft', 'layout.padding.left'],
  ['paddingRight', 'layout.padding.right'],
  ['paddingTop', 'layout.padding.top'],
  ['paddingBottom', 'layout.padding.bottom'],
  ['itemSpacing', 'layout.gap'],
  ['counterAxisSpacing', 'layout.crossGap'],
  ['gridRowGap', 'grid.rowGap'],
  ['gridColumnGap', 'grid.columnGap'],
  // 字符串（2 条）
  ['text', 'text.content'],
  ['fontFamily', 'text.font.family'],
  // 布尔（1 条）
  ['visible', 'appearance.visible'],
])

/** 带数组下标的颜色绑定路径（2 条）。 */
export const BINDING_PATH_INDEXED: readonly {
  readonly engine: RegExp
  readonly od: RegExp
  readonly toOd: (index: string) => string
  readonly toEngine: (index: string) => string
}[] = [
  {
    engine: /^fills\/(\d+)\/color$/,
    od: /^fills\.(\d+)\.color$/,
    toOd: (i) => `fills.${i}.color`,
    toEngine: (i) => `fills/${i}/color`,
  },
  {
    engine: /^strokes\/(\d+)\/color$/,
    od: /^strokes\.(\d+)\.color$/,
    toOd: (i) => `strokes.${i}.color`,
    toEngine: (i) => `strokes/${i}/color`,
  },
]

/** 白名单条目总数（标量 34 + 带下标 2 = 36）。 */
export const BINDING_PATH_COUNT = BINDING_PATH_SCALARS.size + BINDING_PATH_INDEXED.length

/**
 * 引擎绑定路径 → od 绑定路径。返回 undefined 表示该路径不在白名单内。
 *
 * 带下标的路径里 `fills/00/color`（前导零）在引擎侧合法，但 od 侧不合法 ——
 * 这里返回 undefined，让 `od validate` 报 OD1108。
 */
export function engineBindingPathToOd(enginePath: string): string | undefined {
  const scalar = BINDING_PATH_SCALARS.get(enginePath)
  if (scalar !== undefined) return scalar
  for (const entry of BINDING_PATH_INDEXED) {
    const m = entry.engine.exec(enginePath)
    if (m?.[1] !== undefined) {
      // od 侧不允许前导零
      if (m[1].length > 1 && m[1].startsWith('0')) return undefined
      return entry.toOd(String(Number(m[1])))
    }
  }
  return undefined
}

/** od 绑定路径 → 引擎绑定路径。返回 undefined 表示该路径不在白名单内。 */
export function odBindingPathToEngine(odPath: string): string | undefined {
  for (const [engine, od] of BINDING_PATH_SCALARS) {
    if (od === odPath) return engine
  }
  for (const entry of BINDING_PATH_INDEXED) {
    const m = entry.od.exec(odPath)
    if (m?.[1] !== undefined) {
      if (m[1].length > 1 && m[1].startsWith('0')) return undefined
      return entry.toEngine(String(Number(m[1])))
    }
  }
  return undefined
}

/** 该 od 绑定路径是否合法（白名单内且无前导零）。 */
export function isValidOdBindingPath(odPath: string): boolean {
  return odBindingPathToEngine(odPath) !== undefined
}
