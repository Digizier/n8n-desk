<template>
  <div :class="$style.container">
    <!-- Dot-grid background -->
    <div :class="$style.dotBg" />

    <!-- Model selector header -->
    <div v-if="hasChatContext" :class="$style.header">
      <button :class="$style.modelSelector" @click="pickerOpen = true">
        <div :class="$style.modelIcon">
          <LucideIcon
            v-if="selectedDto?.icon?.type === 'icon'"
            :name="selectedDto.icon.value"
            :size="16"
          />
          <span v-else-if="selectedDto">{{ selectedDto.name.charAt(0).toUpperCase() }}</span>
        </div>
        <span :class="$style.modelName">{{ displayName }}</span>
        <ChevronDown :size="14" :class="$style.chevron" />
      </button>
    </div>

    <template v-if="hasChatContext">
      <ChatMessageList
        v-if="activeSessionId"
        :session-id="activeSessionId"
        :class="$style.messageList"
        @edit-message="handleEditMessage"
        @regenerate-message="handleRegenerateMessage"
      />
      <div v-else :class="$style.messageList" />

      <ChatInput
        :is-streaming="isStreaming"
        :is-offline="!isConnected"
        :error="apiError"
        :allow-file-uploads="allowFileUploads"
        :allowed-files-mime-types="allowedFilesMimeTypes"
        @send="handleSend"
        @stop="handleStop"
        @dismiss-error="chatHub.clearError()"
      />
    </template>

    <div v-else :class="$style.emptyState">
      <div :class="$style.emptyIcon"><MessageSquare :size="28" /></div>
      <p :class="$style.emptyTitle">Chat Agent</p>
      <p :class="$style.emptyDescription">
        Select an agent and send a message to get started.
      </p>
      <div :class="$style.exampleGrid">
        <button
          v-for="ex in examplePrompts"
          :key="ex.label"
          :class="$style.exampleChip"
          @click="handleExamplePrompt(ex.prompt)"
        >
          <span :class="$style.exampleLabel">{{ ex.label }}</span>
          <ArrowRight :size="14" :class="$style.exampleArrow" />
        </button>
      </div>
    </div>

    <!-- Agent/Model picker modal -->
    <AgentPicker
      v-model:is-open="pickerOpen"
      :agents="chatStore.agents"
      :selected-model="chatStore.selectedModel"
      @select="handleModelSelect"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { MessageSquare, ChevronDown, ArrowRight } from 'lucide-vue-next'
import LucideIcon from '@/components/ui/LucideIcon.vue'
import ChatMessageList from './ChatMessageList.vue'
import ChatInput from './ChatInput.vue'
import AgentPicker from './AgentPicker.vue'
import { useChatHub } from '@/composables/useChatHub'
import { useChatStore } from '@/stores/chat'
import type { ChatModelDto, ChatHubConversationModel, ChatAttachment } from '@/types/chathub'

const chatStore = useChatStore()
const chatHub = useChatHub()
const pickerOpen = ref(false)

const activeSessionId = computed(() => chatStore.activeSessionId)
const hasChatContext = computed(() => !!activeSessionId.value || chatStore.pendingNewChat)
const isStreaming = computed(() => chatStore.isStreaming)
const isConnected = computed(() => chatHub.isConnected.value)
const apiError = computed(() => chatHub.error.value)

const selectedDto = computed(() => chatStore.selectedModelDto)
const allowFileUploads = computed(() => selectedDto.value?.metadata?.allowFileUploads ?? false)
const allowedFilesMimeTypes = computed(() => selectedDto.value?.metadata?.allowedFilesMimeTypes ?? '')
const displayName = computed(() => {
  const dto = selectedDto.value
  if (dto) return dto.name
  const model = chatStore.selectedModel
  if (model && 'model' in model) return model.model
  return 'Select model'
})

function getCurrentModel(): ChatHubConversationModel {
  // Use the store's selected model
  if (chatStore.selectedModel) {
    return chatStore.selectedModel
  }
  // If there's a pending agent (not yet sent first message), use its model
  const pending = chatStore.pendingAgent
  if (pending) {
    return pending.model
  }
  const session = chatStore.activeSession
  // If session has an agentId, use the custom-agent model
  if (session?.agentId) {
    return { provider: 'custom-agent', agentId: session.agentId }
  }
  // Fallback to the first available agent's model definition
  const firstAgent = chatStore.agents[0]
  if (firstAgent) {
    return firstAgent.model
  }
  // Last resort fallback
  return { provider: 'openai', model: 'gpt-4' }
}

