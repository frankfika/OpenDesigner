#!/usr/bin/env node
/**
 * `od` 命令行 —— 文档转换 / 检视 / 校验 / 迁移 / schema 导出（规格 §8）。
 *
 * ```
 * od <command> [options] [args]
 * ```
 *
 * **退出码是契约**（规格 §8.6），CI 脚本会依赖：
 *
 * | 码 | 含义 |
 * | --- | --- |
 * | 0 | 成功 |
 * | 1 | 用法错误（未知命令、缺少参数、非法选项值） |
 * | 2 | 校验失败 |
 * | 3 | 格式不支持 |
 * | 4 | IO 错误 |
 * | 5 | 内部错误（bug） |
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'

import {
  OD_FORMAT_PACKAGE_VERSION,
  OD_FORMAT_VERSION,
  latestVersion,
  isSupportedVersion,
  SUPPORTED_VERSIONS,
  fromEngine,
  migrate,
  odDocumentJsonSchema,
  parseJsonc,
  parseOd,
  stringifyOd,
  toEngine,
  validate,
  type OdDocument,
} from '@opendesigner/od-format'
import { inspect, formatInspectText } from '@opendesigner/od-format'

import {
  dumpEngine,
  isEngineCarrier,
  loadEngine,
  type EngineCarrier,
} from './engine-carrier.js'

const EXIT_OK = 0
const EXIT_USAGE = 1
const EXIT_VALIDATION = 2
const EXIT_UNSUPPORTED = 3
const EXIT_IO = 4
const EXIT_INTERNAL = 5

type Format = 'od' | 'engine' | 'fig' | 'auto'

interface GlobalOptions {
  json: boolean
  quiet: boolean
  noColor: boolean
}

/**
 * 布尔开关（不带值）。没有这张表的话，`--check file.json` 里的 file.json
 * 会被当成 `--check` 的值吃掉 —— 参数解析最经典的坑。
 */
const BOOLEAN_FLAGS: ReadonlySet<string> = new Set([
  'help',
  'version',
  'json',
  'quiet',
  'no-color',
  'force',
  'check',
  'paths',
  'ids',
  'stats',
  'strict',
  'no-assets',
  'list',
])

/** 从 argv 里抽出全局选项，剩下的返回命令与位置参数。 */
function splitArgs(argv: string[]): {
  options: Record<string, string | boolean>
  positional: string[]
  command: string | undefined
} {
  const options: Record<string, string | boolean> = {}
  const positional: string[] = []
  let command: string | undefined

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=')
      if (eq > 0) {
        options[arg.slice(2, eq)] = arg.slice(eq + 1)
      } else {
        const name = arg.slice(2)
        const next = argv[i + 1]
        if (BOOLEAN_FLAGS.has(name)) {
          options[name] = true
          continue
        }
        if (next !== undefined && !next.startsWith('-')) {
          options[name] = next
          i++
        } else {
          options[name] = true
        }
      }
      continue
    }
    if (arg === '-h') {
      options.help = true
      continue
    }
    if (arg === '-V') {
      options.version = true
      continue
    }
    if (arg === '-q') {
      options.quiet = true
      continue
    }
    if (arg === '-j') {
      options.json = true
      continue
    }
    if (command === undefined) {
      command = arg
    } else {
      positional.push(arg)
    }
  }

  return { options, positional, command }
}

const USAGE = `od —— OpenDesigner 的文档格式命令行（od-format ${OD_FORMAT_VERSION}）

用法:
  od convert [options] <input> [output]   文档格式转换（双向）
  od inspect [options] <input>            打印文档摘要
  od validate [options] <input>            校验文档
  od migrate [options] <input> [output]    版本迁移
  od schema [options]                      导出公开 JSON Schema

全局选项:
  --help, -h      打印用法
  --version, -V   打印版本
  --json          机器可读输出（stdout 只输出一个 JSON 文档）
  --quiet, -q     只输出错误
  --no-color      关闭 ANSI 颜色

convert 选项:
  --from <fmt>        od | engine | fig | auto（默认按扩展名推断）
  --to <fmt>          od | engine | fig | auto（默认按输出扩展名推断，无输出则 od）
  --assets <dir>      资源目录（默认与输出同目录下的 assets/）
  --precision <p>     exact | 6
  --force             覆盖已存在的输出
  --check             只比对，不写；有差异则退出码 2
  --id-strategy <s>   od | native

inspect 选项:
  --format <f>    text | json
  --depth <n>     树的最大深度
  --paths         打印派生路径
  --ids           打印 odId → 引擎 id 映射
  --stats         只打印统计
  --select <id>   只看某个子树
  --grep <re>     只打印匹配的节点

validate 选项:
  --strict        把 warning 升级为 error
  --schema <path> 指定 schema 文件
  --no-assets     跳过资源文件存在性检查

migrate 选项:
  --from <v>      源版本（默认读文档自带的 version）
  --to <v>        目标版本（默认当前格式版本）
  --force         覆盖输出

schema 选项:
  --version <v>   版本（默认当前）
  --out <path>    输出文件（默认 stdout）
  --list          列出所有已发布的 schema 版本
`

