/**
 * 变量绑定路径的翻译测试（规格 §3.5，MUST #21）。
 *
 * 白名单来自引擎的 `scene-graph/src/variables/fields.ts`：
 * `NUMERIC_FIELDS`（31）+ `STRING_BINDING_FIELDS`（2）+ `BOOLEAN_BINDING_FIELDS`（1）
 * + 两个带下标的颜色路径 = **36 条**。
 */
import { describe, expect, it } from 'vitest'

import {
  BINDING_PATH_COUNT,
  BINDING_PATH_INDEXED,
  BINDING_PATH_SCALARS,
  engineBindingPathToOd,
  isValidOdBindingPath,
  odBindingPathToEngine,
} from '../src/index.js'

/** 引擎白名单（抄自 `scene-graph/src/variables/fields.ts`）。 */
const ENGINE_NUMERIC = [
  'opacity',
  'width',
  'height',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight',
  'x',
  'y',
  'rotation',
  'cornerRadius',
  'topLeftRadius',
  'topRightRadius',
  'bottomLeftRadius',
  'bottomRightRadius',
  'strokeWeight',
  'borderTopWeight',
  'borderBottomWeight',
  'borderRightWeight',
  'borderLeftWeight',
  'fontSize',
  'letterSpacing',
  'lineHeight',
  'paddingLeft',
  'paddingRight',
  'paddingTop',
  'paddingBottom',
  'itemSpacing',
  'counterAxisSpacing',
  'gridRowGap',
  'gridColumnGap',
]
const ENGINE_STRING = ['text', 'fontFamily']
const ENGINE_BOOLEAN = ['visible']

describe('MUST #21 · 绑定路径翻译', () => {
  it('白名单总数是 36（31 数值 + 2 字符串 + 1 布尔 + 2 颜色）', () => {
    expect(ENGINE_NUMERIC).toHaveLength(31)
    expect(ENGINE_STRING).toHaveLength(2)
    expect(ENGINE_BOOLEAN).toHaveLength(1)
    expect(BINDING_PATH_INDEXED).toHaveLength(2)
    expect(BINDING_PATH_COUNT).toBe(36)
    expect(BINDING_PATH_SCALARS.size).toBe(34)
  })

  it('引擎白名单的每一条都有 od 侧对应（逐条双向）', () => {
    for (const field of [...ENGINE_NUMERIC, ...ENGINE_STRING, ...ENGINE_BOOLEAN]) {
      const od = engineBindingPathToOd(field)
      expect(od, field).toBeDefined()
      expect(odBindingPathToEngine(od!), field).toBe(field)
    }
  })

  it('带下标的颜色路径双向翻译', () => {
    for (const index of [0, 1, 7, 42]) {
      const engine = `fills/${index}/color`
      const od = engineBindingPathToOd(engine)!
      expect(od).toBe(`fills.${index}.color`)
      expect(odBindingPathToEngine(od)).toBe(engine)

      const engine2 = `strokes/${index}/color`
      const od2 = engineBindingPathToOd(engine2)!
      expect(od2).toBe(`strokes.${index}.color`)
      expect(odBindingPathToEngine(od2)).toBe(engine2)
    }
  })

  it('不在白名单里的路径翻译失败（返回 undefined）', () => {
    for (const bad of ['bogus', 'fills', 'fills/0', 'fills/0/opacity', 'fills.0.opacity']) {
      expect(engineBindingPathToOd(bad), bad).toBeUndefined()
      expect(odBindingPathToEngine(bad), bad).toBeUndefined()
      expect(isValidOdBindingPath(bad), bad).toBe(false)
    }
  })

  it('od 侧的前导零下标非法（OD1108）', () => {
    expect(isValidOdBindingPath('fills.00.color')).toBe(false)
    expect(odBindingPathToEngine('fills.00.color')).toBeUndefined()
    expect(isValidOdBindingPath('fills.0.color')).toBe(true)
  })

  it('引擎侧的前导零是合法的，但 od 侧不是 —— 翻译时必须拒绝', () => {
    // 引擎接受 fills/00/color（parseInt('00') === 0）
    // 但 od 侧 MUST NOT 有前导零 → 翻译返回 undefined，让 validate 报 OD1108
    expect(engineBindingPathToOd('fills/00/color')).toBeUndefined()
    expect(engineBindingPathToOd('fills/0/color')).toBe('fills.0.color')
  })

  it('翻译是双射（每个 od 路径只对应一个引擎路径）', () => {
    const odPaths = new Set<string>()
    for (const field of [...ENGINE_NUMERIC, ...ENGINE_STRING, ...ENGINE_BOOLEAN]) {
      odPaths.add(engineBindingPathToOd(field)!)
    }
    expect(odPaths.size).toBe(34)
  })
})
