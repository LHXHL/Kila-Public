import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import {
  getMemoryDir,
  getProjectProfileMemoryDir,
  getProjectProfilesDir,
} from '../config-paths'
import { getProjectProfileId } from '../project-profile-manager'
import type { MemoryProvider } from './provider'
import type {
  MemoryCategory,
  MemoryEditInput,
  MemoryEntry,
  MemoryListInput,
  MemoryProviderStatus,
  MemorySearchInput,
  MemorySearchResult,
  MemoryThreadCaptureInput,
  MemoryWriteInput,
  NotebookEditInput,
  NotebookEntry,
  NotebookWriteInput,
  WorkingMemory,
  WorkingMemoryInput,
  WorkingMemoryUpdateInput,
} from './types'

const METADATA_MARKER = 'kila-memory'
const DEFAULT_INDEX = `# Kila Memory

这是 Kila 的本地长期记忆索引。长期事实保存在 entries/，用户笔记保存在 notebook/。

## 使用原则

- 这里只记录跨会话仍然成立的偏好、决策、事实和经验。
- 临时过程留在 Session 历史，不写入长期记忆。
- 发现旧结论失效时应更新原条目，不重复追加近义内容。
`
const DEFAULT_WORKING = `# Working Memory

当前没有需要跨会话持续跟进的事项。
`
const MAX_SEARCH_RESULTS = 10

interface MarkdownMetadata {
  id: string
  kind: 'memory' | 'notebook'
  key?: string
  title?: string
  category?: MemoryCategory
  tags: string[]
  sourceSessionId?: string
  projectPath?: string
  createdAt: number
  updatedAt: number
}

interface ParsedUri {
  kind: 'memory' | 'notebook'
  scope: 'global' | 'project'
  profileId?: string
  id: string
}

function ensureDir(path: string): string {
  if (!existsSync(path)) mkdirSync(path, { recursive: true })
  return path
}

function atomicWrite(path: string, content: string): void {
  ensureDir(dirname(path))
  const tempPath = `${path}.${randomUUID()}.tmp`
  writeFileSync(tempPath, content, 'utf-8')
  renameSync(tempPath, path)
}

function normalizeTags(tags: string[] | undefined): string[] {
  return Array.from(new Set((tags ?? []).map((tag) => tag.trim()).filter(Boolean))).slice(0, 20)
}

function buildUri(kind: 'memory' | 'notebook', projectPath: string | undefined, id: string): string {
  if (!projectPath) return `${kind}://global/${id}`
  return `${kind}://project/${getProjectProfileId(projectPath)}/${id}`
}

function parseUri(uri: string): ParsedUri | null {
  const match = uri.match(/^(memory|notebook):\/\/(global|project)\/(?:([^/]+)\/)?([^/]+)$/)
  if (!match) return null
  const [, kind, scope, maybeProfile, maybeId] = match
  if (scope === 'global') {
    return { kind: kind as ParsedUri['kind'], scope: 'global', id: (maybeProfile ?? maybeId)! }
  }
  if (!maybeProfile || !maybeId) return null
  return { kind: kind as ParsedUri['kind'], scope: 'project', profileId: maybeProfile, id: maybeId }
}

function serializeMarkdown(metadata: MarkdownMetadata, content: string): string {
  const title = metadata.title?.trim() || (metadata.kind === 'notebook' ? 'Notebook' : 'Memory')
  return `<!-- ${METADATA_MARKER}\n${JSON.stringify(metadata)}\n-->\n\n# ${title}\n\n${content.trim()}\n`
}

function parseMarkdown(path: string): { metadata: MarkdownMetadata; content: string } | null {
  try {
    const raw = readFileSync(path, 'utf-8')
    const match = raw.match(/^<!-- kila-memory\n([^\n]+)\n-->\n*/)
    if (!match) return null
    const metadata = JSON.parse(match[1]!) as MarkdownMetadata
    if (!metadata.id || (metadata.kind !== 'memory' && metadata.kind !== 'notebook')) return null
    const body = raw.slice(match[0].length).replace(/^# .*\n+/, '').trim()
    return {
      metadata: { ...metadata, tags: normalizeTags(metadata.tags) },
      content: body,
    }
  } catch {
    return null
  }
}

function toTokens(value: string): Set<string> {
  const normalized = value.toLowerCase().normalize('NFKC')
  const tokens = new Set(normalized.match(/[a-z0-9]+(?:[._/-][a-z0-9]+)*/g) ?? [])
  const chinese = normalized.replaceAll(/[^㐀-鿿]/g, '')
  for (let index = 0; index < chinese.length - 1; index += 1) {
    tokens.add(chinese.slice(index, index + 2))
  }
  return tokens
}

function scoreEntry(entry: MemoryEntry, query: string): number {
  const normalizedQuery = query.toLowerCase().normalize('NFKC').trim()
  const title = entry.title?.toLowerCase().normalize('NFKC') ?? ''
  const content = entry.content.toLowerCase().normalize('NFKC')
  const tags = entry.tags.join(' ').toLowerCase().normalize('NFKC')
  let score = 0
  if (normalizedQuery && title.includes(normalizedQuery)) score += 8
  if (normalizedQuery && tags.includes(normalizedQuery)) score += 5
  if (normalizedQuery && content.includes(normalizedQuery)) score += 4

  const queryTokens = toTokens(query)
  const titleTokens = toTokens(title)
  const bodyTokens = toTokens(`${tags} ${content}`)
  for (const token of queryTokens) {
    if (titleTokens.has(token)) score += 2.5
    if (bodyTokens.has(token)) score += 1
  }
  return score
}

function listMarkdownFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => join(dir, entry.name))
}

