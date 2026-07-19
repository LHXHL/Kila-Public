/**
 * Agent 文件系统操作 IPC 处理器
 *
 * 文件浏览、预览、搜索、Web 预览
 */

import { shell, dialog, BrowserWindow } from 'electron'
import { readdirSync, rmSync, renameSync } from 'node:fs'
import { resolve, relative, basename, dirname, join } from 'node:path'
import { AGENT_IPC_CHANNELS } from '@kila/shared'
import type { FileEntry, FileSearchResult, SessionHtmlPreviewResolution, SessionWebPreviewServerInfo } from '@kila/shared'
import { handle, requireUnifiedSession, assertAgentFileAccess, isPathWithinSessionProject } from './shared'
import { ensureSessionWebPreviewServer, resolveSessionHtmlPreview, stopSessionWebPreviewServer } from '../lib/session-web-preview-manager'
import { assertNumber, assertString, assertStringArray } from './validation'


import { createLogger } from '../lib/logger'
const log = createLogger('Agent 文件')

export function registerAgentFileHandlers(): void {
  // 列出目录内容
  handle(
    AGENT_IPC_CHANNELS.LIST_DIRECTORY,
    async (_, dirPath: string): Promise<FileEntry[]> => {
      const safePath = assertAgentFileAccess(assertString(dirPath, 'dirPath', { nonEmpty: true, max: 4096 }))

      const entries: FileEntry[] = []
      const items = readdirSync(safePath, { withFileTypes: true })

      for (const item of items) {
        if (item.name.startsWith('.')) continue

        const fullPath = resolve(safePath, item.name)
        entries.push({
          name: item.name,
          path: fullPath,
          isDirectory: item.isDirectory(),
        })
      }

      entries.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
        return a.name.localeCompare(b.name)
      })

      return entries
    }
  )

  // 删除文件或目录
  handle(
    AGENT_IPC_CHANNELS.DELETE_FILE,
    async (_, filePath: string): Promise<void> => {
      const safePath = assertAgentFileAccess(assertString(filePath, 'filePath', { nonEmpty: true, max: 4096 }))
      rmSync(safePath, { recursive: true, force: true })
      log.info(`[Agent 文件] 已删除: ${safePath}`)
    }
  )

  // 用系统默认应用打开文件
  handle(
    AGENT_IPC_CHANNELS.OPEN_FILE,
    async (_, filePath: string): Promise<void> => {
      const safePath = assertAgentFileAccess(assertString(filePath, 'filePath', { nonEmpty: true, max: 4096 }))
      await shell.openPath(safePath)
    }
  )

  // 在系统文件管理器中显示文件
  handle(
    AGENT_IPC_CHANNELS.SHOW_IN_FOLDER,
    async (_, filePath: string): Promise<void> => {
      const safePath = assertAgentFileAccess(assertString(filePath, 'filePath', { nonEmpty: true, max: 4096 }))
      shell.showItemInFolder(safePath)
    }
  )

  // 在新窗口中预览文件
  handle(
    AGENT_IPC_CHANNELS.PREVIEW_FILE,
    async (_, filePath: string): Promise<void> => {
      const { openFilePreview } = await import('../lib/file-preview-service')
      const safePath = assertAgentFileAccess(assertString(filePath, 'filePath', { nonEmpty: true, max: 4096 }))
      openFilePreview(safePath)
    }
  )

  // 内联文件预览
  handle(
    AGENT_IPC_CHANNELS.READ_FILE_PREVIEW,
    async (_, filePath: string) => {
      const { readInlineFilePreview } = await import('../lib/inline-file-preview')
      const safePath = assertAgentFileAccess(assertString(filePath, 'filePath', { nonEmpty: true, max: 4096 }))
      return readInlineFilePreview(safePath)
    }
  )

  // 启动 Session Web 预览服务器
  handle(
    AGENT_IPC_CHANNELS.START_SESSION_WEB_PREVIEW_SERVER,
    async (_, sessionId: string): Promise<SessionWebPreviewServerInfo> => {
      const session = requireUnifiedSession(assertString(sessionId, 'sessionId', { nonEmpty: true, max: 128 }))
      return ensureSessionWebPreviewServer(sessionId, session.project.path)
    },
  )

  // 停止 Session Web 预览服务器
  handle(
    AGENT_IPC_CHANNELS.STOP_SESSION_WEB_PREVIEW_SERVER,
    async (_, sessionId: string): Promise<void> => {
      sessionId = assertString(sessionId, 'sessionId', { nonEmpty: true, max: 128 })
      requireUnifiedSession(sessionId)
      await stopSessionWebPreviewServer(sessionId)
    },
  )

  // 解析 Session HTML 预览
  handle(
    AGENT_IPC_CHANNELS.RESOLVE_SESSION_HTML_PREVIEW,
    async (_, sessionId: string, filePath: string): Promise<SessionHtmlPreviewResolution> => {
      const session = requireUnifiedSession(assertString(sessionId, 'sessionId', { nonEmpty: true, max: 128 }))
      const safePath = assertAgentFileAccess(assertString(filePath, 'filePath', { nonEmpty: true, max: 4096 }))

      if (!isPathWithinSessionProject(session.project.path, safePath)) {
        throw new Error('HTML 预览文件必须位于当前会话项目目录内')
      }

      return resolveSessionHtmlPreview(sessionId, session.project.path, safePath)
    },
  )

  // 重命名文件/目录
  handle(
    AGENT_IPC_CHANNELS.RENAME_FILE,
    async (_, filePath: string, newName: string): Promise<void> => {
      const safePath = assertAgentFileAccess(assertString(filePath, 'filePath', { nonEmpty: true, max: 4096 }))
      newName = assertString(newName, 'newName', { nonEmpty: true, max: 255 })

      if (!newName.trim() || basename(newName) !== newName) {
        throw new Error('文件名无效')
      }

      const newPath = assertAgentFileAccess(join(dirname(safePath), newName))
      renameSync(safePath, newPath)
      log.info(`[Agent 文件] 已重命名: ${safePath} → ${newPath}`)
    }
  )

  // 移动文件/目录
  handle(
    AGENT_IPC_CHANNELS.MOVE_FILE,
    async (_, filePath: string, targetDir: string): Promise<void> => {
      const safePath = assertAgentFileAccess(assertString(filePath, 'filePath', { nonEmpty: true, max: 4096 }))
      const safeTarget = assertAgentFileAccess(assertString(targetDir, 'targetDir', { nonEmpty: true, max: 4096 }))

      const newPath = join(safeTarget, basename(safePath))
      renameSync(safePath, newPath)
      log.info(`[Agent 文件] 已移动: ${safePath} → ${newPath}`)
    }
  )

  // 列出附加目录内容
  handle(
    AGENT_IPC_CHANNELS.LIST_ATTACHED_DIRECTORY,
    async (_, dirPath: string): Promise<FileEntry[]> => {
      const safePath = assertAgentFileAccess(assertString(dirPath, 'dirPath', { nonEmpty: true, max: 4096 }))
      const entries: FileEntry[] = []
      const items = readdirSync(safePath, { withFileTypes: true })

      for (const item of items) {
        if (item.name.startsWith('.')) continue
        const fullPath = resolve(safePath, item.name)
        entries.push({
          name: item.name,
          path: fullPath,
          isDirectory: item.isDirectory(),
        })
      }

      entries.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
        return a.name.localeCompare(b.name)
      })

      return entries
    }
  )

  // 打开附加目录文件
  handle(
    AGENT_IPC_CHANNELS.OPEN_ATTACHED_FILE,
    async (_, filePath: string): Promise<void> => {
      const safePath = assertAgentFileAccess(assertString(filePath, 'filePath', { nonEmpty: true, max: 4096 }))
      await shell.openPath(safePath)
    }
  )

  // 在文件管理器中显示附加目录文件
  handle(
    AGENT_IPC_CHANNELS.SHOW_ATTACHED_IN_FOLDER,
    async (_, filePath: string): Promise<void> => {
      const safePath = assertAgentFileAccess(assertString(filePath, 'filePath', { nonEmpty: true, max: 4096 }))
      shell.showItemInFolder(safePath)
    }
  )

  // 重命名附加目录文件
  handle(
    AGENT_IPC_CHANNELS.RENAME_ATTACHED_FILE,
    async (_, filePath: string, newName: string): Promise<void> => {
      const safePath = assertAgentFileAccess(assertString(filePath, 'filePath', { nonEmpty: true, max: 4096 }))
      newName = assertString(newName, 'newName', { nonEmpty: true, max: 255 })
      if (basename(newName) !== newName) {
        throw new Error('文件名无效')
      }
      const newPath = join(dirname(safePath), newName)
      assertAgentFileAccess(newPath)
      renameSync(safePath, newPath)
      log.info(`[附加目录] 已重命名: ${safePath} → ${newPath}`)
    }
  )

  // 移动附加目录文件
  handle(
    AGENT_IPC_CHANNELS.MOVE_ATTACHED_FILE,
    async (_, filePath: string, targetDir: string): Promise<void> => {
      const safePath = assertAgentFileAccess(assertString(filePath, 'filePath', { nonEmpty: true, max: 4096 }))
      const safeTarget = assertAgentFileAccess(assertString(targetDir, 'targetDir', { nonEmpty: true, max: 4096 }))
      const newPath = join(safeTarget, basename(safePath))
      renameSync(safePath, newPath)
      log.info(`[附加目录] 已移动: ${safePath} → ${newPath}`)
    }
  )

  // 搜索工作区文件
  handle(
    AGENT_IPC_CHANNELS.SEARCH_WORKSPACE_FILES,
    async (_, rootPath: string, query: string, limit = 20, additionalPaths?: string[]): Promise<FileSearchResult> => {
      const safeRoot = assertAgentFileAccess(assertString(rootPath, 'rootPath', { nonEmpty: true, max: 4096 }))
      query = assertString(query, 'query', { max: 256 })
      limit = assertNumber(limit, 'limit', { min: 1, max: 200, integer: true })
      const ignoreDirs = new Set(['node_modules', '.git', 'dist', '.next', '__pycache__', '.venv', 'build', '.cache'])

      const allEntries: Array<{ name: string; path: string; type: 'file' | 'dir' }> = []

      function scan(dir: string, depth: number, baseRoot: string): void {
        if (depth > 5) return
        try {
          const items = readdirSync(dir, { withFileTypes: true })
          for (const item of items) {
            if (item.name.startsWith('.')) continue
            if (item.isDirectory() && ignoreDirs.has(item.name)) continue

            const fullPath = resolve(dir, item.name)
            const relPath = relative(baseRoot, fullPath)
            allEntries.push({
              name: item.name,
              path: relPath,
              type: item.isDirectory() ? 'dir' : 'file',
            })

            if (item.isDirectory()) {
              scan(fullPath, depth + 1, baseRoot)
            }
          }
        } catch {
          // 忽略无权限的目录
        }
      }

      scan(safeRoot, 0, safeRoot)

      if (additionalPaths && additionalPaths.length > 0) {
        for (const addPath of assertStringArray(additionalPaths, 'additionalPaths', { maxItems: 50, maxItemLength: 4096 })) {
          const addRoot = assertAgentFileAccess(addPath)
          scan(addRoot, 0, addRoot)
        }
      }

      const q = query.toLowerCase()
      if (!q) {
        return { entries: allEntries.slice(0, limit), total: allEntries.length }
      }

      const matched = allEntries.filter((entry) => {
        const nameLower = entry.name.toLowerCase()
        const pathLower = entry.path.toLowerCase()
        if (nameLower.startsWith(q)) return true
        if (nameLower.includes(q) || pathLower.includes(q)) return true
        let qi = 0
        for (let i = 0; i < nameLower.length && qi < q.length; i++) {
          if (nameLower[i] === q[qi]) qi++
        }
        return qi === q.length
      })

      matched.sort((a, b) => {
        const aStartsWith = a.name.toLowerCase().startsWith(q) ? 0 : 1
        const bStartsWith = b.name.toLowerCase().startsWith(q) ? 0 : 1
        if (aStartsWith !== bStartsWith) return aStartsWith - bStartsWith
        if (a.type === 'dir' && b.type !== 'dir') return -1
        if (a.type !== 'dir' && b.type === 'dir') return 1
        return a.path.length - b.path.length
      })

      return { entries: matched.slice(0, limit), total: matched.length }
    }
  )

  // 打开文件夹选择对话框
  handle(
    AGENT_IPC_CHANNELS.OPEN_FOLDER_DIALOG,
    async (): Promise<{ path: string; name: string } | null> => {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      if (!win) return null

      const result = await dialog.showOpenDialog(win, {
        properties: ['openDirectory'],
        title: '选择文件夹',
      })

      if (result.canceled || result.filePaths.length === 0) return null

      const folderPath = result.filePaths[0]!
      const name = folderPath.split('/').filter(Boolean).pop() || 'folder'
      return { path: folderPath, name }
    }
  )
}
