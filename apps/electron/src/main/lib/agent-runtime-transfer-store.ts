import { createHash, randomUUID } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type {
  RuntimeTransferBundleReferenceV1,
  RuntimeTransferFileKind,
  RuntimeTransferManifestFileV1,
  RuntimeTransferManifestV1,
  RuntimeToolResultReferenceV1,
} from '@kila/shared'
import { getRuntimeTransferBundleDir, getRuntimeTransferDir, safePathSegment } from './config-paths'

const MAX_BUNDLE_BYTES = 64 * 1024 * 1024
const MAX_FILE_BYTES = 32 * 1024 * 1024
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_BOOTSTRAP_BYTES = 16 * 1024 * 1024
const MAX_TOOLS_BYTES = 8 * 1024 * 1024
const MAX_ATTACHMENTS = 32
const BUNDLE_VERSION = 1

export interface RuntimeTransferAttachmentInput {
  sourcePath?: string
  content?: Uint8Array
  relativePath: string
  kind?: 'image' | 'attachment'
}

export interface CreateRuntimeTransferBundleInput {
  appBootId: string
  sessionId: string
  runId: string
  generation: number
  configRevision: number
  expiresAt: number
  bootstrap: Record<string, unknown>
  tools: unknown
  attachments?: RuntimeTransferAttachmentInput[]
}

export interface RuntimeTransferBundleContents {
  manifest: RuntimeTransferManifestV1
  manifestSha256: string
  bootstrap: Record<string, unknown>
  tools: unknown
  files: ReadonlyMap<string, Buffer>
}

interface BundleFileSource {
  relativePath: string
  kind: RuntimeTransferFileKind
  content?: Buffer
  sourcePath?: string
}

export function createRuntimeTransferBundle(
  input: CreateRuntimeTransferBundleInput,
): RuntimeTransferBundleReferenceV1 {
  validateIdentifier(input.sessionId, 'sessionId')
  validateIdentifier(input.runId, 'runId')
  if (!Number.isInteger(input.generation) || input.generation < 0) {
    throw new Error('runtime_transfer_invalid_manifest: generation 无效')
  }
  if (input.expiresAt <= Date.now()) {
    throw new Error('runtime_transfer_expired: bundle 已过期')
  }

  const files: BundleFileSource[] = [
    { relativePath: 'bootstrap.json', kind: 'bootstrap', content: encodeJson(input.bootstrap) },
    { relativePath: 'tools.json', kind: 'tools', content: encodeJson(input.tools) },
  ]
  for (const attachment of input.attachments ?? []) {
    if (files.length - 2 >= MAX_ATTACHMENTS) {
      throw new Error(`runtime_transfer_too_large: 附件数量超过 ${MAX_ATTACHMENTS}`)
    }
    files.push({
      relativePath: normalizeRelativePath(attachment.relativePath),
      content: attachment.content ? Buffer.from(attachment.content) : undefined,
      sourcePath: attachment.sourcePath,
      kind: attachment.kind ?? 'attachment',
    })
  }

  const transferRoot = getRuntimeTransferDir()
  const finalPath = getRuntimeTransferBundleDir(input.runId)
  if (existsSync(finalPath)) {
    throw new Error(`runtime_transfer_invalid_manifest: runId 已存在: ${input.runId}`)
  }

  const temporaryPath = join(transferRoot, `.tmp-${safePathSegment(input.runId)}-${randomUUID()}`)
  mkdirSync(temporaryPath, { recursive: true, mode: 0o700 })
  try {
    const manifestFiles: RuntimeTransferManifestFileV1[] = []
    let totalSize = 0
    for (const file of files) {
      const targetPath = resolveBundleFilePath(temporaryPath, file.relativePath)
      mkdirSync(dirname(targetPath), { recursive: true, mode: 0o700 })
      const content = file.content ?? (file.sourcePath
        ? readRegularFile(file.sourcePath, file.kind)
        : (() => { throw new Error(`runtime_transfer_missing: 缺少附件内容: ${file.relativePath}`) })())
      const maxBytes = file.kind === 'image' ? MAX_IMAGE_BYTES : MAX_FILE_BYTES
      const limit = file.kind === 'bootstrap'
        ? MAX_BOOTSTRAP_BYTES
        : file.kind === 'tools' ? MAX_TOOLS_BYTES : maxBytes
      if (content.byteLength > limit) {
        throw new Error(`runtime_transfer_too_large: ${file.relativePath} 超过 ${limit} 字节限制`)
      }
      writePrivateFile(targetPath, content)
      const sha256 = hashBytes(content)
      manifestFiles.push({
        relativePath: file.relativePath,
        size: content.byteLength,
        sha256,
        kind: file.kind,
      })
      totalSize += content.byteLength
      if (totalSize > MAX_BUNDLE_BYTES) {
        throw new Error(`runtime_transfer_too_large: bundle 超过 ${MAX_BUNDLE_BYTES} 字节限制`)
      }
    }

    const manifest: RuntimeTransferManifestV1 = {
      version: BUNDLE_VERSION,
      appBootId: input.appBootId,
      sessionId: input.sessionId,
      runId: input.runId,
      generation: input.generation,
      createdAt: Date.now(),
      expiresAt: input.expiresAt,
      files: manifestFiles,
      totalSize,
    }
    const manifestBytes = encodeJson(manifest)
    const manifestPath = join(temporaryPath, 'manifest.json')
    writePrivateFile(manifestPath, manifestBytes)
    fsyncDirectory(temporaryPath)
    renameSync(temporaryPath, finalPath)
    fsyncDirectory(transferRoot)
    return {
      bundlePath: finalPath,
      manifestSha256: hashBytes(manifestBytes),
      configRevision: input.configRevision,
    }
  } catch (error) {
    rmSync(temporaryPath, { recursive: true, force: true })
    throw error
  }
}

