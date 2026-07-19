/**
 * useGlobalSessionListeners — 统一 Session 事件监听
 *
 * 顶层只做组合，具体职责拆到 focused hooks：
 * - useAgentStreamListener
 * - usePendingRequestsListener
 * - useSessionMetaListener
 */

import { useAgentStreamListener } from './session-listeners/useAgentStreamListener'
import { usePendingRequestsListener } from './session-listeners/usePendingRequestsListener'
import { useSessionMetaListener } from './session-listeners/useSessionMetaListener'

export function useGlobalSessionListeners(): void {
  useAgentStreamListener()
  usePendingRequestsListener()
  useSessionMetaListener()
}
