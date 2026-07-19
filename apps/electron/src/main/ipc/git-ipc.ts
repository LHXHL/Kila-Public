import { GIT_IPC_CHANNELS } from '@kila/shared'
import type {
  GitChangesSnapshot,
  ProjectRunChanges,
  GitCommitInput,
  GitCommitResult,
  GitDiffInput,
  GitDiffResult,
  GitHunkActionInput,
  GitFileActionInput,
  GitWorktreeCreateInput,
  GitWorktreeEntry,
  GitWorktreeRemoveInput,
} from '@kila/shared'
import { handle } from './shared'
import {
  applyGitHunk,
  commitGitChanges,
  createGitWorktree,
  discardGitFiles,
  getGitChanges,
  getGitFileDiff,
  listGitWorktrees,
  removeGitWorktree,
  stageGitFiles,
  unstageGitFiles,
} from '../lib/git-changes-service'
import { getProjectRunChanges } from '../lib/project-run-changes'

export function registerGitHandlers(): void {
  handle(GIT_IPC_CHANNELS.GET_RUN_CHANGES, async (_, sessionId: string): Promise<ProjectRunChanges | null> => (
    getProjectRunChanges(sessionId)
  ))
  handle(GIT_IPC_CHANNELS.GET_CHANGES, async (_, projectPath: string): Promise<GitChangesSnapshot> => (
    getGitChanges(projectPath)
  ))
  handle(GIT_IPC_CHANNELS.GET_DIFF, async (_, input: GitDiffInput): Promise<GitDiffResult> => (
    getGitFileDiff(input.projectPath, input.filePath, input.staged)
  ))
  handle(GIT_IPC_CHANNELS.STAGE, async (_, input: GitFileActionInput): Promise<GitChangesSnapshot> => (
    stageGitFiles(input.projectPath, input.filePaths)
  ))
  handle(GIT_IPC_CHANNELS.UNSTAGE, async (_, input: GitFileActionInput): Promise<GitChangesSnapshot> => (
    unstageGitFiles(input.projectPath, input.filePaths)
  ))
  handle(GIT_IPC_CHANNELS.DISCARD, async (_, input: GitFileActionInput): Promise<GitChangesSnapshot> => (
    discardGitFiles(input.projectPath, input.filePaths)
  ))
  handle(GIT_IPC_CHANNELS.COMMIT, async (_, input: GitCommitInput): Promise<GitCommitResult> => (
    commitGitChanges(input.projectPath, input.message)
  ))
  handle(GIT_IPC_CHANNELS.LIST_WORKTREES, async (_, projectPath: string): Promise<GitWorktreeEntry[]> => (
    listGitWorktrees(projectPath)
  ))
  handle(GIT_IPC_CHANNELS.APPLY_HUNK, async (_, input: GitHunkActionInput): Promise<GitChangesSnapshot> => (
    applyGitHunk(input)
  ))
  handle(GIT_IPC_CHANNELS.CREATE_WORKTREE, async (_, input: GitWorktreeCreateInput): Promise<GitWorktreeEntry[]> => (
    createGitWorktree(input)
  ))
  handle(GIT_IPC_CHANNELS.REMOVE_WORKTREE, async (_, input: GitWorktreeRemoveInput): Promise<GitWorktreeEntry[]> => (
    removeGitWorktree(input.projectPath, input.worktreePath)
  ))
}
