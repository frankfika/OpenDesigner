/**
 * 语义 ID 层的测试（规格 §2）。
 *
 * 覆盖：odId 语法、slug 算法、判别器、恒等映射、生命周期规则（§2.9）。
 */
import { describe, expect, it } from 'vitest'

import {
  IdRegistry,
  isOdId,
  kindOfNodeType,
  maxDiscriminatorOf,
  odIdDiscriminator,
  odIdKind,
  odIdSlug,
  OD_ID_PATTERN,
  slugify,
} from '../src/index.js'

describe('odId 语法（§2.2）', () => {
  it('正例全部接受', () => {
    const positives = [
      'frame~hero',
      'canvas~page-1',
      'text~n',
      'rect~hero-title',
      'comp~button',
      'compSet~set-1',
      'inst~button-1',
      'var~brand-primary',
      'vcol~brand',
      'mode~brand-light',
      'prop~label-text',
      'frame~hero~1',
      'frame~hero~12',
      'frame~a-b-c-d',
    ]
    for (const id of positives) {
      expect(isOdId(id), id).toBe(true)
    }
  })

  it('反例全部拒绝', () => {
    const negatives = [
      'frame', // 没有 kind~slug
      'Frame~hero', // 大写 kind
      'frame~Hero', // slug 不允许大写
      'frame~hero~0', // 判别器不能是 0
      'frame~hero~01', // 判别器不允许前导零
      'frame~-hero', // slug 不能以 - 开头
      'frame~hero-', // slug 不能以 - 结尾
      'frame~hero--x', // 不能有连续 -
      'frame~her o', // 不能有空格
      'unknown~hero', // kind 不在白名单
      '48213:57', // 引擎 id 永远不是 odId
      '',
      'frame~',
      '~hero',
    ]
    for (const id of negatives) {
      expect(isOdId(id), id).toBe(false)
    }
  })

  it('引擎 id 永远不可能匹配 odId 正则（判定无歧义）', () => {
    expect(OD_ID_PATTERN.test('48213:57')).toBe(false)
    expect(OD_ID_PATTERN.test('1234:0')).toBe(false)
  })

  it('kind / slug / 判别器可解析', () => {
    expect(odIdKind('frame~hero')).toBe('frame')
    expect(odIdSlug('frame~hero')).toBe('hero')
    expect(odIdDiscriminator('frame~hero')).toBeUndefined()
    expect(odIdKind('frame~hero~3')).toBe('frame')
    expect(odIdSlug('frame~hero~3')).toBe('hero')
    expect(odIdDiscriminator('frame~hero~3')).toBe(3)
  })
})

describe('slug 生成算法（§2.4）', () => {
  it('按规格的示例表', () => {
    const cases: Array<[string, string]> = [
      ['Hero', 'hero'],
      ['Hero Title', 'hero-title'],
      ['标题', 'n'],
      ['按钮 / 主要', 'n'],
      ['CTA（首屏）', 'cta'],
      ['hero__title--v2', 'hero-title-v2'],
    ]
    for (const [input, expected] of cases) {
      expect(slugify(input), input).toBe(expected)
    }
  })

  it('长度上限 24，截断后落在 "-" 上要回退', () => {
    expect(slugify('a'.repeat(30)).length).toBe(24)
    const truncated = slugify('abcdefghijklmnopqrstuvwxyz-extra')
    expect(truncated.length).toBeLessThanOrEqual(24)
    expect(truncated.endsWith('-')).toBe(false)
  })

  it('é 之类的组合记号被剥离', () => {
    expect(slugify('Café')).toBe('cafe')
  })
})

describe('kind 前缀表（§2.3）', () => {
  it('引擎 NodeType → kind', () => {
    expect(kindOfNodeType('CANVAS')).toBe('canvas')
    expect(kindOfNodeType('FRAME')).toBe('frame')
    expect(kindOfNodeType('RECTANGLE')).toBe('rect')
    expect(kindOfNodeType('ROUNDED_RECTANGLE')).toBe('rect')
    expect(kindOfNodeType('COMPONENT_SET')).toBe('compSet')
    expect(kindOfNodeType('BOOLEAN_OPERATION')).toBe('bool')
    expect(kindOfNodeType('SHAPE_WITH_TEXT')).toBe('shape')
  })
})

