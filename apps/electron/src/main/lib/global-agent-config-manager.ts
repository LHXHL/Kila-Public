/**
 * Global agent config manager
 *
 * MCP / Skills 的应用级单一真相源：
 * ~/.kila/global-agent/
 */

import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type {
  GlobalSkillContentType,
  GlobalSkillDetail,
  GlobalSkillEntry,
  GlobalSkillInstallInput,
  GlobalSkillInstallResult,
  GlobalSkillEntrySource,
  SkillMeta,
  WorkspaceCapabilities,
  WorkspaceMcpConfig,
} from '@kila/shared'
import { parseGlobalSkillMentionId } from '@kila/shared'
import {
  getBuiltinSkillSourceDirs,
  getClaudeHackSkillsDir,
  getClaudePluginsDir,
  getClaudeSkillsDir,
  getCodexPluginsDir,
  getCodexSkillsDir,
  getGlobalAgentInactiveSkillsDir,
  getGlobalAgentMcpPath,
  getGlobalAgentSkillsDir,
  getGlobalAgentStatePath,
} from './config-paths'
import { syncMissingSkillDirectories } from './skill-sync'


import { createLogger } from './logger'
const log = createLogger('全局 Agent 配置')

interface GlobalAgentState {
  deletedSkillSlugs?: string[]
}

interface GlobalSkillSourceLock {
  version: 1
  repoUrl: string
  subdir?: string
  slug: string
  installedAt: number
  updatedAt: number
}

interface ScannedGlobalSkillEntry extends GlobalSkillEntry {
  path: string
  sourceRoot?: string
  contentPath: string
  contentType: GlobalSkillContentType
}

const DIRECTORY_SCAN_SKIP_NAMES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
])

const SKILL_SOURCE_LOCK_FILE = '.kila-skill-source.json'

function parseSkillFrontmatter(content: string, slug: string, enabled: boolean): SkillMeta {
  const meta: SkillMeta = { slug, name: slug, enabled }

  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!fmMatch || !fmMatch[1]) return meta

  for (const line of fmMatch[1].split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue

    const key = line.slice(0, colonIdx).trim()
    const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '')

    if (key === 'name' && value) meta.name = value
    if (key === 'description' && value) meta.description = value
    if (key === 'icon' && value) meta.icon = value
  }

  return meta
}

function scanSkillsInDir(dir: string, enabled: boolean): SkillMeta[] {
  const skills: SkillMeta[] = []

  try {
    const entries = readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      const isDir = entry.isDirectory() || (entry.isSymbolicLink() && statSync(join(dir, entry.name)).isDirectory())
      if (!isDir) continue

      const skillMdPath = join(dir, entry.name, 'SKILL.md')
      if (!existsSync(skillMdPath)) continue

      try {
        const content = readFileSync(skillMdPath, 'utf-8')
        skills.push(parseSkillFrontmatter(content, entry.name, enabled))
      } catch {
        log.warn(`[全局 Agent 配置] 解析 Skill 失败: ${entry.name}`)
      }
    }
  } catch {
    // ignore missing dir
  }

  return skills
}

function parsePluginManifest(content: string, fallbackSlug: string): Omit<SkillMeta, 'enabled' | 'icon'> {
  try {
    const parsed = JSON.parse(content) as { name?: unknown; description?: unknown }
    const name = typeof parsed.name === 'string' && parsed.name.trim()
      ? parsed.name.trim()
      : fallbackSlug
    const description = typeof parsed.description === 'string' && parsed.description.trim()
      ? parsed.description.trim()
      : undefined

    return {
      slug: fallbackSlug,
      name,
      description,
    }
  } catch {
    return {
      slug: fallbackSlug,
      name: fallbackSlug,
    }
  }
}

