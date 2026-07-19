/**
 * Provider DB snapshot 校验与显式更新。
 *
 * 普通 dev/build 只校验仓库内 snapshot，不访问网络，保证构建可复现：
 *   bun run scripts/fetch-provider-db.ts --verify
 *
 * 只有维护者明确执行更新命令时才读取上游并写回 snapshot：
 *   bun run scripts/fetch-provider-db.ts --update
 *
 * 环境变量：
 * - PROVIDER_DB_URL：覆盖显式更新使用的远程 URL
 * - PROVIDER_DB_LOCAL_PATH：从本地文件更新，优先于远程 URL
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { sanitizeProviderDbAggregate, type ProviderDbAggregate } from '@kila/shared'

const DEFAULT_URL =
  'https://raw.githubusercontent.com/ThinkInAIXYZ/PublicProviderConf/refs/heads/dev/dist/all.json'
// 上游下载是紧凑 JSON，仓库 snapshot 会格式化缩进；上限需同时容纳两者。
const MAX_SIZE_BYTES = 10 * 1024 * 1024
const FETCH_TIMEOUT_MS = 20_000

const log = (...args: unknown[]): void => console.log('[provider-db]', ...args)
const error = (...args: unknown[]): void => console.error('[provider-db]', ...args)

export interface ProviderDbStats {
  providerCount: number
  modelCount: number
  sizeBytes: number
}

interface UpdateSnapshotInput {
  outFile: string
  sourceLabel: string
  readSource: () => Promise<string>
}

function getStats(database: ProviderDbAggregate, sizeBytes: number): ProviderDbStats {
  return {
    providerCount: Object.keys(database.providers).length,
    modelCount: Object.values(database.providers).reduce(
      (count, provider) => count + provider.models.length,
      0,
    ),
    sizeBytes,
  }
}

export function parseProviderDbText(text: string): {
  database: ProviderDbAggregate
  stats: ProviderDbStats
} {
  const sizeBytes = Buffer.byteLength(text, 'utf8')
  if (sizeBytes > MAX_SIZE_BYTES) {
    throw new Error(`Provider DB 内容过大（${sizeBytes} bytes > ${MAX_SIZE_BYTES} bytes）`)
  }

  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    throw new Error(`Provider DB JSON 解析失败: ${message}`)
  }

  const database = sanitizeProviderDbAggregate(json)
  if (!database) {
    throw new Error('Provider DB sanitize 后无有效 provider')
  }

  return { database, stats: getStats(database, sizeBytes) }
}

export function verifyProviderDbSnapshot(outFile: string): ProviderDbStats {
  if (!existsSync(outFile)) {
    throw new Error(`Provider DB snapshot 不存在: ${outFile}`)
  }

  const { stats } = parseProviderDbText(readFileSync(outFile, 'utf8'))
  return stats
}

function writeSnapshotAtomically(outFile: string, database: ProviderDbAggregate): void {
  const tmpFile = `${outFile}.tmp`
  const backupFile = `${outFile}.bak`

  mkdirSync(dirname(outFile), { recursive: true })
  rmSync(tmpFile, { force: true })
  rmSync(backupFile, { force: true })
  writeFileSync(tmpFile, `${JSON.stringify(database, null, 2)}\n`)

  const hadExistingSnapshot = existsSync(outFile)
  try {
    if (hadExistingSnapshot) renameSync(outFile, backupFile)
    renameSync(tmpFile, outFile)
    rmSync(backupFile, { force: true })
  } catch (cause) {
    rmSync(tmpFile, { force: true })
    if (!existsSync(outFile) && existsSync(backupFile)) {
      renameSync(backupFile, outFile)
    }
    throw cause
  }
}

export async function updateProviderDbSnapshot(input: UpdateSnapshotInput): Promise<ProviderDbStats> {
  // 必须先完成读取、大小检查、JSON 解析和 sanitize，之后才允许触碰旧 snapshot。
  const text = await input.readSource()
  const { database } = parseProviderDbText(text)
  writeSnapshotAtomically(input.outFile, database)
  const stats = verifyProviderDbSnapshot(input.outFile)
  log(
    `已从 ${input.sourceLabel} 更新 ${input.outFile}`,
    `(providers=${stats.providerCount}, models=${stats.modelCount}, bytes=${stats.sizeBytes})`,
  )
  return stats
}

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.text()
  } finally {
    clearTimeout(timeout)
  }
}

export async function runProviderDbCommand(
  args = process.argv.slice(2),
  env: Record<string, string | undefined> = process.env,
): Promise<ProviderDbStats> {
  const update = args.includes('--update')
  const unknownArgs = args.filter((arg) => arg !== '--update' && arg !== '--verify')
  if (unknownArgs.length > 0) {
    throw new Error(`未知参数: ${unknownArgs.join(', ')}`)
  }

  const outFile = resolve(process.cwd(), 'resources', 'model-db', 'providers.json')
  if (!update) {
    const stats = verifyProviderDbSnapshot(outFile)
    log(
      `snapshot 校验通过 ${outFile}`,
      `(providers=${stats.providerCount}, models=${stats.modelCount}, bytes=${stats.sizeBytes})`,
    )
    return stats
  }

  const localPath = env.PROVIDER_DB_LOCAL_PATH
  if (localPath) {
    if (!existsSync(localPath)) {
      throw new Error(`PROVIDER_DB_LOCAL_PATH 不存在: ${localPath}`)
    }
    return updateProviderDbSnapshot({
      outFile,
      sourceLabel: localPath,
      readSource: async () => readFileSync(localPath, 'utf8'),
    })
  }

  const url = env.PROVIDER_DB_URL ?? DEFAULT_URL
  return updateProviderDbSnapshot({
    outFile,
    sourceLabel: url,
    readSource: async () => fetchText(url),
  })
}

if (import.meta.main) {
  runProviderDbCommand().catch((cause) => {
    error(cause instanceof Error ? cause.message : String(cause))
    process.exitCode = 1
  })
}
