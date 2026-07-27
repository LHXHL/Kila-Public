import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChannelCreateInput, ChannelsConfig } from '@kila/shared'
import { createChannel, deleteChannel, listChannels, updateChannel } from './channel-manager'

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
  const dir = mkdtempSync(join(tmpdir(), 'kila-channel-test-'))
  tempDirs.push(dir)
  process.env.KILA_CONFIG_DIR = dir
  return dir
}

function channelInput(name: string): ChannelCreateInput {
  return {
    name,
    provider: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    apiKey: `secret-${name}`,
    models: [{ id: 'claude-x', name: 'Claude X', enabled: true }],
    enabled: true,
  }
}

function readChannelsFile(configDir: string): ChannelsConfig {
  return JSON.parse(readFileSync(join(configDir, 'channels.json'), 'utf-8')) as ChannelsConfig
}

describe('渠道配置持久化护栏', () => {
  test('Given 新建渠道，When 写入配置，Then 原子落盘并同步生成备份', () => {
    const configDir = createConfigDir()
    const configPath = join(configDir, 'channels.json')

    const created = createChannel(channelInput('渠道甲'))

    expect(existsSync(`${configPath}.bak`)).toBe(true)
    expect(readFileSync(`${configPath}.bak`, 'utf-8')).toBe(readFileSync(configPath, 'utf-8'))
    expect(readChannelsFile(configDir).channels).toHaveLength(1)
    expect(readChannelsFile(configDir).channels[0]!.id).toBe(created.id)
    expect(readdirSync(configDir).filter((name) => name.endsWith('.tmp'))).toHaveLength(0)
  })

  test('Given 主文件损坏但备份有效，When 读取渠道，Then 从备份恢复且不丢加密凭证', () => {
    const configDir = createConfigDir()
    const configPath = join(configDir, 'channels.json')
    const created = createChannel(channelInput('渠道甲'))
    writeFileSync(configPath, '{ 写到一半断电了', 'utf-8')

    const channels = listChannels()

    expect(channels).toHaveLength(1)
    expect(channels[0]!.id).toBe(created.id)
    expect(channels[0]!.apiKey).toBe(created.apiKey)
    expect(readChannelsFile(configDir).channels).toHaveLength(1)
  })

  test('Given 主备双双损坏，When 读取渠道，Then 留档损坏文件并返回空列表', () => {
    const configDir = createConfigDir()
    const configPath = join(configDir, 'channels.json')
    createChannel(channelInput('渠道甲'))
    writeFileSync(configPath, '{ 主文件坏了', 'utf-8')
    writeFileSync(`${configPath}.bak`, '{ 备份也坏了', 'utf-8')

    expect(listChannels()).toEqual([])
    expect(existsSync(configPath)).toBe(false)
    expect(readdirSync(configDir).filter((name) => name.includes('channels.json.corrupt-'))).toHaveLength(2)
  })

  test('Given 渠道配置进入降级只读，When 继续增删改，Then 一律拒绝写入而不是用空列表覆盖', () => {
    const configDir = createConfigDir()
    const configPath = join(configDir, 'channels.json')
    const created = createChannel(channelInput('渠道甲'))
    writeFileSync(configPath, '坏', 'utf-8')
    writeFileSync(`${configPath}.bak`, '坏', 'utf-8')
    listChannels()

    expect(() => createChannel(channelInput('渠道乙'))).toThrow(/降级只读/)
    expect(() => updateChannel(created.id, { name: '改名' })).toThrow(/渠道不存在/)
    expect(() => deleteChannel(created.id)).toThrow(/渠道不存在/)
    // 关键：磁盘上不能出现被空列表覆盖的 channels.json
    expect(existsSync(configPath)).toBe(false)
    expect(existsSync(`${configPath}.bak`)).toBe(false)
  })

  test('Given 结构非法的 channels.json，When 读取渠道，Then 视为损坏而不是静默空配置', () => {
    const configDir = createConfigDir()
    const configPath = join(configDir, 'channels.json')
    writeFileSync(configPath, JSON.stringify({ version: 1, channels: 'not-an-array' }), 'utf-8')

    expect(listChannels()).toEqual([])
    expect(readdirSync(configDir).filter((name) => name.includes('channels.json.corrupt-'))).toHaveLength(1)
    expect(() => createChannel(channelInput('渠道乙'))).toThrow(/降级只读/)
  })
})
