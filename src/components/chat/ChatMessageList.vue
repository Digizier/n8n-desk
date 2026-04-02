<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { MessageSquare } from 'lucide-vue-next'
import ChatMessage from './ChatMessage.vue'
import { useChatStore } from '@/stores/chat'

const props = defineProps<{
  sessionId: string | null
}>()

const emit = defineEmits<{
  editMessage: [messageId: string]
  regenerateMessage: [messageId: string]
}>()

const chatStore = useChatStore()
const scrollContainerRef = ref<HTMLDivElement | null>(null)

/** Whether the user has scrolled up from the bottom */
const userScrolledUp = ref(false)

const messages = computed(() => {
  if (!props.sessionId) return []
  return chatStore.messagesBySession.get(props.sessionId) ?? []
})

const isStreaming = computed(() => {
  if (!props.sessionId) return false
  const stream = chatStore.activeStreams.get(props.sessionId)
  return stream?.isStreaming ?? false
})

const streamingMessageId = computed(() => {
  if (!props.sessionId) return null
  const stream = chatStore.activeStreams.get(props.sessionId)
  return stream?.isStreaming ? stream.messageId : null
})

const isEmpty = computed(() => messages.value.length === 0)

function scrollToBottom(smooth = true): void {
  nextTick(() => {
    const el = scrollContainerRef.value
    if (!el) return
    el.scrollTo({
      top: el.scrollHeight,
      behavior: smooth ? 'smooth' : 'instant',
    })
  })
}

function handleScroll(): void {
  const el = scrollContainerRef.value
  if (!el) return
  const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
  userScrolledUp.value = distanceFromBottom > 100
}

// Auto-scroll on new messages (unless user scrolled up)
watch(
  () => messages.value.length,
  () => {
    if (!userScrolledUp.value) {
      scrollToBottom()
    }
  },
)

// Auto-scroll during streaming
watch(
  () => {
    if (!streamingMessageId.value || !props.sessionId) return ''
    const msgs = chatStore.messagesBySession.get(props.sessionId) ?? []
    const streamMsg = msgs.find((m) => m.id === streamingMessageId.value)
    return streamMsg?.content ?? ''
  },
  () => {
    if (!userScrolledUp.value && isStreaming.value) {
      scrollToBottom(false)
    }
  },
)

// Scroll to bottom on session change
watch(
  () => props.sessionId,
  () => {
    userScrolledUp.value = false
    scrollToBottom(false)
  },
)

onMounted(() => {
  scrollToBottom(false)
})

defineExpose({ scrollToBottom })
</script>

<template>
  <div
    ref="scrollContainerRef"
    :class="$style.scrollContainer"
    @scroll="handleScroll"
  >
    <div :class="$style.messagesInner">
      <!-- Empty state -->
      <div v-if="isEmpty" :class="$style.emptyState">
        <div :class="$style.emptyIcon"><MessageSquare :size="28" /></div>
        <p :class="$style.emptyTitle">Start a conversation</p>
        <p :class="$style.emptySubtitle">
          Send a message to begin chatting with your agent.
        </p>
      </div>

      <!-- Message list -->
      <template v-else>
        <ChatMessage
          v-for="msg in messages"
          :key="msg.id"
          :message="msg"
          :is-streaming="msg.id === streamingMessageId"
          @edit="emit('editMessage', $event)"
          @regenerate="emit('regenerateMessage', $event)"
        />
      </template>
    </div>

    <!-- Scroll-to-bottom button -->
    <button
      v-if="userScrolledUp && !isEmpty"
      :class="$style.scrollButton"
      title="Scroll to bottom"
      @click="userScrolledUp = false; scrollToBottom()"
    >
      ↓
    </button>
  </div>
</template>

<style lang="scss" module>
.scrollContainer {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  position: relative;
}

.messagesInner {
  width: 90%;
  max-width: 960px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 100%;
}

.emptyState {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
  text-align: center;
  padding: 24px 16px;
}

.emptyIcon {
  width: 52px;
  height: 52px;
  border-radius: 14px;
  background: var(--n8n-desk--surface-bg, var(--color--foreground));
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 16px;
  color: var(--color--text--tint-1);
}

.emptyTitle {
  font-size: 18px;
  font-weight: 600;
  color: var(--color--text--shade-1);
  margin: 0 0 6px;
}

.emptySubtitle {
  font-size: 13px;
  color: var(--color--text--tint-1);
  margin: 0;
  max-width: 400px;
  line-height: 1.5;
}

.scrollButton {
  position: sticky;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--n8n-desk--surface-bg);
  border: 1px solid var(--color--foreground--shade-3);
  color: var(--color--text);
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  z-index: 10;
  transition: background 0.15s ease;

  &:hover {
    background: var(--n8n-desk--surface-raised-bg);
  }
}
</style>
