#!/usr/bin/env bun
/**
 * 文件体积闸门
 *
 * 项目规范：单文件 200-400 行典型，800 行硬上限。
 *
 * 存量超限文件记录在 baseline 中允许暂时存在，但：
 * - 不允许新增超限文件
 * - baseline 内的文件只允许变短，不允许继续变长
 * - 文件降到上限以内后应从 baseline 移除（脚本会提示）
 *
 * 用法：
 *   bun run scripts/check-file-size.ts            # 检查
 *   bun run scripts/check-file-size.ts --update   # 用当前现状重写 baseline
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { Glob } from 'bun'

/** 单文件行数硬上限 */
const HARD_LIMIT = 800

/** 项目根目录 */
const ROOT = join(import.meta.dir, '..')

/** baseline 文件路径 */
const BASELINE_PATH = join(import.meta.dir, 'file-size-baseline.json')

/** 扫描范围 */
const SCAN_GLOBS = [
  'packages/*/src/**/*.{ts,tsx}',
  'apps/electron/src/**/*.{ts,tsx}',
  'apps/electron/scripts/**/*.ts',
  'apps/cli/src/**/*.{ts,tsx}',
  'scripts/**/*.ts',
]

/** 排除的路径片段 */
const EXCLUDE_FRAGMENTS = ['node_modules/', 'dist/', '/out/']

interface BaselineEntry {
  /** 记录 baseline 时的行数，作为"只减不增"的上界 */
  lines: number
}

type Baseline = Record<string, BaselineEntry>

interface FileStat {
  path: string
  lines: number
}

function shouldSkip(path: string): boolean {
  return EXCLUDE_FRAGMENTS.some((fragment) => path.includes(fragment))
}

/** 扫描所有在范围内的源文件行数 */
async function collectFileStats(): Promise<FileStat[]> {
  const stats: FileStat[] = []
  const seen = new Set<string>()

  for (const pattern of SCAN_GLOBS) {
    const glob = new Glob(pattern)
    for await (const match of glob.scan({ cwd: ROOT, absolute: true })) {
      // Windows 上 relative() 返回反斜杠路径，而 baseline 键统一用正斜杠；
      // 不规范化会导致 Windows 本地永远匹配不上 baseline，把存量文件全部误报为新增。
      const relPath = relative(ROOT, match).replaceAll('\\', '/')
      if (shouldSkip(relPath) || seen.has(relPath)) continue
      seen.add(relPath)

      const content = readFileSync(match, 'utf-8')
      const lines = content.length === 0 ? 0 : content.split('\n').length
      stats.push({ path: relPath, lines })
    }
  }

  return stats.sort((a, b) => b.lines - a.lines)
}

function readBaseline(): Baseline {
  if (!existsSync(BASELINE_PATH)) return {}
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf-8')) as Baseline
  } catch (error) {
    console.error(`[文件体积] baseline 解析失败：${String(error)}`)
    process.exit(1)
  }
}

function writeBaseline(stats: FileStat[]): void {
  const baseline: Baseline = {}
  for (const stat of stats) {
    if (stat.lines > HARD_LIMIT) {
      baseline[stat.path] = { lines: stat.lines }
    }
  }

  const sorted = Object.keys(baseline)
    .sort()
    .reduce<Baseline>((acc, key) => {
      acc[key] = baseline[key]!
      return acc
    }, {})

  writeFileSync(BASELINE_PATH, `${JSON.stringify(sorted, null, 2)}\n`, 'utf-8')
  console.log(`[文件体积] baseline 已更新，记录 ${Object.keys(sorted).length} 个存量超限文件`)
}

async function main(): Promise<void> {
  const stats = await collectFileStats()

  if (process.argv.includes('--update')) {
    writeBaseline(stats)
    return
  }

  const baseline = readBaseline()
  const newViolations: FileStat[] = []
  const grown: Array<FileStat & { was: number }> = []
  const improved: Array<FileStat & { was: number }> = []
  const resolved: string[] = []

  for (const stat of stats) {
    const recorded = baseline[stat.path]

    if (stat.lines > HARD_LIMIT) {
      if (!recorded) {
        newViolations.push(stat)
      } else if (stat.lines > recorded.lines) {
        grown.push({ ...stat, was: recorded.lines })
      } else if (stat.lines < recorded.lines) {
        improved.push({ ...stat, was: recorded.lines })
      }
      continue
    }

    if (recorded) {
      resolved.push(stat.path)
    }
  }

  if (improved.length > 0) {
    console.log('[文件体积] 以下 baseline 文件已变短：')
    for (const item of improved) {
      console.log(`  ${item.path}: ${item.was} → ${item.lines}`)
    }
  }

  if (resolved.length > 0) {
    console.log(`[文件体积] 以下文件已降到 ${HARD_LIMIT} 行以内，请从 baseline 移除（bun run check:file-size --update）：`)
    for (const path of resolved) {
      console.log(`  ${path}`)
    }
  }

  let failed = false

  if (newViolations.length > 0) {
    failed = true
    console.error(`\n[文件体积] ✗ 新增 ${newViolations.length} 个超过 ${HARD_LIMIT} 行的文件：`)
    for (const item of newViolations) {
      console.error(`  ${item.path}: ${item.lines} 行`)
    }
    console.error('  请拆分文件，或在确有必要时用 --update 显式纳入 baseline。')
  }

  if (grown.length > 0) {
    failed = true
    console.error(`\n[文件体积] ✗ ${grown.length} 个存量超限文件继续变长：`)
    for (const item of grown) {
      console.error(`  ${item.path}: ${item.was} → ${item.lines} 行`)
    }
    console.error('  存量超限文件只允许变短。')
  }

  if (failed) {
    process.exit(1)
  }

  const baselineCount = Object.keys(baseline).length
  console.log(`[文件体积] ✓ 通过（硬上限 ${HARD_LIMIT} 行，存量豁免 ${baselineCount} 个文件）`)
}

await main()
