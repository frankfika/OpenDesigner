<script setup lang="ts">
import { useSelectionState } from '@open-pencil/vue'
import { PositionControlsRoot } from '@open-pencil/vue'

const { hasSelection, selectedNode } = useSelectionState()

const POSITION_FIELDS = [
  { key: 'x', label: 'X', slot: 'xValue' },
  { key: 'y', label: 'Y', slot: 'yValue' },
  { key: 'width', label: '宽', slot: 'wValue' },
  { key: 'height', label: '高', slot: 'hValue' }
] as const

type PositionKey = (typeof POSITION_FIELDS)[number]['key']

function setPosition(
  position: {
    xValue: number | symbol
    yValue: number | symbol
    wValue: number | symbol
    hValue: number | symbol
    actions: {
      updateProp: (key: PositionKey, value: number) => void
      commitProp: (key: PositionKey, value: number, previous: number) => void
    }
  },
  field: PositionKey,
  event: Event
): void {
  const value = Number((event.target as HTMLInputElement).value)
  const slot = POSITION_FIELDS.find((f) => f.key === field)!.slot
  const previous = position[slot]
  position.actions.updateProp(field, value)
  position.actions.commitProp(field, value, typeof previous === 'number' ? previous : value)
}
</script>

<template>
  <section class="section">
    <h3>属性</h3>
    <div v-if="!hasSelection" class="muted">未选中图层</div>
    <template v-else>
      <div class="field-label">类型：{{ selectedNode?.type }}</div>
      <PositionControlsRoot v-slot="position">
        <div v-if="position.active" class="grid4">
          <label v-for="f in POSITION_FIELDS" :key="f.key">
            <span>{{ f.label }}</span>
            <input
              type="number"
              :value="typeof position[f.slot] === 'number' ? (position[f.slot] as number) : ''"
              @change="setPosition(position, f.key, $event)"
            />
          </label>
        </div>
      </PositionControlsRoot>
    </template>
  </section>
</template>
