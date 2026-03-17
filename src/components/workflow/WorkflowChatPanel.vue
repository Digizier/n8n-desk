<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { IonIcon, IonSpinner } from '@ionic/vue'
import { sendOutline, settingsOutline } from 'ionicons/icons'
import { useWorkflowAgent } from '@/composables/useWorkflowAgent'
import { useSettingsStore } from '@/stores/settings'
import type { WorkflowPreviewData } from '@/types/agent'
import { renderMarkdown } from '@/utils/markdown'
import ToolCallCard from './ToolCallCard.vue'
import ApprovalCard from './ApprovalCard.vue'

const emit = defineEmits<{
  preview: [data: WorkflowPreviewData]
}>()

const {
  messages,
  isRunning,
  pendingApproval,
  toolCalls,
  sendMessage,
  approveAction,
} = useWorkflowAgent()

const settingsStore = useSettingsStore()
const hasLlmConfig = computed(() => settingsStore.hasLlmConfig)

const inputText = ref('')
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const scrollContainerRef = ref<HTMLDivElement | null>(null)

const canSend = computed(() =>
  inputText.value.trim().length > 0 && !isRunning.value && hasLlmConfig.value
)

// Auto-resize textarea
function resizeTextarea() {
  const el = textareaRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 150) + 'px'
}

function handleInput() {
  resizeTextarea()
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  }
}

async function send() {
  if (!canSend.value) return
  const text = inputText.value.trim()
  inputText.value = ''
  nextTick(resizeTextarea)
  await sendMessage(text)
}

function handleApprove(_id: string) {
  approveAction('approve')
}

function handleReject(_id: string) {
  approveAction('reject')
}

function handleToolPreview(data: WorkflowPreviewData) {
  emit('preview', data)
}

// Find tool call for a given message
function getToolCallForMessage(msgId: string) {
  return toolCalls.value.find((tc) => tc.id === msgId) ?? null
}

// Auto-scroll to bottom on new messages
function scrollToBottom() {
  const el = scrollContainerRef.value
  if (!el) return
  el.scrollTop = el.scrollHeight
}

watch(
  () => messages.value.length,
  () => nextTick(scrollToBottom),
)

watch(isRunning, () => nextTick(scrollToBottom))

onMounted(scrollToBottom)
</script>

<template>
  <div :class="$style.panel">
    <!-- Message list -->
    <div ref="scrollContainerRef" :class="$style.messages">
      <div v-if="messages.length === 0" :class="$style.empty">
        <p :class="$style.emptyTitle">Workflow Agent</p>
        <p :class="$style.emptyHint">Ask the agent to create, edit, or manage n8n workflows.</p>
      </div>

      <template v-for="msg in messages" :key="msg.id">
        <!-- User message -->
        <div v-if="msg.role === 'user'" :class="$style.userMsg">
          <div :class="$style.userBubble">{{ msg.content }}</div>
        </div>

        <!-- Assistant message -->
        <div v-else-if="msg.role === 'assistant'" :class="$style.assistantMsg">
          <div
            :class="$style.assistantBubble"
            v-html="renderMarkdown(msg.content)"
          />
        </div>

        <!-- Tool call -->
        <div v-else-if="msg.role === 'tool'" :class="$style.toolMsg">
          <ToolCallCard
            v-if="getToolCallForMessage(msg.meta?.toolCallId as string)"
            :tool-call="getToolCallForMessage(msg.meta?.toolCallId as string)!"
            @preview="handleToolPreview"
          />
        </div>

        <!-- System/error message -->
        <div v-else-if="msg.role === 'system'" :class="[$style.systemMsg, msg.meta?.error && $style.errorMsg]">
          {{ msg.content }}
        </div>
      </template>

      <!-- Inline tool calls not tied to messages -->
      <template v-for="tc in toolCalls" :key="tc.id">
        <div v-if="tc.status === 'running' || tc.status === 'pending'" :class="$style.toolMsg">
          <ToolCallCard :tool-call="tc" @preview="handleToolPreview" />
        </div>
      </template>

      <!-- Pending approval -->
      <div v-if="pendingApproval" :class="$style.toolMsg">
        <ApprovalCard
          :approval="pendingApproval"
          @approve="handleApprove"
          @reject="handleReject"
        />
      </div>

      <!-- Running indicator -->
      <div v-if="isRunning && !pendingApproval" :class="$style.runningIndicator">
        <IonSpinner name="dots" :class="$style.runningSpinner" />
      </div>
    </div>

    <!-- Input area -->
    <div :class="$style.inputArea">
      <div v-if="!hasLlmConfig" :class="$style.configHint">
        <ion-icon :icon="settingsOutline" :class="$style.configIcon" />
        Configure AI in Settings &gt; AI/Agent
      </div>
      <div :class="$style.inputRow">
        <textarea
          ref="textareaRef"
          v-model="inputText"
          :class="$style.textarea"
          :disabled="isRunning || !hasLlmConfig"
          placeholder="Describe a workflow to create or modify..."
          rows="1"
          @input="handleInput"
          @keydown="handleKeydown"
        />
        <button
          :class="$style.sendBtn"
          :disabled="!canSend"
          @click="send"
        >
          <ion-icon :icon="sendOutline" />
        </button>
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

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}

