import { randomUUID } from 'crypto'
import type {
  AgentRunner,
  AgentRunnerConfig,
  AgentStreamEvent,
  LlmProviderConfig,
} from './types'
import { createMcpTools } from './tool-definitions'

// Destructive MCP tools that require user approval before execution
const DESTRUCTIVE_TOOLS = new Set([
  'create_workflow_from_code',
  'update_workflow',
  'publish_workflow',
  'archive_workflow',
  'execute_workflow',
])

/** Deferred promise that can be resolved externally */
interface PendingApproval {
  id: string
  toolName: string
  args: Record<string, unknown>
  resolve: (decision: 'approve' | 'reject') => void
}

/**
 * Create a LangChain ChatModel based on the provider configuration.
 * Lazy-imports the provider-specific package to avoid loading all providers.
 */
async function createChatModel(config: LlmProviderConfig): Promise<unknown> {
  switch (config.provider) {
    case 'anthropic': {
      const { ChatAnthropic } = await import('@langchain/anthropic')
      return new ChatAnthropic({
        model: config.model,
        anthropicApiKey: config.apiKey,
        ...(config.baseUrl ? { anthropicApiUrl: config.baseUrl } : {}),
      })
    }
    case 'openai': {
      const { ChatOpenAI } = await import('@langchain/openai')
      return new ChatOpenAI({
        model: config.model,
        openAIApiKey: config.apiKey,
        ...(config.baseUrl ? { configuration: { baseURL: config.baseUrl } } : {}),
      })
    }
    case 'ollama': {
      const { ChatOllama } = await import('@langchain/ollama')
      return new ChatOllama({
        model: config.model,
        ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
      })
    }
    default:
      throw new Error(`Unsupported LLM provider: ${config.provider}`)
  }
}

/**
 * Deep Agents SDK runner implementation.
 *
 * Uses createDeepAgent from the deepagents package with LangChain ChatModel
 * objects and MCP tool wrappers. Uses StateBackend for ephemeral storage
 * and MemorySaver as checkpointer with interruptOn for destructive tools.
 * Streams events via agent.stream() and normalizes LangGraph events to
 * AgentStreamEvent format.
 */
export class DeepAgentsRunner implements AgentRunner {
  private abortControllers = new Map<string, AbortController>()
  private pendingApprovals = new Map<string, PendingApproval>()

