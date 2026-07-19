import type { SessionMessage } from '../types'

export interface SessionContextCalibrationSnapshot {
  modelId: string
  fingerprint: string
  estimatedTokens: number
  actualTokens: number
}

export interface EstimateSessionContextInput {
  modelId: string
  contextWindow?: number
  historyTurns?: number | 'infinite'
  systemPrompt: string
  dynamicContext: string
  visibleMessages: SessionMessage[]
  currentTurnText?: string
  attachedFilesBlock?: string
  calibration?: SessionContextCalibrationSnapshot
}

export interface SessionContextEstimate {
  fingerprint: string
  estimatedTokens: number
  displayTokens: number
  contextWindow?: number
  calibrationRatio?: number
}

export interface SessionContextSnapshotSegmentSummary {
  systemPromptChars: number
  historyChars: number
  historyTurns: number
  attachmentsChars: number
  currentTurnChars: number
  toolDefinitionsChars: number
}

export interface SessionContextSnapshot {
  fingerprint: string
  estimatedInputTokens: number
  segmentSummary: SessionContextSnapshotSegmentSummary
  contextWindow?: number
  modelId: string
  createdAt: number
}

function filterVisibleMessages(
  messages: SessionMessage[],
  historyTurns?: number | 'infinite',
): SessionMessage[] {
  if (historyTurns === 'infinite' || typeof historyTurns === 'undefined') {
    return messages
  }

  if (historyTurns <= 0) return []

  const collected: SessionMessage[] = []
  let turnCount = 0

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!
    collected.unshift(message)
    if (message.role === 'user') {
      turnCount += 1
      if (turnCount >= historyTurns) break
    }
  }

  return collected
}

function estimateTextTokens(text: string): number {
  let weight = 0

  for (const char of text) {
    if (/\s/.test(char)) {
      weight += 0.15
      continue
    }

    if (/[\u3400-\u9fff\uf900-\ufaff]/.test(char)) {
      weight += 1.1
      continue
    }

    if (/[A-Za-z0-9]/.test(char)) {
      weight += 0.25
      continue
    }

    if (/[<>{}\[\]()/_\-.:\\`]/.test(char)) {
      weight += 0.35
      continue
    }

    weight += 0.3
  }

  return Math.max(1, Math.ceil(weight))
}

function hashString(text: string): string {
  let hash = 2166136261

  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function estimateSessionContext(input: EstimateSessionContextInput): SessionContextEstimate {
  const visibleMessages = filterVisibleMessages(input.visibleMessages, input.historyTurns)

  const segments = [
    `model:${input.modelId}`,
    `historyTurns:${String(input.historyTurns ?? 'infinite')}`,
    `system:${input.systemPrompt}`,
    `dynamic:${input.dynamicContext}`,
    ...visibleMessages.map((message) => `message:${message.id}:${message.role}:${message.content}`),
    input.attachedFilesBlock ? `attached:${input.attachedFilesBlock}` : '',
    input.currentTurnText ? `current:${input.currentTurnText}` : '',
  ].filter(Boolean)

  const fingerprint = hashString(segments.join('\n---\n'))

  let estimatedTokens = estimateTextTokens(input.systemPrompt)
    + estimateTextTokens(input.dynamicContext)
    + visibleMessages.reduce((sum, message) => (
      sum + 6 + estimateTextTokens(message.content)
    ), 0)

  if (input.attachedFilesBlock) {
    estimatedTokens += 8 + estimateTextTokens(input.attachedFilesBlock)
  }

  if (input.currentTurnText) {
    estimatedTokens += 6 + estimateTextTokens(input.currentTurnText)
  }

  let displayTokens = estimatedTokens
  let calibrationRatio: number | undefined
  const calibration = input.calibration

  if (calibration && calibration.modelId === input.modelId && calibration.estimatedTokens > 0) {
    calibrationRatio = calibration.actualTokens / calibration.estimatedTokens
    if (calibration.fingerprint === fingerprint) {
      displayTokens = calibration.actualTokens
    } else {
      displayTokens = Math.max(1, Math.round(estimatedTokens * calibrationRatio))
    }
  }

  return {
    fingerprint,
    estimatedTokens,
    displayTokens,
    contextWindow: input.contextWindow,
    calibrationRatio,
  }
}

export function buildSessionContextSnapshot(input: {
  modelId: string
  contextWindow?: number
  historyTurns?: number | 'infinite'
  systemPrompt: string
  dynamicContext: string
  historyMessages: SessionMessage[]
  currentTurnText: string
  toolDefinitions?: Array<{ name?: string; description?: string }>
}): SessionContextSnapshot {
  const visibleMessages = filterVisibleMessages(input.historyMessages, input.historyTurns)
  const toolDefinitionsText = (input.toolDefinitions ?? [])
    .map((tool) => `${tool.name ?? ''}\n${tool.description ?? ''}`)
    .join('\n---\n')
  const systemPrompt = [input.systemPrompt, input.dynamicContext, toolDefinitionsText]
    .filter(Boolean)
    .join('\n\n')

  const estimate = estimateSessionContext({
    modelId: input.modelId,
    contextWindow: input.contextWindow,
    historyTurns: input.historyTurns,
    systemPrompt,
    dynamicContext: '',
    visibleMessages,
    currentTurnText: input.currentTurnText,
  })

  return {
    fingerprint: estimate.fingerprint,
    estimatedInputTokens: estimate.estimatedTokens,
    segmentSummary: {
      systemPromptChars: input.systemPrompt.length + input.dynamicContext.length,
      historyChars: visibleMessages.reduce((sum, message) => sum + message.content.length, 0),
      historyTurns: visibleMessages.filter((message) => message.role === 'user').length,
      attachmentsChars: 0,
      currentTurnChars: input.currentTurnText.length,
      toolDefinitionsChars: toolDefinitionsText.length,
    },
    contextWindow: input.contextWindow,
    modelId: input.modelId,
    createdAt: Date.now(),
  }
}
