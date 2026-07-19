import type { ShowWidgetPayload } from './generative-ui'

export interface SessionPinnedWidget {
  id: string
  sessionId: string
  sourceMessageId: string
  sourceBlockKey: string
  title: string
  payload: ShowWidgetPayload
  createdAt: number
  updatedAt: number
}

export interface PinSessionWidgetInput {
  sessionId: string
  sourceMessageId: string
  sourceBlockKey: string
  title: string
  payload: ShowWidgetPayload
}

export const SESSION_BOARD_IPC_CHANNELS = {
  LIST: 'session-board:list',
  PIN: 'session-board:pin',
  UNPIN: 'session-board:unpin',
} as const
