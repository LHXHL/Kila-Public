import type {
  CliAskUserResponseRequest,
  CliBridgeChannelModelsResponse,
  CliBridgeChannelResponse,
  CliBridgeChannelsResponse,
  CliBridgeConfigListResponse,
  CliBridgeConfigSetRequest,
  CliBridgeConfigValueResponse,
  CliBridgeDailyReportResponse,
  CliBridgeDiscovery,
  CliBridgeHealthResponse,
  CliBridgeMcpServerResponse,
  CliBridgePersonalityResponse,
  CliBridgeProvidersResponse,
  CliBridgePersonalityUpdateRequest,
  CliBridgeSessionCreateRequest,
  CliBridgeSessionResponse,
  CliBridgeSessionsResponse,
  CliBridgeSessionMessagesResponse,
  CliBridgeSkillResponse,
  CliBridgeStatusResponse,
  CliBridgeTaskCreateRequest,
  CliBridgeTaskListResponse,
  CliBridgeTaskResponse,
  CliBridgeTaskRunsResponse,
  CliBridgeTaskRuntimeResponse,
  CliBridgeTaskUpdateRequest,
  CliConfigValue,
  CliPermissionResponseRequest,
  CliRunRequest,
  CliRunSseEvent,
  CliBridgeCapabilitiesResponse,
  ThinkingLevel,
} from '@kila/shared'
import { withHint } from '../format/hints'
import { parseSseStream } from './sse-parser'
import { getCliBridgeDiscoveryPath, readCliBridgeDiscovery } from './discovery'

export interface BridgeInspection {
  discoveryPath: string
  discovery: CliBridgeDiscovery | null
  health: CliBridgeHealthResponse | null
  staleDiscovery: boolean
}

async function fetchHealth(
  discovery: CliBridgeDiscovery,
): Promise<CliBridgeHealthResponse | null> {
  try {
    const response = await fetch(`http://${discovery.host}:${discovery.port}/v1/health`, {
      headers: {
        Authorization: `Bearer ${discovery.token}`,
      },
    })
    if (!response.ok) return null
    return await response.json() as CliBridgeHealthResponse
  } catch {
    return null
  }
}

export async function inspectBridgeConnection(): Promise<BridgeInspection> {
  const discoveryPath = getCliBridgeDiscoveryPath()
  const discovery = readCliBridgeDiscovery()
  if (!discovery) {
    return {
      discoveryPath,
      discovery: null,
      health: null,
      staleDiscovery: false,
    }
  }

  const health = await fetchHealth(discovery)
  return {
    discoveryPath,
    discovery,
    health,
    staleDiscovery: health === null,
  }
}

export async function connectToBridge(): Promise<CliBridgeClient | null> {
  const inspection = await inspectBridgeConnection()
  if (!inspection.discovery || !inspection.health) {
    return null
  }

  return new CliBridgeClient(inspection.discovery)
}

export async function connectToBridgeOrThrow(): Promise<CliBridgeClient> {
  const client = await connectToBridge()
  if (client) return client
  throw new Error(withHint(
    'Kila Desktop bridge 不可用，请先启动桌面应用。',
    '启动 Kila Desktop 后运行 `kila status` 或 `kila doctor`',
  ))
}

export class CliBridgeClient {
  constructor(private readonly discovery: CliBridgeDiscovery) {}

  get baseUrl(): string {
    return `http://${this.discovery.host}:${this.discovery.port}`
  }

  private get headers(): HeadersInit {
    return {
      Authorization: `Bearer ${this.discovery.token}`,
    }
  }

