/**
 * Agent 工具的调用与后处理。
 *
 * 引擎自带 24 个 agent 工具（`CORE_TOOLS`），跑在 `FigmaAPI` 上下文里。
 * 这里做两件事：
 *
 * 1. **造上下文**：工具要一个 `FigmaAPI`，里面指着当前文档和当前页。
 * 2. **补后处理**：引擎的 `render` 工具（JSX → 设计节点）建出来的文本节点
 *    少了几个字段，画布上**渲染不出来** —— 节点在，图层树里也在，就是看不见。
 */
import { CORE_TOOLS, FigmaAPI } from '@open-pencil/core'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

/**
 * 全量常用汉字的族名（构建期合成，见 scripts/build-cjk-font.py）。
 *
 * 引擎画文本节点时只认节点自己的 fontFamily，不走 CJK fallback 列表 ——
 * 所以含中文的节点必须指向一个**真的含中文字形**的族。
 */
export const FULL_CJK_FAMILY = 'OpenDesigner SC'

/** 引擎的工具清单。 */
export function agentTools(): { name: string; description: string }[] {
  return CORE_TOOLS.map((t) => ({ name: t.name, description: t.description }))
}

/** 拿一个工具。找不到就抛 —— 引擎改名了要立刻知道。 */
export function agentTool(name: string) {
  const found = CORE_TOOLS.find((t) => t.name === name)
  if (!found) throw new Error(`引擎没有 ${name} 工具`)
  return found
}

/** 造一个指向当前文档与当前页的工具上下文。 */
export function agentContext(graph: SceneGraph, currentPageId: string): FigmaAPI {
  const api = new FigmaAPI(graph)
  const pages = graph.getPages()
  const page =
    pages.find((p: { id: string }) => p.id === currentPageId) ?? pages[0]
  const proxy = page ? api.getNodeById(page.id) : null
  if (proxy) api.currentPage = proxy as never
  return api
}

/**
 * 补齐 `render` 工具建出来的文本节点缺���字段。
 *
 * 现象：JSX 渲染出来的 Frame 画得出来，里面的 Text 却**完全不显示** ——
 * 不是豆腐块，是空白。SVG 导出里明明有 `<text>` 元素，说明节点是好的。
 *
 * 原因是字段：
 * - `textDirection` / `layoutDirection` 缺失（引擎默认节点是 `"AUTO"`，
 *   render 工具建的节点是 `undefined`）
 * - `textAutoResize` 是 `"HEIGHT"` —— 高度随文字自动调整，
 *   而自动调整要靠字形测量；刚建出来、字形还没测量完，高度算成 0，
 *   零高度的文本节点不画。
 *
 * 所以这里显式补成 `"AUTO"` + `"NONE"`（高度用节点自带的值）。
 *
 * @returns 修正了几个节点
 */
export function normalizeRenderedNodes(graph: SceneGraph, rootIds: string[]): number {
  let fixed = 0
  const visit = (id: string): void => {
    const node = graph.getNode(id)
    if (!node) return
    if (node.type === 'TEXT') {
      const patch: Record<string, unknown> = {}
      if (node.textDirection === undefined || node.textDirection === null) {
        patch.textDirection = 'AUTO'
      }
      if (node.layoutDirection === undefined || node.layoutDirection === null) {
        patch.layoutDirection = 'AUTO'
      }
      if (node.textAutoResize === 'HEIGHT') {
        patch.textAutoResize = 'NONE'
      }
      // 含中文的文本换成全量字族 —— 默认的 Inter 没有中文字形，
      // 而精确子集只含文档里出现过的字，agent 新写的字会没有字形。
      if (/[^\x00-\x7F]/.test(node.text ?? '')) {
        patch.fontFamily = FULL_CJK_FAMILY
      }
      if (Object.keys(patch).length > 0) {
        graph.updateNode(id, patch)
        fixed += 1
      }
    }
    for (const child of graph.getChildren(id)) visit(child.id)
  }
  for (const id of rootIds) visit(id)
  return fixed
}

/** 找出页面下所有顶层节点（用来兜住 render 工具可能插到别处的情况）。 */
export function topLevelIds(graph: SceneGraph): string[] {
  return graph.getPages().flatMap((page: SceneNode) => graph.getChildren(page.id).map((n) => n.id))
}
