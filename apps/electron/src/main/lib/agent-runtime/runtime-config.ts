import { createHash } from 'node:crypto'
import type { RuntimeConfigV1 } from '@kila/shared'

export interface RuntimeConfigFingerprintInput {
  channel: Record<string, unknown>
  model: Record<string, unknown>
  systemPrompt: string
  cwd: string
  toolDescriptorsHash: string
  thinkingLevel: string
  compaction?: Record<string, unknown>
}

export interface RuntimeConfigVersionState {
  configRevision: number
  configFingerprint: string
  credentialRevision: number
  apiKeyFingerprint: string
}

export function resolveRuntimeConfigVersions(input: {
  configFingerprint: string
  apiKeyFingerprint: string
  previous?: RuntimeConfigVersionState
}): Pick<RuntimeConfigVersionState, 'configRevision' | 'credentialRevision'> {
  return {
    configRevision: input.previous && input.previous.configFingerprint !== input.configFingerprint
      ? input.previous.configRevision + 1
      : input.previous?.configRevision ?? 1,
    credentialRevision: input.previous && input.previous.apiKeyFingerprint !== input.apiKeyFingerprint
      ? input.previous.credentialRevision + 1
      : input.previous?.credentialRevision ?? 1,
  }
}

export function createRuntimeConfigFingerprint(input: RuntimeConfigFingerprintInput): string {
  return createHash('sha256').update(stableStringify({
    channel: omitCredentials(input.channel),
    model: input.model,
    systemPrompt: input.systemPrompt,
    cwd: input.cwd,
    toolDescriptorsHash: input.toolDescriptorsHash,
    thinkingLevel: input.thinkingLevel,
    compaction: input.compaction ?? {},
  })).digest('hex')
}

export function createRuntimeConfig(input: Omit<RuntimeConfigV1, 'configFingerprint'> & {
  fingerprintInput: RuntimeConfigFingerprintInput
}): RuntimeConfigV1 {
  return {
    configRevision: input.configRevision,
    configFingerprint: createRuntimeConfigFingerprint(input.fingerprintInput),
    credentialRevision: input.credentialRevision,
    channel: input.channel,
    model: input.model,
    systemPrompt: input.systemPrompt,
    cwd: input.cwd,
    toolDescriptorsHash: input.toolDescriptorsHash,
    thinkingLevel: input.thinkingLevel,
  }
}

function omitCredentials(channel: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...channel }
  delete copy.apiKey
  delete copy.token
  delete copy.accessToken
  delete copy.secret
  return copy
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (!value || typeof value !== 'object') return JSON.stringify(value)
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
}