export function readRuntimeTransferBundle(input: {
  bundlePath: string
  expected: Pick<RuntimeTransferManifestV1, 'appBootId' | 'sessionId' | 'runId' | 'generation'>
  manifestSha256: string
  now?: number
}): RuntimeTransferBundleContents {
  const transferRoot = resolve(getRuntimeTransferDir())
  const bundlePath = resolve(input.bundlePath)
  const bundleName = bundlePath.split(/[\\/]/).at(-1)
  if (!bundleName || bundleName !== safePathSegment(input.expected.runId)) {
    throw new Error('runtime_transfer_invalid_path: bundle 目录名与 runId 不一致')
  }
  const relativeBundle = relative(transferRoot, bundlePath)
  if (!relativeBundle || relativeBundle.startsWith('..') || isAbsolute(relativeBundle)) {
    throw new Error('runtime_transfer_invalid_path: bundle 不在受控目录内')
  }
  if (!existsSync(bundlePath) || !lstatSync(bundlePath).isDirectory()) {
    throw new Error('runtime_transfer_missing: bundle 目录不存在')
  }
  const manifestPath = resolveBundleFilePath(bundlePath, 'manifest.json')
  const manifestBytes = readRegularFile(manifestPath, 'attachment')
  if (hashBytes(manifestBytes) !== input.manifestSha256) {
    throw new Error('runtime_transfer_hash_mismatch: manifest hash 不匹配')
  }

  let manifest: RuntimeTransferManifestV1
  try {
    manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes)) as RuntimeTransferManifestV1
  } catch {
    throw new Error('runtime_transfer_invalid_manifest: manifest JSON 无效')
  }
  validateManifest(manifest, input.expected, input.now ?? Date.now())

  const fileContents = new Map<string, Buffer>()
  let totalSize = 0
  for (const file of manifest.files) {
    const filePath = resolveBundleFilePath(bundlePath, file.relativePath)
    const content = readRegularFile(filePath, file.kind)
    if (content.byteLength !== file.size || hashBytes(content) !== file.sha256) {
      throw new Error(`runtime_transfer_hash_mismatch: 文件校验失败: ${file.relativePath}`)
    }
    totalSize += content.byteLength
    fileContents.set(file.relativePath, content)
  }
  if (totalSize !== manifest.totalSize || totalSize > MAX_BUNDLE_BYTES) {
    throw new Error('runtime_transfer_too_large: bundle 总大小校验失败')
  }

  const bootstrap = parseBundleJson<Record<string, unknown>>(fileContents.get('bootstrap.json'), 'bootstrap.json')
  const tools = parseBundleJson<unknown>(fileContents.get('tools.json'), 'tools.json')
  return { manifest, manifestSha256: input.manifestSha256, bootstrap, tools, files: fileContents }
}

