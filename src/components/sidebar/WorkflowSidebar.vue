<script setup lang="ts">
import { IonButton, IonSearchbar } from '@ionic/vue'
import { Plus } from 'lucide-vue-next'
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import SessionList from './SessionList.vue'
import { useWorkflowSessionsStore } from '@/stores/workflow-sessions'

const { t } = useI18n()
const store = useWorkflowSessionsStore()
const searchQuery = ref('')

const activeSessionId = computed(() => store.activeSessionId)

async function newWorkflow() {
  await store.createSession()
}

async function selectSession(sessionId: string) {
  await store.selectSession(sessionId)
}
</script>

<template>
  <div class="workflow-sidebar">
    <!-- New Workflow Button -->
    <div class="sidebar-section">
      <ion-button expand="block" class="action-btn" @click="newWorkflow">
        <Plus :size="18" slot="start" />
        {{ t('sidebar.newWorkflow') }}
      </ion-button>
    </div>

    <!-- Search -->
    <div class="sidebar-section">
      <ion-searchbar
        v-model="searchQuery"
        :placeholder="t('sidebar.searchWorkflows')"
        :debounce="300"
      />
    </div>

    <!-- Session List -->
    <SessionList
      :sessions="store.sessions"
      :active-session-id="activeSessionId"
      :search-query="searchQuery"
      :list-header="t('sidebar.workflows')"
      @select="selectSession"
    />
  </div>
</template>

<style scoped lang="scss">
.workflow-sidebar {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.sidebar-section {
  padding: var(--spacing--2xs) var(--spacing--xs);
}

.action-btn {
  --background: var(--color--primary);
  --color: var(--color--neutral-white);
  --border-radius: var(--radius--xs);
  text-transform: none;
  letter-spacing: 0;
  font-weight: var(--font-weight--medium);
}

ion-searchbar {
  --background: var(--n8n-desk--surface-bg);
  --border-radius: var(--radius--xs);
  padding: 0;
}
</style>