.emptyTitle {
  font-size: 16px;
  font-weight: 600;
  color: var(--color--text-dark, #333);
  margin: 0 0 4px;
}

.emptyHint {
  font-size: 13px;
  color: var(--color--text-light, #999);
  margin: 0;
}

.userMsg {
  display: flex;
  justify-content: flex-end;
}

.userBubble {
  max-width: 80%;
  padding: 10px 14px;
  border-radius: 16px 16px 4px 16px;
  background: var(--color--primary, #ff6d5a);
  color: #fff;
  font-size: 14px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.assistantMsg {
  display: flex;
  justify-content: flex-start;
}

.assistantBubble {
  max-width: 85%;
  padding: 10px 14px;
  border-radius: 16px 16px 16px 4px;
  background: var(--n8n-desk--surface-bg, var(--color--foreground));
  color: var(--color--text-dark, #333);
  font-size: 14px;
  line-height: 1.6;
  word-break: break-word;

  :deep(p) {
    margin: 0 0 8px;
    &:last-child { margin-bottom: 0; }
  }

  :deep(code) {
    font-size: 12px;
    background: var(--n8n-desk--content-bg, var(--color--background));
    padding: 2px 4px;
    border-radius: 3px;
  }

  :deep(pre) {
    background: var(--n8n-desk--content-bg, var(--color--background));
    padding: 8px;
    border-radius: 4px;
    overflow-x: auto;
    margin: 8px 0;

    code {
      background: none;
      padding: 0;
    }
  }
}

.toolMsg {
  max-width: 90%;
}

.systemMsg {
  text-align: center;
  font-size: 12px;
  color: var(--color--text-light, #999);
  padding: 4px 0;
}

.errorMsg {
  color: var(--color--danger, #ef4444);
}

.runningIndicator {
  display: flex;
  align-items: center;
  padding: 4px 0;
}

.runningSpinner {
  width: 24px;
  height: 24px;
  --color: var(--color--text-light, #999);
}

.inputArea {
  flex-shrink: 0;
  border-top: 1px solid var(--n8n-desk--surface-bg, var(--color--foreground));
  padding: 8px 12px 12px;
}

.configHint {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--color--warning, #f59e0b);
  padding: 4px 0 8px;
}

.configIcon {
  font-size: 14px;
}

.inputRow {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

.textarea {
  flex: 1;
  resize: none;
  border: 1px solid var(--n8n-desk--surface-bg, var(--color--foreground));
  border-radius: 12px;
  padding: 10px 14px;
  font-size: 14px;
  font-family: inherit;
  line-height: 1.5;
  background: var(--n8n-desk--surface-bg, var(--color--foreground));
  color: var(--color--text-dark, #333);
  outline: none;
  max-height: 150px;
  overflow-y: auto;

  &:focus {
    border-color: var(--color--primary, #ff6d5a);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &::placeholder {
    color: var(--color--text-light, #999);
  }
}

.sendBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: var(--color--primary, #ff6d5a);
  color: #fff;
  cursor: pointer;
  flex-shrink: 0;
  font-size: 18px;

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  &:not(:disabled):hover {
    opacity: 0.9;
  }
}
</style>
