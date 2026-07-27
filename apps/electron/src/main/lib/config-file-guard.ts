/**
 * 配置文件护栏
 *
 * 为 ~/.kila 下的 JSON 配置提供三类共用能力：
 *
 * 1. 损坏文件留档 —— 把无法解析的配置改名归档为 `{file}.corrupt-{timestamp}`，
 *    既保留原始字节供人工恢复，又避免下一次写入把损坏状态固化；
 * 2. 降级只读登记 —— 区分「文件不存在」（可信首装，允许写）与「文件存在但读失败」
 *    （不可信，禁止用兜底值覆盖写回，否则唯一恢复源会被一起销毁）；
 * 3. 同步互斥临界区 —— 把「读-改-写」收拢进一次不可中断的同步执行，避免并发写互相覆盖。
 *
 * 说明：主进程是单线程事件循环，同步代码天然互斥；真正的丢更新风险来自跨 await 的
 * 读-改-写。因此这里提供的是「把读改写收拢成同步临界区」的原语，而不是异步锁。
 */

import { existsSync, renameSync } from 'node:fs'

import { createLogger } from './logger'

const log = createLogger('配置护栏')

/** 损坏配置留档结果 */
export interface QuarantineResult {
  /** 主文件留档后的路径；主文件不存在或改名失败时为 null */
  archivedPath: string | null
  /** 备份文件留档后的路径；无备份或改名失败时为 null */
  archivedBackupPath: string | null
}

/** 降级只读登记表：按文件路径记录不可信状态 */
export interface DegradedConfigRegistry {
  markDegraded: (filePath: string, reason: string) => void
  getDegradedReason: (filePath: string) => string | null
  isDegraded: (filePath: string) => boolean
}

/** 同步互斥临界区 */
export interface ConfigMutex {
  runExclusive: <T>(task: () => T) => T
}

function buildQuarantinePath(filePath: string): string {
  const base = `${filePath}.corrupt-${Date.now()}`
  if (!existsSync(base)) return base

  let counter = 1
  while (existsSync(`${base}-${counter}`)) {
    counter += 1
  }
  return `${base}-${counter}`
}

function tryRename(fromPath: string, toPath: string): string | null {
  try {
    renameSync(fromPath, toPath)
    return toPath
  } catch (error) {
    log.error(`[配置护栏] 留档损坏文件失败: ${fromPath}`, error)
    return null
  }
}

/**
 * 把损坏的配置文件（含同名 .bak）改名留档。
 *
 * 主文件与备份使用同一个时间戳后缀，便于成对定位。
 * 只有主备双双解析失败才会走到这里，因此备份一并留档不会丢掉可恢复数据。
 */
export function quarantineCorruptConfig(filePath: string): QuarantineResult {
  if (!existsSync(filePath)) {
    return { archivedPath: null, archivedBackupPath: null }
  }

  const quarantinePath = buildQuarantinePath(filePath)
  const archivedPath = tryRename(filePath, quarantinePath)

  const backupPath = `${filePath}.bak`
  const archivedBackupPath = existsSync(backupPath)
    ? tryRename(backupPath, `${quarantinePath}.bak`)
    : null

  return { archivedPath, archivedBackupPath }
}

/**
 * 创建降级只读登记表。
 *
 * 按文件路径记录，而不是模块级布尔量：测试与多配置目录场景下互不污染，
 * 且同一进程内一旦标记就保持粘性，留档重建后仍然拒绝覆盖写。
 */
export function createDegradedConfigRegistry(): DegradedConfigRegistry {
  const reasons = new Map<string, string>()

  return {
    markDegraded: (filePath: string, reason: string): void => {
      reasons.set(filePath, reason)
    },
    getDegradedReason: (filePath: string): string | null => reasons.get(filePath) ?? null,
    isDegraded: (filePath: string): boolean => reasons.has(filePath),
  }
}

/**
 * 记录一次配置读取失败：留档损坏文件 + 标记降级 + 输出中文错误日志。
 *
 * @returns 降级原因描述，供调用方拼进抛出的错误信息
 */
export function degradeCorruptConfig(
  registry: DegradedConfigRegistry,
  options: { filePath: string; label: string; error: unknown },
): string {
  const { archivedPath } = quarantineCorruptConfig(options.filePath)
  const reason = archivedPath
    ? `${options.label}读取失败，损坏文件已留档: ${archivedPath}`
    : `${options.label}读取失败，且损坏文件留档失败`

  registry.markDegraded(options.filePath, reason)
  log.error(`[配置护栏] ${reason}`, options.error)
  return reason
}

/**
 * 创建同步互斥临界区。
 *
 * 临界区内再次进入说明存在嵌套的读-改-写（例如 mutate 回调里又调了 save），
 * 这类嵌套会静默覆盖外层结果，必须直接暴露而不是放行。
 */
export function createConfigMutex(label: string): ConfigMutex {
  let locked = false

  return {
    runExclusive: <T>(task: () => T): T => {
      if (locked) {
        throw new Error(`配置写入临界区重入: ${label}`)
      }

      locked = true
      try {
        return task()
      } finally {
        locked = false
      }
    },
  }
}
