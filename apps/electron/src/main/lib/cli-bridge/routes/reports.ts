import type { ServerResponse } from 'node:http'
import type { CliBridgeDailyReportResponse } from '@kila/shared'
import { getSessionMessages, listSessions } from '../../session-manager'
import { scheduledTaskManager } from '../../scheduled-task-singleton'
import { sendJson } from '../http'

function formatLocalDate(date: Date): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function resolveDayRange(rawDate?: string): { date: string; start: number; end: number } {
  const source = rawDate?.trim()
  const base = source ? new Date(`${source}T00:00:00`) : new Date()
  const start = new Date(base)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  const date = source || formatLocalDate(start)
  return {
    date,
    start: start.getTime(),
    end: end.getTime(),
  }
}

export function handleCliBridgeDailyReport(
  response: ServerResponse,
  rawDate?: string,
): void {
  const { date, start, end } = resolveDayRange(rawDate)
  const sessions = listSessions()

  let activeCount = 0
  let createdCount = 0
  let userMessageCount = 0
  let assistantMessageCount = 0
  let scheduledMessageCount = 0

  for (const session of sessions) {
    const messages = getSessionMessages(session.id)
    const dailyMessages = messages.filter((message) => message.createdAt >= start && message.createdAt < end)

    if (session.createdAt >= start && session.createdAt < end) {
      createdCount += 1
    }
    if (dailyMessages.length > 0 || (session.createdAt >= start && session.createdAt < end)) {
      activeCount += 1
    }

    for (const message of dailyMessages) {
      if (message.role === 'user') userMessageCount += 1
      if (message.role === 'assistant') assistantMessageCount += 1
      if (message.messageSource === 'scheduled-task') scheduledMessageCount += 1
    }
  }

  let totalRuns = 0
  let successCount = 0
  let errorCount = 0
  let skippedCount = 0
  let stoppedByAiCount = 0

  for (const task of scheduledTaskManager.listTasks()) {
    const runs = scheduledTaskManager.listRuns(task.id, 500).filter((run) => run.startedAt >= start && run.startedAt < end)
    totalRuns += runs.length
    for (const run of runs) {
      if (run.outcome === 'success') successCount += 1
      else if (run.outcome === 'error') errorCount += 1
      else if (run.outcome === 'stopped_by_ai') stoppedByAiCount += 1
      else skippedCount += 1
    }
  }

  sendJson(response, 200, {
    date,
    rangeStart: start,
    rangeEnd: end,
    sessions: {
      activeCount,
      createdCount,
      userMessageCount,
      assistantMessageCount,
      scheduledMessageCount,
    },
    tasks: {
      totalRuns,
      successCount,
      errorCount,
      skippedCount,
      stoppedByAiCount,
    },
  } satisfies CliBridgeDailyReportResponse)
}
