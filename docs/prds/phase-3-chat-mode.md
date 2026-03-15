# PRD: Phase 3 — Chat Mode

## Overview

Implement the full Chat mode experience: discover available agents and base LLM models via the Chat-Hub API, render a conversational UI forked from n8n's AskAssistant components, stream responses over WebSocket with reconnection support, and persist session history locally in JSONL for offline browsing. This is the first mode that delivers real user value — after connecting to an n8n instance (Phase 2), users can immediately chat with their Workflow Agents, Custom Agents, and base LLM models.

**Auth architecture:** Chat mode runs entirely on the `n8n-auth` session cookie from Phase 2's credential login. No MCP OAuth tokens are needed. All Chat-Hub REST endpoints (`/chat/*`) and the push WebSocket (`/rest/push`) authenticate via this cookie. This means Chat mode works for all user roles including `chatUser`.

## Problem Statement

After Phase 2, n8n-desk can connect to an n8n instance and authenticate, but all three mode views are placeholders. Users land in Chat mode and see "coming soon." The chat store has stub methods, there is no Chat-Hub API client, no WebSocket streaming, no message rendering, and no agent discovery. Without this phase, the app is unusable beyond the settings screen.

## Goals

- Users can discover and chat with all three Chat-Hub agent types: **Workflow Agents** (n8n workflows with Chat Trigger), **Custom Agents**, and **base LLM models** (14 providers)
- Agent/model discovery via `POST /chat/models` — unified list of all available chat targets
- Real-time message streaming via Chat-Hub WebSocket push events (`chatHubStreamBegin`, `chatHubStreamChunk`, `chatHubStreamEnd`, `chatHubStreamError`)
- Chat UI forked from n8n's AskAssistant components, adapted for Ionic layout
- Markdown rendering with syntax highlighting (forked from n8n's `markdown.ts`)
- Blinking cursor during streaming responses
- Full WebSocket reconnection with exponential backoff and missed-chunk replay via `POST /chat/conversations/:sessionId/reconnect`
- Connection status indicator in header (green dot = connected, yellow = reconnecting, banner after 3s disconnect)
- Agent sidebar: top section lists available agents/models, bottom section shows recent conversations
- Local JSONL session cache for offline browsing (source of truth is n8n server)
- Session CRUD: create, list, delete conversations via Chat-Hub REST API
- Message actions: edit, regenerate, stop generation
- Artifact rendering: handle `artifact-create` and `artifact-edit` content chunks from AI responses
- Works on desktop (Electron) and mobile (Capacitor) — Chat mode is the only mode available on mobile

## Non-Goals

- No Cowork or Workflow mode implementation (future phases)
- No Deep Agents SDK integration (Chat mode is a thin client — no local agent)
- No file uploads/attachments in MVP (Chat-Hub supports them, but defer to a follow-up)
- No Custom Agent CRUD (creating/editing Custom Agents via `POST /chat/agents`) — only listing and chatting
- No LLM provider configuration in n8n-desk — Chat-Hub manages providers server-side
- No chat export or sharing features
- No push notifications for new messages
- No multi-user or shared sessions

## Technical Design

### Data Model Changes

**New types in `src/types/chathub.ts`** — Mirror Chat-Hub API types from n8n:

```ts
// Chat-Hub conversation model (discriminated union by provider)
type ChatHubProvider =
  | 'openai' | 'anthropic' | 'google' | 'ollama'
  | 'azureOpenAi' | 'azureEntraId' | 'awsBedrock'
  | 'vercelAiGateway' | 'xAiGrok' | 'groq'
  | 'openRouter' | 'deepSeek' | 'cohere' | 'mistralCloud'
  | 'n8n'           // Workflow Agent
  | 'custom-agent'  // Custom Agent

interface ChatHubConversationModelLLM {
  provider: Exclude<ChatHubProvider, 'n8n' | 'custom-agent'>
  model: string
  credentialId: string
}

interface ChatHubConversationModelWorkflow {
  provider: 'n8n'
  workflowId: string
}

interface ChatHubConversationModelCustomAgent {
  provider: 'custom-agent'
  agentId: string
}

type ChatHubConversationModel =
  | ChatHubConversationModelLLM
  | ChatHubConversationModelWorkflow
  | ChatHubConversationModelCustomAgent

// Agent icon
type AgentIconOrEmoji =
  | { type: 'icon'; value: string }
  | { type: 'emoji'; value: string }

// Model listing (from POST /chat/models)
interface ChatModelDto {
  model: ChatHubConversationModel
  name: string
  description: string | null
  icon: AgentIconOrEmoji | null
  metadata: ChatModelMetadataDto
  groupName: string | null
  groupIcon: AgentIconOrEmoji | null
  suggestedPrompts?: Array<{ text: string; icon?: AgentIconOrEmoji }>
}

interface ChatModelMetadataDto {
  allowFileUploads: boolean
  allowedFilesMimeTypes: string
  capabilities: { functionCalling: boolean }
  available: boolean
  priority?: number
}

// Grouped response from POST /chat/models
type ChatModelsResponse = Record<ChatHubProvider, { models: ChatModelDto[] }>

// Session (from n8n server)
interface ChatHubSessionDto {
  id: string
  title: string
  ownerId: string
  lastMessageAt: string | null
  credentialId: string | null
  provider: ChatHubProvider | null
  model: string | null
  workflowId: string | null
  agentId: string | null
  agentName: string
  agentIcon: AgentIconOrEmoji | null
  type: 'production' | 'manual'
  createdAt: string
  updatedAt: string
}

// Message content chunks (parsed from streaming)
type ChatMessageContentChunk =
  | { type: 'text'; content: string }
  | { type: 'hidden'; content: string }
  | { type: 'artifact-create'; content: string; command: { title: string; type: string; content: string }; isIncomplete: boolean }
  | { type: 'artifact-edit'; content: string; command: { title: string; oldString: string; newString: string; replaceAll: boolean }; isIncomplete: boolean }
  | { type: 'with-buttons'; content: string; buttons: Array<{ text: string; link: string; type: 'primary' | 'secondary' }>; blockUserInput: boolean }

// WebSocket push events
interface ChatHubStreamBegin {
  type: 'chatHubStreamBegin'
  sessionId: string
  messageId: string
  sequenceNumber: number
  previousMessageId: string | null
  retryOfMessageId: string | null
  executionId: string | null
}

interface ChatHubStreamChunk {
  type: 'chatHubStreamChunk'
  sessionId: string
  messageId: string
  sequenceNumber: number
  content: string
}

interface ChatHubStreamEnd {
  type: 'chatHubStreamEnd'
  sessionId: string
  messageId: string
  status: 'success' | 'error' | 'cancelled'
}

interface ChatHubStreamError {
  type: 'chatHubStreamError'
  sessionId: string
  messageId: string
  error: string
}

interface ChatHubHumanMessageCreated {
  type: 'chatHubHumanMessageCreated'
  sessionId: string
  messageId: string
  previousMessageId: string | null
  content: string
  timestamp: string
}

type ChatHubPushEvent =
  | ChatHubStreamBegin
  | ChatHubStreamChunk
  | ChatHubStreamEnd
  | ChatHubStreamError
  | ChatHubHumanMessageCreated
```

**Update `src/types/session.ts`** — Add Chat-Hub session reference:

```ts
// Local session cache entry (extends existing SessionMeta)
interface ChatSessionMeta extends SessionMeta {
  serverSessionId: string        // n8n Chat-Hub session ID
  provider: ChatHubProvider | null
  model: string | null
  agentName: string
  agentIcon: AgentIconOrEmoji | null
}
```

### Interface Changes

**New service: `src/services/chathub.ts`** — Chat-Hub REST API client:

```ts
class ChatHubService {
  constructor(private api: N8nApiClient) {}

  // Agent/model discovery
  async getModels(): Promise<ChatModelsResponse>

  // Session management
  async listSessions(): Promise<ChatHubSessionDto[]>
  async getSession(sessionId: string): Promise<ChatHubSessionDto>
  async deleteSession(sessionId: string): Promise<void>
  async updateSession(sessionId: string, updates: { title?: string }): Promise<void>

  // Messaging
  async sendMessage(params: {
    sessionId: string
    message: string
    model: ChatHubConversationModel
  }): Promise<void>

  async editMessage(sessionId: string, messageId: string, content: string): Promise<void>
  async regenerateMessage(sessionId: string, messageId: string): Promise<void>
  async stopGeneration(sessionId: string, messageId: string): Promise<void>

  // Reconnection
  async reconnect(sessionId: string): Promise<void>
}
```

**New service: `src/services/chathub-stream.ts`** — WebSocket push client:

```ts
class ChatHubStreamService {
  // Connect to /rest/push — cookie auth handled by IPC proxy
  connect(baseUrl: string, sessionToken: string): void
  disconnect(): void
  reconnect(): void

  onEvent(callback: (event: ChatHubPushEvent) => void): void
  offEvent(callback: (event: ChatHubPushEvent) => void): void

  readonly status: Ref<'connected' | 'connecting' | 'disconnected' | 'reconnecting'>
}
```

Note: The WebSocket connects to `wss://{baseUrl}/rest/push?pushRef={id}`. Auth is via `n8n-auth` cookie (injected by the IPC proxy as a `Cookie` header on the upgrade request). The `sessionToken` parameter is the JWT value to set in the cookie header.

**New composable: `src/composables/useChatHub.ts`** — Orchestrates Chat-Hub services:

```ts
function useChatHub() {
  // Agent/model discovery
  const models: Ref<ChatModelDto[]>
  const isLoadingModels: Ref<boolean>
  async function refreshModels(): Promise<void>

  // Flat list of all available agents/models for sidebar
  const availableAgents: ComputedRef<ChatModelDto[]>

  // Active conversation
  async function sendMessage(text: string): Promise<void>
  async function editMessage(messageId: string, content: string): Promise<void>
  async function regenerateMessage(messageId: string): Promise<void>
  async function stopGeneration(): Promise<void>

  // Session management
  async function createSession(model: ChatHubConversationModel): Promise<string>
  async function deleteSession(sessionId: string): Promise<void>

  // Connection
  const wsStatus: Ref<'connected' | 'connecting' | 'disconnected' | 'reconnecting'>
}
```

### New Commands / API / UI

**New chat components** (forked from n8n AskAssistant, adapted for Ionic):

| Component | Source | Purpose |
|---|---|---|
| `ChatWindow.vue` | Fork of `AskAssistantChat.vue` | Main chat container: message list + input + streaming state |
| `ChatMessage.vue` | Fork of `Message.vue` | Individual message bubble with markdown, artifacts, actions |
| `ChatMessageList.vue` | Fork of `MessagesList.vue` | Scrollable message list with auto-scroll and empty state |
| `ChatInput.vue` | Fork of `Input.vue` | Auto-expanding textarea with send/stop button |
| `MarkdownRenderer.vue` | Fork of `MarkdownRenderer.vue` | Markdown → HTML with syntax highlighting |
| `BlinkingCursor.vue` | Copy of `BlinkingCursor.vue` | Typing indicator during streaming |
| `AgentPicker.vue` | New | Modal/popover to select agent/model when starting a new chat |
| `ConnectionIndicator.vue` | New | Header dot + reconnecting banner |
| `ArtifactBlock.vue` | New | Renders artifact-create/artifact-edit content chunks |

**Updated sidebar: `ChatSidebar.vue`** — Two sections:
1. **Available agents** — Grouped by type (Workflow Agents, Custom Agents, Base Models)
2. **Recent conversations** — Sorted by last activity, showing agent name + last message preview

**Updated view: `ChatView.vue`** — Full chat experience replacing placeholder.

### Auth Architecture — Session Cookie Only

Chat mode uses **only** the `n8n-auth` session cookie (JWT from Phase 2's credential login). No MCP OAuth bearer tokens are needed for any Chat-Hub functionality. This is the same cookie that n8n's own editor frontend uses.

**What the session cookie covers:**
| Endpoint | Purpose |
|---|---|
| `GET/POST/PATCH/DELETE /chat/*` | All Chat-Hub REST API calls (conversations, agents, models, tools, settings) |
| `GET /rest/push` (WebSocket upgrade) | Push events for streaming responses |
| `GET/POST /rest/*` | n8n internal REST API (workflows, executions, users, etc.) |

**What the session cookie does NOT cover:**
| Endpoint | Auth needed |
|---|---|
| `/mcp-server/*` | MCP OAuth Bearer token (not used in Chat mode) |
| `/api/v1/*` | `X-N8N-API-KEY` header (not used by n8n-desk) |

**Why this works for all roles:** Even `chatUser` role has the `chatHub:message` and `chatHubAgent:*` scopes needed for Chat-Hub. The credential login at `POST /rest/login` works for all n8n user roles.

**API path reference:**
- n8n's internal REST API uses `/rest/` prefix (configurable via `N8N_ENDPOINT_REST`, defaults to `"rest"`)
- Chat-Hub endpoints are at `/chat/*` (registered on root path, no `/rest/` prefix)
- Push/WebSocket endpoint is at `/rest/push` (uses the REST prefix)
- The public API at `/api/v1/` is a separate system — **not used by n8n-desk**

**IPC proxy:** All HTTP from the renderer goes through the `api:fetch` IPC proxy in Electron's main process (CORS bypass). The proxy transparently refreshes session cookies by intercepting `set-cookie` headers from n8n responses.

**Session expiry:** If the session JWT expires and n8n returns 401, the `N8nApiClient` triggers the ReLoginModal (implemented in Phase 2) prompting the user to re-enter credentials. After re-login, the WebSocket reconnects automatically with the fresh cookie.

### Migration Strategy

No data migration needed. This is new functionality. The existing stub chat store will be replaced with a full implementation. The JSONL local cache is new — first run creates the directory structure.

**Server-side vs local sessions:** The source of truth for Chat mode sessions is the n8n server (Chat-Hub manages session state). n8n-desk caches session metadata and messages locally in JSONL for:
- Offline browsing of past conversations (read-only)
- Faster session list rendering (no network round-trip on app start)
- Local search across conversation history (future)

On app start, the local cache is reconciled with the server: new server sessions are added, deleted ones are archived locally.

## Implementation Steps

### Step 1: Chat-Hub Type Definitions

Create `src/types/chathub.ts` with all Chat-Hub types (discriminated unions, DTOs, push events, content chunks). Reference `n8n-master/packages/@n8n/api-types/src/chat-hub.ts` and `n8n-master/packages/@n8n/api-types/src/push/chat-hub.ts`. Update `src/types/session.ts` with `ChatSessionMeta`.

**Files:** `src/types/chathub.ts`, `src/types/session.ts`

### Step 2: Chat-Hub REST Service

Create `src/services/chathub.ts` with the `ChatHubService` class. Uses the existing `N8nApiClient` from `src/services/n8n-api.ts` for authenticated HTTP calls. Implements all REST endpoints: `POST /chat/models`, `GET /chat/conversations`, `POST /chat/conversations/send`, `POST /chat/conversations/:sessionId/reconnect`, `POST /chat/conversations/:sessionId/messages/:id/edit`, `POST /chat/conversations/:sessionId/messages/:id/regenerate`, `POST /chat/conversations/:sessionId/messages/:id/stop`, `PATCH /chat/conversations/:sessionId`, `DELETE /chat/conversations/:sessionId`.

**Files:** `src/services/chathub.ts`

### Step 3: WebSocket Push Service

Create `src/services/chathub-stream.ts` with `ChatHubStreamService`. Install `reconnecting-websocket` package.

**Connection details:**
- Endpoint: `wss://{instance}/rest/push` (same `/rest/` prefix as the REST API)
- Auth: `n8n-auth` session cookie — **not** a bearer token. Browser WebSocket API doesn't support custom headers, so auth must go via cookie.
- In Electron: the IPC proxy must handle the WebSocket upgrade with the stored session cookie. Alternatively, use the `api:fetch` proxy pattern to inject the `Cookie` header on the upgrade request.
- Query param: `pushRef={uniqueId}` — n8n uses this to track individual push connections

**Implementation:**
- Implement exponential backoff (1s, 2s, 4s, 8s, max 30s)
- Parse push events (`chatHubStreamBegin`, `chatHubStreamChunk`, `chatHubStreamEnd`, `chatHubStreamError`, etc.) and emit typed callbacks
- Track connection status as a Vue `ref`
- On session cookie refresh (via `set-cookie` interception), reconnect WebSocket — the new cookie is automatically available
- On 401 disconnect, trigger the ReLoginModal flow; after re-login, reconnect

**Files:** `src/services/chathub-stream.ts`
**Dependencies:** `reconnecting-websocket`

### Step 4: Chat-Hub Message Parser

Copy and adapt the message parser from `n8n-master/packages/@n8n/chat-hub/src/parser.ts` and `artifact.ts`. This parses streaming text into structured `ChatMessageContentChunk` arrays — handling artifact commands, button blocks, and incomplete command buffering across chunks.

**Files:** `src/utils/chathub-parser.ts`

### Step 5: Markdown Rendering Utility

Copy `markdown.ts` from `n8n-master/packages/frontend/@n8n/design-system/src/utils/markdown.ts`. Copy `n8n-html.ts` directive from `n8n-master/packages/frontend/@n8n/design-system/src/directives/n8n-html.ts`. Install dependencies: `markdown-it`, `highlight.js`, `sanitize-html`. Wire the directive globally in `src/main.ts`.

**Files:** `src/utils/markdown.ts`, `src/directives/n8n-html.ts`, `src/main.ts`
**Dependencies:** `markdown-it`, `markdown-it-link-attributes`, `highlight.js`, `sanitize-html`

### Step 6: Chat UI Components — BlinkingCursor, MarkdownRenderer, ChatMessage

Copy `BlinkingCursor.vue` from n8n design system (26 lines, copy exactly). Create `MarkdownRenderer.vue` forked from `n8n-master/packages/frontend/@n8n/chat/src/components/MarkdownRenderer.vue` — uses `markdown-it` with `highlight.js` for code blocks. Create `ChatMessage.vue` forked from `n8n-master/packages/frontend/@n8n/chat/src/components/Message.vue` — renders a single message bubble with markdown content, artifact blocks, sender styling (user vs assistant), and message actions (edit, regenerate, copy).

**Files:** `src/components/chat/BlinkingCursor.vue`, `src/components/chat/MarkdownRenderer.vue`, `src/components/chat/ChatMessage.vue`

### Step 7: Chat UI Components — ChatMessageList, ChatInput

Create `ChatMessageList.vue` forked from `MessagesList.vue` — scrollable message list inside `IonContent`, auto-scroll on new messages, empty state with suggested prompts (from agent's `suggestedPrompts`), blinking cursor at end during streaming. Create `ChatInput.vue` forked from `Input.vue` — auto-expanding `<textarea>` (not `ion-textarea` — need precise height control), send button (Cmd/Ctrl+Enter or click), stop button during streaming, disabled state when offline.

**Files:** `src/components/chat/ChatMessageList.vue`, `src/components/chat/ChatInput.vue`

### Step 8: ArtifactBlock Component

Create `ArtifactBlock.vue` to render `artifact-create` and `artifact-edit` content chunks. Shows a collapsible card with the artifact title, type badge, and rendered content (code with syntax highlighting, markdown, or raw text). Edit artifacts show a diff-style before/after view.

**Files:** `src/components/chat/ArtifactBlock.vue`

### Step 9: Agent Picker Component

Create `AgentPicker.vue` — a modal (desktop) or action sheet (mobile) that shows all available agents/models grouped by type:
1. **Workflow Agents** (provider: `n8n`) — show workflow name + icon
2. **Custom Agents** (provider: `custom-agent`) — show agent name + icon
3. **Base Models** — grouped by provider (Anthropic, OpenAI, Google, etc.) with individual model entries

Each entry shows: icon/emoji, name, description. Tapping an entry emits `select(model: ChatHubConversationModel)`.

**Files:** `src/components/chat/AgentPicker.vue`

### Step 10: Connection Indicator Component

Create `ConnectionIndicator.vue` — shows in the header toolbar:
- Green dot when WebSocket connected
- Yellow dot + "Reconnecting..." when reconnecting
- Red banner "Can't reach {instance}" after 3 seconds of disconnect
- Tapping the banner triggers a manual reconnect attempt

**Files:** `src/components/chat/ConnectionIndicator.vue`

### Step 11: Chat Store — Full Implementation

Replace the stub `src/stores/chat.ts` with full implementation:
- `hydrate(instanceId)` — Load local JSONL session cache + sync with server (`GET /chat/conversations`)
- `sessions` — Reactive array of `ChatSessionMeta`
- `activeSessionId` — Currently open session
- `messages` — Map of `sessionId → ChatMessage[]`
- `streamingMessageId` — ID of message currently being streamed
- `createSession(model)` — Call `POST /chat/conversations/send` with first message, create local JSONL
- `deleteSession(sessionId)` — Call `DELETE /chat/conversations/:sessionId`, archive local JSONL
- `appendMessage(sessionId, message)` — Add to in-memory array + append to local JSONL
- `handleStreamEvent(event)` — Process WebSocket push events, update message content progressively
- `syncWithServer()` — Reconcile local cache with server session list

**Files:** `src/stores/chat.ts`

### Step 12: useChatHub Composable

Create `src/composables/useChatHub.ts` — orchestrates ChatHubService, ChatHubStreamService, and chat store:
- `refreshModels()` — Fetch `POST /chat/models`, flatten into sorted list
- `availableAgents` — Computed flat list of all models/agents with `available: true`
- `sendMessage(text)` — Call REST send, stream response via WebSocket, update store
- `editMessage()`, `regenerateMessage()`, `stopGeneration()` — Delegate to REST service
- `createSession(model)` / `deleteSession(sessionId)` — Manage sessions
- `wsStatus` — Expose WebSocket connection status
- Initialize WebSocket on composable creation, tear down on instance switch

**Files:** `src/composables/useChatHub.ts`

### Step 13: ChatSidebar — Wire to Real Data

Update `src/components/sidebar/ChatSidebar.vue` to replace mock data with:
- **Top section: "Agents"** — List from `useChatHub().availableAgents`, grouped by type (Workflow Agents, Custom Agents, Models). Each shows icon + name. Tap → open AgentPicker or start new session.
- **Bottom section: "Recent"** — List from chat store's `sessions`, sorted by `updatedAt` desc. Each shows agent icon + name + last message preview + timestamp. Tap → navigate to that session.
- **"New Chat" button** at top → opens AgentPicker
- Pull-to-refresh on mobile to reload agents

**Files:** `src/components/sidebar/ChatSidebar.vue`

### Step 14: ChatView — Full Implementation

Replace the placeholder `src/views/ChatView.vue` with the full chat experience:
- Uses `IonPage` + `IonContent` layout
- Renders `ChatMessageList` with messages from active session
- Renders `ChatInput` at bottom
- Shows `ConnectionIndicator` in header
- Handles empty state (no session selected → show welcome + agent picker)
- Routes WebSocket events to the active session's message list
- Manages streaming state (blinking cursor, input disabled during response)

**Files:** `src/views/ChatView.vue`

### Step 15: WebSocket Lifecycle Integration

Wire the WebSocket connection into the app lifecycle:
- **App start:** After auth hydration (including session cookie from `session.enc`), connect WebSocket to `/rest/push` on active instance
- **Instance switch:** Disconnect old WebSocket, connect to new instance (in `src/stores/instances.ts` `setActive()`)
- **Session cookie refresh:** n8n auto-refreshes the JWT in `set-cookie` response headers. The `api:fetch` IPC proxy intercepts and updates `session.enc` transparently. The WebSocket connection stays alive (cookie refresh doesn't break the existing connection). On next reconnect, the fresh cookie is used.
- **Session expiry (401):** If the WebSocket disconnects with auth error, show the ReLoginModal. After re-login, reconnect WebSocket.
- **App background (mobile):** Disconnect WebSocket to save battery. Reconnect + replay on foreground.
- **Connection composable:** Update `useConnection` to incorporate WebSocket status alongside health polling

**Files:** `src/stores/instances.ts`, `src/stores/auth.ts`, `src/composables/useConnection.ts`, `src/main.ts`

### Step 16: Local Session Cache (JSONL)

Implement the JSONL cache layer in the chat store:
- On `sendMessage` / `handleStreamEvent` → append to `~/.n8n-desk/instances/{id}/sessions/chat/{sessionId}.jsonl`
- On `hydrate` → read local JSONL files for fast startup, then sync with server in background
- On `deleteSession` → move JSONL to `.archive/`, server delete via REST
- On app startup → purge archived sessions older than 30 days
- Session `index.json` tracks local metadata (id, title, agent, timestamps, messageCount)

**Files:** `src/stores/chat.ts`, `src/services/local-storage.ts`

### Step 17: i18n Strings

Add all new user-facing strings to `src/i18n/locales/en.json`:
- Chat sidebar labels ("Agents", "Recent", "New Chat")
- Empty states ("Select an agent to start chatting", "No conversations yet")
- Connection states ("Connected", "Reconnecting...", "Can't reach {instance}")
- Message actions ("Edit", "Regenerate", "Copy", "Stop")
- Agent types ("Workflow Agent", "Custom Agent", "Model")
- Error messages ("Failed to send message", "Connection lost")

**Files:** `src/i18n/locales/en.json`

### Step 18: Tests

Write tests for:
- **Unit:** ChatHubService methods (mock HTTP responses), ChatHubStreamService (mock WebSocket), message parser (content chunk parsing), chat store (session CRUD, stream event handling)
- **Component:** ChatMessage renders markdown correctly, ChatInput emits on enter, ChatMessageList auto-scrolls, AgentPicker groups agents correctly
- **Integration:** Send message → receive stream → render in chat (mocked WebSocket)

**Files:** `src/__tests__/services/chathub.test.ts`, `src/__tests__/services/chathub-stream.test.ts`, `src/__tests__/utils/chathub-parser.test.ts`, `src/__tests__/stores/chat.test.ts`, `src/__tests__/components/chat/*.test.ts`

## Validation Criteria

- [ ] `POST /chat/models` returns available agents/models and they appear grouped in the sidebar
- [ ] Tapping an agent in the sidebar creates a new conversation and sends the first message
- [ ] Messages stream in real-time with blinking cursor, completing when `chatHubStreamEnd` arrives
- [ ] Markdown in assistant responses renders with syntax-highlighted code blocks
- [ ] Artifact blocks (`artifact-create`) render as collapsible cards with formatted content
- [ ] Switching to a different conversation loads its message history (from local cache, then server)
- [ ] Deleting a conversation removes it from the sidebar and archives the local JSONL
- [ ] WebSocket reconnects automatically after disconnect with exponential backoff
- [ ] After reconnect, missed chunks are replayed via `POST /chat/conversations/:sessionId/reconnect`
- [ ] Connection indicator shows correct state (green/yellow/red) matching actual WebSocket status
- [ ] When offline, chat input is disabled with "Can't reach {instance}" message
- [ ] Past conversations are browsable offline (read-only, from local JSONL cache)
- [ ] Instance switch disconnects old WebSocket and connects to new instance
- [ ] Session cookie auto-refresh (via `set-cookie` interception) keeps WebSocket alive transparently
- [ ] When session JWT expires (401), ReLoginModal opens; after re-login, WebSocket reconnects
- [ ] Base LLM model chat works — select a model (e.g., Claude), send message, receive streamed response
- [ ] Workflow Agent chat works — select a workflow agent, send message, receive response
- [ ] "Edit message" re-sends the edited content and replaces the response
- [ ] "Regenerate" re-generates the last AI response
- [ ] "Stop" cancels an in-progress stream
- [ ] App startup hydrates sessions from local cache (fast) then syncs with server (background)
- [ ] Mobile (Capacitor): Chat mode works with same UX, sidebar accessible via menu button
- [ ] `chatUser` role can use full Chat mode (session cookie provides all needed scopes)
- [ ] No MCP OAuth token is required for any Chat mode functionality
- [ ] All existing Phase 1 and Phase 2 tests still pass

## Anti-Patterns to Avoid

- **Do NOT use MCP OAuth tokens or the public API (`/api/v1/`) for Chat mode.** All Chat-Hub interaction (REST + WebSocket) uses the `n8n-auth` session cookie from credential login. The MCP OAuth bearer token is only needed for Cowork/Workflow modes (future phases). The public API requires `X-N8N-API-KEY` which n8n-desk doesn't use.

- **Do NOT put fetch calls in components.** Components call composables → composables call services → services make HTTP calls. This is the established pattern from Phase 2 (see `src/services/n8n-api.ts` and `src/composables/useAuth.ts`).

- **Do NOT manage LLM provider configuration in n8n-desk.** Chat-Hub handles all LLM providers server-side. n8n-desk just passes the `ChatHubConversationModel` discriminated union — it never needs API keys for chat providers.

- **Do NOT use `ion-textarea` for the chat input.** Ionic's textarea doesn't support the precise auto-resize behavior needed. Use a native `<textarea>` with custom height management, wrapped in an Ionic-styled container. This is what n8n's `Input.vue` does.

- **Do NOT treat local JSONL as the source of truth for Chat mode.** The n8n server owns Chat mode sessions. JSONL is a local cache for offline browsing and fast startup. Always sync with the server when online.

- **Do NOT store WebSocket messages in Pinia without also caching to JSONL.** Every message that enters the store should also be appended to the local JSONL file, so sessions survive app restarts even if the server is unreachable.

- **Do NOT use `v-html` for rendering assistant messages.** Use the `v-n8n-html` directive (copied from n8n) which sanitizes HTML to prevent XSS from malicious AI responses.

- **Do NOT create separate WebSocket connections per session.** One persistent WebSocket per instance, route events by `sessionId`.

- **Do NOT block the UI during server sync.** Hydrate from local cache first (fast), then sync with server in the background. The user should see their sessions immediately on app start.

- **Do NOT set `mode: 'ios'` globally on IonicVue.** Only apply `mode="ios"` on `<ion-segment>` as specified in CLAUDE.md.

## Patterns to Follow

- **Service layer pattern:** Follow `src/services/n8n-api.ts` — class-based service with typed methods, uses `N8nApiClient` for authenticated HTTP. The new `ChatHubService` should follow the same pattern. **Important:** Chat mode uses ONLY the session cookie (`n8n-auth` JWT from credential login). The `N8nApiClient` auto-selects `Cookie: n8n-auth=...` for `/rest/*` and `/chat/*` endpoints. MCP OAuth bearer tokens are not used anywhere in Phase 3. If the session expires (401), the `N8nApiClient` triggers `authStore.markSessionExpired()` which opens the ReLoginModal.

- **Composable pattern:** Follow `src/composables/useAuth.ts` — thin orchestration layer that connects stores and services. `useChatHub` should follow the same structure.

- **Store hydration pattern:** Follow `src/stores/instances.ts` `hydrate()` — read from local storage, populate reactive refs. The chat store's `hydrate()` should read local JSONL files the same way.

- **IPC for storage:** Follow the existing `localStore.readJson()` / `localStore.appendJsonl()` pattern in `src/services/local-storage.ts` for all file I/O.

- **Ionic layout:** Follow `src/views/SettingsView.vue` — `IonPage` > `IonHeader` > `IonToolbar` > `IonContent`. All new views and full-page components must use this structure.

- **Component styling:** Use `<style lang="scss" module>` with n8n-desk surface tokens (`--n8n-desk--surface-bg`, etc.) as established in existing components.

- **Error handling:** Follow the discriminated union pattern from `src/types/auth.ts` (`{ success: true, data } | { success: false, error, errorCode }`) for service return types.

- **Vue 3 Composition API:** `<script setup lang="ts">` with `defineProps<T>()` and `defineEmits<T>()` — no Options API, no `defineComponent()`.
