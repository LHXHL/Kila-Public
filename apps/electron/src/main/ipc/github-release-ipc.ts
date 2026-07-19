/**
 * GitHub Release IPC 处理器
 */

import { GITHUB_RELEASE_IPC_CHANNELS } from '@kila/shared'
import type { GitHubRelease, GitHubReleaseListOptions } from '@kila/shared'
import { handle } from './shared'
import {
  getLatestRelease,
  listReleases as listGitHubReleases,
  getReleaseByTag,
} from '../lib/github-release-service'

export function registerGitHubReleaseHandlers(): void {
  // 获取最新 Release
  handle(
    GITHUB_RELEASE_IPC_CHANNELS.GET_LATEST_RELEASE,
    async (): Promise<GitHubRelease | null> => {
      return getLatestRelease()
    }
  )

  // 获取 Release 列表
  handle(
    GITHUB_RELEASE_IPC_CHANNELS.LIST_RELEASES,
    async (_, options?: GitHubReleaseListOptions): Promise<GitHubRelease[]> => {
      return listGitHubReleases(options)
    }
  )

  // 获取指定版本的 Release
  handle(
    GITHUB_RELEASE_IPC_CHANNELS.GET_RELEASE_BY_TAG,
    async (_, tag: string): Promise<GitHubRelease | null> => {
      return getReleaseByTag(tag)
    }
  )
}
