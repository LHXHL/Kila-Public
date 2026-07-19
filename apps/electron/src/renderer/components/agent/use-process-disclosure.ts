/**
 * useProcessDisclosure — 思考/工具过程卡片的展开/折叠 hook
 *
 * 默认折叠，仅响应用户手动操作。
 * 管理 running → done 的计时。
 */

import * as React from 'react'
import { formatElapsed } from './ToolActivityItem'
import { formatProcessDuration } from './agent-messages-utils'

export function useProcessDisclosure({
  hasBody,
  running,
  startedAt,
  elapsedSeconds,
}: {
  hasBody: boolean
  running: boolean
  startedAt?: number
  elapsedSeconds?: number
}): {
  open: boolean
  setOpen: React.Dispatch<React.SetStateAction<boolean>>
  durationLabel: string | null
} {
  const [open, setOpen] = React.useState(false)
  const [durationSeconds, setDurationSeconds] = React.useState<number | undefined>(elapsedSeconds)

  React.useEffect(() => {
    if (!hasBody) {
      setOpen(false)
      setDurationSeconds(elapsedSeconds)
      return
    }

    if (!running && elapsedSeconds !== undefined) {
      setDurationSeconds(elapsedSeconds)
    }
  }, [elapsedSeconds, hasBody, running])

  const [liveDurationSeconds, setLiveDurationSeconds] = React.useState<number | undefined>(
    startedAt && running ? (Date.now() - startedAt) / 1000 : undefined,
  )

  React.useEffect(() => {
    if (!running || !startedAt) {
      setLiveDurationSeconds(undefined)
      return
    }

    setLiveDurationSeconds((Date.now() - startedAt) / 1000)
    const timer = window.setInterval(() => {
      setLiveDurationSeconds((Date.now() - startedAt) / 1000)
    }, 100)
    return () => window.clearInterval(timer)
  }, [running, startedAt])

  const durationLabel = running
    ? formatProcessDuration(liveDurationSeconds)
    : elapsedSeconds !== undefined
      ? formatElapsed(elapsedSeconds)
      : formatProcessDuration(durationSeconds)

  return { open, setOpen, durationLabel }
}