function handleModelSelect(agent: ChatModelDto) {
  chatStore.selectModel(agent.model)
  // Switching model/agent always starts a new chat session
  chatStore.preparePendingChat()
}

async function handleSend(message: string, _folders: unknown, attachments?: ChatAttachment[]): Promise<void> {
  const model = getCurrentModel()
  await chatHub.sendMessage(message, model, attachments?.length ? { attachments } : undefined)
}

async function handleStop(): Promise<void> {
  await chatHub.stopGeneration()
}

async function handleEditMessage(messageId: string): Promise<void> {
  const sessionId = activeSessionId.value
  if (!sessionId) return

  const messages = chatStore.messagesBySession.get(sessionId) ?? []
  const msg = messages.find((m) => m.id === messageId)
  if (!msg || msg.role !== 'user') return

  const model = getCurrentModel()
  await chatHub.editMessage(sessionId, messageId, msg.content, model)
}

async function handleRegenerateMessage(messageId: string): Promise<void> {
  const sessionId = activeSessionId.value
  if (!sessionId) return

  const model = getCurrentModel()
  await chatHub.regenerateMessage(sessionId, messageId, model)
}

const examplePrompts = [
  { label: 'Summarize recent activity', prompt: 'Summarize what happened in my workflows over the past week' },
  { label: 'Help debug a workflow', prompt: 'Help me debug why my workflow is failing on the HTTP Request node' },
  { label: 'Explain a concept', prompt: 'Explain how webhook triggers work in n8n' },
  { label: 'Draft a message', prompt: 'Draft a Slack message summarizing today\'s workflow execution results' },
]

function handleExamplePrompt(prompt: string) {
  chatStore.preparePendingChat()
  handleSend(prompt, [], [])
}
</script>

<style lang="scss" module>
.container {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--n8n-desk--content-bg, var(--color--background));
  position: relative;
}

.dotBg {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background-image: radial-gradient(circle, var(--n8n-desk--grid-dot-color, var(--canvas--dot--color, rgba(0, 0, 0, 0.12))) 1px, transparent 1px);
  background-size: 24px 24px;
}

.header {
  display: flex;
  align-items: center;
  padding: 8px 16px;
  border-bottom: 1px solid var(--color--border--base, rgba(255, 255, 255, 0.06));
  flex-shrink: 0;
  position: relative;
  z-index: 1;
}

.modelSelector {
  display: flex;
  align-items: center;
  gap: 8px;
  background: transparent;
  border: none;
  color: var(--color--text);
  font-size: var(--font-size--sm, 14px);
  font-weight: var(--font-weight--semi-bold, 600);
  cursor: pointer;
  padding: 6px 10px;
  border-radius: var(--radius--2xs, 6px);
  transition: background 0.12s ease;

  &:hover {
    background: var(--n8n-desk--surface-raised-bg);
  }
}

.modelIcon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  color: var(--color--text--tint-1);
  font-size: 11px;
  font-weight: var(--font-weight--semi-bold, 600);
  flex-shrink: 0;
}

.modelName {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 250px;
}

.chevron {
  color: var(--color--text--tint-1);
  flex-shrink: 0;
}

.messageList {
  flex: 1;
  min-height: 0;
  position: relative;
  z-index: 1;
}

.emptyState {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  text-align: center;
  min-height: 60vh;
  position: relative;
  z-index: 1;
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

.emptyDescription {
  font-size: 13px;
  color: var(--color--text--tint-1);
  margin: 0 0 24px;
  max-width: 400px;
  line-height: 1.5;
}

.exampleGrid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  max-width: 480px;
  width: 100%;
}

.exampleChip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 10px;
  border: 1px solid var(--n8n-desk--surface-raised-bg, var(--color--foreground));
  background: var(--n8n-desk--surface-bg, var(--color--foreground));
  color: var(--color--text);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;

  &:hover {
    background: var(--n8n-desk--surface-raised-bg, var(--color--foreground--tint-1));
    border-color: var(--color--text--tint-2);
  }
}

.exampleLabel {
  flex: 1;
  line-height: 1.4;
}

.exampleArrow {
  flex-shrink: 0;
  color: var(--color--text--tint-1);
  opacity: 0;
  transition: opacity 0.15s;

  .exampleChip:hover & {
    opacity: 1;
  }
}
</style>
