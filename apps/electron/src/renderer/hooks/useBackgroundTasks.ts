/**
 * useBackgroundTasks — 后台任务管理 Hook
 *
 * 管理 Agent 会话的后台任务列表（Agent 任务和 Shell 任务）。
 * Shell 任务的完成状态由主进程 ProcessRegistry 查询兜底，避免只依赖
 * 流式事件导致自然结束的任务永久留在 UI 中。
 */

import { useAtom } from 'jotai'
import { useCallback, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import {
  backgroundTasksAtomFamily,
  type BackgroundTask,
} from '@/atoms/agent-atoms'

const SHELL_TASK_POLL_INTERVAL_MS = 1_000

export interface UseBackgroundTasksResult {
  /** 当前会话的后台任务列表 */
  tasks: BackgroundTask[]
  /** 添加后台任务 */
  addTask: (task: Omit<BackgroundTask, 'elapsedSeconds'>) => void
  /** 更新任务进度 */
  updateTaskProgress: (toolUseId: string, elapsedSeconds: number) => void
  /** 移除后台任务 */
  removeTask: (toolUseId: string) => void
  /** 停止任务 */
  stopTask: (taskId: string, type: 'agent' | 'shell') => Promise<void>
}

export function useBackgroundTasks(sessionId: string): UseBackgroundTasksResult {
  const [tasks, setTasks] = useAtom(backgroundTasksAtomFamily(sessionId))
  const tasksRef = useRef(tasks)
  const pollingRef = useRef(false)
  const reportedPollErrorsRef = useRef(new Set<string>())

  useEffect(() => {
    tasksRef.current = tasks
  }, [tasks])

  useEffect(() => {
    let disposed = false

    const pollShellTasks = async (): Promise<void> => {
      if (disposed || pollingRef.current) return

      const shellTasks = tasksRef.current.filter((task) => task.type === 'shell')
      if (shellTasks.length === 0) return

      pollingRef.current = true
      try {
        const snapshots = await Promise.all(shellTasks.map(async (task) => {
          try {
            const snapshot = await window.electronAPI.getTaskOutput({ taskId: task.id })
            reportedPollErrorsRef.current.delete(task.id)
            return { task, snapshot }
          } catch (error) {
            if (!reportedPollErrorsRef.current.has(task.id)) {
              reportedPollErrorsRef.current.add(task.id)
              console.error('[useBackgroundTasks] 查询 Shell 任务失败:', error)
              toast.error(`无法读取后台任务「${task.intent || task.id}」的状态`)
            }
            return { task, snapshot: null }
          }
        }))

        if (disposed) return
        const now = Date.now()
        const completedIds = new Set(
          snapshots
            .filter(({ snapshot }) => snapshot?.isComplete)
            .map(({ task }) => task.toolUseId),
        )
        const elapsedByToolUseId = new Map(
          snapshots.map(({ task, snapshot }) => [
            task.toolUseId,
            snapshot?.isComplete && snapshot.endedAt
              ? Math.max(0, Math.floor((snapshot.endedAt - task.startTime) / 1000))
              : Math.max(0, Math.floor((now - task.startTime) / 1000)),
          ] as const),
        )

        setTasks((previous) => previous
          .filter((task) => !completedIds.has(task.toolUseId))
          .map((task) => {
            const elapsedSeconds = elapsedByToolUseId.get(task.toolUseId)
            return elapsedSeconds === undefined ? task : { ...task, elapsedSeconds }
          }))
      } finally {
        pollingRef.current = false
      }
    }

    void pollShellTasks()
    const timer = window.setInterval(() => { void pollShellTasks() }, SHELL_TASK_POLL_INTERVAL_MS)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [setTasks])

  const addTask = useCallback(
    (task: Omit<BackgroundTask, 'elapsedSeconds'>) => {
      setTasks((prev) => {
        if (prev.some((item) => item.toolUseId === task.toolUseId)) return prev
        return [...prev, { ...task, elapsedSeconds: 0 }]
      })
    },
    [setTasks],
  )

  const updateTaskProgress = useCallback(
    (toolUseId: string, elapsedSeconds: number) => {
      setTasks((prev) => prev.map((task) => (
        task.toolUseId === toolUseId ? { ...task, elapsedSeconds } : task
      )))
    },
    [setTasks],
  )

  const removeTask = useCallback(
    (toolUseId: string) => {
      setTasks((prev) => prev.filter((task) => task.toolUseId !== toolUseId))
    },
    [setTasks],
  )

  const stopTask = useCallback(
    async (taskId: string, type: 'agent' | 'shell') => {
      if (type === 'agent') {
        throw new Error('当前版本暂不支持单独停止后台 Agent 任务')
      }

      try {
        await window.electronAPI.stopTask({ sessionId, taskId, type })
        const task = tasksRef.current.find((item) => item.id === taskId)
        if (task) removeTask(task.toolUseId)
      } catch (error) {
        console.error('[useBackgroundTasks] 停止任务失败:', error)
        toast.error('停止后台任务失败')
        throw error
      }
    },
    [removeTask, sessionId],
  )

  return { tasks, addTask, updateTaskProgress, removeTask, stopTask }
}
