import ReconnectingWebSocket from 'reconnecting-websocket'
import type { ConnectionStatus } from '@/types/connection'
import type { ChatHubPushMessage } from '@/types/chathub'

/**
 * Known Chat-Hub push event type prefixes.
 * Used to filter out non-ChatHub events from the shared /rest/push channel.
 */
const CHATHUB_EVENT_TYPES = new Set([
  'chatHubStreamBegin',
  'chatHubStreamChunk',
  'chatHubStreamEnd',
  'chatHubStreamError',
  'chatHubHumanMessageCreated',
  'chatHubMessageEdited',
  'chatHubExecutionBegin',
  'chatHubExecutionEnd',
])

/** Raw push envelope from n8n's /rest/push endpoint */
interface PushEnvelope {
  type: string
  data: unknown
}

type ChatHubEventHandler = (event: ChatHubPushMessage) => void
type StatusChangeHandler = (status: ConnectionStatus) => void

function generatePushRef(): string {
  return crypto.randomUUID()
}

/**
 * Manages a persistent WebSocket connection to n8n's /rest/push endpoint.
 * Filters for Chat-Hub events and exposes them via a simple callback API.
 *
 * Uses reconnecting-websocket with exponential backoff (1s→30s).
 */
export class ChatHubStreamService {
  private ws: ReconnectingWebSocket | null = null
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null
  private eventHandlers: ChatHubEventHandler[] = []
  private statusHandlers: StatusChangeHandler[] = []
  private _status: ConnectionStatus = 'disconnected'
  private baseUrl = ''

  get status(): ConnectionStatus {
    return this._status
  }

  /**
   * Connect to a n8n instance's push endpoint.
   * Closes any existing connection first.
   */
  connect(baseUrl: string): void {
    this.disconnect()
    this.baseUrl = baseUrl

    const urlProvider = () => {
      const pushRef = generatePushRef()
      const wsBase = baseUrl.replace(/^http/, 'ws')
      return `${wsBase}/rest/push?pushRef=${pushRef}`
    }

    this.ws = new ReconnectingWebSocket(urlProvider, [], {
      minReconnectionDelay: 1000,
      maxReconnectionDelay: 30000,
      reconnectionDelayGrowFactor: 2,
      maxEnqueuedMessages: 0,
    })

    this.ws.binaryType = 'arraybuffer'

    this.ws.addEventListener('open', this.handleOpen)
    this.ws.addEventListener('close', this.handleClose)
    this.ws.addEventListener('error', this.handleError)
    this.ws.addEventListener('message', this.handleMessage)
  }

  /** Disconnect and clean up all resources. */
  disconnect(): void {
    this.stopHeartbeat()
    if (this.ws) {
      this.ws.removeEventListener('open', this.handleOpen)
      this.ws.removeEventListener('close', this.handleClose)
      this.ws.removeEventListener('error', this.handleError)
      this.ws.removeEventListener('message', this.handleMessage)
      this.ws.close()
      this.ws = null
    }
    this.setStatus('disconnected')
  }

  /** Register a handler for Chat-Hub push events. */
  onEvent(handler: ChatHubEventHandler): () => void {
    this.eventHandlers.push(handler)
    return () => {
      this.eventHandlers = this.eventHandlers.filter((h) => h !== handler)
    }
  }

  /** Register a handler for connection status changes. */
  onStatusChange(handler: StatusChangeHandler): () => void {
    this.statusHandlers.push(handler)
    return () => {
      this.statusHandlers = this.statusHandlers.filter((h) => h !== handler)
    }
  }

  private setStatus(status: ConnectionStatus): void {
    if (this._status === status) return
    this._status = status
    for (const handler of this.statusHandlers) {
      handler(status)
    }
  }

  private readonly handleOpen = (): void => {
    this.setStatus('connected')
    this.startHeartbeat()
  }

  private readonly handleClose = (): void => {
    this.stopHeartbeat()
    if (this.ws) {
      // reconnecting-websocket will auto-reconnect
      this.setStatus('reconnecting')
    } else {
      this.setStatus('disconnected')
    }
  }

  private readonly handleError = (): void => {
    if (this._status === 'connected') {
      this.setStatus('reconnecting')
    }
  }

  private readonly handleMessage = (event: MessageEvent): void => {
    let raw: string

    if (event.data instanceof ArrayBuffer) {
      const decoder = new TextDecoder()
      raw = decoder.decode(event.data)
    } else if (typeof event.data === 'string') {
      raw = event.data
    } else {
      return
    }

    let envelope: PushEnvelope
    try {
      envelope = JSON.parse(raw) as PushEnvelope
    } catch {
      return
    }

    if (!CHATHUB_EVENT_TYPES.has(envelope.type)) return

    const pushMessage = envelope as unknown as ChatHubPushMessage
    for (const handler of this.eventHandlers) {
      handler(pushMessage)
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'heartbeat' }))
      }
    }, 30000)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }
}
