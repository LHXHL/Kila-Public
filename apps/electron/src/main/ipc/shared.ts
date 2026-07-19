/**
 * IPC 共享辅助模块
 *
 * 提供所有 IPC 子模块共用的类型安全 handle 包装、路径校验和 session 查找。
 */

import { app, BrowserWindow, ipcMain } from 'electron'
import { relative, sep } from 'node:path'
import { typedHandle } from '@kila/shared'
import type { IpcContractChannel, IpcArgs, IpcResult } from '@kila/shared'
import { getSessionMeta as getUnifiedSessionMeta, listSessions as listUnifiedSessions } from '../lib/session-manager'
import {
  getAgentWorkspacesDir,
  getGlobalSkillLibraryBrowseRoots,
  getImBridgeSessionFilesDir,
  getProjectProfilePath,
} from '../lib/config-paths'
import { assertPathWithinAllowedRoots, buildFileAccessRoots } from '../lib/file-access-policy'
import { assertSafeIpcPayload, isTrustedRendererUrl } from '../lib/ipc-sender-policy'

/**
 * 类型安全的 IPC handler 注册
 *
 * 基于 IpcContract 推导 args/result 类型，编译时自动检查契约一致性。
 */
export function assertTrustedRenderer(event: Electron.IpcMainInvokeEvent): void {
  const owner = BrowserWindow.fromWebContents(event.sender)
  const senderFrame = event.senderFrame
  if (!owner || owner.isDestroyed() || owner.webContents !== event.sender) {
    throw new Error('拒绝非应用窗口的 IPC 调用')
  }
  if (!senderFrame || senderFrame !== event.sender.mainFrame) {
    throw new Error('拒绝子 Frame 或 WebView 的 IPC 调用')
  }
  if (!isTrustedRendererUrl(senderFrame.url, app.isPackaged)) {
    throw new Error('拒绝非 Kila Renderer 的 IPC 调用')
  }
}

export function handle<K extends IpcContractChannel>(
  channel: K,
  handler: (event: Electron.IpcMainInvokeEvent, ...args: IpcArgs<K>) => Promise<IpcResult<K>>
): void {
  typedHandle(ipcMain, channel, async (event, ...args) => {
    assertTrustedRenderer(event)
    assertSafeIpcPayload(args)
    return handler(event, ...args)
  })
}

/** 为尚未进入共享 IpcContract 的通道提供同等 sender 与资源预算保护。 */
export function handleUntyped<TArgs extends unknown[], TResult>(
  channel: string,
  handler: (event: Electron.IpcMainInvokeEvent, ...args: TArgs) => TResult | Promise<TResult>,
): void {
  ipcMain.handle(channel, async (event, ...args: TArgs) => {
    assertTrustedRenderer(event)
    assertSafeIpcPayload(args)
    return handler(event, ...args)
  })
}

/**
 * 要求 session 存在，否则抛出错误
 */
export function requireUnifiedSession(sessionId: string) {
  const session = getUnifiedSessionMeta(sessionId)
  if (!session) {
    throw new Error(`Session 不存在: ${sessionId}`)
  }
  return session
}

/**
 * 构建 Agent 文件访问根路径列表
 */
export function getAgentFileAccessRoots(): string[] {
  return buildFileAccessRoots({
    legacyWorkspaceRoot: getAgentWorkspacesDir(),
    sessions: listUnifiedSessions(),
    resolveSessionExtraRoots: (session) => {
      const profileId = session.project.profileId?.trim()
      return [
        profileId ? getProjectProfilePath(profileId) : null,
        getImBridgeSessionFilesDir(session.id),
      ]
    },
  })
}

/**
 * 校验路径在 Agent 工作区范围内
 */
export function assertAgentFileAccess(targetPath: string): string {
  return assertPathWithinAllowedRoots(
    targetPath,
    getAgentFileAccessRoots(),
    '访问路径超出 Agent 工作区范围',
  )
}

/**
 * 判断目标路径是否在 session 项目目录内
 */
export function isPathWithinSessionProject(projectPath: string, targetPath: string): boolean {
  const rel = relative(projectPath, targetPath)
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(`..${sep}`))
}

/**
 * 校验路径在全局 Agent 配置范围内
 */
export function assertGlobalAgentPathAccess(targetPath: string): string {
  return assertPathWithinAllowedRoots(
    targetPath,
    getGlobalSkillLibraryBrowseRoots(),
    '访问路径超出全局能力库范围',
  )
}