export function cleanupRuntimeTransferBundles(options: {
  appBootId: string
  now?: number
  maxAgeMs?: number
}): number {
  const now = options.now ?? Date.now()
  const maxAgeMs = options.maxAgeMs ?? 24 * 60 * 60 * 1000
  const root = getRuntimeTransferDir()
  let removed = 0
  for (const name of readdirSync(root)) {
    if (!name || name.startsWith('.tmp-')) {
      const path = join(root, name)
      if (name.startsWith('.tmp-')) {
        rmSync(path, { recursive: true, force: true })
        removed += 1
      }
      continue
    }
    const path = join(root, name)
    let shouldRemove = false
    try {
      const manifestPath = join(path, 'manifest.json')
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as RuntimeTransferManifestV1
      shouldRemove = manifest.appBootId !== options.appBootId
        || manifest.expiresAt <= now
        || now - manifest.createdAt > maxAgeMs
    } catch {
      shouldRemove = true
    }
    if (shouldRemove) {
      rmSync(path, { recursive: true, force: true })
      removed += 1
    }
  }
  return removed
}

/** 将超出 IPC 内联预算的工具结果以受控引用写入当前 run bundle。 */
export function writeRuntimeToolResult(
  bundlePath: string,
  toolCallId: string,
  text: string,
): RuntimeToolResultReferenceV1 {
  const relativePath = `tool-results/${safePathSegment(toolCallId)}.txt`
  const targetPath = resolveBundleFilePath(bundlePath, relativePath)
  const content = Buffer.from(text, 'utf8')
  mkdirSync(dirname(targetPath), { recursive: true, mode: 0o700 })
  const temporaryPath = `${targetPath}.${randomUUID()}.tmp`
  try {
    writePrivateFile(temporaryPath, content)
    renameSync(temporaryPath, targetPath)
    fsyncDirectory(dirname(targetPath))
  } catch (error) {
    rmSync(temporaryPath, { force: true })
    throw error
  }
  return { relativePath, sha256: hashBytes(content), size: content.byteLength }
}

/** Runtime 读取主进程写入的工具结果，并重新校验引用，拒绝越界或篡改。 */
export function readRuntimeToolResult(
  bundlePath: string,
  reference: RuntimeToolResultReferenceV1,
): string {
  const relativePath = normalizeRelativePath(reference.relativePath)
  if (!relativePath.startsWith('tool-results/')) {
    throw new Error('runtime_transfer_invalid_path: tool result 引用不在受控目录')
  }
  const content = readRegularFile(resolveBundleFilePath(bundlePath, relativePath), 'attachment')
  if (content.byteLength !== reference.size || hashBytes(content) !== reference.sha256) {
    throw new Error('runtime_transfer_hash_mismatch: tool result 引用校验失败')
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(content)
  } catch {
    throw new Error('runtime_transfer_invalid_manifest: tool result 不是有效 UTF-8')
  }
}

/**
 * 删除一次性 transfer bundle。
 *
 * run.submitted 后输入已经被 Utility 读取，可以先释放 bootstrap/tools/附件；
 * tool-results 仍可能在本轮后半段写入，因此保留该目录直到 run.persisted_ack。
 */
export function removeRuntimeTransferBundle(bundlePath: string, options: { preserveToolResults?: boolean } = {}): void {
  const root = resolve(getRuntimeTransferDir())
  const target = resolve(bundlePath)
  const relativeTarget = relative(root, target)
  if (!relativeTarget || relativeTarget.startsWith('..') || isAbsolute(relativeTarget)) {
    throw new Error('runtime_transfer_invalid_path: bundle 不在受控目录内')
  }
  if (!existsSync(target) || !lstatSync(target).isDirectory()) return
  if (!options.preserveToolResults) {
    rmSync(target, { recursive: true, force: true })
    return
  }

  for (const entry of readdirSync(target)) {
    if (entry === 'tool-results') continue
    rmSync(join(target, entry), { recursive: true, force: true })
  }
}

