/**
 * 几何 blob ↔ SVG path 的无损性测试（规格 §6.4，MUST #12）。
 *
 * 判据是**逐字节相同** —— 不是「画出来一样」，是二进制完全一致。
 */
import { describe, expect, it } from 'vitest'

import { blobToSvgPath, encodeCoord, svgPathToBlob } from '../src/index.js'

/** 可复现的伪随机数（不依赖 Math.random，保证测试可重放）。 */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

describe('MUST #12 · 几何 blob 逐字节往返', () => {
  it('1000 条随机 blob → d → blob 逐字节相同', () => {
    const random = makeRandom(20261110)
    for (let i = 0; i < 1000; i++) {
      const parts: string[] = []
      const commands = 1 + Math.floor(random() * 6)
      for (let c = 0; c < commands; c++) {
        const pick = random()
        const coord = () => (random() * 2000 - 1000)
        if (pick < 0.25) parts.push(`M${coord().toFixed(3)} ${coord().toFixed(3)}`)
        else if (pick < 0.5) parts.push(`L${coord().toFixed(3)} ${coord().toFixed(3)}`)
        else if (pick < 0.75)
          parts.push(`Q${coord().toFixed(3)} ${coord().toFixed(3)} ${coord().toFixed(3)} ${coord().toFixed(3)}`)
        else
          parts.push(
            `C${coord().toFixed(3)} ${coord().toFixed(3)} ${coord().toFixed(3)} ${coord().toFixed(3)} ${coord().toFixed(3)} ${coord().toFixed(3)}`
          )
      }
      parts.push('Z')
      const d = parts.join(' ')
      const blob = svgPathToBlob(d)
      const back = svgPathToBlob(blobToSvgPath(blob))
      expect([...back], `第 ${i} 条：${d}`).toEqual([...blob])
    }
  })

  it('d 字符串只含允许的字符', () => {
    const d = blobToSvgPath(svgPathToBlob('M 1.5 -2.25 L 3 4 Z'))
    expect(d).toMatch(/^[0-9.\-+eE MLQCZ]*$/)
  })

  it('坐标不含 NaN / Infinity', () => {
    expect(() => encodeCoord(Number.NaN)).toThrow()
    expect(() => encodeCoord(Number.POSITIVE_INFINITY)).toThrow()
  })

  it('float32 精度：100.1 写成最短表示后仍能还原成同一个 float32', () => {
    const f = Math.fround(100.1)
    const s = encodeCoord(100.1)
    expect(Math.fround(Number(s))).toBe(f)
    // 最短表示：不应该写出 float32 的完整十进制展开
    expect(s.length).toBeLessThan('100.10000000149012'.length)
  })

  it('引擎的 blob 布局被正确解析（1 字节 opcode + float32 小端坐标对）', () => {
    // 手搓一个 blob：M(10,20) L(30,40) Z
    const bytes: number[] = []
    const push = (v: number) => {
      const buf = new ArrayBuffer(4)
      new DataView(buf).setFloat32(0, v, true)
      bytes.push(...new Uint8Array(buf))
    }
    bytes.push(1)
    push(10)
    push(20)
    bytes.push(2)
    push(30)
    push(40)
    bytes.push(0)
    const d = blobToSvgPath(Uint8Array.from(bytes))
    expect(d).toBe('M10 20 L30 40 Z')
  })

  it('二次 / 三次贝塞尔的参数顺序正确', () => {
    const quad = svgPathToBlob('Q1 2 3 4')
    expect([...quad]).toEqual([3, ...f32(1), ...f32(2), ...f32(3), ...f32(4)])
    const cubic = svgPathToBlob('C1 2 3 4 5 6')
    expect([...cubic]).toEqual([
      4, ...f32(1), ...f32(2), ...f32(3), ...f32(4), ...f32(5), ...f32(6),
    ])
  })

  it('未知 opcode 报错而不是静默截断', () => {
    expect(() => blobToSvgPath(Uint8Array.from([99, 0, 0, 0]))).toThrow()
  })

  it('不支持的 SVG 命令报错', () => {
    expect(() => svgPathToBlob('A 1 2 3 4 5 6 7 8')).toThrow()
  })
})

function f32(v: number): number[] {
  const buf = new ArrayBuffer(4)
  new DataView(buf).setFloat32(0, v, true)
  return [...new Uint8Array(buf)]
}
