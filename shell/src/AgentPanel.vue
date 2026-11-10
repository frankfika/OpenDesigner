<script setup lang="ts">
/**
 * Agent 面板。
 *
 * 引擎自带 24 个 agent 工具（`CORE_TOOLS`），其中最关键的是一对：
 *
 * - `render`  —— **JSX → 设计节点**。agent 写一段 JSX，画布上就长出东西。
 * - `get_jsx` —— **设计节点 → JSX**。把画布上的东西变回 agent 能读的代码。
 *
 * 这一对就是「agent 出图」的闭环：写 → 看 → 改 → 再看。
 * pen.dev 的核心卖点在这儿，本项目**不自己造**，直接用引擎的。
 *
 * 工具跑在 `FigmaAPI` 上下文里（`new FigmaAPI(graph)`），
 * 跟编辑器用的是同一个 graph —— 所以 agent 改的就是画布上的东西。
 */
import { computed, ref } from 'vue'
import { useSelectionState } from '@open-pencil/vue'

import {
  agentContext,
  agentTool,
  agentTools,
  normalizeRenderedNodes
} from './agent'
import { applyFonts } from './editor'

// useEditor() 返回的就是 editor 本身；useSelectionState() 里也带了 editor。
const { editor, selectedNode } = useSelectionState()

const jsx = ref(`<Frame name="卡片" w={320} h={180} bg="#FFFFFF" radius={16}>
  <Text name="标题" text="agent 出的图" fontSize={24} x={20} y={24} />
  <Frame name="按钮" w={120} h={40} bg="#4F6BF5" radius={8} x={20} y={100}>
    <Text name="标签" text="立即体验" fontSize={16} color="#FFFFFF" x={28} y={10} />
  </Frame>
</Frame>`)

const busy = ref(false)
const error = ref<string | null>(null)
const result = ref<string | null>(null)
const showTools = ref(false)

/** 引擎的工具清单 —— 直接展示，让人知道 agent 能调什么。 */
const tools = computed(() => agentTools())

/** 造一个指向当前文档的工具上下文。 */
function context() {
  return agentContext(editor.graph, editor.state.currentPageId)
}

function tool(name: string) {
  return agentTool(name)
}

/** JSX → 画布上的节点。 */
async function generate(): Promise<void> {
  busy.value = true
  error.value = null
  result.value = null
  try {
    const nodeId = editor.state.currentPageId
    const out = (await tool('render').execute(context(), {
      jsx: jsx.value,
      x: 80,
      y: 80,
      parent_id: nodeId
    })) as { id?: string; name?: string; type?: string; error?: string }
    if (out?.error) {
      error.value = out.error
    } else {
      // render 工具建的文本节点少几个字段，画布上不显示 —— 补齐
      const fixed = normalizeRenderedNodes(editor.graph, [out?.id ?? ''])
      // 新节点的字体还没就绪，引擎会把它 block 掉不渲染 —— 先把字体拉上
      if (out?.id) await editor.loadFontsForNodes([out.id])
      /**
       * 关键一步：字体子集是按**文档里出现过的字**取的（Google Fonts 的
       * text= 参数只给这些字的字形）。agent 新写的字不在子集里，
       * 引擎发现字形覆盖不全会把节点 block 掉 —— 表现是「节点在、图层树里有，
       * 画布上就是不显示」。
       * 所以要按新文本重新收集字符集、再加载一次，让子集补上这些字。
       */
      const pageId = editor.state.currentPageId
      await applyFonts(editor.graph, pageId, editor)
      editor.state.canvasVersion += 1
      result.value =
        `生成成功：${out?.name ?? '(未命名)'}（${out?.type ?? '?'}）` +
        (fixed ? ` · 补齐 ${fixed} 个文本节点` : '')
      editor.zoomToFit()
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

/** 画布上的节点 → JSX（agent 能读回去）。 */
async function exportJsx(): Promise<void> {
  const node = selectedNode.value
  if (!node) {
    error.value = '先在画布上选一个图层'
    return
  }
  busy.value = true
  error.value = null
  try {
    const out = (await tool('get_jsx').execute(context(), { id: node.id })) as {
      jsx?: string
      error?: string
      truncated?: boolean
    }
    if (out?.error) {
      error.value = out.error
      return
    }
    jsx.value = out.jsx ?? ''
    result.value = out.truncated ? '已导出（超长，被截断）' : '已导出到上面的输入框'
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="section">
    <h3>Agent 出图</h3>
    <p class="muted small">
      引擎自带 24 个 agent 工具。写一段 JSX，画布上就长出东西；
      再把画布上的东西导回 JSX —— agent 能写，也能读回来看自己改了什么。
    </p>

    <textarea
      v-model="jsx"
      class="jsx-input"
      spellcheck="false"
      rows="9"
      placeholder="&lt;Frame name=&quot;标题&quot; w={320} h={120}&gt;…&lt;/Frame&gt;"
    ></textarea>

    <div class="btn-row">
      <button class="btn wide primary" :disabled="busy" @click="generate">
        {{ busy ? '生成中…' : '生成到画布' }}
      </button>
      <button class="btn wide" :disabled="busy" @click="exportJsx">导出选中为 JSX</button>
    </div>

    <p v-if="result" class="ok small agent-ok">{{ result }}</p>
    <p v-if="error" class="warn small agent-error">{{ error }}</p>

    <button class="btn tiny tools-toggle" @click="showTools = !showTools">
      {{ showTools ? '▾' : '▸' }} 引擎的 {{ tools.length }} 个 agent 工具
    </button>
    <ul v-if="showTools" class="tool-list">
      <li v-for="t in tools" :key="t.name">
        <code>{{ t.name }}</code>
        <span>{{ t.description }}</span>
      </li>
    </ul>
  </section>
</template>
