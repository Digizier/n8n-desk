import { ref, computed, onUnmounted } from 'vue'
import { useChatStore } from '@/stores/chat'
import { useInstancesStore } from '@/stores/instances'
import { ChatHubService } from '@/services/chathub'
import { ChatHubStreamService } from '@/services/chathub-stream'
import { createApiClient } from '@/services/n8n-api'
import type {
  ChatHubConversationModel,
  ChatHubPushMessage,
  ChatModelDto,
  ChatAttachment,
  ChatSessionId,
  ChatMessageId,
} from '@/types/chathub'
import type { ConnectionStatus } from '@/types/connection'
import type { SessionMessage } from '@/types/session'

/** Singleton stream service — one WebSocket connection per app */
let sharedStreamService: ChatHubStreamService | null = null

function getStreamService(): ChatHubStreamService {
  if (!sharedStreamService) {
    sharedStreamService = new ChatHubStreamService()
  }
  return sharedStreamService
}

export function useChatHub() {
  const chatStore = useChatStore()
  const instancesStore = useInstancesStore()

  const streamStatus = ref<ConnectionStatus>('disconnected')
  const error = ref<string | null>(null)
  const isLoadingAgents = ref(false)

  const isConnected = computed(() => streamStatus.value === 'connected')
  const isReconnecting = computed(() => streamStatus.value === 'reconnecting')
  const agents = computed(() => chatStore.agents)
  const isStreaming = computed(() => chatStore.isStreaming)

  // Track cleanup functions
  let unsubEvent: (() => void) | null = null
  let unsubStatus: (() => void) | null = null

  function getService(): ChatHubService | null {
    const client = createApiClient()
    if (!client) return null
    return new ChatHubService(client)
  }

  /**
   * Route WebSocket push events to the appropriate chat store handler.
   */
  function handlePushEvent(event: ChatHubPushMessage): void {
    switch (event.type) {
      case 'chatHubStreamBegin':
        chatStore.handleStreamBegin(event)
        break
      case 'chatHubStreamChunk':
        chatStore.handleStreamChunk(event)
        break
      case 'chatHubStreamEnd':
        void chatStore.handleStreamEnd(event)
        break
      case 'chatHubStreamError':
        chatStore.handleStreamError(event)
        break
      case 'chatHubHumanMessageCreated':
        chatStore.handleHumanMessageCreated(event)
        break
      case 'chatHubMessageEdited':
        chatStore.handleMessageEdited(event)
        break
      case 'chatHubExecutionBegin':
        chatStore.handleExecutionBegin(event)
        break
      case 'chatHubExecutionEnd':
        chatStore.handleExecutionEnd(event)
        break
    }
  }

  /**
   * Handle WebSocket status changes. On reconnect, replay missed chunks
   * for any active streaming sessions.
   */
  function handleStatusChange(status: ConnectionStatus): void {
    const previousStatus = streamStatus.value
    streamStatus.value = status

    if (status === 'connected' && previousStatus === 'reconnecting') {
      void replayMissedChunks()
    }
  }

  /**
   * After reconnecting, call the reconnect endpoint for any sessions
   * that were actively streaming to replay missed chunks.
   */
  async function replayMissedChunks(): Promise<void> {
    const service = getService()
    if (!service) return

    for (const [sessionId, stream] of chatStore.activeStreams) {
      if (!stream.isStreaming) continue

      try {
        const result = await service.reconnect(sessionId)
        if (result.hasActiveStream && result.pendingChunks.length > 0) {
          for (const chunk of result.pendingChunks) {
            chatStore.handleStreamChunk({
              type: 'chatHubStreamChunk',
              data: {
                sessionId,
                messageId: stream.messageId,
                sequenceNumber: chunk.sequenceNumber,
                timestamp: Date.now(),
                content: chunk.content,
              },
            })
          }
        }
      } catch {
        // Reconnect failed for this session — it will resolve on next stream event
      }
    }
  }

  /**
   * Connect the WebSocket to the active n8n instance.
   */
  function connect(): void {
    const instance = instancesStore.activeInstance
    if (!instance) return

    const streamService = getStreamService()

    // Clean up previous subscriptions
    unsubEvent?.()
    unsubStatus?.()

    unsubEvent = streamService.onEvent(handlePushEvent)
    unsubStatus = streamService.onStatusChange(handleStatusChange)

    streamService.connect(instance.url)
  }

  /**
   * Disconnect the WebSocket and clean up subscriptions.
   */
  function disconnect(): void {
    unsubEvent?.()
    unsubStatus?.()
    unsubEvent = null
    unsubStatus = null

    const streamService = getStreamService()
    streamService.disconnect()
    streamStatus.value = 'disconnected'
  }

  /**
   * Load available agents/models from the Chat-Hub API.
   */
  async function loadAgents(): Promise<ChatModelDto[]> {
    const service = getService()
    if (!service) {
      error.value = 'No active instance'
      return []
    }

    isLoadingAgents.value = true
    error.value = null

    try {
      const response = await service.getModels()
      const allModels: ChatModelDto[] = []

      for (const providerKey of Object.keys(response) as Array<keyof typeof response>) {
        const entry = response[providerKey]
        if (entry.models) {
          allModels.push(...entry.models)
        }
      }

      chatStore.setAgents(allModels)
      return allModels
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load agents'
      return []
    } finally {
      isLoadingAgents.value = false
    }
  }

  /**
   * Select an agent/model for the current session.
   * Returns the model config to use in sendMessage calls.
   */
  function selectAgent(model: ChatHubConversationModel): void {
    const session = chatStore.activeSession
    if (session) {
      if ('model' in model) {
        session.model = model.model
      }
      if ('agentId' in model) {
        session.agentId = model.agentId
      }
    }
  }

  /**
   * Send a message in the active session. Creates a new session if needed.
   */
  async function sendMessage(
    message: string,
    model: ChatHubConversationModel,
    options?: {
      attachments?: ChatAttachment[]
      sessionId?: ChatSessionId
    },
  ): Promise<void> {
    const service = getService()
    if (!service) {
      error.value = 'No active instance'
      return
    }

    error.value = null

    let sessionId = options?.sessionId ?? chatStore.activeSessionId
    if (!sessionId) {
      // Create a new session with the first message as title
      const title = message.length > 50 ? `${message.slice(0, 47)}...` : message
      sessionId = await chatStore.createSession(title)
    }

    // Append the user message to local state
    const userMessage: SessionMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      role: 'user',
      content: message,
      ts: new Date().toISOString(),
    }
    await chatStore.appendMessage(userMessage)

    // Find the previous message ID for the server
    const msgs = chatStore.messagesBySession.get(sessionId) ?? []
    const previousMessageId = msgs.length > 1 ? msgs[msgs.length - 2]?.id : undefined

    try {
      await service.sendMessage({
        sessionId,
        message,
        model,
        previousMessageId,
        attachments: options?.attachments,
      })
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to send message'
    }
  }

  /**
   * Edit a previously sent user message and regenerate the AI response.
   */
  async function editMessage(
    sessionId: ChatSessionId,
    messageId: ChatMessageId,
    newContent: string,
    model: ChatHubConversationModel,
    attachments?: ChatAttachment[],
  ): Promise<void> {
    const service = getService()
    if (!service) return

    error.value = null

    try {
      await service.editMessage({
        sessionId,
        messageId,
        message: newContent,
        model,
        attachments,
      })
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to edit message'
    }
  }

  /**
   * Regenerate an AI response from a specific message.
   */
  async function regenerateMessage(
    sessionId: ChatSessionId,
    messageId: ChatMessageId,
    model: ChatHubConversationModel,
  ): Promise<void> {
    const service = getService()
    if (!service) return

    error.value = null

    try {
      await service.regenerateMessage({
        sessionId,
        messageId,
        model,
      })
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to regenerate message'
    }
  }

  /**
   * Stop an in-progress AI generation.
   */
  async function stopGeneration(sessionId?: ChatSessionId): Promise<void> {
    const service = getService()
    if (!service) return

    const targetSessionId = sessionId ?? chatStore.activeSessionId
    if (!targetSessionId) return

    error.value = null

    try {
      await service.stopGeneration(targetSessionId)
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to stop generation'
    }
  }

  // Clean up on component unmount
  onUnmounted(() => {
    unsubEvent?.()
    unsubStatus?.()
    unsubEvent = null
    unsubStatus = null
  })

  return {
    // State
    streamStatus,
    error,
    isLoadingAgents,

    // Computed
    isConnected,
    isReconnecting,
    agents,
    isStreaming,

    // Actions
    connect,
    disconnect,
    loadAgents,
    selectAgent,
    sendMessage,
    editMessage,
    regenerateMessage,
    stopGeneration,
  }
}
