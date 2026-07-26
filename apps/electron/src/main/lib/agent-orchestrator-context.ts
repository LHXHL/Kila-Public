/**
 * AgentOrchestrator context helpers
 *
 * 聚焦预检查、渠道/API key 解析、prompt/queryOptions 组装。
 */

import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import type { AgentSendInput, KilaPermissionMode, MemoryRunTrace, PermissionRequest, AskUserRequest } from '@kila/shared'
import { buildSessionContextSnapshot, resolveModelMetadata, resolveThinkingLevel } from '@kila/shared'
import type { PiAgentQueryOptions } from './adapters/pi-agent-adapter'
import { buildPromptImages, splitAttachmentsForPiPrompt } from './adapters/pi-history-converter'
import { AgentEventBus } from './agent-event-bus'
import { decryptApiKey, getChannelById } from './channel-manager'
import { resolveGlobalSkillMentionEntry } from './global-agent-config-manager'
import { resolveShell } from './shell-resolver'
import { buildShellPromptSection } from './shell-resolution'
import { getSettings } from './settings-service'
import { buildDynamicContext, buildSystemPromptAppend } from './agent-prompt-builder'
import { permissionService, type PermissionResolution } from './agent-permission-service'
import { askUserService } from './agent-ask-user-service'
import { appendAgentMessage, getAgentMessages } from './agent-message-store'
import { getBuiltinAgentTools, getMcpAgentTools } from './pi-tools-bridge'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { resolveChannelModel } from './channel-model-resolution'
import { lookupProviderDbModel } from './provider-db-loader'
import { createTrackedBashOperations } from './process-registry'
import { memoryLifecycleManager } from './memory/lifecycle-manager'
import { composeAgentPrompt } from './memory/prompt-compose'


import { createLogger } from './logger'
import { loadExternalEsm } from './external-esm-loader'
const log = createLogger('Agent 编排')

type PiCodingAgentModule = typeof import('@earendil-works/pi-coding-agent')

let piCodingAgentModulePromise: Promise<PiCodingAgentModule> | undefined

export interface ChannelContext {
  channel: ReturnType<typeof getChannelById> extends infer T ? Exclude<T, undefined> : never
  apiKey?: string
}

type ExtendedAgentSendInput = AgentSendInput & {
  extraTools?: AgentTool[]
}

export interface PreparedAgentRunContext {
  queryOptions: PiAgentQueryOptions
  resolvedModel: string
  memoryTrace: MemoryRunTrace
}

export function loadPiCodingAgent(): Promise<PiCodingAgentModule> {
  piCodingAgentModulePromise ??= loadExternalEsm<PiCodingAgentModule>('@earendil-works/pi-coding-agent')
  return piCodingAgentModulePromise
}

/**
 * 检查 Agent 运行时是否具备完整的 shell 环境。
 *
 * 判定与执行层（process-registry）共享 shell-resolver 同一真相源；
 * WSL 仅作为设置页的参考信息，执行层不会使用它，因此不计入可用性。
 * 缺少 shell 时不阻塞对话，仅跳过代码执行类工具（bash/file ops），
 * 同时 system prompt 会声明工具不可用并引导用户修复。
 */
export function isShellRuntimeAvailable(): boolean {
  if (process.platform !== 'win32') return true

  if (resolveShell().kind !== 'none') {
    return true
  }

  log.info('[Agent 编排] Shell 环境不可用，代码执行类工具将被跳过')
  return false
}

function applyChannelBaseUrlOverride(
  channel: ChannelContext['channel'],
  baseUrlOverride?: string,
): ChannelContext['channel'] {
  const trimmed = baseUrlOverride?.trim()
  if (!trimmed) {
    return channel
  }

  return {
    ...channel,
    baseUrl: trimmed,
  }
}

function resolveChannelApiKey(
  channelId: string,
  apiKeyOverride?: string,
): string {
  const trimmed = apiKeyOverride?.trim()
  if (trimmed) {
    return trimmed
  }

  return decryptApiKey(channelId)
}