  private async requestJson<T>(
    path: string,
    init?: RequestInit,
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        ...this.headers,
        ...(init?.headers ?? {}),
      },
    })

    if (!response.ok) {
      let message = `${response.status} ${response.statusText}`
      try {
        const body = await response.json() as { error?: string }
        if (body.error) message = body.error
      } catch {
        // ignore json parse failure
      }
      throw new Error(message)
    }

    return await response.json() as T
  }

  async getStatus(): Promise<CliBridgeStatusResponse> {
    return this.requestJson('/v1/status')
  }

  async listChannels(): Promise<CliBridgeChannelsResponse> {
    return this.requestJson('/v1/channels')
  }

  async getChannel(channelId: string): Promise<CliBridgeChannelResponse> {
    return this.requestJson(`/v1/channels/${encodeURIComponent(channelId)}`)
  }

  async listChannelModels(channelId: string): Promise<CliBridgeChannelModelsResponse> {
    return this.requestJson(`/v1/channels/${encodeURIComponent(channelId)}/models`)
  }

  async listProviders(): Promise<CliBridgeProvidersResponse> {
    return this.requestJson('/v1/providers')
  }

  async getCapabilities(): Promise<CliBridgeCapabilitiesResponse> {
    return this.requestJson('/v1/capabilities')
  }

  async listSessions(limit = 20): Promise<CliBridgeSessionsResponse> {
    return this.requestJson(`/v1/sessions?limit=${limit}`)
  }

  async getSessionMessages(
    sessionId: string,
    limit = 100,
  ): Promise<CliBridgeSessionMessagesResponse> {
    return this.requestJson(`/v1/sessions/${encodeURIComponent(sessionId)}/messages?limit=${limit}`)
  }

  async getSession(sessionId: string): Promise<CliBridgeSessionResponse> {
    return this.requestJson(`/v1/sessions/${encodeURIComponent(sessionId)}`)
  }

  async createSession(body: CliBridgeSessionCreateRequest): Promise<CliBridgeSessionResponse> {
    return this.requestJson('/v1/sessions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  }

  async updateSession(
    sessionId: string,
    body: {
      title?: string
      pinned?: boolean
      projectPath?: string
      channelId?: string
      modelId?: string
      thinkingLevel?: ThinkingLevel
      historyTurns?: number | 'infinite'
      enabledToolIds?: string[]
    },
  ): Promise<CliBridgeSessionResponse> {
    return this.requestJson(`/v1/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.requestJson(`/v1/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
    })
  }

  async getPersonality(kind: 'soul' | 'user'): Promise<CliBridgePersonalityResponse> {
    return this.requestJson(`/v1/personality/${kind}`)
  }

  async updatePersonality(
    kind: 'soul' | 'user',
    content: string,
  ): Promise<CliBridgePersonalityResponse> {
    return this.requestJson(`/v1/personality/${kind}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ content } satisfies CliBridgePersonalityUpdateRequest),
    })
  }

  async stopSession(sessionId: string): Promise<void> {
    await this.requestJson(`/v1/sessions/${encodeURIComponent(sessionId)}/stop`, {
      method: 'POST',
    })
  }

  async respondToPermission(
    body: CliPermissionResponseRequest,
  ): Promise<void> {
    await this.requestJson('/v1/permissions/respond', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  }

  async respondToAskUser(
    body: CliAskUserResponseRequest,
  ): Promise<void> {
    await this.requestJson('/v1/ask-user/respond', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  }

  async *run(
    body: CliRunRequest,
  ): AsyncIterable<CliRunSseEvent> {
    const response = await fetch(`${this.baseUrl}/v1/run`, {
      method: 'POST',
      headers: {
        ...this.headers,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      let message = `${response.status} ${response.statusText}`
      try {
        const payload = await response.json() as { error?: string }
        if (payload.error) message = payload.error
      } catch {
        // ignore response parse failure
      }
      throw new Error(message)
    }

    if (!response.body) {
      throw new Error('bridge 未返回 SSE body')
    }

    yield * parseSseStream(response.body)
  }

  async resolveSessionId(ref: string): Promise<string> {
    const sessions = (await this.listSessions(500)).sessions
    const exact = sessions.find((session) => session.id === ref)
    if (exact) return exact.id

    const matches = sessions.filter((session) => session.id.startsWith(ref))
    if (matches.length === 1) return matches[0]!.id
    if (matches.length > 1) {
      throw new Error(withHint(
        `session 前缀有歧义: ${ref}。`,
        '`kila sessions` 查看完整 ID，再运行 `kila session show <id>`',
      ))
    }

    throw new Error(withHint(
      `session 不存在: ${ref}。`,
      '`kila sessions` 查看候选项',
    ))
  }

  async resolveChannelId(ref: string): Promise<string> {
    const channels = (await this.listChannels()).channels
    const exactId = channels.find((channel) => channel.id === ref)
    if (exactId) return exactId.id

    const exactName = channels.find((channel) => channel.name.toLowerCase() === ref.toLowerCase())
    if (exactName) return exactName.id

    const prefixMatches = channels.filter((channel) => channel.id.startsWith(ref))
    if (prefixMatches.length === 1) return prefixMatches[0]!.id
    if (prefixMatches.length > 1) {
      throw new Error(withHint(
        `channel 前缀有歧义: ${ref}。`,
        '`kila channels` 查看完整 ID，再运行 `kila channel show <id>`',
      ))
    }

    throw new Error(withHint(
      `channel 不存在: ${ref}。`,
      '`kila channels` 查看可用渠道',
    ))
  }

  async resolveMcpServerName(ref: string): Promise<string> {
    const capabilities = await this.getCapabilities()
    const exact = capabilities.mcpServers.find((server) => server.name === ref)
    if (exact) return exact.name

    const exactCaseInsensitive = capabilities.mcpServers.find((server) => server.name.toLowerCase() === ref.toLowerCase())
    if (exactCaseInsensitive) return exactCaseInsensitive.name

    const prefixMatches = capabilities.mcpServers.filter((server) => server.name.startsWith(ref))
    if (prefixMatches.length === 1) return prefixMatches[0]!.name
    if (prefixMatches.length > 1) {
      throw new Error(withHint(
        `MCP server 前缀有歧义: ${ref}。`,
        '`kila mcp list` 查看精确名称',
      ))
    }

    throw new Error(withHint(
      `MCP server 不存在: ${ref}。`,
      '`kila mcp list` 查看可用 MCP',
    ))
  }

  async resolveSkillSlug(ref: string): Promise<string> {
    const capabilities = await this.getCapabilities()
    const exactSlug = capabilities.skills.find((skill) => skill.slug === ref)
    if (exactSlug) return exactSlug.slug

    const exactName = capabilities.skills.find((skill) => skill.name.toLowerCase() === ref.toLowerCase())
    if (exactName) return exactName.slug

    const prefixMatches = capabilities.skills.filter((skill) => skill.slug.startsWith(ref))
    if (prefixMatches.length === 1) return prefixMatches[0]!.slug
    if (prefixMatches.length > 1) {
      throw new Error(withHint(
        `skill 前缀有歧义: ${ref}。`,
        '`kila skills list` 查看精确 slug',
      ))
    }

    throw new Error(withHint(
      `skill 不存在: ${ref}。`,
      '`kila skills list` 查看可用 Skills',
    ))
  }

  async toggleMcpServer(
    serverName: string,
    enabled: boolean,
  ): Promise<CliBridgeMcpServerResponse> {
    return this.requestJson(`/v1/mcp/${encodeURIComponent(serverName)}/${enabled ? 'enable' : 'disable'}`, {
      method: 'POST',
    })
  }

  async toggleSkill(
    skillSlug: string,
    enabled: boolean,
  ): Promise<CliBridgeSkillResponse> {
    return this.requestJson(`/v1/skills/${encodeURIComponent(skillSlug)}/${enabled ? 'enable' : 'disable'}`, {
      method: 'POST',
    })
  }

  async listConfig(): Promise<CliBridgeConfigListResponse> {
    return this.requestJson('/v1/config')
  }

  async getConfig(path: string): Promise<CliBridgeConfigValueResponse> {
    return this.requestJson(`/v1/config/${encodeURIComponent(path)}`)
  }

  async setConfig(path: string, value: CliConfigValue): Promise<CliBridgeConfigValueResponse> {
    return this.requestJson('/v1/config', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ path, value } satisfies CliBridgeConfigSetRequest),
    })
  }

  async listTasks(): Promise<CliBridgeTaskListResponse> {
    return this.requestJson('/v1/tasks')
  }

  async getTask(taskId: string): Promise<CliBridgeTaskResponse> {
    return this.requestJson(`/v1/tasks/${encodeURIComponent(taskId)}`)
  }

  async createTask(body: CliBridgeTaskCreateRequest): Promise<CliBridgeTaskResponse> {
    return this.requestJson('/v1/tasks', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  }

  async updateTask(taskId: string, body: CliBridgeTaskUpdateRequest): Promise<CliBridgeTaskResponse> {
    return this.requestJson(`/v1/tasks/${encodeURIComponent(taskId)}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  }

  async deleteTask(taskId: string): Promise<void> {
    await this.requestJson(`/v1/tasks/${encodeURIComponent(taskId)}`, {
      method: 'DELETE',
    })
  }

  async startTask(taskId: string): Promise<CliBridgeTaskResponse> {
    return this.requestJson(`/v1/tasks/${encodeURIComponent(taskId)}/start`, {
      method: 'POST',
    })
  }

  async stopTask(taskId: string): Promise<CliBridgeTaskResponse> {
    return this.requestJson(`/v1/tasks/${encodeURIComponent(taskId)}/stop`, {
      method: 'POST',
    })
  }

  async runTask(taskId: string): Promise<CliBridgeTaskResponse> {
    return this.requestJson(`/v1/tasks/${encodeURIComponent(taskId)}/run`, {
      method: 'POST',
    })
  }

  async listTaskRuns(taskId: string, limit = 50): Promise<CliBridgeTaskRunsResponse> {
    return this.requestJson(`/v1/tasks/${encodeURIComponent(taskId)}/runs?limit=${limit}`)
  }

  async getTaskRuntime(): Promise<CliBridgeTaskRuntimeResponse> {
    return this.requestJson('/v1/tasks/runtime')
  }

  async getDailyReport(date?: string): Promise<CliBridgeDailyReportResponse> {
    const query = date ? `?date=${encodeURIComponent(date)}` : ''
    return this.requestJson(`/v1/reports/daily${query}`)
  }

  async resolveTaskId(ref: string): Promise<string> {
    const tasks = (await this.listTasks()).tasks
    const exact = tasks.find((task) => task.id === ref)
    if (exact) return exact.id

    const prefixMatches = tasks.filter((task) => task.id.startsWith(ref))
    if (prefixMatches.length === 1) return prefixMatches[0]!.id
    if (prefixMatches.length > 1) {
      throw new Error(withHint(
        `task 前缀有歧义: ${ref}。`,
        '`kila task list` 查看完整 ID，再运行 `kila task show <id>`',
      ))
    }

    throw new Error(withHint(
      `task 不存在: ${ref}。`,
      '`kila task list` 查看可用任务',
    ))
  }
}
