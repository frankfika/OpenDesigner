/**
 * CLI 契约的测试（规格 §8，MUST #17 · 退出码）。
 *
 * 退出码是**契约**（CI 脚本依赖），所以逐个码都要有用例。
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { fromEngine, stringifyOd } from '../src/index.js'
import { buildRichGraph } from './fixtures.js'

const CLI = resolve('packages/od-cli/src/cli.ts')
const ROOT = resolve('.')

/** 跑 CLI，返回 { code, stdout, stderr }。 */
function run(args: string[]): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('npx', ['tsx', CLI, ...args], {
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

function tmpdir_(): string {
  return mkdtempSync(join(tmpdir(), 'od-cli-'))
}

describe('MUST #17 · CLI 退出码', () => {
  it('0 · --help 成功', () => {
    const result = run(['--help'])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('od convert')
  })

  it('0 · --version', () => {
    const result = run(['--version'])
    expect(result.code).toBe(0)
    expect(result.stdout).toMatch(/od-format\/\d+\.\d+\.\d+/)
  })

  it('1 · 未知命令 → 用法错误', () => {
    const result = run(['frobnicate'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('未知命令')
  })

  it('1 · 缺少必需参数', () => {
    expect(run(['convert']).code).toBe(1)
    expect(run(['inspect']).code).toBe(1)
    expect(run(['validate']).code).toBe(1)
  })

  it('1 · 非法选项值（--to fig）→ 格式不支持', () => {
    const dir = tmpdir_()
    try {
      const file = join(dir, 'a.od.json')
      writeFileSync(file, stringifyOd(fromEngine(buildRichGraph())))
      const result = run(['convert', '--from', 'od', '--to', 'fig', file])
      expect(result.code).toBe(3)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('2 · 校验失败（文档不合法）', () => {
    const dir = tmpdir_()
    try {
      const file = join(dir, 'bad.od.json')
      writeFileSync(file, JSON.stringify({ format: 'od', version: '0.1' }))
      const result = run(['validate', file])
      expect(result.code).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('2 · JSONC 不可解析', () => {
    const dir = tmpdir_()
    try {
      const file = join(dir, 'broken.od.json')
      writeFileSync(file, '{ "format": ')
      const result = run(['validate', file])
      expect(result.code).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('3 · 文档版本高于工具支持', () => {
    const dir = tmpdir_()
    try {
      const file = join(dir, 'future.od.json')
      const doc = JSON.parse(stringifyOd(fromEngine(buildRichGraph()))) as Record<string, unknown>
      doc.version = '99.0'
      writeFileSync(file, JSON.stringify(doc))
      const result = run(['validate', file])
      // 规格 §8.6：版本高于工具支持 → 退出码 3（格式不支持），不是 2
      expect(result.code).toBe(3)
      expect(result.stderr).toContain('OD1003')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('4 · 输入文件不存在', () => {
    const result = run(['validate', '/nonexistent/path/to/file.od.json'])
    expect(result.code).toBe(4)
  })

  it('4 · 输出已存在且未加 --force', () => {
    const dir = tmpdir_()
    try {
      const input = join(dir, 'a.od.json')
      const output = join(dir, 'b.od.json')
      writeFileSync(input, stringifyOd(fromEngine(buildRichGraph())))
      writeFileSync(output, 'existing')
      const result = run(['convert', input, output])
      expect(result.code).toBe(4)
      expect(result.stderr).toContain('--force')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('0 · convert 成功（od → od 幂等）', () => {
    const dir = tmpdir_()
    try {
      const input = join(dir, 'a.od.json')
      const output = join(dir, 'b.od.json')
      const text = stringifyOd(fromEngine(buildRichGraph()))
      writeFileSync(input, text)
      const result = run(['convert', input, output])
      expect(result.code).toBe(0)
      const written = execFileSync('cat', [output], { encoding: 'utf8' })
      expect(written).toBe(text)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('0 · convert od → engine → od 逐字节一致', () => {
    const dir = tmpdir_()
    try {
      const input = join(dir, 'a.od.json')
      const engineFile = join(dir, 'a.odgraph.json')
      const output = join(dir, 'b.od.json')
      const text = stringifyOd(fromEngine(buildRichGraph()))
      writeFileSync(input, text)
      expect(run(['convert', '--from', 'od', '--to', 'engine', input, engineFile]).code).toBe(0)
      expect(run(['convert', '--from', 'engine', '--to', 'od', engineFile, output]).code).toBe(0)
      const written = execFileSync('cat', [output], { encoding: 'utf8' })
      expect(written).toBe(text)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('0 · inspect（text 与 json 两种形态）', () => {
    const dir = tmpdir_()
    try {
      const file = join(dir, 'a.od.json')
      writeFileSync(file, stringifyOd(fromEngine(buildRichGraph())))
      const text = run(['inspect', file])
      expect(text.code).toBe(0)
      expect(text.stdout).toContain('统计:')

      const json = run(['inspect', '--format', 'json', file])
      expect(json.code).toBe(0)
      const parsed = JSON.parse(json.stdout) as { command: string; counts: { nodes: number } }
      expect(parsed.command).toBe('inspect')
      expect(parsed.counts.nodes).toBeGreaterThan(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('0 · validate 通过时退出码 0', () => {
    const dir = tmpdir_()
    try {
      const file = join(dir, 'a.od.json')
      writeFileSync(file, stringifyOd(fromEngine(buildRichGraph())))
      const result = run(['validate', file])
      expect(result.code).toBe(0)
      expect(result.stdout).toContain('校验通过')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('0 · schema 导出 JSON Schema', () => {
    const result = run(['schema'])
    expect(result.code).toBe(0)
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>
    expect(parsed).toHaveProperty('properties')
  })

  it('0 · migrate 到 1.0', () => {
    const dir = tmpdir_()
    try {
      const file = join(dir, 'a.od.json')
      const output = join(dir, 'b.od.json')
      writeFileSync(file, stringifyOd(fromEngine(buildRichGraph())))
      const result = run(['migrate', '--from', '0.1', '--to', '1.0', file, output])
      expect(result.code).toBe(0)
      const migrated = JSON.parse(
        execFileSync('cat', [output], { encoding: 'utf8' })
      ) as { version: string }
      expect(migrated.version).toBe('1.0')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('3 · 迁移找不到路径 → 格式不支持', () => {
    const dir = tmpdir_()
    try {
      const file = join(dir, 'a.od.json')
      writeFileSync(file, stringifyOd(fromEngine(buildRichGraph())))
      const result = run(['migrate', '--from', '1.0', '--to', '0.1', file])
      expect(result.code).toBe(3)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('--json 时 stdout 只有一个 JSON 文档', () => {
    const dir = tmpdir_()
    try {
      const file = join(dir, 'a.od.json')
      writeFileSync(file, stringifyOd(fromEngine(buildRichGraph())))
      const result = run(['validate', '--json', file])
      expect(result.code).toBe(0)
      const parsed = JSON.parse(result.stdout) as { ok: boolean; command: string }
      expect(parsed.command).toBe('validate')
      expect(parsed.ok).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
