import type * as React from 'react'
import { SessionProvider } from '@/contexts/session-context'
import { AgentView } from '@/components/agent'

interface SessionViewProps {
  sessionId: string
}

export function SessionView({ sessionId }: SessionViewProps): React.ReactElement {
  return (
    <SessionProvider sessionId={sessionId}>
        <AgentView sessionId={sessionId} />
    </SessionProvider>
  )
}
