import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { app } from 'electron'
import {
  CLI_BRIDGE_VERSION,
  type CliBridgeDiscovery,
  type ThinkingLevel,
} from '@kila/shared'
import { ensureAuthorizedRequest } from './auth'
import { broadcastSessionChannel } from './broadcaster'
import { removeCliBridgeDiscovery, writeCliBridgeDiscovery } from './discovery'
import { sendError, sendMethodNotAllowed, parseLimitParam } from './http'
import { handleCliBridgeAskUserResponse } from './routes/ask-user'
import {
  handleCliBridgeCapabilities,
  handleCliBridgeToggleMcpServer,
  handleCliBridgeToggleSkill,
} from './routes/capabilities'
import {
  handleCliBridgeChannel,
  handleCliBridgeChannelModels,
  handleCliBridgeChannels,
  handleCliBridgeProviders,
} from './routes/channels'
import {
  handleCliBridgeConfigGet,
  handleCliBridgeConfigList,
  handleCliBridgeConfigSet,
} from './routes/config'
import { handleCliBridgeHealth } from './routes/health'
import {
  handleCliBridgePersonality,
  handleCliBridgeUpdatePersonality,
} from './routes/personality'
import { handleCliBridgePermissionResponse } from './routes/permissions'
import { handleCliBridgeDailyReport } from './routes/reports'
import { handleCliBridgeRun } from './routes/run'
import {
  handleCliBridgeCreateSession,
  handleCliBridgeDeleteSession,
  handleCliBridgeSession,
  handleCliBridgeSessionMessages,
  handleCliBridgeSessions,
  handleCliBridgeUpdateSession,
} from './routes/sessions'
import { handleCliBridgeStatus } from './routes/status'
import { handleCliBridgeStop } from './routes/stop'
import {
  handleCliBridgeCreateTask,
  handleCliBridgeDeleteTask,
  handleCliBridgeRunTask,
  handleCliBridgeStartTask,
  handleCliBridgeStopTask,
  handleCliBridgeTask,
  handleCliBridgeTaskRuns,
  handleCliBridgeTasks,
  handleCliBridgeTaskRuntime,
  handleCliBridgeUpdateTask,
} from './routes/tasks'
import { readJsonBody } from './http'
import type { CliBridgeRouteContext, CliBridgeServerState } from './types'

import { createLogger } from '../logger'
const log = createLogger('CLI Bridge')

let activeServer: Server | null = null
let activeState: CliBridgeServerState | null = null

function createDiscovery(port: number): CliBridgeDiscovery {
  return {
    version: 1,
    transport: 'http',
    host: '127.0.0.1',
    port,
    token: randomBytes(24).toString('base64url'),
    pid: process.pid,
    startedAt: Date.now(),
    appVersion: app.getVersion(),
    bridgeVersion: CLI_BRIDGE_VERSION,
  }
}

