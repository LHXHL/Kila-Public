import { existsSync, readFileSync } from 'node:fs'
import type { AgentRunReceipt, PiRunJournalV1 } from '@kila/shared'
import { getAgentRunReceiptPath, getPiRunJournalPath, getPiSessionDir } from './config-paths'
import { writeTextAtomic } from './safe-json-file'

export function writeAgentRunReceipt(sessionId: string, receipt: AgentRunReceipt): void {
  getPiSessionDir(sessionId)
  writeTextAtomic(getAgentRunReceiptPath(sessionId), JSON.stringify(receipt, null, 2))
}

export function readAgentRunReceipt(sessionId: string): AgentRunReceipt | undefined {
  const path = getAgentRunReceiptPath(sessionId)
  if (!existsSync(path)) return undefined
  return parseJsonFile<AgentRunReceipt>(path, 'run receipt')
}

export function writePiRunJournal(sessionId: string, journal: PiRunJournalV1): void {
  getPiSessionDir(sessionId)
  writeTextAtomic(getPiRunJournalPath(sessionId), JSON.stringify(journal, null, 2))
}

export function readPiRunJournal(sessionId: string): PiRunJournalV1 | undefined {
  const path = getPiRunJournalPath(sessionId)
  if (!existsSync(path)) return undefined
  return parseJsonFile<PiRunJournalV1>(path, 'Pi run journal')
}

function parseJsonFile<T>(path: string, label: string): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch (error) {
    throw new Error(`${label} 损坏: ${error instanceof Error ? error.message : String(error)}`)
  }
}

