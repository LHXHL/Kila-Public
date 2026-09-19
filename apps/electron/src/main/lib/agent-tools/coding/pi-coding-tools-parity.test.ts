import { afterEach, describe, expect, test } from 'bun:test'
import { createBashTool as createPiBashTool, createCodingTools } from '@earendil-works/pi-coding-agent'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBashTool as createKilaBashTool } from './bash-tool'
import { createKilaCodingTools } from './index'
import { createCodingPathPolicy } from './path-policy'

const createdDirs: string[] = []

afterEach(() => {
  for (const directory of createdDirs.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('Kila coding tools 与 Pi 0.82.1 parity fixture', () => {
  test('Given 当前 Pi coding tools When 比对工具集合与 schema Then Kila 保持四工具合同一致', () => {
    const root = createDirectory('kila-coding-parity-schema-')
    const kilaTools = createKilaCodingTools({ sessionId: 'parity-schema', cwd: root })
    const piTools = createCodingTools(root)

    const kilaNames: string[] = kilaTools.map((tool) => tool.name).sort()
    const piNames: string[] = piTools.map((tool) => tool.name).sort()
    expect(kilaNames).toEqual(piNames)
    for (const piTool of piTools) {
      const kilaTool = kilaTools.find((tool) => tool.name === piTool.name)
      expect(kilaTool).toBeDefined()
      const piParameters = asSchema(piTool.parameters)
      const kilaParameters = asSchema(kilaTool?.parameters)
      expect(Object.keys(kilaParameters.properties).sort()).toEqual(Object.keys(piParameters.properties).sort())
      expect([...kilaParameters.required].sort()).toEqual([...piParameters.required].sort())
    }
  })

  test('Given 相同 read 输入 When 分别执行 Pi 与 Kila Then 行范围和继续读取边界一致', async () => {
    const piRoot = createDirectory('kila-coding-parity-pi-read-')
    const kilaRoot = createDirectory('kila-coding-parity-kila-read-')
    const content = '第一行\n第二行\n第三行\n第四行'
    writeFileSync(join(piRoot, 'notes.txt'), content)
    writeFileSync(join(kilaRoot, 'notes.txt'), content)

    const piTool = getPiTool(createCodingTools(piRoot), 'read')
    const kilaTool = getKilaTool(createKilaCodingTools({ sessionId: 'parity-read', cwd: kilaRoot }), 'read')
    const input = { path: 'notes.txt', offset: 2, limit: 2 }
    const piResult = await piTool.execute('parity-read-pi', input)
    const kilaResult = await kilaTool.execute('parity-read-kila', input)

    expect(getPiText(piResult)).toContain('第二行\n第三行')
    expect(kilaResult.text).toBe('第二行\n第三行')
    expect(kilaResult.details).toMatchObject({
      offset: 2,
      limit: 2,
      truncation: { truncated: true, nextOffset: 4 },
    })
    expect(getPiText(piResult)).toContain('offset=4')
  })

  test('Given 相同 write/edit 输入 When 分别执行 Pi 与 Kila Then 文件内容和关键变更 details 一致', async () => {
    const piRoot = createDirectory('kila-coding-parity-pi-edit-')
    const kilaRoot = createDirectory('kila-coding-parity-kila-edit-')
    const original = 'const one = 1\nconst two = 2\n'
    for (const root of [piRoot, kilaRoot]) writeFileSync(join(root, 'code.ts'), original)

    const piTools = createCodingTools(piRoot)
    const kilaTools = createKilaCodingTools({ sessionId: 'parity-edit', cwd: kilaRoot })
    const writeInput = { path: 'new.txt', content: 'parity write' }
    const piWrite = await getPiTool(piTools, 'write').execute('parity-write-pi', writeInput)
    const kilaWrite = await getKilaTool(kilaTools, 'write').execute('parity-write-kila', writeInput)
    expect(readFileSync(join(piRoot, 'new.txt'), 'utf8')).toBe(readFileSync(join(kilaRoot, 'new.txt'), 'utf8'))
    expect(getPiText(piWrite)).toContain('12 bytes')
    expect(kilaWrite.details).toMatchObject({ bytesWritten: 12 })

    const editInput = {
      path: 'code.ts',
      edits: [{ oldText: 'const two = 2', newText: 'const two = 20' }],
    }
    const piEdit = await getPiTool(piTools, 'edit').execute('parity-edit-pi', editInput)
    const kilaEdit = await getKilaTool(kilaTools, 'edit').execute('parity-edit-kila', editInput)
    expect(readFileSync(join(piRoot, 'code.ts'), 'utf8')).toBe(readFileSync(join(kilaRoot, 'code.ts'), 'utf8'))
    expect(kilaEdit.details).toMatchObject({ firstChangedLine: 2 })
    expect(getPiDetails(piEdit)).toMatchObject({ firstChangedLine: 2 })
    expect(String(kilaEdit.details?.patch)).toContain('+const two = 20')
    expect(String(getPiDetails(piEdit).patch)).toContain('+const two = 20')
  })

  test('Given 相同 bash 输入 When 分别执行 Pi 与 Kila Then 成功输出与退出码语义一致', async () => {
    const piRoot = createDirectory('kila-coding-parity-pi-bash-')
    const kilaRoot = createDirectory('kila-coding-parity-kila-bash-')
    // Pi 默认 local shell backend 在 Bun 测试环境会加载 Electron 的 named export；
    // 这里只替换 backend，保留 Pi Bash tool 自身的 schema、超时和结果包装。
    const piTool = createPiBashTool(piRoot, { operations: createParityBashOperations() })
    const kilaTool = createKilaBashTool(
      createCodingPathPolicy({ sessionId: 'parity-bash', cwd: kilaRoot }),
      { createOperations: () => createParityBashOperations() },
    )
    const input = { command: 'printf parity', timeout: 10_000 }

    const piResult = await piTool.execute('parity-bash-pi', input)
    const kilaResult = await kilaTool.execute('parity-bash-kila', input)

    expect(getPiText(piResult)).toBe('parity')
    expect(kilaResult.text).toBe('parity')
    expect(kilaResult.details).toMatchObject({ exitCode: 0 })
  })
})

function createDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  createdDirs.push(directory)
  return directory
}

function createParityBashOperations() {
  return {
    exec: (
      command: string,
      cwd: string,
      options: {
        onData: (data: Buffer) => void
        signal?: AbortSignal
        timeout?: number
      },
    ): Promise<{ exitCode: number | null }> => new Promise((resolve) => {
      const child = spawn('/bin/sh', ['-c', command], { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
      let settled = false
      let timeout: ReturnType<typeof setTimeout> | undefined
      const finish = (exitCode: number | null): void => {
        if (settled) return
        settled = true
        if (timeout) clearTimeout(timeout)
        options.signal?.removeEventListener('abort', abort)
        resolve({ exitCode })
      }
      const abort = (): void => {
        child.kill()
        finish(null)
      }
      child.stdout.on('data', options.onData)
      child.stderr.on('data', options.onData)
      child.on('error', () => finish(null))
      child.on('close', (code) => finish(code))
      options.signal?.addEventListener('abort', abort, { once: true })
      if (options.timeout !== undefined) timeout = setTimeout(() => {
        child.kill()
        finish(null)
      }, options.timeout * 1000)
    }),
  }
}

function getKilaTool(tools: ReturnType<typeof createKilaCodingTools>, name: string) {
  const tool = tools.find((candidate) => candidate.name === name)
  if (!tool) throw new Error(`缺少 Kila 工具: ${name}`)
  return tool
}

function getPiTool(tools: ReturnType<typeof createCodingTools>, name: string) {
  const tool = tools.find((candidate) => candidate.name === name)
  if (!tool) throw new Error(`缺少 Pi 工具: ${name}`)
  return tool
}

function getPiText(result: unknown): string {
  if (!result || typeof result !== 'object') return ''
  const content = (result as { content?: unknown }).content
  if (!Array.isArray(content)) return ''
  return content
    .filter((item): item is { type: 'text'; text: string } => (
      Boolean(item)
      && typeof item === 'object'
      && (item as { type?: unknown }).type === 'text'
      && typeof (item as { text?: unknown }).text === 'string'
    ))
    .map((item) => item.text)
    .join('\n')
}

function getPiDetails(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== 'object') return {}
  const details = (result as { details?: unknown }).details
  return details && typeof details === 'object' && !Array.isArray(details)
    ? details as Record<string, unknown>
    : {}
}

function asSchema(value: unknown): {
  properties: Record<string, unknown>
  required: string[]
} {
  if (!value || typeof value !== 'object') throw new Error('工具 schema 不是对象')
  const schema = value as { properties?: unknown; required?: unknown }
  if (!schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties)) {
    throw new Error('工具 schema 缺少 properties')
  }
  if (!Array.isArray(schema.required) || !schema.required.every((item) => typeof item === 'string')) {
    throw new Error('工具 schema 缺少 required')
  }
  return {
    properties: schema.properties as Record<string, unknown>,
    required: schema.required,
  }
}
