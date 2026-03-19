<script setup lang="ts">
import { ref, computed } from 'vue'
import { openOutline, closeOutline, gitCompareOutline } from 'ionicons/icons'
import { IonIcon } from '@ionic/vue'
import type { WorkflowPreviewData } from '@/types/agent'
import { useInstancesStore } from '@/stores/instances'
import WorkflowEmbed from './WorkflowEmbed.vue'

interface Props {
  previewData: WorkflowPreviewData | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
  close: []
}>()

const instancesStore = useInstancesStore()
const showDiff = ref(false)

const hasDiff = computed(() => !!props.previewData?.workflowBefore)

const openInN8nUrl = computed(() => {
  if (!props.previewData?.workflowId) return null
  const instance = instancesStore.activeInstance
  if (!instance) return null
  return `${instance.url.replace(/\/$/, '')}/workflow/${props.previewData.workflowId}`
})

function openInN8n() {
  if (openInN8nUrl.value) {
    window.open(openInN8nUrl.value, '_blank')
  }
}
</script>

<template>
  <div :class="$style.panel">
    <!-- Empty state -->
    <div v-if="!previewData" :class="$style.empty">
      <p :class="$style.emptyText">Select a workflow to preview</p>
      <p :class="$style.emptyHint">Workflow previews will appear here when the agent creates or modifies workflows.</p>
    </div>

    <!-- Preview content -->
    <div v-else :class="$style.content">
      <div :class="$style.header">
        <span :class="$style.name">{{ previewData.name }}</span>
        <div :class="$style.headerActions">
          <button
            v-if="hasDiff"
            :class="[$style.diffBtn, showDiff && $style.diffBtnActive]"
            title="Toggle diff view"
            @click="showDiff = !showDiff"
          >
            <ion-icon :icon="gitCompareOutline" />
            Diff
          </button>
          <button
            v-if="openInN8nUrl"
            :class="$style.openLink"
            @click="openInN8n"
          >
            <ion-icon :icon="openOutline" :class="$style.openIcon" />
            Open in n8n
          </button>
          <button
            :class="$style.closeBtn"
            title="Close panel"
            @click="emit('close')"
          >
            <ion-icon :icon="closeOutline" />
          </button>
        </div>
      </div>

      <div :class="$style.embedWrapper">
        <WorkflowEmbed
          :workflow="previewData.workflow"
          :workflow-before="showDiff ? previewData.workflowBefore : undefined"
          :mode="showDiff && previewData.workflowBefore ? 'diff' : 'demo'"
          interactive
        />
      </div>
    </div>
  </div>
</template>

<style lang="scss" module>
.panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--n8n-desk--content-bg, var(--color--background));
}

.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
  text-align: center;
}

.emptyText {
  font-size: 15px;
  font-weight: 500;
  color: var(--color--text--shade-1);
  margin: 0 0 8px;
}

.emptyHint {
  font-size: 13px;
  color: var(--color--text--tint-1);
  margin: 0;
  max-width: 240px;
  line-height: 1.5;
}

.content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--n8n-desk--surface-bg, var(--color--foreground));
  flex-shrink: 0;
}

.name {
  font-size: 14px;
  font-weight: 600;
  color: var(--color--text--shade-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.headerActions {
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
  border-radius: 4px;
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
  border-radius: 4px;
  white-space: nowrap;

  &:hover {
    background: var(--n8n-desk--surface-raised-bg, var(--color--foreground--tint-2));
  }
}

.openIcon {
  font-size: 14px;
}

.closeBtn {
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
  font-size: 18px;

  &:hover {
    background: var(--n8n-desk--surface-raised-bg, var(--color--foreground--tint-2));
    color: var(--color--text--shade-1);
  }
}

.embedWrapper {
  flex: 1;
  overflow: hidden;
  position: relative;
  z-index: 1;
  min-height: 0;

  :deep(.container) {
    height: 100%;
  }

  :deep(n8n-demo) {
    display: block;
    width: 100%;
    height: 100%;
  }
}
</style>
