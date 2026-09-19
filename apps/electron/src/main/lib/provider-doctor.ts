/**
 * Provider Doctor
 *
 * 通过 Pi ModelRuntime 发起一次最小真实推理，确保诊断路径与 Agent 的协议、
 * Base URL 规范化、认证和模型选择保持一致。模型列表接口只用于发现模型，
 * 不作为“可用”的判断依据。
 */

import { randomUUID } from 'node:crypto'
import type {
  Channel,
  ChannelTestResult,
  ModelCapabilitiesOverride,
  ModelMetadataOverride,
  ProviderDbModel,
} from '@kila/shared'
import { resolvePiApiType } from './adapters/pi-model-builder'
import { clearPiSessionState } from './pi-session-state'
import { RemotePiAgentAdapter } from './remote-pi-agent-adapter'
import { classifyProviderError } from './provider-error-classifier'

export type ProbeChannel = Pick<Channel, 'provider' | 'apiType' | 'baseUrl' | 'capabilityProviderId'>

interface ProviderProbeModel {
  api: string
}

interface ProviderProbeCompletion {
  stopReason: string
  errorMessage?: string
}

interface ProviderProbeRuntime {
  modelRuntime: {
    completeSimple: (
      model: ProviderProbeModel,
      context: { messages: Array<{ role: 'user'; content: string; timestamp: number }> },
      options: {
        maxTokens: number
        reasoning?: unknown
        maxRetryDelayMs: number
        timeoutMs: number
        signal: AbortSignal
        onResponse?: (response: { status: number }) => void
      },
    ) => Promise<ProviderProbeCompletion>
  }
  model: ProviderProbeModel
}

export interface ProviderProbeInput {
  channel: ProbeChannel
  apiKey: string
  modelId: string
  modelMetadata?: ModelMetadataOverride
  modelCapabilities?: ModelCapabilitiesOverride
  providerDbEntry?: ProviderDbModel
  timeoutMs?: number
}

export interface ProviderProbeDependencies {
  buildModel?: (
    channel: ProbeChannel,
    modelId: string,
    metadataOverride?: ModelMetadataOverride,
    capabilitiesOverride?: ModelCapabilitiesOverride,
    hasImages?: boolean,
    providerDbEntry?: ProviderDbModel,
  ) => Promise<ProviderProbeModel>
  createRuntime?: (options: {
    channel: ProbeChannel
    model: ProviderProbeModel
    apiKey: string
  }) => Promise<ProviderProbeRuntime>
}

function invalidConfiguration(message: string, modelId?: string): ChannelTestResult {
  return {
    success: false,
    message,
    failureKind: 'invalid_configuration',
    ...(modelId ? { modelId } : {}),
  }
}

/** 发起无 Session、无工具、无 MCP/Skills 的最小真实生成请求。 */
export async function runProviderProbe(
  input: ProviderProbeInput,
  dependencies: ProviderProbeDependencies = {},
): Promise<ChannelTestResult> {
  const modelId = input.modelId.trim()
  if (!modelId) {
    return invalidConfiguration('未指定用于真实推理测试的模型')
  }
  if (!input.channel.baseUrl.trim()) {
    return invalidConfiguration('Base URL 不能为空', modelId)
  }

  if (!dependencies.buildModel || !dependencies.createRuntime) {
    return runProviderProbeInUtility({ ...input, modelId })
  }

  let resolvedApi: string | undefined
  let responseStatus: number | undefined

  try {
    const model = await dependencies.buildModel(
      input.channel,
      modelId,
      input.modelMetadata,
      input.modelCapabilities,
      false,
      input.providerDbEntry,
    )
    resolvedApi = model.api

    const runtime = await dependencies.createRuntime({
      channel: input.channel,
      model,
      apiKey: input.apiKey,
    })
    resolvedApi = runtime.model.api

    const timeoutMs = input.timeoutMs ?? 15_000
    const response = await runtime.modelRuntime.completeSimple(
      runtime.model,
      {
        messages: [{
          role: 'user',
          content: 'Reply with OK.',
          timestamp: Date.now(),
        }],
      },
      {
        maxTokens: 8,
        reasoning: undefined,
        maxRetryDelayMs: 0,
        timeoutMs,
        signal: AbortSignal.timeout(timeoutMs),
        onResponse: (providerResponse) => {
          responseStatus = providerResponse.status
        },
      },
    )

    if (response.stopReason === 'error' || response.stopReason === 'aborted') {
      const detail = response.errorMessage
        ?? (response.stopReason === 'aborted' ? 'Provider Doctor 请求已中止或超时' : '供应商返回未知错误')
      throw new Error(responseStatus && !detail.includes(String(responseStatus))
        ? `${responseStatus} ${detail}`
        : detail)
    }

    return {
      success: true,
      message: '真实推理成功',
      resolvedApi,
      modelId,
    }
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error)
    const message = responseStatus && !rawMessage.includes(String(responseStatus))
      ? `${responseStatus} ${rawMessage}`
      : rawMessage
    const classification = classifyProviderError(message)

    return {
      success: false,
      message: `${classification.title}: ${classification.message}`,
      resolvedApi,
      modelId,
      failureKind: classification.failureKind,
      statusCode: classification.statusCode ?? responseStatus,
    }
  }
}

/** Provider Doctor 只负责主进程编排，真实 Pi 探针在 Utility Runtime 中执行。 */
async function runProviderProbeInUtility(input: ProviderProbeInput): Promise<ChannelTestResult> {
  const sessionId = `provider-probe-${randomUUID()}`
  const adapter = new RemotePiAgentAdapter()
  let resolvedApi: string | undefined
  let output = ''
  try {
    resolvedApi = resolvePiApiType(input.channel, input.modelId)
    for await (const event of adapter.query({
      sessionId,
      runId: randomUUID(),
      prompt: 'Reply with OK.',
      rawPrompt: 'Reply with OK.',
      model: input.modelId,
      cwd: process.cwd(),
      channel: input.channel,
      apiKey: input.apiKey,
      systemPrompt: '',
      tools: [],
      maxRetryDelayMs: 0,
      modelMetadata: input.modelMetadata,
      modelCapabilities: input.modelCapabilities,
      modelProviderDbEntry: input.providerDbEntry,
    })) {
      if (event.type === 'text_delta') output += event.text
      if (event.type === 'typed_error') throw new Error(event.error.message)
      if (event.type === 'error') throw new Error(event.message)
      if (event.type === 'complete' && event.stopReason === 'error') {
        throw new Error('Provider 返回错误')
      }
    }
    return {
      success: true,
      message: output.trim() ? '真实推理成功' : '真实推理成功（Provider 未返回文本）',
      resolvedApi,
      modelId: input.modelId,
    }
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error)
    const classification = classifyProviderError(rawMessage)
    return {
      success: false,
      message: `${classification.title}: ${classification.message}`,
      resolvedApi,
      modelId: input.modelId,
      failureKind: classification.failureKind,
      statusCode: classification.statusCode,
    }
  } finally {
    await adapter.disposeSessionRuntime(sessionId).catch(() => undefined)
    await adapter.dispose()
    try {
      clearPiSessionState(sessionId)
    } catch {
      // 探针目录清理失败不覆盖真实诊断结果，后续启动清理会处理遗留 bundle。
    }
  }
}