export class LocalMarkdownMemoryProvider implements MemoryProvider {
  private readonly projectRoots = new Map<string, string>()
  private lastMutationAt = 0

  constructor(private readonly options: {
    globalRoot?: string
    projectRoot?: (projectPath: string) => string
    now?: () => number
  } = {}) {}

  initialize(): void {
    this.ensureLayout()
  }

  dispose(): void {}

  async healthCheck(): Promise<boolean> {
    this.ensureLayout()
    return true
  }

  async getStatus(): Promise<MemoryProviderStatus> {
    this.ensureLayout()
    return {
      mode: 'local',
      activeProvider: 'local',
      localReady: true,
      memoryDirectory: this.globalRoot(),
      nowledgeEnabled: false,
      nowledgeConfigured: false,
      nowledgeHealthy: false,
      checkedAt: Date.now(),
      detail: '本地 Markdown 记忆可用',
    }
  }

  async search(input: MemorySearchInput): Promise<MemorySearchResult[]> {
    const entries = await this.list({ projectPath: input.projectPath, limit: 2_000 })
    return entries
      .map((entry) => ({ entry, score: scoreEntry(entry, input.query) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.entry.updatedAt - a.entry.updatedAt)
      .slice(0, Math.min(Math.max(input.limit ?? 4, 1), MAX_SEARCH_RESULTS))
      .map((item) => ({
        ...item,
        relevanceReason: 'local markdown lexical match',
        matchedSnippet: item.entry.content.slice(0, 240),
      }))
  }

  async read(uri: string): Promise<MemoryEntry | null> {
    const parsed = parseUri(uri)
    if (!parsed || parsed.kind !== 'memory') return null
    const record = parseMarkdown(this.recordPath(parsed))
    return record ? this.toMemoryEntry(record.metadata, record.content) : null
  }

  async write(input: MemoryWriteInput): Promise<MemoryEntry> {
    this.ensureLayout(input.projectPath)
    const now = this.nextMutationTimestamp()
    const metadata: MarkdownMetadata = {
      id: randomUUID(),
      kind: 'memory',
      key: input.key?.trim() || undefined,
      title: input.title?.trim() || undefined,
      category: input.category ?? 'general',
      tags: normalizeTags(input.tags),
      sourceSessionId: input.sourceSessionId,
      projectPath: input.projectPath,
      createdAt: now,
      updatedAt: now,
    }
    const uri = buildUri('memory', input.projectPath, metadata.id)
    atomicWrite(this.recordPath(parseUri(uri)!), serializeMarkdown(metadata, input.content))
    return this.toMemoryEntry(metadata, input.content.trim())
  }

  async edit(input: MemoryEditInput): Promise<MemoryEntry | null> {
    const current = await this.read(input.uri)
    if (!current) return null
    const metadata: MarkdownMetadata = {
      id: current.id,
      kind: 'memory',
      key: input.key ?? current.key,
      title: input.title ?? current.title,
      category: input.category ?? current.category,
      tags: normalizeTags(input.tags ?? current.tags),
      sourceSessionId: current.sourceSessionId,
      projectPath: current.projectPath,
      createdAt: current.createdAt,
      updatedAt: this.nextMutationTimestamp(current.updatedAt),
    }
    const content = input.content ?? current.content
    atomicWrite(this.recordPath(parseUri(input.uri)!), serializeMarkdown(metadata, content))
    return this.toMemoryEntry(metadata, content.trim())
  }

  async forget(uri: string): Promise<boolean> {
    const parsed = parseUri(uri)
    if (!parsed || parsed.kind !== 'memory') return false
    const path = this.recordPath(parsed)
    if (!existsSync(path)) return false
    rmSync(path, { force: true })
    return true
  }

  async list(input: MemoryListInput = {}): Promise<MemoryEntry[]> {
    this.ensureLayout(input.projectPath)
    const projectRoots = input.projectPath
      ? [this.projectRoot(input.projectPath)]
      : this.allProjectRoots()
    const files = [
      ...listMarkdownFiles(join(this.globalRoot(), 'entries')),
      ...projectRoots.flatMap((root) => listMarkdownFiles(join(root, 'entries'))),
    ]
    return files
      .map((path) => parseMarkdown(path))
      .filter((record): record is NonNullable<ReturnType<typeof parseMarkdown>> => Boolean(record?.metadata.kind === 'memory'))
      .map((record) => this.toMemoryEntry(record.metadata, record.content))
      .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
      .slice(input.offset ?? 0, (input.offset ?? 0) + Math.min(Math.max(input.limit ?? 50, 1), 2_000))
  }

  async captureThread(_input: MemoryThreadCaptureInput): Promise<void> {}

  async getWorkingMemory(input: WorkingMemoryInput): Promise<WorkingMemory | null> {
    this.ensureLayout(input.projectPath)
    const path = this.workingPath(input.scope, input.projectPath)
    if (!existsSync(path)) return null
    const content = readFileSync(path, 'utf-8').trim()
    return {
      scope: input.scope,
      projectPath: input.projectPath,
      content,
      updatedAt: statSync(path).mtimeMs,
    }
  }

  async setWorkingMemory(input: WorkingMemoryUpdateInput): Promise<WorkingMemory> {
    this.ensureLayout(input.projectPath)
    const path = this.workingPath(input.scope, input.projectPath)
    atomicWrite(path, `${input.content.trim()}\n`)
    return {
      scope: input.scope,
      projectPath: input.projectPath,
      content: input.content.trim(),
      updatedAt: statSync(path).mtimeMs,
    }
  }

  async listNotebookEntries(input: MemoryListInput = {}): Promise<NotebookEntry[]> {
    this.ensureLayout(input.projectPath)
    const files = [
      ...listMarkdownFiles(join(this.globalRoot(), 'notebook')),
      ...(input.projectPath ? listMarkdownFiles(join(this.projectRoot(input.projectPath), 'notebook')) : []),
    ]
    return files
      .map((path) => parseMarkdown(path))
      .filter((record): record is NonNullable<ReturnType<typeof parseMarkdown>> => Boolean(record?.metadata.kind === 'notebook'))
      .map((record) => this.toNotebookEntry(record.metadata, record.content))
      .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
      .slice(input.offset ?? 0, (input.offset ?? 0) + Math.min(Math.max(input.limit ?? 20, 1), 2_000))
  }

  async readNotebookEntry(uri: string): Promise<NotebookEntry | null> {
    const parsed = parseUri(uri)
    if (!parsed || parsed.kind !== 'notebook') return null
    const record = parseMarkdown(this.recordPath(parsed))
    return record ? this.toNotebookEntry(record.metadata, record.content) : null
  }

  async writeNotebookEntry(input: NotebookWriteInput): Promise<NotebookEntry> {
    this.ensureLayout(input.projectPath)
    const now = this.nextMutationTimestamp()
    const metadata: MarkdownMetadata = {
      id: randomUUID(),
      kind: 'notebook',
      key: input.key?.trim() || undefined,
      title: input.title?.trim() || undefined,
      tags: normalizeTags(input.tags),
      sourceSessionId: input.sourceSessionId,
      projectPath: input.projectPath,
      createdAt: now,
      updatedAt: now,
    }
    const uri = buildUri('notebook', input.projectPath, metadata.id)
    atomicWrite(this.recordPath(parseUri(uri)!), serializeMarkdown(metadata, input.content))
    return this.toNotebookEntry(metadata, input.content.trim())
  }

  async editNotebookEntry(input: NotebookEditInput): Promise<NotebookEntry | null> {
    const current = await this.readNotebookEntry(input.uri)
    if (!current) return null
    const metadata: MarkdownMetadata = {
      id: current.id,
      kind: 'notebook',
      key: input.key ?? current.key,
      title: input.title ?? current.title,
      tags: normalizeTags(input.tags ?? current.tags),
      sourceSessionId: current.sourceSessionId,
      projectPath: current.projectPath,
      createdAt: current.createdAt,
      updatedAt: this.nextMutationTimestamp(current.updatedAt),
    }
    const content = input.content ?? current.content
    atomicWrite(this.recordPath(parseUri(input.uri)!), serializeMarkdown(metadata, content))
    return this.toNotebookEntry(metadata, content.trim())
  }

  async forgetNotebookEntry(uri: string): Promise<boolean> {
    const parsed = parseUri(uri)
    if (!parsed || parsed.kind !== 'notebook') return false
    const path = this.recordPath(parsed)
    if (!existsSync(path)) return false
    rmSync(path, { force: true })
    return true
  }

  getIndexContext(projectPath?: string): string {
    this.ensureLayout(projectPath)
    const chunks = [readFileSync(join(this.globalRoot(), 'MEMORY.md'), 'utf-8').trim()]
    if (projectPath) chunks.push(readFileSync(join(this.projectRoot(projectPath), 'MEMORY.md'), 'utf-8').trim())
    return chunks.filter(Boolean).join('\n\n')
  }


  /** 同一毫秒内连续写入也保持严格递增，避免列表顺序退化为随机 UUID 排序。 */
  private nextMutationTimestamp(floor = 0): number {
    const now = this.options.now?.() ?? Date.now()
    const next = Math.max(now, this.lastMutationAt + 1, floor + 1)
    this.lastMutationAt = next
    return next
  }

  private ensureLayout(projectPath?: string): void {
    const globalRoot = this.globalRoot()
    ensureDir(join(globalRoot, 'entries'))
    ensureDir(join(globalRoot, 'notebook'))
    if (!existsSync(join(globalRoot, 'MEMORY.md'))) atomicWrite(join(globalRoot, 'MEMORY.md'), DEFAULT_INDEX)
    if (!existsSync(join(globalRoot, 'PROFILE.md'))) atomicWrite(join(globalRoot, 'PROFILE.md'), '# User Profile\n\n尚未形成稳定用户画像。\n')
    if (!existsSync(join(globalRoot, 'WORKING.md'))) atomicWrite(join(globalRoot, 'WORKING.md'), DEFAULT_WORKING)

    if (projectPath) {
      const projectRoot = this.projectRoot(projectPath)
      ensureDir(join(projectRoot, 'entries'))
      ensureDir(join(projectRoot, 'notebook'))
      if (!existsSync(join(projectRoot, 'MEMORY.md'))) atomicWrite(join(projectRoot, 'MEMORY.md'), DEFAULT_INDEX)
      if (!existsSync(join(projectRoot, 'WORKING.md'))) atomicWrite(join(projectRoot, 'WORKING.md'), DEFAULT_WORKING)
    }
  }

  private projectRoot(projectPath: string): string {
    const profileId = getProjectProfileId(projectPath)
    const root = this.options.projectRoot?.(projectPath)
      ?? getProjectProfileMemoryDir(profileId)
    this.projectRoots.set(profileId, root)
    return root
  }

  private allProjectRoots(): string[] {
    if (this.options.projectRoot) return Array.from(this.projectRoots.values())
    const profilesRoot = getProjectProfilesDir()
    return readdirSync(profilesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(profilesRoot, entry.name, 'memory'))
  }

  private globalRoot(): string {
    return this.options.globalRoot ?? getMemoryDir()
  }

  private recordPath(parsed: ParsedUri): string {
    const root = parsed.scope === 'global'
      ? this.globalRoot()
      : this.projectRoots.get(parsed.profileId!) ?? getProjectProfileMemoryDir(parsed.profileId!)
    const dir = parsed.kind === 'memory' ? 'entries' : 'notebook'
    return join(root, dir, `${basename(parsed.id)}.md`)
  }

  private workingPath(scope: WorkingMemoryInput['scope'], projectPath?: string): string {
    if (scope === 'project') {
      if (!projectPath) throw new Error('project working memory requires projectPath')
      return join(this.projectRoot(projectPath), 'WORKING.md')
    }
    return join(this.globalRoot(), 'WORKING.md')
  }

  private toMemoryEntry(metadata: MarkdownMetadata, content: string): MemoryEntry {
    return {
      id: metadata.id,
      uri: buildUri('memory', metadata.projectPath, metadata.id),
      kind: 'memory',
      key: metadata.key,
      title: metadata.title,
      content,
      category: metadata.category ?? 'general',
      tags: metadata.tags,
      sourceSessionId: metadata.sourceSessionId,
      projectPath: metadata.projectPath,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
    }
  }

  private toNotebookEntry(metadata: MarkdownMetadata, content: string): NotebookEntry {
    return {
      id: metadata.id,
      uri: buildUri('notebook', metadata.projectPath, metadata.id),
      kind: 'notebook',
      key: metadata.key,
      title: metadata.title,
      content,
      tags: metadata.tags,
      sourceSessionId: metadata.sourceSessionId,
      projectPath: metadata.projectPath,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
    }
  }
}
