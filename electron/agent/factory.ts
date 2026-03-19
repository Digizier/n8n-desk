import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import type { AgentRunner, AgentBackend, LlmProviderConfig } from './types'

const BASE_DIR = path.join(os.homedir(), '.n8n-desk')
const LLM_CONFIG_PATH = path.join(BASE_DIR, 'llm.json')

// --- LLM Config Persistence ---

/**
 * The settings UI saves llm.json in one of two shapes:
 *
 * ClaudeSdkConfig:  { backend: 'claude-sdk', apiKey, model }
 * DeepAgentsConfig: { backend: 'deep-agents', provider, model, apiKey?, ollamaBaseUrl? }
 */
interface ClaudeSdkConfigFile {
  backend: 'claude-sdk'
  apiKey: string
  model: string
}

interface DeepAgentsConfigFile {
  backend: 'deep-agents'
  provider: 'anthropic' | 'openai' | 'ollama'
  model: string
  apiKey?: string
  ollamaBaseUrl?: string
}

type LlmConfigFile = ClaudeSdkConfigFile | DeepAgentsConfigFile

/**
 * Read LLM configuration from ~/.n8n-desk/llm.json.
 * Returns null if the file does not exist or is invalid.
 */
export async function readLlmConfig(): Promise<LlmConfigFile | null> {
  try {
    const content = await fs.readFile(LLM_CONFIG_PATH, 'utf-8')
    return JSON.parse(content) as LlmConfigFile
  } catch {
    return null
  }
}

/**
 * Resolve LLM provider config from ~/.n8n-desk/llm.json.
 * Returns the default provider's configuration, or null if not configured.
 */
export async function resolveLlmConfig(): Promise<LlmProviderConfig | null> {
  const config = await readLlmConfig()
  if (!config?.backend || !config.model) {
    return null
  }

  if (config.backend === 'claude-sdk') {
    return {
      provider: 'anthropic',
      model: config.model,
      apiKey: config.apiKey,
    }
  }

  // deep-agents backend
  return {
    provider: config.provider,
    model: config.model,
    apiKey: config.apiKey,
    baseUrl: config.provider === 'ollama' ? config.ollamaBaseUrl : undefined,
  }
}

// --- Stub Runners ---

// ClaudeSdkRunner is imported from its own module
import { ClaudeSdkRunner } from './claude-sdk-runner'
import { DeepAgentsRunner } from './deep-agents-runner'

// --- Factory ---

/**
 * Create an agent runner based on the specified backend.
 * The runner handles agent session lifecycle (invoke, stop, approve).
 */
export function createAgentRunner(backend: AgentBackend): AgentRunner {
  switch (backend) {
    case 'claude-sdk':
      return new ClaudeSdkRunner()
    case 'deep-agents':
      return new DeepAgentsRunner()
    default:
      throw new Error(`Unknown agent backend: ${backend as string}`)
  }
}