function buildRouteContext(): CliBridgeRouteContext {
  return {
    appVersion: app.getVersion(),
    broadcastSessionChannel,
  }
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  state: CliBridgeServerState,
): Promise<void> {
  if (!ensureAuthorizedRequest(request, response, state.discovery.token)) {
    return
  }

  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  const method = request.method ?? 'GET'
  const pathname = url.pathname
  const context = buildRouteContext()

  if (pathname === '/v1/health') {
    if (method !== 'GET') {
      sendMethodNotAllowed(response, ['GET'])
      return
    }
    handleCliBridgeHealth(response, context.appVersion)
    return
  }

  if (pathname === '/v1/status') {
    if (method !== 'GET') {
      sendMethodNotAllowed(response, ['GET'])
      return
    }
    handleCliBridgeStatus(response, context.appVersion)
    return
  }

  if (pathname === '/v1/channels') {
    if (method !== 'GET') {
      sendMethodNotAllowed(response, ['GET'])
      return
    }
    handleCliBridgeChannels(response)
    return
  }

  if (pathname === '/v1/providers') {
    if (method !== 'GET') {
      sendMethodNotAllowed(response, ['GET'])
      return
    }
    handleCliBridgeProviders(response)
    return
  }

  const channelMatch = pathname.match(/^\/v1\/channels\/([^/]+)$/)
  if (channelMatch?.[1]) {
    if (method !== 'GET') {
      sendMethodNotAllowed(response, ['GET'])
      return
    }
    handleCliBridgeChannel(response, decodeURIComponent(channelMatch[1]))
    return
  }

  const channelModelsMatch = pathname.match(/^\/v1\/channels\/([^/]+)\/models$/)
  if (channelModelsMatch?.[1]) {
    if (method !== 'GET') {
      sendMethodNotAllowed(response, ['GET'])
      return
    }
    handleCliBridgeChannelModels(response, decodeURIComponent(channelModelsMatch[1]))
    return
  }

  if (pathname === '/v1/capabilities') {
    if (method !== 'GET') {
      sendMethodNotAllowed(response, ['GET'])
      return
    }
    handleCliBridgeCapabilities(response)
    return
  }

  if (pathname === '/v1/personality/soul') {
    if (method === 'GET') {
      handleCliBridgePersonality(response, 'soul')
      return
    }
    if (method === 'PUT') {
      await handleCliBridgeUpdatePersonality(request, response, 'soul')
      return
    }
    sendMethodNotAllowed(response, ['GET', 'PUT'])
    return
  }

  if (pathname === '/v1/personality/user') {
    if (method === 'GET') {
      handleCliBridgePersonality(response, 'user')
      return
    }
    if (method === 'PUT') {
      await handleCliBridgeUpdatePersonality(request, response, 'user')
      return
    }
    sendMethodNotAllowed(response, ['GET', 'PUT'])
    return
  }

  if (pathname === '/v1/sessions') {
    if (method === 'GET') {
      handleCliBridgeSessions(response, parseLimitParam(url.searchParams.get('limit'), 20))
      return
    }
    if (method === 'POST') {
      const body = await readJsonBody<{
        title?: string
        projectPath?: string
        channelId?: string
        modelId?: string
      }>(request)
      handleCliBridgeCreateSession(response, body)
      return
    }
    sendMethodNotAllowed(response, ['GET', 'POST'])
    return
  }

  const sessionMatch = pathname.match(/^\/v1\/sessions\/([^/]+)$/)
  if (sessionMatch?.[1]) {
    const sessionId = decodeURIComponent(sessionMatch[1])
    if (method === 'GET') {
      handleCliBridgeSession(response, sessionId)
      return
    }
    if (method === 'PATCH') {
      const body = await readJsonBody<{
        title?: string
        pinned?: boolean
        projectPath?: string
        channelId?: string
        modelId?: string
        thinkingLevel?: ThinkingLevel
        historyTurns?: number | 'infinite'
        enabledToolIds?: string[]
      }>(request)
      handleCliBridgeUpdateSession(response, sessionId, body)
      return
    }
    if (method === 'DELETE') {
      await handleCliBridgeDeleteSession(response, sessionId)
      return
    }
    sendMethodNotAllowed(response, ['GET', 'PATCH', 'DELETE'])
    return
  }

  const sessionMessagesMatch = pathname.match(/^\/v1\/sessions\/([^/]+)\/messages$/)
  if (sessionMessagesMatch?.[1]) {
    if (method !== 'GET') {
      sendMethodNotAllowed(response, ['GET'])
      return
    }
    handleCliBridgeSessionMessages(
      response,
      decodeURIComponent(sessionMessagesMatch[1]),
      parseLimitParam(url.searchParams.get('limit'), 100),
    )
    return
  }

  const sessionStopMatch = pathname.match(/^\/v1\/sessions\/([^/]+)\/stop$/)
  if (sessionStopMatch?.[1]) {
    if (method !== 'POST') {
      sendMethodNotAllowed(response, ['POST'])
      return
    }
    handleCliBridgeStop(response, decodeURIComponent(sessionStopMatch[1]))
    return
  }

  if (pathname === '/v1/run') {
    if (method !== 'POST') {
      sendMethodNotAllowed(response, ['POST'])
      return
    }
    await handleCliBridgeRun(request, response, context)
    return
  }

  if (pathname === '/v1/tasks') {
    if (method === 'GET') {
      handleCliBridgeTasks(response)
      return
    }
    if (method === 'POST') {
      await handleCliBridgeCreateTask(request, response)
      return
    }
    sendMethodNotAllowed(response, ['GET', 'POST'])
    return
  }

  if (pathname === '/v1/tasks/runtime') {
    if (method !== 'GET') {
      sendMethodNotAllowed(response, ['GET'])
      return
    }
    handleCliBridgeTaskRuntime(response)
    return
  }

  const taskMatch = pathname.match(/^\/v1\/tasks\/([^/]+)$/)
  if (taskMatch?.[1]) {
    const taskId = decodeURIComponent(taskMatch[1])
    if (method === 'GET') {
      handleCliBridgeTask(response, taskId)
      return
    }
    if (method === 'PATCH') {
      await handleCliBridgeUpdateTask(request, response, taskId)
      return
    }
    if (method === 'DELETE') {
      await handleCliBridgeDeleteTask(response, taskId)
      return
    }
    sendMethodNotAllowed(response, ['GET', 'PATCH', 'DELETE'])
    return
  }

  const taskRunsMatch = pathname.match(/^\/v1\/tasks\/([^/]+)\/runs$/)
  if (taskRunsMatch?.[1]) {
    if (method !== 'GET') {
      sendMethodNotAllowed(response, ['GET'])
      return
    }
    handleCliBridgeTaskRuns(
      response,
      decodeURIComponent(taskRunsMatch[1]),
      parseLimitParam(url.searchParams.get('limit'), 50),
    )
    return
  }

  const taskActionMatch = pathname.match(/^\/v1\/tasks\/([^/]+)\/(start|stop|run)$/)
  if (taskActionMatch?.[1] && taskActionMatch[2]) {
    if (method !== 'POST') {
      sendMethodNotAllowed(response, ['POST'])
      return
    }
    const taskId = decodeURIComponent(taskActionMatch[1])
    if (taskActionMatch[2] === 'start') {
      await handleCliBridgeStartTask(response, taskId)
      return
    }
    if (taskActionMatch[2] === 'stop') {
      await handleCliBridgeStopTask(response, taskId)
      return
    }
    await handleCliBridgeRunTask(response, taskId)
    return
  }

  if (pathname === '/v1/config') {
    if (method === 'GET') {
      handleCliBridgeConfigList(response)
      return
    }
    if (method === 'POST') {
      await handleCliBridgeConfigSet(request, response)
      return
    }
    sendMethodNotAllowed(response, ['GET', 'POST'])
    return
  }

  const configMatch = pathname.match(/^\/v1\/config\/(.+)$/)
  if (configMatch?.[1]) {
    if (method !== 'GET') {
      sendMethodNotAllowed(response, ['GET'])
      return
    }
    handleCliBridgeConfigGet(response, decodeURIComponent(configMatch[1]))
    return
  }

  if (pathname === '/v1/reports/daily') {
    if (method !== 'GET') {
      sendMethodNotAllowed(response, ['GET'])
      return
    }
    handleCliBridgeDailyReport(response, url.searchParams.get('date') ?? undefined)
    return
  }

  if (pathname === '/v1/permissions/respond') {
    if (method !== 'POST') {
      sendMethodNotAllowed(response, ['POST'])
      return
    }
    await handleCliBridgePermissionResponse(request, response)
    return
  }

  if (pathname === '/v1/ask-user/respond') {
    if (method !== 'POST') {
      sendMethodNotAllowed(response, ['POST'])
      return
    }
    await handleCliBridgeAskUserResponse(request, response)
    return
  }

  const toggleMcpMatch = pathname.match(/^\/v1\/mcp\/([^/]+)\/(enable|disable)$/)
  if (toggleMcpMatch?.[1] && toggleMcpMatch[2]) {
    if (method !== 'POST') {
      sendMethodNotAllowed(response, ['POST'])
      return
    }
    handleCliBridgeToggleMcpServer(
      response,
      decodeURIComponent(toggleMcpMatch[1]),
      toggleMcpMatch[2] === 'enable',
    )
    return
  }

  const toggleSkillMatch = pathname.match(/^\/v1\/skills\/([^/]+)\/(enable|disable)$/)
  if (toggleSkillMatch?.[1] && toggleSkillMatch[2]) {
    if (method !== 'POST') {
      sendMethodNotAllowed(response, ['POST'])
      return
    }
    handleCliBridgeToggleSkill(
      response,
      decodeURIComponent(toggleSkillMatch[1]),
      toggleSkillMatch[2] === 'enable',
    )
    return
  }

  sendError(response, 404, `未知 endpoint: ${pathname}`)
}

export async function startCliBridgeServer(): Promise<CliBridgeServerState> {
  if (activeServer && activeState) {
    return activeState
  }

  const server = createServer((request, response) => {
    const state = activeState
    if (!state) {
      sendError(response, 503, 'CLI bridge 未初始化')
      return
    }

    void handleRequest(request, response, state).catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      log.error('[CLI Bridge] 请求处理失败:', error)
      sendError(response, 500, message)
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('CLI bridge 未获得有效监听端口')
  }

  const discovery = createDiscovery(address.port)
  writeCliBridgeDiscovery(discovery)

  activeServer = server
  activeState = { discovery }
  log.info(`[CLI Bridge] 已监听 http://${discovery.host}:${discovery.port}`)
  return activeState
}

export async function stopCliBridgeServer(): Promise<void> {
  const server = activeServer
  activeServer = null
  activeState = null
  removeCliBridgeDiscovery()

  if (!server) return

  await new Promise<void>((resolve) => {
    server.close(() => resolve())
  })
}

export function getCliBridgeServerState(): CliBridgeServerState | null {
  return activeState
}
