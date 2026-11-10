<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  CanvasRoot,
  CanvasSurface,
  LayerTreeItem,
  LayerTreeRoot,
  PageListRoot,
  PlayIslands,
  ToolbarItem,
  ToolbarRoot,
  provideEditor
} from '@open-pencil/vue'
import type { Tool } from '@open-pencil/core'

import { applyFonts, createShellEditor } from './editor'
import AgentPanel from './AgentPanel.vue'
import ExportPanel from './ExportPanel.vue'
import PropertiesPanel from './PropertiesPanel.vue'
import { downloadOd, graphToOdText, odTextToGraph } from './io'

const wrapRef = ref<HTMLElement | null>(null)

const { editor } = createShellEditor(() => ({
  width: wrapRef.value?.clientWidth ?? 1200,
  height: wrapRef.value?.clientHeight ?? 800
}))

provideEditor(editor)

/** 预览态：图层里的控件会作为真实组件跑起来 */
const playing = computed(() => editor.state.play !== null)
function togglePlay(): void {
  editor.togglePlay()
}

// ── od 文档：打开 / 保存 ────────────────────────────────────────────────
//
// 这是 OpenDesigner 的核心主张：**画布和文本是同一份东西**。
// 保存下来的 .od.json 就是 agent 能直接读、直接改的那份文件。

const fileInput = ref<HTMLInputElement | null>(null)
const fileError = ref<string | null>(null)
const docName = ref('产品发布 · v2')

async function onOpenFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  fileError.value = null
  try {
    const text = await file.text()
    const graph = odTextToGraph(text)
    editor.replaceGraph(graph)
    const page = graph.getPages()[0]
    if (page) {
      // 换文档后选中/页面 id 都失效了，指回新文档的第一页
      editor.state.currentPageId = page.id
      editor.state.selectedIds = new Set()
      void applyFonts(graph, page.id, editor)
    }
    editor.zoomToFit()
    docName.value = file.name
  } catch (e) {
    fileError.value = e instanceof Error ? e.message : String(e)
  }
}

function saveOd(): void {
  try {
    fileError.value = null
    downloadOd(graphToOdText(editor.graph), `${docName.value}.od.json`)
  } catch (e) {
    fileError.value = e instanceof Error ? e.message : String(e)
  }
}

async function copyOd(): Promise<void> {
  try {
    fileError.value = null
    await navigator.clipboard.writeText(graphToOdText(editor.graph))
    copied.value = true
    setTimeout(() => (copied.value = false), 1600)
  } catch (e) {
    fileError.value = e instanceof Error ? e.message : String(e)
  }
}

const copied = ref(false)

const TOOLS: { tool: Tool; label: string }[] = [
  { tool: 'SELECT', label: '选择' },
  { tool: 'FRAME', label: '画框' },
  { tool: 'RECTANGLE', label: '矩形' },
  { tool: 'ELLIPSE', label: '椭圆' },
  { tool: 'LINE', label: '直线' },
  { tool: 'POLYGON', label: '多边形' },
  { tool: 'STAR', label: '星形' },
  { tool: 'TEXT', label: '文本' },
  { tool: 'PEN', label: '钢笔' },
  { tool: 'HAND', label: '抓手' }
]

onMounted(() => {
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && playing.value) editor.stopPlay()
  })
})
</script>

<template>
  <div class="app">
    <!-- 顶栏 -->
    <header class="topbar">
      <div class="brand">
        <span class="logo">◧</span>
        <span class="product">OpenDesigner</span>
        <span class="doc">{{ docName }}</span>
      </div>
      <div class="topbar-actions">
        <input
          ref="fileInput"
          type="file"
          accept=".json,.od.json,application/json"
          class="hidden-input"
          @change="onOpenFile"
        />
        <button class="btn" @click="fileInput?.click()">打开 .od</button>
        <button class="btn" @click="copyOd">{{ copied ? '已复制 ✓' : '复制 od' }}</button>
        <button class="btn" @click="saveOd">保存 .od</button>
        <span v-if="fileError" class="file-error" :title="fileError">{{ fileError }}</span>
        <span v-if="playing" class="playing-hint">预览中 —— 画布里的按钮可以真的点</span>
        <button class="btn primary play-toggle" :class="{ on: playing }" @click="togglePlay">
          {{ playing ? '■ 退出预览' : '▶ 实时预览' }}
        </button>
      </div>
    </header>

    <!-- 工具栏 -->
    <ToolbarRoot>
      <div class="toolbar">
        <ToolbarItem v-for="item in TOOLS" :key="item.tool" v-slot="{ active, actions }" :tool="item.tool">
          <button :class="{ active }" :title="item.label" @click="actions.select">{{ item.label }}</button>
        </ToolbarItem>
      </div>
    </ToolbarRoot>

    <div class="main">
      <!-- 左栏 -->
      <aside class="panel left">
        <PageListRoot v-slot="{ pages, currentPageId, actions }">
          <section class="section">
            <h3>页面</h3>
            <div
              v-for="item in pages"
              :key="item.id"
              class="item"
              :class="{ active: item.id === currentPageId }"
              @click="actions.switch(item.id)"
            >
              {{ item.name }}
            </div>
          </section>
        </PageListRoot>

        <LayerTreeRoot v-slot="{ visibleRows }">
          <section class="section grow">
            <h3>图层</h3>
            <LayerTreeItem
              v-for="row in visibleRows"
              :key="row.node.id"
              v-slot="{ node, isSelected, padLeft, actions }"
              :node="row.node"
              :level="row.level"
              :has-children="row.hasChildren"
            >
              <div
                class="item"
                :class="{ active: isSelected }"
                :style="{ paddingLeft: `${padLeft + 8}px` }"
                @click="actions.select($event.shiftKey)"
              >
                <span v-if="row.hasChildren" class="toggle" @click.stop="actions.toggleExpand">▸</span>
                <span class="type-badge">{{ node.type.slice(0, 1) }}</span>
                {{ node.name }}
              </div>
            </LayerTreeItem>
          </section>
        </LayerTreeRoot>
      </aside>

      <!-- 画布 -->
      <div ref="wrapRef" class="canvas-wrap">
        <CanvasRoot v-slot="{ canvasRef }">
          <CanvasSurface class="canvas-surface" />
          <PlayIslands :view="editor.state" :canvas="canvasRef" />
        </CanvasRoot>
      </div>

      <!-- 右栏 -->
      <aside class="panel right">
        <PropertiesPanel />

        <AgentPanel />

        <ExportPanel />

        <section class="section">
          <h3>实时预览</h3>
          <p class="muted small">
            开启后，画布里带交互状态的组件会作为真实控件运行 —— 鼠标移上去会切到「悬停」变体，按下去切「按下」。
          </p>
          <button class="btn wide" :class="{ on: playing }" @click="togglePlay">
            {{ playing ? '退出预览' : '开启预览' }}
          </button>
        </section>
      </aside>
    </div>
  </div>
</template>
