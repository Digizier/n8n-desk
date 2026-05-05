/**
 * Edge-case tests for the file pipeline. Covers boundary conditions, malformed
 * input, concurrency, and format-specific quirks that the happy-path tests
 * don't exercise. All tests invoke the LangChain tools directly (the
 * mcp-pipeline.test.ts file already covers the protocol layer).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'

import { createFileTools } from '../file-tools'
import { buildCoworkPolicy } from '../sandbox-policy'
import type { FilesystemSandboxPolicy } from '../types'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir: string
let projectDir: string
let n8nDeskDir: string
let policy: FilesystemSandboxPolicy

beforeEach(async () => {
  const rawTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'file-edge-test-'))
  tmpDir = await fs.realpath(rawTmp)
  projectDir = path.join(tmpDir, 'project')
  n8nDeskDir = path.join(tmpDir, '.n8n-desk')
  await fs.mkdir(projectDir, { recursive: true })
  await fs.mkdir(path.join(n8nDeskDir, 'skills'), { recursive: true })
  policy = buildCoworkPolicy([{ path: projectDir }], n8nDeskDir)
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

/** Get a tool by name with an unknown invoke signature. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getTool(name: string): any {
  const tools = createFileTools(policy)
  const t = tools.find((tool: { name: string }) => tool.name === name)
  if (!t) throw new Error(`Tool ${name} not found`)
  return t
}

/** Invoke a tool and return the parsed JSON result. */
async function invoke(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await getTool(name).invoke(args)
  expect(typeof result).toBe('string')
  return JSON.parse(result)
}

// ---------------------------------------------------------------------------
// Path & filesystem edges
// ---------------------------------------------------------------------------

describe('path edges', () => {
  it('normalizes ../ traversal in path string and rejects escapes', async () => {
    const outsideDir = path.join(tmpDir, 'outside')
    await fs.mkdir(outsideDir, { recursive: true })
    await fs.writeFile(path.join(outsideDir, 'x.txt'), 'leaked')

    // projectDir/../outside/x.txt resolves to outside/x.txt — outside the mount
    const escaped = path.join(projectDir, '..', 'outside', 'x.txt')
    const result = await invoke('read_text', { path: escaped })

    expect(result.success).toBe(false)
    expect(String(result.error)).toContain('outside all allowed folders')
  })

  it('symlink inside mount pointing outside is rejected', async () => {
    const outsideDir = path.join(tmpDir, 'outside')
    await fs.mkdir(outsideDir, { recursive: true })
    await fs.writeFile(path.join(outsideDir, 'secret.txt'), 'leaked')

    const linkPath = path.join(projectDir, 'link.txt')
    await fs.symlink(path.join(outsideDir, 'secret.txt'), linkPath)

    const result = await invoke('read_text', { path: linkPath })
    expect(result.success).toBe(false)
    expect(String(result.error)).toContain('outside all allowed folders')
  })

  it('symlink inside mount pointing to another file inside is allowed', async () => {
    await fs.writeFile(path.join(projectDir, 'real.txt'), 'real content')
    const linkPath = path.join(projectDir, 'link.txt')
    await fs.symlink(path.join(projectDir, 'real.txt'), linkPath)

    const result = await invoke('read_text', { path: linkPath })
    expect(result.success).toBe(true)
    expect(result.content).toBe('real content')
  })

  it('read_text on a directory fails gracefully (does not crash)', async () => {
    const subdir = path.join(projectDir, 'a-dir')
    await fs.mkdir(subdir)

    const result = await invoke('read_text', { path: subdir })
    expect(result.success).toBe(false)
    expect(typeof result.error).toBe('string')
  })

  it('write requires the immediate parent directory to exist (sandbox constraint)', async () => {
    // The sandbox path validator resolves the parent directory via realpath.
    // If the parent doesn't exist, the write is rejected before parsers run —
    // so the parsers' internal recursive mkdir only kicks in on already-valid
    // paths. Document the actual behavior: deep paths without parents fail.
    const deep = path.join(projectDir, 'a', 'b', 'c', 'deep.txt')
    const failed = await invoke('write_text', { path: deep, content: 'ok' })
    expect(failed.success).toBe(false)
    expect(String(failed.error)).toMatch(/parent directory|outside all allowed/)

    // Once the parent exists, write succeeds
    await fs.mkdir(path.dirname(deep), { recursive: true })
    const ok = await invoke('write_text', { path: deep, content: 'ok' })
    expect(ok.success).toBe(true)
    const written = await fs.readFile(deep, 'utf-8')
    expect(written).toBe('ok')
  })

  it('write_json overwrites an existing file', async () => {
    const filePath = path.join(projectDir, 'data.json')
    await fs.writeFile(filePath, '{"old": "value"}')

    const result = await invoke('write_json', {
      path: filePath,
      data: { fresh: true },
    })
    expect(result.success).toBe(true)

    const reread = await invoke('read_json', { path: filePath })
    expect(reread.data).toEqual({ fresh: true })
  })

  it('handles filenames with spaces and unicode', async () => {
    const fancy = path.join(projectDir, 'My Report — Final ✨.txt')
    const writeResult = await invoke('write_text', {
      path: fancy,
      content: 'unicode-safe',
    })
    expect(writeResult.success).toBe(true)

    const readResult = await invoke('read_text', { path: fancy })
    expect(readResult.success).toBe(true)
    expect(readResult.content).toBe('unicode-safe')
  })
})