function validateManifest(
  manifest: RuntimeTransferManifestV1,
  expected: Pick<RuntimeTransferManifestV1, 'appBootId' | 'sessionId' | 'runId' | 'generation'>,
  now: number,
): void {
  if (
    manifest.version !== 1
    || manifest.appBootId !== expected.appBootId
    || manifest.sessionId !== expected.sessionId
    || manifest.runId !== expected.runId
    || manifest.generation !== expected.generation
  ) {
    throw new Error('runtime_transfer_invalid_manifest: 身份或版本不匹配')
  }
  if (manifest.expiresAt <= now) throw new Error('runtime_transfer_expired: bundle 已过期')
  if (!Number.isInteger(manifest.totalSize) || manifest.totalSize < 0 || manifest.totalSize > MAX_BUNDLE_BYTES) {
    throw new Error('runtime_transfer_too_large: totalSize 无效')
  }
  if (!Array.isArray(manifest.files) || manifest.files.length < 2 || manifest.files.length - 2 > MAX_ATTACHMENTS) {
    throw new Error('runtime_transfer_invalid_manifest: files 数量无效')
  }
  const seen = new Set<string>()
  for (const file of manifest.files) {
    const relativePath = normalizeRelativePath(file.relativePath)
    if (relativePath !== file.relativePath || seen.has(relativePath)) {
      throw new Error('runtime_transfer_invalid_manifest: relativePath 重复或非法')
    }
    seen.add(relativePath)
    const maxBytes = file.kind === 'image' ? MAX_IMAGE_BYTES
      : file.kind === 'bootstrap' ? MAX_BOOTSTRAP_BYTES
        : file.kind === 'tools' ? MAX_TOOLS_BYTES
          : MAX_FILE_BYTES
    if (!Number.isInteger(file.size) || file.size < 0 || file.size > maxBytes || !/^[a-f0-9]{64}$/.test(file.sha256)) {
      throw new Error(`runtime_transfer_invalid_manifest: 文件元数据无效: ${relativePath}`)
    }
  }
  if (!seen.has('bootstrap.json') || !seen.has('tools.json')) {
    throw new Error('runtime_transfer_invalid_manifest: 缺少 bootstrap/tools')
  }
}

function normalizeRelativePath(value: string): string {
  if (
    typeof value !== 'string'
    || value.trim() === ''
    || value.includes('\0')
    || isAbsolute(value)
  ) {
    throw new Error('runtime_transfer_invalid_path: relativePath 非法')
  }
  const normalized = value.replaceAll('\\', '/')
  if (normalized.split('/').some((part) => part === '..' || part === '')) {
    throw new Error('runtime_transfer_invalid_path: relativePath 包含 .. 或空路径段')
  }
  return normalized
}

function resolveBundleFilePath(bundlePath: string, relativePath: string): string {
  const normalized = normalizeRelativePath(relativePath)
  const candidate = resolve(bundlePath, normalized)
  const relativeCandidate = relative(resolve(bundlePath), candidate)
  if (relativeCandidate.startsWith('..') || isAbsolute(relativeCandidate)) {
    throw new Error('runtime_transfer_invalid_path: 文件路径越界')
  }
  return candidate
}

function readRegularFile(path: string, kind: RuntimeTransferFileKind): Buffer {
  if (!existsSync(path) || !lstatSync(path).isFile()) {
    throw new Error(`runtime_transfer_missing: 文件不存在或不是普通文件: ${kind}`)
  }
  return readFileSync(path)
}

function parseBundleJson<T>(content: Buffer | undefined, name: string): T {
  if (!content) throw new Error(`runtime_transfer_invalid_manifest: 缺少 ${name}`)
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(content)) as T
  } catch {
    throw new Error(`runtime_transfer_invalid_manifest: ${name} JSON 无效`)
  }
}

function encodeJson(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value), 'utf8')
}

function hashBytes(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function writePrivateFile(path: string, content: Buffer): void {
  const fd = openSync(path, 'w', 0o600)
  try {
    writeFileSync(fd, content)
    fsyncSync(fd)
    chmodSync(path, 0o600)
  } finally {
    closeSync(fd)
  }
}

function fsyncDirectory(path: string): void {
  try {
    const fd = openSync(path, 'r')
    try {
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
  } catch {
    // Windows 与部分文件系统不允许打开目录进行 fsync。
  }
}

function validateIdentifier(value: string, name: string): void {
  if (!value || safePathSegment(value) !== value) {
    throw new Error(`runtime_transfer_invalid_manifest: ${name} 非法`)
  }
}
