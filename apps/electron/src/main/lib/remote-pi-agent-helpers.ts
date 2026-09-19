import { createHash } from 'node:crypto'
import type {
  RuntimePromptImageReferenceV1,
  RuntimeQueryBootstrapV1,
  RuntimeToolCallPayloadV1,
  RuntimeToolDescriptorV1,
  RuntimeToolSource,
} from '@kila/shared'
import type { BeforeToolCallContext as PiBeforeToolCallContext } from '@earendil-works/pi-agent-core'
import type { PiAgentQueryOptions } from './agent-query-types'
import type { AnyAgentTool } from './agent-tool-names'
import { resolveAttachmentPath, safePathSegment } from './config-paths'
import { createRuntimeConfig, resolveRuntimeConfigVersions } from './agent-runtime/runtime-config'
import type { RuntimeTransferAttachmentInput } from './agent-runtime-transfer-store'
import type { RemoteRun, SessionRuntimeConfig } from './remote-pi-agent-types'
import { RUNTIME_TOOL_SOURCE } from './agent-runtime/pi-tool-host-bridge'

export function createBootstrap(
  input: PiAgentQueryOptions,
  runId: string,
  runtimeConfig: SessionRuntimeConfig,
  promptImageReferences: RuntimePromptImageReferenceV1[],
): RuntimeQueryBootstrapV1 {
  return {
    sessionId: input.sessionId,
    runId,
    configRevision: runtimeConfig.configRevision,
    configFingerprint: runtimeConfig.configFingerprint,
    credentialRevision: runtimeConfig.credentialRevision,
    prompt: input.prompt,
    rawPrompt: input.rawPrompt,
    model: input.model ?? '',
    cwd: input.cwd ?? process.cwd(),
    channel: input.channel,
    apiKey: input.apiKey,
    systemPrompt: input.systemPrompt,
    historyMessages: input.historyMessages ?? [],
    promptImages: promptImageReferences,
    thinkingLevel: input.thinkingLevel,
    thinking: input.thinking,
    effort: input.effort,
    maxRetryDelayMs: input.maxRetryDelayMs,
    modelCapabilities: asOptionalRecord(input.modelCapabilities),
    modelMetadata: asOptionalRecord(input.modelMetadata),
    modelProviderDbEntry: asOptionalRecord(input.modelProviderDbEntry),
    modelCompat: asOptionalRecord(input.modelCompat),
    runtimeContext: input.runtimeContext,
    runtimeContextFingerprint: input.runtimeContextFingerprint,
  }
}

export function createPromptImageTransfer(input: PiAgentQueryOptions): {
  references: RuntimePromptImageReferenceV1[]
  attachments: RuntimeTransferAttachmentInput[]
} {
  const attachments = input.promptImageAttachments?.length
    ? input.promptImageAttachments
    : (input.promptImages ?? []).map((image, index) => ({
      id: `legacy-${index}`,
      filename: `prompt-image-${index}`,
      mediaType: image.mimeType,
      localPath: '',
      size: Buffer.byteLength(image.data, 'base64'),
      inlineData: image.data,
    }))

  const references: RuntimePromptImageReferenceV1[] = []
  const transferAttachments: RuntimeTransferAttachmentInput[] = []
  for (const [index, attachment] of attachments.entries()) {
    if (!attachment.mediaType.startsWith('image/')) {
      throw new Error(`runtime_transfer_invalid_manifest: 非图片附件: ${attachment.filename}`)
    }
    const relativePath = `images/${index}-${safePathSegment(attachment.id || attachment.filename || `image-${index}`)}`
    references.push({
      relativePath,
      filename: attachment.filename,
      mediaType: attachment.mediaType,
    })
    const transferAttachment: RuntimeTransferAttachmentInput = {
      relativePath,
      kind: 'image',
    }
    if (attachment.inlineData) {
      transferAttachment.content = Buffer.from(attachment.inlineData, 'base64')
    } else {
      transferAttachment.sourcePath = resolveAttachmentPath(attachment.localPath, { allowAbsolute: true })
    }
    transferAttachments.push(transferAttachment)
  }
  return { references, attachments: transferAttachments }
}

