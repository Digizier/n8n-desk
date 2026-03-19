<script setup lang="ts">
import { ref, computed } from 'vue'
import { IonIcon } from '@ionic/vue'
import { expandOutline, layersOutline, openOutline, gitCompareOutline } from 'ionicons/icons'
import type { WorkflowJson, WorkflowPreviewData } from '@/types/agent'
import { useInstancesStore } from '@/stores/instances'
import WorkflowEmbed from './WorkflowEmbed.vue'

interface Props {
  workflowId: string
  name: string
  workflow: WorkflowJson
  workflowBefore?: WorkflowJson
  isPanelActive?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  isPanelActive: false,
})

const emit = defineEmits<{
  popOut: [data: WorkflowPreviewData]
}>()

const instancesStore = useInstancesStore()
const showDiff = ref(false)

const nodeCount = computed(() => props.workflow.nodes?.length ?? 0)
const hasDiff = computed(() => !!props.workflowBefore)

const openInN8nUrl = computed(() => {
  if (!props.workflowId) return null
  const instance = instancesStore.activeInstance
  if (!instance) return null
  return `${instance.url.replace(/\/$/, '')}/workflow/${props.workflowId}`
})

function handlePopOut() {
  emit('popOut', {
    workflowId: props.workflowId,
    name: props.name,
    workflow: props.workflow,
    workflowBefore: props.workflowBefore,
  })
}

function openInN8n() {
  if (openInN8nUrl.value) {
    window.open(openInN8nUrl.value, '_blank')
  }
}

function toggleDiff() {
  showDiff.value = !showDiff.value
}
</script>

<template>
  <div :class="[$style.card, isPanelActive && $style.active]">
    <div :class="$style.header">
      <div :class="$style.info">
        <ion-icon :icon="layersOutline" :class="$style.icon" />
        <span :class="$style.name">{{ name }}</span>
        <span :class="$style.meta">{{ nodeCount }} node{{ nodeCount !== 1 ? 's' : '' }}</span>
      </div>
      <div :class="$style.actions">
        <button
          v-if="hasDiff"
          :class="[$style.diffBtn, showDiff && $style.diffBtnActive]"
          title="Toggle diff view"
          @click.stop="toggleDiff"
        >
          <ion-icon :icon="gitCompareOutline" />
          Diff
        </button>
        <button
          v-if="openInN8nUrl"
          :class="$style.openLink"
          title="Open in n8n"
          @click.stop="openInN8n"
        >
          <ion-icon :icon="openOutline" />
          Open in n8n
        </button>
        <button
          :class="$style.popOutBtn"
          :title="isPanelActive ? 'Viewing in panel' : 'Open in side panel'"
          @click.stop="handlePopOut"
        >
          <ion-icon :icon="expandOutline" />
        </button>
      </div>
    </div>

    <!-- Compact workflow visualization -->
    <div v-if="!isPanelActive" :class="$style.embedArea">
      <WorkflowEmbed
        :workflow="workflow"
        :workflow-before="showDiff ? workflowBefore : undefined"
        :mode="showDiff && workflowBefore ? 'diff' : 'demo'"
        compact
        interactive
      />
    </div>

    <!-- Minimized state when panel is showing this workflow -->
    <div v-else :class="$style.panelHint">
      Viewing in side panel
    </div>
  </div>
</template>

<style lang="scss" module>
.card {
  border: 1px solid var(--n8n-desk--surface-bg, var(--color--foreground));
  border-radius: 10px;
  overflow: hidden;
  background: var(--n8n-desk--surface-bg, var(--color--foreground));
  margin: 4px 0;
}

.active {
  border-color: var(--color--primary, #ff6d5a);
  border-style: dashed;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
}

.info {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.icon {
  font-size: 14px;
  color: var(--color--text--tint-1);
  flex-shrink: 0;
}

.name {
  font-size: 13px;
  font-weight: 600;
  color: var(--color--text--shade-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.meta {
  font-size: 11px;
  color: var(--color--text--tint-1);
  white-space: nowrap;
  flex-shrink: 0;
}

.actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.diffBtn {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--color--text--tint-1);
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  white-space: nowrap;

  &:hover {
    background: var(--n8n-desk--surface-raised-bg, var(--color--foreground--tint-2));
  }
}

.diffBtnActive {
  color: var(--color--primary, #ff6d5a);
  background: var(--n8n-desk--surface-raised-bg, var(--color--foreground--tint-2));
}

.openLink {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--color--primary, #ff6d5a);
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  white-space: nowrap;

  &:hover {
    background: var(--n8n-desk--surface-raised-bg, var(--color--foreground--tint-2));
  }
}

.popOutBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: none;
  color: var(--color--text--tint-1);
  cursor: pointer;
  flex-shrink: 0;
  font-size: 16px;

  &:hover {
    background: var(--n8n-desk--surface-raised-bg, var(--color--foreground--tint-2));
    color: var(--color--primary, #ff6d5a);
  }
}

.embedArea {
  height: 360px;
  overflow: hidden;
  border-top: 1px solid var(--n8n-desk--content-bg, var(--color--background));
}

.panelHint {
  padding: 12px;
  text-align: center;
  font-size: 12px;
  color: var(--color--text--tint-1);
  border-top: 1px solid var(--n8n-desk--content-bg, var(--color--background));
}
</style>
