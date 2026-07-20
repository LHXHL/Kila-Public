import { describe, expect, test } from 'bun:test'
import { formatGitPanelError } from './git-status-panel-state'

describe('Git 状态面板错误呈现', () => {
  test('Given Electron IPC 包装错误，When 格式化，Then 仅保留可读原因', () => {
    const error = new Error("Error invoking remote method 'git:get-changes': Error: 项目目录不存在")

    expect(formatGitPanelError(error)).toBe('项目目录不存在')
  })

  test('Given Git 在操作期间变为非仓库，When 格式化，Then 返回可操作提示', () => {
    expect(formatGitPanelError('fatal: not a git repository (or any of the parent directories): .git'))
      .toBe('当前目录不是 Git 仓库，请重新检测或初始化仓库。')
  })

  test('Given 空错误，When 格式化，Then 返回稳定的用户提示', () => {
    expect(formatGitPanelError('')).toBe('读取 Git 状态失败，请稍后重试。')
  })
})
