/**
 * GitHub Release 服务
 *
 * 从 GitHub API 获取项目的发布日志（Release Notes）
 */

import type {
  GitHubRelease,
  GitHubReleaseListOptions,
} from '@kila/shared'

/** GitHub API 基础 URL */

import { createLogger } from './logger'
import { getFetchFn } from './proxy-fetch'
import { getEffectiveProxyUrl } from './proxy-settings-service'
const log = createLogger('GitHub Release')

const GITHUB_API_BASE = 'https://api.github.com'

/** GitHub 仓库配置（从 electron-builder.yml） */
const GITHUB_REPO = {
  owner: 'LHXHL',
  repo: 'Kila',
}

/** Release 缓存 */
interface ReleaseCache {
  data: GitHubRelease[]
  timestamp: number
}

let releaseCache: ReleaseCache | null = null

/** 缓存有效期（5 分钟） */
const CACHE_TTL = 5 * 60 * 1000

/**
 * 从 GitHub API 获取 releases
 *
 * @param endpoint - API 端点
 * @returns Release 数据
 */
async function fetchFromGitHub<T>(endpoint: string): Promise<T> {
  const url = `${GITHUB_API_BASE}/repos/${GITHUB_REPO.owner}/${GITHUB_REPO.repo}${endpoint}`

  log.info(`[GitHub Release] 正在请求: ${url}`)

  const proxyUrl = await getEffectiveProxyUrl()
  const fetchFn = getFetchFn(proxyUrl)
  const response = await fetchFn(url, {
    headers: {
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'Kila-Desktop-App',
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(
      `GitHub API 请求失败: ${response.status} ${response.statusText}\n${errorText}`
    )
  }

  return response.json() as Promise<T>
}

/**
 * 获取最新的 Release
 *
 * @returns 最新的 Release，如果没有则返回 null
 */
export async function getLatestRelease(): Promise<GitHubRelease | null> {
  try {
    const release = await fetchFromGitHub<GitHubRelease>('/releases/latest')
    log.info(`[GitHub Release] 获取最新 Release: v${release.tag_name}`)
    return release
  } catch (error) {
    log.error('[GitHub Release] 获取最新 Release 失败:', error)
    return null
  }
}

/**
 * 获取 Release 列表
 *
 * @param options - 查询选项
 * @returns Release 列表
 */
export async function listReleases(
  options: GitHubReleaseListOptions = {}
): Promise<GitHubRelease[]> {
  const {
    perPage = 10,
    page = 1,
    includePrerelease = false,
  } = options

  try {
    // 检查缓存
    if (
      releaseCache &&
      Date.now() - releaseCache.timestamp < CACHE_TTL &&
      page === 1
    ) {
      log.info('[GitHub Release] 使用缓存的 Release 列表')
      const filtered = includePrerelease
        ? releaseCache.data
        : releaseCache.data.filter(r => !r.prerelease && !r.draft)
      return filtered.slice(0, perPage)
    }

    // 构建查询参数
    const params = new URLSearchParams({
      per_page: String(perPage),
      page: String(page),
    })

    const releases = await fetchFromGitHub<GitHubRelease[]>(
      `/releases?${params.toString()}`
    )

    log.info(`[GitHub Release] 获取到 ${releases.length} 个 Releases`)

    // 过滤草稿和预发布版本（如果需要）
    const filtered = includePrerelease
      ? releases
      : releases.filter(r => !r.prerelease && !r.draft)

    // 更新缓存（仅第一页）
    if (page === 1) {
      releaseCache = {
        data: releases,
        timestamp: Date.now(),
      }
    }

    return filtered
  } catch (error) {
    log.error('[GitHub Release] 获取 Release 列表失败:', error)
    // 如果有缓存，即使过期也返回
    if (releaseCache) {
      log.info('[GitHub Release] API 请求失败，使用过期缓存')
      const filtered = includePrerelease
        ? releaseCache.data
        : releaseCache.data.filter(r => !r.prerelease && !r.draft)
      return filtered.slice(0, perPage)
    }
    return []
  }
}

/**
 * 根据标签名获取指定的 Release
 *
 * @param tag - 标签名（版本号）
 * @returns 指定的 Release，如果没有则返回 null
 */
export async function getReleaseByTag(tag: string): Promise<GitHubRelease | null> {
  try {
    const release = await fetchFromGitHub<GitHubRelease>(
      `/releases/tags/${tag}`
    )
    log.info(`[GitHub Release] 获取 Release: ${tag}`)
    return release
  } catch (error) {
    log.error(`[GitHub Release] 获取 Release ${tag} 失败:`, error)
    return null
  }
}

/**
 * 清除缓存
 */
export function clearReleaseCache(): void {
  releaseCache = null
  log.info('[GitHub Release] 缓存已清除')
}