/** 按扩展名推断载体格式。 */
function inferFormat(file: string): Format {
  if (file.endsWith('.od.json')) return 'od'
  if (file.endsWith('.odgraph.json')) return 'engine'
  if (file.endsWith('.fig')) return 'fig'
  return 'auto'
}

/**
 * 版本比工具新 → **退出码 3**（格式不支持），不是 2。
 *
 * 规格 §8.6：「文档 version 高于工具支持」属于「格式不支持」。
 * 不做「尽力而为」的猜测（§5.5）。
 */
function assertVersionSupported(version: string, file: string): void {
  const latest = latestVersion()
  const parse = (v: string): [number, number] | undefined => {
    const m = /^(\d+)\.(\d+)$/.exec(v)
    return m ? [Number(m[1]), Number(m[2])] : undefined
  }
  const current = parse(version)
  const max = parse(latest)
  if (current && max && (current[0] > max[0] || (current[0] === max[0] && current[1] > max[1]))) {
    fail(
      EXIT_UNSUPPORTED,
      `${file} 的版本 "${version}" 高于本工具支持的版本 "${latest}"`,
      'OD1003 不支持的格式版本',
      '请升级 od-format；旧工具不该打开新版本的文件再保存'
    )
  }
  if (!isSupportedVersion(version)) {
    fail(
      EXIT_UNSUPPORTED,
      `${file} 的版本 "${version}" 不被本工具支持`,
      'OD1003 不支持的格式版本',
      `本工具支持：${SUPPORTED_VERSIONS.join(', ')}`
    )
  }
}

function fail(code: number, message: string, detail?: string, hint?: string): never {
  process.stderr.write(`od: ${message}\n`)
  if (detail) process.stderr.write(`  ${detail}\n`)
  if (hint) process.stderr.write(`    提示: ${hint}\n`)
  process.exit(code)
}

function readInput(file: string): string {
  const full = resolve(file)
  if (!existsSync(full)) {
    fail(EXIT_IO, `输入文件不存在：${file}`)
  }
  try {
    return readFileSync(full, 'utf8')
  } catch (error) {
    fail(EXIT_IO, `读取失败：${file}`, error instanceof Error ? error.message : String(error))
  }
}

/** 读 od 文档（JSONC + zod 校验）。 */
function readOd(file: string): { doc: OdDocument; raw: unknown } {
  const text = readInput(file)
  let raw: unknown
  try {
    raw = parseJsonc(text)
  } catch (error) {
    fail(
      EXIT_VALIDATION,
      `${file} 不是合法的 JSONC`,
      error instanceof Error ? error.message : String(error)
    )
  }
  try {
    return { doc: parseOd(text), raw }
  } catch (error) {
    fail(
      EXIT_VALIDATION,
      `${file} 不是合法的 od 文档`,
      error instanceof Error ? error.message : String(error)
    )
  }
}

/** 读引擎载体。 */
function readEngine(file: string): EngineCarrier {
  const text = readInput(file)
  const raw = parseJsonc(text)
  if (!isEngineCarrier(raw)) {
    fail(EXIT_VALIDATION, `${file} 不是 engine 载体`, '缺少 kind: "openpencil-scene-graph"')
  }
  return raw
}

/** 加载 assets 目录里的图片字节。 */
function loadAssets(doc: OdDocument, dir: string): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>()
  for (const [hash, asset] of Object.entries(doc.assets)) {
    const full = resolve(dir, asset.file)
    if (!existsSync(full)) {
      fail(
        EXIT_VALIDATION,
        `资源文件缺失：${asset.file}`,
        `找不到 ${full}`,
        '用 `od validate --no-assets` 跳过资源检查'
      )
    }
    out.set(hash, new Uint8Array(readFileSync(full)))
  }
  return out
}

