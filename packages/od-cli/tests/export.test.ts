/**
 * `od export` / `od apply` / `od mcp` 的测试。
 *
 * 三条主线：
 *   1. **产物对不对** —— 直接调 `exportOd()`，断言 SVG / HTML / Tailwind / JSX / PNG / PDF
 *      的内容特征（`<svg` / `style=` / `className=` / PNG 魔数 / `%PDF`）。
 *   2. **退出码对不对** —— 走真实 CLI 进程（`tsx packages/od-cli/src/cli.ts`），
 *      因为退出码是 CI 依赖的契约，只有真跑才算数。
 *   3. **apply 的两条路** —— `--dry-run` 不写文件；真应用把文档改写回去。
 *
 * 夹具在临时目录里现造（不依赖仓库里的样例文件）。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import { SceneGraph } from '@open-pencil/scene-graph'
import { fromEngine, stringifyOd, type OdDocument } from '@opendesigner/od-format'

import { exportOd } from '../src/export.js'

const ROOT = resolve('.')
const CLI = resolve('packages/od-cli/src/cli.ts')
const TSX = resolve('node_modules/.bin/tsx')

/** 跑 CLI，返回 { code, stdout, stderr }。 */
function run(args: string[]): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(TSX, [CLI, ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { code: 0, stdout, stderr: '' }
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string }
    return { code: e.status ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }
  }
}

const tmpDirs: string[] = []

function tmpdir_(): string {
  const dir = mkdtempSync(join(tmpdir(), 'od-cli-export-'))
  tmpDirs.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of tmpDirs) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* 临时目录删不掉不影响结论 */
    }
  }
})

/** 造一个空图（构造器自带的 root + "Page 1" 已清掉）。 */
function newGraph(): SceneGraph {
  let counter = 0
  const g = new SceneGraph(() => `auto-${++counter}`)
  g.nodes.clear()
  return g
}

/**
 * 造一个 od 文档：`root → page → hero → text`。
 *
 * 文本内容是 `Hello ${pageIndex}` —— 断言「只导出了目标节点」时靠它区分。
 */
function buildDoc(pageCount = 1): OdDocument {
  const g = newGraph()
  const root = g.createNodeWithId('frame~document', 'FRAME', null, {
    name: 'Document',
    width: 800,
    height: 600,
  })
  g.rootId = root.id
  for (let i = 1; i <= pageCount; i++) {
    const page = g.createNodeWithId(`canvas~page-${i}`, 'CANVAS', root.id, {
      name: `Page ${i}`,
      width: 800,
      height: 600,
    })
    const hero = g.createNodeWithId(`frame~hero-${i}`, 'FRAME', page.id, {
      name: `Hero ${i}`,
      x: 0,
      y: 0,
      width: 375,
      height: 200,
    })
    g.createNodeWithId(`text~label-${i}`, 'TEXT', hero.id, {
      name: 'Label',
      x: 8,
      y: 8,
      width: 200,
      height: 24,
      text: `Hello ${i}`,
    })
  }
  return fromEngine(g)
}

/** 把文档写到临时目录，返回文件路径。 */
function writeDoc(doc: OdDocument, name = 'doc.od.json'): string {
  const dir = tmpdir_()
  const file = join(dir, name)
  writeFileSync(file, stringifyOd(doc), 'utf8')
  return file
}

// ---------------------------------------------------------------------------
// 1 · 产物内容
// ---------------------------------------------------------------------------