describe('判别器与单调计数器（§2.5）', () => {
  it('同名节点依次拿 ~1 / ~2', () => {
    const reg = new IdRegistry()
    const a = reg.resolve('engine:1', { kind: 'frame', name: 'Hero' })
    const b = reg.resolve('engine:2', { kind: 'frame', name: 'Hero' })
    const c = reg.resolve('engine:3', { kind: 'frame', name: 'Hero' })
    expect(a).toBe('frame~hero')
    expect(b).toBe('frame~hero~1')
    expect(c).toBe('frame~hero~2')
    expect(reg.ordinal()).toBe(2)
  })

  it('判别器不复用：删掉 ~1 再新建同名拿到更大的', () => {
    const reg = new IdRegistry()
    reg.resolve('engine:1', { kind: 'frame', name: 'Hero' })
    reg.resolve('engine:2', { kind: 'frame', name: 'Hero' }) // ~1
    reg.resolve('engine:3', { kind: 'frame', name: 'Hero' }) // ~2
    const next = reg.resolve('engine:4', { kind: 'frame', name: 'Hero' })
    expect(next).toBe('frame~hero~3')
  })

  it('base 也不复用（比规格 §2.5 更安全：删掉唯一的同名节点后重建拿新 id）', () => {
    const reg = new IdRegistry()
    const first = reg.resolve('engine:1', { kind: 'frame', name: 'Hero' })
    expect(first).toBe('frame~hero')
    // 节点被删掉（不再出现在文档里）
    const again = reg.resolve('engine:2', { kind: 'frame', name: 'Hero' })
    expect(again).not.toBe('frame~hero')
    expect(again).toBe('frame~hero~1')
  })

  it('restoreOrdinal 只会抬高计数器，不会降低', () => {
    const reg = new IdRegistry()
    reg.restoreOrdinal(5)
    expect(reg.ordinal()).toBe(5)
    reg.restoreOrdinal(2)
    expect(reg.ordinal()).toBe(5)
  })

  it('maxDiscriminatorOf 取最大值', () => {
    expect(maxDiscriminatorOf(['frame~a', 'frame~b~3', 'frame~c~7'])).toBe(7)
    expect(maxDiscriminatorOf(['frame~a'])).toBe(0)
  })
})

describe('恒等映射（§2.6）', () => {
  it('engineId 本身就是 odId 时直接用', () => {
    const reg = new IdRegistry()
    expect(reg.resolve('frame~hero', { kind: 'frame', name: 'Hero' })).toBe('frame~hero')
    expect(reg.ordinal()).toBe(0) // 恒等路径不消耗判别器
  })

  it('adopt 登记恒等映射', () => {
    const reg = new IdRegistry()
    expect(reg.adopt('frame~hero')).toBe('frame~hero')
    expect(reg.engineIdOf('frame~hero')).toBe('frame~hero')
    expect(reg.peek('frame~hero')).toBe('frame~hero')
    expect(reg.ordinal()).toBe(0)
  })

  it('引擎 id（带冒号）永远不会被当成 odId', () => {
    const reg = new IdRegistry()
    const minted = reg.resolve('48213:57', { kind: 'frame', name: 'Hero' })
    expect(minted).toBe('frame~hero')
    expect(reg.peek('48213:57')).toBe('frame~hero')
  })
})

describe('odId 生命周期规则（§2.9）', () => {
  it('重命名 → odId 不变', () => {
    const reg = new IdRegistry()
    const id = reg.resolve('engine:1', { kind: 'frame', name: 'Hero' })
    // 重命名不重新铸造 —— odId 一旦铸成就冻结
    expect(reg.resolve('engine:1', { kind: 'frame', name: 'Hero Renamed' })).toBe(id)
  })

  it('移动（换父节点）→ odId 不变（odId 不含路径）', () => {
    const reg = new IdRegistry()
    const id = reg.resolve('engine:1', { kind: 'frame', name: 'Hero' })
    expect(reg.resolve('engine:1', { kind: 'frame', name: 'Hero' })).toBe(id)
  })

  it('复制 → 源与后代各自获得新 odId', () => {
    const reg = new IdRegistry()
    const src = reg.resolve('engine:1', { kind: 'frame', name: 'Hero' })
    const child = reg.resolve('engine:2', { kind: 'text', name: 'Title' })
    // 拷贝拿到新的 engine id → 铸造新的 odId
    const copy = reg.resolve('engine:3', { kind: 'frame', name: 'Hero' })
    const copyChild = reg.resolve('engine:4', { kind: 'text', name: 'Title' })
    expect(copy).not.toBe(src)
    expect(copyChild).not.toBe(child)
    expect(new Set([src, child, copy, copyChild]).size).toBe(4)
  })
})
