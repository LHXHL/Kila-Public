/**
 * Session Board IPC 处理器
 *
 * Board pin/unpin/list
 */

import { SESSION_BOARD_IPC_CHANNELS } from '@kila/shared'
import type { SessionPinnedWidget, PinSessionWidgetInput } from '@kila/shared'
import { handle, requireUnifiedSession } from './shared'
import {
  listSessionPinnedWidgets,
  pinSessionWidget,
  unpinSessionWidget,
} from '../lib/session-board-manager'

export function registerSessionBoardHandlers(): void {
  handle(
    SESSION_BOARD_IPC_CHANNELS.LIST,
    async (_, sessionId: string): Promise<SessionPinnedWidget[]> => {
      requireUnifiedSession(sessionId)
      return listSessionPinnedWidgets(sessionId)
    }
  )

  handle(
    SESSION_BOARD_IPC_CHANNELS.PIN,
    async (_, input: PinSessionWidgetInput): Promise<SessionPinnedWidget> => {
      requireUnifiedSession(input.sessionId)
      return pinSessionWidget(input)
    }
  )

  handle(
    SESSION_BOARD_IPC_CHANNELS.UNPIN,
    async (_, sessionId: string, pinId: string): Promise<void> => {
      requireUnifiedSession(sessionId)
      unpinSessionWidget(sessionId, pinId)
    }
  )
}
