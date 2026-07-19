/**
 * Session Context
 *
 * 单一 Session 壳层只暴露一个 sessionId。
 */

import * as React from 'react'

const SessionContext = React.createContext<string | null>(null)

export function SessionProvider({
  sessionId,
  children,
}: {
  sessionId: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <SessionContext.Provider value={sessionId}>
      {children}
    </SessionContext.Provider>
  )
}

export function useSessionId(): string {
  const id = React.useContext(SessionContext)
  if (!id) throw new Error('useSessionId 必须在 SessionProvider 内使用')
  return id
}

export function useSessionIdOptional(): string | null {
  return React.useContext(SessionContext)
}

export function useAgentSessionId(): string {
  return useSessionId()
}
