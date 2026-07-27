import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createConfigMutex,
  createDegradedConfigRegistry,
  degradeCorruptConfig,
  quarantineCorruptConfig,
} from './config-file-guard'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kila-config-guard-test-'))
  tempDirs.push(dir)
  return dir
}

describe('配置文件护栏', () => {
  test('Given 损坏的主文件与备份，When 留档，Then 两者成对改名且原路径被清空', () => {
    const dir = createTempDir()
    const filePath = join(dir, 'settings.json')
    writeFileSync(filePath, '{ 坏掉的主文件', 'utf-8')
    writeFileSync(`${filePath}.bak`, '{ 坏掉的备份', 'utf-8')

    const result = quarantineCorruptConfig(filePath)

    expect(result.archivedPath).toMatch(/settings\.json\.corrupt-\d+$/)
    expect(result.archivedBackupPath).toBe(`${result.archivedPath}.bak`)
    expect(existsSync(filePath)).toBe(false)
    expect(existsSync(`${filePath}.bak`)).toBe(false)
    expect(readFileSync(result.archivedPath!, 'utf-8')).toBe('{ 坏掉的主文件')
    expect(readFileSync(result.archivedBackupPath!, 'utf-8')).toBe('{ 坏掉的备份')
  })

  test('Given 同一毫秒内重复留档，When 再次留档，Then 追加序号不覆盖既有归档', () => {
    const dir = createTempDir()
    const filePath = join(dir, 'channels.json')

    writeFileSync(filePath, 'first', 'utf-8')
    const first = quarantineCorruptConfig(filePath)
    writeFileSync(filePath, 'second', 'utf-8')
    const second = quarantineCorruptConfig(filePath)

    expect(second.archivedPath).not.toBe(first.archivedPath)
    expect(readFileSync(first.archivedPath!, 'utf-8')).toBe('first')
    expect(readFileSync(second.archivedPath!, 'utf-8')).toBe('second')
    expect(readdirSync(dir).filter((name) => name.includes('.corrupt-'))).toHaveLength(2)
  })

  test('Given 文件不存在，When 留档，Then 返回空结果且不抛错', () => {
    const dir = createTempDir()

    expect(quarantineCorruptConfig(join(dir, 'missing.json'))).toEqual({
      archivedPath: null,
      archivedBackupPath: null,
    })
  })

  test('Given 一次读取失败，When 登记降级，Then 该路径永久不可写且原因含留档位置', () => {
    const dir = createTempDir()
    const filePath = join(dir, 'mcp.json')
    const otherPath = join(dir, 'other.json')
    writeFileSync(filePath, '{ 半截', 'utf-8')
    const registry = createDegradedConfigRegistry()

    const reason = degradeCorruptConfig(registry, {
      filePath,
      label: '测试配置',
      error: new Error('parse failed'),
    })

    expect(registry.isDegraded(filePath)).toBe(true)
    expect(registry.getDegradedReason(filePath)).toBe(reason)
    expect(reason).toContain('测试配置读取失败')
    expect(reason).toContain('.corrupt-')
    // 登记是按路径隔离的，不会波及其他配置文件
    expect(registry.isDegraded(otherPath)).toBe(false)
  })

  test('Given 留档后文件已重建，When 再次查询，Then 降级标记保持粘性', () => {
    const dir = createTempDir()
    const filePath = join(dir, 'sessions.json')
    writeFileSync(filePath, 'broken', 'utf-8')
    const registry = createDegradedConfigRegistry()

    degradeCorruptConfig(registry, { filePath, label: '会话索引', error: new Error('boom') })
    writeFileSync(filePath, '{"version":1,"sessions":[]}', 'utf-8')

    expect(registry.isDegraded(filePath)).toBe(true)
  })

  test('Given 同步临界区，When 嵌套进入，Then 抛出重入错误且锁正常释放', () => {
    const mutex = createConfigMutex('test.json')

    expect(mutex.runExclusive(() => 42)).toBe(42)
    expect(() => mutex.runExclusive(() => mutex.runExclusive(() => 1)))
      .toThrow('配置写入临界区重入: test.json')
    // 上一次抛错后锁必须已释放，否则后续所有写入都会被永久堵死
    expect(mutex.runExclusive(() => 'ok')).toBe('ok')
  })

  test('Given 临界区内抛错，When 捕获后重试，Then 锁不会泄漏', () => {
    const mutex = createConfigMutex('retry.json')

    expect(() => mutex.runExclusive(() => { throw new Error('写入失败') })).toThrow('写入失败')
    expect(mutex.runExclusive(() => 'recovered')).toBe('recovered')
  })
})