export function createSessionRuntimeConfig(
  input: PiAgentQueryOptions,
  tools: RuntimeToolDescriptorV1[],
  previous?: SessionRuntimeConfig,
): SessionRuntimeConfig {
  const toolDescriptorsHash = hashStable(tools)
  const model = {
    id: input.model ?? '',
    compat: input.modelCompat,
    metadata: input.modelMetadata,
    capabilities: input.modelCapabilities,
    providerDbEntry: input.modelProviderDbEntry,
  }
  const fingerprintInput = {
    channel: input.channel as unknown as Record<string, unknown>,
    model,
    systemPrompt: input.systemPrompt,
    cwd: input.cwd ?? process.cwd(),
    toolDescriptorsHash,
    thinkingLevel: input.thinkingLevel ?? input.effort ?? 'auto',
  }
  const configFingerprint = createRuntimeConfig({
    configRevision: previous?.configRevision ?? 1,
    credentialRevision: previous?.credentialRevision ?? 1,
    channel: input.channel,
    model,
    systemPrompt: input.systemPrompt,
    cwd: input.cwd ?? process.cwd(),
    toolDescriptorsHash,
    thinkingLevel: input.thinkingLevel ?? input.effort ?? 'auto',
    fingerprintInput,
  }).configFingerprint
  const versions = resolveRuntimeConfigVersions({
    configFingerprint,
    apiKeyFingerprint: hashStable(input.apiKey),
    previous,
  })
  return {
    configRevision: versions.configRevision,
    configFingerprint,
    credentialRevision: versions.credentialRevision,
    channel: input.channel,
    model,
    systemPrompt: input.systemPrompt,
    cwd: input.cwd ?? process.cwd(),
    toolDescriptorsHash,
    thinkingLevel: input.thinkingLevel ?? input.effort ?? 'auto',
    apiKeyFingerprint: hashStable(input.apiKey),
  }
}

export function createToolDescriptors(tools: AnyAgentTool[]): RuntimeToolDescriptorV1[] {
  return tools.map((tool) => ({
    version: 1,
    toolId: `pi/${tool.name}`,
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: toRecord(tool.parameters),
    source: getRuntimeToolSource(tool),
    permission: permissionForTool(tool.name),
    resultKinds: ['text', 'structured'],
    supportsStreaming: tool.name === 'bash',
  }))
}

function getRuntimeToolSource(tool: AnyAgentTool): RuntimeToolSource {
  const source = (tool as AnyAgentTool & { [RUNTIME_TOOL_SOURCE]?: RuntimeToolSource })[RUNTIME_TOOL_SOURCE]
  return source ?? (isCodingTool(tool.name) ? 'kila-coding' : 'kila')
}

export function createBeforeToolCallContext(run: RemoteRun, call: RuntimeToolCallPayloadV1): PiBeforeToolCallContext {
  return {
    assistantMessage: {} as PiBeforeToolCallContext['assistantMessage'],
    toolCall: {
      type: 'toolCall',
      id: call.toolCallId,
      name: call.toolName,
      arguments: call.requestedArgs,
    },
    args: call.requestedArgs,
    context: {
      systemPrompt: run.query.systemPrompt,
      messages: [],
      tools: run.query.tools,
    },
  }
}

export function extractTextContent(value: unknown): string {
  if (!value || typeof value !== 'object') return String(value ?? '')
  const content = (value as { content?: unknown }).content
  if (!Array.isArray(content)) return ''
  return content
    .filter((item): item is { type: 'text'; text: string } => (
      Boolean(item)
      && typeof item === 'object'
      && (item as { type?: unknown }).type === 'text'
      && typeof (item as { text?: unknown }).text === 'string'
    ))
    .map((item) => item.text)
    .join('\n')
}

export function normalizeDetails(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : { value }
}

export function cleanupToolUpdateWaiters(run: RemoteRun): void {
  for (const waiters of run.toolUpdateWaiters.values()) {
    for (const waiter of waiters.values()) {
      clearTimeout(waiter.timer)
      waiter.reject(new Error('Runtime run 已结束'))
    }
  }
  run.toolUpdateWaiters.clear()
  run.pendingToolUpdateBytes.clear()
  run.pendingToolStarts.clear()
  run.approvedToolInputs.clear()
}

export async function waitForRunDone(run: RemoteRun, timeoutMs: number): Promise<void> {
  if (run.done) return
  await Promise.race([
    new Promise<void>((resolve) => {
      const previous = run.notify
      run.notify = () => {
        previous?.()
        resolve()
      }
    }),
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs)
      timer.unref?.()
    }),
  ])
}

export function runKey(sessionId: string, runId: string): string {
  return `${sessionId}:${runId}`
}

export function isToolUpdateConsumerStalled(error: unknown): error is Error {
  return error instanceof Error && error.message.includes('tool_update_consumer_stalled')
}

function hashStable(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value, (_key, nested) => (
    nested && typeof nested === 'object' && !Array.isArray(nested)
      ? Object.fromEntries(Object.entries(nested as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)))
      : nested
  ))).digest('hex')
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : { type: 'object' }
}

function asOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function isCodingTool(name: string): boolean {
  return name === 'read' || name === 'write' || name === 'edit' || name === 'bash'
}

function permissionForTool(name: string): 'read' | 'write' | 'execute' | 'interactive' {
  if (name === 'read') return 'read'
  if (name === 'write' || name === 'edit') return 'write'
  return isCodingTool(name) ? 'execute' : 'interactive'
}
