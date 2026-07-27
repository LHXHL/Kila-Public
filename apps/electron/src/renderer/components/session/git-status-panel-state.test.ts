import { describe, expect, test } from 'bun:test'
import { formatGitPanelError } from './git-status-panel-state'

/** 测试用翻译器：原样回显 key，便于断言映射到了哪条文案 */
const echoKey = (key: string): string => key

describe('Git 状态面板错误呈现', () => {
  test('Given Electron IPC 包装错误，When 格式化，Then 仅保留可读原因', () => {
    const error = new Error("Error invoking remote method 'git:get-changes': Error: 项目目录不存在")

    expect(formatGitPanelError(error, echoKey)).toBe('项目目录不存在')
  })

  test('Given Git 在操作期间变为非仓库，When 格式化，Then 返回可操作提示', () => {
    expect(formatGitPanelError('fatal: not a git repository (or any of the parent directories): .git', echoKey))
      .toBe('session.git.error.notRepository')
  })

  test('Given 空错误，When 格式化，Then 返回稳定的用户提示', () => {
    expect(formatGitPanelError('', echoKey)).toBe('session.git.error.readFailed')
  })

  test('Given 缺失 Git 可执行文件，When 格式化，Then 提示安装 Git', () => {
    expect(formatGitPanelError('spawn git ENOENT', echoKey)).toBe('session.git.error.gitNotFound')
  })
})
