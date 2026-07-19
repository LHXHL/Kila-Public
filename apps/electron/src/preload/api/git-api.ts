import { GIT_IPC_CHANNELS, IPC_CHANNELS } from '@kila/shared/ipc'
import type {
  GitChangesSnapshot,
  ProjectRunChanges,
  GitCommitInput,
  GitCommitResult,
  GitDiffInput,
  GitDiffResult,
  GitFileActionInput,
  GitHunkActionInput,
  GitRepoStatus,
  GitWorktreeCreateInput,
  GitWorktreeEntry,
  GitWorktreeRemoveInput,
} from '@kila/shared'
import { invoke } from '../invoke'

export interface GitPreloadApi {
  getGitRepoStatus: (dirPath: string) => Promise<GitRepoStatus | null>
  getGitChanges: (projectPath: string) => Promise<GitChangesSnapshot>
  getProjectRunChanges: (sessionId: string) => Promise<ProjectRunChanges | null>
  getGitDiff: (input: GitDiffInput) => Promise<GitDiffResult>
  stageGitFiles: (input: GitFileActionInput) => Promise<GitChangesSnapshot>
  unstageGitFiles: (input: GitFileActionInput) => Promise<GitChangesSnapshot>
  discardGitFiles: (input: GitFileActionInput) => Promise<GitChangesSnapshot>
  commitGitChanges: (input: GitCommitInput) => Promise<GitCommitResult>
  listGitWorktrees: (projectPath: string) => Promise<GitWorktreeEntry[]>
  applyGitHunk: (input: GitHunkActionInput) => Promise<GitChangesSnapshot>
  createGitWorktree: (input: GitWorktreeCreateInput) => Promise<GitWorktreeEntry[]>
  removeGitWorktree: (input: GitWorktreeRemoveInput) => Promise<GitWorktreeEntry[]>
}

export function createGitApi(): GitPreloadApi {
  return {
    getGitRepoStatus: (dirPath) => invoke(IPC_CHANNELS.GET_GIT_REPO_STATUS, dirPath),
    getGitChanges: (projectPath) => invoke(GIT_IPC_CHANNELS.GET_CHANGES, projectPath),
    getProjectRunChanges: (sessionId) => invoke(GIT_IPC_CHANNELS.GET_RUN_CHANGES, sessionId),
    getGitDiff: (input) => invoke(GIT_IPC_CHANNELS.GET_DIFF, input),
    stageGitFiles: (input) => invoke(GIT_IPC_CHANNELS.STAGE, input),
    unstageGitFiles: (input) => invoke(GIT_IPC_CHANNELS.UNSTAGE, input),
    discardGitFiles: (input) => invoke(GIT_IPC_CHANNELS.DISCARD, input),
    commitGitChanges: (input) => invoke(GIT_IPC_CHANNELS.COMMIT, input),
    listGitWorktrees: (projectPath) => invoke(GIT_IPC_CHANNELS.LIST_WORKTREES, projectPath),
    applyGitHunk: (input) => invoke(GIT_IPC_CHANNELS.APPLY_HUNK, input),
    createGitWorktree: (input) => invoke(GIT_IPC_CHANNELS.CREATE_WORKTREE, input),
    removeGitWorktree: (input) => invoke(GIT_IPC_CHANNELS.REMOVE_WORKTREE, input),
  }
}
