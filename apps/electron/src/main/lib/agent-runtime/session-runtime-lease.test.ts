import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acquireSessionRuntimeLease, readSessionRuntimeLock, reclaimStaleSessionRuntimeLease } from './session-runtime-lease'
import { getPiSessionRuntimeLockPath, getPiSessionDir } from '../config-paths'

const originalConfigDir = process.env.KILA_CONFIG_DIR
const createdDirs: string[] = []

afterEach(() => {
  if (originalConfigDir === undefined) delete process.env.KILA_CONFIG_DIR
  else process.env.KILA_CONFIG_DIR = originalConfigDir
  for (const dir of createdDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('Pi sidecar runtime lease', () => {
  test('Given 同一 Session 没有 lock When acquire 两次 Then 第二次被拒绝且第一次可释放', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'kila-runtime-lease-'))
    createdDirs.push(configDir)
    process.env.KILA_CONFIG_DIR = configDir
    const metadata = {
      pid: 100,
      parentPid: 10,
      processStartTime: 123,
      appBootId: 'app-1',
      bootId: 'boot-1',
      generation: 0,
    }
    const lease = acquireSessionRuntimeLease('session-1', metadata)
    expect(readSessionRuntimeLock('session-1')).toEqual(metadata)
    expect(() => acquireSessionRuntimeLease('session-1', metadata)).toThrow('runtime_sidecar_locked')

    lease.release()
    expect(readSessionRuntimeLock('session-1')).toBeUndefined()
  })

  test('Given lock 内容损坏 When读取 Then 不能猜测为 stale', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'kila-runtime-lease-corrupt-'))
    createdDirs.push(configDir)
    process.env.KILA_CONFIG_DIR = configDir
    getPiSessionDir('session-1')
    writeFileSync(getPiSessionRuntimeLockPath('session-1'), '{}')

    expect(() => readSessionRuntimeLock('session-1')).toThrow('runtime_sidecar_locked')
  })

  test('Given owner PID 已退出 When reclaim stale lock Then 只删除可证明失效的 lock', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'kila-runtime-lease-stale-'))
    createdDirs.push(configDir)
    process.env.KILA_CONFIG_DIR = configDir
    getPiSessionDir('session-1')
    writeFileSync(getPiSessionRuntimeLockPath('session-1'), JSON.stringify({
      pid: 2_147_483_647,
      parentPid: 1,
      processStartTime: 123,
      appBootId: 'app-1',
      bootId: 'boot-1',
      generation: 0,
    }))

    expect(reclaimStaleSessionRuntimeLease('session-1')).toBe(true)
    expect(readSessionRuntimeLock('session-1')).toBeUndefined()
  })

  test('Given PID 仍存活且启动时间与父进程一致 When reclaim stale lock Then 保持锁不动', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'kila-runtime-lease-live-'))
    createdDirs.push(configDir)
    process.env.KILA_CONFIG_DIR = configDir
    getPiSessionDir('session-1')
    const metadata = {
      pid: process.pid,
      parentPid: process.ppid,
      processStartTime: 123,
      appBootId: 'app-1',
      bootId: 'boot-1',
      generation: 0,
    }
    writeFileSync(getPiSessionRuntimeLockPath('session-1'), JSON.stringify(metadata))

    expect(reclaimStaleSessionRuntimeLease('session-1', {
      readProcessIdentity: () => ({
        pid: process.pid,
        parentPid: process.ppid,
        processStartTime: 123,
      }),
    })).toBe(false)
    expect(readSessionRuntimeLock('session-1')).toEqual(metadata)
  })

  test('Given PID 被复用且启动时间不同 When reclaim stale lock Then 只回收旧锁', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'kila-runtime-lease-reused-'))
    createdDirs.push(configDir)
    process.env.KILA_CONFIG_DIR = configDir
    getPiSessionDir('session-1')
    writeFileSync(getPiSessionRuntimeLockPath('session-1'), JSON.stringify({
      pid: process.pid,
      parentPid: process.ppid,
      processStartTime: 123,
      appBootId: 'app-1',
      bootId: 'boot-1',
      generation: 0,
    }))

    expect(reclaimStaleSessionRuntimeLease('session-1', {
      readProcessIdentity: () => ({
        pid: process.pid,
        parentPid: process.ppid,
        processStartTime: 999_999,
      }),
    })).toBe(true)
    expect(readSessionRuntimeLock('session-1')).toBeUndefined()
  })

  test('Given PID 与启动时间一致但父进程变化 When reclaim stale lock Then 不回收活锁', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'kila-runtime-lease-parent-'))
    createdDirs.push(configDir)
    process.env.KILA_CONFIG_DIR = configDir
    getPiSessionDir('session-1')
    writeFileSync(getPiSessionRuntimeLockPath('session-1'), JSON.stringify({
      pid: process.pid,
      parentPid: 123,
      processStartTime: 123,
      appBootId: 'app-1',
      bootId: 'boot-1',
      generation: 0,
    }))

    expect(reclaimStaleSessionRuntimeLease('session-1', {
      readProcessIdentity: () => ({
        pid: process.pid,
        parentPid: 456,
        processStartTime: 123,
      }),
    })).toBe(false)
    expect(readSessionRuntimeLock('session-1')).toBeDefined()
  })

  test('Given PID 存活但无法读取启动身份 When reclaim stale lock Then fail-closed 保持锁', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'kila-runtime-lease-unknown-'))
    createdDirs.push(configDir)
    process.env.KILA_CONFIG_DIR = configDir
    getPiSessionDir('session-1')
    writeFileSync(getPiSessionRuntimeLockPath('session-1'), JSON.stringify({
      pid: process.pid,
      parentPid: process.ppid,
      processStartTime: 123,
      appBootId: 'app-1',
      bootId: 'boot-1',
      generation: 0,
    }))

    expect(reclaimStaleSessionRuntimeLease('session-1', {
      readProcessIdentity: () => undefined,
    })).toBe(false)
    expect(readSessionRuntimeLock('session-1')).toBeDefined()
  })
})
