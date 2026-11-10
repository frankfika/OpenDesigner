/**
 * `od export` 的实现 —— **把 od 文档变成人能看的东西**（研究文档 §6.2「导出」）。
 *
 * 支撑的理由：od 格式已经能存文档，但「存下来」不等于「看得见」。
 * 这一层负责把文本化的设计文档渲染成 SVG / HTML / Tailwind / JSX / PNG / PDF。
 *
 * 引擎依赖是**可选**的：`@open-pencil/core` 在 `optionalDependencies` 里
 * （它会拖来 canvaskit-wasm，体积大）。没装的时候 `od export` 报
 * 「需要 @open-pencil/core」并让调用方走**退出码 3**（格式不支持 / 缺依赖），
 * 与现有 `fig` 载体的处理保持一致。
 *
 * 渲染全部走引擎自己的导出 API（`renderNodesToSVG` / `htmlFormat` /
 * `tailwindJSXFormat` / `jsxFormat` / `headlessRenderNodes`），本文件只负责：
 *   1. 选导出目标（整页 / 某个节点）
 *   2. 把目标翻译成引擎的 `ExportRequest`
 *   3. 把引擎返回值归一成「文本 or 二进制 + mime + 扩展名」
 *   4. 原子写盘
 */
import { toEngine, type OdDocument } from '@opendesigner/od-format'
import type { SceneGraph } from '@open-pencil/scene-graph'
import type { IOFormatAdapter } from '@open-pencil/core/io'

import { OdCliError, errorDetail } from './cli-error.js'

/** 支持的导出格式。 */
export const EXPORT_FORMATS = ['svg', 'html', 'tailwind', 'jsx', 'png', 'pdf'] as const

export type ExportFormat = (typeof EXPORT_FORMATS)[number]

/** 各格式的默认扩展名（与引擎的 adapter 一致：tailwind 也落 .jsx）。 */
const FORMAT_EXTENSIONS: Readonly<Record<ExportFormat, string>> = {
  svg: 'svg',
  html: 'html',
  tailwind: 'jsx',
  jsx: 'jsx',
  png: 'png',
  pdf: 'pdf',
}

/** 二进制格式 —— 必须写文件（不能写 stdout）。 */
const BINARY_FORMATS: ReadonlySet<ExportFormat> = new Set<ExportFormat>(['png', 'pdf'])

/** 导出附带产生的资源文件（HTML 的外部图片 / 字体）。 */
export interface ExportAsset {
  /** 相对于输出文件所在目录的路径。 */
  path: string
  content: string | Uint8Array
}

export interface ExportOptions {
  format: ExportFormat
  /** 导出该节点（及其子树）；省略则导出整页。 */
  nodeId?: string
  /** PNG 的缩放倍数（默认 1）。 */
  scale?: number
  /** 输出文件名（影响 HTML 的资源命名）。 */
  fileName?: string
  /** 外部资源字节（assets/ 目录里的图片）。 */
  assets?: ReadonlyMap<string, Uint8Array>
}

export interface ExportPayload {
  data: string | Uint8Array
  binary: boolean
  mimeType: string
  extension: string
  assets: ExportAsset[]
}

/** 导出目标：引擎的 pageId + 要渲染的节点集合。 */
export interface ExportTarget {
  pageId: string
  nodeIds: string[]
  /** 目标节点的 odId（整页导出时是页面的 odId）。 */
  nodeId: string
  /** 人读的名字（报错 / 日志用）。 */
  label: string
}

/**
 * 只用 `@open-pencil/core` 的 **io 子路径** —— 它带齐了本文件需要的全部导出 API
 * （`renderNodesToSVG` / `headlessRenderNodes` / `htmlFormat` / `tailwindJSXFormat` /
 * `jsxFormat` / `IORegistry` / `computeContentBounds`），
 * 但**不拖编辑器 / AI / RPC 那一大坨**（实测载入 5s vs 14s）。
 */
type CoreModule = typeof import('@open-pencil/core/io')

let corePromise: Promise<CoreModule> | null = null

/**
 * 动态载入 `@open-pencil/core`。
 *
 * 用**动态 import** 而不是顶层 import：core 是可选依赖，没装的时候
 * `od --help` / `od convert` 仍然要能跑（不能因为一个可选依赖缺失就整个 CLI 起不来）。
 */
export async function loadCore(): Promise<CoreModule> {
  if (!corePromise) {
    corePromise = import('@open-pencil/core/io').catch((error: unknown) => {
      throw new OdCliError(
        'unsupported',
        '导出需要 @open-pencil/core，当前环境没有安装',
        errorDetail(error),
        'npm i @open-pencil/core'
      )
    })
  }
  return corePromise
}

/** 判断字符串是不是受支持的导出格式。 */
export function isExportFormat(value: string): value is ExportFormat {
  return (EXPORT_FORMATS as readonly string[]).includes(value)
}

/** 某格式是不是二进制（必须 `--out`）。 */
export function isBinaryFormat(format: ExportFormat): boolean {
  return BINARY_FORMATS.has(format)
}