  async *invoke(
    sessionId: string,
    message: string,
    config: AgentRunnerConfig,
  ): AsyncIterable<AgentStreamEvent> {
    // Lazy imports for ESM-only packages
    let createDeepAgent: typeof import('deepagents').createDeepAgent
    let StateBackend: typeof import('deepagents').StateBackend
    let MemorySaver: typeof import('@langchain/langgraph').MemorySaver

    try {
      const deepagents = await import('deepagents')
      createDeepAgent = deepagents.createDeepAgent
      StateBackend = deepagents.StateBackend
      const langgraph = await import('@langchain/langgraph')
      MemorySaver = langgraph.MemorySaver
    } catch (err) {
      yield {
        type: 'error',
        sessionId,
        data: {
          message: `Failed to load Deep Agents SDK: ${err instanceof Error ? err.message : String(err)}`,
          code: 'DEEP_AGENTS_LOAD_FAILED',
        },
      }
      yield { type: 'done', sessionId, data: { reason: 'error' } }
      return
    }

    const abortController = new AbortController()
    this.abortControllers.set(sessionId, abortController)

    try {
      // Create the LLM chat model
      const chatModel = await createChatModel(config.llmConfig)

      // Create MCP tool wrappers
      const tools = createMcpTools(config.instanceUrl, config.accessToken)

      // Determine which tools require approval
      const interruptTools = config.interruptOnTools ?? [...DESTRUCTIVE_TOOLS]

      // Create the deep agent
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const agent = createDeepAgent({
        name: 'n8n-desk-workflow',
        model: chatModel as any,
        tools: tools as any,
        systemPrompt: config.systemPrompt,
        backend: (rt: any) => new StateBackend(rt),
        checkpointer: new MemorySaver(),
        interruptOn: Object.fromEntries(interruptTools.map((t) => [t, true])),
      } as any)

      // Stream agent events
      const stream = await (agent.stream as any)(message, {
        configurable: { thread_id: sessionId },
        signal: abortController.signal,
      })

      for await (const event of stream) {
        if (abortController.signal.aborted) break

        const normalized = this.normalizeEvent(sessionId, event)
        for (const evt of normalized) {
          // Handle approval interrupts
          if (evt.type === 'approval_required') {
            yield evt

            // Wait for user decision
            const decision = await this.waitForApproval(sessionId, evt.data, abortController.signal)

            yield {
              type: 'approval_resolved',
              sessionId,
              data: { id: evt.data.id, decision },
            }

            if (decision === 'reject') {
              yield {
                type: 'tool_call_result',
                sessionId,
                data: {
                  id: evt.data.id,
                  name: evt.data.toolName,
                  result: null,
                  success: false,
                  error: `User rejected ${evt.data.toolName}`,
                },
              }
            }
            continue
          }

          yield evt
        }
      }

      yield {
        type: 'done',
        sessionId,
        data: { reason: abortController.signal.aborted ? 'cancelled' : 'completed' },
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      yield {
        type: 'error',
        sessionId,
        data: { message: errorMessage, code: 'AGENT_ERROR' },
      }
      yield { type: 'done', sessionId, data: { reason: 'error' } }
    } finally {
      this.cleanup(sessionId)
    }
  }

  async stop(sessionId: string): Promise<void> {
    const controller = this.abortControllers.get(sessionId)
    if (controller) {
      controller.abort()
    }

    // Reject any pending approval
    const pending = this.pendingApprovals.get(sessionId)
    if (pending) {
      pending.resolve('reject')
    }

    this.cleanup(sessionId)
  }

  async approve(sessionId: string, decision: 'approve' | 'reject'): Promise<void> {
    const pending = this.pendingApprovals.get(sessionId)
    if (!pending) {
      return
    }

    pending.resolve(decision)
    this.pendingApprovals.delete(sessionId)
  }

  private cleanup(sessionId: string): void {
    this.abortControllers.delete(sessionId)
    this.pendingApprovals.delete(sessionId)
  }

  private waitForApproval(
    sessionId: string,
    data: { id: string; toolName: string; args: Record<string, unknown> },
    signal: AbortSignal,
  ): Promise<'approve' | 'reject'> {
    return new Promise<'approve' | 'reject'>((resolve) => {
      this.pendingApprovals.set(sessionId, {
        id: data.id,
        toolName: data.toolName,
        args: data.args,
        resolve,
      })

      const onAbort = (): void => {
        this.pendingApprovals.delete(sessionId)
        resolve('reject')
      }
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  /**
   * Normalize a LangGraph stream event into AgentStreamEvents.
   *
   * LangGraph events come in various shapes depending on the node:
   * - Agent node outputs: messages with content (text or tool_use blocks)
   * - Tool node outputs: tool results
   * - Interrupt events: tool calls requiring approval
   */
  private normalizeEvent(
    sessionId: string,
    event: Record<string, unknown>,
  ): AgentStreamEvent[] {
    const events: AgentStreamEvent[] = []

    // Handle different LangGraph event structures
    const eventType = typeof event.event === 'string' ? event.event : undefined

    if (eventType === 'on_chat_model_stream' || eventType === 'on_llm_stream') {
      // Streaming text chunk from the LLM
      const chunk = event.data as Record<string, unknown> | undefined
      const content = chunk?.chunk as Record<string, unknown> | undefined
      if (content?.content && typeof content.content === 'string') {
        events.push({
          type: 'text_chunk',
          sessionId,
          data: { text: content.content },
        })
      }
    } else if (eventType === 'on_tool_start') {
      // Tool execution starting
      const data = event.data as Record<string, unknown> | undefined
      const input = data?.input as Record<string, unknown> | undefined
      const name = typeof event.name === 'string' ? event.name : 'unknown'
      const id = typeof event.run_id === 'string' ? event.run_id : randomUUID()

      // Check if this tool requires approval (interrupt)
      if (DESTRUCTIVE_TOOLS.has(name)) {
        events.push({
          type: 'approval_required',
          sessionId,
          data: {
            id,
            toolName: name,
            args: input ?? {},
            description: `Approve ${name}?`,
          },
        })
      } else {
        events.push({
          type: 'tool_call_start',
          sessionId,
          data: { id, name, args: input ?? {} },
        })
      }
    } else if (eventType === 'on_tool_end') {
      // Tool execution completed
      const data = event.data as Record<string, unknown> | undefined
      const output = data?.output
      const name = typeof event.name === 'string' ? event.name : 'unknown'
      const id = typeof event.run_id === 'string' ? event.run_id : randomUUID()

      events.push({
        type: 'tool_call_result',
        sessionId,
        data: {
          id,
          name,
          result: output,
          success: true,
        },
      })
    } else if (eventType === 'on_chain_end') {
      // Check for todo updates in the output
      const data = event.data as Record<string, unknown> | undefined
      const output = data?.output as Record<string, unknown> | undefined
      if (output?.todos && Array.isArray(output.todos)) {
        events.push({
          type: 'todo_update',
          sessionId,
          data: {
            todos: output.todos as Array<{
              id: string
              title: string
              status: 'pending' | 'in_progress' | 'completed' | 'failed'
            }>,
          },
        })
      }
    }

    return events
  }
}