function mergeAgentTools(...toolSets: Array<AgentTool<any>[] | undefined>): AgentTool<any>[] {
  const merged = new Map<string, AgentTool<any>>()

  for (const toolSet of toolSets) {
    for (const tool of toolSet ?? []) {
      const key = tool.name.trim().toLowerCase()
      if (merged.has(key)) {
        merged.delete(key)
      }
      merged.set(key, tool)
    }
  }

  return [...merged.values()]
}

function withTrackedBashTool(
  tools: AgentTool<any>[],
  options: {
    sessionId: string
    cwd: string
    createBashTool: PiCodingAgentModule['createBashTool']
  },
): AgentTool<any>[] {
  return tools.map((tool) => {
    if (tool.name !== 'bash') return tool
    return {
      ...tool,
      execute: (toolCallId, params, signal, onUpdate) => {
        const trackedBashTool = options.createBashTool(options.cwd, {
          operations: createTrackedBashOperations({
            sessionId: options.sessionId,
            toolCallId,
          }),
        })
        return trackedBashTool.execute(
          toolCallId,
          params as { command: string; timeout?: number },
          signal,
          onUpdate,
        )
      },
    }
  })
}

export function resolveAgentChannelContext(
  channelId: string,
  options?: { baseUrlOverride?: string; apiKeyOverride?: string },
): { ok: true; value: ChannelContext } | { ok: false; error: string } {
  const channel = getChannelById(channelId)
  if (!channel) {
    return { ok: false, error: '渠道不存在' }
  }

  try {
    return {
      ok: true,
      value: {
        channel: applyChannelBaseUrlOverride(channel, options?.baseUrlOverride),
        apiKey: resolveChannelApiKey(channelId, options?.apiKeyOverride),
      },
    }
  } catch {
    return { ok: false, error: '解密 API Key 失败' }
  }
}

export function filterHistoryMessages(
  history: ReturnType<typeof getAgentMessages>,
  historyTurns?: number | 'infinite',
): ReturnType<typeof getAgentMessages> {
  if (historyTurns === 'infinite' || typeof historyTurns === 'undefined') {
    return history
  }

  if (historyTurns <= 0) {
    return []
  }

  const collected = []
  let turnCount = 0

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index]!
    collected.unshift(message)
    if (message.role === 'user') {
      turnCount += 1
      if (turnCount >= historyTurns) {
        break
      }
    }
  }

  return collected
}

function handlePermissionResolution(eventBus: AgentEventBus, resolution: PermissionResolution): void {
  if (resolution.resolution === 'timeout') {
    appendAgentMessage(resolution.sessionId, {
      id: randomUUID(),
      role: 'status',
      content: `权限请求超时，已自动拒绝：${resolution.request.toolName}`,
      createdAt: Date.now(),
      errorCode: 'unknown_error',
      errorTitle: '权限请求超时',
    })
  }

  eventBus.emit(resolution.sessionId, {
    type: 'permission_resolved',
    requestId: resolution.requestId,
    behavior: resolution.behavior,
    resolution: resolution.resolution,
  })
}

