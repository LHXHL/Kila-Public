/**
 * cua-driver Windows launch_app 参数预检回归测试
 *
 * 这段逻辑是从 mcp-server-manager 里原样抽出的，测试用于锁住抽取前后的行为一致。
 */

import { describe, expect, test } from 'bun:test'
import {
  matchesCuaWindowsApp,
  prepareCuaWindowsLaunchArgs,
  shouldPrepareCuaWindowsLaunch,
} from './mcp-cua-windows-args'

const listAppsResult = {
  structuredContent: {
    apps: [
      { name: 'Notepad', path: 'C:\\Windows\\notepad.exe' },
      { name: 'Calculator', aumid: 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App' },
    ],
  },
}

const callTool = async () => listAppsResult

describe('Windows launch 预检触发条件', () => {
  test('Given 非 cua-driver 服务器 When 判断 Then 不触发预检', () => {
    expect(shouldPrepareCuaWindowsLaunch('filesystem', 'launch_app')).toBe(false)
  })

  test('Given 非 launch_app 工具 When 判断 Then 不触发预检', () => {
    expect(shouldPrepareCuaWindowsLaunch('cua-driver', 'screenshot')).toBe(false)
  })
})

describe('Windows launch 参数纠正', () => {
  test('Given bundle_id 实际是 Windows 路径 When 预检 Then 改写为 path', async () => {
    const result = await prepareCuaWindowsLaunchArgs(
      { bundle_id: 'C:\\Windows\\notepad.exe' },
      callTool,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.args.bundle_id).toBeUndefined()
    expect(result.args.path).toBe('C:\\Windows\\notepad.exe')
  })

  test('Given 已给出 aumid When 预检 Then 直接放行', async () => {
    const result = await prepareCuaWindowsLaunchArgs(
      { aumid: 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App' },
      callTool,
    )

    expect(result.ok).toBe(true)
  })

  test('Given 只给了能在 list_apps 中匹配到的名称 When 预检 Then 放行', async () => {
    const result = await prepareCuaWindowsLaunchArgs({ name: 'Notepad' }, callTool)

    expect(result.ok).toBe(true)
  })

  test('Given 传入 macOS bundle id When 预检 Then 拦下并提示改用 Windows 标识', async () => {
    const result = await prepareCuaWindowsLaunchArgs({ bundle_id: 'com.apple.Safari' }, callTool)

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('was not found')
  })

  test('Given list_apps 查询失败 When 预检 Then 拦下并要求先调用 list_apps', async () => {
    const result = await prepareCuaWindowsLaunchArgs({ name: 'Whatever' }, async () => {
      throw new Error('服务器不可用')
    })

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('list_apps')
  })
})

describe('Windows 应用标识匹配', () => {
  test('Given 用可执行文件名匹配完整路径 When 比对 Then 命中', () => {
    expect(matchesCuaWindowsApp(
      [{ path: 'C:\\Windows\\notepad.exe' }],
      'notepad.exe',
    )).toBe(true)
  })

  test('Given 完全不相关的标识 When 比对 Then 不命中', () => {
    expect(matchesCuaWindowsApp([{ name: 'Notepad' }], 'com.apple.Safari')).toBe(false)
  })
})