/** 某格式的默认扩展名。 */
export function extensionOf(format: ExportFormat): string {
  return FORMAT_EXTENSIONS[format]
}

/** 找某个节点所属的页面（向上找到第一个 CANVAS）。 */
function findPageOf(graph: SceneGraph, nodeId: string): string | undefined {
  let current = graph.getNode(nodeId)
  while (current) {
    if (current.type === 'CANVAS') return current.id
    current = current.parentId ? graph.getNode(current.parentId) : undefined
  }
  return undefined
}

/** 页面的一行摘要（报错时列出可选页）。 */
export function describePages(graph: SceneGraph): string[] {
  return graph.getPages().map((page) => `  ${page.id}  ${page.name}`)
}

/**
 * 解析导出目标。
 *
 * - 给了 `--node` → 导出该节点（引擎会把子树一起渲染）。
 * - 没给 → 导出**整页**；**多页文档报错并列出可选页**（不瞎选第一页：
 *   导出一页而用户以为是另一页，比报错更糟）。
 */
export function resolveExportTarget(graph: SceneGraph, nodeId?: string): ExportTarget {
  if (nodeId) {
    const node = graph.getNode(nodeId)
    if (!node) {
      throw new OdCliError('validation', `文档里没有节点 "${nodeId}"`, undefined, '用 `od inspect --ids` 看节点清单')
    }
    const pageId = findPageOf(graph, nodeId)
    if (!pageId) {
      throw new OdCliError(
        'validation',
        `节点 "${nodeId}" 不属于任何页面`,
        '只能导出页面内的节点（文档根节点不能单独导出）'
      )
    }
    return { pageId, nodeIds: [nodeId], nodeId, label: node.name }
  }

  const pages = graph.getPages()
  if (pages.length === 0) {
    throw new OdCliError('validation', '文档里没有页面', '一个可导出的文档至少要有一个 CANVAS 节点')
  }
  if (pages.length > 1) {
    throw new OdCliError(
      'usage',
      `文档有 ${pages.length} 个页面，请用 --node <odId> 指定要导出的页面`,
      describePages(graph).join('\n'),
      '例：od export doc.od.json --to svg --node canvas~page-1'
    )
  }
  const page = pages[0]!
  return { pageId: page.id, nodeIds: [...page.childIds], nodeId: page.id, label: page.name }
}

/**
 * 把 `console.log` / `console.info` 临时改道到 stderr。
 *
 * 为什么要改道：导出到 stdout 时 stdout 里**只能有导出物**。
 * 引擎在字体加载失败等情况下会打日志（不是抛错），一旦它用了 `console.log`，
 * 那些日志就会混进 SVG / HTML 里，把产物弄脏。
 */
async function withCleanStdout<T>(fn: () => Promise<T>): Promise<T> {
  const originalLog = console.log
  const originalInfo = console.info
  const originalDebug = console.debug
  const toStderr = (...args: unknown[]): void => {
    process.stderr.write(`${args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ')}\n`)
  }
  console.log = toStderr
  console.info = toStderr
  console.debug = toStderr
  try {
    return await fn()
  } finally {
    console.log = originalLog
    console.info = originalInfo
    console.debug = originalDebug
  }
}

/** 引擎的 `ExportRequest` —— 一律用 `selection` 作用域（`jsx` 只支持 selection / node）。 */
function toRequest(graph: SceneGraph, target: ExportTarget, fileName: string) {
  return {
    graph,
    target: { scope: 'selection' as const, nodeIds: target.nodeIds },
    fileName,
  }
}

/** 引擎的 adapter 的 `exportContent` 在类型上是可选的 —— 缺了就是「不支持」。 */
type CoreExportContent = NonNullable<IOFormatAdapter['exportContent']>

function requireExportContent(
  adapter: { exportContent?: CoreExportContent },
  id: string
): CoreExportContent {
  if (typeof adapter.exportContent !== 'function') {
    throw new OdCliError(
      'unsupported',
      `引擎的 ${id} 导出器不可用`,
      undefined,
      '升级 @open-pencil/core'
    )
  }
  return adapter.exportContent.bind(adapter) as CoreExportContent
}

/** PDF 的矢量通路：引擎自带的 `pdfFormat`（走 svg2pdf，**需要浏览器 DOM**）。 */
async function exportPdfVector(core: CoreModule, graph: SceneGraph, target: ExportTarget): Promise<Uint8Array | undefined> {
  try {
    const registry = new core.IORegistry(core.BUILTIN_IO_FORMATS)
    const result = await registry.exportContent(
      'pdf',
      toRequest(graph, target, 'export.pdf'),
      {},
      {}
    )
    if (result.data instanceof Uint8Array && result.data.length > 0) return result.data
    return undefined
  } catch {
    // 引擎的 PDF 通路依赖浏览器环境（DOMParser / canvas 度量）—— Node 下会失败，
    // 下面走光栅通路。失败不是致命错误。
    return undefined
  }
}