function writeOutput(file: string, content: string, force: boolean): void {
  const full = resolve(file)
  if (existsSync(full) && !force) {
    fail(EXIT_IO, `输出文件已存在：${file}`, undefined, '加 --force 覆盖')
  }
  try {
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content, 'utf8')
  } catch (error) {
    fail(EXIT_IO, `写入失败：${file}`, error instanceof Error ? error.message : String(error))
  }
}

// ---------------------------------------------------------------------------
// 命令
// ---------------------------------------------------------------------------

function cmdConvert(options: Record<string, string | boolean>, positional: string[]): void {
  const input = positional[0]
  if (!input) fail(EXIT_USAGE, 'convert 缺少输入文件', undefined, '用法：od convert <input> [output]')

  const output = positional[1]
  const from = (options.from as Format) ?? inferFormat(input)
  const to = (options.to as Format) ?? (output ? inferFormat(output) : 'od')
  const force = options.force === true
  const check = options.check === true
  const idStrategy = (options['id-strategy'] as 'od' | 'native') ?? 'od'

  const resolveFormat = (
    fmt: Format,
    fallback: Exclude<Format, 'auto'>
  ): Exclude<Format, 'auto'> => {
    if (fmt === 'auto') return fallback
    if (fmt === 'fig') {
      fail(
        EXIT_UNSUPPORTED,
        'fig 载体需要 @open-pencil/core，当前不可用',
        undefined,
        'v0.1 支持 od 与 engine 两种载体'
      )
    }
    return fmt
  }

  const inferredInput = inferFormat(input)
  const fromFmt = resolveFormat(from, inferredInput === 'auto' ? 'od' : inferredInput)
  const toFmt = resolveFormat(to, 'od')

  // --- 读入 ---
  let graph
  let sourceDoc: OdDocument | undefined
  if (fromFmt === 'od') {
    const { doc } = readOd(input)
    assertVersionSupported(doc.version, input)
    sourceDoc = doc
    const assetsDir =
      (options.assets as string) ?? resolve(dirname(resolve(output ?? input)), 'assets')
    const assets = Object.keys(doc.assets).length > 0 ? loadAssets(doc, assetsDir) : undefined
    graph = toEngine(doc, { idStrategy, assets }).graph
  } else {
    graph = loadEngine(readEngine(input))
  }

  // --- 写出 ---
  const content =
    toFmt === 'od'
      ? stringifyOd(fromEngine(graph))
      : `${JSON.stringify(dumpEngine(graph), null, 2)}\n`

  if (!output) {
    process.stdout.write(content)
    return
  }

  if (check) {
    const full = resolve(output)
    if (!existsSync(full)) {
      fail(EXIT_VALIDATION, `--check：输出文件不存在，无法比对：${output}`)
    }
    const existing = readFileSync(full, 'utf8')
    if (existing !== content) {
      process.stderr.write(`od: convert: 内容与 ${output} 不一致\n`)
      process.exit(EXIT_VALIDATION)
    }
    process.stderr.write(`od: convert: ${output} 内容一致\n`)
    return
  }

  writeOutput(output, content, force)

  // --- 幂等性自检：od → od 转换两次应逐字节相同 ---
  if (toFmt === 'od' && sourceDoc) {
    const second = stringifyOd(fromEngine(graph))
    if (second !== content) {
      fail(
        EXIT_INTERNAL,
        '转换不幂等：同一份文档转换两次结果不同',
        '这是 bug —— 键序或默认值省略逻辑有问题'
      )
    }
  }
}

function cmdInspect(options: Record<string, string | boolean>, positional: string[]): void {
  const input = positional[0]
  if (!input) fail(EXIT_USAGE, 'inspect 缺少输入文件', undefined, '用法：od inspect <input>')

  const format = (options.format as 'text' | 'json') ?? 'text'
  const { doc } = readOd(input)

  const result = inspect(doc, {
    depth: options.depth !== undefined ? Number(options.depth) : undefined,
    paths: options.paths === true,
    ids: options.ids === true,
    stats: options.stats === true,
    select: options.select as string | undefined,
    grep: options.grep as string | undefined,
  })

  if (format === 'json' || options.json === true) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }
  if (options.stats === true) {
    const c = result.counts
    process.stdout.write(
      `节点 ${c.nodes} · 变量 ${c.variables} · 集合 ${c.variableSets} · 组件 ${c.components} · 实例 ${c.instances} · 资源 ${c.assets}\n`
    )
    return
  }
  process.stdout.write(`${formatInspectText(result)}\n`)
}