// ---------------------------------------------------------------------------
// Empty / boundary content
// ---------------------------------------------------------------------------

describe('empty and boundary content', () => {
  it('read_text on empty file returns empty content with lineCount 1', async () => {
    const filePath = path.join(projectDir, 'empty.txt')
    await fs.writeFile(filePath, '')

    const result = await invoke('read_text', { path: filePath })
    expect(result.success).toBe(true)
    expect(result.content).toBe('')
    expect(result.sizeBytes).toBe(0)
    expect(result.lineCount).toBe(1)
  })

  it('write_text accepts empty content', async () => {
    const filePath = path.join(projectDir, 'empty.txt')
    const result = await invoke('write_text', { path: filePath, content: '' })

    expect(result.success).toBe(true)
    expect(result.sizeBytes).toBe(0)
    const written = await fs.readFile(filePath, 'utf-8')
    expect(written).toBe('')
  })

  it('read_csv on empty file returns success with empty rows', async () => {
    const filePath = path.join(projectDir, 'empty.csv')
    await fs.writeFile(filePath, '')

    const result = await invoke('read_csv', { path: filePath })
    expect(result.success).toBe(true)
    expect(result.rows).toEqual([])
  })

  it('read_csv with single header row returns no data rows', async () => {
    const filePath = path.join(projectDir, 'header-only.csv')
    await fs.writeFile(filePath, 'name,age\n')

    const result = await invoke('read_csv', { path: filePath })
    expect(result.success).toBe(true)
    expect(result.headers).toEqual(['name', 'age'])
    expect(result.rows).toEqual([])
  })

  it('write_csv with empty rows array succeeds', async () => {
    const filePath = path.join(projectDir, 'empty.csv')
    const result = await invoke('write_csv', { path: filePath, rows: [] })
    expect(result.success).toBe(true)
  })

  it('read_json on invalid JSON returns parse_error', async () => {
    const filePath = path.join(projectDir, 'bad.json')
    await fs.writeFile(filePath, '{{{ not json')

    const result = await invoke('read_json', { path: filePath })
    expect(result.success).toBe(false)
    expect(result.type).toBe('parse_error')
  })

  it('read_yaml on empty file succeeds (yields null/undefined)', async () => {
    const filePath = path.join(projectDir, 'empty.yaml')
    await fs.writeFile(filePath, '')

    const result = await invoke('read_yaml', { path: filePath })
    expect(result.success).toBe(true)
  })

  it('long single-line file has lineCount 1', async () => {
    const filePath = path.join(projectDir, 'big-line.txt')
    const oneLine = 'x'.repeat(200_000)
    await fs.writeFile(filePath, oneLine)

    const result = await invoke('read_text', { path: filePath })
    expect(result.success).toBe(true)
    expect(result.lineCount).toBe(1)
    expect(result.sizeBytes).toBe(200_000)
  })
})

// ---------------------------------------------------------------------------
// Format-specific edges
// ---------------------------------------------------------------------------

