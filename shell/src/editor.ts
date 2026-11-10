import { reactive } from 'vue'

import { createDefaultEditorState, createEditor, type Editor } from '@open-pencil/core/editor'
import {
  collectGraphFontKeys,
  collectGraphFontRequirements,
  fontManager
} from '@open-pencil/core/text'

import {
  installHostFontLoader,
  promoteDefaultFontWhenReady,
  setFontCharacters
} from './fonts'
import { SceneGraph, type SceneGraph as Graph } from '@open-pencil/scene-graph'

/**
 * 字体：浏览器里引擎**不会自己联网**，必须由宿主给出 fetch，否则中文字全是豆腐块。
 * 上游 app 用的是同一套（见 src/app/editor/fonts/index.ts）。
 *
 * provider 说明：
 * - google   需要 fonts.google.com/metadata/fonts（unifont 的元数据端点）
 * - fontsource 走 api.fontsource.org，中文字体齐全
 * 所以默认全开，哪个能用就用哪个。
 */
function setupFonts(): void {
  if (typeof globalThis.fetch !== 'function') return
  fontManager.setWebFontFetch(globalThis.fetch.bind(globalThis))
  fontManager.setFallbackUserAgent(
    typeof navigator !== 'undefined' ? navigator.userAgent : undefined
  )
  fontManager.setOnlineFontProviders({
    google: true,
    fontsource: true,
    bunny: true,
    fontshare: true
  })
  // 主角是 hostFontLoader：按文档实际用字取精确子集，provider 链只当兜底。
  installHostFontLoader()
}

/**
 * 加载一个字体族，拿不到就换掉不可达的 provider 再试。
 *
 * 为什么需要降级：引擎按 provider 顺序试（google → fontsource → bunny → fontshare），
 * 第一个 provider 的**初始化**失败（不是取字体失败）会让整条链断掉 ——
 * google provider 要读 fonts.google.com/metadata/fonts，这个域在部分网络里不通，
 * 于是后面能用的 fontsource 根本轮不到。切一次 provider 会清掉失败缓存（setEnabled 会），
 * 所以换过去重试是有效的。
 */
async function loadFontsFor(
  keys: readonly (readonly [string, string])[],
  characters: string
): Promise<void> {
  // characters 必须给：字体服务按字符返回**子集**，不给字符只会拿到 latin 子集，
  // 中文就全是豆腐块，而且这份 latin 子集会被缓存下来，反而把正确的中文子集挡住。
  //
  // 串行 + 只切一次 provider：切 provider 会清掉失败缓存，
  // 并发切会互相把对方刚清掉的缓存又填上。
  let droppedGoogle = false
  for (const [family, style] of keys) {
    let loaded = await fontManager.loadFont(family, style, characters)
    if (!loaded && !droppedGoogle) {
      droppedGoogle = true
      fontManager.setOnlineFontProviders({
        google: false,
        fontsource: true,
        bunny: true,
        fontshare: true
      })
      loaded = await fontManager.loadFont(family, style, characters)
    }
    if (!loaded) {
      console.warn(`[fonts] 取不到字体 ${family} ${style}`)
    }
  }
}

/** 主色：品牌靛蓝 */
const BRAND = { r: 0.286, g: 0.353, b: 0.933, a: 1 }
/** 悬停态：更亮一点 */
const BRAND_HOVER = { r: 0.353, g: 0.42, b: 0.98, a: 1 }
/** 按下态：更暗 */
const BRAND_PRESSED = { r: 0.208, g: 0.259, b: 0.804, a: 1 }

function solid(color: { r: number; g: number; b: number; a: number }) {
  return [{ type: 'SOLID' as const, color, opacity: 1, visible: true }]
}

/**
 * 建编辑器 + 一份中文演示文档。
 *
 * 三个要点（都是踩出来的）：
 * 1. `state` 必须包 `reactive`，Vue 侧才观察得到选中/工具/页面的变化。
 * 2. `getViewportSize` 返回的是**画布容器**尺寸，不是窗口尺寸；这里读容器的 clientWidth。
 * 3. 带 behaviour 的组件要让 `addBehaviourStates` 建状态变体，它会自动把主组件包成组件集。
 */
export function createShellEditor(getViewportSize: () => { width: number; height: number }): {
  editor: Editor
  graph: Graph
} {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  if (!page) throw new Error('Expected an initial page')

  const editor = createEditor({
    graph,
    state: reactive(createDefaultEditorState(page.id)),
    getViewportSize
  })

  buildDemo(graph, editor, page.id)

  // 字体要等到位，否则第一帧是豆腐块。
  void applyFonts(graph, page.id, editor)

  return { editor, graph }
}

/**
 * 按当前文档实际用到的字加载字体。
 *
 * 打开别的 od 文档后要再跑一次 —— 换了文档就换了字。
 */
export async function applyFonts(
  graph: Graph,
  rootId: string,
  editor?: Editor
): Promise<void> {
  setupFonts()
  const childIds = graph.getChildren(rootId).map((n) => n.id)
  const keys = collectGraphFontKeys(graph, childIds)
  const characters = collectGraphFontRequirements(graph, childIds).characters
  setFontCharacters(characters + collectNodeNames(graph, rootId))
  try {
    await loadFontsFor(keys, characters)
    await editor?.loadFontsForNodes(childIds)
  } catch {
    /* 字体拉不到时保持现状，不阻断编辑 */
  }
  // 图层标签走默认字体，得单独把它提成带中文字形的那一份
  promoteDefaultFontWhenReady('Noto Sans SC', (ok) => {
    if (!ok) return
    // 换了默认字体，之前的帧是空的，得让画布重画一遍
    if (editor) editor.state.canvasVersion += 1
  })
}

