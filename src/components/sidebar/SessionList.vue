<script setup lang="ts">
import { IonList, IonItem, IonLabel, IonListHeader } from '@ionic/vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { SessionMeta } from '@/types/session'

const props = defineProps<{
  sessions: SessionMeta[]
  activeSessionId?: string | null
  searchQuery?: string
  listHeader: string
}>()

defineEmits<{
  select: [id: string]
}>()

const { t } = useI18n()

const filteredSessions = computed(() => {
  const query = (props.searchQuery ?? '').toLowerCase().trim()
  if (!query) return props.sessions
  return props.sessions.filter((s) =>
    s.title.toLowerCase().includes(query)
  )
})
</script>

<template>
  <div class="session-list-wrapper">
    <ion-list-header>
      <ion-label>{{ listHeader }}</ion-label>
    </ion-list-header>
    <ion-list lines="none" class="session-list">
      <ion-item
        v-for="session in filteredSessions"
        :key="session.id"
        button
        class="session-item"
        :class="{ 'session-item--active': session.id === activeSessionId }"
        @click="$emit('select', session.id)"
      >
        <ion-label>{{ session.title }}</ion-label>
      </ion-item>
      <ion-item v-if="filteredSessions.length === 0" class="session-item session-item--empty">
        <ion-label color="medium">{{ t('sidebar.noSessionsFound') }}</ion-label>
      </ion-item>
    </ion-list>
  </div>
</template>

<style scoped lang="scss">
.session-list-wrapper {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.session-list {
  background: transparent;

  .session-item {
    --background: transparent;
    --min-height: 36px;
    --padding-start: var(--spacing--xs);
    --inner-padding-end: var(--spacing--xs);
    font-size: var(--font-size--sm);
    border-radius: var(--radius--2xs);
    margin-bottom: 2px;
    cursor: pointer;

    &:hover {
      --background: var(--n8n-desk--surface-raised-bg);
    }

    &--active {
      --background: var(--n8n-desk--surface-raised-bg);
      font-weight: var(--font-weight--medium);
    }

    &--empty {
      cursor: default;
      font-size: var(--font-size--2xs);

      &:hover {
        --background: transparent;
      }
    }
  }
}
</style>