function cmdValidate(options: Record<string, string | boolean>, positional: string[]): void {
  const input = positional[0]
  if (!input) fail(EXIT_USAGE, 'validate 缺少输入文件', undefined, '用法：od validate <input>')

  const { doc, raw } = readOd(input)
  assertVersionSupported(doc.version, input)
  const strict = options.strict === true
  const result = validate(raw, {
    strict,
    noAssets: options['no-assets'] === true,
    assetsDir: resolve(dirname(resolve(input))),
  })

  const payload = {
    ok: result.ok && !(strict && result.warnings.length > 0),
    command: 'validate',
    file: input,
    format: doc.version,
    errors: result.errors,
    warnings: result.warnings,
    summary: { errors: result.errors.length, warnings: result.warnings.length },
  }

  if (options.json === true) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
  } else {
    const errorCount = payload.ok ? 0 : result.errors.length
    const warningCount = result.warnings.length
    if (errorCount === 0 && warningCount === 0) {
      process.stdout.write(`✓ ${input} 校验通过\n`)
    } else {
      process.stdout.write(
        `${errorCount > 0 ? '✗' : '!'} ${errorCount} errors, ${warningCount} warnings\n\n`
      )
      for (const issue of result.errors) {
        process.stdout.write(`  ${issue.code}  ${issue.path}\n`)
        process.stdout.write(`          ${issue.message}\n`)
        if (issue.hint) process.stdout.write(`          提示: ${issue.hint}\n`)
        process.stdout.write('\n')
      }
      for (const issue of result.warnings) {
        process.stdout.write(`  ! ${issue.code}  ${issue.path}\n`)
        process.stdout.write(`          ${issue.message}\n`)
        if (issue.hint) process.stdout.write(`          提示: ${issue.hint}\n`)
        process.stdout.write('\n')
      }
    }
  }

  if (!payload.ok) process.exit(EXIT_VALIDATION)
}

function cmdMigrate(options: Record<string, string | boolean>, positional: string[]): void {
  const input = positional[0]
  if (!input) fail(EXIT_USAGE, 'migrate 缺少输入文件', undefined, '用法：od migrate <input> [output]')
  const output = positional[1]

  const { doc, raw } = readOd(input)
  assertVersionSupported(doc.version, input)
  const from = (options.from as `${number}.${number}`) ?? (doc.version as `${number}.${number}`)
  const to = (options.to as `${number}.${number}`) ?? (OD_FORMAT_VERSION as `${number}.${number}`)

  let migrated: OdDocument
  try {
    migrated = migrate(raw, from, to)
  } catch (error) {
    fail(
      EXIT_UNSUPPORTED,
      `迁移失败：${from} → ${to}`,
      error instanceof Error ? error.message : String(error)
    )
  }

  const content = stringifyOd(migrated)
  if (!output) {
    process.stdout.write(content)
    return
  }
  writeOutput(output, content, options.force === true)
}

function cmdSchema(options: Record<string, string | boolean>): void {
  if (options.list === true) {
    const versions = Object.keys(
      (globalThis as { __od_schemas?: Record<string, unknown> }).__od_schemas ?? { '0.1': true }
    )
    process.stdout.write(`${versions.join('\n')}\n`)
    return
  }
  const schema = odDocumentJsonSchema()
  const content = `${JSON.stringify(schema, null, 2)}\n`
  const out = options.out as string | undefined
  if (out) {
    writeOutput(out, content, true)
    return
  }
  process.stdout.write(content)
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const { options, positional, command } = splitArgs(argv)

  if (options.version === true) {
    process.stdout.write(`od-format/${OD_FORMAT_PACKAGE_VERSION}\n`)
    process.exit(EXIT_OK)
  }
  if (options.help === true || command === undefined) {
    process.stdout.write(USAGE)
    process.exit(command === undefined && options.help !== true ? EXIT_USAGE : EXIT_OK)
  }

  switch (command) {
    case 'convert':
      await cmdConvert(options, positional)
      break
    case 'inspect':
      cmdInspect(options, positional)
      break
    case 'validate':
      cmdValidate(options, positional)
      break
    case 'migrate':
      cmdMigrate(options, positional)
      break
    case 'schema':
      cmdSchema(options)
      break
    default:
      fail(EXIT_USAGE, `未知命令 "${command}"`, undefined, '跑 `od --help` 看用法')
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`od: 内部错误\n${error instanceof Error ? error.stack : String(error)}\n`)
  process.exit(EXIT_INTERNAL)
})
