import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SessionMeta } from '@kila/shared'
import { bootstrapUnifiedSessions, createSession, listSessions } from './session-manager'

const tempDirs: string[] = []
const originalConfigDir = process.env.KILA_CONFIG_DIR

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
  if (typeof originalConfigDir === 'string') {
    process.env.KILA_CONFIG_DIR = originalConfigDir
  } else {
    delete process.env.KILA_CONFIG_DIR
  }
})

function createConfigDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kila-session-bootstrap-test-'))
  tempDirs.push(dir)
  process.env.KILA_CONFIG_DIR = dir
  return dir
}

function sessionMeta(id: string): SessionMeta {
  return {
    id,
    title: `会话 ${id}`,
    project: { path: '/repo', name: 'repo', source: 'user', profileId: 'profile-test' },
    createdAt: 1,
    updatedAt: 1,
  }
}

/** 写入一份「老用户」的统一 Session 数据 */
function writeExistingSessionData(configDir: string, id = 'session-old'): string {
  const indexPath = join(configDir, 'sessions.json')
  writeFileSync(indexPath, JSON.stringify({ version: 1, sessions: [sessionMeta(id)] }, null, 2), 'utf-8')
  const sessionsDir = join(configDir, 'sessions')
  mkdirSync(sessionsDir, { recursive: true })
  writeFileSync(join(sessionsDir, `${id}.jsonl`), '{"id":"m1","role":"user","content":"hi","createdAt":1}\n', 'utf-8')
  return indexPath
}

/** 写入一个遗留目录，用来观察首装清理是否真的执行 */
function writeLegacyWorkspace(configDir: string): string {
  const legacyPath = join(configDir, 'agent-workspaces', 'legacy')
  mkdirSync(legacyPath, { recursive: true })
  writeFileSync(join(legacyPath, 'marker.txt'), 'legacy', 'utf-8')
  return legacyPath
}

describe('统一 Session 首次引导护栏', () => {
  test('Given 设置文件损坏且已有会话数据，When 执行引导，Then 跳过清理且不改写标志', () => {
    const configDir = createConfigDir()
    const settingsPath = join(configDir, 'settings.json')
    writeFileSync(settingsPath, '{ 设置坏了', 'utf-8')
    writeFileSync(`${settingsPath}.bak`, '{ 备份也坏了', 'utf-8')
    const indexPath = writeExistingSessionData(configDir)
    const legacyPath = writeLegacyWorkspace(configDir)

    bootstrapUnifiedSessions()

    // bootstrapped 标志来自不可信的默认值，绝不能据此删任何东西
    expect(existsSync(indexPath)).toBe(true)
    expect(readdirSync(join(configDir, 'sessions'))).toHaveLength(1)
    expect(existsSync(legacyPath)).toBe(true)
    expect(existsSync(settingsPath)).toBe(false)
  })

  test('Given 索引已存在但引导标志为 false，When 执行引导，Then 跳过清理并补齐标志', () => {
    const configDir = createConfigDir()
    const settingsPath = join(configDir, 'settings.json')
    writeFileSync(settingsPath, JSON.stringify({
      themeMode: 'system',
      unifiedSessionsBootstrapped: false,
      sessionProjectModelBootstrapped: false,
    }), 'utf-8')
    const indexPath = writeExistingSessionData(configDir)
    const legacyPath = writeLegacyWorkspace(configDir)

    bootstrapUnifiedSessions()

    expect(existsSync(indexPath)).toBe(true)
    expect(JSON.parse(readFileSync(indexPath, 'utf-8')).sessions).toHaveLength(1)
    expect(existsSync(legacyPath)).toBe(true)
    expect(JSON.parse(readFileSync(settingsPath, 'utf-8'))).toMatchObject({
      unifiedSessionsBootstrapped: true,
      sessionProjectModelBootstrapped: true,
    })
  })

  test('Given 索引丢失但 sessions 目录非空，When 执行引导，Then 仍按老用户处理不清理消息', () => {
    const configDir = createConfigDir()
    const sessionsDir = join(configDir, 'sessions')
    mkdirSync(sessionsDir, { recursive: true })
    writeFileSync(join(sessionsDir, 'orphan.jsonl'), '{"id":"m1"}\n', 'utf-8')

    bootstrapUnifiedSessions()

    expect(existsSync(join(sessionsDir, 'orphan.jsonl'))).toBe(true)
    expect(JSON.parse(readFileSync(join(configDir, 'settings.json'), 'utf-8'))).toMatchObject({
      unifiedSessionsBootstrapped: true,
    })
  })

  test('Given 确认首装且存在遗留目录，When 执行引导，Then 清理遗留数据并标记已引导', () => {
    const configDir = createConfigDir()
    const legacyPath = writeLegacyWorkspace(configDir)

    bootstrapUnifiedSessions()

    expect(existsSync(legacyPath)).toBe(false)
    expect(JSON.parse(readFileSync(join(configDir, 'settings.json'), 'utf-8'))).toMatchObject({
      unifiedSessionsBootstrapped: true,
      sessionProjectModelBootstrapped: true,
    })
  })

  test('Given 引导标志已置位，When 再次执行引导，Then 直接返回不触碰任何文件', () => {
    const configDir = createConfigDir()
    writeFileSync(join(configDir, 'settings.json'), JSON.stringify({
      unifiedSessionsBootstrapped: true,
      sessionProjectModelBootstrapped: true,
    }), 'utf-8')
    const legacyPath = writeLegacyWorkspace(configDir)

    bootstrapUnifiedSessions()

    expect(existsSync(legacyPath)).toBe(true)
  })
})