describe('JSON format edges', () => {
  it('round-trips deeply nested objects (depth 50)', async () => {
    const filePath = path.join(projectDir, 'nested.json')
    let nested: unknown = { value: 'leaf' }
    for (let i = 0; i < 50; i++) {
      nested = { wrap: nested }
    }

    await invoke('write_json', { path: filePath, data: nested })
    const result = await invoke('read_json', { path: filePath })
    expect(result.success).toBe(true)
    expect(result.data).toEqual(nested)
  })

  it('round-trips a 10k-element number array', async () => {
    const filePath = path.join(projectDir, 'big-array.json')
    const arr = Array.from({ length: 10_000 }, (_, i) => i)

    await invoke('write_json', { path: filePath, data: arr })
    const result = await invoke('read_json', { path: filePath })
    expect(result.success).toBe(true)
    expect(result.data).toEqual(arr)
  })
})

describe('YAML format edges', () => {
  it('parses anchors and aliases', async () => {
    const filePath = path.join(projectDir, 'anchors.yaml')
    await fs.writeFile(
      filePath,
      ['default: &defaults', '  retries: 3', '  timeout: 10', 'job: *defaults', ''].join('\n'),
    )

    const result = await invoke('read_yaml', { path: filePath })
    expect(result.success).toBe(true)
    expect(result.data).toMatchObject({
      default: { retries: 3, timeout: 10 },
      job: { retries: 3, timeout: 10 },
    })
  })

  it('safe loader rejects !!js/function payloads', async () => {
    const filePath = path.join(projectDir, 'evil.yaml')
    await fs.writeFile(
      filePath,
      'fn: !!js/function "function () { return 42 }"\n',
    )

    const result = await invoke('read_yaml', { path: filePath })
    // The safe DEFAULT_SCHEMA either errors out or loads the type as a plain
    // value — but it must NOT execute the JS. Either outcome is acceptable;
    // what matters is no code execution.
    if (result.success === true) {
      const fn = (result.data as { fn: unknown }).fn
      expect(typeof fn).not.toBe('function')
    } else {
      expect(result.type).toBe('parse_error')
    }
  })
})

describe('CSV format edges', () => {
  it('parses embedded newlines, commas, and quotes inside quoted fields', async () => {
    const filePath = path.join(projectDir, 'tricky.csv')
    await fs.writeFile(
      filePath,
      'name,note\n"Alice","line1\nline2"\n"Bob","comma, inside"\n"Eve","quote ""inside"""\n',
    )

    const result = await invoke('read_csv', { path: filePath })
    expect(result.success).toBe(true)
    expect(result.rows).toEqual([
      { name: 'Alice', note: 'line1\nline2' },
      { name: 'Bob', note: 'comma, inside' },
      { name: 'Eve', note: 'quote "inside"' },
    ])
  })

  it('handles CRLF line endings', async () => {
    const filePath = path.join(projectDir, 'crlf.csv')
    await fs.writeFile(filePath, 'a,b\r\n1,2\r\n3,4\r\n')

    const result = await invoke('read_csv', { path: filePath })
    expect(result.success).toBe(true)
    expect(result.rows).toEqual([
      { a: 1, b: 2 },
      { a: 3, b: 4 },
    ])
  })

  it('paginates correctly with offset/limit and signals truncated', async () => {
    const filePath = path.join(projectDir, 'paged.csv')
    const lines = ['id,val']
    for (let i = 0; i < 20; i++) {
      lines.push(`${i},${i * 10}`)
    }
    await fs.writeFile(filePath, lines.join('\n') + '\n')

    const page1 = await invoke('read_csv', {
      path: filePath,
      offset: 0,
      limit: 5,
    })
    expect(page1.success).toBe(true)
    expect(page1.rows).toHaveLength(5)
    expect((page1.rows as Array<Record<string, unknown>>)[0]).toMatchObject({ id: 0 })
    expect(page1.truncated).toBe(true)

    const page2 = await invoke('read_csv', {
      path: filePath,
      offset: 5,
      limit: 5,
    })
    expect(page2.success).toBe(true)
    expect(page2.rows).toHaveLength(5)
    expect((page2.rows as Array<Record<string, unknown>>)[0]).toMatchObject({ id: 5 })

    const ids1 = (page1.rows as Array<{ id: number }>).map((r) => r.id)
    const ids2 = (page2.rows as Array<{ id: number }>).map((r) => r.id)
    expect(ids1.filter((i) => ids2.includes(i))).toEqual([])
  })
})