function isDirectoryPath(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function isFilePath(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function buildGlobalSkillEntryId(
  source: GlobalSkillEntrySource,
  kind: GlobalSkillEntry['kind'],
  sourceRoot: string,
  targetPath: string,
): string {
  const rel = relative(sourceRoot, targetPath) || basename(targetPath)
  return `${source}:${kind}:${rel.replace(/[\\/]/g, '::')}`
}

function resolvePluginContainerPath(pluginJsonPath: string): string {
  const manifestDir = dirname(pluginJsonPath)
  const manifestDirName = basename(manifestDir)

  if (manifestDirName.startsWith('.') && manifestDirName.endsWith('-plugin')) {
    return dirname(manifestDir)
  }

  return manifestDir
}

function walkFilesByName(rootDir: string, fileName: string): string[] {
  if (!existsSync(rootDir) || !isDirectoryPath(rootDir)) {
    return []
  }

  const matches: string[] = []

  const visit = (dir: string): void => {
    let entries: Dirent[]

    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      const isDir = entry.isDirectory() || (entry.isSymbolicLink() && isDirectoryPath(fullPath))

      if (isDir) {
        if (DIRECTORY_SCAN_SKIP_NAMES.has(entry.name)) continue
        visit(fullPath)
        continue
      }

      const isFile = entry.isFile() || (entry.isSymbolicLink() && isFilePath(fullPath))
      if (!isFile || entry.name !== fileName) continue

      matches.push(fullPath)
    }
  }

  visit(rootDir)
  return matches
}

function scanExternalSkillLibrary(
  rootDir: string,
  source: GlobalSkillEntrySource,
  sourceLabel: string,
): ScannedGlobalSkillEntry[] {
  const contentPaths = walkFilesByName(rootDir, 'SKILL.md')
  const entries: ScannedGlobalSkillEntry[] = []

  for (const contentPath of contentPaths) {
    const skillDir = dirname(contentPath)
    const slug = basename(skillDir)

    try {
      const content = readFileSync(contentPath, 'utf-8')
      const meta = parseSkillFrontmatter(content, slug, true)
      entries.push({
        id: buildGlobalSkillEntryId(source, 'skill', rootDir, skillDir),
        slug: meta.slug,
        name: meta.name,
        description: meta.description,
        icon: meta.icon,
        enabled: true,
        source,
        sourceLabel,
        kind: 'skill',
        managementMode: 'readonly',
        path: skillDir,
        sourceRoot: rootDir,
        contentPath,
        contentType: 'markdown',
      })
    } catch {
      log.warn(`[全局 Agent 配置] 解析外部 Skill 失败: ${contentPath}`)
    }
  }

  return entries
}

function scanPluginLibrary(
  rootDir: string,
  source: GlobalSkillEntrySource,
  sourceLabel: string,
): ScannedGlobalSkillEntry[] {
  const contentPaths = walkFilesByName(rootDir, 'plugin.json')
  const entries: ScannedGlobalSkillEntry[] = []

  for (const contentPath of contentPaths) {
    const containerPath = resolvePluginContainerPath(contentPath)
    const slug = basename(containerPath)

    try {
      const content = readFileSync(contentPath, 'utf-8')
      const meta = parsePluginManifest(content, slug)
      entries.push({
        id: buildGlobalSkillEntryId(source, 'plugin', rootDir, containerPath),
        slug: meta.slug,
        name: meta.name,
        description: meta.description,
        enabled: true,
        source,
        sourceLabel,
        kind: 'plugin',
        managementMode: 'readonly',
        path: containerPath,
        sourceRoot: rootDir,
        contentPath,
        contentType: 'json',
      })
    } catch {
      log.warn(`[全局 Agent 配置] 解析 Plugin 失败: ${contentPath}`)
    }
  }

  return entries
}

function scanManagedGlobalSkillLibraryEntries(): ScannedGlobalSkillEntry[] {
  syncBuiltinSkillsToGlobalAgent()

  const sourceRoot = getGlobalAgentSkillsDir()
  const activeEntries = scanSkillsInDir(sourceRoot, true)
    .map((meta) => ({
      id: `kila:skill:${meta.slug}`,
      slug: meta.slug,
      name: meta.name,
      description: meta.description,
      icon: meta.icon,
      enabled: true,
      source: 'kila' as const,
      sourceLabel: 'Kila',
      kind: 'skill' as const,
      managementMode: 'managed' as const,
      path: join(sourceRoot, meta.slug),
      sourceRoot,
      contentPath: join(sourceRoot, meta.slug, 'SKILL.md'),
      contentType: 'markdown' as const,
    }))

  const inactiveRoot = getGlobalAgentInactiveSkillsDir()
  const inactiveEntries = scanSkillsInDir(inactiveRoot, false)
    .map((meta) => ({
      id: `kila:skill:${meta.slug}`,
      slug: meta.slug,
      name: meta.name,
      description: meta.description,
      icon: meta.icon,
      enabled: false,
      source: 'kila' as const,
      sourceLabel: 'Kila',
      kind: 'skill' as const,
      managementMode: 'managed' as const,
      path: join(inactiveRoot, meta.slug),
      sourceRoot: inactiveRoot,
      contentPath: join(inactiveRoot, meta.slug, 'SKILL.md'),
      contentType: 'markdown' as const,
    }))

  return [...activeEntries, ...inactiveEntries]
}

function dedupeGlobalSkillLibraryEntries(entries: ScannedGlobalSkillEntry[]): ScannedGlobalSkillEntry[] {
  const seen = new Set<string>()
  const deduped: ScannedGlobalSkillEntry[] = []

  for (const entry of entries) {
    const key = `${entry.source}:${entry.kind}:${entry.slug.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(entry)
  }

  return deduped
}

function sortGlobalSkillLibraryEntries(entries: ScannedGlobalSkillEntry[]): ScannedGlobalSkillEntry[] {
  const sourceOrder: Record<GlobalSkillEntrySource, number> = {
    kila: 0,
    codex: 1,
    claude: 2,
  }
  const kindOrder: Record<GlobalSkillEntry['kind'], number> = {
    skill: 0,
    plugin: 1,
  }

  return [...entries].sort((left, right) => {
    const sourceDiff = sourceOrder[left.source] - sourceOrder[right.source]
    if (sourceDiff !== 0) return sourceDiff

    const kindDiff = kindOrder[left.kind] - kindOrder[right.kind]
    if (kindDiff !== 0) return kindDiff

    return left.name.localeCompare(right.name, 'en')
  })
}

function buildGlobalSkillLibraryIndex(): ScannedGlobalSkillEntry[] {
  const entries = [
    ...scanManagedGlobalSkillLibraryEntries(),
    ...scanExternalSkillLibrary(getCodexSkillsDir(), 'codex', 'Codex'),
    ...scanPluginLibrary(getCodexPluginsDir(), 'codex', 'Codex'),
    ...scanExternalSkillLibrary(getClaudeSkillsDir(), 'claude', 'Claude'),
    ...scanExternalSkillLibrary(getClaudeHackSkillsDir(), 'claude', 'Claude'),
    ...scanPluginLibrary(getClaudeSkillsDir(), 'claude', 'Claude'),
    ...scanPluginLibrary(getClaudePluginsDir(), 'claude', 'Claude'),
  ]

  return sortGlobalSkillLibraryEntries(dedupeGlobalSkillLibraryEntries(entries))
}

function findGlobalSkillEntryByMentionId(mentionId: string): ScannedGlobalSkillEntry | undefined {
  const target = parseGlobalSkillMentionId(mentionId)
  if (!target.slug) {
    return undefined
  }

  return buildGlobalSkillLibraryIndex().find((entry) => (
    entry.kind === 'skill'
    && entry.source === target.source
    && entry.slug === target.slug
  ))
}

export function syncBuiltinSkillsToGlobalAgent(): void {
  try {
    const sourceDirs = getBuiltinSkillSourceDirs()
    if (sourceDirs.length === 0) {
      return
    }

    syncMissingSkillDirectories({
      sourceDirs,
      activeDir: getGlobalAgentSkillsDir(),
      inactiveDir: getGlobalAgentInactiveSkillsDir(),
      blockedSlugs: getDeletedSkillSlugs(),
    })
  } catch {
    // 内置 Skills 缺失不阻塞运行时
  }
}

function readGlobalAgentState(): GlobalAgentState {
  const configPath = getGlobalAgentStatePath()

  if (!existsSync(configPath)) {
    return {}
  }

  try {
    const raw = readFileSync(configPath, 'utf-8')
    return JSON.parse(raw) as GlobalAgentState
  } catch {
    return {}
  }
}

function writeGlobalAgentState(state: GlobalAgentState): void {
  writeFileSync(getGlobalAgentStatePath(), JSON.stringify(state, null, 2), 'utf-8')
}

function getDeletedSkillSlugs(): Set<string> {
  return new Set(readGlobalAgentState().deletedSkillSlugs ?? [])
}

function setDeletedSkillSlug(skillSlug: string, deleted: boolean): void {
  const current = readGlobalAgentState()
  const deletedSkillSlugs = new Set(current.deletedSkillSlugs ?? [])

  if (deleted) {
    deletedSkillSlugs.add(skillSlug)
  } else {
    deletedSkillSlugs.delete(skillSlug)
  }

  writeGlobalAgentState({
    ...current,
    deletedSkillSlugs: Array.from(deletedSkillSlugs).sort(),
  })
}

export function getGlobalAgentMcpConfig(): WorkspaceMcpConfig {
  const mcpPath = getGlobalAgentMcpPath()

  if (!existsSync(mcpPath)) {
    return { servers: {} }
  }

  try {
    const raw = readFileSync(mcpPath, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<WorkspaceMcpConfig>
    return { servers: parsed.servers ?? {} }
  } catch (error) {
    log.error('[全局 Agent 配置] 读取 MCP 配置失败:', error)
    return { servers: {} }
  }
}

export function saveGlobalAgentMcpConfig(config: WorkspaceMcpConfig): void {
  writeFileSync(getGlobalAgentMcpPath(), JSON.stringify(config, null, 2), 'utf-8')
}

export function getGlobalAgentSkills(): SkillMeta[] {
  syncBuiltinSkillsToGlobalAgent()
  return scanSkillsInDir(getGlobalAgentSkillsDir(), true)
}

export function getAllGlobalAgentSkills(): SkillMeta[] {
  syncBuiltinSkillsToGlobalAgent()
  return [
    ...scanSkillsInDir(getGlobalAgentSkillsDir(), true),
    ...scanSkillsInDir(getGlobalAgentInactiveSkillsDir(), false),
  ]
}

export function getGlobalSkillLibraryEntries(): GlobalSkillEntry[] {
  return buildGlobalSkillLibraryIndex().map(({ path: _path, sourceRoot: _sourceRoot, contentPath: _contentPath, contentType: _contentType, ...entry }) => entry)
}

export function getGlobalAgentSkillDetail(skillId: string): GlobalSkillDetail {
  const entry = buildGlobalSkillLibraryIndex().find((item) => item.id === skillId)
  if (!entry) {
    throw new Error(`条目不存在: ${skillId}`)
  }

  const content = readFileSync(entry.contentPath, 'utf-8')
  return {
    ...entry,
    content,
  }
}

function assertGitHubSkillSource(input: GlobalSkillInstallInput): Required<Pick<GlobalSkillInstallInput, 'repoUrl'>> & Pick<GlobalSkillInstallInput, 'subdir' | 'slug'> {
  const repoUrl = input.repoUrl.trim()
  if (!repoUrl) throw new Error('repoUrl 不能为空')

  const isHttpsGitHub = (() => {
    try {
      const parsed = new URL(repoUrl)
      return parsed.protocol === 'https:' && parsed.hostname === 'github.com'
    } catch {
      return false
    }
  })()
  const isSshGitHub = /^git@github\.com:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(repoUrl)
  if (!isHttpsGitHub && !isSshGitHub) {
    throw new Error('仅允许从 GitHub HTTPS/SSH 仓库安装 Skill')
  }

  const subdir = input.subdir?.trim()
  if (subdir && (isAbsolute(subdir) || subdir.includes('..'))) {
    throw new Error('subdir 必须是仓库内相对路径')
  }

  const slug = input.slug?.trim()
  if (slug && !/^[a-zA-Z0-9_-]{1,80}$/.test(slug)) {
    throw new Error('slug 只能包含字母、数字、下划线和短横线')
  }

  return { repoUrl, subdir: subdir || undefined, slug: slug || undefined }
}

function deriveSkillSlug(repoUrl: string, subdir?: string, explicitSlug?: string): string {
  if (explicitSlug) return explicitSlug
  const source = subdir?.split('/').filter(Boolean).pop() || repoUrl.replace(/\.git$/, '').split(/[/:]/).filter(Boolean).pop() || 'skill'
  return source.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'skill'
}

function cloneSkillSource(repoUrl: string): string {
  const tempDir = mkdtempSync(join(tmpdir(), 'kila-skill-install-'))
  execFileSync('git', ['clone', '--depth', '1', repoUrl, tempDir], {
    stdio: 'pipe',
    timeout: 120_000,
    windowsHide: true,
  })
  return tempDir
}

function readSkillSourceLock(skillSlug: string): GlobalSkillSourceLock {
  const lockPath = join(getGlobalAgentSkillsDir(), skillSlug, SKILL_SOURCE_LOCK_FILE)
  if (!existsSync(lockPath)) {
    throw new Error(`Skill 没有来源锁文件，无法自动更新: ${skillSlug}`)
  }
  return JSON.parse(readFileSync(lockPath, 'utf-8')) as GlobalSkillSourceLock
}

function installSkillDirectory(input: GlobalSkillInstallInput, existingInstalledAt?: number): GlobalSkillInstallResult {
  const safeInput = assertGitHubSkillSource(input)
  const tempDir = cloneSkillSource(safeInput.repoUrl)
  const sourceDir = resolve(tempDir, safeInput.subdir ?? '.')
  const skillPath = join(sourceDir, 'SKILL.md')
  if (!existsSync(skillPath)) {
    rmSync(tempDir, { recursive: true, force: true })
    throw new Error('指定仓库目录内未找到 SKILL.md')
  }

  const slug = deriveSkillSlug(safeInput.repoUrl, safeInput.subdir, safeInput.slug)
  const targetPath = join(getGlobalAgentSkillsDir(), slug)
  const inactivePath = join(getGlobalAgentInactiveSkillsDir(), slug)
  rmSync(targetPath, { recursive: true, force: true })
  rmSync(inactivePath, { recursive: true, force: true })
  cpSync(sourceDir, targetPath, { recursive: true, force: false })
  rmSync(join(targetPath, '.git'), { recursive: true, force: true })

  const now = Date.now()
  const lock: GlobalSkillSourceLock = {
    version: 1,
    repoUrl: safeInput.repoUrl,
    subdir: safeInput.subdir,
    slug,
    installedAt: existingInstalledAt ?? now,
    updatedAt: now,
  }
  writeFileSync(join(targetPath, SKILL_SOURCE_LOCK_FILE), `${JSON.stringify(lock, null, 2)}\n`, 'utf-8')
  rmSync(tempDir, { recursive: true, force: true })
  setDeletedSkillSlug(slug, false)

  return {
    slug,
    path: targetPath,
    sourceUrl: safeInput.repoUrl,
    installedAt: lock.installedAt,
  }
}

export function installGlobalAgentSkill(input: GlobalSkillInstallInput): GlobalSkillInstallResult {
  return installSkillDirectory(input)
}

export function updateGlobalAgentSkill(skillSlug: string): GlobalSkillInstallResult {
  const lock = readSkillSourceLock(skillSlug)
  return installSkillDirectory({
    repoUrl: lock.repoUrl,
    subdir: lock.subdir,
    slug: lock.slug,
  }, lock.installedAt)
}

export function resolveGlobalSkillMentionEntry(mentionId: string): Pick<
  GlobalSkillDetail,
  'id' | 'slug' | 'name' | 'source' | 'sourceLabel' | 'managementMode' | 'path' | 'sourceRoot' | 'contentPath'
> | null {
  const entry = findGlobalSkillEntryByMentionId(mentionId)
  if (!entry) {
    return null
  }

  return {
    id: entry.id,
    slug: entry.slug,
    name: entry.name,
    source: entry.source,
    sourceLabel: entry.sourceLabel,
    managementMode: entry.managementMode,
    path: entry.path,
    sourceRoot: entry.sourceRoot,
    contentPath: entry.contentPath,
  }
}

export function getAllGlobalAgentCapabilities(): WorkspaceCapabilities {
  const mcpConfig = getGlobalAgentMcpConfig()
  const skills = getAllGlobalAgentSkills()

  const mcpServers = Object.entries(mcpConfig.servers ?? {}).map(([name, entry]) => ({
    name,
    enabled: entry.enabled,
    type: entry.type,
  }))

  return { mcpServers, skills }
}

export function deleteGlobalAgentSkill(skillSlug: string): void {
  const activePath = join(getGlobalAgentSkillsDir(), skillSlug)
  const inactivePath = join(getGlobalAgentInactiveSkillsDir(), skillSlug)
  const target = existsSync(activePath) ? activePath : inactivePath

  if (!existsSync(target)) {
    throw new Error(`Skill 不存在: ${skillSlug}`)
  }

  rmSync(target, { recursive: true, force: true })
  setDeletedSkillSlug(skillSlug, true)
}

export function toggleGlobalAgentSkill(skillSlug: string, enabled: boolean): void {
  const activeDir = getGlobalAgentSkillsDir()
  const inactiveDir = getGlobalAgentInactiveSkillsDir()
  const sourceDir = enabled ? inactiveDir : activeDir
  const targetDir = enabled ? activeDir : inactiveDir
  const sourcePath = join(sourceDir, skillSlug)
  const targetPath = join(targetDir, skillSlug)

  if (!existsSync(sourcePath)) {
    throw new Error(`Skill 不存在: ${skillSlug}`)
  }

  if (existsSync(targetPath)) {
    throw new Error(`目标目录已存在同名 Skill: ${skillSlug}`)
  }

  renameSync(sourcePath, targetPath)
  setDeletedSkillSlug(skillSlug, false)
}

export function toggleGlobalAgentMcpServer(
  serverName: string,
  enabled: boolean,
): { name: string; enabled: boolean; type: WorkspaceCapabilities['mcpServers'][number]['type'] } {
  const config = getGlobalAgentMcpConfig()
  const current = config.servers?.[serverName]

  if (!current) {
    throw new Error(`MCP server 不存在: ${serverName}`)
  }

  if (current.enabled !== enabled) {
    saveGlobalAgentMcpConfig({
      ...config,
      servers: {
        ...config.servers,
        [serverName]: {
          ...current,
          enabled,
        },
      },
    })
  }

  return {
    name: serverName,
    enabled,
    type: current.type,
  }
}

export function getGlobalAgentCapabilities(): WorkspaceCapabilities {
  const mcpConfig = getGlobalAgentMcpConfig()
  const skills = getGlobalAgentSkills()

  const mcpServers = Object.entries(mcpConfig.servers ?? {}).map(([name, entry]) => ({
    name,
    enabled: entry.enabled,
    type: entry.type,
  }))

  return { mcpServers, skills }
}
