/**
 * Tests for LocalMcpServer — the HTTP-based MCP server that exposes file tools
 * to MCP clients over a localhost loopback.
 *
 * Originally LocalMcpServer had a bug: it created one McpServer instance and
 * tried to call connect(transport) on it per request, but Protocol.connect()
 * throws "Already connected to a transport" on the second call. The class is
 * now stateless — each request gets a fresh McpServer + transport, matching
 * the canonical SDK pattern from @modelcontextprotocol/sdk examples.
 *
 * These tests use the real Streamable HTTP client transport so they would
 * fail again if anyone reverts to the broken shared-server pattern.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

import { LocalMcpServer } from '../local-mcp-server'
import { buildCoworkPolicy } from '../sandbox-policy'
import type { FilesystemSandboxPolicy, LoadedSkill } from '../types'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir: string
let projectDir: string
let n8nDeskDir: string
let policy: FilesystemSandboxPolicy

const startedServers: LocalMcpServer[] = []
const connectedClients: Client[] = []

beforeEach(async () => {
  const rawTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'local-mcp-test-'))
  tmpDir = await fs.realpath(rawTmp)
  projectDir = path.join(tmpDir, 'project')
  n8nDeskDir = path.join(tmpDir, '.n8n-desk')
  await fs.mkdir(projectDir, { recursive: true })
  await fs.mkdir(path.join(n8nDeskDir, 'skills'), { recursive: true })
  policy = buildCoworkPolicy([{ path: projectDir }], n8nDeskDir)
})

afterEach(async () => {
  await Promise.all(
    connectedClients.splice(0).map((c) => c.close().catch(() => {})),
  )
  await Promise.all(
    startedServers.splice(0).map((s) => s.stop().catch(() => {})),
  )
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function startTrackedServer(skills: LoadedSkill[] = []): Promise<{
  server: LocalMcpServer
  url: string
}> {
  const server = new LocalMcpServer(policy, skills)
  const info = await server.start()
  startedServers.push(server)
  return { server, url: info.url }
}

async function connectClient(url: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(url))
  const client = new Client(
    { name: 'local-mcp-test-client', version: '1.0.0' },
    { capabilities: {} },
  )
  await client.connect(transport)
  connectedClients.push(client)
  return client
}

function parseToolText(result: { content: Array<{ type: string; text?: string }> }): unknown {
  return JSON.parse(result.content[0].text!)
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe('LocalMcpServer lifecycle', () => {
  it('start() returns a 127.0.0.1 URL with a non-zero port', async () => {
    const { url } = await startTrackedServer()
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  })

  it('start() picks a fresh port each instance', async () => {
    const a = new LocalMcpServer(policy)
    const b = new LocalMcpServer(policy)
    const aInfo = await a.start()
    const bInfo = await b.start()
    startedServers.push(a, b)

    expect(aInfo.port).not.toBe(bInfo.port)
  })

  it('stop() is idempotent', async () => {
    const server = new LocalMcpServer(policy)
    await server.start()
    await server.stop()
    await expect(server.stop()).resolves.toBeUndefined()
  })

  it('after stop(), client connections fail', async () => {
    const server = new LocalMcpServer(policy)
    const info = await server.start()
    await server.stop()

    const transport = new StreamableHTTPClientTransport(new URL(info.url))
    const client = new Client(
      { name: 'post-stop', version: '1.0.0' },
      { capabilities: {} },
    )
    await expect(client.connect(transport)).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// HTTP wire — protocol surface
// ---------------------------------------------------------------------------

describe('LocalMcpServer HTTP protocol', () => {
  it('serves tools/list with all 15 file tools + js_compute', async () => {
    const { url } = await startTrackedServer()
    const client = await connectClient(url)

    const { tools } = await client.listTools()
    const names = tools.map((t) => t.name).sort()

    expect(names).toContain('js_compute')
    const fileNames = names.filter((n) => n !== 'js_compute')
    expect(fileNames).toEqual(
      [
        'list_files',
        'read_csv',
        'read_docx',
        'read_excel',
        'read_json',
        'read_pdf',
        'read_text',
        'read_yaml',
        'search_files',
        'write_csv',
        'write_docx',
        'write_excel',
        'write_json',
        'write_text',
        'write_yaml',
      ].sort(),
    )
  })

  it('regression: handles MULTIPLE consecutive requests on the same client', async () => {
    // Original bug: Protocol.connect() throws on second call. Each call below
    // funnels through a separate HTTP request — they must all succeed.
    const { url } = await startTrackedServer()
    const client = await connectClient(url)

    for (let i = 0; i < 5; i++) {
      const { tools } = await client.listTools()
      expect(tools.length).toBeGreaterThan(0)
    }
  })

  it('regression: handles parallel requests', async () => {
    const { url } = await startTrackedServer()
    const client = await connectClient(url)

    // 10 parallel listTools calls — must all succeed
    const results = await Promise.all(
      Array.from({ length: 10 }, () => client.listTools()),
    )
    for (const r of results) {
      expect(r.tools.length).toBeGreaterThan(0)
    }
  })

  it('serves multiple independent client connections concurrently', async () => {
    const { url } = await startTrackedServer()
    const a = await connectClient(url)
    const b = await connectClient(url)

    const [aRes, bRes] = await Promise.all([a.listTools(), b.listTools()])
    expect(aRes.tools.length).toEqual(bRes.tools.length)
  })

  it('round-trips a tools/call: write_text → read_text', async () => {
    const { url } = await startTrackedServer()
    const client = await connectClient(url)

    const filePath = path.join(projectDir, 'note.txt')
    const writeResult = await client.callTool({
      name: 'write_text',
      arguments: { path: filePath, content: 'roundtrip' },
    })
    expect(parseToolText(writeResult as never)).toMatchObject({ success: true })

    const readResult = await client.callTool({
      name: 'read_text',
      arguments: { path: filePath },
    })
    const body = parseToolText(readResult as never) as {
      success: boolean
      content: string
    }
    expect(body.success).toBe(true)
    expect(body.content).toBe('roundtrip')
  })

  it('sandbox rejection comes back inside the JSON body (not isError)', async () => {
    const { url } = await startTrackedServer()
    const client = await connectClient(url)

    const outsideDir = path.join(tmpDir, 'outside')
    await fs.mkdir(outsideDir, { recursive: true })
    await fs.writeFile(path.join(outsideDir, 'x.txt'), 'leaked')

    const result = await client.callTool({
      name: 'read_text',
      arguments: { path: path.join(outsideDir, 'x.txt') },
    })
    const body = parseToolText(result as never) as { success: boolean; error: string }
    expect(body.success).toBe(false)
    expect(body.error).toContain('outside all allowed folders')
  })

  it('skill tools are exposed when skills are provided', async () => {
    const skillDir = path.join(n8nDeskDir, 'skills', 'demo-skill')
    await fs.mkdir(skillDir, { recursive: true })
    await fs.writeFile(path.join(skillDir, 'PATTERNS.md'), 'patterns')
    const skill: LoadedSkill = {
      name: 'demo-skill',
      description: 'demo',
      content: '# Demo\nHi $ARGUMENTS',
      disableModelInvocation: false,
      userInvocable: true,
      directory: skillDir,
      source: 'user',
    }

    const { url } = await startTrackedServer([skill])
    const client = await connectClient(url)

    const { tools } = await client.listTools()
    const names = tools.map((t) => t.name)
    expect(names).toContain('invoke_skill')
    expect(names).toContain('read_skill_file')

    const invoked = await client.callTool({
      name: 'invoke_skill',
      arguments: { skillName: 'demo-skill', arguments: 'world' },
    }) as { content: Array<{ type: string; text?: string }> }
    expect(invoked.content[0].text).toContain('Hi world')
  })
})