describe('Excel format edges', () => {
  it('paginates a sheet with more than 100 rows by default', async () => {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    const rows = Array.from({ length: 250 }, (_, i) => ({ idx: i, sq: i * i }))
    const ws = XLSX.utils.json_to_sheet(rows)
    XLSX.utils.book_append_sheet(wb, ws, 'Big')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
    const filePath = path.join(projectDir, 'big.xlsx')
    await fs.writeFile(filePath, buf)

    const result = await invoke('read_excel', { path: filePath })
    expect(result.success).toBe(true)
    const sheets = result.sheets as Array<{
      name: string
      rows: Array<Record<string, unknown>>
      totalRows: number
    }>
    expect(sheets[0].totalRows).toBe(250)
    expect(sheets[0].rows.length).toBe(100)
    expect(result.truncated).toBe(true)
  })

  it('selects a named sheet vs returning all sheets', async () => {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([{ a: 1 }]),
      'Alpha',
    )
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([{ b: 2 }]),
      'Beta',
    )
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
    const filePath = path.join(projectDir, 'two.xlsx')
    await fs.writeFile(filePath, buf)

    const all = await invoke('read_excel', { path: filePath })
    expect((all.sheets as unknown[]).length).toBe(2)

    const just = await invoke('read_excel', { path: filePath, sheet: 'Beta' })
    const sheets = just.sheets as Array<{ name: string }>
    expect(sheets).toHaveLength(1)
    expect(sheets[0].name).toBe('Beta')
  })
})

describe('PDF format edges', () => {
  it('returns parse_error for random bytes with .pdf extension', async () => {
    const filePath = path.join(projectDir, 'fake.pdf')
    await fs.writeFile(filePath, Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]))

    const result = await invoke('read_pdf', { path: filePath })
    expect(result.success).toBe(false)
  })

  it('extracts a specific page range from a real PDF', async () => {
    const fixtureSrc = path.join(
      path.resolve(__dirname, '..', '..', '..'),
      'node_modules', 'pdf-parse', 'test', 'data', '01-valid.pdf',
    )
    const pdfPath = path.join(projectDir, 'doc.pdf')
    await fs.copyFile(fixtureSrc, pdfPath)

    const result = await invoke('read_pdf', { path: pdfPath, pages: '1-2' })
    expect(result.success).toBe(true)
    const pages = result.pages as Array<{ pageNum: number }>
    expect(pages.length).toBeLessThanOrEqual(2)
    for (const p of pages) {
      expect(p.pageNum).toBeGreaterThanOrEqual(1)
      expect(p.pageNum).toBeLessThanOrEqual(2)
    }
  })
})

describe('DOCX format edges', () => {
  it('write_docx from markdown produces a non-empty file', async () => {
    const filePath = path.join(projectDir, 'doc.docx')
    const md = '# Title\n\nSome **bold** text and a list:\n\n- one\n- two\n'

    const writeResult = await invoke('write_docx', { path: filePath, content: md })
    expect(writeResult.success).toBe(true)
    expect((writeResult.sizeBytes as number)).toBeGreaterThan(100)

    const stat = await fs.stat(filePath)
    expect(stat.size).toBeGreaterThan(100)
  })

  it('round-trips: write_docx then read_docx returns the prose', async () => {
    const filePath = path.join(projectDir, 'roundtrip.docx')
    const md = '# Heading\n\nA paragraph.\n'

    await invoke('write_docx', { path: filePath, content: md })
    const result = await invoke('read_docx', { path: filePath })
    expect(result.success).toBe(true)
    // read_docx returns extracted text in `text`; per-paragraph data in `paragraphs`
    const text = String(result.text ?? '')
    expect(text).toContain('Heading')
    expect(text).toContain('paragraph')
  })
})

// ---------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------

