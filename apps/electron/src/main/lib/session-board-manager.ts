import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { PinSessionWidgetInput, SessionPinnedWidget } from '@kila/shared'
import { getConfigDir } from './config-paths'


import { createLogger } from './logger'
const log = createLogger('SessionBoard')

interface SessionBoardFile {
  widgets: SessionPinnedWidget[]
}

function getSessionBoardsDir(): string {
  const dir = join(getConfigDir(), 'session-boards')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

function getSessionBoardPath(sessionId: string): string {
  return join(getSessionBoardsDir(), `${sessionId}.json`)
}

function readSessionBoard(sessionId: string): SessionPinnedWidget[] {
  const filePath = getSessionBoardPath(sessionId)
  if (!existsSync(filePath)) return []

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as SessionBoardFile | SessionPinnedWidget[]
    const widgets = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.widgets)
        ? parsed.widgets
        : []
    return widgets.sort((a, b) => b.createdAt - a.createdAt)
  } catch (error) {
    log.error('[SessionBoard] 读取 sidecar 失败:', error)
    return []
  }
}

function writeSessionBoard(sessionId: string, widgets: SessionPinnedWidget[]): void {
  const filePath = getSessionBoardPath(sessionId)
  if (widgets.length === 0) {
    if (existsSync(filePath)) {
      unlinkSync(filePath)
    }
    return
  }

  writeFileSync(filePath, JSON.stringify({ widgets }, null, 2), 'utf-8')
}

export function listSessionPinnedWidgets(sessionId: string): SessionPinnedWidget[] {
  return readSessionBoard(sessionId)
}

export function pinSessionWidget(input: PinSessionWidgetInput): SessionPinnedWidget {
  const widgets = readSessionBoard(input.sessionId)
  const now = Date.now()
  const existingIndex = widgets.findIndex((widget) => (
    widget.sourceMessageId === input.sourceMessageId
    && widget.sourceBlockKey === input.sourceBlockKey
  ))

  if (existingIndex >= 0) {
    const existing = widgets[existingIndex]!
    const updated: SessionPinnedWidget = {
      ...existing,
      title: input.title,
      payload: input.payload,
      updatedAt: now,
    }
    widgets[existingIndex] = updated
    writeSessionBoard(input.sessionId, widgets)
    return updated
  }

  const created: SessionPinnedWidget = {
    id: randomUUID(),
    sessionId: input.sessionId,
    sourceMessageId: input.sourceMessageId,
    sourceBlockKey: input.sourceBlockKey,
    title: input.title,
    payload: input.payload,
    createdAt: now,
    updatedAt: now,
  }

  writeSessionBoard(input.sessionId, [created, ...widgets])
  return created
}

export function unpinSessionWidget(sessionId: string, pinId: string): void {
  const widgets = readSessionBoard(sessionId)
  const nextWidgets = widgets.filter((widget) => widget.id !== pinId)
  writeSessionBoard(sessionId, nextWidgets)
}

export function cleanupSessionBoard(sessionId: string): void {
  const filePath = getSessionBoardPath(sessionId)
  if (existsSync(filePath)) {
    unlinkSync(filePath)
  }
}
