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
import type { AgentEventBus } from './agent-event-bus'
import { decryptApiKey, getChannelById } from './channel-manager'
import { resolveGlobalSkillMentionEntry } from './global-agent-config-manager'
import { resolveShell } from './shell-resolver'
import { buildShellPromptSection } from './shell-resolution'
import { getSettings } from './settings-service'
import { buildDynamicContextProjection, buildSystemPromptAppend } from './agent-prompt-builder'
import { permissionService, type PermissionResolution } from './agent-permission-service'
import { askUserService } from './agent-ask-user-service'
import { appendAgentMessage, getAgentMessages } from './agent-message-store'
import { getBuiltinAgentTools, getMcpAgentTools } from './pi-tools-bridge'
import {
  collectReservedToolNames,
  canonicalizeAgentTools,
  mergeAgentTools,
  normalizeToolNameKey,
  type AnyAgentTool,
} from './agent-tool-names'
import { resolveChannelModel } from './channel-model-resolution'
import { findProviderDbModel, lookupProviderDbModel } from './provider-db-loader'
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
  extraTools?: AnyAgentTool[]
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

/**
 * 给 Pi 内置 bash 工具套上进程追踪
 *
 * 必须在合并之前作用于 codingTools 本身：Pi `0.82.1` 的内置工具名是小写的
 * `read` / `bash` / `edit` / `write`，这里按归一化后的名字匹配，
 * 避免大小写差异让后台任务面板与进程管理静默失效。
 */
function withTrackedBashTool(
  tools: AnyAgentTool[],
  options: {
    sessionId: string
    cwd: string
    createBashTool: PiCodingAgentModule['createBashTool']
  },
): AnyAgentTool[] {
  return tools.map((tool) => {
    if (normalizeToolNameKey(tool.name) !== 'bash') return tool
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
  let providerDbEntry = lookupProviderDbModel(
    channelContext.channel.capabilityProviderId ?? channelContext.channel.provider,
    resolvedModel,
  )
  // 指定 provider 查不到时，跨 provider 全局兜底。
  // capabilityProviderId 是可选项，用户常按「协议兼容」配成 'openai'（stepfun / deepseek 等都走 OpenAI 协议），
  // 但模型实际归属于另一个 provider（如 step-3.7-flash 属于 stepfun-step-plan，context=256K）。
  // 不兜底会让这些模型静默退化到 FALLBACK_CONTEXT_WINDOW_TOKENS(32K)，进而过早触发压缩。
  if (!providerDbEntry) {
    providerDbEntry = findProviderDbModel(resolvedModel)?.model
  }
  const modelMetadata = resolveModelMetadata({
    channelProvider: channelContext.channel.provider,
    channelBaseUrl: channelContext.channel.baseUrl,
    modelId: resolvedModel,
    modelName: resolvedChannelModel?.name,
    metadataOverride: resolvedChannelModel?.metadataOverride,
    capabilitiesOverride: resolvedChannelModel?.capabilities,
    providerDbEntry,
  })

  const dynamicProjection = await buildDynamicContextProjection({
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

  // 稳定 runtime context 由 Pi adapter 作为一次性 snapshot 注入；每轮 prompt 只保留
  // 时钟等易变信息，避免把 MCP/Skills/工作目录重复发送并破坏 append-only 前缀。
  const finalPrompt = composeAgentPrompt(
    dynamicProjection.perMessageContext,
    memoryContext.text,
    enrichedMessage,
  )

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
  let codingTools: AnyAgentTool[] = []
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
  // 把内置工具名预留给 MCP 桥接：任一 MCP 服务器暴露 read/write/edit/bash
  // 都会被降级成 {服务器名}__{工具名}，不会再静默顶替真实的文件与 shell 工具。
  const mcpToolBundle = await getMcpAgentTools({
    sessionId,
    cwd: agentCwd,
    customMcpServers,
    reservedToolNames: collectReservedToolNames(codingTools, builtinTools),
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

  // 合并顺序即优先级：先到者保留，内置工具永远排在 MCP 与外部注入工具之前
  const tools = canonicalizeAgentTools(mergeAgentTools([
    { source: 'Pi 内置编码工具', tools: codingTools },
    { source: 'Kila 内置工具', tools: builtinTools },
    { source: 'MCP 工具', tools: mcpToolBundle.tools },
    { source: '运行时注入工具', tools: extraTools },
  ]))
  const contextSnapshot = buildSessionContextSnapshot({
    modelId: resolvedModel,
    contextWindow: modelMetadata.contextWindowTokens,
    historyTurns,
    systemPrompt: systemPromptText,
    dynamicContext: dynamicProjection.fullContext,
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
      runtimeContext: dynamicProjection.runtimeSnapshot,
      runtimeContextFingerprint: dynamicProjection.runtimeSnapshotFingerprint,
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
      modelCompat: resolvedChannelModel?.compat,
    },
  }
}