describe('会话索引降级只读', () => {
  test('Given 索引主备双双损坏，When 读取，Then 留档损坏文件并返回空列表', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'kila-session-index-test-'))
    tempDirs.push(rootDir)
    process.env.KILA_CONFIG_DIR = join(rootDir, 'config')
    const indexPath = join(rootDir, 'sessions.json')
    const deps = { paths: { indexPath, sessionsDir: join(rootDir, 'sessions') } }

    createSession({ title: '会话甲', projectPath: join(rootDir, 'project') }, deps)
    writeFileSync(indexPath, '{ 主索引坏了', 'utf-8')
    writeFileSync(`${indexPath}.bak`, '{ 备份也坏了', 'utf-8')

    expect(listSessions(deps)).toEqual([])
    expect(existsSync(indexPath)).toBe(false)
    expect(readdirSync(rootDir).filter((name) => name.includes('sessions.json.corrupt-'))).toHaveLength(2)
  })

  test('Given 索引进入降级只读，When 再次创建会话，Then 拒绝写入且不生成新索引', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'kila-session-index-test-'))
    tempDirs.push(rootDir)
    process.env.KILA_CONFIG_DIR = join(rootDir, 'config')
    const indexPath = join(rootDir, 'sessions.json')
    const deps = { paths: { indexPath, sessionsDir: join(rootDir, 'sessions') } }

    createSession({ title: '会话甲', projectPath: join(rootDir, 'project') }, deps)
    writeFileSync(indexPath, '{ 坏', 'utf-8')
    writeFileSync(`${indexPath}.bak`, '{ 坏', 'utf-8')
    listSessions(deps)

    // 空列表写回会连同 .bak 一起销毁唯一恢复源，必须显式失败而不是静默成功
    expect(() => createSession({ title: '会话乙', projectPath: join(rootDir, 'project') }, deps))
      .toThrow(/降级只读/)
    expect(existsSync(indexPath)).toBe(false)
  })

  test('Given 索引缺失但目录可用，When 创建会话，Then 按首次运行正常写入', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'kila-session-index-test-'))
    tempDirs.push(rootDir)
    process.env.KILA_CONFIG_DIR = join(rootDir, 'config')
    const indexPath = join(rootDir, 'sessions.json')
    const deps = { paths: { indexPath, sessionsDir: join(rootDir, 'sessions') } }

    const created = createSession({ title: '首次会话', projectPath: join(rootDir, 'project') }, deps)

    expect(listSessions(deps)).toHaveLength(1)
    expect(existsSync(`${indexPath}.bak`)).toBe(true)
    expect(JSON.parse(readFileSync(indexPath, 'utf-8')).sessions[0].id).toBe(created.id)
  })
})
