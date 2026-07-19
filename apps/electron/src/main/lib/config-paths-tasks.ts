/**
 * 定时任务路径工具
 *
 * 管理定时任务的索引、运行历史等路径。
 * 从 config-paths.ts 中按领域拆出。
 */

import { join } from 'node:path'
import { mkdirSync, existsSync } from 'node:fs'
import { getConfigDir } from './config-paths'

export function getScheduledTasksDir(): string {
  const dir = join(getConfigDir(), 'scheduled-tasks')

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  return dir
}

export function getScheduledTasksIndexPath(): string {
  return join(getScheduledTasksDir(), 'tasks.json')
}

export function getScheduledTaskRunsDir(): string {
  const dir = join(getScheduledTasksDir(), 'runs')

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  return dir
}

export function getScheduledTaskRunPath(taskId: string): string {
  return join(getScheduledTaskRunsDir(), `${taskId}.jsonl`)
}
