<script setup lang="ts">
/**
 * 导出面板。
 *
 * 引擎自带一整套导出器（HTML / Tailwind JSX / React JSX / SVG / PDF / PPTX），
 * 这里只是把它接出来 —— **一行转换代码都不用自己写**。
 *
 * 面板会先「生成预览」再「下载」：先看到代码再拿走文件，
 * 免得导出了才发现选错了范围。
 */
import { computed, ref } from 'vue'
import { useSelectionState } from '@open-pencil/vue'

import {
  EXPORT_FORMATS,
  exportDocument,
  download,
  resultToText,
  type ExportScope
} from './io'

const { editor, selectedIds } = useSelectionState()

const formatId = ref(EXPORT_FORMATS[0].id)
const scope = ref<ExportScope>('page')
const preview = ref<string>('')
const busy = ref(false)
const error = ref<string | null>(null)

const format = computed(() => EXPORT_FORMATS.find((f) => f.id === formatId.value)!)
const selectionCount = computed(() => selectedIds.value.size)

/** React JSX 只能导出单个节点或选中，整页导出会报错 —— 按钮上标出来。 */
const scopeLocked = computed(() => format.value.nodeOnly && scope.value === 'page')

function fileName(): string {
  return `opendesigner.${format.value.ext}`
}

async function generate(): Promise<void> {
  busy.value = true
  error.value = null
  try {
    const result = await exportDocument(
      editor.graph,
      formatId.value,
      scope.value,
      Array.from(selectedIds.value),
      fileName()
    )
    preview.value = resultToText(result)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    preview.value = ''
  } finally {
    busy.value = false
  }
}

async function save(): Promise<void> {
  busy.value = true
  error.value = null
  try {
    const result = await exportDocument(
      editor.graph,
      formatId.value,
      scope.value,
      Array.from(selectedIds.value),
      fileName()
    )
    download(result, fileName())
    preview.value = resultToText(result)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="section">
    <h3>导出</h3>
    <p class="muted small">
      引擎自带导出器，导出的是当前画布的真实内容 —— 不是截图，是代码。
    </p>

    <div class="fmt-grid">
      <button
        v-for="f in EXPORT_FORMATS"
        :key="f.id"
        class="btn tiny"
        :class="{ on: f.id === formatId }"
        @click="formatId = f.id"
      >
        {{ f.label }}
      </button>
    </div>

    <div class="scope-row">
      <button class="btn tiny" :class="{ on: scope === 'page' }" @click="scope = 'page'">整页</button>
      <button
        class="btn tiny"
        :class="{ on: scope === 'selection' }"
        :disabled="selectionCount === 0"
        @click="scope = 'selection'"
      >
        选中{{ selectionCount ? `（${selectionCount}）` : '' }}
      </button>
    </div>

    <p v-if="scopeLocked" class="warn small">
      {{ format.label }} 只能导出单个节点或选中，切到「选中」再导。
    </p>
    <p v-if="error" class="warn small">{{ error }}</p>

    <div class="btn-row">
      <button class="btn wide" :disabled="busy || scopeLocked" @click="generate">
        {{ busy ? '生成中…' : '生成预览' }}
      </button>
      <button class="btn wide primary" :disabled="busy || scopeLocked" @click="save">下载</button>
    </div>

    <pre v-if="preview" class="code-preview">{{ preview.slice(0, 4000) }}</pre>
    <p v-if="preview && preview.length > 4000" class="muted small">
      预览只显示前 4000 字符，下载的是完整内容。
    </p>
  </section>
</template>
