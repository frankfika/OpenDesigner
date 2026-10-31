import { reactive } from 'vue'
import { createDefaultEditorState, createEditor } from '@open-pencil/core/editor'
import { SceneGraph } from '@open-pencil/scene-graph'
import type { Editor } from '@open-pencil/core/editor'

/**
 * 建一个最小可用的编辑器：一张页面 + 一个矩形。
 *
 * 关键点（踩过的坑）：
 * 1. `new SceneGraph()` 自带 root 节点和一张 "Page 1"，不用自己 addPage。
 * 2. `createEditor` 的 `state` 要包 `reactive`，Vue 侧才观察得到变化。
 * 3. `getViewportSize` 返回的是**画布容器**尺寸，不是窗口尺寸。
 */
export function createShellEditor(): { editor: Editor; graph: SceneGraph } {
  const graph = new SceneGraph()

  const page = graph.getPages()[0]
  if (!page) throw new Error('Expected an initial page')

  graph.createNode('RECTANGLE', page.id, {
    name: '矩形 1',
    x: 80,
    y: 80,
    width: 240,
    height: 160,
    fills: [
      {
        type: 'SOLID',
        color: { r: 0.29, g: 0.56, b: 0.94, a: 1 },
        opacity: 1,
        visible: true
      }
    ]
  })

  const editor = createEditor({
    graph,
    state: reactive(createDefaultEditorState(page.id)),
    getViewportSize: () => ({ width: 1200, height: 800 })
  })

  return { editor, graph }
}
