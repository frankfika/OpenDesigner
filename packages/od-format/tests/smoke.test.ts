import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { SceneGraph } from '@open-pencil/scene-graph'

describe('workspace 骨架自检', () => {
  it('zod 4 能用（record 要两个参数）', () => {
    const s = z.object({ a: z.string(), m: z.record(z.string(), z.unknown()) })
    expect(s.safeParse({ a: 'x', m: { k: 1 } }).success).toBe(true)
    expect(s.safeParse({ a: 1, m: {} }).success).toBe(false)
  })

  it('scene-graph 能建文档并注入确定性 id 生成器', () => {
    let n = 0
    const g = new SceneGraph(() => `fixed:${++n}`)
    expect(g.rootId).toBe('fixed:1')
    expect(g.nodes.size).toBeGreaterThan(0)
    const page = g.addPage('Page 1')
    expect(page.type).toBe('CANVAS')
  })
})