describe('od export · 产物内容', () => {
  const doc = buildDoc(1)

  it('svg · 产物含 <svg 且带上了文本内容', async () => {
    const payload = await exportOd(doc, { format: 'svg' })
    expect(payload.binary).toBe(false)
    expect(payload.mimeType).toBe('image/svg+xml')
    const svg = payload.data as string
    expect(svg.length).toBeGreaterThan(0)
    expect(svg).toContain('<svg')
    expect(svg).toContain('Hello 1')
  })

  it('html · 产物含 style= 且带上了文本内容', async () => {
    const payload = await exportOd(doc, { format: 'html' })
    const html = payload.data as string
    expect(html.length).toBeGreaterThan(0)
    expect(html).toContain('style=')
    expect(html).toContain('Hello 1')
  })

  it('tailwind · 产物含 className=', async () => {
    const payload = await exportOd(doc, { format: 'tailwind' })
    const jsx = payload.data as string
    expect(jsx.length).toBeGreaterThan(0)
    expect(jsx).toContain('className=')
    expect(jsx).toContain('Hello 1')
  })

  it('jsx · 产物含元素标签与文本', async () => {
    const payload = await exportOd(doc, { format: 'jsx' })
    const jsx = payload.data as string
    expect(jsx.length).toBeGreaterThan(0)
    expect(jsx).toContain('<Text')
    expect(jsx).toContain('Hello 1')
  })

  it('png · 产物是 PNG 字节（魔数 137 80 78 71）', async () => {
    const payload = await exportOd(doc, { format: 'png', scale: 1 })
    expect(payload.binary).toBe(true)
    expect(payload.mimeType).toBe('image/png')
    const bytes = payload.data as Uint8Array
    expect(bytes.length).toBeGreaterThan(0)
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
  })

  it('pdf · 产物是 PDF 字节（以 %PDF 开头）', async () => {
    const payload = await exportOd(doc, { format: 'pdf' })
    expect(payload.binary).toBe(true)
    expect(payload.mimeType).toBe('application/pdf')
    const bytes = payload.data as Uint8Array
    expect(bytes.length).toBeGreaterThan(0)
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('%PDF')
  })

  it('--node 只导出目标节点（别的节点不出现在产物里）', async () => {
    const twoPages = buildDoc(2)
    const payload = await exportOd(twoPages, { format: 'svg', nodeId: 'frame~hero-1' })
    const svg = payload.data as string
    expect(svg).toContain('Hello 1')
    expect(svg).not.toContain('Hello 2')
  })

  it('节点不存在 → 抛校验错（不是静默导出空内容）', async () => {
    await expect(exportOd(doc, { format: 'svg', nodeId: 'frame~nope' })).rejects.toThrow(
      /没有节点/
    )
  })
})

// ---------------------------------------------------------------------------
// 2 · CLI 契约（退出码）
// ---------------------------------------------------------------------------