describe('concurrency', () => {
  it('10 parallel read_text calls return identical content', async () => {
    const filePath = path.join(projectDir, 'shared.txt')
    await fs.writeFile(filePath, 'shared content')

    const reads = Array.from({ length: 10 }, () =>
      invoke('read_text', { path: filePath }),
    )
    const results = await Promise.all(reads)
    for (const r of results) {
      expect(r.success).toBe(true)
      expect(r.content).toBe('shared content')
    }
  })

  it('parallel writes to distinct files all succeed', async () => {
    const writes = Array.from({ length: 10 }, (_, i) =>
      invoke('write_text', {
        path: path.join(projectDir, `file-${i}.txt`),
        content: `content ${i}`,
      }),
    )
    const results = await Promise.all(writes)
    for (const r of results) {
      expect(r.success).toBe(true)
    }
    for (let i = 0; i < 10; i++) {
      const content = await fs.readFile(
        path.join(projectDir, `file-${i}.txt`),
        'utf-8',
      )
      expect(content).toBe(`content ${i}`)
    }
  })

  it('parallel writes to the same file all report success (no thrown errors)', async () => {
    // Note on atomicity: write_text is NOT atomic when multiple writers race
    // on the same path — Node's fs.writeFile delegates to POSIX write() which
    // may interleave bytes under concurrent writers. The agent's pipeline
    // contract here is only that no call throws and every call reports
    // success; callers must serialize writes themselves if they need
    // last-write-wins semantics.
    const filePath = path.join(projectDir, 'contended.txt')
    const inputs = ['alpha', 'beta', 'gamma', 'delta']

    const writes = inputs.map((c) =>
      invoke('write_text', { path: filePath, content: c }),
    )
    const results = await Promise.all(writes)
    for (const r of results) {
      expect(r.success).toBe(true)
    }
    const final = await fs.readFile(filePath, 'utf-8')
    expect(typeof final).toBe('string')
    expect(final.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Result contract — wrapper guarantees
// ---------------------------------------------------------------------------

describe('result contract', () => {
  it('every read tool returns parseable JSON even on error paths', async () => {
    const outsideDir = path.join(tmpDir, 'outside')
    await fs.mkdir(outsideDir, { recursive: true })
    const targets = [
      ['read_text', { path: path.join(outsideDir, 'nope.txt') }],
      ['read_json', { path: path.join(outsideDir, 'nope.json') }],
      ['read_yaml', { path: path.join(outsideDir, 'nope.yaml') }],
      ['read_csv', { path: path.join(outsideDir, 'nope.csv') }],
      ['read_excel', { path: path.join(outsideDir, 'nope.xlsx') }],
      ['read_pdf', { path: path.join(outsideDir, 'nope.pdf') }],
      ['read_docx', { path: path.join(outsideDir, 'nope.docx') }],
      ['list_files', { path: outsideDir }],
      ['search_files', { path: outsideDir, query: 'x' }],
    ] as const

    for (const [name, args] of targets) {
      const raw: string = await getTool(name).invoke(args)
      expect(typeof raw).toBe('string')
      const parsed = JSON.parse(raw) as { success: boolean; error?: string }
      expect(parsed.success).toBe(false)
      expect(typeof parsed.error).toBe('string')
    }
  })

  it('write tools never throw on bad paths — return parseable JSON errors', async () => {
    const outsideDir = path.join(tmpDir, 'outside')
    await fs.mkdir(outsideDir, { recursive: true })
    const targets = [
      ['write_text', { path: path.join(outsideDir, 'x.txt'), content: 'a' }],
      ['write_json', { path: path.join(outsideDir, 'x.json'), data: { a: 1 } }],
      ['write_yaml', { path: path.join(outsideDir, 'x.yaml'), data: { a: 1 } }],
      ['write_csv', { path: path.join(outsideDir, 'x.csv'), rows: [{ a: 1 }] }],
      ['write_docx', { path: path.join(outsideDir, 'x.docx'), content: '# h' }],
      ['write_excel', {
        path: path.join(outsideDir, 'x.xlsx'),
        sheets: [{ name: 'S', rows: [{ a: 1 }] }],
      }],
    ] as const

    for (const [name, args] of targets) {
      // Must not throw — wrapper turns all errors into JSON
      const raw: string = await getTool(name).invoke(args)
      const parsed = JSON.parse(raw) as { success: boolean; error?: string }
      expect(parsed.success).toBe(false)
      expect(typeof parsed.error).toBe('string')
    }
  })
})
