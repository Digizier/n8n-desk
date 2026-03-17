import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import type { ChatSessionMeta, SessionMessage } from '@/types/session'
import type {
  ChatModelDto,
  ChatHubStreamBegin,
  ChatHubStreamChunk,
  ChatHubStreamEnd,
  ChatHubStreamError,
  ChatHubHumanMessageCreated,
  ChatHubMessageEdited,
  ChatHubExecutionBegin,
  ChatHubExecutionEnd,
} from '@/types/chathub'
import { localStorageService } from '@/services/local-storage'
import { useInstancesStore } from './instances'

function sessionIndexPath(instanceId: string): string {
  return `instances/${instanceId}/sessions/chat/index.json`
}

function sessionFilePath(instanceId: string, sessionId: string): string {
  return `instances/${instanceId}/sessions/chat/${sessionId}.jsonl`
}

function archivePath(instanceId: string, sessionId: string): string {
  return `instances/${instanceId}/sessions/chat/.archive/${sessionId}.jsonl`
}

function generateId(prefix: string, length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = `${prefix}_`
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

export interface StreamState {
  sessionId: string
  messageId: string
  buffer: string
  isStreaming: boolean
  sequenceNumber: number
}

export const useChatStore = defineStore('chat', () => {
  // Session state
  const sessions = ref<ChatSessionMeta[]>([])
  const activeSessionId = ref<string | null>(null)

  // Messages keyed by sessionId
  const messagesBySession = ref<Map<string, SessionMessage[]>>(new Map())

  // Agents/models discovered from Chat-Hub
  const agents = ref<ChatModelDto[]>([])

  // Streaming state — active streams keyed by sessionId
  const activeStreams = ref<Map<string, StreamState>>(new Map())

  // Execution state
  const executingSessions = ref<Set<string>>(new Set())

  // Computed
  const activeSession = computed(() =>
    sessions.value.find((s) => s.id === activeSessionId.value) ?? null
  )

  const sortedSessions = computed(() =>
    [...sessions.value].sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )
  )

  const messages = computed(() => {
    if (!activeSessionId.value) return []
    return messagesBySession.value.get(activeSessionId.value) ?? []
  })

  const isStreaming = computed(() => {
    if (!activeSessionId.value) return false
    const stream = activeStreams.value.get(activeSessionId.value)
    return stream?.isStreaming ?? false
  })

  const isExecuting = computed(() => {
    if (!activeSessionId.value) return false
    return executingSessions.value.has(activeSessionId.value)
  })

  // Helpers
  function getInstanceId(): string | null {
    const instancesStore = useInstancesStore()
    return instancesStore.activeInstanceId
  }

  async function persistSessionIndex(): Promise<void> {
    const instanceId = getInstanceId()
    if (!instanceId) return
    await localStorageService.writeJson(sessionIndexPath(instanceId), sessions.value)
  }

  // Core actions
  async function hydrate(): Promise<void> {
    const instanceId = getInstanceId()
    if (!instanceId) return

    const index = await localStorageService.readJson<ChatSessionMeta[]>(
      sessionIndexPath(instanceId)
    )
    sessions.value = index ?? []

    // Load messages for all sessions
    messagesBySession.value = new Map()
    for (const session of sessions.value) {
      const msgs = await localStorageService.readJsonl<SessionMessage>(
        sessionFilePath(instanceId, session.id)
      )
      messagesBySession.value.set(session.id, msgs)
    }

    // Set active to most recent if not set
    if (!activeSessionId.value && sessions.value.length > 0) {
      activeSessionId.value = sortedSessions.value[0].id
    }
  }

  function reset(): void {
    sessions.value = []
    activeSessionId.value = null
    messagesBySession.value = new Map()
    agents.value = []
    activeStreams.value = new Map()
    executingSessions.value = new Set()
  }

  async function syncWithServer(serverSessions: ChatSessionMeta[]): Promise<void> {
    const localByServerId = new Map<string, ChatSessionMeta>()
    for (const s of sessions.value) {
      if (s.serverSessionId) {
        localByServerId.set(s.serverSessionId, s)
      }
    }

    for (const serverSession of serverSessions) {
      const serverId = serverSession.serverSessionId ?? serverSession.id
      const existing = localByServerId.get(serverId)
      if (existing) {
        existing.title = serverSession.title
        existing.updatedAt = serverSession.updatedAt
        existing.syncedAt = new Date().toISOString()
        if (serverSession.agentId) existing.agentId = serverSession.agentId
        if (serverSession.agentName) existing.agentName = serverSession.agentName
      } else {
        const localSession: ChatSessionMeta = {
          ...serverSession,
          syncedAt: new Date().toISOString(),
        }
        sessions.value.push(localSession)
        messagesBySession.value.set(localSession.id, [])
      }
    }

    await persistSessionIndex()
  }

  async function createSession(
    title: string,
    agentId?: string,
    agentName?: string,
  ): Promise<string> {
    const instanceId = getInstanceId()
    if (!instanceId) throw new Error('No active instance')

    const id = generateId('session', 12)
    const now = new Date().toISOString()

    const session: ChatSessionMeta = {
      id,
      title,
      agentId,
      agentName,
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
    }

    sessions.value.push(session)
    messagesBySession.value.set(id, [])
    activeSessionId.value = id

    await persistSessionIndex()
    return id
  }

  async function deleteSession(id: string): Promise<void> {
    const instanceId = getInstanceId()
    if (!instanceId) return

    // Copy messages to archive
    const sourcePath = sessionFilePath(instanceId, id)
    const msgs = await localStorageService.readJsonl<SessionMessage>(sourcePath)
    if (msgs.length > 0) {
      const destPath = archivePath(instanceId, id)
      for (const msg of msgs) {
        await localStorageService.appendJsonl(destPath, msg)
      }
    }

    // Remove from state
    sessions.value = sessions.value.filter((s) => s.id !== id)
    messagesBySession.value.delete(id)

    if (activeSessionId.value === id) {
      activeSessionId.value = sessions.value.length > 0 ? sortedSessions.value[0].id : null
    }

    await persistSessionIndex()
  }

  function switchSession(id: string): void {
    if (sessions.value.some((s) => s.id === id)) {
      activeSessionId.value = id
    }
  }

  async function appendMessage(message: SessionMessage): Promise<void> {
    const instanceId = getInstanceId()
    if (!instanceId) return

    const sessionId = activeSessionId.value
    if (!sessionId) return

    const sessionMessages = messagesBySession.value.get(sessionId) ?? []
    sessionMessages.push(message)
    messagesBySession.value.set(sessionId, sessionMessages)

    await localStorageService.appendJsonl(
      sessionFilePath(instanceId, sessionId),
      message
    )

    const session = sessions.value.find((s) => s.id === sessionId)
    if (session) {
      session.updatedAt = message.ts
      session.messageCount = sessionMessages.length
      await persistSessionIndex()
    }
  }

  // Stream event handlers
  function handleStreamBegin(event: ChatHubStreamBegin): void {
    const { sessionId, messageId, sequenceNumber } = event.data
    activeStreams.value.set(sessionId, {
      sessionId,
      messageId,
      buffer: '',
      isStreaming: true,
      sequenceNumber,
    })

    const msgs = messagesBySession.value.get(sessionId) ?? []
    msgs.push({
      id: messageId,
      role: 'assistant',
      content: '',
      ts: new Date().toISOString(),
      meta: {
        previousMessageId: event.data.previousMessageId,
        retryOfMessageId: event.data.retryOfMessageId,
        executionId: event.data.executionId,
      },
    })
    messagesBySession.value.set(sessionId, msgs)
  }

  function handleStreamChunk(event: ChatHubStreamChunk): void {
    const { sessionId, content, sequenceNumber } = event.data
    const stream = activeStreams.value.get(sessionId)
    if (!stream) return

    stream.buffer += content
    stream.sequenceNumber = sequenceNumber

    const msgs = messagesBySession.value.get(sessionId)
    if (!msgs) return
    const msg = msgs.find((m) => m.id === stream.messageId)
    if (msg) {
      msg.content = stream.buffer
    }
  }

  async function handleStreamEnd(event: ChatHubStreamEnd): Promise<void> {
    const { sessionId, sequenceNumber } = event.data
    const stream = activeStreams.value.get(sessionId)
    if (!stream) return

    stream.isStreaming = false
    stream.sequenceNumber = sequenceNumber

    const instanceId = getInstanceId()
    if (instanceId) {
      const msgs = messagesBySession.value.get(sessionId)
      const msg = msgs?.find((m) => m.id === stream.messageId)
      if (msg) {
        msg.meta = { ...msg.meta, status: event.data.status }
        await localStorageService.appendJsonl(
          sessionFilePath(instanceId, sessionId),
          msg
        )
      }

      const session = sessions.value.find((s) => s.id === sessionId)
      if (session && msgs) {
        session.updatedAt = new Date().toISOString()
        session.messageCount = msgs.length
        session.lastSequenceNumber = sequenceNumber
        await persistSessionIndex()
      }
    }

    activeStreams.value.delete(sessionId)
  }

  function handleStreamError(event: ChatHubStreamError): void {
    const { sessionId } = event.data
    const stream = activeStreams.value.get(sessionId)
    if (!stream) return

    const msgs = messagesBySession.value.get(sessionId)
    const msg = msgs?.find((m) => m.id === stream.messageId)
    if (msg) {
      msg.meta = { ...msg.meta, error: event.data.error, status: 'error' }
    }

    stream.isStreaming = false
    activeStreams.value.delete(sessionId)
  }

  function handleHumanMessageCreated(event: ChatHubHumanMessageCreated): void {
    const { sessionId, messageId, content } = event.data
    const msgs = messagesBySession.value.get(sessionId)
    if (!msgs) return

    if (msgs.some((m) => m.id === messageId)) return

    msgs.push({
      id: messageId,
      role: 'user',
      content,
      ts: new Date(event.data.timestamp).toISOString(),
      meta: {
        previousMessageId: event.data.previousMessageId,
        attachments: event.data.attachments,
      },
    })
  }

  function handleMessageEdited(event: ChatHubMessageEdited): void {
    const { sessionId, revisionOfMessageId, messageId, content } = event.data
    const msgs = messagesBySession.value.get(sessionId)
    if (!msgs) return

    const original = msgs.find((m) => m.id === revisionOfMessageId)
    if (original) {
      original.content = content
      original.meta = { ...original.meta, revisedBy: messageId }
    }
  }

  function handleExecutionBegin(event: ChatHubExecutionBegin): void {
    executingSessions.value.add(event.data.sessionId)
  }

  function handleExecutionEnd(event: ChatHubExecutionEnd): void {
    executingSessions.value.delete(event.data.sessionId)
  }

  function setAgents(newAgents: ChatModelDto[]): void {
    agents.value = newAgents
  }

  function getStreamState(sessionId: string): StreamState | undefined {
    return activeStreams.value.get(sessionId)
  }

  return {
    // State
    sessions,
    activeSessionId,
    messagesBySession,
    agents,
    activeStreams,
    executingSessions,

    // Computed
    activeSession,
    sortedSessions,
    messages,
    isStreaming,
    isExecuting,

    // Actions
    hydrate,
    reset,
    syncWithServer,
    createSession,
    deleteSession,
    switchSession,
    appendMessage,
    setAgents,
    getStreamState,

    // Stream event handlers
    handleStreamBegin,
    handleStreamChunk,
    handleStreamEnd,
    handleStreamError,
    handleHumanMessageCreated,
    handleMessageEdited,
    handleExecutionBegin,
    handleExecutionEnd,
  }
})
