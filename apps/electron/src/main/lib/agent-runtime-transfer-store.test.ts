import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  cleanupRuntimeTransferBundles,
  createRuntimeTransferBundle,
  removeRuntimeTransferBundle,
  readRuntimeToolResult,
  readRuntimeTransferBundle,
  writeRuntimeToolResult,
} from './agent-runtime-transfer-store'
import { getRuntimeTransferDir } from './config-paths'

const originalConfigDir = process.env.KILA_CONFIG_DIR
const createdDirs: string[] = []

afterEach(() => {
  if (originalConfigDir === undefined) delete process.env.KILA_CONFIG_DIR
  else process.env.KILA_CONFIG_DIR = originalConfigDir
  for (const dir of createdDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function createConfig(): string {
  const configDir = mkdtempSync(join(tmpdir(), 'kila-transfer-config-'))
  createdDirs.push(configDir)
  process.env.KILA_CONFIG_DIR = configDir
  return configDir
}

function createInput(configDir: string, runId = 'run-1') {
  const sourceDir = mkdtempSync(join(configDir, 'source-'))
  writeFileSync(join(sourceDir, 'image.png'), 'image-content')
  return {
    appBootId: 'app-boot-1',
    sessionId: 'session-1',
    runId,
    generation: 2,
    configRevision: 7,
    expiresAt: Date.now() + 60_000,
    bootstrap: { prompt: 'hello', sessionId: 'session-1' },
    tools: [{ name: 'read', parameters: { type: 'object' } }],
    attachments: [{ sourcePath: join(sourceDir, 'image.png'), relativePath: 'attachments/image.png', kind: 'image' as const }],
  }
}

describe('Runtime transfer bundle', () => {
  test('Given 合法 bootstrap/tools/附件 When 创建并读取 Then 校验 hash 与身份后返回内容', () => {
    const configDir = createConfig()
    const input = createInput(configDir)
    const reference = createRuntimeTransferBundle(input)

    const contents = readRuntimeTransferBundle({
      bundlePath: reference.bundlePath,
      manifestSha256: reference.manifestSha256,
      expected: {
        appBootId: input.appBootId,
        sessionId: input.sessionId,
        runId: input.runId,
        generation: input.generation,
      },
    })

    expect(contents.bootstrap).toEqual(input.bootstrap)
    expect(contents.tools).toEqual(input.tools)
    expect(contents.manifest.files).toHaveLength(3)
    expect(contents.files.get('attachments/image.png')?.toString('utf8')).toBe('image-content')
    expect(readFileSync(join(reference.bundlePath, 'attachments/image.png'), 'utf8')).toBe('image-content')
  })

  test('Given 图片内容来自 inlineData When 创建 bundle Then 只在受控文件中保存二进制内容', () => {
    const configDir = createConfig()
    const reference = createRuntimeTransferBundle({
      ...createInput(configDir, 'inline-image'),
      attachments: [{
        content: Buffer.from('inline-image'),
        relativePath: 'images/inline.png',
        kind: 'image',
      }],
    })
    const contents = readRuntimeTransferBundle({
      bundlePath: reference.bundlePath,
      manifestSha256: reference.manifestSha256,
      expected: {
        appBootId: 'app-boot-1',
        sessionId: 'session-1',
        runId: 'inline-image',
        generation: 2,
      },
    })

    expect(contents.files.get('images/inline.png')?.toString('utf8')).toBe('inline-image')
    expect(contents.bootstrap).not.toHaveProperty('imageData')
  })

  test('Given manifest 文件被篡改 When Runtime 读取 Then 拒绝 hash 不匹配', () => {
    const configDir = createConfig()
    const input = createInput(configDir)
    const reference = createRuntimeTransferBundle(input)
    writeFileSync(join(reference.bundlePath, 'bootstrap.json'), '{"prompt":"tampered"}')

    expect(() => readRuntimeTransferBundle({
      bundlePath: reference.bundlePath,
      manifestSha256: reference.manifestSha256,
      expected: input,
    })).toThrow('runtime_transfer_hash_mismatch')
  })

  test('Given 附件是符号链接 When 创建 bundle Then 拒绝把链接内容复制进受控目录', () => {
    const configDir = createConfig()
    const sourceDir = mkdtempSync(join(configDir, 'source-'))
    const outside = join(configDir, 'outside.txt')
    writeFileSync(outside, 'secret')
    symlinkSync(outside, join(sourceDir, 'link.txt'))

    expect(() => createRuntimeTransferBundle({
      ...createInput(configDir, 'run-link'),
      attachments: [{ sourcePath: join(sourceDir, 'link.txt'), relativePath: 'attachments/link.txt' }],
    })).toThrow('runtime_transfer_missing')
  })

  test('Given runId 已存在 When 创建同名 bundle Then 不覆盖已有输入', () => {
    const configDir = createConfig()
    const input = createInput(configDir)
    const first = createRuntimeTransferBundle(input)

    expect(() => createRuntimeTransferBundle(input)).toThrow('runtime_transfer_invalid_manifest')
    expect(existsSync(first.bundlePath)).toBe(true)
  })

  test('Given 过期、错误 boot 和临时 bundle When 启动清理 Then 只保留当前有效 bundle', () => {
    const configDir = createConfig()
    const valid = createRuntimeTransferBundle(createInput(configDir, 'valid'))
    const expired = createRuntimeTransferBundle(createInput(configDir, 'expired'))
    const expiredManifestPath = join(expired.bundlePath, 'manifest.json')
    const expiredManifest = JSON.parse(readFileSync(expiredManifestPath, 'utf8')) as Record<string, unknown>
    expiredManifest.expiresAt = 1
    writeFileSync(expiredManifestPath, JSON.stringify(expiredManifest))

    const tmpPath = join(getRuntimeTransferDir(), '.tmp-stale')
    mkdirSync(tmpPath)
    writeFileSync(join(tmpPath, 'partial'), 'partial')

    const removed = cleanupRuntimeTransferBundles({ appBootId: 'app-boot-1', now: Date.now() })

    expect(removed).toBe(2)
    expect(existsSync(valid.bundlePath)).toBe(true)
    expect(existsSync(expired.bundlePath)).toBe(false)
    expect(existsSync(tmpPath)).toBe(false)
  })

  test('Given 工具结果超过 IPC 内联预算 When 写入并回读受控引用 Then 返回完整文本并拒绝篡改', () => {
    const configDir = createConfig()
    const input = createInput(configDir, 'tool-result')
    const bundle = createRuntimeTransferBundle(input)
    const text = '工具输出😀'.repeat(60_000)
    const reference = writeRuntimeToolResult(bundle.bundlePath, 'tool-call-1', text)

    expect(reference.relativePath).toBe('tool-results/tool-call-1.txt')
    expect(reference.size).toBe(Buffer.byteLength(text, 'utf8'))
    expect(readRuntimeToolResult(bundle.bundlePath, reference)).toBe(text)

    writeFileSync(join(bundle.bundlePath, reference.relativePath), 'tampered')
    expect(() => readRuntimeToolResult(bundle.bundlePath, reference)).toThrow('runtime_transfer_hash_mismatch')
  })

  test('Given run.submitted 后输入文件已释放 When 工具继续产生大结果 Then 结果目录仍可写入并读取', () => {
    const configDir = createConfig()
    const bundle = createRuntimeTransferBundle(createInput(configDir, 'submitted-result'))
    removeRuntimeTransferBundle(bundle.bundlePath, { preserveToolResults: true })

    expect(existsSync(join(bundle.bundlePath, 'bootstrap.json'))).toBe(false)
    const text = 'late-tool-output'.repeat(30_000)
    const reference = writeRuntimeToolResult(bundle.bundlePath, 'late-tool-call', text)

    expect(readRuntimeToolResult(bundle.bundlePath, reference)).toBe(text)
  })
})