/**
 * 收集所有图层的名字。
 *
 * 引擎会把组件集名、图层名画成标签浮在画布上，那些字**不在文本节点里**，
 * 但用的是同一套字体 —— 字体子集里没有就成了豆腐块（"按钮" → □□）。
 */
function collectNodeNames(graph: Graph, rootId: string): string {
  const names: string[] = []
  const visit = (id: string): void => {
    const node = graph.getNode(id)
    if (!node) return
    if (node.name) names.push(node.name)
    for (const child of graph.getChildren(id)) visit(child.id)
  }
  visit(rootId)
  return names.join('')
}

/** 造一份能演示、能预览、能玩的中文文档。 */
function buildDemo(graph: Graph, editor: Editor, pageId: string): void {
  // ── 画板 ────────────────────────────────────────────────────────────
  const board = graph.createNode('FRAME', pageId, {
    name: '画板 · 产品发布',
    x: 0,
    y: 0,
    width: 1440,
    height: 900,
    clipsContent: true,
    fills: solid({ r: 0.984, g: 0.976, b: 0.961, a: 1 })
  })

  // ── 标题区 ──────────────────────────────────────────────────────────
  graph.createNode('TEXT', board.id, {
    name: '标签',
    text: '新版本发布',
    x: 96,
    y: 96,
    width: 400,
    height: 32,
    fontSize: 22,
    fontFamily: 'Noto Sans SC',
    fills: solid(BRAND)
  })
  graph.createNode('TEXT', board.id, {
    name: '主标题',
    text: '让设计稿\n直接变成代码',
    x: 96,
    y: 140,
    width: 720,
    height: 200,
    fontSize: 68,
    fontFamily: 'Noto Sans SC',
    fontWeight: 700,
    lineHeight: 84,
    fills: solid({ r: 0.086, g: 0.09, b: 0.11, a: 1 })
  })
  graph.createNode('TEXT', board.id, {
    name: '正文',
    text: '文本格式、Git 友好，agent 可直接读写。改稿不再靠截图来回传。',
    x: 96,
    y: 360,
    width: 880,
    height: 40,
    fontSize: 22,
    fontFamily: 'Noto Sans SC',
    lineHeight: 36,
    fills: solid({ r: 0.35, g: 0.37, b: 0.42, a: 1 })
  })

  // ── 特性卡片 ────────────────────────────────────────────────────────
  const features = [
    { title: '文本优先', body: 'JSONC 格式，git diff 可读' },
    { title: 'agent 可写', body: 'MCP 五个工具直接改稿' },
    { title: '无损往返', body: '组件 / 变量 / 布局都不丢' }
  ]
  features.forEach((f, i) => {
    const card = graph.createNode('FRAME', board.id, {
      name: `卡片 · ${f.title}`,
      x: 96 + i * 268,
      y: 480,
      width: 240,
      height: 150,
      cornerRadius: 16,
      fills: solid({ r: 1, g: 1, b: 1, a: 1 }),
      strokes: [{ ...solid({ r: 0.9, g: 0.9, b: 0.92, a: 1 })[0], weight: 1, align: 'INSIDE' }]
    })
    graph.createNode('TEXT', card.id, {
      name: '卡片标题',
      text: f.title,
      x: 20,
      y: 20,
      width: 200,
      height: 32,
      fontSize: 22,
      fontFamily: 'Noto Sans SC',
      fontWeight: 600,
      fills: solid({ r: 0.1, g: 0.11, b: 0.13, a: 1 })
    })
    graph.createNode('TEXT', card.id, {
      name: '卡片正文',
      text: f.body,
      x: 20,
      y: 60,
      width: 200,
      height: 56,
      fontSize: 16,
      fontFamily: 'Noto Sans SC',
      lineHeight: 26,
      fills: solid({ r: 0.42, g: 0.44, b: 0.5, a: 1 })
    })
  })

  // ── 带 behaviour 的按钮组件（预览时能真的点） ────────────────────────
  const compId = editor.createShape('COMPONENT', 96, 700, 200, 56, board.id, '按钮')
  graph.createNode('TEXT', compId, {
    name: '标签',
    text: '立即体验',
    x: 20,
    y: 17,
    width: 160,
    height: 24,
    fontSize: 20,
    fontFamily: 'Noto Sans SC',
    fontWeight: 600,
    textAlignHorizontal: 'CENTER',
    fills: solid({ r: 1, g: 1, b: 1, a: 1 })
  })
  // 先装一个裸 behaviour，addBehaviourStates 才能补齐状态变体
  editor.setBehaviour(compId, {
    kind: 'button',
    booleans: {},
    texts: {},
    numbers: {},
    parts: {}
  })
  editor.addBehaviourStates(compId)

  // 让 5 个状态各有各的样子，否则预览里看不出变化
  const setId = graph.getNode(compId)?.parentId ?? compId
  const stateFills: Record<string, { r: number; g: number; b: number; a: number }> = {
    Default: BRAND,
    Hover: BRAND_HOVER,
    Pressed: BRAND_PRESSED,
    Focus: BRAND_HOVER,
    Disabled: { r: 0.78, g: 0.79, b: 0.82, a: 1 }
  }
  for (const variant of graph.getChildren(setId)) {
    if (variant.type !== 'COMPONENT') continue
    const state = variant.componentPropertyValues?.State ?? 'Default'
    const fill = stateFills[state]
    if (fill) graph.updateNode(variant.id, { fills: solid(fill) })
  }

  // 实例放到画板外（页面顶层），预览岛才认它
  editor.createInstanceFromComponent(compId, 320, 700, board.id)

  editor.zoomToFit()
}
