/**
 * window-state — 窗口位置/大小持久化
 *
 * 在窗口 resize / move 时节流写入 JSON，
 * 下次启动时恢复上次窗口的 bounds 和 isMaximized 状态。
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { app } from 'electron'

interface WindowState {
  x: number
  y: number
  width: number
  height: number
  isMaximized: boolean
}

const DEFAULT_STATE: WindowState = {
  x: 0,
  y: 0,
  width: 1400,
  height: 900,
  isMaximized: true,
}

function getStatePath(): string {
  return join(app.getPath('userData'), 'window-state.json')
}

export function loadWindowState(): WindowState {
  const statePath = getStatePath()
  try {
    if (existsSync(statePath)) {
      const raw = readFileSync(statePath, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<WindowState>
      return {
        x: typeof parsed.x === 'number' ? parsed.x : DEFAULT_STATE.x,
        y: typeof parsed.y === 'number' ? parsed.y : DEFAULT_STATE.y,
        width: typeof parsed.width === 'number' && parsed.width >= 400 ? parsed.width : DEFAULT_STATE.width,
        height: typeof parsed.height === 'number' && parsed.height >= 300 ? parsed.height : DEFAULT_STATE.height,
        isMaximized: typeof parsed.isMaximized === 'boolean' ? parsed.isMaximized : DEFAULT_STATE.isMaximized,
      }
    }
  } catch {
    // 文件损坏或不存在，使用默认值
  }
  return { ...DEFAULT_STATE }
}

export function saveWindowState(state: WindowState): void {
  const statePath = getStatePath()
  try {
    const dir = dirname(statePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8')
  } catch (error) {
    console.error('[窗口状态] 保存失败:', error)
  }
}
