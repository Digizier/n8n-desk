import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import { callTool } from '../mcp-client'

// --- Types ---

interface McpToolContext {
  instanceUrl: string
  accessToken: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LangChainTool = any

// --- Helper ---

function mcpTool(
  ctx: McpToolContext,
  name: string,
  description: string,
  schema: z.ZodObject<z.ZodRawShape>,
): LangChainTool {
  return tool(
    async (args: Record<string, unknown>) => {
      const result = await callTool(ctx.instanceUrl, ctx.accessToken, name, args as Record<string, unknown>)
      if (result.isError) {
        const errorText = result.content
          .map((c) => c.text ?? JSON.stringify(c))
          .join('\n')
        throw new Error(errorText)
      }
      return result.content.map((c) => c.text ?? JSON.stringify(c)).join('\n')
    },
    { name, description, schema },
  )
}

// --- Factory ---

/**
 * Create all 13 LangChain tool wrappers for n8n MCP tools.
 * Each tool calls the n8n MCP server via the mcp-client module.
 */
export function createMcpTools(instanceUrl: string, accessToken: string): LangChainTool[] {
  const ctx: McpToolContext = { instanceUrl, accessToken }

  return [
    // --- Node Discovery ---

    mcpTool(ctx, 'search_nodes', 'Search n8n nodes by service name, trigger type, or utility function. Returns node IDs and discriminators.', z.object({
      query: z.string().describe('Search query for node name, service, or function'),
    })),

    mcpTool(ctx, 'get_node_types', 'Get TypeScript type definitions for n8n nodes. Returns exact parameter names and structures.', z.object({
      nodeIds: z.array(z.string()).describe('Array of node IDs to get type definitions for'),
    })),

    mcpTool(ctx, 'get_suggested_nodes', 'Get curated node recommendations by workflow technique category (chatbot, notification, scheduling, etc.).', z.object({
      category: z.string().describe('Workflow technique category to get suggestions for'),
    })),

    // --- Workflow Building ---

    mcpTool(ctx, 'validate_workflow', 'Validate n8n Workflow SDK code. Parses and checks for errors before creating.', z.object({
      code: z.string().describe('n8n Workflow SDK code to validate'),
    })),

    mcpTool(ctx, 'create_workflow_from_code', 'Create a new workflow from validated SDK code.', z.object({
      code: z.string().describe('Validated n8n Workflow SDK code'),
      name: z.string().optional().describe('Optional workflow name'),
    })),

    mcpTool(ctx, 'update_workflow', 'Update an existing workflow from validated SDK code.', z.object({
      workflowId: z.string().describe('ID of the workflow to update'),
      code: z.string().describe('Validated n8n Workflow SDK code'),
    })),

    // --- Workflow Discovery ---

    mcpTool(ctx, 'search_workflows', 'Search and filter workflows by name, description, or project.', z.object({
      query: z.string().optional().describe('Search query string'),
      projectId: z.string().optional().describe('Filter by project ID'),
    })),

    mcpTool(ctx, 'get_workflow_details', 'Get detailed info about a workflow, including trigger details.', z.object({
      workflowId: z.string().describe('ID of the workflow to inspect'),
    })),

    // --- Execution ---

    mcpTool(ctx, 'execute_workflow', 'Execute an n8n workflow by ID. Supports chat, form, and webhook input types. Returns execution ID and status.', z.object({
      workflowId: z.string().describe('ID of the workflow to execute'),
      inputData: z.record(z.unknown()).optional().describe('Input data for the workflow'),
    })),

    mcpTool(ctx, 'get_execution', 'Get full execution details and results using execution ID and workflow ID.', z.object({
      executionId: z.string().describe('ID of the execution to inspect'),
      workflowId: z.string().describe('ID of the workflow that was executed'),
    })),

    // --- Lifecycle Management ---

    mcpTool(ctx, 'publish_workflow', 'Activate a workflow for production execution.', z.object({
      workflowId: z.string().describe('ID of the workflow to activate'),
    })),

    mcpTool(ctx, 'unpublish_workflow', 'Deactivate a workflow to stop production execution.', z.object({
      workflowId: z.string().describe('ID of the workflow to deactivate'),
    })),

    mcpTool(ctx, 'archive_workflow', 'Archive a workflow by ID.', z.object({
      workflowId: z.string().describe('ID of the workflow to archive'),
    })),
  ]
}
