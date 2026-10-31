<script setup lang="ts">
import { provideEditor, CanvasRoot, CanvasSurface } from '@open-pencil/vue'
import { createShellEditor } from './editor'

const { editor } = createShellEditor()
provideEditor(editor)
</script>

<template>
  <div class="shell">
    <header class="shell-bar">OpenDesigner Shell · Phase 0 最小壳</header>
    <main class="shell-canvas">
      <CanvasRoot>
        <CanvasSurface class="size-full" />
      </CanvasRoot>
    </main>
  </div>
</template>

<style scoped>
.shell {
  display: grid;
  grid-template-rows: 48px 1fr;
  height: 100vh;
}

.shell-bar {
  display: flex;
  align-items: center;
  padding: 0 12px;
  font: 13px/1.4 system-ui, sans-serif;
  border-bottom: 1px solid #e5e5e5;
}

.shell-canvas {
  position: relative;
  overflow: hidden;
}
</style>
