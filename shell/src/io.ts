/**
 * 文件层：od 文档的打开/保存，以及多格式导出。
 *
 * 三条链路在这里汇合：
 * 1. **od 文本**（.od.json）—— agent 能直接读写的那一层，走 od-format 包。
 * 2. **引擎图**（SceneGraph）—— 画布真正在编辑的东西。
 * 3. **代码/图片**（HTML / JSX / SVG / PDF …）—— 引擎自带的导出器，一个字都不用自己写。
 *
 * od-format 只负责 1 ⇄ 2，2 → 3 完全交给引擎（IORegistry）。
 */
import {
  BUILTIN_IO_FORMATS,
  IORegistry,
  getCanvasKit,
  type ExportResult,
  type ExportTarget
} from '@open-pencil/core'
import type { SceneGraph } from '@open-pencil/scene-graph'
import {
  fromEngine,
  parseOd,
  stringifyOd,
  toEngine
} from '@opendesigner/od-format'

const registry = new IORegistry(BUILTIN_IO_FORMATS)

/** 导出目标：整页 / 整文档 / 当前选中。 */
export type ExportScope = 'page' | 'document' | 'selection'

export interface ExportFormatDef {
  id: string
  label: string
  ext: string
  /** 这个格式只能导出单个节点或选中（引擎的 jsx 导出器就这么限制）。 */
  nodeOnly?: boolean
}

export const EXPORT_FORMATS: ExportFormatDef[] = [
  { id: 'html', label: 'HTML', ext: 'html' },
  { id: 'tailwind-jsx', label: 'Tailwind', ext: 'jsx' },
  { id: 'jsx', label: 'React JSX', ext: 'jsx', nodeOnly: true },
  { id: 'svg', label: 'SVG', ext: 'svg' },
  { id: 'pdf', label: 'PDF', ext: 'pdf' },
  { id: 'pptx', label: 'PPTX', ext: 'pptx' }
]

/**
 * 导出成某种格式。
 *
 * @param graph 当前文档
 * @param formatId 引擎的格式 id（见 EXPORT_FORMATS）
 * @param scope 导出范围
 * @param selectionIds 当前选中的节点（scope='selection' 时用）
 * @param fileName 文件名（有些导出器会拿它决定引用资源的路径）
 */
export async function exportDocument(
  graph: SceneGraph,
  formatId: string,
  scope: ExportScope,
  selectionIds: string[],
  fileName: string
): Promise<ExportResult> {
  let target: ExportTarget
  if (scope === 'selection' && selectionIds.length > 0) {
    target = { scope: 'selection', nodeIds: selectionIds }
  } else if (scope === 'selection') {
    // 没选中就退回整页，不要给用户一个空结果
    const pages = graph.getPages()
    target = pages.length ? { scope: 'page', pageId: pages[0].id } : { scope: 'document' }
  } else if (scope === 'document') {
    target = { scope: 'document' }
  } else {
    const pages = graph.getPages()
    target = pages.length ? { scope: 'page', pageId: pages[0].id } : { scope: 'document' }
  }

  // PPTX 导出要靠 canvasKit 光栅化部分内容，不给 context 会在浏览器里
  // 拿到 undefined 的节点（Node 端不需要，所以那边导出 PPTX 一切正常）。
  const canvasKit = await getCanvasKit()
  return registry.exportContent(
    formatId,
    { graph, target, fileName },
    undefined,
    { canvasKit }
  )
}

/** 导出结果是不是纯文本（决定预览面板能不能直接显示）。 */
export function isTextResult(result: ExportResult): boolean {
  return typeof result.data === 'string'
}

/** 导出结果转成可预览的文本；二进制给个摘要。 */
export function resultToText(result: ExportResult): string {
  if (typeof result.data === 'string') return result.data
  const bytes = result.data as Uint8Array
  const head = Array.from(bytes.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ')
  return `（二进制 ${bytes.length} 字节，头部 ${head}）`
}

/** 触发浏览器下载。 */
export function download(result: ExportResult, fileName: string): void {
  const blob =
    typeof result.data === 'string'
      ? new Blob([result.data], { type: result.mimeType })
      : new Blob([result.data as BlobPart], { type: result.mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 立刻 revoke 会让 Safari 偶发下载失败，给它一帧
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

// ── od 文档 ────────────────────────────────────────────────────────────────

/**
 * 当前画布 → od 文本。
 *
 * 这就是「agent 能直接读写」的落点：同一个画面，
 * 保存出来的是一段有注释、能 diff、能手改的 JSONC。
 */
export function graphToOdText(graph: SceneGraph): string {
  return stringifyOd(fromEngine(graph))
}

/**
 * od 文本 → 引擎图。
 *
 * 注意 od-format **不跑布局**（它不依赖 core），所以这里注入 core 的布局函数，
 * 让自动布局的容器在打开后是算好的。
 */
export function odTextToGraph(text: string, layout?: (graph: SceneGraph) => void): SceneGraph {
  const doc = parseOd(text)
  const { graph } = toEngine(doc)
  if (layout) layout(graph)
  return graph
}

/** 下载 od 文本。 */
export function downloadOd(text: string, fileName: string): void {
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
