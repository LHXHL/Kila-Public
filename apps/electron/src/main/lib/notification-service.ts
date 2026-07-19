import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type {
  CreateKilaNotificationInput,
  KilaNotificationCategory,
  KilaNotificationRecord,
  ListKilaNotificationsInput,
} from '@kila/shared'
import { getNotificationsPath } from './config-paths'
import { appendTextDurably } from './safe-json-file'
import { getSettings } from './settings-service'

const MAX_NOTIFICATIONS = 500

type NotificationLogEntry =
  | ({ op: 'create' } & KilaNotificationRecord)
  | { op: 'mark-read'; id: string; readAt: number }
  | { op: 'mark-all-read'; readAt: number }
  | { op: 'clear'; clearedAt: number }

function createNotificationId(): string {
  return crypto.randomUUID()
}

function normalizeCategory(value: unknown): KilaNotificationCategory {
  if (value === 'agent' || value === 'permission' || value === 'system' || value === 'usage' || value === 'update' || value === 'bridge') {
    return value
  }
  return 'system'
}

function isCategoryEnabled(category: KilaNotificationCategory): boolean {
  return getSettings().notificationPreferences?.[category]?.enabled ?? true
}

function parseLogEntry(line: string): NotificationLogEntry | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  try {
    const parsed = JSON.parse(trimmed) as Partial<NotificationLogEntry>
    if (parsed.op === 'mark-read' && typeof parsed.id === 'string') {
      return { op: 'mark-read', id: parsed.id, readAt: typeof parsed.readAt === 'number' ? parsed.readAt : Date.now() }
    }
    if (parsed.op === 'mark-all-read') {
      return { op: 'mark-all-read', readAt: typeof parsed.readAt === 'number' ? parsed.readAt : Date.now() }
    }
    if (parsed.op === 'clear') {
      return { op: 'clear', clearedAt: typeof parsed.clearedAt === 'number' ? parsed.clearedAt : Date.now() }
    }
    if (parsed.op !== 'create' || typeof parsed.id !== 'string' || typeof parsed.title !== 'string') {
      return null
    }

    return {
      op: 'create',
      id: parsed.id,
      title: parsed.title,
      body: typeof parsed.body === 'string' ? parsed.body : undefined,
      level: parsed.level === 'success' || parsed.level === 'warning' || parsed.level === 'error' ? parsed.level : 'info',
      category: normalizeCategory(parsed.category),
      sessionId: typeof parsed.sessionId === 'string' ? parsed.sessionId : undefined,
      createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : Date.now(),
      readAt: typeof parsed.readAt === 'number' ? parsed.readAt : undefined,
    }
  } catch {
    return null
  }
}

function readNotificationLog(): NotificationLogEntry[] {
  const path = getNotificationsPath()
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf-8')
    .split('\n')
    .map(parseLogEntry)
    .filter((entry): entry is NotificationLogEntry => Boolean(entry))
}

function materializeNotifications(): KilaNotificationRecord[] {
  const records = new Map<string, KilaNotificationRecord>()

  for (const entry of readNotificationLog()) {
    if (entry.op === 'clear') {
      records.clear()
      continue
    }
    if (entry.op === 'mark-all-read') {
      for (const [id, record] of records) {
        records.set(id, { ...record, readAt: record.readAt ?? entry.readAt })
      }
      continue
    }
    if (entry.op === 'mark-read') {
      const record = records.get(entry.id)
      if (record) records.set(entry.id, { ...record, readAt: record.readAt ?? entry.readAt })
      continue
    }

    const { op: _op, ...record } = entry
    records.set(record.id, record)
  }

  return [...records.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_NOTIFICATIONS)
}

function compactNotificationLogIfNeeded(records: KilaNotificationRecord[]): void {
  if (records.length < MAX_NOTIFICATIONS) return
  const path = getNotificationsPath()
  const content = records
    .slice(0, MAX_NOTIFICATIONS)
    .map((record) => JSON.stringify({ op: 'create', ...record } satisfies NotificationLogEntry))
    .join('\n')
  writeFileSync(path, content ? `${content}\n` : '', 'utf-8')
}

export function listNotifications(input?: ListKilaNotificationsInput): KilaNotificationRecord[] {
  const limit = Math.min(Math.max(input?.limit ?? 80, 1), MAX_NOTIFICATIONS)
  const includeRead = input?.includeRead ?? true
  const records = materializeNotifications()
  return records.filter((record) => includeRead || !record.readAt).slice(0, limit)
}

export function createNotification(input: CreateKilaNotificationInput): KilaNotificationRecord | null {
  const category = normalizeCategory(input.category)
  if (!isCategoryEnabled(category)) return null

  const record: KilaNotificationRecord = {
    id: createNotificationId(),
    title: input.title.trim(),
    body: input.body?.trim() || undefined,
    level: input.level ?? 'info',
    category,
    sessionId: input.sessionId?.trim() || undefined,
    createdAt: input.createdAt ?? Date.now(),
  }
  if (!record.title) return null

  appendTextDurably(getNotificationsPath(), `${JSON.stringify({ op: 'create', ...record } satisfies NotificationLogEntry)}\n`)
  compactNotificationLogIfNeeded(materializeNotifications())
  return record
}

export function markNotificationRead(notificationId: string): KilaNotificationRecord[] {
  appendTextDurably(getNotificationsPath(), `${JSON.stringify({ op: 'mark-read', id: notificationId, readAt: Date.now() } satisfies NotificationLogEntry)}\n`)
  return listNotifications()
}

export function markAllNotificationsRead(): KilaNotificationRecord[] {
  appendTextDurably(getNotificationsPath(), `${JSON.stringify({ op: 'mark-all-read', readAt: Date.now() } satisfies NotificationLogEntry)}\n`)
  return listNotifications()
}

export function clearNotifications(): void {
  appendTextDurably(getNotificationsPath(), `${JSON.stringify({ op: 'clear', clearedAt: Date.now() } satisfies NotificationLogEntry)}\n`)
}