/** PDF 的光栅通路：引擎出 PNG → jsPDF 封装成单页 PDF。 */
async function exportPdfRaster(core: CoreModule, graph: SceneGraph, target: ExportTarget): Promise<Uint8Array> {
  const bounds = core.computeContentBounds(graph, target.nodeIds)
  if (!bounds) {
    throw new OdCliError('validation', '目标没有可导出的内容', '内容边界为空（空页面 / 空节点）')
  }
  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY
  if (width <= 0 || height <= 0) {
    throw new OdCliError('validation', '目标没有可导出的内容', `内容尺寸为 ${width}×${height}`)
  }

  // 2 倍渲染 —— 光栅 PDF 的清晰度靠它（PDF 本身是矢量容器，但这里嵌的是位图）。
  const png = await core.headlessRenderNodes(graph, target.pageId, target.nodeIds, {
    format: 'PNG',
    scale: 2,
  })
  if (!png || png.length === 0) {
    throw new OdCliError('internal', 'PNG 渲染失败，没有产出字节')
  }

  let jsPDFCtor: new (options?: Record<string, unknown>) => {
    addImage: (data: Uint8Array, format: string, x: number, y: number, w: number, h: number) => void
    output: (kind: string) => ArrayBuffer
  }
  try {
    const mod = (await import('jspdf')) as unknown as { jsPDF?: typeof jsPDFCtor }
    if (!mod.jsPDF) throw new Error('jspdf 没有导出 jsPDF')
    jsPDFCtor = mod.jsPDF
  } catch (error) {
    throw new OdCliError(
      'unsupported',
      'PDF 导出需要 jspdf，当前环境没有安装',
      error instanceof Error ? error.message : String(error),
      'npm i jspdf'
    )
  }

  const pdf = new jsPDFCtor({
    orientation: width > height ? 'landscape' : 'portrait',
    unit: 'pt',
    format: [width, height],
    compress: true,
  })
  pdf.addImage(png, 'PNG', 0, 0, width, height)
  return new Uint8Array(pdf.output('arraybuffer'))
}

/**
 * 导出一个 od 文档。
 *
 * 返回「文本 or 二进制」——文本可以直接写 stdout，二进制必须写文件。
 */
export async function exportOd(doc: OdDocument, options: ExportOptions): Promise<ExportPayload> {
  const core = await loadCore()
  const format = options.format
  const fileName = options.fileName ?? `export.${extensionOf(format)}`
  const scale = options.scale ?? 1

  const { graph } = toEngine(doc, { idStrategy: 'od', assets: options.assets })
  const target = resolveExportTarget(graph, options.nodeId)
  if (target.nodeIds.length === 0) {
    throw new OdCliError('validation', `目标 "${target.label}" 是空的`, '没有可导出的节点')
  }

  return withCleanStdout(async () => {
    switch (format) {
      case 'svg': {
        const svg = core.renderNodesToSVG(graph, target.pageId, target.nodeIds, {})
        if (!svg) throw new OdCliError('internal', 'SVG 渲染失败，没有产出内容')
        return { data: svg, binary: false, mimeType: 'image/svg+xml', extension: 'svg', assets: [] }
      }
      case 'html': {
        const result = await requireExportContent(core.htmlFormat, 'html')(toRequest(graph, target, fileName), {})
        return {
          data: String(result.data),
          binary: false,
          mimeType: result.mimeType,
          extension: 'html',
          assets: (result.assets ?? []).map((a) => ({ path: a.path, content: a.content })),
        }
      }
      case 'tailwind': {
        const result = await requireExportContent(core.tailwindJSXFormat, 'tailwind')(
          toRequest(graph, target, fileName),
          {}
        )
        return {
          data: String(result.data),
          binary: false,
          mimeType: result.mimeType,
          extension: 'jsx',
          assets: [],
        }
      }
      case 'jsx': {
        const result = await requireExportContent(core.jsxFormat, 'jsx')(
          toRequest(graph, target, fileName),
          {}
        )
        return {
          data: String(result.data),
          binary: false,
          mimeType: result.mimeType,
          extension: 'jsx',
          assets: [],
        }
      }
      case 'png': {
        const bytes = await core.headlessRenderNodes(graph, target.pageId, target.nodeIds, {
          format: 'PNG',
          scale,
        })
        if (!bytes || bytes.length === 0) throw new OdCliError('internal', 'PNG 渲染失败，没有产出字节')
        return { data: bytes, binary: true, mimeType: 'image/png', extension: 'png', assets: [] }
      }
      case 'pdf': {
        const vector = await exportPdfVector(core, graph, target)
        const bytes = vector ?? (await exportPdfRaster(core, graph, target))
        return { data: bytes, binary: true, mimeType: 'application/pdf', extension: 'pdf', assets: [] }
      }
      default: {
        throw new OdCliError('usage', `不支持的导出格式：${String(format)}`)
      }
    }
  })
}
