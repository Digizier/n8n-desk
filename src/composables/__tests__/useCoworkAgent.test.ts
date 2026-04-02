import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { defineComponent, nextTick } from 'vue'
import { useCoworkAgent } from '@/composables/useCoworkAgent'
import { useCoworkSessionsStore } from '@/stores/cowork-sessions'
import type { AgentEvent } from '@/types/agent'

// Mock local-storage service (required by the cowork-sessions store)
vi.mock('@/services/local-storage', () => {
  const store: Record<string, string> = {}
  return {
    localStorageService: {
      readJson: vi.fn(async <T>(path: string): Promise<T | null> => {
        const data = store[path]
        return data ? (JSON.parse(data) as T) : null
      }),
      writeJson: vi.fn(async (path: string, data: unknown) => {
        store[path] = JSON.stringify(data)
      }),
      readJsonl: vi.fn(async <T>(path: string): Promise<T[]> => {
        const data = store[path]
        if (!data) return []
        return data
          .split('\n')
          .filter(Boolean)
          .map((line: string) => JSON.parse(line) as T)
      }),
      appendJsonl: vi.fn(async (path: string, item: unknown) => {
        const existing = store[path] ?? ''
        store[path] = existing + (existing ? '\n' : '') + JSON.stringify(item)
      }),
      _store: store,
      _reset: () => {
        Object.keys(store).forEach((k) => delete store[k])
      },
    },
  }
})

import { localStorageService } from '@/services/local-storage'
const mockStore = (localStorageService as unknown as { _store: Record<string, string>; _reset: () => void })

// Track event listener registrations
let capturedEventCallback: ((event: AgentEvent) => void) | null = null
const mockRemoveListener = vi.fn()
const mockInvoke = vi.fn().mockResolvedValue({ success: true })
const mockStop = vi.fn().mockResolvedValue({ success: true })
const mockApprove = vi.fn().mockResolvedValue({ success: true })
const mockTestConnection = vi.fn().mockResolvedValue({ success: true })
const mockOnEvent = vi.fn((callback: (event: AgentEvent) => void) => {
  capturedEventCallback = callback
  return mockRemoveListener
})

// Helper: create a wrapper component that calls useCoworkAgent inside setup
function createWrapperComponent() {
  return defineComponent({
    setup() {
      const agent = useCoworkAgent()
      return { agent }
    },
    render() {
      return null
    },
  })
}