export async function buildAgentRunContext(
  input: AgentSendInput,
  channelContext: ChannelContext,
  eventBus: AgentEventBus,
): Promise<PreparedAgentRunContext> {
  const {
    sessionId,
    userMessage,
    attachments,
    modelId,
    projectPath,
    projectProfileId,
    permissionModeOverride,
    mentionedSkills,
    mentionedMcpServers,
    customMcpServers,
    thinkingLevel: inputThinkingLevel,
    historyTurns,
    enabledToolIds,
    systemMessage,
    systemPromptId,
  } = input

  const { extraTools } = input as ExtendedAgentSendInput

  const appSettings = getSettings()
  const preferredModelId = appSettings.agentChannelId === channelContext.channel.id
    ? appSettings.agentModelId
    : undefined
  const modelResolution = resolveChannelModel(channelContext.channel, {
    requestedModelId: modelId,
    preferredModelId,
  })
  if (!modelResolution.ok) {
    throw new Error(modelResolution.error)
  }

  const resolvedModel = modelResolution.modelId
  const agentCwd = projectPath || homedir()
  const projectName = projectPath ? projectPath.split(/[\\/]/).filter(Boolean).pop() : undefined
  const resolvedChannelModel = channelContext.channel.models?.find(
    (m) => m.id === resolvedModel,
  )

  // channel.provider 代表实际的 endpoint 实例；capabilityProviderId 才是模型能力目录的可选真相源。
  // 例如自定义 OpenRouter 端点可维持 provider='company-router'，同时关联 capabilityProviderId='openrouter'。
  const providerDbEntry = lookupProviderDbModel(
    channelContext.channel.capabilityProviderId ?? channelContext.channel.provider,
    resolvedModel,
  )
  const modelMetadata = resolveModelMetadata({
    channelProvider: channelContext.channel.provider,
    channelBaseUrl: channelContext.channel.baseUrl,
    modelId: resolvedModel,
    modelName: resolvedChannelModel?.name,
    metadataOverride: resolvedChannelModel?.metadataOverride,
    capabilitiesOverride: resolvedChannelModel?.capabilities,
    providerDbEntry,
  })

  const dynamicCtx = await buildDynamicContext({
    sessionId,
    projectName,
    agentCwd,
  })

  const piPromptAttachments = splitAttachmentsForPiPrompt(userMessage, attachments)
  const modelSupportsVision = modelMetadata.abilities.vision === 'supported'
  const hasImageAttachments = piPromptAttachments.imageAttachments.length > 0

  let enrichedMessage = piPromptAttachments.prompt

  // 模型不支持视觉但有图片附件时：改走 analyze_image 工具路径
  if (!modelSupportsVision && hasImageAttachments) {
    const imagePaths = piPromptAttachments.imageAttachments
      .map((a) => a.localPath)
      .filter(Boolean)
    const imageHint = imagePaths.length > 0
      ? `\n\n[用户发送了 ${imagePaths.length} 张图片。请使用 analyze_image 工具查看并分析这些图片，图片路径: ${imagePaths.join(', ')}]`
      : `\n\n[用户发送了图片，但当前模型不支持直接查看图片。请使用 analyze_image 工具来分析。]`
    enrichedMessage += imageHint
  }
  if (mentionedSkills?.length || mentionedMcpServers?.length) {
    const toolLines: string[] = ['用户在消息中明确引用了以下工具，请在本次回复中主动调用：']

    for (const mentionId of mentionedSkills ?? []) {
      const skillEntry = resolveGlobalSkillMentionEntry(mentionId)
      if (skillEntry) {
        toolLines.push(
          `- Skill: ${skillEntry.name} [${skillEntry.sourceLabel}]（请立即使用 read 工具读取 ${skillEntry.contentPath}，并严格遵循其中流程）`,
        )
        continue
      }

      toolLines.push(`- Skill: ${mentionId}（未能解析来源；若存在，请先定位对应的 SKILL.md 再执行）`)
    }

    for (const name of mentionedMcpServers ?? []) {
      toolLines.push(`- MCP 服务器: ${name}（请使用此 MCP 服务器的工具来完成任务）`)
    }

    enrichedMessage = `<mentioned_tools>\n${toolLines.join('\n')}\n</mentioned_tools>\n\n${enrichedMessage}`
    log.info(`[Agent 编排] 注入 mentioned_tools: ${mentionedSkills?.length ?? 0} skills, ${mentionedMcpServers?.length ?? 0} MCP`)
  }

  const historyMessages = filterHistoryMessages(
    getAgentMessages(sessionId).slice(0, -1),
    historyTurns,
  )
  // 隐身模式仍允许只读召回既有记忆，但流结束时不会写入或蒸馏新记忆。
  const memoryContext = await memoryLifecycleManager.getPromptContext({
    sessionId,
    projectPath,
    userMessage,
    messages: historyMessages,
    incognito: input.incognito,
  })

  const finalPrompt = composeAgentPrompt(dynamicCtx, memoryContext.text, enrichedMessage)

  const thinkingLevel = resolveThinkingLevel({
    thinkingLevel: inputThinkingLevel ?? appSettings.agentThinkingLevel,
    thinking: appSettings.agentThinking,
    effort: appSettings.agentEffort,
  })
  const permissionMode: KilaPermissionMode = permissionModeOverride
    ?? appSettings.agentPermissionMode
    ?? 'smart'

  log.info(`[Agent 编排] 权限模式: ${permissionMode}${permissionModeOverride ? '（外部覆盖）' : ''}`)

  const systemPromptText = [
    systemMessage?.trim(),
    buildSystemPromptAppend({
      projectName,
      projectPath,
      projectProfileId,
      sessionId,
      permissionMode,
      customPromptId: systemPromptId,
      // Windows busybox / shell 缺失时注入约束段落；真 bash 环境返回 null 不注入
      shellPromptSection: buildShellPromptSection(resolveShell()),
    }),
  ].filter(Boolean).join('\n\n')



  // Shell 环境不可用时跳过 coding tools（bash/file 操作），
  // 仅保留 MCP / 内置 / memory 等不依赖 shell 的工具
  let codingTools: AgentTool<any>[] = []
  if (isShellRuntimeAvailable()) {
    const { createBashTool, createCodingTools } = await loadPiCodingAgent()
    codingTools = withTrackedBashTool(createCodingTools(agentCwd), {
      sessionId,
      cwd: agentCwd,
      createBashTool,
    })
  }
  const builtinTools = await getBuiltinAgentTools({
    sessionId,
    cwd: agentCwd,
    enabledToolIds,
    modelAbilities: { vision: modelMetadata.abilities.vision },
    sessionChannelId: channelContext.channel.id,
    sessionModelId: resolvedModel,
  })
  const mcpToolBundle = await getMcpAgentTools({
    cwd: agentCwd,
    customMcpServers,
  })

  const smartCanUseTool = permissionService.createCanUseTool(
    sessionId,
    'smart',
    (request: PermissionRequest) => {
      eventBus.emit(sessionId, { type: 'permission_request', request })
    },
    (sid, toolInput, signal, sendAskUser) => askUserService.handleAskUserQuestion(
      sid,
      toolInput,
      signal,
      sendAskUser,
      (resolution) => {
        eventBus.emit(resolution.sessionId, {
          type: 'ask_user_resolved',
          requestId: resolution.requestId,
        })
      },
    ),
    (request: AskUserRequest) => {
      eventBus.emit(sessionId, { type: 'ask_user_request', request })
    },
    (resolution) => handlePermissionResolution(eventBus, resolution),
  )

  const tools = mergeAgentTools(
    codingTools,
    builtinTools,
    mcpToolBundle.tools,
    extraTools ?? [],
  )
  const contextSnapshot = buildSessionContextSnapshot({
    modelId: resolvedModel,
    contextWindow: modelMetadata.contextWindowTokens,
    historyTurns,
    systemPrompt: systemPromptText,
    dynamicContext: dynamicCtx,
    historyMessages,
    currentTurnText: finalPrompt,
    toolDefinitions: tools.map((tool) => ({
      name: tool.name,
      description: typeof tool.description === 'string' ? tool.description : undefined,
    })),
  })
  eventBus.emit(sessionId, {
    type: 'context_snapshot',
    snapshot: contextSnapshot,
  })

  const beforeToolCall: PiAgentQueryOptions['beforeToolCall'] = async (context, signal) => {
    const toolInput = typeof context.args === 'object' && context.args
      ? context.args as Record<string, unknown>
      : {}
    const toolName = context.toolCall.name

    if (permissionMode === 'auto') return undefined
    const permission = await smartCanUseTool(
      toolName,
      toolInput,
      {
        signal: signal ?? new AbortController().signal,
        toolUseID: context.toolCall.id,
      },
    )
    if (permission.behavior === 'deny') {
      return { block: true, reason: permission.message }
    }
    return undefined
  }

  return {
    resolvedModel,
    memoryTrace: memoryContext.trace,
    queryOptions: {
      sessionId,
      prompt: finalPrompt,
      rawPrompt: userMessage,
      model: resolvedModel,
      cwd: agentCwd,
      channel: channelContext.channel,
      apiKey: channelContext.apiKey!,
      systemPrompt: systemPromptText,
      tools,
      historyMessages,
      beforeToolCall,
      thinkingLevel,
      maxRetryDelayMs: 30000,
      promptImages: modelSupportsVision ? await buildPromptImages(piPromptAttachments.imageAttachments) : [],
      modelCapabilities: resolvedChannelModel?.capabilities,
      modelMetadata: resolvedChannelModel?.metadataOverride,
      modelProviderDbEntry: providerDbEntry,
    },
  }
}