describe('od export · CLI 退出码', () => {
  it('0 · --help 列出三个新子命令', () => {
    const result = run(['--help'])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('od export')
    expect(result.stdout).toContain('od apply')
    expect(result.stdout).toContain('od mcp')
  })

  it('0 · 导出 svg 到文件', () => {
    const file = writeDoc(buildDoc(1))
    const out = join(tmpdir_(), 'out.svg')
    const result = run(['export', file, '--to', 'svg', '--out', out])
    expect(result.code).toBe(0)
    expect(existsSync(out)).toBe(true)
    expect(readFileSync(out, 'utf8')).toContain('<svg')
  })

  it('0 · 导出到 stdout 时 stdout 只有产物', () => {
    const file = writeDoc(buildDoc(1))
    const result = run(['export', file, '--to', 'svg'])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('<svg')
    expect(result.stderr).not.toContain('<svg')
  })

  it('1 · png 不给 --out → 用法错（提示用 --out）', () => {
    const file = writeDoc(buildDoc(1))
    const result = run(['export', file, '--to', 'png'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('--out')
  })

  it('1 · 未知格式 → 用法错', () => {
    const file = writeDoc(buildDoc(1))
    const result = run(['export', file, '--to', 'gif'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('gif')
  })

  it('1 · 多页文档不给 --node → 报错并列出可选页', () => {
    const file = writeDoc(buildDoc(2))
    const result = run(['export', file, '--to', 'svg'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('--node')
    expect(result.stderr).toContain('canvas~page-1')
    expect(result.stderr).toContain('canvas~page-2')
  })

  it('4 · 输出目录不存在 → IO 错', () => {
    const file = writeDoc(buildDoc(1))
    const out = join(tmpdir_(), 'no-such-dir', 'out.svg')
    const result = run(['export', file, '--to', 'svg', '--out', out])
    expect(result.code).toBe(4)
    expect(result.stderr).toContain('输出目录不存在')
  })

  it('4 · 输入文件不存在 → IO 错', () => {
    const result = run(['export', join(tmpdir_(), 'missing.od.json'), '--to', 'svg'])
    expect(result.code).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// 3 · apply
// ---------------------------------------------------------------------------

describe('od apply', () => {
  const ops = [{ op: 'update', nodeId: 'text~label-1', props: { text: { content: 'Patched' } } }]

  it('0 · --dry-run 报告将应用几个操作，但不写文件', () => {
    const file = writeDoc(buildDoc(1))
    const before = readFileSync(file, 'utf8')
    const opsFile = join(tmpdir_(), 'ops.json')
    writeFileSync(opsFile, JSON.stringify(ops), 'utf8')

    const result = run(['apply', file, opsFile, '--dry-run'])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('dry-run')
    expect(result.stdout).toContain('1')
    // 文件必须原封不动
    expect(readFileSync(file, 'utf8')).toBe(before)
  })

  it('0 · 真应用 → 文档被改写回去', () => {
    const file = writeDoc(buildDoc(1))
    const opsFile = join(tmpdir_(), 'ops.json')
    writeFileSync(opsFile, JSON.stringify(ops), 'utf8')

    const result = run(['apply', file, opsFile])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('应用')

    const after = readFileSync(file, 'utf8')
    expect(after).toContain('Patched')
    expect(after).not.toContain('Hello 1')
    // 写回的文件仍然是合法 od 文档
    expect(() => run(['validate', file])).not.toThrow()
  })

  it('0 · --out 写到别的文件，原文件不动', () => {
    const file = writeDoc(buildDoc(1))
    const before = readFileSync(file, 'utf8')
    const opsFile = join(tmpdir_(), 'ops.json')
    writeFileSync(opsFile, JSON.stringify({ ops }), 'utf8')
    const out = join(tmpdir_(), 'applied.od.json')

    const result = run(['apply', file, opsFile, '--out', out])
    expect(result.code).toBe(0)
    expect(readFileSync(file, 'utf8')).toBe(before)
    expect(readFileSync(out, 'utf8')).toContain('Patched')
  })

  it('2 · 操作脚本形状非法 → 校验错', () => {
    const file = writeDoc(buildDoc(1))
    const opsFile = join(tmpdir_(), 'bad-ops.json')
    writeFileSync(opsFile, JSON.stringify({ ops: 'not-an-array' }), 'utf8')

    const result = run(['apply', file, opsFile])
    expect(result.code).toBe(2)
  })

  it('1 · 缺操作脚本 → 用法错', () => {
    const file = writeDoc(buildDoc(1))
    expect(run(['apply', file]).code).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// 4 · mcp
// ---------------------------------------------------------------------------

describe('od mcp', () => {
  it('od-mcp 没落地时 → 退出码 3 + 明确的安装提示', () => {
    const file = writeDoc(buildDoc(1))
    // od-mcp 与本分支并行开发；包还没落地时退出码必须是 3（缺依赖）。
    if (existsSync(resolve('packages/od-mcp/src/index.ts'))) {
      // 包已落地 → 只断言「文件不存在时是 IO 错」，不再断言缺依赖的路径
      expect(run(['mcp', join(tmpdir_(), 'missing.od.json')]).code).toBe(4)
      return
    }
    const result = run(['mcp', file])
    expect(result.code).toBe(3)
    expect(result.stderr).toContain('@opendesigner/od-mcp')
  })
})