describe('useCoworkAgent', () => {
  const originalN8nDesk = window.n8nDesk

  beforeEach(() => {
    setActivePinia(createPinia())
    mockStore._reset()
    vi.clearAllMocks()
    capturedEventCallback = null

    // Set up the n8nDesk bridge mock
    window.n8nDesk = {
      agent: {
        invoke: mockInvoke,
        stop: mockStop,
        approve: mockApprove,
        testConnection: mockTestConnection,
        onEvent: mockOnEvent,
      },
      storage: { read: vi.fn(), write: vi.fn(), append: vi.fn() },
      push: { connect: vi.fn(), disconnect: vi.fn(), onEvent: vi.fn(), onStatus: vi.fn() },
      api: { fetch: vi.fn() },
      auth: {
        validateInstance: vi.fn(),
        login: vi.fn(),
        logout: vi.fn(),
        refresh: vi.fn(),
        credentialLogin: vi.fn(),
        getSessionToken: vi.fn(),
        getBrowserId: vi.fn(),
        syncCookie: vi.fn(),
      },
      keychain: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
      plugins: {
        marketplaceList: vi.fn(),
        marketplaceAdd: vi.fn(),
        marketplaceRemove: vi.fn(),
        marketplaceRefresh: vi.fn(),
        browse: vi.fn(),
        installedList: vi.fn(),
        install: vi.fn(),
        uninstall: vi.fn(),
        enable: vi.fn(),
        disable: vi.fn(),
        previewInstall: vi.fn(),
        serversList: vi.fn(),
        serversAdd: vi.fn(),
        serversUpdate: vi.fn(),
        serversRemove: vi.fn(),
        serversTest: vi.fn(),
        serversTestById: vi.fn(),
        serverProbeOAuth: vi.fn(),
        serverOAuthConnect: vi.fn(),
        serverOAuthDisconnect: vi.fn(),
        serverOAuthRefresh: vi.fn(),
        setSecret: vi.fn(),
        deleteSecrets: vi.fn(),
        listSkills: vi.fn(),
        saveSkill: vi.fn(),
        deleteSkill: vi.fn(),
      },
      dialog: { openFolder: vi.fn(), openFiles: vi.fn() },
      shell: { showInFolder: vi.fn() },
    } as unknown as N8nDeskBridge
  })

  afterEach(() => {
    if (originalN8nDesk) {
      window.n8nDesk = originalN8nDesk
    } else {
      delete window.n8nDesk
    }
  })

  it('registers event listener on mount', () => {
    const wrapper = mount(createWrapperComponent())
    expect(mockOnEvent).toHaveBeenCalledTimes(1)
    expect(mockOnEvent).toHaveBeenCalledWith(expect.any(Function))
    wrapper.unmount()
  })

  it('removes event listener on unmount', () => {
    const wrapper = mount(createWrapperComponent())
    expect(mockRemoveListener).not.toHaveBeenCalled()

    wrapper.unmount()
    expect(mockRemoveListener).toHaveBeenCalledTimes(1)
  })

  it('sendMessage calls agent.invoke with mode: cowork', async () => {
    // Hydrate store with an active instance so createSession works
    const store = useCoworkSessionsStore()
    await store.hydrate('inst_1')

    const wrapper = mount(createWrapperComponent())
    const { agent } = wrapper.vm

    await agent.sendMessage('Process these files')

    expect(mockInvoke).toHaveBeenCalledTimes(1)
    const callArgs = mockInvoke.mock.calls[0]
    // callArgs: [sessionId, message, options]
    expect(callArgs[1]).toBe('Process these files')
    expect(callArgs[2]).toMatchObject({ mode: 'cowork' })

    wrapper.unmount()
  })

  it('sendMessage creates a session if none is active', async () => {
    const store = useCoworkSessionsStore()
    await store.hydrate('inst_1')

    expect(store.activeSessionId).toBeNull()

    const wrapper = mount(createWrapperComponent())
    const { agent } = wrapper.vm

    await agent.sendMessage('Hello')

    // Session should now exist
    expect(store.activeSessionId).not.toBeNull()
    expect(store.sessions).toHaveLength(1)

    wrapper.unmount()
  })

  it('sendMessage appends user message to store', async () => {
    const store = useCoworkSessionsStore()
    await store.hydrate('inst_1')

    const wrapper = mount(createWrapperComponent())
    const { agent } = wrapper.vm

    await agent.sendMessage('Test message')

    const userMessages = store.messages.filter((m) => m.role === 'user')
    expect(userMessages).toHaveLength(1)
    expect(userMessages[0].content).toBe('Test message')

    wrapper.unmount()
  })

  it('routes agent events to cowork sessions store', async () => {
    const store = useCoworkSessionsStore()
    await store.hydrate('inst_1')
    await store.createSession('Test')
    store.isAgentRunning = true

    const wrapper = mount(createWrapperComponent())

    // Simulate an agent event via the captured callback
    expect(capturedEventCallback).not.toBeNull()
    capturedEventCallback!({
      type: 'text_chunk',
      sessionId: store.activeSessionId!,
      data: { text: 'Agent response' },
    })

    await nextTick()

    const assistantMsgs = store.messages.filter((m) => m.role === 'assistant')
    expect(assistantMsgs).toHaveLength(1)
    expect(assistantMsgs[0].content).toBe('Agent response')

    wrapper.unmount()
  })

  it('ignores events for a different session', async () => {
    const store = useCoworkSessionsStore()
    await store.hydrate('inst_1')
    await store.createSession('Test')
    store.isAgentRunning = true

    const wrapper = mount(createWrapperComponent())

    // Send event with a different sessionId
    capturedEventCallback!({
      type: 'text_chunk',
      sessionId: 'session_other',
      data: { text: 'Should be ignored' },
    })

    await nextTick()

    const assistantMsgs = store.messages.filter((m) => m.role === 'assistant')
    expect(assistantMsgs).toHaveLength(0)

    wrapper.unmount()
  })

  it('stopAgent delegates to IPC bridge', async () => {
    const store = useCoworkSessionsStore()
    await store.hydrate('inst_1')
    await store.createSession('Test')

    const wrapper = mount(createWrapperComponent())
    const { agent } = wrapper.vm

    await agent.stopAgent()

    expect(mockStop).toHaveBeenCalledTimes(1)
    expect(mockStop).toHaveBeenCalledWith(store.activeSessionId)

    wrapper.unmount()
  })

  it('approveAction delegates to IPC bridge', async () => {
    const store = useCoworkSessionsStore()
    await store.hydrate('inst_1')
    await store.createSession('Test')

    const wrapper = mount(createWrapperComponent())
    const { agent } = wrapper.vm

    await agent.approveAction('approve')

    expect(mockApprove).toHaveBeenCalledTimes(1)
    expect(mockApprove).toHaveBeenCalledWith(store.activeSessionId, 'approve')

    wrapper.unmount()
  })

  it('approveAction with reject delegates correctly', async () => {
    const store = useCoworkSessionsStore()
    await store.hydrate('inst_1')
    await store.createSession('Test')

    const wrapper = mount(createWrapperComponent())
    const { agent } = wrapper.vm

    await agent.approveAction('reject')

    expect(mockApprove).toHaveBeenCalledWith(store.activeSessionId, 'reject')

    wrapper.unmount()
  })

  it('throws if n8nDesk bridge is not available', async () => {
    delete window.n8nDesk

    const store = useCoworkSessionsStore()
    await store.hydrate('inst_1')

    // Need to create the component without n8nDesk — onEvent won't be called
    const wrapper = mount(createWrapperComponent())
    const { agent } = wrapper.vm

    await expect(agent.sendMessage('test')).rejects.toThrow('n8nDesk bridge not available')

    wrapper.unmount()
  })
})
